import * as events from 'events';
import { inject, injectable } from 'inversify';
import ILogger from '../ILogger.js';
import ILoggerModel from '../ILoggerModel.js';
import IEPGUpdateEvent from './IEPGUpdateEvent.js';

/** `IEPGUpdateEvent` の実装。Node.js の `EventEmitter` を内部に持ち、EPG更新完了を購読者へ通知する。 */
@injectable()
class EPGUpdateEvent implements IEPGUpdateEvent {
    private log: ILogger;
    private emitter: events.EventEmitter = new events.EventEmitter();

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();
    }

    /**
     * EPG 更新完了イベント発行
     */
    public emitUpdated(): void {
        this.emitter.emit(EPGUpdateEvent.UPDATED_EVENT);
    }

    /**
     * EPG 更新完了イベント登録
     * @param callback: () => void
     */
    public setUpdated(callback: () => void): void {
        this.emitter.on(EPGUpdateEvent.UPDATED_EVENT, async () => {
            try {
                await callback();
            } catch (err: any) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * EPG 更新完了イベント登録 (一度だけ実行)
     * @param callback: () => void
     */
    public setUpdatedOnce(callback: () => void): void {
        this.emitter.once(EPGUpdateEvent.UPDATED_EVENT, async () => {
            try {
                await callback();
            } catch (err: any) {
                this.log.system.error(err);
            }
        });
    }
}

namespace EPGUpdateEvent {
    export const UPDATED_EVENT = 'updated';
}

export default EPGUpdateEvent;
