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
     * サムネイル追加イベント登録
     * @param callback: (videoFileId: apid.VideoFileId, recordedId: apid.RecordedId) => void
     */
    public setAdded(callback: (videoFileId: apid.VideoFileId, recordedId: apid.RecordedId) => void): void {
        this.emitter.on(
            ThumbnailEvent.ADDED_EVENT,
            async (videoFileId: apid.VideoFileId, recordedId: apid.RecordedId) => {
                try {
                    await callback(videoFileId, recordedId);
                } catch (err) {
                    this.log.system.error(err);
                }
            },
        );
    }
}

namespace ThumbnailEvent {
    export const ADDED_EVENT = 'added';
}

export default ThumbnailEvent;
