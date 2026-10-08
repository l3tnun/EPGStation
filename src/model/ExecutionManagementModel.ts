import * as events from 'events';
import { inject, injectable, unmanaged } from 'inversify';
import IExecutionManagementModel, { ExecutionId } from './IExecutionManagementModel.js';
import ILogger from './ILogger.js';
import ILoggerModel from './ILoggerModel.js';

type ExecutionState = 'allocating' | 'waiting' | 'granted' | 'overdue' | 'expired' | 'released';

interface ExeQueueData {
    id: ExecutionId | null;
    onGranted: (id: ExecutionId) => void;
    ownerTimerId: NodeJS.Timeout | null;
    priority: number;
    reject: (error: Error) => void;
    resolve: (id: ExecutionId) => void;
    state: ExecutionState;
    timerId: NodeJS.Timeout;
}

/**
 * `IExecutionManagementModel` の実装。要求は id 割り当て待ち（`allocationQueue`）→
 * lock 許可待ち（`exeQueue`、優先度順）→lock 保持（`owner`）の順に状態遷移する。
 * id 空間が尽きて割り当てられない要求は `allocationQueue` に留まり、`unLockExecution`等で
 * 空きが出るたびに `assignAllocationWaiters` が改めて割り当てを試みる。
 */
@injectable()
class ExecutionManagementModel implements IExecutionManagementModel {
    private log: ILogger;

    /** 現在lockを保持している要求の id。誰も保持していなければ `null`。 */
    private lockId: ExecutionId | null = null;
    /** 現在lockを保持している要求本体。`lockId` と対になる。 */
    private owner: ExeQueueData | null = null;
    /** 次に割り当てる id の候補。`maxExecutionId` に達したら 1 へ巻き戻るラウンドロビン。 */
    private nextExecutionId: ExecutionId = 1;
    /** id 割り当て済みで lock 許可待ちの要求一覧。優先度の高い順に並ぶ。 */
    private exeQueue: ExeQueueData[] = [];
    /** id 未割り当てで、id 空間の空きを待っている要求一覧。優先度の高い順に並ぶ。 */
    private allocationQueue: ExeQueueData[] = [];
    /** lock解放を`exeQueue`側の待機者へ知らせるための内部専用 event。各要求が自分の
     *  `onGranted`を1つだけ購読し、解放のたびに全待機者へ通知して早い者勝ちで受理させる。 */
    private exeEventEmitter: events.EventEmitter = new events.EventEmitter();
    /** 割り当てるidの上限（達したら1へ巻き戻る）。既定は`Number.MAX_SAFE_INTEGER`だが、
     *  test等でidの衝突・巻き戻りを起こしやすくするため`@unmanaged`で差し替え可能。 */
    private maxExecutionId: ExecutionId;
    /** `true`の場合、lock保持者に対して`OWNER_WATCHDOG_TIMEOUT`超過を検知するwatchdogを張る。 */
    private reservationOwnerWatchdog: boolean;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @unmanaged() maxExecutionId: ExecutionId = Number.MAX_SAFE_INTEGER,
        @unmanaged() reservationOwnerWatchdog: boolean = false,
    ) {
        if (!Number.isSafeInteger(maxExecutionId) || maxExecutionId < 1) {
            throw new Error('ExecutionManagementMaxIdError');
        }
        this.log = logger.getLogger();
        this.maxExecutionId = maxExecutionId;
        this.reservationOwnerWatchdog = reservationOwnerWatchdog;
    }

    public getExecution(priority: number, timeout: number = 1000 * 60): Promise<ExecutionId> {
        return new Promise<ExecutionId>((resolve, reject) => {
            const entry = this.createEntry(priority, resolve, reject);
            entry.timerId = setTimeout(() => this.expire(entry), timeout);

            if (this.allocateExecutionId(entry)) {
                this.enqueueWaiting(entry);
            } else {
                this.enqueueAllocating(entry);
            }

            this.grantNext();
        });
    }

    public unLockExecution(id: ExecutionId): void {
        if (
            this.lockId !== id ||
            this.owner === null ||
            (this.owner.state !== 'granted' && this.owner.state !== 'overdue')
        ) {
            return;
        }

        this.clearOwnerWatchdog(this.owner);
        this.owner.state = 'released';
        this.owner = null;
        this.lockId = null;
        this.assignAllocationWaiters();
        this.grantNext();
    }

    private createEntry(
        priority: number,
        resolve: (id: ExecutionId) => void,
        reject: (error: Error) => void,
    ): ExeQueueData {
        const entry: ExeQueueData = {
            id: null,
            onGranted: () => {},
            ownerTimerId: null,
            priority,
            reject,
            resolve,
            state: 'allocating' as const,
            timerId: undefined as unknown as NodeJS.Timeout,
        };
        entry.onGranted = (id: ExecutionId) => this.grant(entry, id);
        return entry;
    }

    private allocateExecutionId(entry: ExeQueueData): boolean {
        for (let attempt = 0; attempt < this.maxExecutionId; attempt++) {
            const candidate = this.nextExecutionId;
            this.nextExecutionId = candidate === this.maxExecutionId ? 1 : candidate + 1;
            if (this.isExecutionIdUsed(candidate)) continue;

            entry.id = candidate;
            return true;
        }
        return false;
    }

    private isExecutionIdUsed(id: ExecutionId): boolean {
        if (this.lockId === id) return true;
        return this.exeQueue.some(entry => entry.id === id && this.isIdHoldingState(entry.state));
    }

    private isIdHoldingState(state: ExecutionState): boolean {
        return state === 'waiting' || state === 'granted' || state === 'overdue';
    }

    private enqueueWaiting(entry: ExeQueueData): void {
        entry.state = 'waiting';
        this.exeEventEmitter.on(ExecutionManagementModel.UNLOCK_EVENT, entry.onGranted);
        const position = this.exeQueue.findIndex(candidate => candidate.priority < entry.priority);
        if (position === -1) {
            this.exeQueue.push(entry);
            return;
        }
        this.exeQueue.splice(position, 0, entry);
    }

    private enqueueAllocating(entry: ExeQueueData): void {
        const position = this.allocationQueue.findIndex(candidate => candidate.priority < entry.priority);
        if (position === -1) {
            this.allocationQueue.push(entry);
            return;
        }
        this.allocationQueue.splice(position, 0, entry);
    }

    private expire(entry: ExeQueueData): void {
        if (entry.state !== 'allocating' && entry.state !== 'waiting') return;

        this.removeEntry(entry);
        entry.state = 'expired';
        clearTimeout(entry.timerId);
        this.exeEventEmitter.removeListener(ExecutionManagementModel.UNLOCK_EVENT, entry.onGranted);
        this.assignAllocationWaiters();
        this.log.system.error(`get execution error: ${entry.priority}`);
        entry.reject(new Error('GetExecutionTimeoutError'));
    }

    private removeEntry(entry: ExeQueueData): void {
        this.removeEntryByIdentity(this.allocationQueue, entry);
        this.removeEntryByIdentity(this.exeQueue, entry);
    }

    private removeEntryByIdentity(queue: ExeQueueData[], entry: ExeQueueData): void {
        const index = queue.indexOf(entry);
        if (index !== -1) queue.splice(index, 1);
    }

    private assignAllocationWaiters(): void {
        while (this.allocationQueue.length > 0) {
            const entry = this.allocationQueue[0];
            if (entry.state !== 'allocating') {
                this.allocationQueue.shift();
                continue;
            }
            if (!this.allocateExecutionId(entry)) return;

            this.allocationQueue.shift();
            this.enqueueWaiting(entry);
        }
    }

    private grantNext(): void {
        if (this.lockId !== null) return;

        const entry = this.exeQueue.shift();
        if (entry === undefined) return;
        if (entry.state !== 'waiting' || entry.id === null) {
            this.grantNext();
            return;
        }

        this.lockId = entry.id;
        this.owner = entry;
        entry.state = 'granted';
        this.startOwnerWatchdog(entry);
        this.exeEventEmitter.emit(ExecutionManagementModel.UNLOCK_EVENT, entry.id);
    }

    private startOwnerWatchdog(entry: ExeQueueData): void {
        if (!this.reservationOwnerWatchdog) return;

        entry.ownerTimerId = setTimeout(() => {
            if (this.owner !== entry || entry.state !== 'granted') return;

            entry.ownerTimerId = null;
            entry.state = 'overdue';
            this.log.system.error(`reservation execution overdue: ${entry.id}`);
        }, ExecutionManagementModel.OWNER_WATCHDOG_TIMEOUT);
    }

    private clearOwnerWatchdog(entry: ExeQueueData): void {
        if (entry.ownerTimerId === null) return;

        clearTimeout(entry.ownerTimerId);
        entry.ownerTimerId = null;
    }

    private grant(entry: ExeQueueData, id: ExecutionId): void {
        if (this.owner !== entry || entry.id !== id || entry.state !== 'granted') return;

        clearTimeout(entry.timerId);
        this.exeEventEmitter.removeListener(ExecutionManagementModel.UNLOCK_EVENT, entry.onGranted);
        entry.resolve(id);
    }
}

namespace ExecutionManagementModel {
    export const OWNER_WATCHDOG_TIMEOUT = 600_000;
    export const UNLOCK_EVENT = 'ExeUnlock';
}

export default ExecutionManagementModel;
