import { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as apid from '../../../../../api';
import ProcessUtil from '../../../Util/ProcessUtil';
import Util from '../../../Util/Util';
import { StreamingVideoConfig, VideoInfo, VideoUtil } from '../../../Util/VideoUtil';
import { RecordedDBInterface } from '../../DB/RecordedDB';
import { EncodeProcessManageModelInterface } from '../Encode/EncodeProcessManageModel';
import { SocketIoManageModelInterface } from '../SocketIoManageModel';
import { RecordedStreamInfo, Stream } from './Stream';
import { StreamManageModelInterface } from './StreamManageModel';

interface ResponseInfo {
    header: { [key: string]: string | number };
    responseCode: number;
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
    private fileStream: fs.ReadStream | null = null;
    private recordedDB: RecordedDBInterface;

    private header: { [key: string]: string | number } = {};
    private responseCode: number = 200;

    constructor(
        process: EncodeProcessManageModelInterface,
        socketIo: SocketIoManageModelInterface,
        manager: StreamManageModelInterface,
        recordedDB: RecordedDBInterface,
        recordedId: apid.RecordedId,
        mode: number,
        startTime: number,
        headerRangeStr: string | null,
    ) {
        super(process, socketIo, manager);

        this.recordedDB = recordedDB;
        this.recordedId = recordedId;
        this.mode = mode;
        this.startTime = startTime < 0 ? 0 : startTime;
        this.headerRangeStr = headerRangeStr;
    }

    /**
     * method === 'HEAD' のときの header 情報を取得する
     */
    public async getHEADResponseInfo(): Promise<{ [key: string]: string | number }> {
        const recorded = await this.getRecorded();
        const videoInfo = await this.getVideoInfo(recorded.recPath);
        const config = VideoUtil.getConfig('mpegTs', this.mode);
        const bitrate = this.getBitrate(config, videoInfo);
        const totalSize = this.getTotalSize(videoInfo, bitrate);

        const header: { [key: string]: string | number } = {};
        header['Content-Type'] = 'video/mpeg';
        if (!recorded.recording && this.headerRangeStr !== null) {
            header['Content-Length'] = totalSize;
            header['Accept-Ranges'] = 'bytes';
        }

        return header;
    }

    /**
     * 録画情報を取得
     */
    private async getRecorded(): Promise<{ recPath: string; recording: boolean }> {
        const recorded = await this.recordedDB.findId(this.recordedId);
        if (recorded === null || recorded.recPath === null) { throw new Error(Stream.FileIsNotFoundError); }

        return { recPath: recorded.recPath, recording: recorded.recording };
    }

    /**
     * get VideoInfo
     */
    private async getVideoInfo(filePath: string): Promise<VideoInfo> {
        // ファイル情報を取得
        const videoInfo = await VideoUtil.getVideoInfo(filePath);

        // 開始時刻が動画の長さを超えていた
        if (this.startTime > videoInfo.duration) {
            throw new Error(Stream.OutOfRangeError);
        }

        return videoInfo;
    }

    /**
     * bitrate 計算
     * @return number
     */
    private getBitrate(config: StreamingVideoConfig, videoInfo: VideoInfo): number {
        let bitrate = config.vb !== 0 && config.ab !== 0 ? (config.vb + config.ab) : 0;
        if (bitrate === 0) { bitrate = videoInfo.bitRate; }

        return bitrate;
    }

    /**
     * total size 計算
     * @return number
     */
    private getTotalSize(videoInfo: VideoInfo, bitrate: number): number {
        let totalSize = bitrate === 0 ? videoInfo.size : bitrate / 8 * videoInfo.duration;
        totalSize -= bitrate / 8 * this.startTime;
        totalSize = Math.floor(totalSize);

        return totalSize;
    }

    public async start(streamNumber: number): Promise<void> {
        await super.start(streamNumber);

        const recorded = await this.getRecorded();
        const videoInfo = await this.getVideoInfo(recorded.recPath);
        const config = VideoUtil.getConfig('mpegTs', this.mode);
        const bitrate = this.getBitrate(config, videoInfo);
        const totalSize = this.getTotalSize(videoInfo, bitrate);

        // set position & set header
        const range: { start: number; end?: number } = {
            start: videoInfo.bitRate / 8 * this.startTime,
        };

        this.header['Content-Type'] = 'video/mpeg';
        if (!recorded.recording) {
            if (this.headerRangeStr !== null) {
                const bytes = this.headerRangeStr.split(/bytes=([0-9]*)-([0-9]*)/);
                const rEnd = parseInt(bytes[2], 10) || totalSize - 1;
                const rStart = parseInt(bytes[1], 10) || totalSize - rEnd;

                // 範囲チェック
                range.start = Math.round(rStart / bitrate * videoInfo.bitRate);
                range.end = Math.round(rEnd / bitrate * videoInfo.bitRate);
                if (range.start > videoInfo.size || range.end > videoInfo.size) {
                    throw new Error(RecordedStreamingMpegTsStream.OutOfRangeError);
                }

                this.header['Content-Range'] = `bytes ${ rStart }-${ rEnd }/${ totalSize }`;
                this.header['Content-Length'] = rEnd - rStart + 1;
                this.responseCode = 206;
            } else {
                this.header['Content-Length'] = totalSize;
                this.responseCode = 200;
            }

            this.header['Accept-Ranges'] = 'bytes';
        }

        try {
            // file read stream の生成
            this.fileStream = fs.createReadStream(recorded.recPath, range);

            // cmd の生成
            const cmd = config.cmd
                .replace(/%FFMPEG%/g, Util.getFFmpegPath())
                .replace(/%RE%/g, recorded.recording ? '-re' : '')
                .replace(/%VB%/g, `-b:v ${ config.vb } -minrate:v ${ config.vb } -maxrate:v ${ config.vb }`)
                .replace(/%VBUFFER%/g, recorded.recording ? '' : `-bufsize:v ${ config.vb * 8 }`)
                .replace(/%AB%/g, `-b:a ${ config.ab } -minrate:a ${ config.ab } -maxrate:a ${ config.ab }`)
                .replace(/%ABUFFER%/g, recorded.recording ? '' : `-bufsize:a ${ config.ab * 8 }`);

            // エンコードプロセス生成
            this.enc = await this.process.create('pipe:0', '', cmd, Stream.priority);

            // pipe
            this.fileStream.pipe(this.enc.stdin);

            this.enc.on('exit', () => { this.ChildExit(streamNumber); });
            this.enc.on('error', () => { this.ChildExit(streamNumber); });

            this.enc.stderr.on('data', (data) => { this.log.stream.debug(String(data)); });
        } catch (err) {
            await this.stop();
            throw err;
        }
    }

    public async stop(): Promise<void> {
        if (this.fileStream !== null) {
            this.fileStream.unpipe();
            this.fileStream.destroy();
        }

        if (this.enc !== null) {
            await ProcessUtil.kill(this.enc);
        }

        await super.stop();
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
            responseCode: this.responseCode,
        };
    }
}

export default RecordedStreamingMpegTsStream;

