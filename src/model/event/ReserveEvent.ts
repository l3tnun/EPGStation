import * as events from 'events';
import { inject, injectable } from 'inversify';
import ILogger from '../ILogger.js';
import ILoggerModel from '../ILoggerModel.js';
import IReserveEvent, { IReserveUpdateValues } from './IReserveEvent.js';

/** `IReserveEvent` の実装。詳細は `IReserveEvent` を参照。 */
@injectable()
class ReserveEvent implements IReserveEvent {
    private log: ILogger;
    private emitter: events.EventEmitter = new events.EventEmitter();

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();
    }

    /**
     * 予約更新イベント発行
     * @param diff: IReserveUpdateValues
     */
    public emitUpdated(diff: IReserveUpdateValues): void {
        this.emitter.emit(ReserveEvent.UPDATE_EVENT, diff);
    }

    /**
     * 予約更新イベント登録
     * @param callback: (diff: IReserveUpdateValues) => void
     */
    public setUpdated(callback: (diff: IReserveUpdateValues) => void): void {
        this.emitter.on(ReserveEvent.UPDATE_EVENT, async (diff: IReserveUpdateValues) => {
            try {
                await callback(diff);
            } catch (err: any) {
                this.log.system.error(err);
            }
        });
    }
}

namespace ReserveEvent {
    export const UPDATE_EVENT = 'ReserveUpdateEvent';
}

export default ReserveEvent;
