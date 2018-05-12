import * as apid from '../../../../api';
import { ProgramsDBInterface } from '../DB/ProgramsDB';
import { RecordedDBInterface } from '../DB/RecordedDB';
import { ServicesDBInterface } from '../DB/ServicesDB';
import HLSLiveStream from '../Service/Stream/HLSLiveStream';
import MpegTsLiveStream from '../Service/Stream/MpegTsLiveStream';
import RecordedHLSStream from '../Service/Stream/RecordedHLSStream';
import RecordedStreamingMpegTsStream from '../Service/Stream/RecordedStreamingMpegTsStream';
import { Stream } from '../Service/Stream/Stream';
import { LiveStreamStatusInfo, StreamManageModelInterface } from '../Service/Stream/StreamManageModel';
import WebMLiveStream from '../Service/Stream/WebMLiveStream';
import ApiModel from './ApiModel';
import ApiUtil from './ApiUtil';
import { PlayList } from './PlayListInterface';

interface StreamModelInfo {
    stream: Stream;
    streamNumber: number;
}

namespace StreamsModelInterface {
    export const channleIsNotFoundError = 'channelIsNotDound';
}

interface StreamsModelInterface extends ApiModel {
    getHLSLive(channelId: apid.ServiceItemId, mode: number): Promise<number>;
    getWebMLive(channelId: apid.ServiceItemId, mode: number): Promise<StreamModelInfo>;
    getLiveMpegTs(channelId: apid.ServiceItemId, mode: number): Promise<StreamModelInfo>;
    getRecordedHLS(recordedId: apid.RecordedId, mode: number, encodedId: apid.EncodedId | null): Promise<number>;
    getRecordedStreamingMpegTs(recordedId: apid.RecordedId, mode: number, startTime: number, headerRangeStr: string | null): Promise<{ stream: RecordedStreamingMpegTsStream; streamNumber: number }>;
    stop(streamNumber: number): Promise<void>;
    forcedStopAll(): Promise<void>;
    getInfos(): any;
    getLiveM3u8(host: string, isSecure: boolean, channelId: apid.ServiceItemId, mode: number): Promise<PlayList>;
}

class StreamsModel extends ApiModel implements StreamsModelInterface {
    private createHLSLiveStream: (channelId: apid.ServiceItemId, mode: number) => HLSLiveStream;
    private createWebMLiveStream: (channelId: apid.ServiceItemId, mode: number) => WebMLiveStream;
    private createMpegTsLiveStream: (channelId: apid.ServiceItemId, mode: number) => MpegTsLiveStream;
    private createRecordedHLSStream: (recordedId: apid.RecordedId, mode: number, encodedId: apid.EncodedId | null) => RecordedHLSStream;
    private createRecordedStreamingMpegTsStream: (recordedId: apid.RecordedId, mode: number, startTime: number, headerRangeStr: string | null) => RecordedStreamingMpegTsStream;
    private streamManage: StreamManageModelInterface;
    private programDB: ProgramsDBInterface;
    private servicesDB: ServicesDBInterface;
    private recordedDB: RecordedDBInterface;

    constructor(
        streamManage: StreamManageModelInterface,
        createHLSLiveStream: (channelId: apid.ServiceItemId, mode: number) => HLSLiveStream,
        createWebMLiveStream: (channelId: apid.ServiceItemId, mode: number) => WebMLiveStream,
        createMpegTsLiveStream: (channelId: apid.ServiceItemId, mode: number) => MpegTsLiveStream,
        createRecordedHLSStream: (recordedId: apid.RecordedId, mode: number, encodedId: apid.EncodedId | null) => RecordedHLSStream,
        createRecordedStreamingMpegTsStream: (recordedId: apid.RecordedId, mode: number, startTime: number, headerRangeStr: string | null) => RecordedStreamingMpegTsStream,
        programDB: ProgramsDBInterface,
        servicesDB: ServicesDBInterface,
        recordedDB: RecordedDBInterface,
    ) {
        super();
        this.streamManage = streamManage;
        this.createHLSLiveStream = createHLSLiveStream;
        this.createWebMLiveStream = createWebMLiveStream;
        this.createMpegTsLiveStream = createMpegTsLiveStream;
        this.createRecordedHLSStream = createRecordedHLSStream;
        this.createRecordedStreamingMpegTsStream = createRecordedStreamingMpegTsStream;
        this.programDB = programDB;
        this.servicesDB = servicesDB;
        this.recordedDB = recordedDB;
    }

    /**
     * HLS ライブ視聴
     * @param channelId: channel id
     * @param mode: config.MpegTsStreaming の index 番号
     * @return Promise<number>
     */
    public async getHLSLive(channelId: apid.ServiceItemId, mode: number): Promise<number> {
        // 同じパラメータの stream がないか確認する
        const infos = this.streamManage.getStreamInfos();
        for (const info of infos) {
            if (info.type === 'HLSLive' && (<LiveStreamStatusInfo> info).channelId === channelId && info.mode === mode) {
                return info.streamNumber;
            }
        }

        const stream = this.createHLSLiveStream(channelId, mode);

        return await this.streamManage.start(stream);
    }

    /**
     * webm ライブ視聴
     * @param channelId: channel id
     * @param mode: config.MpegTsStreaming の index 番号
     * @return Promise<StreamModelInfo>
     */
    public async getWebMLive(channelId: apid.ServiceItemId, mode: number): Promise<StreamModelInfo> {
        const stream = this.createWebMLiveStream(channelId, mode);
        const streamNumber = await this.streamManage.start(stream);

        const result = this.streamManage.getStream(streamNumber);
        if (result === null) { throw new Error('CreateStreamError'); }

        const encChild = result.getEncChild();
        if (encChild !== null) {
            encChild.stderr.on('data', (data) => {
                this.log.stream.debug(String(data));
            });
        }

        return { stream: result, streamNumber: streamNumber };
    }

    /**
     * MpegTs ライブ視聴
     * @param channelId: channel id
     * @param mode: config.MpegTsStreaming の index 番号
     * @return Promise<StreamModelInfo>
     */
    public async getLiveMpegTs(channelId: apid.ServiceItemId, mode: number): Promise<StreamModelInfo> {
        // 同じパラメータの stream がないか確認する
        const infos = this.streamManage.getStreamInfos();
        for (const info of infos) {
            if (info.type === 'MpegTsLive' && (<LiveStreamStatusInfo> info).channelId === channelId && info.mode === mode) {
                return {
                    stream: this.streamManage.getStream(info.streamNumber)!,
                    streamNumber: info.streamNumber,
                };
            }
        }

        const stream = this.createMpegTsLiveStream(channelId, mode);
        const streamNumber = await this.streamManage.start(stream);

        const result = this.streamManage.getStream(streamNumber);
        if (result === null) { throw new Error('CreateStreamError'); }

        const encChild = result.getEncChild();
        if (encChild !== null) {
            encChild.stderr.on('data', (data) => {
                this.log.stream.debug(String(data));
            });
        }

        return { stream: result, streamNumber: streamNumber };
    }

    /**
     * 録画済みファイル HLS 配信
     * @param recordedId: recorded id
     * @param mode: config.recordedHLS の index 番号
     * @param encodedId: encodedId | null
     * @return Promise<number> stream number
     */
    public async getRecordedHLS(recordedId: apid.RecordedId, mode: number, encodedId: apid.EncodedId | null): Promise<number> {
        const stream = this.createRecordedHLSStream(recordedId, mode, encodedId);

        return await this.streamManage.start(stream);
    }

    /**
     * 録画済みファイル mpeg ts ストリーミング配信
     * @param recordedId: recorded id
     * @param mode: mode
     * @param startTime: 開始時刻(秒)
     * @param: request.headers.range
     */
    public async getRecordedStreamingMpegTs(recordedId: apid.RecordedId, mode: number, startTime: number, headerRangeStr: string | null): Promise<{ stream: RecordedStreamingMpegTsStream; streamNumber: number }> {
        const stream = this.createRecordedStreamingMpegTsStream(recordedId, mode, startTime, headerRangeStr);
        const streamNumber = await this.streamManage.start(stream);

        if (this.streamManage.getStream(streamNumber) === null) { throw new Error('CreateStreamError'); }

        return { stream: stream, streamNumber: streamNumber };
    }

    /**
     * stop stream
     */
    public stop(streamNumber: number): Promise<void> {
        return this.streamManage.stop(streamNumber);
    }

    /**
     * すべてのストリームを強制停止
     */
    public forcedStopAll(): Promise<void> {
        return this.streamManage.forcedStopAll();
    }

    /**
     * ストリーム情報を取得
     */
    public async getInfos(): Promise<{ [key: string]: any }[]> {
        const infos: { [key: string]: any }[] = this.streamManage.getStreamInfos();

        for (const info of infos) {
            if (typeof info.type === 'undefined') { continue; }
            if (info.type.includes('Live') && typeof info.channelId !== 'undefined') {
                const channel = await this.servicesDB.findId(info.channelId);
                const program = await this.programDB.findBroadcastingChanel(info.channelId);

                if (channel !== null) {
                    info.channelName = channel.name;
                }

                if (program.length > 0) {
                    info.title = program[0].name;
                    info.startAt = program[0].startAt;
                    info.endAt = program[0].endAt;
                    info.channelType = program[0].channelType;
                    if (program[0].description !== null) { info.description = program[0].description; }
                    if (program[0].extended !== null) { info.extended = program[0].extended; }
                }
            }

            if (info.type.includes('Recorded') && typeof info.recordedId !== 'undefined') {
                const recorded = await this.recordedDB.findId(info.recordedId);

                if (recorded !== null) {
                    const channel = await this.servicesDB.findId(recorded.channelId);
                    info.channelName = channel !== null ? channel.name : String(recorded.channelId);

                    info.title = recorded.name;
                    info.startAt = recorded.startAt;
                    info.endAt = recorded.endAt;
                    info.channelType = recorded.channelType;
                    if (recorded.description !== null) { info.description = recorded.description; }
                    if (recorded.extended !== null) { info.extended = recorded.extended; }
                }
            }
        }

        return infos;
    }

    /**
     * ライブ視聴用の m3u8 ファイルを生成
     * @param host: host
     * @param channelId: channel id
     * @param mode: config.MpegTsStreaming の index 番号
     * @return Promise<PlayList>
     */
    public async getLiveM3u8(host: string, isSecure: boolean, channelId: apid.ServiceItemId, mode: number): Promise<PlayList> {
        const channel = await this.servicesDB.findId(channelId);
        if (channel === null) { throw new Error(StreamsModelInterface.channleIsNotFoundError); }

        return {
            name: encodeURIComponent(channel.name + '.m3u8'),
            playList: ApiUtil.createM3U8PlayListStr({
                host: host,
                isSecure: isSecure,
                name: channel.name,
                duration: 0,
                baseUrl: `/api/streams/live/${ channelId }/mpegts?mode=${ mode }`,
                basicAuth: this.config.getConfig().basicAuth,
            }),
        };
    }
}

export { StreamModelInfo, StreamsModelInterface, StreamsModel };

