import * as apid from '../../../../api';

export default interface IEncodeApiModel {
    getAll(isHalfWidth: boolean): Promise<apid.EncodeInfo>;
    add(addOption: apid.AddManualEncodeProgramOption): Promise<apid.EncodeId>;
    cancel(encodeId: apid.EncodeId): Promise<void>;
}
