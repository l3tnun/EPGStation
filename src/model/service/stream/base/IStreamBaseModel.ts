import internal from 'stream';
import * as apid from '../../../../../api';

/**
 * ストリーム情報ベース
 */
export interface BaseStreamInfo {
    type: apid.StreamType;
    mode: number;
    isEnable: boolean;
}

/**
 * ライブストリーム情報
 */
export interface LiveStreamInfo extends BaseStreamInfo {
    type: 'LiveStream' | 'LiveHLS';
    channelId: apid.ChannelId;
}

/**
 * 録画ファイルストリーム情報
 */
export interface RecordedStreamInfo extends BaseStreamInfo {
    type: 'RecordedStream' | 'RecordedHLS';
    videoFileId: apid.VideoFileId;
}

export default interface IStreamBaseModel<T> {
    setOption(option: T, mode: number): void;
    start(streamId: apid.StreamId): Promise<void>;
    stop(): Promise<void>;
    getStream(): internal.Readable;
    getInfo(): LiveStreamInfo | RecordedStreamInfo;
    setExitStream(callback: () => void): void;
    keep(): void;
}
