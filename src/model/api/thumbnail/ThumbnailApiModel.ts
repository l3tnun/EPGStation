import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import IThumbnailDB from '../../db/IThumbnailDB';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import IThumbnailApiModel from './IThumbnailApiModel';

@injectable()
export default class ThumbnailApiModel implements IThumbnailApiModel {
    private thumbnailDB: IThumbnailDB;
    private config: IConfigFile;

    constructor(
        @inject('IThumbnailDB') thumbnailDB: IThumbnailDB,
        @inject('IConfiguration') configuration: IConfiguration,
    ) {
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
}
