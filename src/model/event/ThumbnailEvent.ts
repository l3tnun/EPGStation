import * as events from 'events';
import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IThumbnailEvent from './IThumbnailEvent';

@injectable()
class ThumbnailEvent implements IThumbnailEvent {
    private log: ILogger;
    private emitter: events.EventEmitter = new events.EventEmitter();

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();
    }

    /**
     * サムネイル追加イベント発行
     * @param videoFileId: apid.VideoFileId
     * @param recordedId apid.RecordedId
     */
    public emitAdded(videoFileId: apid.VideoFileId, recordedId: apid.RecordedId): void {
        this.emitter.emit(ThumbnailEvent.ADDED_EVENT, videoFileId, recordedId);
    }

    /**
     * サムネイル削除イベント発行
     */
    public emitDeleted(): void {
        this.emitter.emit(ThumbnailEvent.DELETED_EVENT);
    }

    /**
     * サムネイル追加イベント登録
     * @param callback: (videoFileId: apid.VideoFileId, recordedId: apid.RecordedId) => void
     */
    public setAdded(callback: (videoFileId: apid.VideoFileId, recordedId: apid.RecordedId) => void): void {
        this.emitter.on(
            ThumbnailEvent.ADDED_EVENT,
            async (videoFileId: apid.VideoFileId, recordedId: apid.RecordedId) => {
                try {
                    await callback(videoFileId, recordedId);
                } catch (err: any) {
                    this.log.system.error(err);
                }
            },
        );
    }

    /**
     * サムネイル削除イベント登録
     * @param callback: () => void
     */
    public setDeleted(callback: () => void): void {
        this.emitter.on(ThumbnailEvent.DELETED_EVENT, async () => {
            try {
                await callback();
            } catch (err: any) {
                this.log.system.error(err);
            }
        });
    }
}

namespace ThumbnailEvent {
    export const ADDED_EVENT = 'added';
    export const DELETED_EVENT = 'deleted';
}

export default ThumbnailEvent;
