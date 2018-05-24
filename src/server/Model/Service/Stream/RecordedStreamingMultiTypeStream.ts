import { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as apid from '../../../../../api';
import ProcessUtil from '../../../Util/ProcessUtil';
import Util from '../../../Util/Util';
import { VideoUtil } from '../../../Util/VideoUtil';
import { RecordedDBInterface } from '../../DB/RecordedDB';
import { EncodeProcessManageModelInterface } from '../Encode/EncodeProcessManageModel';
import { SocketIoManageModelInterface } from '../SocketIoManageModel';
import { RecordedStreamInfo, Stream } from './Stream';
import { StreamManageModelInterface } from './StreamManageModel';

type ContainerType = 'webm' | 'mp4';

/**
 * RecordedStreamingMultiTypeStream
 * 録画済み webm or mp4 streaming
 */
class RecordedStreamingMultiTypeStream extends Stream {
    private containerType: ContainerType;
    private recordedId: apid.RecordedId;
    private mode: number;
    private startTime: number;
    private enc: ChildProcess | null = null;
    private fileStream: fs.ReadStream | null = null;
    private recordedDB: RecordedDBInterface;

    constructor(
        process: EncodeProcessManageModelInterface,
        socketIo: SocketIoManageModelInterface,
        manager: StreamManageModelInterface,
        recordedDB: RecordedDBInterface,
        recordedId: apid.RecordedId,
        mode: number,
        startTime: number,
        containerType: ContainerType,
    ) {
        super(process, socketIo, manager);

        this.recordedDB = recordedDB;
        this.recordedId = recordedId;
        this.mode = mode;
        this.startTime = startTime < 0 ? 0 : startTime;
        this.containerType = containerType;
    }

    public async start(streamNumber: number): Promise<void> {
        await super.start(streamNumber);

        // 録画情報を取得
        const recorded = await this.recordedDB.findId(this.recordedId);
        if (recorded === null || recorded.recPath === null) { throw new Error(Stream.FileIsNotFoundError); }

        // ファイル情報を取得
        const videoInfo = await VideoUtil.getVideoInfo(recorded.recPath);

        // 開始時刻が動画の長さを超えていた
        if (this.startTime > videoInfo.duration) {
            throw new Error(Stream.OutOfRangeError);
        }

        // config を取得
        const config = VideoUtil.getConfig(this.containerType, this.mode);
        try {
            // file read stream の生成
            this.fileStream = fs.createReadStream(recorded.recPath, {
                start: videoInfo.bitRate / 8 * this.startTime,
            });

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
            type: 'MultiTypeRecordedStreaming',
            recordedId: this.recordedId,
            mode: this.mode,
        };
    }

    public getEncChild(): ChildProcess | null { return this.enc; }
}

export { ContainerType, RecordedStreamingMultiTypeStream };

