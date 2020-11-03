import * as apid from '../../../../api';

export default interface IConfigApiModel {
    getConfig(isSecure: boolean): Promise<apid.Config>;
}
