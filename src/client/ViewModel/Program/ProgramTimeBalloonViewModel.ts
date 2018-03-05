import * as m from 'mithril';
import { ConfigApiModelInterface } from '../../Model/Api/ConfigApiModel';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import DateUtil from '../../Util/DateUtil';
import Util from '../../Util/Util';
import ViewModel from '../ViewModel';

/**
 * ProgramTimeBalloonViewModel
 */
class ProgramTimeBalloonViewModel extends ViewModel {
    private nowNum: number | null = null;
    private configApiModel: ConfigApiModelInterface;
    private balloon: BalloonModelInterface;
    private snackbar: SnackbarModelInterface;

    public typeValue: string | null = null;
    public dayValue: number = -1;
    public hourValue: number = -1;

    constructor(
        configApiModel: ConfigApiModelInterface,
        balloon: BalloonModelInterface,
        snackbar: SnackbarModelInterface,
    ) {
        super();
        this.configApiModel = configApiModel;
        this.balloon = balloon;
        this.snackbar = snackbar;
    }

    /**
     * ProgramViewModel から time パラメータをセットする
     */
    public setNowNum(num: number): void {
        this.nowNum = num;
        this.typeValue = this.getTypeParam();
        this.dayValue = -1;
        this.hourValue = -1;
    }

    /**
     * close balloon
     */
    public close(): void {
        this.balloon.close();
    }

    /**
     * 放送波を返す
     * @return { value: string; name: string }[]
     */
    public getTypes(): { value: string; name: string }[] {
        if (this.typeValue === null) { return []; }

        const config = this.configApiModel.getConfig();
        if (config === null) { return []; }

        const types: { value: string; name: string }[] = [];

        if (config.broadcast.GR) {
            types.push({ value: 'GR', name: 'GR' });
        }
        if (config.broadcast.BS) {
            types.push({ value: 'BS', name: 'BS' });
        }
        if (config.broadcast.CS) {
            types.push({ value: 'CS', name: 'CS' });
        }
        if (config.broadcast.SKY) {
            types.push({ value: 'SKY', name: 'SKY' });
        }

        return types;
    }

    /**
     * query から放送波を返す
     * @return string
     */
    private getTypeParam(): string | null {
        const type = m.route.param('type');

        return typeof type === 'undefined' ? null : type;
    }

    /**
     * 月/日 を返す
     * @return { value: MMdd, name: MM/dd }[]
     */
    public getDays(): { value: number; name: string }[] {
        if (this.nowNum === null) { return []; }

        const now = new Date().getTime();

        const result: { value: number; name: string }[] = [];
        for (let i = 0; i < 8; i++) {
            const date = now + i * 60 * 60 * 24 * 1000;
            const ja = DateUtil.getJaDate(new Date(date));
            const value = Number(DateUtil.format(ja, 'YYMMdd'));
            result.push({
                value: value,
                name: DateUtil.format(ja, 'MM/dd(w)'),
            });
        }

        if (this.dayValue === -1) {
            this.dayValue = Number(DateUtil.format(DateUtil.getJaDate(new Date(this.nowNum)), 'YYMMdd'));
        }

        return result;
    }

    /**
     * 時 を返す
     * @return { value: hh; name: hh }[]
     */
    public getHours(): { value: number; name: string }[] {
        if (this.nowNum === null) { return []; }

        const result: { value: number; name: string }[] = [];
        for (let i = 0; i < 24; i++) {
            result.push({
                value: i,
                name: `${ i }時`,
            });
        }

        if (this.hourValue === -1) {
            this.hourValue = Number(DateUtil.format(DateUtil.getJaDate(new Date(this.nowNum)), 'hh'));
        }

        return result;
    }

    /**
     * 入力された日付に移動する
     */
    public show(): void {
        if (this.nowNum === null) { return; }

        const time = String(this.dayValue) + (`0${ this.hourValue }`).slice(-2);
        const type = this.getTypeParam();
        if (time === DateUtil.format(DateUtil.getJaDate(new Date(this.nowNum)), 'YYMMddhh') && (type === null || type === this.typeValue)) {
            this.snackbar.open('現在ページと同じ設定です');
        } else {
            const query = Util.getCopyQuery();
            query.time = time;
            if (this.typeValue !== null) { query.type = this.typeValue; }
            this.close();
            Util.move(m.route.get().split('?')[0], query);
        }
    }
}

namespace ProgramTimeBalloonViewModel {
    export const id = 'program-time-balloon';
}

export default ProgramTimeBalloonViewModel;

