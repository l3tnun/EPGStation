import { ChildProcess } from 'child_process';
import * as apid from '../../../../../api';
import ProcessUtil from '../../../Util/ProcessUtil';
import Util from '../../../Util/Util';
import { RecordedDBInterface } from '../../DB/RecordedDB';
import { EncodeProcessManageModelInterface } from '../Encode/EncodeProcessManageModel';
import { RecordedStreamInfo, Stream } from './Stream';
import { StreamManageModelInterface } from './StreamManageModel';

interface ResponseInfo {
    header: { [key: string]: string | number };
    responseNumber: number;
}

/**
 * RecordedStreamingMpegTsStream
 * 録画済み mpeg ts streaming
 */
class RecordedStreamingMpegTsStream extends Stream {
    private recordedId: apid.RecordedId;
    private mode: number;
    private startTime: number;
    private headerRangeStr: string | null = null;
    private enc: ChildProcess | null = null;
    private recordedDB: RecordedDBInterface;

    private header: { [key: string]: string | number } = {};
    private responseNumber: number = 200;

    constructor(
        process: EncodeProcessManageModelInterface,
        manager: StreamManageModelInterface,
        recordedDB: RecordedDBInterface,
        recordedId: apid.RecordedId,
        mode: number,
        startTime: number,
        headerRangeStr: string | null,
    ) {
        super(process, manager);

        this.recordedDB = recordedDB;
        this.recordedId = recordedId;
        this.mode = mode;
        this.startTime = startTime < 0 ? 0 : startTime;
        this.headerRangeStr = headerRangeStr;
    }

    public async start(streamNumber: number): Promise<void> {
        await super.start(streamNumber);

        // 録画情報を取得
        const recorded = await this.recordedDB.findId(this.recordedId);
        if (recorded === null || recorded.recPath === null || recorded.recording) { throw new Error(RecordedStreamingMpegTsStream.FileIsNotFoundError); }

        // ファイル情報を取得
        const videoInfo = await this.getVideoInfo(recorded.recPath);

        // 開始時刻が動画の長さを超えていた
        if (this.startTime > videoInfo.duration) {
            throw new Error(RecordedStreamingMpegTsStream.OutOfRangeError);
        }

        // config を取得
        const config = this.getConfig();

        // ビットレート計算
        let bitrate = config.vb !== 0 && config.ab !== 0 ? (config.vb + config.ab) : 0;
        if (bitrate === 0) { bitrate = videoInfo.bitRate; }

        // total size 計算
        let totalSize = bitrate === 0 ? videoInfo.size : bitrate / 8 * videoInfo.duration;
        totalSize -= bitrate / 8 * this.startTime;
        totalSize = Math.floor(totalSize);

        // set start position & set header
        let ss = 0;
        if (this.headerRangeStr !== null) {
            const bytes = this.headerRangeStr.replace(/bytes=/, '').split('-');
            const rStart = parseInt(bytes[0], 10);
            const rEnd = parseInt(bytes[1], 10) || totalSize - 1;

            // 範囲チェック
            const start = rStart / bitrate * 8 + this.startTime;
            const end = rEnd / bitrate * 8 - this.startTime;
            if (start > videoInfo.duration || end > videoInfo.duration) {
                throw new Error(RecordedStreamingMpegTsStream.OutOfRangeError);
            }

            this.header['Content-Range'] = `bytes ${ rStart }-${ rEnd }/${ totalSize }`;
            this.header['Content-Length'] = rEnd - rStart + 1;
            this.responseNumber = 206;

            ss = Math.floor(start);
        } else {
            this.header['Accept-Ranges'] = 'bytes';
            this.header['Content-Length'] = totalSize;
            this.responseNumber = 200;
        }

        try {
            // cmd の生成
            const cmd = config.cmd
                .replace(/%FFMPEG%/g, Util.getFFmpegPath())
                .replace(/%SS%/g, `${ ss }`)
                .replace(/%VB%/g, `${ config.vb }`)
                .replace(/%VBUFFER%/g, `${ config.vb * 8 }`)
                .replace(/%AB%/g, `${ config.ab }`)
                .replace(/%ABUFFER%/g, `${ config.ab * 8 }`);

            // エンコードプロセス生成
            this.enc = await this.process.create(recorded.recPath, '', cmd, Stream.priority);

            this.enc.on('exit', () => { this.ChildExit(streamNumber); });
            this.enc.on('error', () => { this.ChildExit(streamNumber); });

            this.enc.stderr.on('data', (data) => { this.log.stream.debug(String(data)); });
        } catch (err) {
            await this.stop();
            throw err;
        }
    }

    /**
     * config.recordedStreaming.mpegTs を返す
     * @param mode: number
     * @return {
     *     cmd: string;
     *     vb: number
     *     ab: number;
     * }
     * @throws GetConfigError
     * @throws GetBittrateError
     */
    private getConfig(): {
        cmd: string;
        vb: number;
        ab: number;
    } {
        const config = this.config.getConfig();
        if (typeof config.recordedStreaming === 'undefined' || typeof config.recordedStreaming.mpegTs === 'undefined' || typeof config.recordedStreaming.mpegTs[this.mode] === 'undefined') {
            throw new Error('GetConfigError');
        }
        const setting = config.recordedStreaming.mpegTs[this.mode];

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

    public async stop(): Promise<void> {
        if (this.enc !== null) {
            await ProcessUtil.kill(this.enc);
        }
    }

    public getInfo(): RecordedStreamInfo {
        return {
            type: 'MpegTsRecordedStreaming',
            recordedId: this.recordedId,
            mode: this.mode,
        };
    }

    public getEncChild(): ChildProcess | null { return this.enc; }

    public getResponseInfo(): ResponseInfo {
        return {
            header: this.header,
            responseNumber: this.responseNumber,
        };
    }
}

namespace RecordedStreamingMpegTsStream {
    export const FileIsNotFoundError = 'FileIsNotFoundError';
    export const OutOfRangeError = 'OutOfRangeError';
}

export default RecordedStreamingMpegTsStream;

