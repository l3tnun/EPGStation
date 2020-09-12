import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import IThumbnailDB from '../../db/IThumbnailDB';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import IIPCClient from '../../ipc/IIPCClient';
import IThumbnailApiModel from './IThumbnailApiModel';

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
}
