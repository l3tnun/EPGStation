import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import Reserve from '../../../db/entities/Reserve';
import DateUtil from '../../../util/DateUtil';
import FileUtil from '../../../util/FileUtil';
import StrUtil from '../../../util/StrUtil';
import IVideoUtil from '../../api/video/IVideoUtil';
import IChannelDB from '../../db/IChannelDB';
import IProgramDB from '../../db/IProgramDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IConfigFile, { RecordedDirInfo } from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IRecordingUtilModel, { RecFilePathInfo } from './IRecordingUtilModel';

@injectable()
export default class RecordingUtilModel implements IRecordingUtilModel {
    private log: ILogger;
    private config: IConfigFile;
    private channelDB: IChannelDB;
    private programDB: IProgramDB;
    private videoFileDB: IVideoFileDB;
    private videoUtil: IVideoUtil;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IProgramDB') programDB: IProgramDB,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.channelDB = channelDB;
        this.programDB = programDB;
        this.videoFileDB = videoFileDB;
        this.videoUtil = videoUtil;
    }

    /**
     * 保存先ディレクトリを取得する
     * @param reserve: Reserve
     * @param isEnableTmp: 一時保存ディレクトリを使用するか
     * @return Promise<RecFilePathInfo> 保存先ファイルパス
     */
    public async getRecPath(reserve: Reserve, isEnableTmp: boolean): Promise<RecFilePathInfo> {
        // 親ディレクトリ
        let parentDir: RecordedDirInfo | null = null;
        let subDir = ''; // サブディレクトリ

        if (isEnableTmp === true && typeof this.config.recordedTmp !== 'undefined') {
            // 一時ディレクトリに保存する
            parentDir = {
                name: 'tmp',
                path: this.config.recordedTmp,
            };
        } else {
            if (reserve.parentDirectoryName === null) {
                // 設定がない場合は recorded の戦闘に定義されている保存先を使用する
                parentDir = this.config.recorded[0];
            } else {
                for (const d of this.config.recorded) {
                    // parentDirectoryName に一致する親ディレクトリ設定を探す
                    if (d.name === reserve.parentDirectoryName) {
                        parentDir = d;
                        break;
                    }
                }
            }

            if (parentDir === null) {
                // 親ディレクトリが見つからなかった
                parentDir = this.config.recorded[0];
            }

            // サブディレクトリ
            subDir = reserve.directory === null ? '' : reserve.directory;
        }

        // 局名
        let channelName = reserve.channelId.toString(10); // 局名が取れなかったときのために id で一旦セットする
        let halfWidthChannelName = channelName;
        let sid = 'NULL';
        try {
            const channel = await this.channelDB.findId(reserve.channelId);
            if (channel !== null) {
                channelName = channel.name;
                halfWidthChannelName = channel.halfWidthName;
                sid = channel.serviceId.toString(10);
            }
        } catch (err) {
            this.log.system.warn(`channel name get error: ${reserve.channelId}`);
        }

        // 時刻指定予約時の番組名取得
        let programName = reserve.name;
        if (reserve.isTimeSpecified === true) {
            // 時刻指定予約なので番組情報を取得する
            const program = await this.programDB.findChannelIdAndTime(reserve.channelId, reserve.startAt);
            programName = program === null ? '番組名なし' : program.name;
        }

        // ファイル名
        let fileName = reserve.recordedFormat === null ? this.config.recordedFormat : reserve.recordedFormat;
        const jaDate = DateUtil.getJaDate(new Date(reserve.startAt));
        fileName = fileName
            .replace(/%YEAR%/g, DateUtil.format(jaDate, 'yyyy'))
            .replace(/%SHORTYEAR%/g, DateUtil.format(jaDate, 'YY'))
            .replace(/%MONTH%/g, DateUtil.format(jaDate, 'MM'))
            .replace(/%DAY%/g, DateUtil.format(jaDate, 'dd'))
            .replace(/%HOUR%/g, DateUtil.format(jaDate, 'hh'))
            .replace(/%MIN%/g, DateUtil.format(jaDate, 'mm'))
            .replace(/%SEC%/g, DateUtil.format(jaDate, 'ss'))
            .replace(/%DOW%/g, DateUtil.format(jaDate, 'w'))
            .replace(/%TYPE%/g, reserve.channelType)
            .replace(/%CHID%/g, reserve.channelId.toString(10))
            .replace(/%CHNAME%/g, channelName)
            .replace(/%HALF_WIDTH_CHNAME%/g, halfWidthChannelName)
            .replace(/%CH%/g, reserve.channel)
            .replace(/%SID%/g, sid)
            .replace(/%ID%/g, reserve.id.toString())
            .replace(/%TITLE%/g, programName === null ? 'NULL' : programName)
            .replace(/%HALF_WIDTH_TITLE%/g, reserve.halfWidthName === null ? 'NULL' : reserve.halfWidthName);

        // 使用禁止文字列置き換え
        fileName = StrUtil.replaceFileName(fileName);

        // ディレクトリ
        const dir = path.join(parentDir.path, subDir);

        // ディレクトリが存在するか確認
        try {
            await FileUtil.access(dir, fs.constants.R_OK | fs.constants.W_OK);
        } catch (err) {
            if (typeof err.code !== 'undefined' && err.code === 'ENOENT') {
                // ディレクトリが存在しないので作成する
                this.log.system.info(`mkdirp: ${dir}`);
                await FileUtil.mkdir(dir);
            } else {
                // アクセス権に Read or Write が無い
                this.log.system.fatal(`dir permission error: ${dir}`);
                this.log.system.fatal(err);
                throw err;
            }
        }

        const newFileName = await this.getFileName(parentDir.path, subDir, fileName, this.config.recordedFileExtension);

        return {
            parendDir: parentDir,
            subDir: subDir,
            fileName: newFileName,
            fullPath: path.join(parentDir.path, subDir, newFileName),
        };
    }

    /**
     * 録画ファイルの重複していないファイル名(拡張子付き)を取得
     * @param parentDir: dir path
     * @param subDir: dub dir
     * @param fileName: file name
     * @param extension: ファイル拡張子
     * @param conflict: 重複回数
     */
    private async getFileName(
        parentDir: string,
        subDir: string,
        fileName: string,
        extension: string,
        conflict: number = 0,
    ): Promise<string> {
        const conflictStr = conflict === 0 ? '' : `(${conflict})`;
        const newFileName = `${fileName}${conflictStr}${extension}`;
        const fileFullPath = path.join(parentDir, subDir, newFileName);

        try {
            await FileUtil.stat(fileFullPath);

            return this.getFileName(parentDir, subDir, fileName, extension, conflict + 1);
        } catch (err) {
            return newFileName;
        }
    }

    /**
     * recordedTmp にある video を移動する
     * @param reserve: Reserve
     * @param videoFileId: apid.VideoFileId
     * @return Promise<string> 移動先のファイルパスを返す
     */
    public async movingFromTmp(reserve: Reserve, videoFileId: apid.VideoFileId): Promise<string> {
        let videoFileFulPath = await this.videoUtil.getFullFilePathFromId(videoFileId);

        if (videoFileFulPath === null) {
            throw new Error('VideoFilePathIsNull');
        }

        if (typeof this.config.recordedTmp === 'undefined') {
            throw new Error('RecordedTmpIsUndefined');
        }

        // 本来の保存先を取得
        const newRecPath = await this.getRecPath(reserve, false);

        // recordedTmp から本来の保存先へコピー
        try {
            this.log.system.info(`move file: ${videoFileFulPath} -> ${newRecPath.fullPath}`);
            await FileUtil.copyFile(videoFileFulPath, newRecPath.fullPath);
        } catch (err) {
            this.log.system.error(`move file error: ${videoFileFulPath} -> ${newRecPath.fullPath}`);

            throw err;
        }

        // VideoFile DB 更新
        try {
            await this.videoFileDB.updateFilePath({
                videoFileId: videoFileId,
                parentDirectoryName: newRecPath.parendDir.name,
                filePath: path.join(newRecPath.subDir, newRecPath.fileName),
            });
        } catch (err) {
            this.log.system.error(`update VideoFileDB path error: ${videoFileId}`);
            this.log.system.error(err);

            try {
                await FileUtil.unlink(newRecPath.fullPath);
            } catch (e) {
                this.log.system.error(`delete new file error: ${newRecPath.fullPath}`);
                this.log.system.error(e);
                throw err;
            }
        }

        const oldVideoFilePath = videoFileFulPath;
        videoFileFulPath = newRecPath.fullPath;

        // recordedTmp にある古いファイルを削除する
        try {
            await FileUtil.unlink(oldVideoFilePath);
        } catch (err) {
            this.log.system.error(`delete old file error: ${newRecPath.fullPath}`);
            throw err;
        }

        return videoFileFulPath;
    }

    /**
     * 指定した videoFileId のファイルサイズを更新する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async updateVideoFileSize(videoFileId: apid.VideoFileId): Promise<void> {
        this.log.system.info(`update file size: ${videoFileId}`);

        const videoFileFulPath = await this.videoUtil.getFullFilePathFromId(videoFileId);
        if (videoFileFulPath === null) {
            throw new Error('VideoFilePathIsNull');
        }

        try {
            const fileSize = await FileUtil.getFileSize(videoFileFulPath);
            await this.videoFileDB.updateSize(videoFileId, fileSize);
        } catch (err) {
            this.log.system.error(`update file size error: ${videoFileId}`);
            this.log.system.error(err);
        }
    }
}
