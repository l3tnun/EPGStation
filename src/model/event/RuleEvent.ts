import * as events from 'events';
import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IRuleEvent from './IRuleEvent';

@injectable()
class RuleEvent implements IRuleEvent {
    private log: ILogger;
    private emitter: events.EventEmitter = new events.EventEmitter();

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();
    }

    /**
     * ルール追加イベント発行
     * @param ruleId: apid.RuleId
     */
    public emitAdded(ruleId: apid.RuleId): void {
        this.emitter.emit(RuleEvent.ADDED_EVENT, ruleId);
    }

    /**
     * ルール更新イベント発行
     * @param ruleId: apid.RuleId
     */
    public emitUpdated(ruleId: apid.RuleId): void {
        this.emitter.emit(RuleEvent.UPDATED_EVENT, ruleId);
    }

    /**
     * ルール有効化イベント発行
     * @param ruleId: apid.RuleId
     */
    public emitEnabled(ruleId: apid.RuleId): void {
        this.emitter.emit(RuleEvent.ENABLED_EVENT, ruleId);
    }

    /**
     * ルール無効化イベント発行
     * @param ruleId: apid.RuleId
     */
    public emitDisabled(ruleId: apid.RuleId): void {
        this.emitter.emit(RuleEvent.DISABLED_EVENT, ruleId);
    }

    /**
     * ルール削除イベント発行
     * @param ruleId: apid.RuleId
     */
    public emitDeleted(ruleId: apid.RuleId): void {
        this.emitter.emit(RuleEvent.DELETED_EVENT, ruleId);
    }

    /**
     * ルール追加イベント登録
     * @param callback: (ruleId: apid.RuleId) => void
     */
    public setAdded(callback: (ruleId: apid.RuleId) => void): void {
        this.emitter.on(RuleEvent.ADDED_EVENT, async (ruleId: apid.RuleId) => {
            try {
                await callback(ruleId);
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * ルール更新イベント登録
     * @param callback: (ruleId: apid.RuleId) => void
     */
    public setUpdated(callback: (ruleId: apid.RuleId) => void): void {
        this.emitter.on(RuleEvent.UPDATED_EVENT, async (ruleId: apid.RuleId) => {
            try {
                await callback(ruleId);
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * ルール有効化イベント登録
     * @param callback: (ruleId: apid.RuleId) => void
     */
    public setEnabled(callback: (ruleId: apid.RuleId) => void): void {
        this.emitter.on(RuleEvent.ENABLED_EVENT, async (ruleId: apid.RuleId) => {
            try {
                await callback(ruleId);
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * ルール無効化イベント登録
     * @param callback: (ruleId: apid.RuleId) => void
     */
    public setDisabled(callback: (ruleId: apid.RuleId) => void): void {
        this.emitter.on(RuleEvent.DISABLED_EVENT, async (ruleId: apid.RuleId) => {
            try {
                await callback(ruleId);
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * ルール削除イベント登録
     * @param callback: (ruleId: apid.RuleId) => void
     */
    public setDeleted(callback: (ruleId: apid.RuleId) => void): void {
        this.emitter.on(RuleEvent.DELETED_EVENT, async (ruleId: apid.RuleId) => {
            try {
                await callback(ruleId);
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }
}

namespace RuleEvent {
    export const ADDED_EVENT = 'Added';
    export const UPDATED_EVENT = 'Updated';
    export const ENABLED_EVENT = 'Enabled';
    export const DISABLED_EVENT = 'Disabled_Event';
    export const DELETED_EVENT = 'Deleted_Event';
}

export default RuleEvent;
