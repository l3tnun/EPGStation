import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import IVideoFileDB from '../../db/IVideoFileDB';
import IEncodeManageModel from '../../service/encode/IEncodeManageModel';
import IEncodeApiModel from './IEncodeApiModel';

@injectable()
export default class EncodeApiModel implements IEncodeApiModel {
    private encodeManage: IEncodeManageModel;
    private videoFileDB: IVideoFileDB;

    constructor(
        @inject('IEncodeManageModel') encodeManage: IEncodeManageModel,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
    ) {
        this.encodeManage = encodeManage;
        this.videoFileDB = videoFileDB;
    }

    /**
     * エンコード手動追加
     * @param addOption: apid.AddManualEncodeProgramOption
     * @return Promise<apid.EncodeId>
     */
    public async add(addOption: apid.AddManualEncodeProgramOption): Promise<apid.EncodeId> {
        if (typeof addOption.parentDir === 'undefined' && !!addOption.isSaveSameDirectory === false) {
            throw new Error('OptionError');
        }

        let option: apid.AddEncodeProgramOption;
        if (typeof addOption.parentDir !== 'undefined') {
            option = {
                recordedId: addOption.recordedId,
                sourceVideoFileId: addOption.sourceVideoFileId,
                parentDir: addOption.parentDir,
                directory: addOption.directory,
                mode: addOption.mode,
                removeOriginal: addOption.removeOriginal,
            };
        } else {
            const video = await this.videoFileDB.findId(addOption.sourceVideoFileId);
            if (video === null) {
                throw new Error('VideoFileIsNotFound');
            }

            let directory: string | null = path.dirname(video.filePath);
            if (directory === '.' || directory === path.posix.sep || directory === path.win32.sep) {
                directory = null;
            }

            option = {
                recordedId: addOption.recordedId,
                sourceVideoFileId: addOption.sourceVideoFileId,
                parentDir: video.parentDirectoryName,
                mode: addOption.mode,
                removeOriginal: addOption.removeOriginal,
            };

            if (directory !== null) {
                option.directory = directory;
            }
        }

        return await this.encodeManage.push(option);
    }
}
