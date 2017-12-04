import * as m from 'mithril';
import ViewModel from '../ViewModel';
import { ViewModelStatus } from '../../Enums';
import * as apid from '../../../../api';
import { ScheduleApiModelInterface } from '../../Model/Api/ScheduleApiModel';
import Util from '../../Util/Util';
import DateUtil from '../../Util/DateUtil';
import { AllReserves, ReservesApiModelInterface } from '../../Model/Api/ReservesApiModel';
import { SettingModelInterface } from '../../Model/Setting/SettingModel';

/**
* ProgramViewModel
*/
class ProgramViewModel extends ViewModel {
    private scheduleApiModel: ScheduleApiModelInterface;
    private reservesApiModel: ReservesApiModelInterface;
    private setting: SettingModelInterface;
    // 更新時刻パラメータ
    private startTimeParam: string;
    private lengthParam: number;
    private reserves: AllReserves | null = null;
    private domCache: { [key: number]: Element[] } = {};

    // progress status
    public progressShow: boolean = true;

    // reload で番組表 DOM を更新することを伝える
    public reloadUpdateDom: boolean = false;

    constructor(
        scheduleApiModel: ScheduleApiModelInterface,
        reservesApiModel: ReservesApiModelInterface,
        setting: SettingModelInterface,
    ) {
        super();
        this.scheduleApiModel = scheduleApiModel;
        this.reservesApiModel = reservesApiModel;
        this.setting = setting;
    }

    /**
    * init
    * @param status: ViewModelStatus
    */
    public init(status: ViewModelStatus = 'init'): Promise<void> {
        super.init(status);

        if(status === 'reload') { return this.reloadUpdate(); }
        else if(status === 'updateIo') { return this.updateReservesOnly(); }

        // show progress
        this.progressShow = true;

        // 各種状態を初期化
        this.reserves = null;
        this.cleanCache();
        this.reloadUpdateDom = false;
        this.reservesApiModel.init();
        this.scheduleApiModel.init();
        m.redraw();

        // 番組データを更新 & 反映
        return Util.sleep(100)
        .then(() => {
            return this.updateSchedule();
        })
        .then(() => {
            return this.updateReserves();
        })
        .then(() => {
            m.redraw();
        });
    }

    /**
    * reload 時の番組表更新
    * スクロール位置がリセットされない
    */
    public async reloadUpdate(): Promise<void> {
        // show progress
        this.progressShow = true;
        this.cleanCache();

        // 番組データの更新 & 反映
        await this.updateSchedule();
        await this.updateReserves();
        this.reloadUpdateDom = true;
        m.redraw();
    }

    /**
    * 番組表データを取得する
    */
    public async updateSchedule(): Promise<void> {
        // time の設定
        if(typeof m.route.param('time') === 'undefined') {
            this.startTimeParam = DateUtil.format(DateUtil.getJaDate(new Date()), 'YYMMddhh');
        } else {
            this.startTimeParam = m.route.param('time');
        }

        if(typeof m.route.param('type') !== 'undefined') {
            // 通常の番組表表示
            let type = m.route.param('type');
            this.lengthParam = typeof m.route.param('length') === 'undefined' ? this.setting.value.programLength : Number(m.route.param('length'));

            // 番組表の取得
            await this.scheduleApiModel.fetchSchedule(<apid.ChannelType>type, Number(this.startTimeParam), this.lengthParam);
        } else {
            // 単極表表示
            this.lengthParam = 24;

            this.scheduleApiModel.fetchScheduleId(Number(m.route.param('ch')), Number(this.startTimeParam));
        }
    }

    /**
    * 予約された program id を取得する
    */
    private async updateReserves(): Promise<void> {
        this.reserves = await this.reservesApiModel.fetchAllId();
    }

    /**
    * 番組表の再描画なしに予約状態を更新する
    */
    public async updateReservesOnly(): Promise<void> {
        let newReserves = await this.reservesApiModel.fetchAllId();

        if(this.reserves === null || newReserves === null) { return; }

        // 古い reserves の class を削除
        for(let key in this.reserves) {
            if(typeof this.domCache[key] === 'undefined') { continue; }
            for(let element of this.domCache[key]) {
                element.classList.remove(this.reserves[key].status);
            }
        }

        // 新しい reserves の class を追加
        for(let key in newReserves) {
            if(typeof this.domCache[key] === 'undefined') { continue; }
            for(let element of this.domCache[key]) {
                element.classList.add(newReserves[key].status);
            }
        }

        this.reserves = newReserves;
    }

    /**
    * clean dom cache
    */
    public cleanCache(): void {
        this.domCache = {};
    }

    /**
    * get dom cache
    * @return dom cache
    */
    public getCache(): { [key: number]: Element[] } {
        return this.domCache;
    }

    /**
    * dom cache に element を追加
    * @param programId: program id
    * @param element: element
    */
    public addCache(programId: apid.ProgramId, element: Element): void {
        if(typeof this.domCache[programId] === 'undefined') {
            this.domCache[programId] = [];
        }
        this.domCache[programId].push(element);
    }

    /**
    * getSchedule
    * @return apid.ScheduleProgram[]
    */
    public getSchedule(): apid.ScheduleProgram[] {
        return this.scheduleApiModel.getSchedule();
    }

    /**
    * getReserves
    * @return AllReserves
    */
    public getReserves(): AllReserves | null {
        return this.reserves;
    }

    /**
    * チャンネル一覧を返す
    * @return apid.ScheduleServiceItem[]
    */
    public getChannels(): apid.ScheduleServiceItem[] {
        return this.getSchedule().map((schedule) => {
            return schedule.channel; 
        });
    }

    /**
    * 時刻表示のための数字配列を返す
    * @return number[]
    */
    public getTimes(): number[] {
        if(this.getSchedule().length === 0) { return []; }

        if(typeof this.startTimeParam === 'undefined') { return []; }

        let start = Number(this.startTimeParam.substr(6,2));

        let result: number[] = [];
        for(let i = start; i < start + this.lengthParam; i++) {
            result.push(i % 24);
        }

        return result;
    }

    /**
    * time パラメータを unix time で返す
    */
    public getTimeParam(): { start: number, end: number } {
        if(typeof this.startTimeParam === 'undefined') { return { start: 0, end: 0 }; }

        let start =  new Date(`20${ this.startTimeParam.substr(0, 2) }/${ this.startTimeParam.substr(2, 2) }/${ this.startTimeParam.substr(4, 2) } ${ this.startTimeParam.substr(6, 2) }:00:00 +0900`).getTime();
        let end = start + (this.lengthParam * 60 * 60 * 1000);

        return { start: start, end: end };
    }

    /**
    * 予約情報更新を開始する
    */
    public startUpdateReserves(): Promise<void> {
        return this.scheduleApiModel.startUpdateReserves();
    }

    /**
    * 番組表のスクロール方法を変える必要があるか
    * @return boolean true: 要変更, false: 変更不要
    */
    public isFixScroll(): boolean {
        return this.setting.value.programFixScroll;
    }

    /**
    * 時刻の長さを返す
    * @param number
    */
    public getLengthParam(): number {
        return typeof this.lengthParam === 'undefined' ? 24 : this.lengthParam;
    }
}

namespace ProgramViewModel {
    export const channlesName = 'channels';
    export const timescaleName = 'timescale';
}

export default ProgramViewModel;

