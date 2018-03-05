import * as apid from '../../../../api';
import { ConfigApiModelInterface } from '../../Model/Api/ConfigApiModel';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import { SettingModelInterface } from '../../Model/Setting/SettingModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import ViewModel from '../ViewModel';
import CreateStreamLink from './CreateStreamLink';

/**
 * StreamSelectViewModel
 */
class StreamSelectViewModel extends ViewModel {
    private config: ConfigApiModelInterface;
    private setting: SettingModelInterface;
    private balloon: BalloonModelInterface;
    private channel: apid.ScheduleServiceItem | null = null;
    private snackbar: SnackbarModelInterface;

    // 単局表示のページ移動用
    private jumpStation: (() => void) | null = null;

    // ストリームオプション
    public streamOptionValue: number = 0;

    constructor(
        config: ConfigApiModelInterface,
        balloon: BalloonModelInterface,
        snackbar: SnackbarModelInterface,
        setting: SettingModelInterface,
    ) {
        super();
        this.config = config;
        this.balloon = balloon;
        this.snackbar = snackbar;
        this.setting = setting;
    }

    /**
     * set
     * @param channel: apid.ScheduleServiceItem
     */
    public set(channel: apid.ScheduleServiceItem, jumpStation: (() => void) | null = null): void {
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
     * ストリームオプションを返す
     * @return { name: string, value: number }
     */
    public getOptions(): { name: string; value: number }[] {
        const config = this.config.getConfig();

        return config === null || typeof config.mpegTsStreaming === 'undefined' ? [] : config.mpegTsStreaming.map((option, index) => {
            return { name: option, value: index };
        });
    }

    /**
     * 視聴ページへ飛ぶ
     */
    public view(): void {
        if (this.channel === null) { return; }

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

