import * as events from 'events';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import internal from 'stream';
import * as apid from '../../../../../api';
import FileUtil from '../../../../util/FileUtil';
import IConfigFile from '../../../IConfigFile';
import IConfiguration from '../../../IConfiguration';
import ILogger from '../../../ILogger';
import ILoggerModel from '../../../ILoggerModel';
import IEncodeProcessManageModel from '../../encode/IEncodeProcessManageModel';
import ISocketIOManageModel from '../../socketio/ISocketIOManageModel';
import IHLSFileDeleterModel from '../util/IHLSFileDeleterModel';
import IStreamBaseModel, { LiveStreamInfo, RecordedStreamInfo } from './IStreamBaseModel';

@injectable()
abstract class StreamBaseModel<T> implements IStreamBaseModel<T> {
    protected config: IConfigFile;
    protected log: ILogger;
    protected processManager: IEncodeProcessManageModel;
    protected fileDeleter: IHLSFileDeleterModel;
    protected processOption: T | null = null;
    protected configMode: number | null = null;

    private socketIO: ISocketIOManageModel;
    private emitter: events.EventEmitter = new events.EventEmitter();
    private isEnableStream: boolean = false;
    private streamCheckTimer: NodeJS.Timeout | null = null;
    private streamStopTimer: NodeJS.Timeout | null = null;

    constructor(
        @inject('IConfiguration') configure: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IEncodeProcessManageModel') processManager: IEncodeProcessManageModel,
        @inject('IHLSFileDeleterModel') fileDeleter: IHLSFileDeleterModel,
        @inject('ISocketIOManageModel') socketIO: ISocketIOManageModel,
    ) {
        this.config = configure.getConfig();
        this.log = logger.getLogger();
        this.processManager = processManager;
        this.fileDeleter = fileDeleter;
        this.socketIO = socketIO;
    }

    /**
     * stream 生成に必要な情報を渡す
     * @param option: LiveStreamOption
     */
    public setOption(option: T, mode: number): void {
        this.processOption = option;
        this.configMode = mode;
    }

    public abstract start(streamId: apid.StreamId): Promise<void>;

    /**
     * HLS Stream に使用するディレクトリの使用準備をする
     * @return Promise<void>
     */
    protected async prepStreamDir(streamId: apid.StreamId): Promise<void> {
        await this.checkStreamDir();

        // ゴミファイルを削除
        this.fileDeleter.setOption({
            streamId: streamId,
            streamFilePath: this.config.streamFilePath,
        });
        await this.fileDeleter.deleteAllFiles();
    }

    /**
     * HLS Stream に使用するディレクトリのチェックをする
     * ディレクトリが存在しなければ生成する
     * @return Promise<void>
     */
    private async checkStreamDir(): Promise<void> {
        // streamFilePath の存在チェック
        try {
            await FileUtil.access(this.config.streamFilePath, fs.constants.R_OK | fs.constants.W_OK);
        } catch (err) {
            if (typeof err.code !== 'undefined' && err.code === 'ENOENT') {
                // ディレクトリが存在しないので作成する
                this.log.stream.info(`mkdirp: ${this.config.streamFilePath}`);
                await FileUtil.mkdir(this.config.streamFilePath);
            } else {
                // アクセス権に Read or Write が無い
                this.log.stream.fatal(`dir permission error: ${this.config.streamFilePath}`);
                this.log.stream.fatal(err);
                throw err;
            }
        }
    }

    /**
     * ストリームを停止
     * @return Promise<void>
     */
    public async stop(): Promise<void> {
        if (this.streamCheckTimer !== null) {
            this.streamCheckTimer = null;
        }

        if (this.streamStopTimer !== null) {
            clearTimeout(this.streamStopTimer);
        }
    }

    public abstract getStream(): internal.Readable;
    public abstract getInfo(): LiveStreamInfo | RecordedStreamInfo;
    protected abstract getStreamType(): apid.StreamType;

    /**
     * ストリーム終了イベントへ登録
     * @param callback: () => void
     */
    public setExitStream(callback: () => void): void {
        this.emitter.on(StreamBaseModel.EXIT_EVENT, async () => {
            try {
                callback();
            } catch (err) {
                this.log.stream.error('exit stream callback error');
                this.log.stream.error(err);
            }
        });
    }

    /**
     * ストリーム終了イベント発行
     */
    protected emitExitStream(): void {
        this.emitter.emit(StreamBaseModel.EXIT_EVENT);
    }

    /**
     * HLS stream が有効になったかチェックする
     * @param streamId: apid.StreamId
     */
    protected startCheckStreamEnable(streamId: apid.StreamId): void {
        if (this.streamCheckTimer !== null && this.getStreamType().includes('HLS') === false) {
            return;
        }

        this.log.stream.info(`start check stream file: ${streamId}`);
        this.streamCheckTimer = setInterval(async () => {
            let fileList: string[];
            try {
                fileList = await FileUtil.readDir(this.config.streamFilePath);
            } catch (err) {
                this.log.stream.error(`get stream files list error: ${streamId} ${this.config.streamFilePath}`);
                if (this.streamCheckTimer !== null) {
                    clearInterval(this.streamCheckTimer);
                    this.streamCheckTimer = null;
                }

                return;
            }

            let fileCnt = 0;
            let hasPlayList = false;
            for (const f of fileList) {
                if (f.match(`stream${streamId}`)) {
                    if (f.match(/.m3u8/)) {
                        hasPlayList = true;
                    } else {
                        fileCnt += 1;
                    }
                }
            }

            if (hasPlayList === true && fileCnt >= 3) {
                if (this.streamCheckTimer !== null) {
                    clearInterval(this.streamCheckTimer);
                    this.streamCheckTimer = null;
                }
                this.isEnableStream = true;
                this.log.stream.info(`enable stream: ${streamId}`);
                this.socketIO.notifyClient();
            }
        }, 100);
    }

    /**
     * ストリームが有効か
     */
    protected isEnable(): boolean {
        return this.isEnableStream;
    }

    /**
     * 一定時間内に stream 保持要求が来なかったら停止するようにタイマーをセットする
     */
    protected setStopTimer(): void {
        if (this.streamStopTimer !== null) {
            clearTimeout(this.streamStopTimer);
        }

        this.streamStopTimer = setTimeout(async () => {
            await this.stop().catch(err => {
                this.log.stream.error('stop stream error');
                this.log.stream.error(err);
            });
        }, 15 * 1000);
    }

    /**
     * stream 保持要求
     */
    public keep(): void {
        // HLS ではないときは無視する
        if (this.getStreamType().includes('HLS') === false) {
            return;
        }
        this.setStopTimer();
    }
}

namespace StreamBaseModel {
    export const ENCODE_PROCESS_PRIORITY = 1;
    export const EXIT_EVENT = 'exitEvent';
}

export default StreamBaseModel;
