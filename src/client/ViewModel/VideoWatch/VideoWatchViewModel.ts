import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import { ChannelsApiModelInterface } from '../../Model/Api/ChannelsApiModel';
import { RecordedApiModelInterface } from '../../Model/Api/RecordedApiModel';
import { StreamsApiModelInterface } from '../../Model/Api/StreamsApiModel';
import ViewModel from '../ViewModel';

/**
 * VideoWatchViewModel
 */
class VideoWatchViewModel extends ViewModel {
    private recordedApiModel: RecordedApiModelInterface;
    private channelsApiModel: ChannelsApiModelInterface;
    private streamApiModel: StreamsApiModelInterface;
    private recordedId: apid.RecordedId | null = null;
    private encodedId: apid.EncodedId | null = null;
    private channelId: apid.ServiceItemId | null = null;
    private type: string | null = null;
    private mode: number | null = null;
    private dummyTime: number;

    constructor(
        recordedApiModel: RecordedApiModelInterface,
        channelsApiModel: ChannelsApiModelInterface,
        streamApiModel: StreamsApiModelInterface,
    ) {
        super();
        this.recordedApiModel = recordedApiModel;
        this.channelsApiModel = channelsApiModel;
        this.streamApiModel = streamApiModel;
    }

    /**
     * init
     * @param status: ViewModelStatus
     */
    public async init(status: ViewModelStatus): Promise<void> {
        super.init(status);

        if (status === 'init' || status === 'update') {
            this.streamApiModel.init();
            this.dummyTime = new Date().getTime();
        }

        // set recordedId
        const recordedId = m.route.param('recordedId');
        this.recordedId = typeof recordedId === 'undefined' ? null : parseInt(recordedId, 10);

        // set encodedId
        const encodedId = m.route.param('encodedId');
        this.encodedId = typeof encodedId === 'undefined' ? null : parseInt(encodedId, 10);

        // set channelId
        const channelId = m.route.param('channelId');
        this.channelId = typeof channelId === 'undefined' ? null : parseInt(channelId, 10);

        // set type
        const type = m.route.param('type');
        this.type = typeof type === 'undefined' ? null : type;

        // set mode
        const mode = m.route.param('mode');
        this.mode = typeof mode === 'undefined' ? null : parseInt(mode, 10);

        await this.featch();
    }

    /**
     * get video src
     * @return string
     */
    public getSrc(): string {
        if (this.recordedId !== null) {
            let src = `./api/recorded/${ this.recordedId }/file`;
            if (this.encodedId !== null) { src += `?encodedId=${ this.encodedId }`; }

            return src;
        }

        if (this.channelId !== null && this.type !== null && this.mode !== null) {
            return `./api/streams/live/${ this.channelId }/${ this.type }?mode=${ this.mode }&dummy=${ this.dummyTime }`;
        }

        return '';
    }

    /**
     * data 取得
     */
    public async featch(): Promise<void> {
        if (this.recordedId !== null) {
            await this.recordedApiModel.fetchRecorded(this.recordedId);
        }

        if (this.channelId !== null) {
            await this.streamApiModel.fetchInfos();
        }
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
        const channel = this.channelsApiModel.getChannel(channelId);

        return channel === null ? String(channelId) : channel.name;
    }

    /**
     * get info
     * @return apid.StreamInfo | null
     */
    public getInfo(): apid.StreamInfo | null {
        const info = this.streamApiModel.getInfos().find((stream) => {
            return stream.channelId === this.channelId;
        });

        return typeof info === 'undefined' ? null : info;
    }

    public getChannelId(): apid.ServiceItemId | null {
        return this.channelId;
    }
}

export default VideoWatchViewModel;

