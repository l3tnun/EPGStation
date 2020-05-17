import * as apid from '../../../../../api';

export default interface IConfigApiModel {
    getConfig(): Promise<apid.Config>;
}
