import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import Reserve from '../../../db/entities/Reserve';
import Recorded from '../../../db/entities/Recorded';
import DateUtil from '../../../util/DateUtil';
import FileUtil from '../../../util/FileUtil';
import StrUtil from '../../../util/StrUtil';
import IVideoUtil from '../../api/video/IVideoUtil';
import IChannelDB from '../../db/IChannelDB';
import IProgramDB from '../../db/IProgramDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IConfigFile, { RecordedDirInfo } from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import IExecutionManagementModel from '../../IExecutionManagementModel';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IRecordingUtilModel, { RecFilePathInfo } from './IRecordingUtilModel';

@injectable()
class RecordingUtilModel implements IRecordingUtilModel {
    private log: ILogger;
    private config: IConfigFile;
    private executeManagementModel: IExecutionManagementModel;
    private channelDB: IChannelDB;
    private programDB: IProgramDB;
    private videoFileDB: IVideoFileDB;
    private videoUtil: IVideoUtil;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IExecutionManagementModel') executeManagementModel: IExecutionManagementModel,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IProgramDB') programDB: IProgramDB,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.executeManagementModel = executeManagementModel;
        this.channelDB = channelDB;
        this.programDB = programDB;
        this.videoFileDB = videoFileDB;
        this.videoUtil = videoUtil;
    }

    /**
     * 保存先ディレクトリを取得する
     * _getRecPath 関数をラップして排他制御する
     *
     * @param reserve: Reserve
     * @param isEnableTmp: 一時保存ディレクトリを使用するか
     * @return Promise<RecFilePathInfo> 保存先ファイルパス
     */
    public async getRecPath(reserve: Reserve, isEnableTmp: boolean): Promise<RecFilePathInfo> {
        // ロック取得
        const exeId = await this.executeManagementModel.getExecution(
            RecordingUtilModel.GET_REC_PATH_PRIORITY,
            RecordingUtilModel.GET_REC_PATH_LOCK_TIMEOUT,
        );

        return await this._getRecPath(reserve, isEnableTmp).finally(() => {
            // 必ずロックを開放するようにする
            this.executeManagementModel.unLockExecution(exeId);
        });
    }

    /**
     * 保存先ディレクトリを取得する
     * @param reserve: Reserve
     * @param isEnableTmp: 一時保存ディレクトリを使用するか
     * @return Promise<RecFilePathInfo> 保存先ファイルパス
     */
    private async _getRecPath(reserve: Reserve, isEnableTmp: boolean): Promise<RecFilePathInfo> {
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

        // ファイル名
        let fileName = reserve.recordedFormat === null ? this.config.recordedFormat : reserve.recordedFormat;
        fileName = await this.formatFilePathString(fileName, reserve);

        // 使用禁止文字列置き換え
        fileName = StrUtil.replaceFileName(fileName);

        // サブディレクトリ
        if (subDir.length > 0) {
            subDir = await this.formatFilePathString(subDir, reserve);
        }

        // ディレクトリ
        const dir = path.join(parentDir.path, subDir);

        // ディレクトリが存在するか確認
        try {
            await FileUtil.access(dir, fs.constants.R_OK | fs.constants.W_OK);
        } catch (err: any) {
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
        } catch (err: any) {
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
        const oldVideoFilePath = await this.videoUtil.getFullFilePathFromId(videoFileId);

        if (oldVideoFilePath === null) {
            throw new Error('VideoFilePathIsNull');
        }

        if (typeof this.config.recordedTmp === 'undefined') {
            throw new Error('RecordedTmpIsUndefined');
        }

        // 本来の保存先を取得
        const newRecPath = await this.getRecPath(reserve, false);

        // rename で移動可能か試す
        let isSuccessRenameFile = false;
        this.log.system.info(`move file: ${oldVideoFilePath} -> ${newRecPath.fullPath}`);
        try {
            await FileUtil.rename(oldVideoFilePath, newRecPath.fullPath);
            isSuccessRenameFile = true;
        } catch (err: any) {
            this.log.system.debug(`rename file error: ${oldVideoFilePath} -> ${newRecPath.fullPath}`);
            this.log.system.debug(err);
        }

        // rename で移動できなかった場合はコピーrecordedTmp から本来の保存先へコピー
        if (isSuccessRenameFile === false) {
            try {
                await FileUtil.copyFile(oldVideoFilePath, newRecPath.fullPath);
            } catch (err: any) {
                this.log.system.error(`copy file error: ${oldVideoFilePath} -> ${newRecPath.fullPath}`);

                throw err;
            }
        }

        // VideoFile DB 更新
        try {
            await this.videoFileDB.updateFilePath({
                videoFileId: videoFileId,
                parentDirectoryName: newRecPath.parendDir.name,
                filePath: path.join(newRecPath.subDir, newRecPath.fileName),
            });
        } catch (err: any) {
            // DB 更新失敗
            this.log.system.error(`update VideoFileDB path error: ${videoFileId}`);
            this.log.system.error(err);

            if (isSuccessRenameFile === true) {
                // rename したファイルを元に戻す
                this.log.system.info(`rollback renamed file: ${newRecPath.fullPath} -> ${oldVideoFilePath}`);
                try {
                    await FileUtil.rename(newRecPath.fullPath, oldVideoFilePath);
                } catch (e: any) {
                    this.log.system.error(`rollback renamed file error: ${newRecPath.fullPath} -> ${oldVideoFilePath}`);
                    this.log.system.error(e);
                    throw err;
                }
            } else {
                // コピーしたファイルを削除する
                this.log.system.info(`delete copied file: ${newRecPath.fullPath}`);
                try {
                    await FileUtil.unlink(newRecPath.fullPath);
                } catch (e: any) {
                    this.log.system.error(`delete copied file error: ${newRecPath.fullPath}`);
                    this.log.system.error(e);
                    throw err;
                }
            }
        }

        // rename で移動できなかった場合は recordedTmp にある古いファイルを削除する
        if (isSuccessRenameFile === false) {
            this.log.system.info(`delete old file: ${oldVideoFilePath}`);
            try {
                await FileUtil.unlink(oldVideoFilePath);
            } catch (err: any) {
                this.log.system.error(`delete old file error: ${oldVideoFilePath}`);
                throw err;
            }
        }

        return newRecPath.fullPath;
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
        } catch (err: any) {
            this.log.system.error(`update file size error: ${videoFileId}`);
            this.log.system.error(err);
        }
    }

    public async formatFilePathString(format: string | null | undefined, src: Recorded | Reserve): Promise<string> {
        if (format == null) {
            return '';
        }
        let id: string;
        let programName: string = src.name;
        let channelType: string = 'NULL';
        let channel: string = 'NULL';
        if (src instanceof Reserve) {
            // Reserve
            id = src.id.toString();
            channelType = src.channelType;
            channel = src.channel;
            // 時刻指定予約時の番組名取得
            if (src.isTimeSpecified === true) {
                // 時刻指定予約なので番組情報を取得する
                const program = await this.programDB.findChannelIdAndTime(src.channelId, src.startAt);
                programName = program === null ? '番組名なし' : program.name;
            }
        } else {
            // Recorded
            id = src.reserveId?.toString() || 'NULL';
        }

        // 局名
        let channelName = src.channelId.toString(10); // 局名が取れなかったときのために id で一旦セットする
        let halfWidthChannelName = channelName;
        let sid = 'NULL';
        try {
            const ch = await this.channelDB.findId(src.channelId);
            if (ch !== null) {
                channelName = ch.name;
                halfWidthChannelName = ch.halfWidthName;
                sid = ch.serviceId.toString(10);
                channelType = ch.channelType;
                channel = ch.channel;
            }
        } catch (err: any) {
            this.log.system.warn(`channel name get error: ${src.channelId}`);
        }
        const jaDate = DateUtil.getJaDate(new Date(src.startAt));

        return format
            .replace(/%YEAR%/g, DateUtil.format(jaDate, 'yyyy'))
            .replace(/%SHORTYEAR%/g, DateUtil.format(jaDate, 'YY'))
            .replace(/%MONTH%/g, DateUtil.format(jaDate, 'MM'))
            .replace(/%DAY%/g, DateUtil.format(jaDate, 'dd'))
            .replace(/%HOUR%/g, DateUtil.format(jaDate, 'hh'))
            .replace(/%MIN%/g, DateUtil.format(jaDate, 'mm'))
            .replace(/%SEC%/g, DateUtil.format(jaDate, 'ss'))
            .replace(/%DOW%/g, DateUtil.format(jaDate, 'w'))
            .replace(/%TYPE%/g, channelType)
            .replace(/%CHID%/g, src.channelId?.toString(10) || 'NULL')
            .replace(/%CHNAME%/g, channelName)
            .replace(/%HALF_WIDTH_CHNAME%/g, halfWidthChannelName)
            .replace(/%CH%/g, channel)
            .replace(/%SID%/g, sid)
            .replace(/%ID%/g, id.toString())
            .replace(/%TITLE%/g, programName === null ? 'NULL' : programName)
            .replace(/%HALF_WIDTH_TITLE%/g, src.halfWidthName === null ? 'NULL' : src.halfWidthName);
    }
}

namespace RecordingUtilModel {
    export const GET_REC_PATH_LOCK_TIMEOUT = 5.0 * 1000;
    export const GET_REC_PATH_PRIORITY = 1;
}

export default RecordingUtilModel;
