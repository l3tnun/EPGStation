import * as events from 'events';
import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import RecordedTag from '../../db/entities/RecordedTag';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IRecordedTagEvent from './IRecordedTagEvent';

@injectable()
class RecordedTagEvent implements IRecordedTagEvent {
    private log: ILogger;
    private emitter: events.EventEmitter = new events.EventEmitter();

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();
    }

    /**
     * tag 新規作成イベント発行
     * @param tag: RecordedTag
     */
    public emitCreated(tag: RecordedTag): void {
        this.emitter.emit(RecordedTagEvent.CREATED_EVENT, tag);
    }

    /**
     * tag 更新イベント発行
     * @param tagId: apid.RecordedTagId
     */
    public emitUpdated(tagId: apid.RecordedTagId): void {
        this.emitter.emit(RecordedTagEvent.UPDATED_EVENT, tagId);
    }

    /**
     * 関連付け完了イベント発行
     * @param tagId: apid.RecordedTagId
     * @param recordedId: apid.RecordedId
     */
    public emitRelated(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): void {
        this.emitter.emit(RecordedTagEvent.RELATER_EVENT, tagId, recordedId);
    }

    /**
     * タグ削除イベント発行
     * @param tagId: apid.RecordedTagId
     */
    public emitDeleted(tagId: apid.RecordedTagId): void {
        this.emitter.emit(RecordedTagEvent.DELETED_EVENT, tagId);
    }

    /**
     * タグ関連付け削除イベント発行
     * @param tagId: apid.RecordedTagId
     * @param recordedId: apid.RecordedId
     */
    public emitDeletedRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): void {
        this.emitter.emit(RecordedTagEvent.DELETED_RELATION_EVENT, tagId, recordedId);
    }

    /**
     * tag 新規作成イベント登録
     * @param callback: (tag: RecordedTag) => void
     */
    public setCreated(callback: (tag: RecordedTag) => void): void {
        this.emitter.on(RecordedTagEvent.CREATED_EVENT, async (tag: RecordedTag) => {
            try {
                await callback(tag);
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * tag 更新イベント登録
     * @param callback: (tagId: apid.RecordedTagId) => void
     */
    public setUpdated(callback: (tagId: apid.RecordedTagId) => void): void {
        this.emitter.on(RecordedTagEvent.UPDATED_EVENT, async (tagId: apid.RecordedTagId) => {
            try {
                await callback(tagId);
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * 関連付け完了イベント登録
     * @param callback: callback: (tagId: apid.RecordedTagId, recordedId: apid.RecordedId) => void
     */
    public setRelated(callback: (tagId: apid.RecordedTagId, recordedId: apid.RecordedId) => void): void {
        this.emitter.on(
            RecordedTagEvent.RELATER_EVENT,
            async (tagId: apid.RecordedTagId, recordedId: apid.RecordedId) => {
                try {
                    await callback(tagId, recordedId);
                } catch (err) {
                    this.log.system.error(err);
                }
            },
        );
    }

    /**
     * タグ削除イベント登録
     * @param callback: (tagId: apid.RecordedTagId) => void
     */
    public setDeleted(callback: (tagId: apid.RecordedTagId) => void): void {
        this.emitter.on(RecordedTagEvent.DELETED_EVENT, async (tagId: apid.RecordedTagId) => {
            try {
                await callback(tagId);
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * タグ関連付け削除イベント登録
     * @param callback: (tagId: apid.RecordedTagId, recordedId: apid.RecordedId) => void
     */
    public setDeletedRelation(callback: (tagId: apid.RecordedTagId, recordedId: apid.RecordedId) => void): void {
        this.emitter.on(
            RecordedTagEvent.DELETED_RELATION_EVENT,
            async (tagId: apid.RecordedTagId, recordedId: apid.RecordedId) => {
                try {
                    await callback(tagId, recordedId);
                } catch (err) {
                    this.log.system.error(err);
                }
            },
        );
    }
}

namespace RecordedTagEvent {
    export const CREATED_EVENT = 'Created';
    export const UPDATED_EVENT = 'Updated';
    export const RELATER_EVENT = 'Related';
    export const DELETED_EVENT = 'Deleted';
    export const DELETED_RELATION_EVENT = 'DeletedRelation';
}

export default RecordedTagEvent;
