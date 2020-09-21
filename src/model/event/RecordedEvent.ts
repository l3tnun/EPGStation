import * as events from 'events';
import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import Recorded from '../../db/entities/Recorded';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IRecordedEvent from './IRecordedEvent';

@injectable()
class RecordedEvent implements IRecordedEvent {
    private log: ILogger;
    private emitter: events.EventEmitter = new events.EventEmitter();

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();
    }

    /**
     * 録画削除イベント発行
     * @param recorded: Recorded
     */
    public emitDeleteRecorded(recorded: Recorded): void {
        this.emitter.emit(RecordedEvent.DELETE_RECORDED_EVENT, recorded);
    }

    /**
     * video file サイズ更新イベント発行
     * @param videoFileId: apid.VideoFileId
     */
    public emitUpdateVideoFileSize(videoFileId: apid.VideoFileId): void {
        this.emitter.emit(RecordedEvent.UPDATE_VIDEO_FILE_SIZE, videoFileId);
    }

    /**
     * 録画済み番組新規追加イベント発行
     * @param recordedId: apid.RecordedId
     */
    public emitCreateNewRecorded(recordedId: apid.RecordedId): void {
        this.emitter.emit(RecordedEvent.CREATE_NEW_RECORDED, recordedId);
    }

    /**
     * video file 追加イベント発行
     * @param newVideoFileId: apid.VideoFileId
     */
    public emitAddVideoFile(newVideoFileId: apid.VideoFileId): void {
        this.emitter.emit(RecordedEvent.ADD_VIDEO_FILE, newVideoFileId);
    }

    /**
     * アップロードビデオファイル追加イベント発行
     * @param newVideoFileId: apid.VideoFileId
     * @param needsCreateThumbnail: boolean サムネイル生成が必要か
     */
    public emitAddUploadedVideoFile(newVideoFileId: apid.VideoFileId, needsCreateThumbnail: boolean): void {
        this.emitter.emit(RecordedEvent.ADD_UPLOADED_VIDEO_FILE, newVideoFileId, needsCreateThumbnail);
    }

    /**
     * video file 削除イベント発行
     * @param videoFileId: apid.VideoFileId
     */
    public emitDeleteVideoFile(videoFileId: apid.VideoFileId): void {
        this.emitter.emit(RecordedEvent.DLETE_VIDEO_FILE, videoFileId);
    }

    /**
     * 保護状態を変更イベント発行
     * @param recordedId: apid.RecordedId
     * @param isProtected: boolean
     */
    public emitChangeProtect(recordedId: apid.RecordedId, isProtected: boolean): void {
        this.emitter.emit(RecordedEvent.CHANGE_PROTECT, recordedId, isProtected);
    }

    /**
     * 録画削除イベント登録
     * @param callback: (recorded: Recorded) => void
     */
    public setDeleteRecorded(callback: (recorded: Recorded) => void): void {
        this.emitter.on(RecordedEvent.DELETE_RECORDED_EVENT, async (recorded: Recorded) => {
            try {
                await callback(recorded);
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * 録画済み番組新規追加イベント登録
     * @param callback: (recordedId: apid.RecordedId) => void
     */
    public setCreateNewRecorded(callback: (recordedId: apid.RecordedId) => void): void {
        this.emitter.on(RecordedEvent.CREATE_NEW_RECORDED, async (recordedId: apid.RecordedId) => {
            try {
                await callback(recordedId);
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * video file サイズ更新イベント登録
     * @param callback: (videoFileId: apid.VideoFileId) => void
     */
    public setUpdateVideoFileSize(callback: (videoFileId: apid.VideoFileId) => void): void {
        this.emitter.on(RecordedEvent.UPDATE_VIDEO_FILE_SIZE, async (videoFileId: apid.VideoFileId) => {
            try {
                await callback(videoFileId);
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * video file 追加イベント登録
     * @param callback: (newVideoFileId: apid.VideoFileId) => void
     */
    public setAddVideoFile(callback: (newVideoFileId: apid.VideoFileId) => void): void {
        this.emitter.on(RecordedEvent.ADD_VIDEO_FILE, async (newVideoFileId: apid.VideoFileId) => {
            try {
                await callback(newVideoFileId);
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * アップロードビデオファイル追加イベント登録
     * @param callback: (newVideoFileId: apid.VideoFileId, needsCreateThumbnail: boolean) => void
     */
    public setAddUploadedVideoFile(
        callback: (newVideoFileId: apid.VideoFileId, needsCreateThumbnail: boolean) => void,
    ): void {
        this.emitter.on(
            RecordedEvent.ADD_UPLOADED_VIDEO_FILE,
            async (newVideoFileId: apid.VideoFileId, needsCreateThumbnail: boolean) => {
                try {
                    await callback(newVideoFileId, needsCreateThumbnail);
                } catch (err) {
                    this.log.system.error(err);
                }
            },
        );
    }

    /**
     * video file 削除イベント登録
     * @param callback: (videoFileId: apid.VideoFileId) => void
     */
    public setDeleteVideoFile(callback: (videoFileId: apid.VideoFileId) => void): void {
        this.emitter.on(RecordedEvent.DLETE_VIDEO_FILE, async (videoFileId: apid.VideoFileId) => {
            try {
                await callback(videoFileId);
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * 保護状態を変更イベント登録
     * @param callback: (recordedId: apid.RecordedId, isProtected: boolean) => void
     */
    public setChangeProtect(callback: (recordedId: apid.RecordedId, isProtected: boolean) => void): void {
        this.emitter.on(RecordedEvent.CHANGE_PROTECT, async (recordedId: apid.RecordedId, isProtected: boolean) => {
            try {
                await callback(recordedId, isProtected);
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }
}

namespace RecordedEvent {
    export const DELETE_RECORDED_EVENT = 'DeleteRecorded';
    export const UPDATE_VIDEO_FILE_SIZE = 'UpdateVideoFileSize';
    export const CREATE_NEW_RECORDED = 'createNewRecorded';
    export const ADD_VIDEO_FILE = 'AddVideoFile';
    export const ADD_UPLOADED_VIDEO_FILE = 'addUploadedVideoFile';
    export const DLETE_VIDEO_FILE = 'DeleteVideoFile';
    export const CHANGE_PROTECT = 'ChangeProtect';
}

export default RecordedEvent;
