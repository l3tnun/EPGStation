import * as apid from '../../../../api';

export default interface IEncodeApiModel {
    add(addOption: apid.AddManualEncodeProgramOption): Promise<apid.EncodeId>;
}
