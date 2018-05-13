import { ChildProcess, exec } from 'child_process';
import * as http from 'http';
import * as apid from '../../../../../api';
import Base from '../../../Base';
import Util from '../../../Util/Util';
import { EncodeProcessManageModelInterface } from '../Encode/EncodeProcessManageModel';
import { StreamManageModelInterface } from './StreamManageModel';
import * as enums from './StreamTypeInterface';

interface StreamInfo {
    type: enums.StreamType;
    mode: number;
}

interface RecordedStreamInfo extends StreamInfo {
    recordedId: apid.RecordedId;
}

interface VideoInfo {
    duration: number;
    size: number;
    bitRate: number;
}

interface LiveStreamInfo extends StreamInfo {
    channelId: apid.ServiceItemId;
}

abstract class Stream extends Base {
    protected process: EncodeProcessManageModelInterface;
    private manager: StreamManageModelInterface;
    private viewCnt: number = 0;
    private streamNumber: number;

    /**
     * @param process: EncodeProcessManageModelInterface
     * @param manager: StreamManageModelInterface
     */
    constructor(
        process: EncodeProcessManageModelInterface,
        manager: StreamManageModelInterface,
    ) {
        super();
        this.process = process;
        this.manager = manager;
    }

    public async start(streamNumber: number): Promise<void> {
        this.streamNumber = streamNumber;
    }

    public abstract stop(): Promise<void>;
    public abstract getInfo(): StreamInfo;
    public getEncChild(): ChildProcess | null { return null; }
    public getMirakurunStream(): http.IncomingMessage | null { return null; }

    /**
     * child Process が終了したときの処理
     * @param streamNumber
     * @param resetCount default: true
     */
    protected ChildExit(streamNumber: number, resetCount: boolean = true): void {
        if (resetCount) { this.resetCount(); }
        this.manager.stop(streamNumber);
    }

    /**
     * mirakurun の優先度を返す
     */
    protected getPriority(): number {
        return this.config.getConfig().streamingPriority || 0;
    }

    public countUp(): void { this.viewCnt += 1; }

    public countDown(): void {
        this.viewCnt -= 1;
        this.manager.stop(this.streamNumber);
    }

    public resetCount(isStop: boolean = true): void {
        this.viewCnt = 0;
        if (isStop) { this.manager.stop(this.streamNumber); }
    }

    public getCount(): number { return this.viewCnt; }

    /**
     * ffprobe で動画情報を取得する
     * @return Promise<VideoInfo>
     */
    protected getVideoInfo(filePath: string): Promise<VideoInfo> {
        return new Promise<VideoInfo>((resolve: (result: VideoInfo) => void, reject: (error: Error) => void) => {
            exec(`${ Util.getFFprobePath() } -v 0 -show_format -of json "${ filePath }"`, (err, std) => {
                if (err) {
                    reject(err);

                    return;
                }
                const result = <any> JSON.parse(std);

                resolve({
                    duration: parseFloat(result.format.duration),
                    size: parseInt(result.format.size, 10),
                    bitRate: parseFloat(result.format.bit_rate),
                });
            });
        });
    }

    /**
     * config.recordedStreaming.? を返す
     * @param type: 'mpegTs' | 'webm' | 'mp4'
     * @param mode: number
     * @return {
     *     cmd: string;
     *     vb: number
     *     ab: number;
     * }
     * @throws GetConfigError
     * @throws GetBittrateError
     */
    protected getConfig(type: 'mpegTs' | 'webm' | 'mp4', mode: number): {
        cmd: string;
        vb: number;
        ab: number;
    } {
        const config = this.config.getConfig();
        if (
            typeof config.recordedStreaming === 'undefined'
            || typeof config.recordedStreaming[type] === 'undefined'
            || typeof (<any> config.recordedStreaming[type])[mode] === 'undefined'
        ) {
            throw new Error('GetConfigError');
        }
        const setting = config.recordedStreaming[type][mode];

        return {
            cmd: setting.cmd,
            vb: this.getBitrate(setting.vb),
            ab: this.getBitrate(setting.ab),
        };
    }

    /**
     * bitrate を取得する
     * @param str: string
     * @return number
     * @throws GetBittrateError
     */
    private getBitrate(str: string): number {
        if (str.match(/^[0-9]+k$/i)) {
            return parseInt(str, 10) * 1024;
        } else if (str.match(/^[0-9]+m$/i)) {
            return parseInt(str, 10) * 1024 * 1024;
        }

        throw new Error('GetBittrateError');
    }
}

namespace Stream {
    export const priority = 0;
    export const FileIsNotFoundError = 'FileIsNotFoundError';
    export const OutOfRangeError = 'OutOfRangeError';
}


export { RecordedStreamInfo, LiveStreamInfo, Stream };

