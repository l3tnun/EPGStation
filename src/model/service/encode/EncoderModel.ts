import { ChildProcess } from 'child_process';
import * as events from 'events';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import { StringDecoder } from 'string_decoder';
import type * as apid from '../../../../api.js';
import FileUtil from '../../../util/FileUtil.js';
import ProcessUtil from '../../../util/ProcessUtil.js';
import { isSubDirectoryInsideRoot } from '../../../util/SubDirectoryUtil.js';
import Util from '../../../util/Util.js';
import IVideoUtil, { VideoInfo } from '../../api/video/IVideoUtil.js';
import IChannelDB from '../../db/IChannelDB.js';
import IRecordedDB from '../../db/IRecordedDB.js';
import IVideoFileDB from '../../db/IVideoFileDB.js';
import IEncodeEvent from '../../event/IEncodeEvent.js';
import IConfiguration from '../../IConfiguration.js';
import ILogger from '../../ILogger.js';
import ILoggerModel from '../../ILoggerModel.js';
import IEncodeFileManageModel from './IEncodeFileManageModel.js';
import IEncodeProcessManageModel from './IEncodeProcessManageModel.js';
import { ManagedProcessHandle, ManagedStopRequestResult } from './IEncodeProcessManageModel.js';
import { EncodeOption, EncodeProgressInfo, IEncoderModel } from './IEncoderModel.js';
import IRecordingUtilModel from '../../operator/recording/IRecordingUtilModel.js';

/**
 * `IEncoderModel` の実装。エンコード予約1件（`EncodeOption`）につきこの class を1つ生成して使う
 * 使い捨てのオブジェクトで、`setOption`→`start`の順で使う前提。実際のプロセス起動・停止は
 * `IEncodeProcessManageModel`へ委譲し、自身はエンコードコマンドの組み立て、進捗ログの
 * パース、タイムアウト監視、終了時の後始末（一時ファイル削除・イベント通知）を担当する。
 */
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

    /** `childEndProcessing` 完了（エンコード終了）を1回だけ通知するための内部専用 event。 */
    private listener: events.EventEmitter = new events.EventEmitter();

    /** `setOption` で一度だけセットされるエンコード情報。`null` は未設定を表し、
     *  二重に `setOption` すること自体がエラーになる。 */
    private encodeOption: EncodeOption | null = null; // エンコード情報
    /** 起動中のエンコードプロセス本体。`start` で設定され、`childEndProcessing` で `null` に戻る。 */
    private childProcess: ChildProcess | null = null; // エンコードプロセス
    /** `processManager` に対して停止要求を出す際に使う不透明な handle。`childProcess` と対で管理される。 */
    private managedProcessHandle: ManagedProcessHandle | null = null;
    /** `cancel` が発行した停止要求の Promise。重複して `cancel` が呼ばれても新たな要求を
     *  発行させず、同じ Promise を待たせるためにキャッシュする。 */
    private stopRequestOperation: Promise<ManagedStopRequestResult> | null = null;
    /** タイムアウト検知用タイマーid。エンコードの想定時間（`recorded.duration`×レート）を
     *  超えると発火し、`cancel` を呼ぶ。`childEndProcessing` で確実にクリアされる。 */
    private timerId: NodeJS.Timeout | null = null; // タイムアウト検知用タイマーid
    /** キャンセルが呼び出されたか? `childEndProcessing` での「異常終了か/キャンセルか」の
     *  判定・出力ファイル削除要否の分岐に使う。 */
    private isCanceld: boolean = false; // キャンセルが呼び出されたか?
    /** 直近にパースできたエンコード進捗（percent とログ文字列）。`getProgressInfo` が返す値そのもの。 */
    private progressInfo: EncodeProgressInfo | null = null;
    /** 標準出力の1行分JSONが複数の `data` チャンクへ分割された場合に、確定していない
     *  行の断片を次のチャンクへ持ち越すためのバッファ。 */
    private progressLineBuffer: string = '';
    /** マルチバイト文字がチャンク境界で分割されても正しく文字列化できるよう状態を保持する
     *  decoder。`updateEncodingProgressInfo` の通常経路で使う。 */
    private progressDecoder: StringDecoder = new StringDecoder('utf8');
    /** `childEndProcessing` の多重実行を防ぐフラグ（`exit` イベントと即時終了チェックの
     *  両方から呼ばれうるため）。 */
    private isSettled: boolean = false;
    /** `childProcess`へ張った `exit` listener の参照。`removeProcessListeners` で
     *  取り外すために保持する。 */
    private childExitListener: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;
    /** `childProcess.stdout` へ張った進捗パース用 `data` listener の参照（未設定なら `null`）。 */
    private stdoutDataListener: ((data: any) => void) | null = null;
    /** `childProcess.stderr` へ張ったデバッグログ出力用 `data` listener の参照（未設定なら `null`）。 */
    private stderrDataListener: ((data: any) => void) | null = null;

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
        const processOption = {
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
        };
        try {
            const startedProcess = await this.processManager.createManaged(processOption);
            this.childProcess = startedProcess.child;
            this.managedProcessHandle = startedProcess.handle;
        } catch (err: any) {
            if (outputFilePath !== null) {
                this.fileManager.release(outputFilePath);
            }
            throw err;
        }

        // タイムアウト設定
        this.timerId = setTimeout(
            () => {
                if (this.encodeOption === null) {
                    return;
                }

                this.log.encode.error(`encode process is time out: ${this.encodeOption.encodeId} ${outputFilePath}`);
                void this.cancel().catch(() => {});
            },
            recorded.duration *
                (typeof encodeCmd.rate === 'undefined' ? EncoderModel.DEFAULT_TIMEOUT_RATE : encodeCmd.rate),
        );

        /**
         * プロセスの設定
         */
        // debug 用
        if (this.childProcess.stderr !== null) {
            this.stderrDataListener = data => {
                this.log.encode.debug(String(data));
            };
            this.childProcess.stderr.on('data', this.stderrDataListener);
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
                this.stdoutDataListener = data => {
                    try {
                        this.updateEncodingProgressInfo(data);
                    } catch (err: any) {
                        // error
                    }
                };
                this.childProcess.stdout.on('data', this.stdoutDataListener);
            }
        }

        // プロセス終了処理
        this.childExitListener = (code, signal) => {
            void this.childEndProcessing(code, signal, outputFilePath);
        };
        this.childProcess.on('exit', this.childExitListener);

        // プロセスの即時終了対応
        if (ProcessUtil.isExited(this.childProcess) === true) {
            void this.childEndProcessing(this.childProcess.exitCode, this.childProcess.signalCode, outputFilePath);
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

            // 保存先の外を指す出力ディレクトリは使わず、親ディレクトリの直下に出力する
            if (isSubDirectoryInsideRoot(queueItem.directory) === false) {
                this.log.encode.warn(
                    `output directory is outside the recorded directory, save directly under it. recordedId: ${queueItem.recordedId} directory: ${queueItem.directory}`,
                );
                queueItem.directory = undefined;
            }
        }

        return typeof queueItem.directory === 'undefined' ? parentDir : path.join(parentDir, queueItem.directory);
    }

    /**
     * エンコードプロセスの標準出力（1行1 JSON の進捗レポートを想定）を取り込む。`data` イベントの
     * 区切りは行区切りと一致しない（1行が複数チャンクに分かれる・複数行が1チャンクに収まる
     * 両方が起こる）ため、`progressLineBuffer` に未確定分を持ち越しながら行を組み立てる。
     * さらに、マルチバイト文字がチャンク境界で分割される場合に備えて `progressDecoder`
     * （状態を保持する `StringDecoder`）で復元するが、何らかの理由でこの永続 decoder の内部状態が
     * ずれてしまうと、以後ずっと JSON parse に失敗し続ける恐れがある。その保険として、常に
     * このチャンク単独から作った使い捨ての `standaloneDecoder` でも同時にパースを試み、
     * 永続 decoder 側が失敗して standalone 側が成功した場合は `progressDecoder` を
     * standalone 側へ差し替えて以後の decoder として採用する（自己修復）。
     * @param data エンコードプロセスの標準出力の生データ（`data` イベントの payload）
     */
    private updateEncodingProgressInfo(data: any): void {
        if (this.encodeOption === null) {
            return;
        }

        const rawChunk = Buffer.from(data);
        const chunk = this.decodeProgressChunk(rawChunk);
        const standaloneDecoder = new StringDecoder('utf8');
        const standaloneChunk = standaloneDecoder.write(rawChunk);

        if (chunk.includes('\n') === false) {
            const record = this.progressLineBuffer + chunk;
            if (this.tryApplyEncodingProgressLine(record)) {
                this.progressLineBuffer = '';
                return;
            }
            if (this.tryApplyEncodingProgressLine(standaloneChunk)) {
                this.progressLineBuffer = '';
                this.progressDecoder = standaloneDecoder;
                return;
            }
            this.retainProgressRecord(record);
            return;
        }

        let records = chunk.split('\n');
        const firstRecord = records.shift()!;
        if (this.tryApplyEncodingProgressLine(this.progressLineBuffer + firstRecord) === false) {
            const standaloneRecords = standaloneChunk.split('\n');
            const standaloneFirstRecord = standaloneRecords.shift()!;
            if (this.tryApplyEncodingProgressLine(standaloneFirstRecord)) {
                this.progressDecoder = standaloneDecoder;
                records = standaloneRecords;
            }
        }

        const remainder = records.pop()!;
        for (const record of records) {
            this.tryApplyEncodingProgressLine(record);
        }
        if (this.tryApplyEncodingProgressLine(remainder)) {
            this.progressLineBuffer = '';
            return;
        }
        this.retainProgressRecord(remainder);
    }

    /**
     * 永続 decoder（`progressDecoder`）でチャンクを文字列化する。
     * @param data 生のバイト列
     * @returns 文字列化した結果（マルチバイト文字が途中のバイト列は次回へ持ち越される）
     */
    private decodeProgressChunk(data: Buffer): string {
        return this.progressDecoder.write(data);
    }

    /**
     * 1行分の文字列を進捗JSONとして解釈できるか試す。「まだ行が完結していない」ことと
     * 「本当に不正な内容」を区別しないため、失敗時は例外を握りつぶして `false` を返すだけにする
     * （呼び出し側は `false` を「今回は確定させず持ち越す」判断に使う）。
     * @param line 解釈を試みる1行
     * @returns 解釈できたか
     */
    private tryApplyEncodingProgressLine(line: string): boolean {
        try {
            this.applyEncodingProgressLine(line);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 行が確定しないまま持ち越す際の受け皿。異常なプロセス（進捗JSONを吐かない/壊れた出力を
     * 続ける等）が改行を送らず際限なくバッファを肥大させるのを防ぐため、上限
     * （`MAX_PROGRESS_RECORD_BYTES`）を超えたら持ち越しを諦めてバッファと decoder を捨てる。
     * @param record 持ち越す文字列
     */
    private retainProgressRecord(record: string): void {
        if (Buffer.byteLength(record) > EncoderModel.MAX_PROGRESS_RECORD_BYTES) {
            this.progressLineBuffer = '';
            this.resetProgressDecoder();
            return;
        }
        this.progressLineBuffer = record;
    }

    /** `progressDecoder` を初期状態へ作り直す（バッファ肥大時の破棄用）。 */
    private resetProgressDecoder(): void {
        this.progressDecoder = new StringDecoder('utf8');
    }

    /**
     * 進捗JSON1行分をパースし、`type: 'progress'` かつ `percent`/`log` を含む形であれば
     * `progressInfo` を更新して変更を通知する。それ以外の形式（parse失敗・想定外のJSON）は
     * 何もしない（`tryApplyEncodingProgressLine` 側で「未完成の行」との区別に使われる）。
     * @param line 解釈する1行（JSON文字列である前提）
     * @throws JSON として parse できない場合は `JSON.parse` の例外がそのまま伝播する
     */
    private applyEncodingProgressLine(line: string): void {
        const log = JSON.parse(line);
        this.log.encode.debug(log);
        if (log === null || log.type !== 'progress' || typeof log.percent !== 'number' || typeof log.log !== 'string') {
            return;
        }

        this.progressInfo = {
            percent: log.percent,
            log: log.log,
        };

        // エンコード進捗変更通知
        this.encodeEvent.emitUpdateEncodeProgress();
    }

    private removeProcessListeners(): void {
        if (this.childProcess === null) {
            return;
        }

        this.childProcess.removeListener('exit', this.childExitListener!);
        this.childExitListener = null;
        if (this.stdoutDataListener !== null) {
            this.childProcess.stdout!.removeListener('data', this.stdoutDataListener);
            this.stdoutDataListener = null;
        }
        if (this.stderrDataListener !== null) {
            this.childProcess.stderr!.removeListener('data', this.stderrDataListener);
            this.stderrDataListener = null;
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
        if (this.isSettled === true) {
            return;
        }
        this.isSettled = true;

        // exit code
        this.log.encode.info(`exit code: ${code}, signal: ${signal}`);

        // タイムアウトタイマークリア
        if (this.timerId !== null) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
        this.removeProcessListeners();
        this.childProcess = null;
        this.managedProcessHandle = null;
        this.progressDecoder.end();
        this.progressLineBuffer = '';

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

        const handle = this.managedProcessHandle;
        if (handle === null) {
            return;
        }

        this.log.encode.info(
            `kill encode process encodeId: ${this.encodeOption.encodeId}, pid: ${this.childProcess?.pid}`,
        );

        this.isCanceld = true;
        if (this.stopRequestOperation === null) {
            this.stopRequestOperation = Promise.resolve()
                .then(() => this.processManager.requestStop(handle))
                .catch(err => {
                    this.log.encode.error(`stop encode process failed: ${this.encodeOption?.encodeId}`);
                    this.log.encode.error(err);
                    throw err;
                });
        }
        await this.stopRequestOperation;
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
    export const MAX_PROGRESS_RECORD_BYTES = 64 * 1024;
}

export default EncoderModel;
