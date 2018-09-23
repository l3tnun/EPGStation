import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import { ChannelsApiModelInterface } from '../../Model/Api/ChannelsApiModel';
import { EncodeApiModelInterface } from '../../Model/Api/EncodeApiModel';
import Util from '../../Util/Util';
import ViewModel from '../ViewModel';


/**
 * EncodeViewModel
 */
class EncodeViewModel extends ViewModel {
    private encodeApiModel: EncodeApiModelInterface;
    private channels: ChannelsApiModelInterface;
    private encodes: apid.EncodingProgram[] = [];

    constructor(
        encodeApiModel: EncodeApiModelInterface,
        channels: ChannelsApiModelInterface,
    ) {
        super();

        this.encodeApiModel = encodeApiModel;
        this.channels = channels;
    }

    /**
     * init
     * @param status: ViewModelStatus
     */
    public async init(status: ViewModelStatus = 'init'): Promise<void> {
        super.init(status);

        this.encodeApiModel.init();

        await Util.sleep(100);
        await this.fetchData();
    }

    /**
     * fetchData
     */
    private async fetchData(): Promise<void> {
        await this.encodeApiModel.fetchInfo();
        const info = this.encodeApiModel.getInfo();

        if (typeof info.encoding === 'undefined') {
            this.encodes = [];

            return;
        }

        this.encodes = [info.encoding];
        this.encodes.push(...info.queue);
    }

    /**
     * encode 一覧を返す
     * @return apid.EncodingProgram[]
     */
    public getEncodes(): apid.EncodingProgram[] {
        return this.encodes;
    }

    /**
     * id を指定して channel 名を取得する
     * @param channelId: channel id
     * @return string
     */
    public getChannelName(channelId: number): string {
        const channel = this.channels.getChannel(channelId);

        return channel === null ? String(channelId) : channel.name;
    }
}

export default EncodeViewModel;

