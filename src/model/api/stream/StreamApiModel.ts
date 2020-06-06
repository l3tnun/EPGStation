import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IProgramDB from '../../db/IProgramDB';
import IRecordedDB from '../../db/IRecordedDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import { StreamingCmd } from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import { LiveHLSStreamModelProvider, LiveStreamModelProvider } from '../../service/stream/ILiveStreamBaseModel';
import { RecordedStreamModelProvider } from '../../service/stream/IRecordedStreamBaseModel';
import IStreamManageModel from '../../service/stream/IStreamManageModel';
import IStreamApiModel, { StreamResponse } from './IStreamApiModel';

@injectable()
export default class StreamApiModel implements IStreamApiModel {
    private configure: IConfiguration;
    private liveStreamProvider: LiveStreamModelProvider;
    private liveHLSStreamProvider: LiveHLSStreamModelProvider;
    private recordedStreamProvider: RecordedStreamModelProvider;
    private streamManageModel: IStreamManageModel;
    private programDB: IProgramDB;
    private videoFileDB: IVideoFileDB;
    private recordedDB: IRecordedDB;

    constructor(
        @inject('IConfiguration') configure: IConfiguration,
        @inject('LiveStreamModelProvider') liveStreamProvider: LiveStreamModelProvider,
        @inject('LiveHLSStreamModelProvider') liveHLSStreamProvider: LiveHLSStreamModelProvider,
        @inject('RecordedStreamModelProvider') recordedStreamProvider: RecordedStreamModelProvider,
        @inject('IStreamManageModel') streamManageModel: IStreamManageModel,
        @inject('IProgramDB') programDB: IProgramDB,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
    ) {
        this.configure = configure;
        this.liveStreamProvider = liveStreamProvider;
        this.liveHLSStreamProvider = liveHLSStreamProvider;
        this.recordedStreamProvider = recordedStreamProvider;
        this.streamManageModel = streamManageModel;
        this.programDB = programDB;
        this.videoFileDB = videoFileDB;
        this.recordedDB = recordedDB;
    }

    /**
     * m2ts 形式の live streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<StreamResponse>
     */
    public async startLiveM2TsStream(option: apid.LiveStreamOption): Promise<StreamResponse> {
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
    public async startLiveWebmStream(option: apid.LiveStreamOption): Promise<StreamResponse> {
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
     * mp4 形式の live streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<StreamResponse>
     */
    public async startMp4Stream(option: apid.LiveStreamOption): Promise<StreamResponse> {
        // config が存在するか確認する
        const config = this.configure.getConfig();
        if (
            typeof config.stream === 'undefined' ||
            typeof config.stream.live === 'undefined' ||
            typeof config.stream.live.mp4 === 'undefined'
        ) {
            throw new Error('ConfigIsUndefined');
        }

        // config に指定された設定が存在するか確認する
        const streamConfig = config.stream.live.mp4.find(con => {
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
     * HLS 形式の live streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<apid.StreamId>
     */
    public async startLiveHLSStream(option: apid.LiveStreamOption): Promise<apid.StreamId> {
        // config が存在するか確認する
        const config = this.configure.getConfig();
        if (
            typeof config.stream === 'undefined' ||
            typeof config.stream.live === 'undefined' ||
            typeof config.stream.live.hls === 'undefined'
        ) {
            throw new Error('ConfigIsUndefined');
        }
        // config に指定された設定が存在するか確認する
        const streamConfig = config.stream.live.hls.find(con => {
            return con.name === option.name;
        });
        if (typeof streamConfig === 'undefined') {
            throw new Error('ConfigIsNotFound');
        }

        // stream 生成
        const stream = await this.liveHLSStreamProvider();
        stream.setOption({
            channelId: option.channelId,
            cmd: streamConfig.cmd,
        });

        // manager に登録
        return await this.streamManageModel.start(stream);
    }

    /**
     * WebM 形式の Recorded streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<apid.StreamId>
     */
    public async startRecordedWebMStream(option: apid.RecordedStreanOption): Promise<StreamResponse> {
        const cmd = await this.getRecordedVideoConfig('webm', option);

        // stream 生成
        const stream = await this.recordedStreamProvider();
        stream.setOption({
            videoFileId: option.videoFileId,
            playPosition: option.playPosition,
            cmd: cmd,
        });

        // manager に登録
        const streamId = await this.streamManageModel.start(stream);

        return {
            streamId: streamId,
            stream: stream.getStream(),
        };
    }

    /**
     * WebM 形式の Recorded streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<apid.StreamId>
     */
    public async startRecordedMp4Stream(option: apid.RecordedStreanOption): Promise<StreamResponse> {
        const cmd = await this.getRecordedVideoConfig('mp4', option);

        // stream 生成
        const stream = await this.recordedStreamProvider();
        stream.setOption({
            videoFileId: option.videoFileId,
            playPosition: option.playPosition,
            cmd: cmd,
        });

        // manager に登録
        const streamId = await this.streamManageModel.start(stream);

        return {
            streamId: streamId,
            stream: stream.getStream(),
        };
    }

    /**
     * config から指定した stream コマンドを取り出す
     * @param type: 'webm' | 'mp4' | 'hls'
     * @param option apid.RecordedStreanOption
     * @return Promise<string>
     */
    private async getRecordedVideoConfig(
        type: 'webm' | 'mp4' | 'hls',
        option: apid.RecordedStreanOption,
    ): Promise<string> {
        const isEncodedVideo = await this.isEncodedVideo(option.videoFileId);

        // config が存在するか
        const config = this.configure.getConfig();
        if (typeof config.stream === 'undefined' || typeof config.stream.recorded === 'undefined') {
            throw new Error('ConfigIsUndefined');
        }

        let cmd: StreamingCmd | undefined;
        if (isEncodedVideo === true) {
            if (
                typeof config.stream.recorded.encoded === 'undefined' ||
                typeof config.stream.recorded.encoded[type] === 'undefined'
            ) {
                throw new Error('ConfigIsUndefined');
            }

            cmd = config.stream.recorded.encoded[type]!.find(con => {
                return con.name === option.name;
            });
        } else {
            if (
                typeof config.stream.recorded.ts === 'undefined' ||
                typeof config.stream.recorded.ts[type] === 'undefined'
            ) {
                throw new Error('ConfigIsUndefined');
            }

            cmd = config.stream.recorded.ts[type]!.find(con => {
                return con.name === option.name;
            });
        }

        if (typeof cmd?.cmd === 'undefined') {
            throw new Error('CmdIsUndefined');
        }

        return cmd.cmd;
    }

    /**
     * 指定された video file が エンコードされたものなのか返す
     * @param videoFileId: apid.VideoFileId
     * @return Promise<boolean>
     */
    private async isEncodedVideo(videoFileId: apid.VideoFileId): Promise<boolean> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) {
            throw new Error('VideoFileIsNotFound');
        }

        return video.isTs === false;
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

    /**
     * ストリーム情報を返す
     * @return apid.StreamInfo
     */
    public async getStreamInfos(): Promise<apid.StreamInfo> {
        const infos = this.streamManageModel.getStreamInfos();

        const items: (apid.LiveStreamInfoItem | apid.VideoFileStreamInfoItem)[] = [];
        const now = new Date().getTime();
        for (const info of infos) {
            if (info.info.type === 'LiveStream' || info.info.type === 'LiveHLS') {
                // ライブストリーミング
                const item: apid.LiveStreamInfoItem = {
                    streamId: info.streamId,
                    type: info.info.type,
                    channelId: info.info.channelId,
                    name: '',
                    startAt: 0,
                    endAt: 0,
                };
                const program = await this.programDB.findChannelIdAndTime(info.info.channelId, now);
                if (program !== null) {
                    item.name = program.name;
                    item.startAt = program.startAt;
                    item.endAt = program.endAt;
                    if (program.description !== null) {
                        item.description = program.description;
                    }
                    if (program.extended !== null) {
                        item.extended = program.extended;
                    }
                }

                items.push(item);
            } else if (info.info.type === 'RecordedStream' || info.info.type === 'RecordedHLS') {
                // ビデオストリーミング
                const item: apid.VideoFileStreamInfoItem = {
                    streamId: info.streamId,
                    type: info.info.type,
                    channelId: 0,
                    name: '',
                    startAt: 0,
                    endAt: 0,
                    viodeFileId: info.info.videoFileId,
                    recordedId: 0,
                };

                const videoFile = await this.videoFileDB.findId(info.info.videoFileId);
                if (videoFile !== null) {
                    item.recordedId = videoFile.recordedId;
                    const recorded = await this.recordedDB.findId(videoFile.recordedId);
                    if (recorded !== null) {
                        item.channelId = recorded.channelId;
                        item.name = recorded.name;
                        item.startAt = recorded.startAt;
                        item.endAt = recorded.endAt;
                        if (recorded.description !== null) {
                            item.description = recorded.description;
                        }
                        if (recorded.extended !== null) {
                            item.extended = recorded.extended;
                        }
                    }
                }

                items.push(item);
            } else {
                throw new Error('StreamInfoTypeError');
            }
        }

        return {
            items: items,
        };
    }
}
