import * as apid from '../../../../api';
import ApiModel from './ApiModel';

interface ChannelsApiModelInterface extends ApiModel {
    fetchChannel(): Promise<apid.ServiceItem[]>;
    getChannels(): apid.ServiceItem[];
    getChannel(channelId: apid.ServiceItemId): apid.ServiceItem | null;
}

/**
 * ChannelsApiModel
 * /api/channel を取得
 */
class ChannelsApiModel extends ApiModel implements ChannelsApiModelInterface {
    private channels: apid.ServiceItem[] = [];
    private channelIndex: { [key: number]: apid.ServiceItem } | null = null;

    /**
     * channel をすべて取得
     */
    public async fetchChannel(): Promise<apid.ServiceItem[]> {
        if (this.channelIndex === null) {
            this.channelIndex = {};
        } else {
            // 取得済み
            return this.channels;
        }

        try {
            this.channels = await <any> this.request({
                method: 'GET',
                url: './api/channels',
            });
        } catch (err) {
            this.channels = [];
            console.error('./api/channels');
            console.error(err);
            this.openSnackbar('チャンネル情報取得に失敗しました');
        }

        for (const channel of this.channels) {
            this.channelIndex[channel.id] = channel;
        }

        return this.channels;
    }

    /**
     * channel を取得
     */
    public getChannels(): apid.ServiceItem[] {
        return this.channels;
    }

    /**
     * channel id を指定して取得
     * @param channelId: channel id
     * @return apid.ServiceItem | null
     */
    public getChannel(channelId: apid.ServiceItemId): apid.ServiceItem | null {
        if (this.channelIndex === null) { return null; }

        const channel = this.channelIndex[channelId];

        return typeof channel === 'undefined' ? null : channel;
    }
}

export { ChannelsApiModelInterface, ChannelsApiModel };

