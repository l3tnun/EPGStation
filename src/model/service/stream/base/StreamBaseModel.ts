import * as events from 'events';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
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
            clearInterval(this.streamCheckTimer);
            this.streamCheckTimer = null;
        }

        if (this.streamStopTimer !== null) {
            clearTimeout(this.streamStopTimer);
        }

        this.emitExitStream();
        this.emitter.removeAllListeners(StreamBaseModel.EXIT_EVENT);
    }

    public abstract getStream(): internal.Readable;
    public abstract getInfo(): LiveStreamInfo | RecordedStreamInfo;
    protected abstract getStreamType(): apid.StreamType;

    /**
     * ストリーム終了イベントへ登録
     * @param callback: () => void
     */
    public setExitStream(callback: () => void): void {
        this.emitter.once(StreamBaseModel.EXIT_EVENT, async () => {
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

            const parentPlayListName = `stream${streamId}.m3u8`;
            const childPlayListName = `stream${streamId}-child.m3u8`;
            const subtitlePlayListName = `stream${streamId}-child_vtt.m3u8`;

            let hasParentPlayList = false;
            let hasChildPlayList = false;
            let hasSubtitlePlayList = false;
            let fileCnt = 0;
            for (const f of fileList) {
                if (f.match(`stream${streamId}`)) {
                    if (f.match(/.m3u8/)) {
                        if (f === parentPlayListName) {
                            hasParentPlayList = true;
                        } else if (f === childPlayListName) {
                            hasChildPlayList = true;
                        } else if (f === subtitlePlayListName) {
                            hasSubtitlePlayList = true;
                        }
                    } else if (!!f.match(/.vtt/) === false) {
                        fileCnt += 1;
                    }
                }
            }

            if (hasParentPlayList === true && fileCnt >= 2) {
                if (hasChildPlayList === true && hasSubtitlePlayList) {
                    // parentPlayList に字幕用のプレイリスト情報を追加する
                    await this.addSubtitleInfoToParentPlaylist(parentPlayListName, subtitlePlayListName).catch(err => {
                        this.log.stream.error('failed to add subtitle info');
                        this.log.stream.error(err);
                    });
                }

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
     * parentPlayList に字幕用のプレイリスト情報を追加する
     * @param parentPlayListName: string 親プレイリスト名
     * @param subtitlePlayListName: string 字幕プレイリスト名
     */
    private async addSubtitleInfoToParentPlaylist(
        parentPlayListName: string,
        subtitlePlayListName: string,
    ): Promise<void> {
        const parentPlayListPath = path.join(this.config.streamFilePath, parentPlayListName);
        const file = await FileUtil.readFile(parentPlayListPath);
        const lines = file.split(/\n/);

        // 字幕プレイリスト情報挿入
        const subtitleInfo = `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subtitle",NAME="Japanese",DEFAULT=YES,LANGUAGE="jp",URI="${subtitlePlayListName}"`;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('#EXT-X-STREAM-INF') === true) {
                lines[i] += ',SUBTITLES="subtitle"';
                lines.splice(i, 0, subtitleInfo);
                break;
            }
        }

        // 親プレイリストへ書き込み
        await FileUtil.writeFile(parentPlayListPath, lines.join('\n'));
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
        this.setStopTimer();
    }
}

namespace StreamBaseModel {
    export const ENCODE_PROCESS_PRIORITY = 1;
    export const EXIT_EVENT = 'exitEvent';
}

export default StreamBaseModel;
