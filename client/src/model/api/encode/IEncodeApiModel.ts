import * as apid from '../../../../../api';

export default interface IEncodeApiModel {
    addEncode(option: apid.AddManualEncodeProgramOption): Promise<apid.EncodeId>;
}
