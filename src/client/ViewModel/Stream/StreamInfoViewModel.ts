import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import { ConfigApiModelInterface } from '../../Model/Api/ConfigApiModel';
import { StreamsApiModelInterface } from '../../Model/Api/StreamsApiModel';
import { SettingModelInterface } from '../../Model/Setting/SettingModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import Util from '../../Util/Util';
import ViewModel from '../ViewModel';
import CreateStreamLink from './CreateStreamLink';

/**
 * StreamsApiModel
 */
class StreamInfoViewModel extends ViewModel {
    private streamsApiModel: StreamsApiModelInterface;
    private config: ConfigApiModelInterface;
    private setting: SettingModelInterface;
    private snackbar: SnackbarModelInterface;
    private timer: NodeJS.Timer | null = null;

    constructor(
        streamsApiModel: StreamsApiModelInterface,
        config: ConfigApiModelInterface,
        snackbar: SnackbarModelInterface,
        setting: SettingModelInterface,
    ) {
        super();
        this.streamsApiModel = streamsApiModel;
        this.config = config;
        this.snackbar = snackbar;
        this.setting = setting;
    }

    /**
     * init
     */
    public init(status: ViewModelStatus = 'init'): void {
        super.init(status);

        if (status === 'init') {
            this.streamsApiModel.init();
            m.redraw();
        }

        setTimeout(async() => {
            await this.updateInfos();
        }, 100);
    }

    /**
     * ストリーム情報を更新 & 自動更新用のタイマーをセット
     */
    private async updateInfos(): Promise<void> {
        this.stopTimer();
        try {
            await this.streamsApiModel.fetchInfos();
        } catch (err) {
            console.error(err);
            setTimeout(() => { this.updateInfos(); }, 5000);

            return;
        }

        let minEndTime = 6048000000;
        const now = new Date().getTime();
        this.getStreamInfos().forEach((info) => {
            if (info.type !== 'MpegTsLive') { return; }
            const endTime = info.endAt! - now;
            if (minEndTime > endTime) {
                minEndTime = endTime;
            }
        });

        if (minEndTime < 0) { minEndTime = 0; }

        this.timer = setTimeout(() => {
            this.updateInfos();
        }, minEndTime);
    }

    /**
     * タイマー停止
     */
    public stopTimer(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    /**
     * ストリーム情報を取得
     * @return apid.StreamInfo[]
     */
    public getStreamInfos(): apid.StreamInfo[] {
        return this.streamsApiModel.getInfos();
    }

    /**
     * 視聴用ページへ移動
     * @param num: infos index number
     */
    public view(num: number): void {
        const info = this.streamsApiModel.getInfos()[num];
        if (typeof info === 'undefined') { return; }

        if (info.type === 'MpegTsLive') {
            const setting = this.setting.get();
            let url: string | null = null;
            try {
                url = CreateStreamLink.mpegTsStreamingLink(
                    this.config.getConfig(),
                    setting === null ? null : {
                        isEnableURLScheme: setting.isEnableMegTsStreamingURLScheme,
                        customURLScheme: setting.customMegTsStreamingURLScheme,
                    },
                    info.channelId!,
                    info.mode!,
                );
            } catch (err) {
                console.error(err);
                this.snackbar.open('視聴用アプリの設定がされていません');

                return;
            }

            if (url === null) { return; }

            location.href = url;
        } else if (info.type === 'RecordedHLS') {
            if (Number(m.route.param('stream')) === info.streamNumber) { return; }

            setTimeout(() => { Util.move('/stream/watch', { stream: info.streamNumber }); }, 200);
        }
    }
}

export default StreamInfoViewModel;

