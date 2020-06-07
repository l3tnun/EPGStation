import { ChildProcess, exec } from 'child_process';
import * as events from 'events';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import internal, { Readable } from 'stream';
import * as apid from '../../../../api';
import * as fst from '../../../lib/TailStream';
import ProcessUtil from '../../../util/ProcessUtil';
import IRecordedDB from '../../db/IRecordedDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IEncodeProcessManageModel, { CreateProcessOption } from '../encode/IEncodeProcessManageModel';
import IHLSFileDeleterModel from './IHLSFileDeleterModel';
import IRecordedStreamBaseModel, { RecordedStreamOption, VideoFileInfo } from './IRecordedStreamBaseModel';
import { RecordedStreamInfo } from './IStreamBaseModel';

@injectable()
abstract class RecordedStreamBaseModel implements IRecordedStreamBaseModel {
    protected config: IConfigFile;
    protected log: ILogger;
    private processManager: IEncodeProcessManageModel;
    private videoFileDB: IVideoFileDB;
    private recordedDB: IRecordedDB;
    private fileDeleter: IHLSFileDeleterModel;

    private emitter: events.EventEmitter = new events.EventEmitter();
    private streamId: apid.StreamId | null = null;

    private processOption: RecordedStreamOption | null = null;
    private fileStream: Readable | null = null;
    private streamProcess: ChildProcess | null = null;
    private videoFilePath: string | null = null;
    private videoFileInfo: VideoFileInfo | null = null;
    private isTs: boolean = false;
    private isRecording: boolean = false;

    constructor(
        @inject('IConfiguration') configure: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IEncodeProcessManageModel') processManager: IEncodeProcessManageModel,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IHLSFileDeleterModel') fileDeleter: IHLSFileDeleterModel,
    ) {
        this.config = configure.getConfig();
        this.log = logger.getLogger();
        this.processManager = processManager;
        this.videoFileDB = videoFileDB;
        this.recordedDB = recordedDB;
        this.fileDeleter = fileDeleter;
    }

    /**
     * Stream 生成に必要な情報を渡す
     * @param option: RecordedStreamOption
     */
    public setOption(option: RecordedStreamOption): void {
        this.processOption = option;
    }

    /**
     * ストリーム開始
     * @param streamId: apid.StreamId
     * @return Promise<void>
     */
    /**
     * ストリーム開始
     * @return Promise<void>
     */
    public async start(streamId: apid.StreamId): Promise<void> {
        this.streamId = streamId;
        // hls ファイル削除設定
        if (this.getStreamType() === 'RecordedHLS') {
            this.fileDeleter.setOption({
                streamId: streamId,
                streamFilePath: this.config.streamFilePath,
            });
            await this.fileDeleter.deleteAllFiles();
        }

        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        await this.createProcessOption();
        if (this.videoFilePath === null || this.videoFileInfo === null) {
            throw new Error('SetVideoFileInfoError');
        }

        // 開始時刻が動画の長さを超えている
        if (this.processOption.playPosition > this.videoFileInfo.duration) {
            throw new Error('OutOfRange');
        }

        // file read stream の生成
        try {
            this.setFileStream();
        } catch (err) {
            this.log.stream.error('create file stream error');
            this.log.stream.error(err);
            await this.stop();
            throw new Error('FileStreamSetError');
        }

        // エンコードプロセス生成
        const poption = await this.createProcessOption();
        this.log.stream.info(`create encode process: ${poption.cmd}`);
        try {
            this.streamProcess = await this.processManager.create(poption);
        } catch (err) {
            this.log.stream.error(`create encode process failed: ${poption.cmd}`);
            await this.stop();
        }
        if (this.streamProcess === null) {
            throw new Error('CreateStreamProcessError');
        }

        // process 終了時にイベントを発行する
        this.streamProcess.on('exit', () => {
            this.emitExitStream();
        });
        this.streamProcess.on('error', () => {
            this.emitExitStream();
        });

        // ffmpeg debug 用ログ出力
        if (this.streamProcess.stderr !== null) {
            this.streamProcess.stderr.on('data', data => {
                this.log.stream.debug(String(data));
            });
        }

        // パイプ処理
        if (this.streamProcess.stdin !== null && this.fileStream !== null) {
            this.fileStream.pipe(this.streamProcess.stdin);
        }
    }

    /**
     * video file 情報を格納する
     * @return Promise<void>
     */
    private async setVideFileInfo(): Promise<void> {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        const video = await this.videoFileDB.findId(this.processOption.videoFileId);
        if (video === null) {
            throw new Error('VideoIsNull');
        }

        // recorded 情報セット
        const recorded = await this.recordedDB.findId(video.recordedId);
        if (recorded === null) {
            throw new Error('RecordedIsNull');
        }
        this.isRecording = recorded.isRecording;

        // videoFilePath セット
        const parentDir = this.config.recorded.find(d => {
            return d.name === video.parentDirectoryName;
        });
        if (typeof parentDir === 'undefined') {
            throw new Error('VideoFileParentDirectoryPathError');
        }
        this.videoFilePath = path.join(parentDir.path, video.filePath);

        // videoFileInfo セット
        this.videoFileInfo = await this.getVideoInfo(this.videoFilePath);

        this.isTs = video.isTs;
    }

    /**
     * 指定されたファイルパスのビデオ情報を取得する
     * @param filePath: string
     * @return Promise<VideoFileInfo>
     */
    private getVideoInfo(filePath: string): Promise<VideoFileInfo> {
        return new Promise<VideoFileInfo>((resolve, reject) => {
            exec(`${this.config.ffprobe} -v 0 -show_format -of json "${filePath}"`, (err, std) => {
                if (err) {
                    reject(err);

                    return;
                }
                const result = <any>JSON.parse(std);

                resolve({
                    duration: parseFloat(result.format.duration),
                    size: parseInt(result.format.size, 10),
                    bitRate: parseFloat(result.format.bit_rate),
                });
            });
        });
    }

    /**
     * stream プロセス生成に必要な情報を生成する
     * @return Promise<CreateProcessOption>
     */
    private async createProcessOption(): Promise<CreateProcessOption> {
        if (this.streamId === null) {
            throw new Error('StreamIdIsNull');
        }

        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        await this.setVideFileInfo();
        if (this.videoFilePath === null || this.videoFileInfo === null) {
            throw new Error('SetVideoFileInfoError');
        }

        let cmd = this.processOption.cmd
            .replace(/%FFMPEG%/g, this.config.ffmpeg)
            .replace(/%SS%/g, this.isTs === true ? '' : this.processOption.playPosition.toString(10));

        if (this.getStreamType() === 'RecordedHLS') {
            cmd = cmd
                .replace(/%streamFileDir%/g, this.config.streamFilePath)
                .replace(/%streamNum%/g, this.streamId.toString(10));
        }

        const option: CreateProcessOption = {
            input: this.isRecording === true ? null : this.videoFilePath,
            output:
                this.getStreamType() === 'RecordedHLS'
                    ? `${this.config.streamFilePath}\/stream${this.streamId.toString(10)}.m3u8`
                    : null,
            cmd: cmd,
            priority: RecordedStreamBaseModel.ENCODE_PROCESS_PRIORITY,
        };

        return option;
    }

    /**
     * fileStream をセットする
     */
    private setFileStream(): void {
        if (this.processOption === null || this.videoFilePath === null || this.videoFileInfo === null) {
            throw new Error('VideoFileError');
        }

        // TS ファイルでなければ何もしない
        if (this.isTs === false) {
            return;
        }

        this.log.stream.info(`create file stream: ${this.videoFilePath}`);
        const start = Math.floor((this.videoFileInfo.bitRate / 8) * this.processOption.playPosition);
        if (this.isRecording === true) {
            this.fileStream = fst.createReadStream(this.videoFilePath, {
                start: start,
            });
        } else {
            this.fileStream = fs.createReadStream(this.videoFilePath, {
                start: start,
            });
        }
    }

    /**
     * ストリームを停止
     * @return Promise<void>
     */
    public async stop(): Promise<void> {
        if (this.fileStream !== null) {
            this.fileStream.unpipe();
            this.fileStream.destroy();
        }

        if (this.streamProcess !== null) {
            await ProcessUtil.kill(this.streamProcess);
        }

        if (this.streamId !== null && this.getStreamType() === 'RecordedHLS') {
            await this.fileDeleter.deleteAllFiles();
        }
    }

    /**
     * 生成したストリームを返す
     * @return internal.Readable
     */
    public getStream(): internal.Readable {
        if (this.streamProcess !== null && this.streamProcess.stdout !== null) {
            return this.streamProcess.stdout;
        } else {
            throw new Error('StreamIsNull');
        }
    }

    /**
     * ストリーム情報を返す
     * @return RecordedStreamInfo
     */
    public getInfo(): RecordedStreamInfo {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        return {
            type: this.getStreamType(),
            videoFileId: this.processOption.videoFileId,
        };
    }

    protected abstract getStreamType(): 'RecordedStream' | 'RecordedHLS';

    /**
     * ストリーム終了イベントへ登録
     * @param callback: () => void
     */
    public setExitStream(callback: () => void): void {
        this.emitter.on(RecordedStreamBaseModel.EXIT_EVENT, async () => {
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
    private emitExitStream(): void {
        this.emitter.emit(RecordedStreamBaseModel.EXIT_EVENT);
    }
}

namespace RecordedStreamBaseModel {
    export const ENCODE_PROCESS_PRIORITY = 1;
    export const EXIT_EVENT = 'exitEvent';
}

export default RecordedStreamBaseModel;
