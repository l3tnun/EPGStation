import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IChannelDB from '../../db/IChannelDB';
import IProgramDB from '../../db/IProgramDB';
import IRecordedDB from '../../db/IRecordedDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IConfiguration from '../../IConfiguration';
import { LiveHLSStreamModelProvider, LiveStreamModelProvider } from '../../service/stream/base/ILiveStreamBaseModel';
import {
    RecordedHLSStreamModelProvider,
    RecordedStreamModelProvider,
} from '../../service/stream/base/IRecordedStreamBaseModel';
import IStreamManageModel from '../../service/stream/manager/IStreamManageModel';
import IApiUtil from '../IApiUtil';
import IPlayList from '../IPlayList';
import IStreamApiModel, { StreamResponse } from './IStreamApiModel';

@injectable()
export default class StreamApiModel implements IStreamApiModel {
    private configure: IConfiguration;
    private liveStreamProvider: LiveStreamModelProvider;
    private liveHLSStreamProvider: LiveHLSStreamModelProvider;
    private recordedStreamProvider: RecordedStreamModelProvider;
    private recordedHLSStreamProvider: RecordedHLSStreamModelProvider;
    private streamManageModel: IStreamManageModel;
    private programDB: IProgramDB;
    private videoFileDB: IVideoFileDB;
    private recordedDB: IRecordedDB;
    private channelDB: IChannelDB;
    private apiUtil: IApiUtil;

    constructor(
        @inject('IConfiguration') configure: IConfiguration,
        @inject('LiveStreamModelProvider') liveStreamProvider: LiveStreamModelProvider,
        @inject('LiveHLSStreamModelProvider') liveHLSStreamProvider: LiveHLSStreamModelProvider,
        @inject('RecordedStreamModelProvider') recordedStreamProvider: RecordedStreamModelProvider,
        @inject('RecordedHLSStreamModelProvider') recordedHLSStreamProvider: RecordedHLSStreamModelProvider,
        @inject('IStreamManageModel') streamManageModel: IStreamManageModel,
        @inject('IProgramDB') programDB: IProgramDB,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IApiUtil') apiUtil: IApiUtil,
    ) {
        this.configure = configure;
        this.liveStreamProvider = liveStreamProvider;
        this.liveHLSStreamProvider = liveHLSStreamProvider;
        this.recordedStreamProvider = recordedStreamProvider;
        this.recordedHLSStreamProvider = recordedHLSStreamProvider;
        this.streamManageModel = streamManageModel;
        this.programDB = programDB;
        this.videoFileDB = videoFileDB;
        this.recordedDB = recordedDB;
        this.channelDB = channelDB;
        this.apiUtil = apiUtil;
    }

    /**
     * m2ts 形式の live streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<StreamResponse>
     */
    public async startLiveM2TsStream(option: apid.LiveStreamOption): Promise<StreamResponse> {
        const cmd = this.getTsLiveConfig('m2ts', option.mode);

        // stream 生成
        const stream = await this.liveStreamProvider();
        stream.setOption(
            {
                channelId: option.channelId,
                cmd: cmd,
            },
            option.mode,
        );

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
        const cmd = this.getTsLiveConfig('webm', option.mode);

        // stream 生成
        const stream = await this.liveStreamProvider();
        stream.setOption(
            {
                channelId: option.channelId,
                cmd: cmd,
            },
            option.mode,
        );

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
        const cmd = this.getTsLiveConfig('mp4', option.mode);

        // stream 生成
        const stream = await this.liveStreamProvider();
        stream.setOption(
            {
                channelId: option.channelId,
                cmd: cmd,
            },
            option.mode,
        );

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
        const cmd = this.getTsLiveConfig('hls', option.mode);

        // stream 生成
        const stream = await this.liveHLSStreamProvider();
        stream.setOption(
            {
                channelId: option.channelId,
                cmd: cmd,
            },
            option.mode,
        );

        // manager に登録
        return await this.streamManageModel.start(stream);
    }

    /**
     * config から指定した live stream コマンドを取り出す
     * @param type: 'm2ts' | 'webm' | 'mp4' | 'hls'
     * @param mode: number config stream index 番号
     * @return Promise<string>
     */
    private getTsLiveConfig(type: 'm2ts' | 'webm' | 'mp4' | 'hls', mode: number): string | undefined {
        const config = this.configure.getConfig();

        if (
            typeof config.stream === 'undefined' ||
            typeof config.stream.live === 'undefined' ||
            typeof config.stream.live.ts === 'undefined' ||
            typeof config.stream.live.ts[type] === 'undefined' ||
            typeof (config.stream.live.ts[type] as any)[mode] === 'undefined'
        ) {
            throw new Error('ConfigIsUndefined');
        }

        return (config.stream.live.ts[type] as any)[mode].cmd;
    }

    /**
     * WebM 形式の Recorded streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<StreamResponse>
     */
    public async startRecordedWebMStream(option: apid.RecordedStreanOption): Promise<StreamResponse> {
        const cmd = await this.getRecordedVideoConfig('webm', option);

        // stream 生成
        const stream = await this.recordedStreamProvider();
        stream.setOption(
            {
                videoFileId: option.videoFileId,
                playPosition: option.playPosition,
                cmd: cmd,
            },
            option.mode,
        );

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
     * @return Promise<StreamResponse>
     */
    public async startRecordedMp4Stream(option: apid.RecordedStreanOption): Promise<StreamResponse> {
        const cmd = await this.getRecordedVideoConfig('mp4', option);

        // stream 生成
        const stream = await this.recordedStreamProvider();
        stream.setOption(
            {
                videoFileId: option.videoFileId,
                playPosition: option.playPosition,
                cmd: cmd,
            },
            option.mode,
        );

        // manager に登録
        const streamId = await this.streamManageModel.start(stream);

        return {
            streamId: streamId,
            stream: stream.getStream(),
        };
    }

    /**
     * HLS 形式の Recorded streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<apid.StreamId>
     */
    public async startRecordedHLSStream(option: apid.RecordedStreanOption): Promise<apid.StreamId> {
        const cmd = await this.getRecordedVideoConfig('hls', option);

        // stream 生成
        const stream = await this.recordedHLSStreamProvider();
        stream.setOption(
            {
                videoFileId: option.videoFileId,
                playPosition: option.playPosition,
                cmd: cmd,
            },
            option.mode,
        );

        // manager に登録
        return await this.streamManageModel.start(stream);
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

        let cmd: string | undefined;
        if (isEncodedVideo === true) {
            if (
                typeof config.stream.recorded.encoded === 'undefined' ||
                typeof config.stream.recorded.encoded[type] === 'undefined' ||
                typeof (config.stream.recorded.encoded[type] as any)[option.mode] === 'undefined'
            ) {
                throw new Error('ConfigIsUndefined');
            }

            cmd = (config.stream.recorded.encoded[type] as any)[option.mode].cmd;
        } else {
            if (
                typeof config.stream.recorded.ts === 'undefined' ||
                typeof config.stream.recorded.ts[type] === 'undefined' ||
                typeof (config.stream.recorded.ts[type] as any)[option.mode] === 'undefined'
            ) {
                throw new Error('ConfigIsUndefined');
            }

            cmd = (config.stream.recorded.ts[type] as any)[option.mode].cmd;
        }

        if (typeof cmd === 'undefined') {
            throw new Error('CmdIsUndefined');
        }

        return cmd;
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

        return video.type === 'encoded';
    }

    /**
     * 指定した m2ts 形式のライブストリーミングの m3u8 形式のプレイリスト文字列を取得する
     * @param host: string host
     * @param isSecure boolean https 通信か
     * @param option: apid.LiveStreamOption
     * @return Promise<IPlayList | null>
     */
    public async getLiveM2TsStreamM3u8(
        host: string,
        isSecure: boolean,
        option: apid.LiveStreamOption,
    ): Promise<IPlayList | null> {
        const channel = await this.channelDB.findId(option.channelId);
        if (channel === null) {
            return null;
        }

        return {
            name: encodeURIComponent(channel.name + '.m3u8'),
            playList: this.apiUtil.createM3U8PlayListStr({
                host: host,
                isSecure: isSecure,
                name: channel.name,
                duration: 0,
                baseUrl: `/api/streams/live/${option.channelId.toString(10)}/m2ts?mode=${option.mode}`,
            }),
        };
    }

    /**
     * 指定した stream id のストリームを停止
     * @param streamId: apid.StreamId
     * @param isForce?: boolean 強制的に停止させるか
     * @return Promise<void>
     */
    public async stop(streamId: apid.StreamId, isForce: boolean = false): Promise<void> {
        await this.streamManageModel.stop(streamId, isForce);
    }

    /**
     * すべてのストリームを停止
     * @return Promise<void>
     */
    public async stopAll(): Promise<void> {
        await this.streamManageModel.stopAll();
    }

    /**
     * 指定したストリームを停止しないように停止タイマー情報を更新させる
     * @param streamId: apid.StreamId
     */
    public keep(streamId: apid.StreamId): void {
        this.streamManageModel.keep(streamId);
    }

    /**
     * ストリーム情報を返す
     * @param isHalfWidth: boolean 半角文字で取得するか true なら半角文字
     * @return apid.StreamInfo
     */
    public async getStreamInfos(isHalfWidth: boolean): Promise<apid.StreamInfo> {
        const infos = this.streamManageModel.getStreamInfos();

        const items: (apid.LiveStreamInfoItem | apid.VideoFileStreamInfoItem)[] = [];
        const now = new Date().getTime();
        for (const info of infos) {
            if (info.info.type === 'LiveStream' || info.info.type === 'LiveHLS') {
                // ライブストリーミング
                const item: apid.LiveStreamInfoItem = {
                    streamId: info.streamId,
                    type: info.info.type,
                    mode: info.info.mode,
                    isEnable: info.info.isEnable,
                    channelId: info.info.channelId,
                    name: '',
                    startAt: 0,
                    endAt: 0,
                };
                const program = await this.programDB.findChannelIdAndTime(info.info.channelId, now);
                if (program !== null) {
                    item.name = isHalfWidth === true ? program.halfWidthName : program.name;
                    item.startAt = program.startAt;
                    item.endAt = program.endAt;
                    if (program.description !== null && program.halfWidthDescription !== null) {
                        item.description = isHalfWidth === true ? program.halfWidthDescription : program.description;
                    }
                    if (program.extended !== null && program.halfWidthExtended !== null) {
                        item.extended = isHalfWidth === true ? program.halfWidthExtended : program.extended;
                    }
                }

                items.push(item);
            } else if (info.info.type === 'RecordedStream' || info.info.type === 'RecordedHLS') {
                // ビデオストリーミング
                const item: apid.VideoFileStreamInfoItem = {
                    streamId: info.streamId,
                    type: info.info.type,
                    mode: info.info.mode,
                    isEnable: info.info.isEnable,
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
