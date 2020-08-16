import * as apid from '../../../../api';

export namespace IChannelApiModelError {
    export const NOT_FOUND = 'notfound';
}

export default interface IChannelApiModel {
    getChannels(): Promise<apid.ChannelItem[]>;
    getLogo(channelId: apid.ChannelId): Promise<Buffer>;
}
