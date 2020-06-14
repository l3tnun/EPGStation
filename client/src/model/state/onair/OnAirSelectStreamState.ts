import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import UaUtil from '../../../util/UaUtil';
import Util from '../../../util/Util';
import IServerConfigModel from '../../serverConfig/IServerConfigModel';
import ISettingStorageModel from '../../storage/setting/ISettingStorageModel';
import IOnAirSelectStreamState, { LiveStreamType } from './IOnAirSelectStreamState';

@injectable()
export default class OnAirSelectStreamState implements IOnAirSelectStreamState {
    public isOpen: boolean = false;
    public streamConfigItems: string[] = [];
    public selectedStreamType: LiveStreamType | undefined;
    public selectedStreamConfig: string | undefined;

    private serverConfig: IServerConfigModel;
    private settingModel: ISettingStorageModel;
    private channelItem: apid.ScheduleChannleItem | null = null;
    private streamTypes: LiveStreamType[] = [];
    private streamConfig: { [type: string]: string[] } = {};

    constructor(
        @inject('IServerConfigModel') serverConfig: IServerConfigModel,
        @inject('ISettingStorageModel') settingModel: ISettingStorageModel,
    ) {
        this.serverConfig = serverConfig;
        this.settingModel = settingModel;
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

        if (typeof this.selectedStreamType === 'undefined') {
            this.selectedStreamType = this.getStreamTypes()[0];
        }

        this.updateStreamConfig();
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
     * ストリーム設定の更新
     */
    public updateStreamConfig(): void {
        this.streamConfigItems = this.getStreamConfig();

        if (typeof this.selectedStreamConfig === 'undefined') {
            this.selectedStreamConfig = this.streamConfigItems[0];
        } else {
            if (
                this.streamConfigItems.findIndex(c => {
                    return c === this.selectedStreamConfig;
                }) === -1
            ) {
                this.selectedStreamConfig = this.streamConfigItems[0];
            }
        }
    }

    /**
     * 指定された形式の視聴設定を返す
     * @param type: LiveStreamType
     * @return string[]
     */
    private getStreamConfig(): string[] {
        return typeof this.selectedStreamType === 'undefined' ? [] : this.streamConfig[this.selectedStreamType];
    }

    /**
     * m2ts 形式のライブ視聴 URL 生成
     * @return string | null URL Scheme の設定が見つからない場合は null を返す
     */
    public getM2TSURL(): string | null {
        const channel = this.getChannelItem();
        if (typeof this.selectedStreamConfig === 'undefined' || channel === null) {
            return null;
        }

        const config = this.serverConfig.getConfig();
        let urlScheme: string | null = null;
        const settingURLScheme = this.settingModel.getSavedValue().onAirM2TSViewURLScheme;

        if (settingURLScheme !== null && settingURLScheme.length > 0) {
            urlScheme = settingURLScheme;
        } else if (config !== null) {
            if (UaUtil.isiOS() === true && typeof config.urlscheme.m2ts.ios !== 'undefined') {
                urlScheme = config.urlscheme.m2ts.ios;
            } else if (UaUtil.isAndroid() === true && typeof config.urlscheme.m2ts.android !== 'undefined') {
                urlScheme = config.urlscheme.m2ts.android;
            } else if (UaUtil.isMac() === true && typeof config.urlscheme.m2ts.mac !== 'undefined') {
                urlScheme = config.urlscheme.m2ts.mac;
            } else if (UaUtil.isWindows() === true && typeof config.urlscheme.m2ts.win !== 'undefined') {
                urlScheme = config.urlscheme.m2ts.win;
            }
        }

        if (urlScheme === null) {
            // URL Schema 設定が見つからないので通常の URL を返す
            return null;
        }

        // URL Schemeの準備
        let viewURL =
            location.host +
            Util.getSubDirectory() +
            `/api/streams/live/${channel.id.toString(10)}/m2ts?name=${this.selectedStreamConfig}`;
        if (urlScheme.match(/vlc-x-callback/)) {
            viewURL = encodeURIComponent(viewURL);
        }

        return urlScheme.replace(/ADDRESS/g, viewURL);
    }
}
