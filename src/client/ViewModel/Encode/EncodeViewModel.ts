import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import { ChannelsApiModelInterface } from '../../Model/Api/ChannelsApiModel';
import { EncodingApiModelInterface } from '../../Model/Api/EncodingApiModel';
import DateUtil from '../../Util/DateUtil';
import Util from '../../Util/Util';
import ViewModel from '../ViewModel';


/**
 * EncodeViewModel
 */
class EncodeViewModel extends ViewModel {
    private encodingApiModel: EncodingApiModelInterface;
    private channels: ChannelsApiModelInterface;
    private encodes: apid.EncodingProgram[] = [];

    constructor(
        encodingApiModel: EncodingApiModelInterface,
        channels: ChannelsApiModelInterface,
    ) {
        super();

        this.encodingApiModel = encodingApiModel;
        this.channels = channels;
    }

    /**
     * init
     * @param status: ViewModelStatus
     */
    public async init(status: ViewModelStatus = 'init'): Promise<void> {
        super.init(status);

        this.encodingApiModel.init();

        await Util.sleep(100);
        await this.fetchData();
    }

    /**
     * fetchData
     */
    private async fetchData(): Promise<void> {
        await this.encodingApiModel.fetchInfo();
        const info = this.encodingApiModel.getInfo();

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

    /**
     * get time str
     * @param recorded: apid.RecordedProgram
     * @return string
     */
    public getTimeStr(recorded: apid.RecordedProgram): string {
        const start = DateUtil.getJaDate(new Date(recorded.startAt));
        const end = DateUtil.getJaDate(new Date(recorded.endAt));
        const duration = Math.floor((recorded.endAt - recorded.startAt) / 1000 / 60);

        return DateUtil.format(start, 'MM/dd(w) hh:mm:ss') + ' ~ ' + DateUtil.format(end, 'hh:mm:ss') + `(${ duration }分)`;
    }
}

export default EncodeViewModel;

