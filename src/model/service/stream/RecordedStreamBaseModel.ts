import { ChildProcess, exec } from 'child_process';
import * as events from 'events';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import internal from 'stream';
import * as apid from '../../../../api';
import ProcessUtil from '../../../util/ProcessUtil';
import IRecordedDB from '../../db/IRecordedDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IEncodeProcessManageModel, { CreateProcessOption } from '../encode/IEncodeProcessManageModel';
import IRecordedStreamBaseModel, { RecordedStreamOption, VideoFileInfo } from './IRecordedStreamBaseModel';
import { RecordedStreamInfo } from './IStreamBaseModel';

@injectable()
abstract class RecordedStreamBaseModel implements IRecordedStreamBaseModel {
    protected config: IConfigFile;
    protected log: ILogger;
    protected processManager: IEncodeProcessManageModel;
    private videoFileDB: IVideoFileDB;
    private recordedDB: IRecordedDB;

    private emitter: events.EventEmitter = new events.EventEmitter();

    protected processOption: RecordedStreamOption | null = null;
    protected fileStream: fs.ReadStream | null = null;
    protected streamProcess: ChildProcess | null = null;
    protected videoFilePath: string | null = null;
    protected videoFileInfo: VideoFileInfo | null = null;
    protected isTs: boolean = false;
    protected isRecording: boolean = false;

    constructor(
        @inject('IConfiguration') configure: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IEncodeProcessManageModel') processManager: IEncodeProcessManageModel,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
    ) {
        this.config = configure.getConfig();
        this.log = logger.getLogger();
        this.processManager = processManager;
        this.videoFileDB = videoFileDB;
        this.recordedDB = recordedDB;
    }

    /**
     * Stream 生成に必要な情報を渡す
     * @param option: RecordedStreamOption
     */
    public setOption(option: RecordedStreamOption): void {
        this.processOption = option;
    }

    /**
     * video file 情報を格納する
     * @return Promise<void>
     */
    protected async setVideFileInfo(): Promise<void> {
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
     * @return CreateProcessOption
     */
    protected createProcessOption(): CreateProcessOption {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        const cmd = this.processOption.cmd
            .replace(/%FFMPEG%/g, this.config.ffmpeg)
            .replace(/%RE%/g, this.isRecording === true ? '-re' : '')
            .replace(/%SS%/g, this.isTs === true ? '' : this.processOption.playPosition.toString(10));

        return {
            input: null,
            output: null,
            cmd: cmd,
            priority: RecordedStreamBaseModel.ENCODE_PROCESS_PRIORITY,
        };
    }

    /**
     * fileStream をセットする
     */
    protected setFileStream(): void {
        if (this.processOption === null || this.videoFilePath === null || this.videoFileInfo === null) {
            throw new Error('VideoFileError');
        }

        // TS ファイルでなければ何もしない
        if (this.isTs === false) {
            return;
        }

        this.log.stream.info(`create file stream: ${this.videoFilePath}`);
        this.fileStream = fs.createReadStream(this.videoFilePath, {
            start: Math.floor((this.videoFileInfo.bitRate / 8) * this.processOption.playPosition),
        });
    }

    /**
     * ストリーム開始
     * @param streamId: apid.StreamId
     * @return Promise<void>
     */
    public abstract start(streamId: apid.StreamId): Promise<void>;

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
    protected emitExitStream(): void {
        this.emitter.emit(RecordedStreamBaseModel.EXIT_EVENT);
    }
}

namespace RecordedStreamBaseModel {
    export const ENCODE_PROCESS_PRIORITY = 1;
    export const EXIT_EVENT = 'exitEvent';
}

export default RecordedStreamBaseModel;
