import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IExecutionManagementModel from '../../../IExecutionManagementModel';
import ILogger from '../../../ILogger';
import ILoggerModel from '../../../ILoggerModel';
import ISocketIOManageModel from '../../socketio/ISocketIOManageModel';
import IStreamBaseModel, { LiveStreamInfo, RecordedStreamInfo } from '../base/IStreamBaseModel';
import IStreamManageModel, { StreamInfoWithStreamId } from './IStreamManageModel';

@injectable()
class StreamManageModel implements IStreamManageModel {
    private log: ILogger;
    private executeManagementModel: IExecutionManagementModel;
    private socketIO: ISocketIOManageModel;
    private streams: { [streamId: number]: IStreamBaseModel<any> } = {};

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IExecutionManagementModel') executeManagementModel: IExecutionManagementModel,
        @inject('ISocketIOManageModel') socketIO: ISocketIOManageModel,
    ) {
        this.log = logger.getLogger();
        this.executeManagementModel = executeManagementModel;
        this.socketIO = socketIO;
    }

    /**
     * ストリームを開始する
     * @param stream: IStreamBase<any> setOption() した状態で渡す
     * @return Promise<apid.StreamId>
     */
    public async start(stream: IStreamBaseModel<any>): Promise<apid.StreamId> {
        // 実行権取得
        const exeId = await this.executeManagementModel.getExecution(StreamManageModel.START_STREAM_PRIORITY);
        const finalize = () => {
            this.executeManagementModel.unLockExecution(exeId);
        };

        // stream id 割当
        const streamId = this.getEmptyStreamId();
        this.streams[streamId] = stream;
        this.log.stream.info(`start stream: ${streamId.toString(10)}`);

        try {
            await stream.start(streamId);
        } catch (err) {
            this.log.stream.error('start stream error');
            this.log.stream.error(err);
            finalize();
            await this.stop(streamId);
            throw err;
        }

        // stream 停止時に停止させる
        stream.setExitStream(async () => {
            finalize();
            await this.stop(streamId).catch();
        });

        finalize();
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
     * @param isForce?: boolean 強制的に停止させるか
     * @return Promise<void>
     */
    public async stop(streamId: apid.StreamId, isForce: boolean = false): Promise<void> {
        // 実行権取得
        const exeId = await this.executeManagementModel.getExecution(
            isForce ? StreamManageModel.FOURCE_STOP_STREAM_PRIORITY : StreamManageModel.STOP_STREAM_PRIORITY,
        );
        const finalize = () => {
            this.executeManagementModel.unLockExecution(exeId);
        };

        if (typeof this.streams[streamId] === 'undefined') {
            finalize();

            return;
        }

        await this.streams[streamId].stop().catch(err => {
            this.log.stream.error(`stop stream error ${streamId}`);
            finalize();
            throw err;
        });
        delete this.streams[streamId];

        finalize();
        this.socketIO.notifyClient();

        this.log.stream.info(`stop stream ${streamId}`);
    }

    /**
     * すべてのストリームを停止する
     */
    public async stopAll(): Promise<void> {
        for (const streamId in this.streams) {
            await this.stop(parseInt(streamId, 10), true).catch(err => {
                this.log.system.error(err);
            });
        }
    }

    /**
     * 指定したストリームを停止しないように停止タイマー情報を更新させる
     * @param streamId: apid.StreamId
     */
    public keep(streamId: apid.StreamId): void {
        if (typeof this.streams[streamId] === 'undefined') {
            throw new Error('StreamIsUndefined');
        }

        this.streams[streamId].keep();
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

namespace StreamManageModel {
    export const START_STREAM_PRIORITY = 1;
    export const STOP_STREAM_PRIORITY = 1;
    export const FOURCE_STOP_STREAM_PRIORITY = 10;
}

export default StreamManageModel;
