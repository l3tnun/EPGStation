import * as apid from '../../../../api';
import { audioComponentType, audioSamplingRate, videoComponentType } from '../../lib/event';
import { ConfigApiModelInterface } from '../../Model/Api/ConfigApiModel';
import { AllReserveItem, ReservesApiModelInterface } from '../../Model/Api/ReservesApiModel';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import DateUtil from '../../Util/DateUtil';
import GenreUtil from '../../Util/GenreUtil';
import ViewModel from '../ViewModel';

interface ReservesOption {
    ruleId?: apid.RuleId;
    option?: apid.AddReserveOption;
    encode?: apid.RuleEncode;
}

/**
 * ProgramInfoViewModel
 */
class ProgramInfoViewModel extends ViewModel {
    private reserves: ReservesApiModelInterface;
    private balloon: BalloonModelInterface;
    private config: ConfigApiModelInterface;
    private snackbar: SnackbarModelInterface;
    private program: apid.ScheduleProgramItem | null = null;
    private channel: apid.ScheduleServiceItem | null = null;
    private reservesOption: ReservesOption | null = null;

    // 末尾が欠けることを許可
    private allowEndLack: boolean = true;

    // エンコードオプション
    private encodeStatus: boolean = false; // true: エンコード有効
    public delTS: boolean;
    public encodeDefault: boolean;
    public encodeOptionValue: number;

    constructor(
        reserves: ReservesApiModelInterface,
        balloon: BalloonModelInterface,
        config: ConfigApiModelInterface,
        snackbar: SnackbarModelInterface,
    ) {
        super();
        this.reserves = reserves;
        this.balloon = balloon;
        this.config = config;
        this.snackbar = snackbar;
    }

    /**
     * set program data
     * @param program: program
     * @param channel: channel
     */
    public set(program: apid.ScheduleProgramItem, channel: apid.ScheduleServiceItem, reservesOption: ReservesOption | null = null): void {
        this.program = program;
        this.channel = channel;
        this.reservesOption = reservesOption;

        // エンコードオプションをセットする
        const config = this.config.getConfig();
        if (config === null) { return; }
        if (config.enableEncode) {
            this.encodeStatus = true;
            this.delTS = typeof config.delTs === 'undefined' ? false : config.delTs;
            this.encodeOptionValue = typeof config.defaultEncode !== 'undefined' ? config.defaultEncode : -1;
        } else {
            this.encodeStatus = false;
        }
    }

    /**
     * get program
     * @return porogram
     */
    public getProgram(): apid.ScheduleProgramItem | null {
        return this.program;
    }

    /**
     * title 取得
     * @return title
     */
    public getTitle(): string {
        if (this.program === null) { return ''; }

        return this.program.name;
    }

    /**
     * channel 名取得
     * @return channel name
     */
    public getChannelName(): string {
        if (this.channel === null) { return ''; }

        return this.channel.name;
    }

    /**
     * 時刻を取得
     * @return start time and end time
     */
    public getTime(): string {
        if (this.program === null) { return ''; }

        const start = DateUtil.getJaDate(new Date(this.program.startAt));
        const end = DateUtil.getJaDate(new Date(this.program.endAt));
        const duration = Math.floor((this.program.endAt - this.program.startAt) / 1000 / 60);

        return DateUtil.format(start, 'MM/dd(w) hh:mm:ss') + ' ~ ' + DateUtil.format(end, 'hh:mm:ss') + ` (${ duration }分)`;
    }

    /**
     * /program へ飛ぶためのリンク query を生成
     * @return { time: string }
     */
    public getProgramsLinkQuery(): { [key: string]: any } {
        if (this.program === null) { return {}; }

        const start = DateUtil.getJaDate(new Date(this.program.startAt));

        return {
            type: this.program.channelType,
            time: DateUtil.format(start, 'YYMMddhh'),
        };
    }

    /**
     * /program へ飛ぶためのリンク query を生成
     * @return { time: string }
     */
    public getChannelLinkQuery(): { [key: string]: any } {
        if (this.program === null) { return {}; }
        const start = DateUtil.getJaDate(new Date(this.program.startAt));

        return {
            ch: this.program.channelId,
            time: DateUtil.format(start, 'YYMMddhh'),
        };
    }

    /**
     * description を取得
     * @return description
     */
    public getDescription(): string {
        if (this.program === null || typeof this.program.description === 'undefined') { return ''; }

        return this.program.description;
    }

    /**
     * extended を取得
     * @return extended
     */
    public getExtended(): string {
        if (this.program === null || typeof this.program.extended === 'undefined') { return ''; }

        return this.program.extended;
    }

    /**
     * genre1, genre2 をまとめて取得
     * @return genre1 / genre2
     */
    public getGenres(lv: number): string {
        if (this.program === null || !(lv === 0 || lv === 1 || lv === 2)) { return ''; }

        const genre1 = lv === 0 ? this.program.genre1 : lv === 1 ? this.program.genre3 : this.program.genre5;
        if (typeof genre1 === 'undefined') { return ''; }

        const genre2 = lv === 0 ? this.program.genre2 : lv === 1 ? this.program.genre4 : this.program.genre6;

        return GenreUtil.getGenres(genre1, genre2);
    }

    /**
     * video 情報を取得
     * @return video info
     */
    public getVideoInfo(): string {
        if (this.program === null || typeof this.program.videoComponentType === 'undefined') { return ''; }
        const str = videoComponentType[this.program.videoComponentType];

        return typeof str === 'undefined' ? '' : str;
    }

    /**
     * 音声情報を取得
     * @return audio info
     */
    public getAudioMode(): string {
        if (this.program === null || typeof this.program.audioComponentType === 'undefined') { return ''; }
        const str = audioComponentType[this.program.audioComponentType];

        return typeof str === 'undefined' ? '' : str;
    }

    /**
     * 音声サンプリングレートを返す
     * @return audio sampling rate
     */
    public getAudioSamplingRate(): string {
        if (this.program === null || typeof this.program.audioSamplingRate === 'undefined') { return ''; }
        const str = audioSamplingRate[this.program.audioSamplingRate];

        return typeof str === 'undefined' ? '' : str;
    }

    /**
     * 無料放送 or 有料放送かを返す
     * @return string
     */
    public getIsFree(): string {
        if (this.program === null) { return ''; }

        return this.program.isFree ? '無料放送' : '有料放送';
    }

    /**
     * 予約オプションを持っているか
     * @return boolean
     */
    public hasReserveOption(): boolean {
        return this.reservesOption !== null;
    }

    /**
     * 予約オプションの rule id 取得
     * @return apid.RuleId | null
     */
    public getReserveOptionRuleId(): apid.RuleId | null {
        return this.reservesOption === null || typeof this.reservesOption.ruleId === 'undefined' ?
            null : this.reservesOption.ruleId;
    }

    /**
     * get ReservesOption
     * @return ReservesOption | null
     */
    public getReservesOption(): ReservesOption | null {
        return this.reservesOption;
    }

    /**
     * get encode option name
     * @return string[]
     */
    public getEncodeOptionNames(): string[] {
        const config = this.config.getConfig();

        return config === null || typeof config.encodeOption === 'undefined' ? [] : config.encodeOption;
    }

    /**
     * close balloon
     */
    public close(): void {
        this.balloon.close();
    }

    /**
     * エンコードオプションが有効か
     * @return true: 有効, false: 無効
     */
    public isEnableEncode(): boolean {
        return this.encodeStatus;
    }

    /**
     * エンコードオプションを取得する
     * @return encode option
     */
    public getEncodeOption(): { value: number; name: string }[] {
        const config = this.config.getConfig();
        if (!this.encodeStatus || config === null || typeof config.encodeOption === 'undefined') { return []; }

        const result = [{ value: -1, name: 'TS' }];
        config.encodeOption.forEach((option, i) => {
            result.push({ value: i, name: option });
        });

        return result;
    }

    /**
     * 予約状態を返す
     * @return AllReserves | null
     */
    public getReserveStatus(): AllReserveItem | null {
        const allId = this.reserves.getAllId();
        if (this.program === null || allId === null) { return null; }

        const reserve = allId[this.program.id];

        return typeof reserve === 'undefined' ? null : reserve;
    }

    /**
     * 予約追加
     * @return Promise<void>
     */
    public async addReserve(): Promise<void> {
        if (this.program === null) { return; }

        try {
            if (this.isEnableEncode() && this.encodeOptionValue !== -1) {
                await this.reserves.addReserve({
                    programId: this.program.id,
                    allowEndLack: this.allowEndLack,
                    encode: {
                        mode1: this.encodeOptionValue,
                        delTs: this.delTS,
                    },
                });
            } else {
                await this.reserves.addReserve({
                    programId: this.program.id,
                    allowEndLack: this.allowEndLack,
                });
            }
            this.snackbar.open(`予約: ${ this.program.name }`);
        } catch (err) {
            console.error(err);
            this.snackbar.open(`予約失敗: ${ this.program.name }`);
        }
    }

    /**
     * 予約削除
     * @return Promise<void>
     */
    public async deleteReserve(): Promise<void> {
        if (this.program === null) { return; }

        try {
            await this.reserves.deleteReserve(this.program.id);
            this.snackbar.open(`削除: ${ this.program.name }`);
        } catch (err) {
            console.error(err);
            this.snackbar.open(`削除失敗: ${ this.program.name }`);
        }
    }

    /**
     * 予約除外状態を解除
     * @return Promise<void>
     */
    public async deleteSkip(): Promise<void> {
        if (this.program === null) { return; }

        try {
            await this.reserves.deleteSkip(this.program.id);
            this.snackbar.open(`除外解除: ${ this.program.name }`);
        } catch (err) {
            console.error(err);
            this.snackbar.open(`除外解除失敗: ${ this.program.name }`);
        }
    }

    /**
     * overlap を解除
     * @return Promise<void>
     */
    public async disableOverlap(): Promise<void> {
        if (this.program === null) { return; }

        try {
            await this.reserves.disableOverlap(this.program.id);
            this.snackbar.open(`重複解除: ${ this.program.name }`);
        } catch (err) {
            console.error(err);
            this.snackbar.open(`重複解除失敗: ${ this.program.name }`);
        }
    }
}

namespace ProgramInfoViewModel {
    export const id = 'program-info';
}

export default ProgramInfoViewModel;

