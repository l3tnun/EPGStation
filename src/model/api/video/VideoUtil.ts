import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import IVideoFileDB from '../../db/IVideoFileDB';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import IVideoUtil from './IVideoUtil';

@injectable()
export default class VideoUtil implements IVideoUtil {
    private config: IConfigFile;
    private videoFileDB: IVideoFileDB;

    constructor(
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
    ) {
        this.config = configuration.getConfig();
        this.videoFileDB = videoFileDB;
    }

    public async getFullFilePath(videoFileId: apid.VideoFileId): Promise<string | null> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) {
            return null;
        }

        const parentDir = this.getParentDirPath(video.parentDirectoryName);

        return parentDir === null ? null : path.join(parentDir, video.filePath);
    }

    public getParentDirPath(name: string): string | null {
        for (const r of this.config.recorded) {
            if (r.name === name) {
                return r.path;
            }
        }

        return null;
    }
}
