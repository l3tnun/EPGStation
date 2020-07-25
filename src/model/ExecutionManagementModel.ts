import * as events from 'events';
import { inject, injectable } from 'inversify';
import IExecutionManagementModel, { ExecutionId } from './IExecutionManagementModel';
import ILogger from './ILogger';
import ILoggerModel from './ILoggerModel';

interface ExeQueueData {
    id: string;
    priority: number;
}

@injectable()
class ExecutionManagementModel implements IExecutionManagementModel {
    private log: ILogger;

    private lockId: string | null = null;
    private exeQueue: ExeQueueData[] = [];
    private exeEventEmitter: events.EventEmitter = new events.EventEmitter();

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();
    }

    public getExecution(priority: number, timeout: number = 1000 * 60): Promise<ExecutionId> {
        const exeQueueData: ExeQueueData = {
            id: new Date().getTime().toString(16) + Math.floor(1000 * Math.random()).toString(16),
            priority: priority,
        };

        // queue に挿入
        let position = 0;
        const len = this.exeQueue.length;
        for (; position < len; position++) {
            const q = this.exeQueue[position];
            if (q.priority < exeQueueData.priority) {
                break;
            }
        }
        this.exeQueue.splice(position, 0, exeQueueData);

        return new Promise<string>((resolve: (value: string) => void, reject: (err: Error) => void) => {
            // タイムアウト設定
            const timerId = setTimeout(() => {
                this.log.system.error(`get execution error: ${priority}`);
                // listener から削除
                this.exeEventEmitter.removeListener(ExecutionManagementModel.UNLOCK_EVENT, onDone);

                reject(new Error('GetExecutionTimeoutError'));
            }, timeout);

            const onDone = (id: string) => {
                if (id !== exeQueueData.id) {
                    return;
                }

                // タイマー停止
                clearTimeout(timerId);

                // 実行権が取得できた
                resolve(exeQueueData.id);

                // listener から削除
                this.exeEventEmitter.removeListener(ExecutionManagementModel.UNLOCK_EVENT, onDone);
            };

            // unlock されるたびに発行される
            this.exeEventEmitter.on(ExecutionManagementModel.UNLOCK_EVENT, onDone);

            /**
             * UNLOCK_EVENT を発行させる
             * はじめての実行の場合 queue に積んだ自分の id で UNLOCK_EVENT が呼ばれ
             * 実行権が取得できる
             */
            this.unLockExecution(exeQueueData.id);
        });
    }

    public unLockExecution(id: ExecutionId): void {
        if (this.lockId === id) {
            // アンロック
            this.lockId = null;
        }

        if (this.lockId === null) {
            // 次の操作に実行権を渡す
            const q = this.exeQueue.shift();
            if (typeof q !== 'undefined') {
                this.lockId = q.id;
                this.exeEventEmitter.emit(ExecutionManagementModel.UNLOCK_EVENT, q.id);
            }
        }
    }
}

namespace ExecutionManagementModel {
    export const UNLOCK_EVENT = 'ExeUnlock';
}

export default ExecutionManagementModel;
