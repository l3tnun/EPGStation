import { ChildProcess } from 'child_process';
import * as events from 'events';
import { inject, injectable } from 'inversify';
import { cloneDeep } from 'lodash';
import * as path from 'path';
import * as apid from '../../../../api';
import FileUtil from '../../../util/FileUtil';
import ProcessUtil from '../../../util/ProcessUtil';
import Util from '../../../util/Util';
import IVideoUtil, { VideoInfo } from '../../api/video/IVideoUtil';
import IRecordedDB from '../../db/IRecordedDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IEncodeEvent from '../../event/IEncodeEvent';
import IConfiguration from '../../IConfiguration';
import IExecutionManagementModel from '../../IExecutionManagementModel';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IEncodeManageModel, { EncodeQueueInfo, EncodeRecordedIdIndex } from './IEncodeManageModel';
import IEncodeProcessManageModel from './IEncodeProcessManageModel';

interface EncodeQueueItem extends apid.AddEncodeProgramOption {
    encodeId: apid.EncodeId;
}

interface RunningQueueItem {
    process: ChildProcess;
    encodeProgram: EncodeQueueItem;
    isCanceld: boolean; // cancel して停止されたか
    timerId: NodeJS.Timer; // エンコードタイムアウト
    percent?: number;
    log?: string;
}

@injectable()
class EncodeManageModel implements IEncodeManageModel {
    private log: ILogger;
    private configure: IConfiguration;
    private executeManagementModel: IExecutionManagementModel;
    private processManager: IEncodeProcessManageModel;
    private videoFileDB: IVideoFileDB;
    private recordedDB: IRecordedDB;
    private videoUtil: IVideoUtil;
    private encodeEvent: IEncodeEvent;
    private concurrentEncodeNum: number;
    private waitQueue: EncodeQueueItem[] = [];
    private runningQueue: RunningQueueItem[] = [];
    private usedFileNameIndex: { [name: string]: boolean } = {}; // 使用済みファイル名
    private idCnt: number = 1;

    private listener: events.EventEmitter = new events.EventEmitter();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configure: IConfiguration,
        @inject('IExecutionManagementModel') executeManagementModel: IExecutionManagementModel,
        @inject('IEncodeProcessManageModel') processManager: IEncodeProcessManageModel,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
        @inject('IEncodeEvent') encodeEvent: IEncodeEvent,
    ) {
        this.log = logger.getLogger();
        this.configure = configure;
        this.executeManagementModel = executeManagementModel;
        this.concurrentEncodeNum = configure.getConfig().concurrentEncodeNum;
        this.processManager = processManager;
        this.videoFileDB = videoFileDB;
        this.recordedDB = recordedDB;
        this.videoUtil = videoUtil;
        this.encodeEvent = encodeEvent;

        this.listener.on(EncodeManageModel.NEEDS_CHECK_QUEUE_EVENT, this.checkQueue.bind(this));
    }

    /**
     * エンコード情報を queue に積む
     * @param addOption: apid.AddEncodeProgramOption
     * @return apid.EncodeId
     */
    public async push(addOption: apid.AddEncodeProgramOption): Promise<apid.EncodeId> {
        if (this.concurrentEncodeNum <= 0) {
            throw new Error('CncurrentEncodeNumIsZero');
        }

        // 実行権取得
        const exeId = await this.executeManagementModel.getExecution(EncodeManageModel.ADD_ENCODE_PRIPORITY);

        // queue に積む item を生成する
        const queueItem: EncodeQueueItem = cloneDeep(addOption) as any;
        const encodeId = this.idCnt;
        queueItem.encodeId = encodeId;

        // idCnt をインクリメント
        if (this.idCnt === Number.MAX_SAFE_INTEGER) {
            this.idCnt = 0;
        }
        this.idCnt++;

        // queue に積む
        this.waitQueue.push(queueItem);
        this.emitNeedsCheckQueue();

        this.log.system.info(`add new encode: ${encodeId}`);

        // 実行権開放
        this.executeManagementModel.unLockExecution(exeId);

        // イベント発行
        this.encodeEvent.emitAddEncode(encodeId);

        return encodeId;
    }

    /**
     * queue の状態をチェックする必要がある場合に呼ぶ
     */
    private emitNeedsCheckQueue(): void {
        this.listener.emit(EncodeManageModel.NEEDS_CHECK_QUEUE_EVENT);
    }

    /**
     * queue をチャックする
     * @return Promise<void>
     */
    private async checkQueue(): Promise<void> {
        // runningQueue がロック中 or 同時エンコード最大数に達している or waitQueue が空の場合はスルー
        if (this.runningQueue.length >= this.concurrentEncodeNum || this.waitQueue.length === 0) {
            return;
        }

        // 実行権取得
        const exeId = await this.executeManagementModel.getExecution(
            EncodeManageModel.CREATE_ENCODING_PROCESS_PRIPORITY,
        );

        // waitQueue から取り出す
        let needsFinalize = false;
        const encodeProgram = this.waitQueue.shift();
        if (typeof encodeProgram !== 'undefined') {
            // エンコードプロセスを生成して runningQueue に積む
            try {
                await this.addQueue(encodeProgram);
            } catch (err) {
                this.log.system.error(`create encode process error: ${encodeProgram.encodeId}`);
                this.log.system.error(err);

                needsFinalize = true;

                // エラー通知
                this.encodeEvent.emitErrorEncode();
            }
        }

        // 実行権開放
        this.executeManagementModel.unLockExecution(exeId);

        if (needsFinalize === true && typeof encodeProgram !== 'undefined') {
            this.finalize(encodeProgram.encodeId);
        }
    }

    /**
     * エンコードプロセスを生成して runningQueue に積む
     * @param queueItem: EncodeQueueItem
     * @return Promise<ChildProcess>
     */
    private async addQueue(queueItem: EncodeQueueItem): Promise<void> {
        const video = await this.videoFileDB.findId(queueItem.sourceVideoFileId);
        if (video === null) {
            throw new Error('VideoFileIdIsNotFound');
        }

        // 番組情報を取得する
        const recorded = await this.recordedDB.findId(queueItem.recordedId);
        if (recorded === null) {
            throw new Error('RecordedIsNotFound');
        }

        // ソースビデオファイルのファイルパスを生成する
        const inputFilePath = await this.videoUtil.getFullFilePathFromId(queueItem.sourceVideoFileId);
        if (inputFilePath === null) {
            throw new Error('VideoPathIsNotFound');
        }

        // ソースビデオファイルの存在を確認
        try {
            await FileUtil.stat(inputFilePath);
        } catch (err) {
            this.log.system.error(`video file is not found: ${inputFilePath}`);
            throw err;
        }

        // エンコードコマンド設定を探す
        const encodeCmd = this.configure.getConfig().encode.find(enc => {
            return enc.name === queueItem.mode;
        });
        if (typeof encodeCmd === 'undefined') {
            throw new Error('EncodeCommandIsNotFound');
        }

        // 出力先ディレクトリパスを取得する
        const outputDirPath = typeof encodeCmd.suffix === 'undefined' ? null : this.getDirPath(queueItem);

        // 出力先ディレクトリの存在確認 & 作成
        if (outputDirPath !== null) {
            try {
                await FileUtil.stat(outputDirPath);
            } catch (e) {
                // ディレクトリが存在しなければ作成する
                this.log.system.info(`mkdirp: ${outputDirPath}`);
                await FileUtil.mkdir(outputDirPath);
            }
        }

        // 出力先をファイルパスを生成する
        const outputFilePath =
            outputDirPath === null || typeof encodeCmd.suffix === 'undefined'
                ? null
                : await this.getFilePath(outputDirPath, inputFilePath, encodeCmd.suffix);

        // 出力ファイルパスを使用済みファイル名として登録する
        if (outputFilePath !== null) {
            this.usedFileNameIndex[outputFilePath] = true;
        }

        // エンコード開始
        this.log.system.info(
            `encode start. mode: ${queueItem.mode} name: ${recorded.name} file: ${inputFilePath} -> ${outputFilePath}`,
        );

        const config = this.configure.getConfig();

        // プロセスの生成
        const childProcess = await this.processManager.create({
            input: inputFilePath,
            output: outputFilePath,
            cmd: encodeCmd.cmd,
            priority: EncodeManageModel.ENCODE_PRIPORITY,
            spawnOption: {
                env: {
                    PATH: process.env['PATH'],
                    RECORDEDID: recorded.id.toString(10),
                    INPUT: inputFilePath,
                    OUTPUT: outputFilePath === null ? '' : outputFilePath,
                    DIR: outputDirPath || '',
                    FFMPEG: config.ffmpeg,
                    FFPROBE: config.ffprobe,
                    NAME: recorded.name,
                    HALF_WIDTH_NAME: recorded.halfWidthName,
                    DESCRIPTION: recorded.description || '',
                    EXTENDED: recorded.extended || '',
                    VIDEOTYPE: recorded.videoType || '',
                    VIDEORESOLUTION: recorded.videoResolution || '',
                    VIDEOSTREAMCONTENT:
                        typeof recorded.videoStreamContent === 'number' ? recorded.videoStreamContent.toString(10) : '',
                    VIDEOCOMPONENTTYPE:
                        typeof recorded.videoComponentType === 'number' ? recorded.videoComponentType.toString(10) : '',
                    AUDIOSAMPLINGRATE:
                        typeof recorded.audioSamplingRate === 'number' ? recorded.audioSamplingRate.toString(10) : '',
                    AUDIOCOMPONENTTYPE:
                        typeof recorded.audioComponentType === 'number' ? recorded.audioComponentType.toString(10) : '',
                    CHANNELID: typeof recorded.channelId === 'number' ? recorded.channelId.toString(10) : '',
                    GENRE1: typeof recorded.genre1 === 'number' ? recorded.genre1.toString(10) : '',
                    SUBGENRE1: typeof recorded.subGenre1 === 'number' ? recorded.subGenre1.toString(10) : '',
                    GENRE2: typeof recorded.genre2 === 'number' ? recorded.genre2.toString(10) : '',
                    SUBGENRE2: typeof recorded.subGenre2 === 'number' ? recorded.subGenre2.toString(10) : '',
                    GENRE3: typeof recorded.genre3 === 'number' ? recorded.genre3.toString(10) : '',
                    SUBGENRE3: typeof recorded.subGenre3 === 'number' ? recorded.subGenre3.toString(10) : '',
                    // logPath: recorded.logPath,
                    // errorCnt: recorded.errorCnt,
                    // dropCnt: recorded.dropCnt,
                    // scramblingCnt: recorded.scramblingCnt,
                },
            },
        });

        // runningQueue に積む
        this.runningQueue.push({
            process: childProcess,
            encodeProgram: queueItem,
            isCanceld: false,
            timerId: setTimeout(async () => {
                this.log.system.error(`encode process is time out: ${queueItem.encodeId} ${outputFilePath}`);
                await this.cancel(queueItem.encodeId);
            }, recorded.duration * (typeof encodeCmd.rate === 'undefined' ? EncodeManageModel.DEFAULT_TIMEOUT_RATE : encodeCmd.rate)),
        });

        /**
         * プロセスの設定
         */
        // debug 用
        if (childProcess.stderr !== null) {
            childProcess.stderr.on('data', data => {
                this.log.system.debug(String(data));
            });
        }

        // 進捗情報更新用
        if (childProcess.stdout !== null) {
            let videoInfo: VideoInfo | null = null;
            try {
                videoInfo = await this.videoUtil.getInfo(inputFilePath);
            } catch (err) {
                this.log.system.error(`get encode vidoe file info: ${inputFilePath}`);
                this.log.system.error(err);
            }
            if (videoInfo !== null) {
                childProcess.stdout.on('data', data => {
                    try {
                        this.updateEncodingProgressInfo(data, queueItem.encodeId);
                    } catch (err) {
                        // error
                    }
                });
            }
        }

        // プロセス終了時に runningQueue からの削除 & emitNeedsCheckQueue() を実行する
        childProcess.on('exit', async (code, signal) => {
            // exit code
            this.log.system.info(`exit code: ${code}, signal: ${signal}`);

            // 使用済みファイル名から削除
            if (outputFilePath !== null) {
                delete this.usedFileNameIndex[outputFilePath];
            }

            let isError = true;
            const encodingQueueItem = this.getRunnginQueueItem(queueItem.encodeId);
            if (typeof encodingQueueItem === 'undefined') {
                this.log.system.fatal(`encode item is removed: ${queueItem.recordedId}`);
            } else if (encodingQueueItem.isCanceld === true) {
                // キャンセルされた
                this.log.system.info(`canceld encode: ${queueItem.encodeId}`);
            } else if (code !== 0) {
                // エンコードが正常終了しなかった
                this.log.system.error(`encode failed: ${queueItem.encodeId} ${outputFilePath}`);
            } else {
                // エンコード正常終了
                this.log.system.info(`Successfully encod: ${queueItem.encodeId} ${outputFilePath}`);

                isError = false;

                // 終了通知 DB に登録を依頼
                const fileName = outputFilePath === null ? null : path.basename(outputFilePath);
                this.log.system.info(
                    `rmOrg: ${queueItem.removeOriginal}, hasSam: ${this.hasSamVideoFileIdItem(
                        queueItem.sourceVideoFileId,
                        queueItem.encodeId,
                    )}`,
                );
                if (
                    queueItem.removeOriginal === true &&
                    this.hasSamVideoFileIdItem(queueItem.sourceVideoFileId, queueItem.encodeId) === true
                ) {
                    // queue に削除予定の videofile が存在するので、削除しないように false にする
                    queueItem.removeOriginal = false;
                }

                this.encodeEvent.emitFinishEncode({
                    recordedId: queueItem.recordedId,
                    videoFileId: queueItem.sourceVideoFileId,
                    parentDirName: queueItem.parentDir,
                    filePath:
                        outputFilePath === null || fileName === null
                            ? null
                            : typeof queueItem.directory === 'undefined'
                            ? fileName
                            : path.join(queueItem.directory, fileName),
                    fullOutputPath: outputFilePath,
                    mode: queueItem.mode,
                    removeOriginal: queueItem.removeOriginal,
                });
            }

            if (isError === true) {
                // 出力ファイルを削除
                if (outputFilePath !== null) {
                    this.log.system.info(`delete encode output file: ${outputFilePath}`);
                    await Util.sleep(1000);

                    await FileUtil.unlink(outputFilePath).catch(err => {
                        this.log.system.error(`delete encode output file failed: ${outputFilePath}`);
                        this.log.system.error(err);
                    });
                }

                // エラー通知
                this.encodeEvent.emitErrorEncode();
            }

            this.finalize(queueItem.encodeId);
        });
    }

    /**
     * エンコード進捗情報更新
     * @param data: エンコードプロセスの標準出力
     * @param encodeId: apid.EncodeId
     */
    private updateEncodingProgressInfo(data: any, encodeId: apid.EncodeId): void {
        const logs = String(data).split('\n');
        for (let j = 0; j < logs.length; j++) {
            if (logs[j] != '') {
                const log = JSON.parse(String(logs[j]));
                this.log.system.info(log);
                if (log.type == 'progress') {
                    const encodingQueueItem = this.getRunnginQueueItem(encodeId);
                    if (encodingQueueItem != null) {
                        encodingQueueItem.percent = log.percent;
                        encodingQueueItem.log = log.log;

                        // エンコード進捗変更通知
                        this.encodeEvent.emitUpdateEncodeProgress();
                    }
                }
            }
        }
    }

    /**
     * queueItem で指定された dir パスを取得する
     * @param queueItem: EncodeQueueItem
     * @return string
     */
    private getDirPath(queueItem: EncodeQueueItem): string {
        const parentDir = this.videoUtil.getParentDirPath(queueItem.parentDir);
        if (parentDir === null) {
            this.log.system.error(`parent dir config is not found: ${queueItem.parentDir}`);
            throw new Error('parentDirIsNotFound');
        }

        return typeof queueItem.directory === 'undefined' ? parentDir : path.join(parentDir, queueItem.directory);
    }

    /**
     * 出力ファイル名を返す
     * @param outputDirPath: string 出力先ディレクトリ
     * @param inputFilePath: string 入力ファイルパス
     * @param suffix: 拡張子
     */
    private async getFilePath(outputDirPath: string, inputFilePath: string, suffix: string): Promise<string> {
        const basefileName = path.basename(inputFilePath, path.extname(inputFilePath));

        let result: string | null = null;
        let conflict = 0;
        while (1) {
            // ファイル名生成
            let fileName = basefileName;
            if (conflict > 0) {
                fileName += `(${conflict.toString(10)})`;
            }
            fileName += suffix;

            result = path.join(outputDirPath, fileName);

            // 使用済みファイル名に一致するか
            if (typeof this.usedFileNameIndex[result] !== 'undefined') {
                conflict++;
                continue;
            }

            // 同名ファイルがすでに存在するか
            try {
                await FileUtil.stat(result);
                conflict++;
            } catch (e) {
                // 同名ファイルがすでに存在しなかった
                break;
            }
        }

        if (result === null) {
            throw new Error('GetFilePathError');
        }

        return result;
    }

    /**
     * 指定した encodeId を runningQueue から取り出す
     * @param encodeId: apid.EncodeId
     * @return RunningQueueItem | undefined
     */
    private getRunnginQueueItem(encodeId: apid.EncodeId): RunningQueueItem | undefined {
        return this.runningQueue.find(q => {
            return q.encodeProgram.encodeId === encodeId;
        });
    }

    /**
     * videoFileId で指定した video file id を持つ queue item が存在するか調べる
     * @param videoFileId: apid.VideoFileId
     * @param excludeEncodeId: apid.EncodeId 除外する encode id
     * @return boolean 存在するなら true を返す
     */
    private hasSamVideoFileIdItem(videoFileId: apid.VideoFileId, excludeEncodeId: apid.EncodeId): boolean {
        const runningItem = this.runningQueue.find(q => {
            return q.encodeProgram.sourceVideoFileId === videoFileId && q.encodeProgram.encodeId !== excludeEncodeId;
        });
        if (typeof runningItem !== 'undefined') {
            return true;
        }

        const waitItem = this.waitQueue.find(q => {
            return q.sourceVideoFileId === videoFileId && q.encodeId !== excludeEncodeId;
        });
        if (typeof waitItem !== 'undefined') {
            return true;
        }

        return false;
    }

    /**
     * 最終処理
     * @param encodeId: apid.EncodeId
     */
    private async finalize(encodeId: apid.EncodeId): Promise<void> {
        // 実行権取得
        const exeId = await this.executeManagementModel.getExecution(EncodeManageModel.CLEAR_QUEUE_PRIPORITY);

        const queueItem = this.getRunnginQueueItem(encodeId);
        if (typeof queueItem !== 'undefined') {
            // タイムアウトタイマー停止
            clearTimeout(queueItem.timerId);
        }

        // runningQueue から encodeId の要素を削除する
        this.runningQueue = this.runningQueue.filter(q => {
            return q.encodeProgram.encodeId !== encodeId;
        });

        // 実行権開放
        this.executeManagementModel.unLockExecution(exeId);

        process.nextTick(() => {
            this.emitNeedsCheckQueue();
        });
    }

    /**
     * 指定された encode id を queue から削除する
     * @param encodeId: apid.EncodeId
     */
    public async cancel(encodeId: apid.EncodeId): Promise<void> {
        // 実行権取得
        const exeId = await this.executeManagementModel.getExecution(EncodeManageModel.CANCEL_ENCODE_PRIPORITY);

        this.log.system.info(`cancel encode: ${encodeId}`);

        // runningQueue にあるので プロセスを殺す
        const runningQueueItem = this.getRunnginQueueItem(encodeId);
        if (typeof runningQueueItem !== 'undefined') {
            runningQueueItem.isCanceld = true;
            await ProcessUtil.kill(runningQueueItem.process).catch(err => {
                this.log.system.error(`kill encode process failed: ${encodeId}`);
                this.log.system.error(err);
            });
        } else {
            // waitQueue から削除
            this.waitQueue = this.waitQueue.filter(q => {
                return q.encodeId !== encodeId;
            });

            process.nextTick(() => {
                this.emitNeedsCheckQueue();
            });
        }

        this.executeManagementModel.unLockExecution(exeId);

        // イベント発行
        this.encodeEvent.emitCancelEncode(encodeId);
    }

    /**
     * queu に積まれている要素の recorded id の索引を返す
     */
    public getRecordedIndex(): EncodeRecordedIdIndex {
        const index: EncodeRecordedIdIndex = {};

        for (const item of this.runningQueue) {
            if (typeof index[item.encodeProgram.recordedId] === 'undefined') {
                index[item.encodeProgram.recordedId] = [];
            }
            index[item.encodeProgram.recordedId].push({
                encodeId: item.encodeProgram.encodeId,
                name: item.encodeProgram.mode,
            });
        }

        for (const item of this.waitQueue) {
            if (typeof index[item.recordedId] === 'undefined') {
                index[item.recordedId] = [];
            }
            index[item.recordedId].push({
                encodeId: item.encodeId,
                name: item.mode,
            });
        }

        return index;
    }

    /**
     * 指定した recordedId を持つエンコードをキャンセルする
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async cancelEncodeByRecordedId(recordedId: apid.RecordedId): Promise<void> {
        const encodeIds: apid.EncodeId[] = [];

        // recordedId に該当する encodedId を取り出す
        for (const item of this.waitQueue) {
            if (item.recordedId === recordedId) {
                encodeIds.push(item.encodeId);
            }
        }
        for (const item of this.runningQueue) {
            if (item.encodeProgram.recordedId === recordedId) {
                encodeIds.push(item.encodeProgram.encodeId);
            }
        }

        // 取り出した encodedId を元にキャンセル指示を出す
        let isError = false;
        for (const encodeId of encodeIds) {
            await this.cancel(encodeId).catch(err => {
                isError = true;
                this.log.system.error(`cancel encode failed: ${encodeId}`);
                this.log.system.error(err);
            });
        }

        // キャンセルに失敗した場合はエラーを履く
        if (isError !== false) {
            throw new Error('StopEncodeError');
        }
    }

    /**
     * queue に積まれているエンコード情報を返す
     * @return EncodeQueueInfo
     */
    public getEncodeInfo(): EncodeQueueInfo {
        const queueInfo: EncodeQueueInfo = {
            runningQueue: [],
            waitQueue: [],
        };

        if (this.runningQueue.length > 0) {
            queueInfo.runningQueue = this.runningQueue.map(i => {
                return {
                    id: i.encodeProgram.encodeId,
                    mode: i.encodeProgram.mode,
                    recordedId: i.encodeProgram.recordedId,
                    percent: i.percent,
                    log: i.log,
                };
            });
        }

        if (this.waitQueue.length > 0) {
            queueInfo.waitQueue = this.waitQueue.map(i => {
                return {
                    id: i.encodeId,
                    mode: i.mode,
                    recordedId: i.recordedId,
                };
            });
        }

        return queueInfo;
    }
}

namespace EncodeManageModel {
    export const UNLOCK_EVENT = 'unlockEvent';
    export const UNLOCK_TIMEOUT = 1000 * 60;
    export const CANCEL_ENCODE_PRIPORITY = 1;
    export const ADD_ENCODE_PRIPORITY = 2;
    export const CREATE_ENCODING_PROCESS_PRIPORITY = 2;
    export const CLEAR_QUEUE_PRIPORITY = 3;
    export const NEEDS_CHECK_QUEUE_EVENT = 'needsCheckQueue';
    export const ENCODE_PRIPORITY = 10;
    export const DEFAULT_TIMEOUT_RATE = 4.0;
}

export default EncodeManageModel;
