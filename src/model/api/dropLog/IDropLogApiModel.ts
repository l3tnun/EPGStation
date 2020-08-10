import * as apid from '../../../../api';

export namespace DropLogApiErrors {
    export const FILE_IS_TOO_LARGE = 'FileIsTooLarge';
}
export default interface IDropLogApiModel {
    getIdFilePath(dropLogFileId: apid.DropLogFileId, maxSize: number): Promise<string | null>;
}
