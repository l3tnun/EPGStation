import { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as mkdirp from 'mkdirp';
import * as apid from '../../../../../api';
import Base from '../../../Base';
import Util from '../../../Util/Util';
import { EncodeProcessManageModelInterface } from '../Encode/EncodeProcessManageModel';
import { SocketIoManageModelInterface } from '../SocketIoManageModel';
import { StreamManageModelInterface } from './StreamManageModel';
import * as enums from './StreamTypeInterface';

interface StreamInfo {
    type: enums.StreamType;
    mode: number;
}

interface RecordedStreamInfo extends StreamInfo {
    recordedId: apid.RecordedId;
    encodedId?: apid.EncodedId;
}

interface LiveStreamInfo extends StreamInfo {
    channelId: apid.ServiceItemId;
}

abstract class Stream extends Base {
    protected process: EncodeProcessManageModelInterface;
    private socketIo: SocketIoManageModelInterface;
    private manager: StreamManageModelInterface;
    private viewCnt: number = 0;
    private streamNumber: number;

    /**
     * @param process: EncodeProcessManageModelInterface
     * @param manager: StreamManageModelInterface
     */
    constructor(
        process: EncodeProcessManageModelInterface,
        socketIo: SocketIoManageModelInterface,
        manager: StreamManageModelInterface,
    ) {
        super();
        this.process = process;
        this.socketIo = socketIo;
        this.manager = manager;
    }

    public async start(streamNumber: number): Promise<void> {
        this.streamNumber = streamNumber;
    }

    /**
     * HLS 配信で使用するディレクトリが存在するかチェックし
     * ディレクトリがなければ作成する
     */
    protected checkHLSStreamFileDir(): void {
        const dir = Util.getStreamFilePath();

        try {
            fs.statSync(dir);
        } catch (err) {
            // ディレクトリが存在しなければ作成
            this.log.system.info(`mkdirp: ${ dir }`);
            mkdirp.sync(dir);
        }
    }

    public async stop(): Promise<void> {
        this.notify();
    }

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
     * socketio 通知
     */
    private notify(): void {
        this.socketIo.notifyClient();
    }
}

namespace Stream {
    export const priority = 0;
    export const FileIsNotFoundError = 'FileIsNotFoundError';
    export const OutOfRangeError = 'OutOfRangeError';
}


export { RecordedStreamInfo, LiveStreamInfo, Stream };

