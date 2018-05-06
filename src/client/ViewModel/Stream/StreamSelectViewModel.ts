import * as apid from '../../../../api';
import { StreamType } from '../../Enums';
import { ConfigApiModelInterface } from '../../Model/Api/ConfigApiModel';
import { StreamsApiModelInterface } from '../../Model/Api/StreamsApiModel';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import { SettingValue } from '../../Model/Setting/SettingModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import StorageTemplateModel from '../../Model/Storage/StorageTemplateModel';
import { StreamSelectSettingValue } from '../../Model/Stream/StreamSelectSettingModel';
import Util from '../../Util/Util';
import ViewModel from '../ViewModel';
import CreateStreamLink from './CreateStreamLink';

/**
 * StreamSelectViewModel
 */
class StreamSelectViewModel extends ViewModel {
    private config: ConfigApiModelInterface;
    private streamApiModel: StreamsApiModelInterface;
    private setting: StorageTemplateModel<SettingValue>;
    private selectSetting: StorageTemplateModel<StreamSelectSettingValue>;
    private balloon: BalloonModelInterface;
    private channel: apid.ScheduleServiceItem | null = null;
    private snackbar: SnackbarModelInterface;

    // 単局表示のページ移動用
    private jumpStation: (() => void) | null = null;

    // ストリームオプション
    private hasMultiType: boolean = false;
    public streamTypeValue: StreamType | null = null;
    public streamOptionValue: number = 0;

    constructor(
        config: ConfigApiModelInterface,
        streamApiModel: StreamsApiModelInterface,
        balloon: BalloonModelInterface,
        snackbar: SnackbarModelInterface,
        setting: StorageTemplateModel<SettingValue>,
        selectSetting: StorageTemplateModel<StreamSelectSettingValue>,
    ) {
        super();
        this.config = config;
        this.streamApiModel = streamApiModel;
        this.balloon = balloon;
        this.snackbar = snackbar;
        this.setting = setting;
        this.selectSetting = selectSetting;
    }

    /**
     * set
     * @param channel: apid.ScheduleServiceItem
     */
    public set(channel: apid.ScheduleServiceItem, jumpStation: (() => void) | null = null): void {
        // type 設定
        const config = this.config.getConfig();
        if (this.streamTypeValue === null && config !== null) {
            let typeCnt = 0;
            if (typeof config.mpegTsStreaming !== 'undefined') { typeCnt += 1; }
            if (typeof config.liveHLS !== 'undefined') { typeCnt += 1; }
            if (typeof config.liveWebM !== 'undefined') { typeCnt += 1; }
            // 複数の配信方式があるか
            this.hasMultiType = typeCnt > 1;

            const selectValue = this.selectSetting.getValue();
            if (selectValue.type === 'M2TS' && typeof config.mpegTsStreaming !== 'undefined') {
                this.streamTypeValue = 'M2TS';
                if (typeof config.mpegTsStreaming[selectValue.mode] !== 'undefined') {
                    this.streamOptionValue = selectValue.mode;
                }
            } else if (selectValue.type === 'HLS' && typeof config.liveHLS !== 'undefined') {
                this.streamTypeValue = 'HLS';
                if (typeof config.liveHLS[selectValue.mode] !== 'undefined') {
                    this.streamOptionValue = selectValue.mode;
                }
            } else if (selectValue.type === 'WebM' && typeof config.liveWebM !== 'undefined') {
                this.streamTypeValue = 'WebM';
                if (typeof config.liveWebM[selectValue.mode] !== 'undefined') {
                    this.streamOptionValue = selectValue.mode;
                }
            } else {
                this.streamTypeValue = 'M2TS';
                if (typeof config.mpegTsStreaming !== 'undefined') {
                    this.streamTypeValue = 'M2TS';
                } else if (typeof config.liveHLS !== 'undefined') {
                    this.streamTypeValue = 'HLS';
                } else if (typeof config.liveWebM !== 'undefined') {
                    this.streamTypeValue = 'WebM';
                }
            }
        }

        this.channel = channel;
        this.jumpStation = jumpStation;
    }

    /**
     * チャンネル名を返す
     * @return string
     */
    public getName(): string {
        return this.channel === null ? '' : this.channel.name;
    }

    /**
     * 複数 type を持っているか
     * @return boolean
     */
    public isMultiTypes(): boolean {
        return this.hasMultiType;
    }

    /**
     * get type option
     */
    public getTypeOption(): StreamType[] {
        const types: StreamType[] = [];
        const config = this.config.getConfig();
        if (config === null) { return []; }

        if (typeof config.mpegTsStreaming !== 'undefined') { types.push('M2TS'); }
        if (typeof config.liveHLS !== 'undefined') { types.push('HLS'); }
        if (typeof config.liveWebM !== 'undefined') { types.push('WebM'); }

        return types;
    }

    /**
     * 選択したオプションを記憶する
     */
    public saveValues(): void {
        if (this.streamTypeValue === null) { return; }

        // save value
        this.selectSetting.setValue({
            type: this.streamTypeValue,
            mode: this.streamOptionValue,
        });
    }

    /**
     * ストリームオプションを返す
     * @return { name: string, value: number }
     */
    public getOptions(): { name: string; value: number }[] {
        const config = this.config.getConfig();
        if (config === null) { return []; }

        if (this.streamTypeValue === 'M2TS' && typeof config.mpegTsStreaming !== 'undefined') {
            return config.mpegTsStreaming.map((option, index) => {
                return { name: option, value: index };
            });
        } else if (this.streamTypeValue === 'HLS' && typeof config.liveHLS !== 'undefined') {
            return config.liveHLS.map((option, index) => {
                return { name: option, value: index };
            });
        } else if (this.streamTypeValue === 'WebM' && typeof config.liveWebM !== 'undefined') {
            return config.liveWebM.map((option, index) => {
                return { name: option, value: index };
            });
        } else {
            return [];
        }
    }

    /**
     * 視聴ページへ飛ぶ
     */
    public async view(): Promise<void> {
        if (this.channel === null || this.streamTypeValue === null) { return; }

        // view
        if (this.streamTypeValue === 'M2TS') {
            // M2TS
            const setting = this.setting.get();
            let url: string | null = null;
            try {
                url = CreateStreamLink.mpegTsStreamingLink(
                    this.config.getConfig(),
                    setting === null ? null : {
                        isEnableURLScheme: setting.isEnableMegTsStreamingURLScheme,
                        customURLScheme: setting.customMegTsStreamingURLScheme,
                    },
                    this.channel.id,
                    this.streamOptionValue,
                );
            } catch (err) {
                console.error(err);
                this.snackbar.open('視聴用アプリの設定がされていません');

                return;
            }

            if (url === null) { return; }

            location.href = url;
        } else if (this.streamTypeValue === 'HLS') {
            // HLS
            this.close();

            const streamNumber = await this.streamApiModel.startLiveHLS(
                this.channel.id,
                this.streamOptionValue,
            );

            // ページ移動
            setTimeout(() => { Util.move('/stream/watch', { stream: streamNumber }); }, 200);
        }
    }

    /**
     * get channel
     * @return apid.ScheduleServiceItem | null
     */
    public getChannel(): apid.ScheduleServiceItem | null {
        return this.channel;
    }

    /**
     * 単局表示のボタンの表示が必要か
     * @return boolean ture: 必要, false: 不要
     */
    public hasJumpStationButton(): boolean {
        return this.jumpStation !== null;
    }

    /**
     * 単局ページへ移動する
     */
    public moveStationPage(): void {
        if (this.jumpStation === null) { return; }

        this.jumpStation();
    }

    /**
     * close balloon
     */
    public close(): void {
        this.balloon.close();
    }
}

namespace StreamSelectViewModel {
    export const id = 'stream-selector';
}

export default StreamSelectViewModel;

