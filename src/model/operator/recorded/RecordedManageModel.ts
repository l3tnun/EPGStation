import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import Thumbnail from '../../../db/entities/Thumbnail';
import VideoFile from '../../../db/entities/VideoFile';
import FileUtil from '../../../util/FileUtil';
import IVideoUtil from '../../api/video/IVideoUtil';
import IRecordedDB from '../../db/IRecordedDB';
import IThumbnailDB from '../../db/IThumbnailDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IRecordedEvent from '../../event/IRecordedEvent';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IRecordingManageModel from '../recording/IRecordingManageModel';
import IRecordedManageModel, { AddVideoFileOption } from './IRecordedManageModel';

@injectable()
export default class RecordedManageModel implements IRecordedManageModel {
    private log: ILogger;
    private config: IConfigFile;
    private recordedDB: IRecordedDB;
    private videoFileDB: IVideoFileDB;
    private thumbnailDB: IThumbnailDB;
    private recordingManageModel: IRecordingManageModel;
    private recordedEvent: IRecordedEvent;
    private videoUtil: IVideoUtil;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IThumbnailDB') thumbnailDB: IThumbnailDB,
        @inject('IRecordingManageModel')
        recordingManageModel: IRecordingManageModel,
        @inject('IRecordedEvent') recordedEvent: IRecordedEvent,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.recordedDB = recordedDB;
        this.videoFileDB = videoFileDB;
        this.thumbnailDB = thumbnailDB;
        this.recordingManageModel = recordingManageModel;
        this.recordedEvent = recordedEvent;
        this.videoUtil = videoUtil;
    }

    /**
     * 指定した録画情報と各種ファイルを削除する
     * @param recordedId: RecordedId
     * @return Promise<void>
     */
    public async delete(recordedId: apid.RecordedId): Promise<void> {
        this.log.system.info(`delete recorded: ${recordedId}`);
        const recorded = await this.recordedDB.findId(recordedId);
        if (recorded === null) {
            this.log.system.warn(`${recordedId} is null`);
            throw new Error('RecordedIdIsNotFound');
        }

        // 録画中なら停止
        if (
            recorded.isRecording === true &&
            recorded.reserveId !== null &&
            this.recordingManageModel.hasReserve(recorded.reserveId) === true
        ) {
            await this.recordingManageModel.cancel(recorded.reserveId, true);
        }

        const hasThumbnails = typeof recorded.thumbnails !== 'undefined' && recorded.thumbnails.length > 0;
        const hasVideoFiles = typeof recorded.videoFiles !== 'undefined' && recorded.videoFiles.length > 0;

        // サムネイル実ファイル削除
        if (hasThumbnails === true) {
            for (const t of recorded.thumbnails!) {
                const filePath = this.getThumbnailPath(t);
                this.log.system.info(`delete: ${filePath}`);
                await FileUtil.unlink(filePath).catch(err => {
                    this.log.system.error(`failed to delete ${filePath}`);
                    this.log.system.error(err);
                });
            }
        }

        // 録画ファイル実ファイル削除
        if (hasVideoFiles === true) {
            for (const v of recorded.videoFiles!) {
                let filePath: string | null;
                try {
                    filePath = await this.videoUtil.getFullFilePath(v.id);
                    if (filePath === null) {
                        throw new Error('GetVideoFilePathError');
                    }
                } catch (err) {
                    this.log.system.error(`get video file path error: ${v.id}`);
                    this.log.system.error(err);
                    this.log.system.error(v);
                    continue;
                }

                this.log.system.info(`delete: ${filePath}`);
                await FileUtil.unlink(filePath).catch(err => {
                    this.log.system.error(`failed to delete ${filePath}`);
                    this.log.system.error(err);
                });
            }
        }

        // TODO ドロップログファイル削除処理

        // DB からサムネイル情報削除
        if (hasThumbnails === true) {
            this.thumbnailDB.deleteRecordedId(recordedId);
        }

        // DB から録画ファイル情報削除
        if (hasVideoFiles === true) {
            await this.videoFileDB.deleteRecordedId(recordedId);
        }

        // DB から録画情報削除
        await this.recordedDB.deleteOnce(recordedId);

        this.log.system.info(`successful delete recorded: ${recordedId}`);

        // イベント発行
        this.recordedEvent.emitDeleteRecorded(recorded);
    }

    /**
     * サムネイルファイルパス取得
     * @param thumbnail: Thumbnail
     * @return string
     */
    private getThumbnailPath(thumbnail: Thumbnail): string {
        return path.join(this.config.thumbnail, thumbnail.filePath);
    }

    /**
     * 指定されて video file id のファイルサイズを更新する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>;
     */
    public async updateVideoFileSize(videoFileId: apid.VideoFileId): Promise<void> {
        this.log.system.info(`update video file size: ${videoFileId}`);

        const filePath = await this.videoUtil.getFullFilePath(videoFileId);
        if (filePath === null) {
            this.log.system.error(`video file is not found: ${videoFileId}`);
            throw new Error('VideoFileIsNotFound');
        }

        const fileSize = await FileUtil.getFileSize(filePath);

        await this.videoFileDB.updateSize(videoFileId, fileSize);

        this.recordedEvent.emitUpdateVideoFileSize(videoFileId);
    }

    /**
     * option で指定されたビデオファイルを追加する
     * @param option: AddVideoFileOption
     * @return Promise<apid.VideoFileId>
     */
    public async addVideoFile(option: AddVideoFileOption): Promise<apid.VideoFileId> {
        this.log.system.info(`add video file: ${option.recordedId} ${option.filePath}`);

        const parentDirPath = this.videoUtil.getParentDirPath(option.parentDirectoryName);
        if (parentDirPath === null) {
            this.log.system.error(`parent directory is null: ${option.parentDirectoryName}`);
            throw new Error('ParentDirectoryIsNull');
        }

        const fileSize = await FileUtil.getFileSize(path.join(parentDirPath, option.filePath));

        const videoFile = new VideoFile();
        videoFile.parentDirectoryName = option.parentDirectoryName;
        videoFile.filePath = option.filePath;
        videoFile.type = option.type;
        videoFile.name = option.name;
        videoFile.size = fileSize;
        videoFile.recordedId = option.recordedId;

        const newVideoFileId = await this.videoFileDB.insertOnce(videoFile);

        this.recordedEvent.emitAddVideoFile(newVideoFileId);

        return newVideoFileId;
    }

    /**
     * 指定された video file id のファイルを削除する
     * @param videoFileid: apid.VideoFileId
     * @return Promise<void>
     */
    public async deleteVideoFile(videoFileid: apid.VideoFileId): Promise<void> {
        this.log.system.info(`delete video file: ${videoFileid}`);

        const video = await this.videoFileDB.findId(videoFileid);
        if (video === null) {
            this.log.system.info(`video file is not found: ${videoFileid}`);
            throw new Error('VideoFileIsNotFound');
        }

        await this.videoFileDB.deleteOnce(videoFileid);

        // video に紐付けられていた recorded が空かチェック
        const recorded = await this.recordedDB.findId(video.recordedId);
        if (recorded !== null && typeof recorded.videoFiles !== 'undefined' && recorded.videoFiles.length === 0) {
            // 空だったので recorded も削除
            this.log.system.info(`empty video files: ${video.recordedId}`);
            await this.delete(video.recordedId);
        } else {
            this.recordedEvent.emitDeleteVideoFile(videoFileid);
        }
    }
}
