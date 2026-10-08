import { fileTypeFromFile } from 'file-type';
import { inject, injectable, optional } from 'inversify';
import * as path from 'path';
import type * as apid from '../../../../api.js';
import IRecordedDB from '../../db/IRecordedDB.js';
import IVideoFileDB from '../../db/IVideoFileDB.js';
import IConfiguration from '../../IConfiguration.js';
import IIPCClient from '../../ipc/IIPCClient.js';
import IStreamManageModel from '../../service/stream/manager/IStreamManageModel.js';
import { toLegacyRecordedDeliveryError } from '../../service/stream/recorded/RecordedDeliveryLeaseConsumer.js';
import IApiUtil from '../IApiUtil.js';
import IPlayList from '../IPlayList.js';
import IVideoApiModel, { VideoDelivery, VideoFilePathInfo } from './IVideoApiModel.js';
import IVideoUtil from './IVideoUtil.js';

/**
 * `IVideoApiModel` の実装。録画済み番組の実体ファイル（ビデオファイル）に対する配信
 * （`openDelivery`/`getFullFilePath`）・HLSプレイリスト生成・削除・長さ取得・kodiへの
 * リンク送信を行うAPI層の窓口。
 */
@injectable()
export default class VideoApiModel implements IVideoApiModel {
    private configuration: IConfiguration;
    private videoFileDB: IVideoFileDB;
    private recordedDB: IRecordedDB;
    private apiUtil: IApiUtil;
    private videoUtil: IVideoUtil;
    private ipc: IIPCClient;
    private streamManageModel?: Pick<IStreamManageModel, 'acquireRecordedDelivery'>;

    constructor(
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IApiUtil') apiUtil: IApiUtil,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
        @inject('IIPCClient') ipc: IIPCClient,
        @inject('IStreamManageModel')
        @optional()
        streamManageModel?: Pick<IStreamManageModel, 'acquireRecordedDelivery'>,
    ) {
        this.configuration = configuration;
        this.videoFileDB = videoFileDB;
        this.recordedDB = recordedDB;
        this.apiUtil = apiUtil;
        this.videoUtil = videoUtil;
        this.ipc = ipc;
        this.streamManageModel = streamManageModel;
    }

    /**
     * 指定した video fie id のファイルパスを返す
     * @param videoFileId: apid.VideoFileId
     * @return Promise<VideoFilePathInfo | null>
     */
    public async getFullFilePath(videoFileId: apid.VideoFileId): Promise<VideoFilePathInfo | null> {
        const fullPath = await this.videoUtil.getFullFilePathFromId(videoFileId);

        return fullPath === null
            ? null
            : {
                  path: fullPath,
                  mime: await this.createMime(fullPath),
              };
    }

    public async openDelivery(
        videoFileId: apid.VideoFileId,
        isActive: () => boolean = () => true,
    ): Promise<VideoDelivery | null> {
        if (this.streamManageModel === undefined) {
            throw new Error('StreamManageModelIsUndefined');
        }

        let delivery;
        try {
            delivery = await this.streamManageModel.acquireRecordedDelivery(videoFileId, 0, isActive);
        } catch (error: unknown) {
            const legacy = toLegacyRecordedDeliveryError(error);
            if (
                legacy.message === 'VideoIsNull' ||
                legacy.message === 'RecordedIsNull' ||
                legacy.message === 'GetVideoFilePathError'
            ) {
                return null;
            }
            throw legacy;
        }

        try {
            const mime = await this.createMime(delivery.source.inputPath);
            if (isActive() === false) {
                throw new Error('RecordedDeliveryStopped');
            }
            return {
                isTail: delivery.source.kind === 'recording-tail-reader',
                mime,
                path: delivery.source.inputPath,
                reader: delivery.source.kind === 'encoded-direct' ? undefined : delivery.source.reader,
                release: () => delivery.release(),
            };
        } catch (error: unknown) {
            await delivery.release();
            throw error;
        }
    }

    /**
     * 指定されたファイルパスからファイルの mime を返す
     * @param filePath: string ファイルパス
     * @return Promise<string>
     */
    private async createMime(filePath: string): Promise<string> {
        const mime = await fileTypeFromFile(filePath);
        if (typeof mime !== 'undefined') {
            // Matroska は公開 API の応答定義が列挙する video/x-matroska に統一する
            return mime.mime === 'video/matroska' ? 'video/x-matroska' : mime.mime;
        }

        switch (path.extname(filePath)) {
            case '.m2ts':
            case '.ts':
                return 'video/mp2t';
            default:
                throw new Error('MimeTypeError');
        }
    }

    /**
     * 指定した videoFileId の m3u8 形式プレイリスト文字列を取得する
     * @param host: string host
     * @param isSecure: boolean https 通信か
     * @param videoFileId: apid.VideoFileId
     * @return Promise<IPlayList | null>
     */
    public async getM3u8(host: string, isSecure: boolean, videoFileId: apid.VideoFileId): Promise<IPlayList | null> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null || typeof video.recordedId === 'undefined') {
            return null;
        }

        const recorded = await this.recordedDB.findId(video?.recordedId);
        if (recorded === null) {
            return null;
        }

        return {
            name: encodeURIComponent(path.basename(video.filePath) + '.m3u8'),
            playList: this.apiUtil.createM3U8PlayListStr({
                host: host,
                isSecure: isSecure,
                name: recorded.name,
                duration: Math.floor(recorded.duration / 1000),
                baseUrl: `/api/videos/${videoFileId}`,
            }),
        };
    }

    /**
     * 指定した video file id のファイルを削除
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async deleteVideoFile(videoFileId: apid.VideoFileId): Promise<void> {
        await this.ipc.recorded.deleteVideoFile(videoFileId);
    }

    /**
     * 指定した video file id のファイルの動画長を取得する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<number> 秒
     */
    public async getDuration(videoFileId: apid.VideoFileId): Promise<number> {
        const filePath = await this.videoUtil.getFullFilePathFromId(videoFileId);
        if (filePath === null) {
            throw new Error('VideoFileIsUndefined');
        }

        const videoInfo = await this.videoUtil.getInfo(filePath);

        return videoInfo.duration;
    }

    public async sendToKodi(
        host: string,
        isSecure: boolean,
        kodiName: string,
        videoFileId: apid.VideoFileId,
    ): Promise<void> {
        host = this.apiUtil.getHost(host);

        // kodiName で指定された kodi host を config から探す
        const config = this.configuration.getConfig();
        if (typeof config.kodiHosts === 'undefined') {
            throw new Error('KodiHostsIsUndefined');
        }
        const kodi = config.kodiHosts.find(k => {
            return k.name === kodiName;
        });
        if (typeof kodi === 'undefined') {
            throw new Error('KodiHostIsUndefined');
        }

        const videoFile = await this.videoFileDB.findId(videoFileId);
        if (videoFile === null) {
            throw new Error('VideoFileIsUndefined');
        }

        const source = `${isSecure ? 'https' : 'http'}://${host}/api/videos/${videoFileId}`;

        return this.apiUtil.sendToKodi(source, kodi);
    }
}
