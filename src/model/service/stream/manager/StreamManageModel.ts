import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import ILogger from '../../../ILogger';
import ILoggerModel from '../../../ILoggerModel';
import ISocketIOManageModel from '../../socketio/ISocketIOManageModel';
import IStreamBaseModel, { LiveStreamInfo, RecordedStreamInfo } from '../base/IStreamBaseModel';
import IStreamManageModel, { StreamInfoWithStreamId } from './IStreamManageModel';

@injectable()
export default class StreamManageModel implements IStreamManageModel {
    private log: ILogger;
    private socketIO: ISocketIOManageModel;
    private streams: { [streamId: number]: IStreamBaseModel<any> } = {};

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('ISocketIOManageModel') socketIO: ISocketIOManageModel,
    ) {
        this.log = logger.getLogger();
        this.socketIO = socketIO;
    }

    /**
     * ストリームを開始する
     * @param stream: IStreamBase<any> setOption() した状態で渡す
     * @return Promise<apid.StreamId>
     */
    public async start(stream: IStreamBaseModel<any>): Promise<apid.StreamId> {
        // stream id 割当
        const streamId = this.getEmptyStreamId();
        this.streams[streamId] = stream;
        this.log.stream.info(`start stream: ${streamId.toString(10)}`);

        await stream.start(streamId).catch(async err => {
            this.log.stream.error('start stream error');
            this.log.stream.error(err);
            await this.stop(streamId);
            throw err;
        });

        // stream 停止時に停止させる
        stream.setExitStream(async () => {
            await this.stop(streamId);
        });

        this.socketIO.notifyClient();

        return streamId;
    }

    /**
     * 空いている streamId を返す
     * @return apid.StreamId
     */
    private getEmptyStreamId(): apid.StreamId {
        let newStreamId = 0;
        while (true) {
            if (typeof this.streams[newStreamId] === 'undefined') {
                return newStreamId;
            }

            newStreamId++;
        }
    }

    /**
     * ストリームを停止する
     * @param streamId: apid.StreamId
     * @return Promise<void>
     */
    public async stop(streamId: apid.StreamId): Promise<void> {
        if (typeof this.streams[streamId] === 'undefined') {
            return;
        }

        await this.streams[streamId].stop().catch(err => {
            this.log.stream.error(`stop stream error ${streamId}`);
            throw err;
        });
        delete this.streams[streamId];

        this.socketIO.notifyClient();

        this.log.stream.info(`stop stream ${streamId}`);
    }

    /**
     * すべてのストリームを停止する
     */
    public async stopAll(): Promise<void> {
        for (const streamId in this.streams) {
            await this.stop(parseInt(streamId, 10)).catch(err => {
                this.log.system.error(err);
            });
        }
    }

    /**
     * ストリーム情報を返す
     * @param streamId: apid.StreamId
     * @return LiveStreamInfo | RecordedStreamInfo
     */
    public getStreamInfo(streamId: apid.StreamId): LiveStreamInfo | RecordedStreamInfo {
        if (typeof this.streams[streamId] === 'undefined') {
            throw new Error('StreamIsNotFound');
        }

        return this.streams[streamId].getInfo();
    }

    /**
     * すべてのストリーム情報を返す
     * @return StreamInfoWithStreamId[]
     */
    public getStreamInfos(): StreamInfoWithStreamId[] {
        const result: StreamInfoWithStreamId[] = [];
        for (const streamId in this.streams) {
            result.push({
                streamId: parseInt(streamId, 10),
                info: this.streams[streamId].getInfo(),
            });
        }

        return result;
    }
}
