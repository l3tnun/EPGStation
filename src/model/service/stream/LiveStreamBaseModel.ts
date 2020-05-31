import { ChildProcess } from 'child_process';
import * as events from 'events';
import * as http from 'http';
import { inject, injectable } from 'inversify';
import internal from 'stream';
import * as apid from '../../../../api';
import ProcessUtil from '../../../util/ProcessUtil';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IMirakurunClientModel from '../../IMirakurunClientModel';
import IEncodeProcessManageModel, { CreateProcessOption } from '../encode/IEncodeProcessManageModel';
import ILiveStreamBaseModel, { LiveStreamOption } from './ILiveStreamBaseModel';
import { LiveStreamInfo } from './IStreamBaseModel';

@injectable()
abstract class LiveStreamBaseModel implements ILiveStreamBaseModel {
    protected configure: IConfiguration;
    protected log: ILogger;
    protected processManager: IEncodeProcessManageModel;
    protected mirakurunClientModel: IMirakurunClientModel;

    private emitter: events.EventEmitter = new events.EventEmitter();

    protected processOption: LiveStreamOption | null = null;
    protected stream: http.IncomingMessage | null = null;
    protected streamProcess: ChildProcess | null = null;

    constructor(
        @inject('IConfiguration') configure: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IEncodeProcessManageModel') processManager: IEncodeProcessManageModel,
        @inject('IMirakurunClientModel') mirakurunClientModel: IMirakurunClientModel,
    ) {
        this.configure = configure;
        this.log = logger.getLogger();
        this.processManager = processManager;
        this.mirakurunClientModel = mirakurunClientModel;
    }

    /**
     * stream 生成に必要な情報を渡す
     * @param option: LiveStreamOption
     */
    public setOption(option: LiveStreamOption): void {
        this.processOption = option;
    }

    /**
     * stream プロセス生成に必要な情報を生成する
     * @return CreateProcessOption | null プロセス生成する必要がない場合は null を返す
     */
    protected createProcessOption(): CreateProcessOption | null {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        /**
         * mirakurun の stream をそのまま横流しする
         */
        if (typeof this.processOption.cmd === 'undefined') {
            return null;
        }

        const config = this.configure.getConfig();
        const cmd = this.processOption.cmd.replace('%FFMPEG%', config.ffmpeg);

        return {
            input: null,
            output: null,
            cmd: cmd,
            priority: LiveStreamBaseModel.ENCODE_PROCESS_PRIORITY,
        };
    }

    /**
     * ストリーム開始
     * @param streamId: apid.StreamId
     * @return Promise<void>
     */
    public abstract start(streamId: apid.StreamId): Promise<void>;

    /**
     * 放送波受信
     * @param config: IConfigFile
     * @return Promise<void>
     */
    protected async setMirakurunStream(config: IConfigFile): Promise<void> {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        const mirakurun = this.mirakurunClientModel.getClient();
        mirakurun.priority = config.streamingPriority;

        this.log.stream.info(`get mirakurun service stream: ${this.processOption.channelId}`);
        this.stream = await mirakurun
            .getServiceStream(this.processOption.channelId, true, config.streamingPriority)
            .catch(err => {
                this.stream = null;
                this.log.system.error(`get mirakurun service stream failed: ${this.processOption!.channelId}`);
                throw err;
            });
    }

    /**
     * ストリーム停止
     * @return Promise<void>
     */
    public async stop(): Promise<void> {
        if (this.stream !== null) {
            this.stream.unpipe();
            this.stream.destroy();
        }

        if (this.streamProcess !== null) {
            await ProcessUtil.kill(this.streamProcess);
        }
    }

    /**
     * 生成したストリームを返す
     * @return internal.Readable | null
     */
    public getStream(): internal.Readable {
        if (this.streamProcess !== null && this.streamProcess.stdout !== null) {
            return this.streamProcess.stdout;
        } else if (this.stream !== null) {
            return this.stream;
        } else {
            throw new Error('StreamIsNull');
        }
    }

    /**
     * ストリーム情報を返す
     * @return apid.LiveStreamInfo
     */
    public getInfo(): LiveStreamInfo {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        return {
            type: this.getStreamType(),
            channelId: this.processOption.channelId,
        };
    }

    protected abstract getStreamType(): apid.StreamType;

    /**
     * ストリーム終了イベントへ登録
     * @param callback: () => void
     */
    public setExitStream(callback: () => void): void {
        this.emitter.on(LiveStreamBaseModel.EXIT_EVENT, async () => {
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
        this.emitter.emit(LiveStreamBaseModel.EXIT_EVENT);
    }
}

namespace LiveStreamBaseModel {
    export const ENCODE_PROCESS_PRIORITY = 1;
    export const EXIT_EVENT = 'exitEvent';
}

export default LiveStreamBaseModel;
