import { inject, injectable } from 'inversify';
import * as path from 'path';
import type * as apid from '../../../../api.js';
import FileUtil from '../../../util/FileUtil.js';
import IDropLogFileDB from '../../db/IDropLogFileDB.js';
import IConfigFile from '../../IConfigFile.js';
import IConfiguration from '../../IConfiguration.js';
import IDropLogApiModel, { DropLogApiErrors } from './IDropLogApiModel.js';

/** `IDropLogApiModel` の実装。詳細は `IDropLogApiModel` を参照。 */
@injectable()
export default class DropLogApiModel implements IDropLogApiModel {
    private config: IConfigFile;
    private dropLogFileDB: IDropLogFileDB;

    constructor(
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IDropLogFileDB') dropLogFileDB: IDropLogFileDB,
    ) {
        this.dropLogFileDB = dropLogFileDB;
        this.config = configuration.getConfig();
    }

    /**
     * 指定した id のドロップログのファイルパスを返す
     * @param dropLogFileId: apid.DropLogFileId
     * @param maxSize: number ファイルの最大サイズ (kByte)
     * @return Promise<string | null>
     */
    public async getIdFilePath(dropLogFileId: apid.DropLogFileId, maxSize: number): Promise<string | null> {
        const dropLogFile = await this.dropLogFileDB.findId(dropLogFileId);
        if (dropLogFile === null) {
            return null;
        }

        const filePath = path.join(this.config.dropLog, dropLogFile.filePath);
        const fileSize = await FileUtil.getFileSize(filePath);

        if (fileSize > maxSize * 1024) {
            throw new Error(DropLogApiErrors.FILE_IS_TOO_LARGE);
        }

        return filePath;
    }
}
