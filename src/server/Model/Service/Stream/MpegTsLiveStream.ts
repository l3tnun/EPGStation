import { ChildProcess } from 'child_process';
import * as http from 'http';
import * as apid from '../../../../../api';
import CreateMirakurun from '../../../Util/CreateMirakurunClient';
import ProcessUtil from '../../../Util/ProcessUtil';
import Util from '../../../Util/Util';
import { EncodeProcessManageModelInterface } from '../Encode/EncodeProcessManageModel';
import { SocketIoManageModelInterface } from '../SocketIoManageModel';
import { LiveStreamInfo, Stream } from './Stream';
import { StreamManageModelInterface } from './StreamManageModel';

/**
 * mpeg2ts ライブ配信
 */
class MpegTsLiveStream extends Stream {
    private channelId: apid.ServiceItemId;
    private mode: number;
    private enc: ChildProcess | null = null;
    private stream: http.IncomingMessage | null = null;

    /**
     * @param process: EncodeProcessManageModelInterface
     * @param manager: StreamManageModelInterface
     * @param channelId: channel id
     * @param mode: config.mpegTsStreaming の index number
     */
    constructor(
        process: EncodeProcessManageModelInterface,
        socketIo: SocketIoManageModelInterface,
        manager: StreamManageModelInterface,
        channelId: apid.ServiceItemId, mode: number,
    ) {
        super(process, socketIo, manager);

        this.channelId = channelId;
        this.mode = mode;
    }

    public async start(streamNumber: number): Promise<void> {
        await super.start(streamNumber);

        const mirakurun = CreateMirakurun.get();
        mirakurun.priority = this.getPriority();

        try {
            // 放送波受信
            this.stream = await mirakurun.getServiceStream(this.channelId, true, this.getPriority());

            // エンコードプロセス生成
            const config = this.config.getConfig().mpegTsStreaming;
            if (typeof config === 'undefined' || typeof config[this.mode] === 'undefined') { throw new Error('MpegTsLiveStreamConfigError'); }

            if (typeof config[this.mode].cmd === 'undefined') {
                // 無変換時
                this.stream.on('close', () => { this.ChildExit(streamNumber); });
                this.stream.on('end', () => { this.ChildExit(streamNumber); });
                this.stream.on('error', () => { this.ChildExit(streamNumber); });
            } else {
                const cmd = config[this.mode].cmd.replace('%FFMPEG%', Util.getFFmpegPath());

                // 変換時
                this.enc = await this.process.create('', '', cmd, Stream.priority);

                // mirakurun のストリームをエンコードプロセスへパイプする
                if (this.enc.stdin !== null) {
                    this.stream.pipe(this.enc.stdin);
                }

                this.enc.on('exit', () => { this.ChildExit(streamNumber); });
                this.enc.on('error', () => { this.ChildExit(streamNumber); });

                if (this.enc.stderr !== null) {
                    this.enc.stderr.on('data', (data) => { this.log.stream.debug(String(data)); });
                }
            }
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

        await super.stop();
    }

    public getInfo(): LiveStreamInfo {
        return {
            type: 'MpegTsLive',
            channelId: this.channelId,
            mode: this.mode,
        };
    }

    public getEncChild(): ChildProcess | null { return this.enc; }

    public getMirakurunStream(): http.IncomingMessage | null { return this.stream; }
}

export default MpegTsLiveStream;

