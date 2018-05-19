import { exec } from 'child_process';
import Configuration from '../Configuration';
import Util from './Util';

interface StreamingVideoConfig {
    cmd: string;
    vb: number;
    ab: number;
}

interface VideoInfo {
    duration: number;
    size: number;
    bitRate: number;
}

/**
 * VideoUtil
 */
namespace VideoUtil {
    /**
     * ffprobe で動画情報を取得する
     * @return Promise<VideoInfo>
     */
    export const getVideoInfo = (filePath: string): Promise<VideoInfo> => {
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
    };

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
    export const getConfig = (type: 'mpegTs' | 'webm' | 'mp4', mode: number): StreamingVideoConfig => {
        const config = Configuration.getInstance().getConfig();
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
            vb: VideoUtil.getBitrate(setting.vb),
            ab: VideoUtil.getBitrate(setting.ab),
        };
    };

    /**
     * bitrate を取得する
     * @param str: string
     * @return number
     * @throws GetBittrateError
     */
    export const getBitrate = (str: string): number => {
        if (str.match(/^[0-9]+k$/i)) {
            return parseInt(str, 10) * 1024;
        } else if (str.match(/^[0-9]+m$/i)) {
            return parseInt(str, 10) * 1024 * 1024;
        }

        throw new Error('GetBittrateError');
    };
}

export { StreamingVideoConfig, VideoInfo, VideoUtil };

