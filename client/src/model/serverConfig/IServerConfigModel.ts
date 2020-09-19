import * as apid from '../../../../api';

export default interface IServerConfigModel {
    fetchConfig(): Promise<void>;
    getConfig(): apid.Config | null;
    isEnableEncode(): boolean;
    isEnableSendVideoFileLinkToKodi(): boolean;
}
