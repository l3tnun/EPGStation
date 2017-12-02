import * as m from 'mithril';
import ViewModel from '../ViewModel';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import DateUtil from '../../Util/DateUtil';
import Util from '../../Util/Util';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';

/**
* ProgramTimeBalloonViewModel
*/
class ProgramTimeBalloonViewModel extends ViewModel {
    private nowNum: number | null = null;
    private balloon: BalloonModelInterface;
    private snackbar: SnackbarModelInterface;

    public dayValue: number = -1;
    public hourValue: number = -1;

    constructor(
        balloon: BalloonModelInterface,
        snackbar: SnackbarModelInterface,
    ) {
        super();
        this.balloon = balloon;
        this.snackbar = snackbar;
    }

    /**
    * ProgramViewModel から time パラメータをセットする
    */
    public setNowNum(num: number): void {
        this.nowNum = num;
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
    * 月/日 を返す
    * @return { value: MMdd, name: MM/dd }[]
    */
    public getDays(): { value: number, name: string }[] {
        if(this.nowNum === null) { return []; }

        const now = new Date().getTime();

        let result: { value: number, name: string }[] = [];
        for(let i = 0; i < 8; i++) {
            let date = now + i * 60 * 60 * 24 * 1000;
            let ja = DateUtil.getJaDate(new Date(date));
            let value = Number(DateUtil.format(ja, 'YYMMdd'));
            result.push({
                value: value,
                name: DateUtil.format(ja, 'MM/dd(w)'),
            });
        }

        if(this.dayValue === -1) {
            this.dayValue = Number(DateUtil.format(DateUtil.getJaDate(new Date(this.nowNum)), 'YYMMdd'));
        }

        return result;
    }

    /**
    * 時 を返す
    * @return { value: hh, name: hh }[]
    */
    public getHours(): { value: number, name: string }[] {
        if(this.nowNum === null) { return []; }

        let result: { value: number, name: string }[] = [];
        for(let i = 0; i < 24; i++) {
            result.push({
                value: i,
                name: `${ i }時`,
            });
        }

        if(this.hourValue === -1) {
            this.hourValue = Number(DateUtil.format(DateUtil.getJaDate(new Date(this.nowNum)), 'hh'));
        }

        return result;
    }

    /**
    * 入力された日付に移動する
    */
    public show(): void {
        if(this.nowNum === null) { return; }

        let time = String(this.dayValue) + (`0${ this.hourValue }`).slice(-2);
        if(time !== DateUtil.format(DateUtil.getJaDate(new Date(this.nowNum)), 'YYMMddhh')) {
            let query = Util.getCopyQuery();
            query.time = time;
            this.close();
            Util.move(m.route.get().split('?')[0], query);
        } else {
            this.snackbar.open('現在ページと同じ設定です');
        }
    }
}

namespace ProgramTimeBalloonViewModel {
    export const id = 'program-time-balloon'
}

export default ProgramTimeBalloonViewModel;

