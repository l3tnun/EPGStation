import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import type * as apid from '../../../../api.js';
import Reserve from '../../../db/entities/Reserve.js';
import Recorded from '../../../db/entities/Recorded.js';
import DateUtil from '../../../util/DateUtil.js';
import FileUtil from '../../../util/FileUtil.js';
import StrUtil from '../../../util/StrUtil.js';
import { isSubDirectoryInsideRoot } from '../../../util/SubDirectoryUtil.js';
import IVideoUtil from '../../api/video/IVideoUtil.js';
import IChannelDB from '../../db/IChannelDB.js';
import IProgramDB from '../../db/IProgramDB.js';
import IVideoFileDB from '../../db/IVideoFileDB.js';
import IConfigFile, { RecordedDirInfo } from '../../IConfigFile.js';
import IConfiguration from '../../IConfiguration.js';
import IExecutionManagementModel from '../../IExecutionManagementModel.js';
import ILogger from '../../ILogger.js';
import ILoggerModel from '../../ILoggerModel.js';
import IRecordingUtilModel, { RecFilePathInfo } from './IRecordingUtilModel.js';

/**
 * `getRecPath` の排他制御区間が `GET_REC_PATH_OWNER_TIMEOUT` を超過した場合に投げられるエラー。
 * タイムアウト後も内部の `_getRecPath` は実行され続けるため、`terminal` にはその遅延実行が
 * 完了し（ロック解放・後片付けまで終わり）安全に後続処理へ進めるようになったことを示す
 * Promise を保持する（`RecorderModel.handlePathSelectionOverdue` 参照）。
 */
export class PathSelectionOverdueError extends Error {
    public readonly terminal: Promise<void>;

    constructor(terminal: Promise<void>) {
        super();
        this.name = 'PathSelectionOverdueError';
        this.terminal = terminal;
    }
}

/**
 * `error` が `PathSelectionOverdueError` かどうかを判定する type guard。
 * `name` の一致だけでなく `terminal` が thenable であることも確認し、たまたま同じ `name` を
 * 持つだけの無関係な `Error` を overdue 扱いしてしまわないようにしている。
 * @param error 判定対象の値
 * @returns `PathSelectionOverdueError` であれば `true`
 */
export const isPathSelectionOverdueError = (error: unknown): error is PathSelectionOverdueError => {
    if (!(error instanceof Error) || error.name !== 'PathSelectionOverdueError') return false;
    const terminal = (error as unknown as { terminal?: { then?: unknown } }).terminal;
    return terminal !== undefined && typeof terminal.then === 'function';
};

/**
 * `formatFilePathString` の入力が予約かどうかを判定する。
 * 録画の経路は予約を `Object.freeze({ ...reservation })` で写した plain object として渡すため、
 * `instanceof Reserve` では予約を録画済みと取り違える。`isTimeSpecified` は `Reserve` だけが持ち、
 * `Recorded` には無い field なので、これで分ける。
 */
const isReserveSource = (src: Recorded | Reserve): src is Reserve => 'isTimeSpecified' in src;

/** `IRecordingUtilModel` の実装。詳細は `IRecordingUtilModel` を参照。 */
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
    public async getRecPath(
        reserve: Reserve,
        isEnableTmp: boolean,
        isReserveFile: boolean = false,
    ): Promise<RecFilePathInfo> {
        const exeId = await this.executeManagementModel.getExecution(
            RecordingUtilModel.GET_REC_PATH_PRIORITY,
            RecordingUtilModel.GET_REC_PATH_LOCK_TIMEOUT,
        );

        return new Promise<RecFilePathInfo>((resolve, reject) => {
            let isOverdue = false;
            let resolveTerminal!: () => void;
            const terminal = new Promise<void>(resolveTerminalCallback => {
                resolveTerminal = resolveTerminalCallback;
            });
            const watchdog = setTimeout(() => {
                isOverdue = true;
                reject(new PathSelectionOverdueError(terminal));
            }, RecordingUtilModel.GET_REC_PATH_OWNER_TIMEOUT);
            watchdog.unref();
            const completeLateFailure = (): void => {
                this.executeManagementModel.unLockExecution(exeId);
                resolveTerminal();
            };
            const completeLateSelection = async (result: RecFilePathInfo): Promise<void> => {
                await this.cleanupOverdueRecPath(result);
                completeLateFailure();
            };
            const settle = (onTime: () => void, late: () => void): void => {
                clearTimeout(watchdog);
                if (isOverdue) {
                    late();
                    return;
                }
                this.executeManagementModel.unLockExecution(exeId);
                onTime();
            };

            void this._getRecPath(reserve, isEnableTmp, isReserveFile).then(
                result =>
                    settle(
                        () => resolve(result),
                        () => void completeLateSelection(result),
                    ),
                error => settle(() => reject(error), completeLateFailure),
            );
        });
    }

    private async cleanupOverdueRecPath(recPath: RecFilePathInfo): Promise<void> {
        const fileHandle = recPath.fileHandle;
        if (fileHandle === undefined) return;
        await fileHandle.close().catch(error => {
            this.log.system.error(`close overdue recFile error: ${recPath.fullPath}`);
            this.log.system.error(error);
        });
        await FileUtil.unlink(recPath.fullPath).catch(error => {
            this.log.system.error(`delete overdue recFile error: ${recPath.fullPath}`);
            this.log.system.error(error);
        });
    }

    /**
     * 保存先ディレクトリを取得する
     * @param reserve: Reserve
     * @param isEnableTmp: 一時保存ディレクトリを使用するか
     * @return Promise<RecFilePathInfo> 保存先ファイルパス
     */
    private async _getRecPath(
        reserve: Reserve,
        isEnableTmp: boolean,
        isReserveFile: boolean,
    ): Promise<RecFilePathInfo> {
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

            // 保存先の外を指すサブディレクトリは使わず、親ディレクトリの直下に保存する
            if (isSubDirectoryInsideRoot(subDir) === false) {
                this.log.system.warn(
                    `sub directory is outside the recorded directory, save directly under it. reserveId: ${reserve.id} directory: ${subDir}`,
                );
                subDir = '';
            }
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

        if (isReserveFile === true) {
            for (let conflict = 0; ; conflict += 1) {
                const newFileName = this.getConflictFileName(fileName, this.config.recordedFileExtension, conflict);
                const fullPath = path.join(parentDir.path, subDir, newFileName);
                let fileHandle: fs.promises.FileHandle;
                try {
                    fileHandle = await fs.promises.open(fullPath, 'wx');
                } catch (err: any) {
                    if (err?.code === 'EEXIST') continue;
                    throw err;
                }
                return {
                    parendDir: parentDir,
                    subDir,
                    fileName: newFileName,
                    fullPath,
                    fileHandle,
                };
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
        const newFileName = this.getConflictFileName(fileName, extension, conflict);
        const fileFullPath = path.join(parentDir, subDir, newFileName);

        try {
            await FileUtil.stat(fileFullPath);

            return this.getFileName(parentDir, subDir, fileName, extension, conflict + 1);
        } catch (err: any) {
            return newFileName;
        }
    }

    private getConflictFileName(fileName: string, extension: string, conflict: number): string {
        const conflictStr = conflict === 0 ? '' : `(${conflict})`;
        return `${fileName}${conflictStr}${extension}`;
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
        const newRecPath = await this.getRecPath(reserve, false, true);
        const destinationReservation = newRecPath.fileHandle;
        if (destinationReservation === undefined) {
            throw new Error('ReservedFileHandleIsUndefined');
        }
        let isDestinationReservationClosed = false;
        const closeDestinationReservation = async (): Promise<void> => {
            if (isDestinationReservationClosed === true) return;
            await destinationReservation.close();
            isDestinationReservationClosed = true;
        };
        let isMoveCompleted: boolean;
        let finalCloseError: Error | undefined;

        try {
            try {
                await destinationReservation.stat();
            } catch (error) {
                await closeDestinationReservation().catch(closeError => {
                    this.log.system.error(`close reserved file error: ${newRecPath.fullPath}`);
                    this.log.system.error(closeError);
                });
                throw error;
            }

            // rename で移動可能か試す
            let isSuccessRenameFile = false;
            this.log.system.info(`move file: ${oldVideoFilePath} -> ${newRecPath.fullPath}`);
            try {
                await fs.promises.rename(oldVideoFilePath, newRecPath.fullPath);
                isSuccessRenameFile = true;
            } catch (err: any) {
                this.log.system.debug(`rename file error: ${oldVideoFilePath} -> ${newRecPath.fullPath}`);
                this.log.system.debug(err);
            }

            // rename で移動できなかった場合はコピーrecordedTmp から本来の保存先へコピー
            if (isSuccessRenameFile === false) {
                try {
                    await this.copyFileToReservation(oldVideoFilePath, destinationReservation);
                } catch (err: any) {
                    this.log.system.error(`copy file error: ${oldVideoFilePath} -> ${newRecPath.fullPath}`);
                    await closeDestinationReservation().catch(error => {
                        this.log.system.error(`close reserved file error: ${newRecPath.fullPath}`);
                        this.log.system.error(error);
                    });
                    await FileUtil.unlink(newRecPath.fullPath).catch(error => {
                        this.log.system.error(`delete copied file error: ${newRecPath.fullPath}`);
                        this.log.system.error(error);
                    });

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
                        await closeDestinationReservation();
                        await fs.promises.rename(newRecPath.fullPath, oldVideoFilePath);
                    } catch (e: any) {
                        this.log.system.error(
                            `rollback renamed file error: ${newRecPath.fullPath} -> ${oldVideoFilePath}`,
                        );
                        this.log.system.error(e);
                        throw err;
                    }
                } else {
                    // コピーしたファイルを削除する
                    this.log.system.info(`delete copied file: ${newRecPath.fullPath}`);
                    try {
                        await closeDestinationReservation();
                        await FileUtil.unlink(newRecPath.fullPath);
                    } catch (e: any) {
                        this.log.system.error(`delete copied file error: ${newRecPath.fullPath}`);
                        this.log.system.error(e);
                        throw err;
                    }
                }
                throw err;
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

            isMoveCompleted = true;
        } finally {
            await closeDestinationReservation().catch((error: Error) => {
                this.log.system.error(`close reserved file error: ${newRecPath.fullPath}`);
                this.log.system.error(error);
                finalCloseError = error;
            });
        }
        if (isMoveCompleted === true && finalCloseError !== undefined) throw finalCloseError;
        return newRecPath.fullPath;
    }

    private async copyFileToReservation(sourcePath: string, destination: fs.promises.FileHandle): Promise<void> {
        const source = await fs.promises.open(sourcePath, 'r');
        const buffer = Buffer.allocUnsafe(64 * 1024);
        let position = 0;
        try {
            await destination.truncate(0);
            for (;;) {
                const { bytesRead } = await source.read(buffer, 0, buffer.length, position);
                if (bytesRead === 0) return;
                let offset = 0;
                while (offset < bytesRead) {
                    const { bytesWritten } = await destination.write(
                        buffer,
                        offset,
                        bytesRead - offset,
                        position + offset,
                    );
                    if (bytesWritten === 0) throw new Error('ReservationWriteFailed');
                    offset += bytesWritten;
                }
                position += bytesRead;
            }
        } finally {
            await source.close();
        }
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

    public async formatFilePathString(format: string, src: Recorded | Reserve): Promise<string> {
        let id: string;
        let programName: string = src.name;
        let channelType: string = 'NULL';
        let channel: string = 'NULL';
        if (isReserveSource(src)) {
            // Reserve
            id = src.id.toString(10);
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
            id = src.reserveId?.toString(10) || 'NULL';
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
    export const GET_REC_PATH_OWNER_TIMEOUT = 600 * 1000;
    export const GET_REC_PATH_PRIORITY = 1;
}

export default RecordingUtilModel;
