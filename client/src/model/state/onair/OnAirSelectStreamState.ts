import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import UaUtil from '../../../util/UaUtil';
import Util from '../../../util/Util';
import IServerConfigModel from '../../serverConfig/IServerConfigModel';
import { IOnAirSelectStreamSettingStorageModel } from '../../storage/onair/IOnAirSelectStreamSettingStorageModel';
import { ISettingStorageModel } from '../../storage/setting/ISettingStorageModel';
import IOnAirSelectStreamState, { LiveStreamType, StreamConfigItem } from './IOnAirSelectStreamState';

@injectable()
export default class OnAirSelectStreamState implements IOnAirSelectStreamState {
    public isOpen: boolean = false;
    public streamTypes: LiveStreamType[] = [];
    public streamConfigItems: StreamConfigItem[] = [];
    public selectedStreamType: LiveStreamType | undefined;
    public selectedStreamConfig: number | undefined;

    private serverConfig: IServerConfigModel;
    private settingModel: ISettingStorageModel;
    private streamSelectSetting: IOnAirSelectStreamSettingStorageModel;
    private channelItem: apid.ScheduleChannleItem | null = null;
    private streamConfig: { [type: string]: string[] } = {};

    constructor(
        @inject('IServerConfigModel') serverConfig: IServerConfigModel,
        @inject('ISettingStorageModel') settingModel: ISettingStorageModel,
        @inject('IOnAirSelectStreamSettingStorageModel') streamSelectSetting: IOnAirSelectStreamSettingStorageModel,
    ) {
        this.serverConfig = serverConfig;
        this.settingModel = settingModel;
        this.streamSelectSetting = streamSelectSetting;
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
            config.isEnableTSLiveStream === true &&
            typeof config.streamConfig !== 'undefined' &&
            typeof config.streamConfig.live !== 'undefined' &&
            typeof config.streamConfig.live.ts !== 'undefined'
        ) {
            if (typeof config.streamConfig.live.ts.m2ts !== 'undefined' && config.streamConfig.live.ts.m2ts.length > 0) {
                this.streamTypes.push('M2TS');
                this.streamConfig['M2TS'] = config.streamConfig.live.ts.m2ts;
            }
            if (typeof config.streamConfig.live.ts.webm !== 'undefined' && config.streamConfig.live.ts.webm.length > 0) {
                this.streamTypes.push('WebM');
                this.streamConfig['WebM'] = config.streamConfig.live.ts.webm;
            }
            if (typeof config.streamConfig.live.ts.mp4 !== 'undefined' && config.streamConfig.live.ts.mp4.length > 0) {
                this.streamTypes.push('MP4');
                this.streamConfig['MP4'] = config.streamConfig.live.ts.mp4;
            }
            if (typeof config.streamConfig.live.ts.hls !== 'undefined' && config.streamConfig.live.ts.hls.length > 0) {
                this.streamTypes.push('HLS');
                this.streamConfig['HLS'] = config.streamConfig.live.ts.hls;
            }
        }

        if (typeof this.selectedStreamType === 'undefined') {
            const savedType = this.streamSelectSetting.getSavedValue().type;
            const newSelectedStreamType = this.streamTypes.find(type => {
                return type === savedType;
            });
            this.selectedStreamType = typeof newSelectedStreamType === 'undefined' ? this.streamTypes[0] : newSelectedStreamType;
        }

        this.updateStreamConfig(true);
    }

    /**
     * ダイアログを閉じる
     */
    public close(): void {
        this.isOpen = false;
        this.channelItem = null;

        // ストリームの選択情報を保存
        this.streamSelectSetting.tmp.type = this.selectedStreamType as string;
        this.streamSelectSetting.tmp.mode = typeof this.selectedStreamConfig === 'undefined' ? 0 : this.selectedStreamConfig;
        this.streamSelectSetting.save();
    }

    /**
     * セットされている channel 情報を取得する
     * @return apid.ScheduleChannleItem | null
     */
    public getChannelItem(): apid.ScheduleChannleItem | null {
        return this.channelItem;
    }

    /**
     * ストリーム設定の更新
     */
    public updateStreamConfig(isInit: boolean = false): void {
        this.streamConfigItems = this.getStreamConfig().map((c, i) => {
            return {
                text: c,
                value: i,
            };
        });

        if (isInit === true) {
            this.selectedStreamConfig = this.streamSelectSetting.getSavedValue().mode;
        }

        if (typeof this.selectedStreamConfig === 'undefined' || typeof this.streamConfigItems[this.selectedStreamConfig] === 'undefined') {
            this.selectedStreamConfig = 0;
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
        let viewURL = location.host + Util.getSubDirectory() + `/api/streams/live/${channel.id.toString(10)}/m2ts?mode=${this.selectedStreamConfig}`;
        if (urlScheme.match(/vlc-x-callback/)) {
            viewURL = encodeURIComponent(viewURL);
        }

        return urlScheme.replace(/PROTOCOL/g, location.protocol.replace(':', '')).replace(/ADDRESS/g, viewURL);
    }

    /**
     * m2ts 形式のプレイリストダウンロード URL 生成
     * @return string | null URL Scheme の設定が見つからない場合は null を返す
     */
    public getM2TPlayListURL(): string | null {
        const channel = this.getChannelItem();
        if (typeof this.selectedStreamConfig === 'undefined' || channel === null) {
            return null;
        }

        return `/api/streams/live/${channel.id.toString(10)}/m2ts/playlist?mode=${this.selectedStreamConfig}`;
    }
}
