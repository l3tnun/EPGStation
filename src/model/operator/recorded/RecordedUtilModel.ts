import { inject, injectable } from 'inversify';
import * as path from 'path';
import VideoFile from '../../../db/entities/VideoFile';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import IRecordedUtilModel from './IRecordedUtilModel';

@injectable()
export default class RecordedUtilModel implements IRecordedUtilModel {
    private config: IConfigFile;

    constructor(@inject('IConfiguration') configuration: IConfiguration) {
        this.config = configuration.getConfig();
    }

    /**
     * VideoFile からファイルパスを取得する
     * @param videoFile: VideoFile
     */
    public getVideoFilePath(videoFile: VideoFile): string {
        const parentDir = this.config.recorded.find(r => {
            return r.name === videoFile.parentDirectoryName;
        });

        if (typeof parentDir === 'undefined') {
            throw new Error('ParentDirectoryIsNotFound');
        }

        return path.join(parentDir.path, videoFile.filePath);
    }
}
