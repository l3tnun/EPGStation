import * as apid from '../../../../../api';

export default interface IEncodeApiModel {
    gets(isHalfWidth: boolean): Promise<apid.EncodeInfo>;
    addEncode(option: apid.AddManualEncodeProgramOption): Promise<apid.EncodeId>;
    cancel(encodeId: apid.EncodeId): Promise<void>;
}
