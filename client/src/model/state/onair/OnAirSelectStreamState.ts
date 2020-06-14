import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IServerConfigModel from '../../serverConfig/IServerConfigModel';
import IOnAirSelectStreamState, { LiveStreamType } from './IOnAirSelectStreamState';

@injectable()
export default class OnAirSelectStreamState implements IOnAirSelectStreamState {
    public isOpen: boolean = false;

    private serverConfig: IServerConfigModel;
    private channelItem: apid.ScheduleChannleItem | null = null;
    private streamTypes: LiveStreamType[] = [];
    private streamConfig: { [type: string]: string[] } = {};

    constructor(@inject('IServerConfigModel') serverConfig: IServerConfigModel) {
        this.serverConfig = serverConfig;
    }

    /**
     * ダイアログを開く
     * @param channelItem: apid.ScheduleChannleItem
     */
    public open(channelItem: apid.ScheduleChannleItem): void {
        this.isOpen = true;
        this.channelItem = channelItem;

        this.streamTypes = [];
        this.streamConfig = {};
        const config = this.serverConfig.getConfig();
        if (
            config !== null &&
            config.isEnableLiveStream === true &&
            typeof config.streamConfig !== 'undefined' &&
            typeof config.streamConfig.live !== 'undefined'
        ) {
            if (typeof config.streamConfig.live.m2ts !== 'undefined' && config.streamConfig.live.m2ts.length > 0) {
                this.streamTypes.push('M2TS');
                this.streamConfig['M2TS'] = config.streamConfig.live.m2ts;
            }
            if (typeof config.streamConfig.live.webm !== 'undefined' && config.streamConfig.live.webm.length > 0) {
                this.streamTypes.push('WebM');
                this.streamConfig['WebM'] = config.streamConfig.live.webm;
            }
            if (typeof config.streamConfig.live.mp4 !== 'undefined' && config.streamConfig.live.mp4.length > 0) {
                this.streamTypes.push('MP4');
                this.streamConfig['MP4'] = config.streamConfig.live.mp4;
            }
            if (typeof config.streamConfig.live.hls !== 'undefined' && config.streamConfig.live.hls.length > 0) {
                this.streamTypes.push('HLS');
                this.streamConfig['HLS'] = config.streamConfig.live.hls;
            }
        }
    }

    /**
     * ダイアログを閉じる
     */
    public close(): void {
        this.isOpen = false;
        this.channelItem = null;
    }

    /**
     * セットされている channel 情報を取得する
     * @return apid.ScheduleChannleItem | null
     */
    public getChannelItem(): apid.ScheduleChannleItem | null {
        return this.channelItem;
    }

    /**
     * ストリームタイプを返す
     * @return string
     */
    public getStreamTypes(): LiveStreamType[] {
        return this.streamTypes;
    }

    /**
     * 指定された形式の視聴設定を返す
     * @param type: LiveStreamType
     * @return string[]
     */
    public getStreamConfig(type: LiveStreamType): string[] {
        return typeof this.streamConfig[type] === 'undefined' ? [] : this.streamConfig[type];
    }
}
