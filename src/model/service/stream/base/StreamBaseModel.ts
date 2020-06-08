import * as events from 'events';
import { inject, injectable } from 'inversify';
import internal from 'stream';
import * as apid from '../../../../../api';
import IConfigFile from '../../../IConfigFile';
import IConfiguration from '../../../IConfiguration';
import ILogger from '../../../ILogger';
import ILoggerModel from '../../../ILoggerModel';
import IEncodeProcessManageModel from '../../encode/IEncodeProcessManageModel';
import IHLSFileDeleterModel from '../util/IHLSFileDeleterModel';
import IStreamBaseModel, { LiveStreamInfo, RecordedStreamInfo } from './IStreamBaseModel';

@injectable()
abstract class StreamBaseModel<T> implements IStreamBaseModel<T> {
    protected config: IConfigFile;
    protected log: ILogger;
    protected processManager: IEncodeProcessManageModel;
    protected fileDeleter: IHLSFileDeleterModel;
    protected processOption: T | null = null;

    private emitter: events.EventEmitter = new events.EventEmitter();

    /**
     * stream 生成に必要な情報を渡す
     * @param option: LiveStreamOption
     */
    public setOption(option: T): void {
        this.processOption = option;
    }

    public abstract start(streamId: apid.StreamId): Promise<void>;
    public abstract stop(): Promise<void>;
    public abstract getStream(): internal.Readable;
    public abstract getInfo(): LiveStreamInfo | RecordedStreamInfo;

    constructor(
        @inject('IConfiguration') configure: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IEncodeProcessManageModel') processManager: IEncodeProcessManageModel,
        @inject('IHLSFileDeleterModel') fileDeleter: IHLSFileDeleterModel,
    ) {
        this.config = configure.getConfig();
        this.log = logger.getLogger();
        this.processManager = processManager;
        this.fileDeleter = fileDeleter;
    }

    /**
     * ストリーム終了イベントへ登録
     * @param callback: () => void
     */
    public setExitStream(callback: () => void): void {
        this.emitter.on(StreamBaseModel.EXIT_EVENT, async () => {
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
        this.emitter.emit(StreamBaseModel.EXIT_EVENT);
    }
}

namespace StreamBaseModel {
    export const ENCODE_PROCESS_PRIORITY = 1;
    export const EXIT_EVENT = 'exitEvent';
}

export default StreamBaseModel;
