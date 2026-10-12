import { inject, injectable } from 'inversify';
import * as path from 'path';
import type * as apid from '../../../../api.js';
import IThumbnailDB from '../../db/IThumbnailDB.js';
import IConfigFile from '../../IConfigFile.js';
import IConfiguration from '../../IConfiguration.js';
import IIPCClient from '../../ipc/IIPCClient.js';
import IThumbnailApiModel from './IThumbnailApiModel.js';

/** `IThumbnailApiModel` の実装。詳細は `IThumbnailApiModel` を参照。 */
@injectable()
export default class ThumbnailApiModel implements IThumbnailApiModel {
    private ipc: IIPCClient;
    private thumbnailDB: IThumbnailDB;
    private config: IConfigFile;

    constructor(
        @inject('IIPCClient') ipc: IIPCClient,
        @inject('IThumbnailDB') thumbnailDB: IThumbnailDB,
        @inject('IConfiguration') configuration: IConfiguration,
    ) {
        this.ipc = ipc;
        this.thumbnailDB = thumbnailDB;
        this.config = configuration.getConfig();
    }

    /**
     * 指定した id のサムネイルファイルパスを返す
     * @param thumbnailId: apid.ThumbnailId
     * @return Promise<string | null>
     */
    public async getIdFilePath(thumbnailId: apid.ThumbnailId): Promise<string | null> {
        const thumbnail = await this.thumbnailDB.findId(thumbnailId);
        if (thumbnail === null) {
            return null;
        }

        return path.join(this.config.thumbnail, thumbnail.filePath);
    }

    /**
     * サムネイルの再生成を行う
     * @return Promise<void>
     */
    public regenerate(): Promise<void> {
        return this.ipc.thumbnail.regenerate();
    }

    /**
     * ファイルのクリーンアップ
     */
    public async fileCleanup(): Promise<void> {
        await this.ipc.thumbnail.fileCleanup();
    }

    /**
     * 指定したビデオファイルでサムネイルを追加させる
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async add(videoFileId: apid.VideoFileId): Promise<void> {
        await this.ipc.thumbnail.add(videoFileId);
    }

    /**
     * 指定した id サムネイルを削除
     * @param thumbnailId: apid.ThumbnailId
     * @return Promise<void>
     */
    public async delete(thumbnailId: apid.ThumbnailId): Promise<void> {
        await this.ipc.thumbnail.delete(thumbnailId);
    }
}
