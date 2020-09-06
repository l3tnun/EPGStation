import * as apid from '../../../../../api';

export default interface IStorageApiModel {
    getInfo(): Promise<apid.StorageInfo>;
}
