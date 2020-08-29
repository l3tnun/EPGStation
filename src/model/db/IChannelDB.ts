import * as apid from '../../../api';
import * as mapid from '../../../node_modules/mirakurun/api';
import Channel from '../../db/entities/Channel';

export interface ChannelUpdateValues {
    insert: mapid.Service[];
    update: mapid.Service[];
}

export default interface IChannelDB {
    insert(channels: mapid.Service[]): Promise<void>;
    update(values: ChannelUpdateValues): Promise<void>;
    findId(channelId: apid.ChannelId): Promise<Channel | null>;
    findChannleTypes(types: apid.ChannelType[], needSort?: boolean): Promise<Channel[]>;
    findAll(needSort?: boolean): Promise<Channel[]>;
}
