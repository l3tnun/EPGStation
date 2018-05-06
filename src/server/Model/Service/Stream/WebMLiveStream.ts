import { ChildProcess } from 'child_process';
import * as http from 'http';
import * as apid from '../../../../../api';
import CreateMirakurun from '../../../Util/CreateMirakurunClient';
import ProcessUtil from '../../../Util/ProcessUtil';
import Util from '../../../Util/Util';
import { EncodeProcessManageModelInterface } from '../Encode/EncodeProcessManageModel';
import { Stream, StreamInfo } from './Stream';
import { StreamManageModelInterface } from './StreamManageModel';

interface WebMLiveStreamInfo extends StreamInfo {
    channelId: apid.ServiceItemId;
}

/**
 * webm ライブ配信
 */
class WebMLiveStream extends Stream {
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
        manager: StreamManageModelInterface,
        channelId: apid.ServiceItemId, mode: number,
    ) {
        super(process, manager);

        this.channelId = channelId;
        this.mode = mode;
    }

    public async start(streamNumber: number): Promise<void> {
        await super.start(streamNumber);

        const mirakurun = CreateMirakurun.get();
        mirakurun.priority = this.getPriority();

        try {
            // 放送波受信
            this.stream = await mirakurun.getServiceStream(this.channelId);

            // エンコードプロセス生成
            const config = this.config.getConfig().liveWebM;
            if (typeof config === 'undefined' || typeof config[this.mode] === 'undefined') { throw new Error('WebMLiveStreamConfigError'); }
            const cmd = config[this.mode].cmd.replace('%FFMPEG%', Util.getFFmpegPath());

            this.enc = await this.process.create('', '', cmd, Stream.priority);

            // mirakurun のストリームをエンコードプロセスへパイプする
            this.stream.pipe(this.enc.stdin);

            this.enc.on('exit', () => { this.ChildExit(streamNumber); });
            this.enc.on('error', () => { this.ChildExit(streamNumber); });

            this.enc.stderr.on('data', (data) => { this.log.stream.debug(String(data)); });
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
    }

    public getInfo(): WebMLiveStreamInfo {
        return {
            type: 'WebMLive',
            channelId: this.channelId,
            mode: this.mode,
        };
    }

    public getEncChild(): ChildProcess | null { return this.enc; }
}

export { WebMLiveStreamInfo, WebMLiveStream };

