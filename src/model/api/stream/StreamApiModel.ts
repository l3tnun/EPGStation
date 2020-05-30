import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IConfiguration from '../../IConfiguration';
import { LiveStreamModelProvider } from '../../service/stream/ILiveStreamBaseModel';
import IStreamManageModel from '../../service/stream/IStreamManageModel';
import IStreamApiModel, { StreamResponse } from './IStreamApiModel';

@injectable()
export default class StreamApiModel implements IStreamApiModel {
    private configure: IConfiguration;
    private liveStreamProvider: LiveStreamModelProvider;
    private streamManageModel: IStreamManageModel;

    constructor(
        @inject('IConfiguration') configure: IConfiguration,
        @inject('LiveStreamModelProvider') liveStreamProvider: LiveStreamModelProvider,
        @inject('IStreamManageModel') streamManageModel: IStreamManageModel,
    ) {
        this.configure = configure;
        this.liveStreamProvider = liveStreamProvider;
        this.streamManageModel = streamManageModel;
    }

    /**
     * m2ts 形式の live streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<StreamResponse>
     */
    public async startM2TsStream(option: apid.LiveStreamOption): Promise<StreamResponse> {
        // config が存在するか確認する
        const config = this.configure.getConfig();
        if (
            typeof config.stream === 'undefined' ||
            typeof config.stream.live === 'undefined' ||
            typeof config.stream.live.m2ts === 'undefined'
        ) {
            throw new Error('ConfigIsUndefined');
        }

        // config に指定された設定が存在するか確認する
        const streamConfig = config.stream.live.m2ts.find(con => {
            return con.name === option.name;
        });
        if (typeof streamConfig === 'undefined') {
            throw new Error('ConfigIsNotFound');
        }

        // stream 生成
        const stream = await this.liveStreamProvider();
        stream.setOption({
            channelId: option.channelId,
            cmd: streamConfig.cmd,
        });

        // manager に登録
        const streamId = await this.streamManageModel.start(stream);

        return {
            streamId: streamId,
            stream: stream.getStream(),
        };
    }

    /**
     * webm 形式の live streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<StreamResponse>
     */
    public async startWebmStream(option: apid.LiveStreamOption): Promise<StreamResponse> {
        // config が存在するか確認する
        const config = this.configure.getConfig();
        if (
            typeof config.stream === 'undefined' ||
            typeof config.stream.live === 'undefined' ||
            typeof config.stream.live.webm === 'undefined'
        ) {
            throw new Error('ConfigIsUndefined');
        }

        // config に指定された設定が存在するか確認する
        const streamConfig = config.stream.live.webm.find(con => {
            return con.name === option.name;
        });
        if (typeof streamConfig === 'undefined') {
            throw new Error('ConfigIsNotFound');
        }

        // stream 生成
        const stream = await this.liveStreamProvider();
        stream.setOption({
            channelId: option.channelId,
            cmd: streamConfig.cmd,
        });

        // manager に登録
        const streamId = await this.streamManageModel.start(stream);

        return {
            streamId: streamId,
            stream: stream.getStream(),
        };
    }

    /**
     * 指定した stream id のストリームを停止
     * @param streamId: apid.StreamId
     * @return Promise<void>
     */
    public async stop(streamId: apid.StreamId): Promise<void> {
        await this.streamManageModel.stop(streamId);
    }

    /**
     * すべてのストリームを停止
     * @return Promise<void>
     */
    public async stopAll(): Promise<void> {
        await this.streamManageModel.stopAll();
    }
}
