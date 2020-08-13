import * as events from 'events';
import { inject, injectable } from 'inversify';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IEPGUpdateEvent from './IEPGUpdateEvent';

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
            } catch (err) {
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
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }
}

namespace EPGUpdateEvent {
    export const UPDATED_EVENT = 'updated';
}

export default EPGUpdateEvent;
