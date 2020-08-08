import { spawn } from 'child_process';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import Thumbnail from '../../../db/entities/Thumbnail';
import FileUtil from '../../../util/FileUtil';
import IVideoUtil from '../../api/video/IVideoUtil';
import IThumbnailDB from '../../db/IThumbnailDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IThumbnailEvent from '../../event/IThumbnailEvent';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import { IPromiseQueue } from '../../IPromiseQueue';
import IThumbnailManageModel from './IThumbnailManageModel';

@injectable()
export default class ThumbnailManageModel implements IThumbnailManageModel {
    private log: ILogger;
    private config: IConfigFile;
    private queue: IPromiseQueue;
    private videoFileDB: IVideoFileDB;
    private thumbnailDB: IThumbnailDB;
    private thumbnailEvent: IThumbnailEvent;
    private videoUtil: IVideoUtil;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IPromiseQueue') queue: IPromiseQueue,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IThumbnailDB') thumbnailDB: IThumbnailDB,
        @inject('IThumbnailEvent') thumbnailEvent: IThumbnailEvent,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.queue = queue;
        this.videoFileDB = videoFileDB;
        this.thumbnailDB = thumbnailDB;
        this.thumbnailEvent = thumbnailEvent;
        this.videoUtil = videoUtil;
    }

    /**
     * サムネイル作成 Queue に追加する
     * @param videoFileId: apid.VideoFileId
     */
    public add(videoFileId: apid.VideoFileId): void {
        this.log.system.info(`add thumbnail queue: ${videoFileId}`);

        this.queue.add<void>(() => {
            return this.create(videoFileId).catch(err => {
                this.log.system.error(`create thumbnail error: ${videoFileId}`);
                this.log.system.error(err);
            });
        });
    }

    /**
     * サムネイル生成をして生成したファイルを Thumbnail に登録する
     * @param videoFileId: apid.VideoFileId
     */
    private async create(videoFileId: apid.VideoFileId): Promise<void> {
        const videoFile = await this.videoFileDB.findId(videoFileId);
        const videoFilePath = await this.videoUtil.getFullFilePath(videoFileId);
        if (videoFile === null || videoFilePath === null) {
            this.log.system.error(`video file is not found: ${videoFileId}`);
            throw new Error('VideoFileIsNotFound');
        }

        // check thumbnail dir
        try {
            await FileUtil.access(this.config.thumbnail, fs.constants.R_OK | fs.constants.W_OK);
        } catch (err) {
            if (typeof err.code !== 'undefined' && err.code === 'ENOENT') {
                // ディレクトリが存在しないので作成する
                this.log.system.warn(`mkdirp: ${this.config.thumbnail}`);
                await FileUtil.mkdir(this.config.thumbnail);
            } else {
                // アクセス権に Read or Write が無い
                this.log.system.fatal(`thumbnail dir permission error: ${this.config.thumbnail}`);
                this.log.system.fatal(err);
                throw err;
            }
        }

        const fileName = await this.getSaveFileName(videoFile.recordedId);
        const filePath = path.join(this.config.thumbnail, fileName);

        // ffmpeg の実行権限をチェック
        await FileUtil.access(this.config.ffmpeg, fs.constants.X_OK);

        // ffmpeg args
        const args = [
            '-y',
            '-i',
            videoFilePath,
            '-ss',
            this.config.thumbnailPosition.toString(10),
            '-vframes',
            '1',
            '-f',
            'image2',
            '-s',
            this.config.thumbnailSize,
            filePath,
        ];

        // run ffmpeg
        const child = spawn(this.config.ffmpeg, args);

        // debug 用
        if (child.stderr !== null) {
            child.stderr.on('data', data => {
                this.log.system.debug(String(data));
            });
        }
        if (child.stdout !== null) {
            child.stdout.on('data', () => {});
        }

        return new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
            child.on('exit', async code => {
                if (code !== 0) {
                    reject(new Error('CreateThumbnailExitError'));
                }
                this.log.system.info(`create thumbnail: ${videoFileId}, ${filePath}`);

                // add DB
                const thumbnail = new Thumbnail();
                thumbnail.filePath = fileName;
                thumbnail.recordedId = videoFile.recordedId;
                try {
                    await this.thumbnailDB.insertOnce(thumbnail);
                } catch (err) {
                    this.log.system.error(`thumbnail add DB error: ${videoFileId}`);
                    this.log.system.error(err);

                    // delete thumbnail file
                    await FileUtil.unlink(filePath).catch(err => {
                        this.log.system.error(`thumbnail delete error: ${videoFileId}, ${filePath}`);
                        this.log.system.error(err);
                    });

                    reject(new Error('FailedToAdThumbnailToDB'));

                    return;
                }

                resolve();

                // event emit
                this.thumbnailEvent.emitAdded(videoFileId, videoFile.recordedId);
            });

            child.on('error', err => {
                this.log.system.error(`create thumbnail failed: ${videoFileId}`);
                reject(err);
            });
        });
    }

    /**
     * 重複しないサムネイルファイル名を返す
     * @param recordedId: recorded id
     * @param conflict: 重複数
     * @return string
     */
    private async getSaveFileName(recordedId: apid.RecordedId, conflict: number = 0): Promise<string> {
        const conflictStr = conflict === 0 ? '' : `(${conflict})`;
        const fileName = `${recordedId}${conflictStr}.jpg`;
        const filePath = path.join(this.config.thumbnail, fileName);

        try {
            await FileUtil.stat(filePath);

            return this.getSaveFileName(recordedId, conflict + 1);
        } catch (err) {
            return fileName;
        }
    }
}
