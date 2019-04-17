import { ChildProcess } from 'child_process';
import * as http from 'http';
import * as apid from '../../../../../api';
import CreateMirakurun from '../../../Util/CreateMirakurunClient';
import ProcessUtil from '../../../Util/ProcessUtil';
import Util from '../../../Util/Util';
import { EncodeProcessManageModelInterface } from '../Encode/EncodeProcessManageModel';
import { SocketIoManageModelInterface } from '../SocketIoManageModel';
import HLSFileDeleter from './HLSFileDeleter';
import { LiveStreamInfo, Stream } from './Stream';
import { StreamManageModelInterface } from './StreamManageModel';

/**
 * 録画済みファイル HLS 配信
 */
class HLSLiveStream extends Stream {
    private channelId: apid.ServiceItemId;
    private mode: number;
    private enc: ChildProcess | null = null;
    private stream: http.IncomingMessage | null = null;

    private fileDeleter: HLSFileDeleter | null = null;

    /**
     * @param process: EncodeProcessManageModelInterface
     * @param manager: StreamManageModelInterface
     * @param recordedDB: RecordedDB
     * @param encodedDB: EncodedDB
     * @param recordedId: recorded id
     * @param mode: config.recordedHLS の index number
     * @param encodedId: encoded id
     */
    constructor(
        process: EncodeProcessManageModelInterface,
        socketIo: SocketIoManageModelInterface,
        manager: StreamManageModelInterface,
        channelId: apid.ServiceItemId,
        mode: number,
    ) {
        super(process, socketIo, manager);

        this.channelId = channelId;
        this.mode = mode;
    }

    public async start(streamNumber: number): Promise<void> {
        await super.start(streamNumber);

        // config の取得
        const config = this.config.getConfig().liveHLS;
        const streamFilePath = Util.getStreamFilePath();
        if (typeof config === 'undefined' || typeof config[this.mode] === 'undefined') { throw new Error('LiveHLSStreamConfigError'); }

        // cmd の生成
        const cmd = config[this.mode].cmd.replace('%FFMPEG%', Util.getFFmpegPath())
            .replace(/%streamFileDir%/g, streamFilePath)
            .replace(/%streamNum%/g, String(streamNumber));

        // ゴミファイルを削除
        this.fileDeleter = new HLSFileDeleter(streamNumber);
        this.fileDeleter.deleteAllFiles();

        // mirakurun 準備
        const mirakurun = CreateMirakurun.get();
        mirakurun.priority = this.getPriority();

        try {
            // 放送波受信
            this.stream = await mirakurun.getServiceStream(this.channelId);

            // エンコードプロセス生成
            this.enc = await this.process.create(
                '',
                `${ streamFilePath }\/stream${ streamNumber }.m3u8`,
                cmd,
                Stream.priority,
                {
                    cwd: streamFilePath,
                },
            );

            // mirakurun のストリームをエンコードプロセスへパイプする
            if (this.enc.stdin !== null) {
                this.stream.pipe(this.enc.stdin);
            }

            this.enc.on('exit', () => { this.ChildExit(streamNumber); });
            this.enc.on('error', () => { this.ChildExit(streamNumber); });

            if (this.enc.stderr !== null) {
                this.enc.stderr.on('data', (data) => { this.log.stream.debug(String(data)); });
            }

            // ファイル自動削除開始
            this.fileDeleter.startDeleteTsFiles();
        } catch (err) {
            await this.stop();
            throw err;
        }
    }

    public async stop(): Promise<void> {
        if (this.stream !== null) {
            this.stream.unpipe();
            this.stream.destroy();
        }

        if (this.enc !== null) {
            await ProcessUtil.kill(this.enc);
        }

        if (this.fileDeleter !== null) {
            // 自動ファイル削除を停止
            this.fileDeleter.stopDelteTsFiles();
            // 変換済みファイルを削除
            this.fileDeleter.deleteAllFiles();
        }

        await super.stop();
    }

    public getInfo(): LiveStreamInfo {
        return {
            type: 'HLSLive',
            channelId: this.channelId,
            mode: this.mode,
        };
    }
}

export default HLSLiveStream;

