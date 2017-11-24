import { ChildProcess } from 'child_process';
import * as http from 'http';
import { StreamInfo, Stream } from './Stream';
import * as apid from '../../../../api';
import CreateMirakurun from '../../Util/CreateMirakurunClient';
import Util from '../../Util/Util';
import ProcessUtil from '../Util/ProcessUtil';

interface MpegTsLiveStreamInfo extends StreamInfo {
    channelId: apid.ServiceItemId;
}

/**
* mpeg2ts ライブ配信
*/
class MpegTsLiveStream extends Stream {
    private channelId: apid.ServiceItemId;
    private mode: number;
    private enc: ChildProcess | null = null;
    private stream: http.IncomingMessage | null = null;

    /**
    * @param channelId: channel id
    * @param mode: config.mpegTsStreaming の index number
    */
    constructor(channelId: apid.ServiceItemId, mode: number) {
        super();

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
            const config = this.config.getConfig().mpegTsStreaming;
            if(typeof config === 'undefined' || typeof config[this.mode] === 'undefined') { throw new Error('MpegTsLiveStreamConfigError'); }

            if(typeof config[this.mode].cmd === 'undefined') {
                // 無変換時
                this.stream.on('close', () => { this.ChildExit(streamNumber); });
                this.stream.on('end', () => { this.ChildExit(streamNumber); });
                this.stream.on('error', () => { this.ChildExit(streamNumber); });
            } else {
                const cmd = config[this.mode].cmd.replace('%FFMPEG%', Util.getFFmpegPath());

                // 変換時
                this.enc = await this.process.create('', '', cmd, Stream.priority);

                // mirakurun のストリームをエンコードプロセスへパイプする
                this.stream.pipe(this.enc.stdin);

                this.enc.on('exit', () => { this.ChildExit(streamNumber); });
                this.enc.on('error', () => { this.ChildExit(streamNumber); });

                this.enc.stderr.on('data', (data) => { this.log.stream.debug(String(data)); });
            }
        } catch(err) {
            await this.stop();
            throw err;
        }
    }

    public async stop(): Promise<void> {
        if(this.stream !== null) {
            this.stream.unpipe();
            this.stream.destroy();
        }

        if(this.enc !== null) {
            await ProcessUtil.kill(this.enc);
        }
    }

    public getInfo(): MpegTsLiveStreamInfo {
        return {
            type: 'MpegTsLive',
            channelId: this.channelId,
            mode: this.mode,
        };
    }

    public getEncChild(): ChildProcess | null { return this.enc; }

    public getMirakurunStream(): http.IncomingMessage | null { return this.stream; }
}

export { MpegTsLiveStreamInfo, MpegTsLiveStream };

