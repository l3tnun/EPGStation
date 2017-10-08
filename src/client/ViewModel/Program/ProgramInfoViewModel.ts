import ViewModel from '../ViewModel';
import * as apid from '../../../../api';
import { AllReserveItem, ReservesApiModelInterface } from '../../Model/Api/ReservesApiModel';
import DateUtil from '../../Util/DateUtil';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import { ConfigApiModelInterface } from '../../Model/Api/ConfigApiModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import GenreUtil from '../../Util/GenreUtil';

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

    //エンコードオプション
    private encodeStatus: boolean = false; // true: エンコード有効
    public delTs: boolean;
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
    public set(program: apid.ScheduleProgramItem, channel: apid.ScheduleServiceItem): void {
        this.program = program;
        this.channel = channel;

        //エンコードオプションをセットする
        let config = this.config.getConfig();
        if(config === null) { return; }
        if(config.enableEncode) {
            this.encodeStatus = true;
            if(typeof config.delTs === 'undefined') {
                this.delTs = false;
            } else {
                this.delTs = config.delTs;
            }

            if(typeof config.defaultEncode !== 'undefined') {
                this.encodeOptionValue = config.defaultEncode;
            } else {
                this.encodeOptionValue = -1;
            }
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
        if(this.program === null) { return ''; }

        return this.program.name;
    }

    /**
    * channel 名取得
    * @return channel name
    */
    public getChannelName(): string {
        if(this.channel === null) { return ''; }

        return this.channel.name;
    }

    /**
    * 時刻を取得
    * @return start time and end time
    */
    public getTime(): string {
        if(this.program === null) { return '' }

        let start = DateUtil.getJaDate(new Date(this.program.startAt));
        let end = DateUtil.getJaDate(new Date(this.program.endAt));
        let duration = Math.floor((this.program.endAt - this.program.startAt) / 1000 / 60);

        return DateUtil.format(start, 'MM/dd(w) hh:mm:ss') + ' ~ ' + DateUtil.format(end, 'hh:mm:ss') + ` (${ duration }分)`
    }

    /**
    * /program へ飛ぶためのリンク query を生成
    * @return { time: string }
    */
    public getProgramsLinkQuery(): { [key: string]: any } {
        if(this.program === null) { return {}; }

        let start = DateUtil.getJaDate(new Date(this.program.startAt));
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
        if(this.program === null) { return {}; }

        let start = DateUtil.getJaDate(new Date(this.program.startAt));
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
        if(this.program === null || typeof this.program.description === 'undefined') { return ''; }

        return this.program.description;
    }

    /**
    * extended を取得
    * @return extended
    */
    public getExtended(): string {
        if(this.program === null || typeof this.program.extended === 'undefined') { return ''; }

        return this.program.extended;
    }

    /**
    * genre1, genre2 をまとめて取得
    * @return genre1 / genre2
    */
    public getGenres(): string {
        if(this.program === null || typeof this.program.genre1 === 'undefined') { return ''; }

        return GenreUtil.getGenres(this.program.genre1, this.program.genre2);
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
    public getEncodeOption(): { value: number, name: string }[] {
        let config = this.config.getConfig();
        if(!this.encodeStatus || config === null || typeof config.encodeOption === 'undefined') { return []; }

        let result = [{ value: -1, name: 'TS' }];
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
        let allId = this.reserves.getAllId();
        if(this.program === null || allId === null) { return null; }

        let reserve = allId[this.program.id];

        return typeof reserve === 'undefined' ? null : reserve;
    }

    /**
    * 予約追加
    * @return Promise<void>
    */
    public async addReserve(): Promise<void> {
        if(this.program === null) { return; }

        try {
            if(this.isEnableEncode() && this.encodeOptionValue !== -1) {
                await this.reserves.addReserve(this.program.id, {
                    mode1: this.encodeOptionValue,
                    delTs: this.delTs,
                });
            } else {
                await this.reserves.addReserve(this.program.id);
            }
            this.snackbar.open(`予約: ${ this.program.name }`);
        } catch(err) {
            console.error(err);
            this.snackbar.open(`予約失敗: ${ this.program.name }`);
        }
    }

    /**
    * 予約削除
    * @return Promise<void>
    */
    public async deleteReserve(): Promise<void> {
        if(this.program === null) { return; }
        this.close();

        try {
            await this.reserves.deleteReserve(this.program.id);
            this.snackbar.open(`削除: ${ this.program.name }`);
        } catch(err) {
            console.error(err);
            this.snackbar.open(`削除失敗: ${ this.program.name }`);
        }
    }

    /**
    * 予約除外状態を解除
    * @return Promise<void>
    */
    public async deleteSkip(): Promise<void> {
        if(this.program === null) { return; }
        this.close();

        try {
            await this.reserves.deleteSkip(this.program.id);
            this.snackbar.open(`除外: ${ this.program.name }`);
        } catch(err) {
            console.error(err);
            this.snackbar.open(`除外失敗: ${ this.program.name }`);
        }
    }
}

namespace ProgramInfoViewModel {
    export const id = 'program-info';
}

export default ProgramInfoViewModel;

