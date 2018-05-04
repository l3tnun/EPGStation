import * as apid from '../../../../api';
import { ConfigApiModelInterface } from '../../Model/Api/ConfigApiModel';
import { StreamsApiModelInterface } from '../../Model/Api/StreamsApiModel';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import { SettingValue } from '../../Model/Setting/SettingModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import StorageTemplateModel from '../../Model/Storage/StorageTemplateModel';
import Util from '../../Util/Util';
import ViewModel from '../ViewModel';
import CreateStreamLink from './CreateStreamLink';

type StreamType = 'M2TS' | 'HLS';

/**
 * StreamSelectViewModel
 */
class StreamSelectViewModel extends ViewModel {
    private config: ConfigApiModelInterface;
    private streamApiModel: StreamsApiModelInterface;
    private setting: StorageTemplateModel<SettingValue>;
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
    ) {
        super();
        this.config = config;
        this.streamApiModel = streamApiModel;
        this.balloon = balloon;
        this.snackbar = snackbar;
        this.setting = setting;
    }

    /**
     * set
     * @param channel: apid.ScheduleServiceItem
     */
    public set(channel: apid.ScheduleServiceItem, jumpStation: (() => void) | null = null): void {
        // type 設定
        const config = this.config.getConfig();
        if (this.streamTypeValue === null && config !== null) {
            this.streamTypeValue = typeof config.mpegTsStreaming !== 'undefined' ? 'M2TS' : 'HLS';
            this.hasMultiType = typeof config.mpegTsStreaming !== 'undefined' && typeof config.liveHLS !== 'undefined';
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
        return [
            'M2TS',
            'HLS',
        ];
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
        } else {
            return [];
        }
    }

    /**
     * 視聴ページへ飛ぶ
     */
    public async view(): Promise<void> {
        if (this.channel === null || this.streamTypeValue === null) { return; }

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
        } else {
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

