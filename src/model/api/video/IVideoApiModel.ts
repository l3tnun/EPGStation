import type * as apid from '../../../../api.js';
import type { RecordedPlaybackReader } from '../../operator/recorded/IRecordedPlaybackSourceProvider.js';
import IPlayList from '../IPlayList.js';

/** ビデオファイルの実ファイルパスとMIMEタイプ。`getFullFilePath`が返す、配信に必要な最小限の情報。 */
export interface VideoFilePathInfo {
    path: string;
    mime: string;
}

/** Internal response ownership only; it is never exposed through the HTTP API. */
export interface VideoDelivery extends VideoFilePathInfo {
    readonly isTail?: boolean;
    readonly reader?: RecordedPlaybackReader;
    release(): Promise<void>;
}

/**
 * 録画済みビデオファイル（実体file）に対するAPI層の契約。ファイルパス取得・配信のための
 * 貸し出し（`openDelivery`）・プレイリスト生成・削除・長さ取得・kodi連携を提供する。
 * 実装は `VideoApiModel`。
 */
export default interface IVideoApiModel {
    getFullFilePath(videoFileId: apid.VideoFileId): Promise<VideoFilePathInfo | null>;
    openDelivery(videoFileId: apid.VideoFileId, isActive?: () => boolean): Promise<VideoDelivery | null>;
    getM3u8(host: string, isSecure: boolean, videoFileId: apid.VideoFileId): Promise<IPlayList | null>;
    deleteVideoFile(videoFileId: apid.VideoFileId): Promise<void>;
    getDuration(videoFileId: apid.VideoFileId): Promise<number>;
    sendToKodi(host: string, isSecure: boolean, kodiName: string, videoFileId: apid.VideoFileId): Promise<void>;
}
