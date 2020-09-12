import { execFile } from 'child_process';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import VideoFile from '../../../db/entities/VideoFile';
import IVideoFileDB from '../../db/IVideoFileDB';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import IVideoUtil, { VideoInfo } from './IVideoUtil';

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

    public async getFullFilePathFromId(videoFileId: apid.VideoFileId): Promise<string | null> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) {
            return null;
        }

        const parentDir = this.getParentDirPath(video.parentDirectoryName);

        return parentDir === null ? null : path.join(parentDir, video.filePath);
    }

    public getFullFilePathFromVideoFile(videoFile: VideoFile): string | null {
        const parentDir = this.getParentDirPath(videoFile.parentDirectoryName);

        return parentDir === null ? null : path.join(parentDir, videoFile.filePath);
    }

    public getParentDirPath(name: string): string | null {
        if (name === 'tmp' && typeof this.config.recordedTmp !== 'undefined') {
            return this.config.recordedTmp;
        }

        for (const r of this.config.recorded) {
            if (r.name === name) {
                return r.path;
            }
        }

        return null;
    }

    public getInfo(filePath: string): Promise<VideoInfo> {
        return new Promise<VideoInfo>((resolve, reject) => {
            execFile(this.config.ffprobe, ['-v', '0', '-show_format', '-of', 'json', filePath], (err, stdout) => {
                if (err) {
                    reject(err);

                    return;
                }

                try {
                    const result = <any>JSON.parse(stdout);
                    resolve({
                        duration: parseFloat(result.format.duration),
                        size: parseInt(result.format.size, 10),
                        bitRate: parseFloat(result.format.bit_rate),
                    });
                } catch (err) {
                    reject(err);
                }
            });
        });
    }
}
