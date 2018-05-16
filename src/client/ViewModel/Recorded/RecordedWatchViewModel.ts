import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import { ChannelsApiModelInterface } from '../../Model/Api/ChannelsApiModel';
import { RecordedApiModelInterface } from '../../Model/Api/RecordedApiModel';
import ViewModel from '../ViewModel';

/**
 * RecordedWatchViewModel
 */
class RecordedWatchViewModel extends ViewModel {
    private recordedApiModel: RecordedApiModelInterface;
    private channels: ChannelsApiModelInterface;

    private recordedId: apid.RecordedId;

    constructor(
        recordedApiModel: RecordedApiModelInterface,
        channels: ChannelsApiModelInterface,
    ) {
        super();

        this.recordedApiModel = recordedApiModel;
        this.channels = channels;
    }

    /**
     * init
     */
    public async init(status: ViewModelStatus = 'init'): Promise<void> {
        super.init(status);

        this.recordedId = parseInt(m.route.param('recordedId'), 10);
        await this.fetchData();
    }

    /**
     * fetch data
     */
    private async fetchData(): Promise<void> {
        await this.recordedApiModel.fetchRecorded(this.recordedId);
    }

    /**
     * get Recorded
     * @return apid.RecordedProgram | null
     */
    public getRecorded(): apid.RecordedProgram | null {
        return this.recordedApiModel.getRecorded();
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

export default RecordedWatchViewModel;

