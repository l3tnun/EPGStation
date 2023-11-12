import { ChildProcess } from 'child_process';
import * as events from 'events';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import FileUtil from '../../../util/FileUtil';
import ProcessUtil from '../../../util/ProcessUtil';
import Util from '../../../util/Util';
import IVideoUtil, { VideoInfo } from '../../api/video/IVideoUtil';
import IChannelDB from '../../db/IChannelDB';
import IRecordedDB from '../../db/IRecordedDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IEncodeEvent from '../../event/IEncodeEvent';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IEncodeFileManageModel from './IEncodeFileManageModel';
import IEncodeProcessManageModel from './IEncodeProcessManageModel';
import { EncodeOption, EncodeProgressInfo, IEncoderModel } from './IEncoderModel';
import IRecordingUtilModel from '../../operator/recording/IRecordingUtilModel';

@injectable()
class EncoderModel implements IEncoderModel {
    private log: ILogger;
    private configure: IConfiguration;
    private processManager: IEncodeProcessManageModel;
    private fileManager: IEncodeFileManageModel;
    private videoFileDB: IVideoFileDB;
    private recordedDB: IRecordedDB;
    private channelDB: IChannelDB;
    private videoUtil: IVideoUtil;
    private encodeEvent: IEncodeEvent;
    private recodingUtil: IRecordingUtilModel;

    private listener: events.EventEmitter = new events.EventEmitter();

    private encodeOption: EncodeOption | null = null; // エンコード情報
    private childProcess: ChildProcess | null = null; // エンコードプロセス
    private timerId: NodeJS.Timer | null = null; // タイムアウト検知用タイマーid
    private isCanceld: boolean = false; // キャンセルが呼び出されたか?
    private progressInfo: EncodeProgressInfo | null = null;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configure: IConfiguration,
        @inject('IEncodeProcessManageModel') processManager: IEncodeProcessManageModel,
        @inject('IEncodeFileManageModel') fileManager: IEncodeFileManageModel,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
        @inject('IEncodeEvent') encodeEvent: IEncodeEvent,
        @inject('IRecordingUtilModel') recodingUtil: IRecordingUtilModel,
    ) {
        this.log = logger.getLogger();
        this.configure = configure;
        this.processManager = processManager;
        this.fileManager = fileManager;
        this.videoFileDB = videoFileDB;
        this.recordedDB = recordedDB;
        this.channelDB = channelDB;
        this.videoUtil = videoUtil;
        this.encodeEvent = encodeEvent;
        this.recodingUtil = recodingUtil;
    }

    /**
     * エンコードに必要な設定をセットする
     * @param encodeOption: EncodeOption
     */
    public setOption(encodeOption: EncodeOption): void {
        if (this.encodeOption !== null) {
            this.log.encode.error('encodeOption is not null');
            throw new Error('EncodeSetOptionError');
        }

        this.encodeOption = encodeOption;
    }

    /**
     * エンコード終了イベント登録
     * @param callback
     */
    public setOnFinish(callback: (isError: boolean, outputFilePath: string | null) => void): void {
        this.listener.once(EncoderModel.ENCODE_FINISH_EVENT, (isError: boolean, outputFilePath: string | null) => {
            callback(isError, outputFilePath);
        });
    }

    /**
     * エンコード開始
     */
    public async start(): Promise<void> {
        if (this.encodeOption === null) {
            this.log.encode.error('encodeOption is null');
            throw new Error('EncodeOptionIsNull');
        }

        // エンコード元ファイルの情報を取得
        const video = await this.videoFileDB.findId(this.encodeOption.sourceVideoFileId);
        if (video === null) {
            throw new Error('VideoFileIdIsNotFound');
        }

        // 番組情報を取得する
        const recorded = await this.recordedDB.findId(this.encodeOption.recordedId);
        if (recorded === null) {
            throw new Error('RecordedIsNotFound');
        }

        // 放送局情報を取得する
        const channel = await this.channelDB.findId(recorded.channelId);
        if (channel === null) {
            throw new Error('ChannelIsNotFound');
        }

        // ソースビデオファイルのファイルパスを生成する
        const inputFilePath = await this.videoUtil.getFullFilePathFromId(this.encodeOption.sourceVideoFileId);
        if (inputFilePath === null) {
            throw new Error('VideoPathIsNotFound');
        }

        // ソースビデオファイルの存在を確認
        try {
            await FileUtil.stat(inputFilePath);
        } catch (err: any) {
            this.log.encode.error(`video file is not found: ${inputFilePath}`);
            throw err;
        }

        // エンコードコマンド設定を探す
        const encodeCmd = this.configure.getConfig().encode.find(enc => {
            return enc.name === this.encodeOption?.mode;
        });
        if (typeof encodeCmd === 'undefined') {
            throw new Error('EncodeCommandIsNotFound');
        }

        // 出力先ディレクトリパスを取得する
        const outputDirPath = typeof encodeCmd.suffix === 'undefined' ? null : await this.getDirPath(this.encodeOption);

        // 出力先ディレクトリの存在確認 & 作成
        if (outputDirPath !== null) {
            try {
                await FileUtil.stat(outputDirPath);
            } catch (e: any) {
                // ディレクトリが存在しなければ作成する
                this.log.encode.info(`mkdirp: ${outputDirPath}`);
                await FileUtil.mkdir(outputDirPath);
            }
        }

        // 出力先をファイルパスを生成する
        const outputFilePath =
            outputDirPath === null || typeof encodeCmd.suffix === 'undefined'
                ? null
                : await this.fileManager.getFilePath(outputDirPath, inputFilePath, encodeCmd.suffix);

        const config = this.configure.getConfig();

        // DIR
        let dir: string = '';
        if (typeof encodeCmd.suffix === 'undefined' && typeof this.encodeOption.directory !== 'undefined') {
            dir = this.encodeOption.directory;
        } else if (outputFilePath !== null) {
            dir = outputFilePath;
        }

        // エンコード開始
        this.log.encode.info(
            `encode start. mode: ${this.encodeOption.mode} name: ${recorded.name} file: ${inputFilePath} -> ${outputFilePath}`,
        );
        this.log.encode.info(`encodeId: ${this.encodeOption.encodeId}`);
        this.log.encode.info(`encodeCmd.suffix: ${encodeCmd.suffix}`);
        this.log.encode.info(`queueItem.directory: ${this.encodeOption.directory}`);
        this.log.encode.info(`outputFilePath: ${outputFilePath}`);

        // プロセスの生成
        this.childProcess = await this.processManager.create({
            input: inputFilePath,
            output: outputFilePath,
            cmd: encodeCmd.cmd,
            priority: EncoderModel.ENCODE_PRIPORITY,
            spawnOption: {
                env: {
                    ...process.env,
                    RECORDEDID: recorded.id.toString(10),
                    INPUT: inputFilePath,
                    OUTPUT: outputFilePath === null ? '' : outputFilePath,
                    DIR: dir,
                    SUBDIR: this.encodeOption.directory || '',
                    FFMPEG: config.ffmpeg,
                    FFPROBE: config.ffprobe,
                    NAME: recorded.name,
                    HALF_WIDTH_NAME: recorded.halfWidthName,
                    DESCRIPTION: recorded.description || '',
                    HALF_WIDTH_DESCRIPTION: recorded.halfWidthDescription || '',
                    EXTENDED: recorded.extended || '',
                    HALF_WIDTH_EXTENDED: recorded.halfWidthExtended || '',
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
                    CHANNELNAME: typeof channel.name === 'string' ? channel.name : '',
                    HALF_WIDTH_CHANNELNAME: typeof channel.halfWidthName === 'string' ? channel.halfWidthName : '',
                    GENRE1: typeof recorded.genre1 === 'number' ? recorded.genre1.toString(10) : '',
                    SUBGENRE1: typeof recorded.subGenre1 === 'number' ? recorded.subGenre1.toString(10) : '',
                    GENRE2: typeof recorded.genre2 === 'number' ? recorded.genre2.toString(10) : '',
                    SUBGENRE2: typeof recorded.subGenre2 === 'number' ? recorded.subGenre2.toString(10) : '',
                    GENRE3: typeof recorded.genre3 === 'number' ? recorded.genre3.toString(10) : '',
                    SUBGENRE3: typeof recorded.subGenre3 === 'number' ? recorded.subGenre3.toString(10) : '',
                    START_AT: recorded.startAt.toString(10),
                    END_AT: recorded.endAt.toString(10),
                    DROPLOG_ID: recorded.dropLogFile?.id.toString(10) || '',
                    DROPLOG_PATH: recorded.dropLogFile?.filePath || '',
                    ERROR_CNT: recorded.dropLogFile?.errorCnt.toString(10) || '',
                    DROP_CNT: recorded.dropLogFile?.dropCnt.toString(10) || '',
                    SCRAMBLING_CNT: recorded.dropLogFile?.scramblingCnt.toString(10) || '',
                },
            },
        });

        // タイムアウト設定
        this.timerId = setTimeout(
            async () => {
                if (this.encodeOption === null) {
                    return;
                }

                this.log.encode.error(`encode process is time out: ${this.encodeOption.encodeId} ${outputFilePath}`);
                await this.cancel();
            },
            recorded.duration *
                (typeof encodeCmd.rate === 'undefined' ? EncoderModel.DEFAULT_TIMEOUT_RATE : encodeCmd.rate),
        );

        /**
         * プロセスの設定
         */
        // debug 用
        if (this.childProcess.stderr !== null) {
            this.childProcess.stderr.on('data', data => {
                this.log.encode.debug(String(data));
            });
        }

        // 進捗情報更新用
        if (this.childProcess.stdout !== null) {
            let videoInfo: VideoInfo | null = null;
            try {
                videoInfo = await this.videoUtil.getInfo(inputFilePath);
            } catch (err: any) {
                this.log.encode.error(`get encode vidoe file info: ${inputFilePath}`);
                this.log.encode.error(err);
            }
            if (videoInfo !== null) {
                // エンコードプロセスの標準出力から進捗情報を取り出す
                this.childProcess.stdout.on('data', data => {
                    try {
                        this.updateEncodingProgressInfo(data);
                    } catch (err: any) {
                        // error
                    }
                });
            }
        }

        // プロセス終了処理
        this.childProcess.on('exit', async (code, signal) => {
            this.childEndProcessing(code, signal, outputFilePath);
        });

        // プロセスの即時終了対応
        if (ProcessUtil.isExited(this.childProcess) === true) {
            this.childEndProcessing(this.childProcess.exitCode, this.childProcess.signalCode, outputFilePath);
            this.childProcess.removeAllListeners();
        }
    }

    /**
     * queueItem で指定された dir パスを取得する
     * @param queueItem: EncodeOption
     * @return string
     */
    private async getDirPath(queueItem: EncodeOption): Promise<string> {
        const parentDir = this.videoUtil.getParentDirPath(queueItem.parentDir);
        if (parentDir === null) {
            this.log.encode.error(`parent dir config is not found: ${queueItem.parentDir}`);
            throw new Error('parentDirIsNotFound');
        }

        if (typeof queueItem.directory !== 'undefined' && queueItem.directory.length > 0) {
            const recorded = await this.recordedDB.findId(queueItem.recordedId);
            if (recorded !== null) {
                queueItem.directory = await this.recodingUtil.formatFilePathString(queueItem.directory, recorded);
            }
        }

        return typeof queueItem.directory === 'undefined' ? parentDir : path.join(parentDir, queueItem.directory);
    }

    /**
     * エンコード進捗情報更新
     * @param data: エンコードプロセスの標準出力
     * @param encodeId: apid.EncodeId
     */
    private updateEncodingProgressInfo(data: any): void {
        if (this.encodeOption === null) {
            return;
        }

        const logs = String(data).split('\n');
        for (let j = 0; j < logs.length; j++) {
            if (logs[j] != '') {
                const log = JSON.parse(String(logs[j]));
                this.log.encode.debug(log);
                if (log.type === 'progress' && typeof log.percent === 'number' && typeof log.log === 'string') {
                    this.progressInfo = {
                        percent: log.percent,
                        log: log.log,
                    };

                    // エンコード進捗変更通知
                    this.encodeEvent.emitUpdateEncodeProgress();
                }
            }
        }
    }

    /**
     * エンコードプロセス終了処理
     * @param code number | null
     * @param signal NodeJS.Signals | null
     * @param outputFilePath 出力先をファイルパス
     * @param queueItem EncodeQueueItem
     */
    private async childEndProcessing(
        code: number | null,
        signal: NodeJS.Signals | null,
        outputFilePath: string | null,
    ): Promise<void> {
        // exit code
        this.log.encode.info(`exit code: ${code}, signal: ${signal}`);

        // タイムアウトタイマークリア
        if (this.timerId !== null) {
            clearTimeout(this.timerId);
        }

        // ファイルパスの登録を削除
        if (outputFilePath !== null) {
            this.fileManager.release(outputFilePath);
        }

        if (this.encodeOption === null) {
            this.log.encode.error('encodeOptionIsNull');

            return;
        }

        let isError = true;
        if (this.isCanceld === true) {
            // キャンセルされた
            this.log.encode.info(`canceld encode: ${this.encodeOption.encodeId}`);
        } else if (code !== 0) {
            // エンコードが正常終了しなかった
            this.log.encode.error(`encode failed: ${this.encodeOption.encodeId} ${outputFilePath}`);
        } else {
            // エンコード正常終了
            this.log.encode.info(`Successfully encod: ${this.encodeOption.encodeId} ${outputFilePath}`);

            isError = false;
        }

        if (isError === true) {
            // 出力ファイルを削除
            if (outputFilePath !== null) {
                this.log.encode.info(`delete encode output file: ${outputFilePath}`);
                await Util.sleep(1000);

                await FileUtil.unlink(outputFilePath).catch(err => {
                    this.log.encode.error(`delete encode output file failed: ${outputFilePath}`);
                    this.log.encode.error(err);
                });
            }
        }

        // エンコードプロセスの終了を通知
        this.listener.emit(EncoderModel.ENCODE_FINISH_EVENT, isError, outputFilePath);
        this.listener.removeAllListeners();
    }

    /**
     * キャンセル処理
     */
    public async cancel(): Promise<void> {
        if (this.encodeOption === null) {
            return;
        }

        this.log.encode.info(`cancel encode: ${this.encodeOption.encodeId}`);

        // プロセスが実行されていれば削除する
        if (this.childProcess !== null) {
            this.log.encode.info(
                `kill encode process encodeId: ${this.encodeOption.encodeId}, pid: ${this.childProcess.pid}`,
            );

            this.isCanceld = true;
            await ProcessUtil.kill(this.childProcess).catch(err => {
                this.log.encode.error(`kill encode process failed: ${this.encodeOption?.encodeId}`);
                this.log.encode.error(err);
            });
        }
    }

    /**
     * セットされたエンコードオプションを返す
     * @returns EncodeOption | null
     */
    public getEncodeOption(): EncodeOption | null {
        return this.encodeOption;
    }

    /**
     * エンコードの進捗情報を返す
     * @returns EncodeProgressInfo | null
     */
    public getProgressInfo(): EncodeProgressInfo | null {
        return this.progressInfo;
    }

    /**
     * encodeId を返す
     * @returns apid.EncodeId | null
     */
    public getEncodeId(): apid.EncodeId | null {
        return this.encodeOption === null ? null : this.encodeOption.encodeId;
    }
}

namespace EncoderModel {
    export const ENCODE_FINISH_EVENT = 'encodeFinishEvent';
    export const ENCODE_PRIPORITY = 10;
    export const DEFAULT_TIMEOUT_RATE = 4.0;
}

export default EncoderModel;
