import * as apid from '../../../../api';

export default interface IChannelApiModel {
    getChannels(): Promise<apid.ChannelItem[]>;
}
