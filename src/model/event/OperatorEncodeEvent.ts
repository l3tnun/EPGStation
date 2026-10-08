import * as events from 'events';
import { inject, injectable } from 'inversify';
import ILogger from '../ILogger.js';
import ILoggerModel from '../ILoggerModel.js';
import { EncodeCompletionInfo, EncodeCompletionSink } from '../ipc/IEncodeCompletionSink.js';
import IOperatorEncodeEvent, { OperatorFinishEncodeInfo } from './IOperatorEncodeEvent.js';

/**
 * `IOperatorEncodeEvent` の実装。`EncodeCompletionSink`（`accept`）も兼ね、子process側からIPC
 * 経由で届くエンコード完了通知を受けて `emitFinishEncode` を発行し、operator側の購読者へ伝える。
 */
@injectable()
class OperatorEncodeEvent implements IOperatorEncodeEvent, EncodeCompletionSink {
    private log: ILogger;
    private emitter: events.EventEmitter = new events.EventEmitter();

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();
    }

    /**
     * エンコード完了イベント発行
     * @param info: OperatorFinishEncodeInfo
     */
    public emitFinishEncode(info: OperatorFinishEncodeInfo): void {
        this.emitter.emit(OperatorEncodeEvent.FINISH_ENCODE_EVENT, info);
    }

    public accept(info: EncodeCompletionInfo): void {
        this.emitFinishEncode(info);
    }

    /**
     * エンコード完了イベント登録
     * @param callback: (info: OperatorFinishEncodeInfo) => void
     */
    public setFinishEncode(callback: (info: OperatorFinishEncodeInfo) => void): void {
        this.emitter.on(OperatorEncodeEvent.FINISH_ENCODE_EVENT, async (info: OperatorFinishEncodeInfo) => {
            try {
                await callback(info);
            } catch (err: any) {
                this.log.system.error(err);
            }
        });
    }
}

namespace OperatorEncodeEvent {
    export const FINISH_ENCODE_EVENT = 'finishEncodeEvent';
}

export default OperatorEncodeEvent;
