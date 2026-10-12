import { ChildProcess, spawn } from 'child_process';
import diskusage from 'diskusage-ng';
import { inject, injectable } from 'inversify';
import ProcessUtil from '../../../util/ProcessUtil.js';
import Util from '../../../util/Util.js';
import IConfigFile, { RecordedDirInfo } from '../../IConfigFile.js';
import IConfiguration from '../../IConfiguration.js';
import ILogger from '../../ILogger.js';
import ILoggerModel from '../../ILoggerModel.js';
import IRecordedStorageDeletionPort from './IRecordedStorageDeletionPort.js';
import IStorageDeletionCandidatePort from './IStorageDeletionCandidatePort.js';
import IStorageManageModel from './IStorageManageModel.js';
import IStorageRecordedUseSnapshotPort from './IStorageRecordedUseSnapshotPort.js';

const STORAGE_OPERATION_WATCHDOG_MS = 600_000;
const DEFAULT_STORAGE_COMMAND_TIMEOUT_MS = 300_000;
const MAX_STORAGE_COMMAND_TIMEOUT_MS = 2_147_483_647;
const STORAGE_COMMAND_STOP_GRACE_MS = 3_000;

interface StorageEntryId {
    readonly identity: symbol;
    readonly snapshotIndex: number;
}

type ActiveStorageOperation = object;
type MonitoredStorageEntry = RecordedDirInfo & { readonly limitThreshold: number };

interface StorageLimitCommandOperation {
    readonly observationDone: Promise<'terminal' | 'spawn-failure'>;
}

interface ActiveStorageCommand {
    readonly child: ChildProcess;
    readonly id: symbol;
    readonly observationDone: Promise<'terminal' | 'spawn-failure'>;
    readonly resolveObservation: (result: 'terminal' | 'spawn-failure') => void;
    deadline: NodeJS.Timeout | undefined;
    spawned: boolean;
    state: 'running' | 'timing-out' | 'unreaped';
    stopGrace: NodeJS.Timeout | undefined;
}

/**
 * `IStorageManageModel` の実装。config.yml の `recorded` に `limitThreshold` が設定された
 * 保存先ディレクトリを定期的に監視し、空き容量が閾値を下回った場合に録画の削除
 * （`deletionPort`）や、その entry に設定された外部コマンド（`limitCmd`）の実行で空きを確保する。
 */
@injectable()
export default class StorageManageModel implements IStorageManageModel {
    private log: ILogger;
    private config: IConfigFile;
    private readonly deletionPort: IRecordedStorageDeletionPort;
    private readonly candidatePort: IStorageDeletionCandidatePort;
    private readonly recordedUseSnapshotPort: IStorageRecordedUseSnapshotPort;

    private timerId: NodeJS.Timeout | null = null;
    /** 現在チェック/削除処理が進行中の保存先ディレクトリの集合（`getEntryId`で得た識別子を
     *  key にする）。同じ entry に対する重複チェックの起動を防ぐ。 */
    private readonly activeOperations = new Map<StorageEntryId, ActiveStorageOperation>();
    /** 空き容量確保のために実行中の外部コマンド（`limitCmd`）1件ごとの
     *  子processと状態（running/timing-out/unreaped）を、コマンドごとの一意なsymbolで管理する。 */
    private readonly activeCommands = new Map<symbol, ActiveStorageCommand>();
    /** `config.storageLimitCommandTimeoutMs` を正規化した、外部コマンドのwatchdogタイムアウト値。 */
    private readonly commandTimeoutMs: number;
    /** config.yml の `recorded` エントリ（同一設定が重複登録される場合を考慮し出現回数単位）ごとに
     *  発行した識別子。constructor時に事前登録し、`getEntryId`が参照する。 */
    private readonly entryIds = new Map<RecordedDirInfo, StorageEntryId[]>();
    /** `entryIds`に無い出現（起動後のconfig変化等、通常は起こらない想定外のケース）用に、
     *  一意な識別子を発行し続けるための減算カウンタ。 */
    private fallbackEntryIndex: number = -1;

    protected get isRunning(): boolean {
        return this.activeOperations.size !== 0;
    }

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IStorageDeletionCandidatePort') candidatePort: IStorageDeletionCandidatePort,
        @inject('IRecordedStorageDeletionPort') deletionPort: IRecordedStorageDeletionPort,
        @inject('IStorageRecordedUseSnapshotPort') recordedUseSnapshotPort: IStorageRecordedUseSnapshotPort,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.candidatePort = candidatePort;
        this.deletionPort = deletionPort;
        this.recordedUseSnapshotPort = recordedUseSnapshotPort;
        this.commandTimeoutMs = this.normalizeCommandTimeout(this.config.storageLimitCommandTimeoutMs);
        this.config.recorded.forEach((entry, snapshotIndex) => {
            const entryIds = this.entryIds.get(entry) ?? [];
            entryIds.push({ identity: Symbol('storage-entry'), snapshotIndex });
            this.entryIds.set(entry, entryIds);
        });
    }

    /**
     * 空き容量チェック開始
     */
    public start(): void {
        const checkList: RecordedDirInfo[] = [];
        for (const r of this.config.recorded) {
            if (typeof r.limitThreshold !== 'undefined') {
                checkList.push(r);
            }
        }

        // 空き容量チェックが必要なければ何もしない
        if (checkList.length === 0) {
            return;
        }

        this.timerId = setInterval(async () => {
            await this.check(checkList).catch(err => {
                this.log.system.error('disk check error');
                this.log.system.error(err);
            });
        }, this.config.storageLimitCheckIntervalTime * 1000);
    }

    /**
     * 空き容量をチェックし、空きがなければ録画を削除する
     * @param list: RecordedDirInfo[]
     */
    private async check(list: RecordedDirInfo[]): Promise<void> {
        const startedOperations = new Set<Promise<void>>();
        const occurrenceIndexes = new Map<RecordedDirInfo, number>();

        for (const l of list) {
            const occurrenceIndex = occurrenceIndexes.get(l) ?? 0;
            occurrenceIndexes.set(l, occurrenceIndex + 1);
            if (typeof l.limitThreshold === 'undefined') {
                continue;
            }

            const entryId = this.getEntryId(l, occurrenceIndex);
            if (this.activeOperations.has(entryId)) {
                continue;
            }

            const operation: ActiveStorageOperation = {};
            this.activeOperations.set(entryId, operation);
            const pending = this.checkEntry(l as MonitoredStorageEntry, entryId, operation);
            const release = () => {
                if (this.activeOperations.get(entryId) === operation) {
                    this.activeOperations.delete(entryId);
                }
            };
            void pending.then(release, release);
            startedOperations.add(pending);
        }

        await Promise.all(startedOperations);
    }

    private async checkEntry(
        l: MonitoredStorageEntry,
        entryId: StorageEntryId,
        operation: ActiveStorageOperation,
    ): Promise<void> {
        let availableBytes: number;
        try {
            availableBytes = await this.watchStage(l, entryId, operation, 'capacity', () => this.getFreeSize(l.path));
        } catch (err: any) {
            this.log.system.error(`get disk info error: ${l.path}`);
            this.log.system.error(err);

            return;
        }
        let freeMb = availableBytes / 1024 / 1024;

        // 空き容量が閾値を超えたか
        if (freeMb > l.limitThreshold) {
            return;
        }

        let commandOperation: StorageLimitCommandOperation | undefined;
        if (typeof l.limitCmd !== 'undefined') {
            // run cmd
            this.log.system.info(`run storage limit cmd: ${l.limitCmd}`);
            try {
                const cmds = ProcessUtil.parseCmdStr(l.limitCmd);
                // 互換性のためここでは全ての環境変数を渡すため env は未指定
                commandOperation = this.launchCommand(cmds.bin, cmds.args, l.limitCmd);
            } catch (err: any) {
                this.log.system.error(`limit cmd error: ${l.limitCmd}`);
                this.log.system.error(err);
            }
        }

        try {
            if (l.action === 'remove') {
                const attemptedRecordedIds = new Set<number>();
                while (freeMb <= l.limitThreshold) {
                    this.log.system.info(`name: ${l.name}, free: ${freeMb}, threshold: ${l.limitThreshold}`);

                    let snapshot;
                    try {
                        snapshot = await this.watchStage(l, entryId, operation, 'use-snapshot', () =>
                            this.recordedUseSnapshotPort.getSnapshot(),
                        );
                    } catch (err: any) {
                        this.log.system.error('failed to get recorded use snapshot');
                        this.log.system.error(err);
                        break;
                    }

                    if (snapshot.status !== 'known') {
                        this.log.system.error('recorded use snapshot is unknown');
                        break;
                    }

                    let recordedId: number | null = null;
                    try {
                        recordedId = await this.watchStage(l, entryId, operation, 'candidate', () =>
                            this.candidatePort.findOldestUnused({
                                excludedRecordedIds: new Set([...snapshot.recordedIds, ...attemptedRecordedIds]),
                                storageName: l.name,
                            }),
                        );
                    } catch (err: any) {
                        this.log.system.error('failed to find old recorded');
                        this.log.system.error(err);
                        break;
                    }

                    // 削除すべき録画が見つからなかった
                    if (recordedId === null) {
                        this.log.system.error('find old recorded error');
                        break;
                    }

                    if (attemptedRecordedIds.has(recordedId)) {
                        this.log.system.error(`storage limit repeated recorded: ${recordedId}`);
                        break;
                    }
                    attemptedRecordedIds.add(recordedId);

                    // 録画を削除
                    try {
                        this.log.system.info(`storage limit remove recorded: ${recordedId}`);
                        const outcome = await this.watchStage(l, entryId, operation, 'delete', () =>
                            this.deletionPort.deleteForStoragePressure(recordedId, l.name),
                        );
                        if (outcome !== 'deleted') {
                            break;
                        }
                    } catch (err: any) {
                        this.log.system.error(err);
                        break;
                    }

                    let nextAvailableBytes: number;
                    try {
                        nextAvailableBytes = await this.watchStage(l, entryId, operation, 're-read', () =>
                            this.getFreeSize(l.path),
                        );
                    } catch (err: any) {
                        this.log.system.error(`get disk info error: ${l.path}`);
                        this.log.system.error(err);
                        break;
                    }

                    const nextFreeMb = nextAvailableBytes / 1024 / 1024;
                    if (nextAvailableBytes <= availableBytes) {
                        this.log.system.error(`storage limit free space did not increase: ${l.name}`);
                        break;
                    }
                    if (nextFreeMb > l.limitThreshold) {
                        break;
                    }

                    availableBytes = nextAvailableBytes;
                    freeMb = nextFreeMb;
                    await Util.sleep(100);
                }
            }
        } finally {
            await commandOperation?.observationDone;
        }
    }

    private normalizeCommandTimeout(rawTimeout: unknown): number {
        if (typeof rawTimeout === 'undefined') {
            return DEFAULT_STORAGE_COMMAND_TIMEOUT_MS;
        }
        if (!Number.isSafeInteger(rawTimeout)) {
            throw new Error('storageLimitCommandTimeoutMs must be a safe integer between 1 and 2147483647');
        }
        const timeout = rawTimeout as number;
        if (timeout < 1 || timeout > MAX_STORAGE_COMMAND_TIMEOUT_MS) {
            throw new Error('storageLimitCommandTimeoutMs must be a safe integer between 1 and 2147483647');
        }
        return timeout;
    }

    private launchCommand(bin: string, args: string[], command: string): StorageLimitCommandOperation {
        const child = spawn(bin, args, {
            stdio: 'ignore',
        });
        let resolveObservation!: (result: 'terminal' | 'spawn-failure') => void;
        const observationDone = new Promise<'terminal' | 'spawn-failure'>(resolve => {
            resolveObservation = resolve;
        });
        const operation: ActiveStorageCommand = {
            child,
            deadline: undefined,
            id: Symbol('storage-command'),
            observationDone,
            resolveObservation,
            spawned: false,
            state: 'running',
            stopGrace: undefined,
        };
        this.activeCommands.set(operation.id, operation);

        const isCurrent = (): boolean => this.activeCommands.get(operation.id) === operation;
        const removeListeners = (): void => {
            child.removeListener('spawn', onSpawn);
            child.removeListener('error', onError);
            child.removeListener('close', onClose);
        };
        const finish = (result: 'terminal' | 'spawn-failure'): void => {
            if (!isCurrent()) {
                return;
            }
            clearTimeout(operation.deadline);
            operation.deadline = undefined;
            clearTimeout(operation.stopGrace);
            operation.stopGrace = undefined;
            removeListeners();
            this.activeCommands.delete(operation.id);
            operation.resolveObservation(result);
        };
        const onSpawn = (): void => {
            if (isCurrent()) {
                operation.spawned = true;
            }
        };
        const onError = (error: Error): void => {
            if (!isCurrent()) {
                return;
            }
            this.log.system.error(`limit cmd error: ${command}`);
            this.log.system.error(error);
            if (!operation.spawned) {
                finish('spawn-failure');
            }
        };
        const onClose = (): void => finish('terminal');

        child.once('spawn', onSpawn);
        child.on('error', onError);
        child.on('close', onClose);
        operation.deadline = setTimeout(() => {
            if (!isCurrent() || operation.state !== 'running') {
                return;
            }
            operation.state = 'timing-out';
            operation.deadline = undefined;
            this.log.system.error(`limit cmd timeout: ${command}`);
            try {
                if (!child.kill('SIGKILL')) {
                    this.log.system.error(`limit cmd stop failed: ${command}`);
                }
            } catch (error) {
                this.log.system.error(`limit cmd stop failed: ${command}`);
                this.log.system.error(error);
            }
            operation.stopGrace = setTimeout(() => {
                if (!isCurrent() || operation.state !== 'timing-out') {
                    return;
                }
                operation.state = 'unreaped';
                operation.stopGrace = undefined;
                this.log.system.error(`limit cmd terminal not observed: ${command}`);
            }, STORAGE_COMMAND_STOP_GRACE_MS);
        }, this.commandTimeoutMs);

        return { observationDone };
    }

    private getEntryId(entry: RecordedDirInfo, occurrenceIndex: number): StorageEntryId {
        const entryIds = this.entryIds.get(entry) ?? [];
        const existing = entryIds[occurrenceIndex];
        if (typeof existing !== 'undefined') {
            return existing;
        }
        const created = { identity: Symbol('storage-entry'), snapshotIndex: this.fallbackEntryIndex-- };
        entryIds[occurrenceIndex] = created;
        this.entryIds.set(entry, entryIds);
        return created;
    }

    private watchStage<T>(
        entry: RecordedDirInfo,
        entryId: StorageEntryId,
        operation: ActiveStorageOperation,
        stage: string,
        task: () => Promise<T>,
    ): Promise<T> {
        const watchdog = setTimeout(() => {
            if (this.activeOperations.get(entryId) !== operation) {
                return;
            }
            this.log.system.error(`storage operation overdue: ${stage}: ${entry.name}`);
        }, STORAGE_OPERATION_WATCHDOG_MS);
        try {
            const pending = task();
            void pending.then(
                () => clearTimeout(watchdog),
                () => clearTimeout(watchdog),
            );
            return pending;
        } catch (error) {
            clearTimeout(watchdog);
            return Promise.reject(error);
        }
    }

    /**
     * 空き容量を取得する
     * @param dirPath: ディレクトリパス
     * @return Promise<number>
     */
    private getFreeSize(dirPath: string): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            diskusage(dirPath, (err, usage) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(usage.available);
                }
            });
        });
    }

    /**
     * 空き容量チェックを停止
     */
    public stop(): void {
        if (this.timerId !== null) {
            clearInterval(this.timerId);
        }
    }
}
