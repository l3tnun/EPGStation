import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import IDropLogFileDB from '../../db/IDropLogFileDB';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import IDropLogApiModel from './IDropLogApiModel';

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
     * @return Promise<string | null>
     */
    public async getIdFilePath(dropLogFileId: apid.DropLogFileId): Promise<string | null> {
        const dropLogFile = await this.dropLogFileDB.findId(dropLogFileId);
        if (dropLogFile === null) {
            return null;
        }

        return path.join(this.config.dropLog, dropLogFile.filePath);
    }
}
