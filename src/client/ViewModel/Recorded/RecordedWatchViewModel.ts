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
    private mode: number;
    private type: 'webm' | 'mp4';
    private playBackPosition: number;
    private dataGetTime: number;

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

        if (status === 'init' || status === 'update') {
            this.recordedApiModel.init();
            this.playBackPosition = 0;
        }

        this.recordedId = parseInt(m.route.param('recordedId'), 10);
        this.mode = parseInt(m.route.param('mode'), 10);
        this.type = <any> m.route.param('type');
        await this.fetchData();
    }

    /**
     * fetch data
     */
    private async fetchData(): Promise<void> {
        await this.recordedApiModel.fetchRecorded(this.recordedId);
        await this.recordedApiModel.fetchDuration(this.recordedId);
        this.dataGetTime = new Date().getTime();
    }

    /**
     * get Recorded
     * @return apid.RecordedProgram | null
     */
    public getRecorded(): apid.RecordedProgram | null {
        return this.recordedApiModel.getRecorded();
    }

    /**
     * get Duration
     * @return number
     */
    public getDuration(): number {
        const duration = this.recordedApiModel.getDuration();

        return this.isRecording()
            ? duration + Math.floor((new Date().getTime() - this.dataGetTime) / 1000)
            : duration;
    }

    /**
     * get video source
     * @return string
     */
    public getSource(): string {
        return `/api/streams/recorded/${ this.recordedId }/${ this.type }?mode=${ this.mode }&ss=${ this.playBackPosition }`;
    }

    /**
     * 録画中か
     * @return boolean
     */
    private isRecording(): boolean {
        const recorded = this.getRecorded();

        return recorded === null ? false : recorded.recording;
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
     * 再生位置を変更
     * @param position: number
     * @throws OutOfRangeError ビデオの長さの範囲外の場合
     */
    public changePLayBackPosition(position: number): void {
        if (this.getDuration() < position) {
            throw new Error('OutOfRangeError');
        }

        this.playBackPosition = position;
    }
}

export default RecordedWatchViewModel;

