import * as apid from '../../../../api';

export default interface IDropLogApiModel {
    getIdFilePath(dropLogFileId: apid.DropLogFileId): Promise<string | null>;
}
