import * as apid from '../../../../../api';

export default interface IDropLogApiModel {
    get(dropLogFileId: apid.DropLogFileId, maxsize?: number): Promise<string>;
}
