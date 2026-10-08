import { BroadcastType } from '../tuner/types.js';

/**
 * 番組情報を insert するときに使用する局索引情報
 */
export default interface IChannelTypeIndex {
    // NetworkId
    [key: number]: {
        // ServiceId
        [key: number]: {
            id: number; // channelId
            type: BroadcastType;
            channel: string;
        };
    };
}
