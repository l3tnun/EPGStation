import * as m from 'mithril';
import ViewModel from '../ViewModel';
import { ViewModelStatus } from '../../Enums';
import * as apid from '../../../../api';
import { ScheduleApiModelInterface } from '../../Model/Api/ScheduleApiModel';
import Util from '../../Util/Util';
import DateUtil from '../../Util/DateUtil';
import { AllReserves, ReservesApiModelInterface } from '../../Model/Api/ReservesApiModel';
import { SettingModelInterface } from '../../Model/Setting/SettingModel';
import { ProgramSettingModelInterface } from '../../Model/Program/ProgramSettingModel';

interface ProgramViewInfo {
    element: HTMLElement,
    top: number,
    left: number,
    end: number,
    isVisible: boolean,
}

/**
* ProgramViewModel
*/
class ProgramViewModel extends ViewModel {
    private scheduleApiModel: ScheduleApiModelInterface;
    private reservesApiModel: ReservesApiModelInterface;
    private setting: SettingModelInterface;
    private programSetting: ProgramSettingModelInterface;
    // 更新時刻パラメータ
    private startTimeParam: string;
    private lengthParam: number;
    private reserves: AllReserves | null = null;
    private domCache: { [key: number]: Element[] } = {};

    // progress status
    public progressShow: boolean = true;

    // reload で番組表 DOM を更新することを伝える
    public reloadUpdateDom: boolean = false;

    // 番組表描画情報を格納する
    public items: ProgramViewInfo[] = [];

    constructor(
        scheduleApiModel: ScheduleApiModelInterface,
        reservesApiModel: ReservesApiModelInterface,
        setting: SettingModelInterface,
        programSetting: ProgramSettingModelInterface,
    ) {
        super();
        this.scheduleApiModel = scheduleApiModel;
        this.reservesApiModel = reservesApiModel;
        this.setting = setting;
        this.programSetting = programSetting;
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
        } else if(typeof m.route.param('ch') !== 'undefined') {
            // 単極表表示
            this.lengthParam = 24;

            let days = typeof m.route.param('days') === 'undefined' ? 8 : Number(m.route.param('days'));
            if(days < 1 || days > 8) { days = 8; }

            this.scheduleApiModel.fetchScheduleId(
                Number(m.route.param('ch')),
                Number(this.startTimeParam),
                days,
            );
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

    /**
    * 番組表の描画範囲を最小にするか
    * @return boolean
    */
    public isMinimumDrawing(): boolean {
        return this.setting.value.programMinimumDrawing;
    }

    /**
    * 番組表の描画範囲を限定するか
    * @return boolean
    */
    public isEnableDraw(): boolean {
        return !Util.uaIsSafari() && !(Util.uaIsAndroid() && !this.isFixScroll());
    }

    /**
    * 番組表の描画
    */
    public draw(): void {
        if(!this.isEnableDraw() || this.items.length <= 0) { return; }

        const element = <HTMLElement>(this.isFixScroll() ? document.getElementsByClassName('mdl-layout')[0] : document.querySelector(`.${ ProgramViewModel.boardName }`));
        if(element === null) { return; }

        const stationWidth = this.getCssVariable('--channel-width');
        const timeBaseHeight = this.getCssVariable('--timescale-height') / 60;
        let viewWidth: number;
        let viewHeight: number;
        if(this.isFixScroll()) {
            const viewElement = <HTMLElement>document.querySelector(`.${ ProgramViewModel.programTableName }`);
            if(viewElement === null) { return; }
            viewWidth = viewElement.offsetWidth;
            viewHeight = viewElement.offsetHeight;
        } else {
            viewWidth = element.offsetWidth;
            viewHeight = element.offsetHeight;
        }

        const isMinimumDrawing = this.isMinimumDrawing();
        this.items.forEach((item) => {
            const stationLeft = stationWidth * item.left - element.scrollLeft;
            const stationRight = stationWidth + stationLeft;
            const itemTop = item.top * timeBaseHeight - element.scrollTop;
            const itemEnd = item.end * timeBaseHeight - element.scrollTop;

            // 表示範囲か
            if(0 <= stationRight && stationLeft <= viewWidth && 0 <= itemEnd && itemTop <= viewHeight) {
                if(!item.isVisible) {
                    item.element.style.display = '';
                    item.isVisible = true;
                }
            } else {
                if(item.isVisible && isMinimumDrawing) {
                    item.element.style.display = 'none';
                    item.isVisible = false;
                }
            }
        });
    }

    /**
    * get CSS Variables
    * @param name
    * @return number
    */
    private getCssVariable(name: string): number {
        const element = document.querySelector(`.${ ProgramViewModel.programTableName }`);
        if(element === null) { return 0; }
        const style = window.getComputedStyle(element);
        return Number(style.getPropertyValue(name).trim().replace('px', ''));
    }

    /**
    * set program setting
    */
    public setProgramSetting(): void {
        const element = <HTMLElement>document.querySelector(`.${ ProgramViewModel.programTableName }`);
        if(element === null) { return; }

        const value = this.programSetting.value;
        element.style.setProperty('--channel-tablet-height', `${ value.tablet.channelHeight }px`);
        element.style.setProperty('--channel-tablet-width', `${ value.tablet.channelWidth }px`);
        element.style.setProperty('--channel-tablet-fontsize', `${ value.tablet.channelFontsize }px`);
        element.style.setProperty('--timescale-tablet-height', `${ value.tablet.timescaleHeight }px`);
        element.style.setProperty('--timescale-tablet-width', `${ value.tablet.timescaleWidth }px`);
        element.style.setProperty('--timescale-tablet-fontsize', `${ value.tablet.timescaleFontsize }px`);
        element.style.setProperty('--board-tablet-fontsize', `${ value.tablet.boardFontsize }pt`);

        element.style.setProperty('--channel-mobile-height', `${ value.mobile.channelHeight }px`);
        element.style.setProperty('--channel-mobile-width', `${ value.mobile.channelWidth }px`);
        element.style.setProperty('--channel-mobile-fontsize', `${ value.mobile.channelFontsize }px`);
        element.style.setProperty('--timescale-mobile-height', `${ value.mobile.timescaleHeight }px`);
        element.style.setProperty('--timescale-mobile-width', `${ value.mobile.timescaleWidth }px`);
        element.style.setProperty('--timescale-mobile-fontsize', `${ value.mobile.timescaleFontsize }px`);
        element.style.setProperty('--board-mobile-fontsize', `${ value.mobile.boardFontsize }pt`);
    }
}

namespace ProgramViewModel {
    export const programTableName = 'ProgramTable';
    export const boardName = 'board';
    export const channlesName = 'channels';
    export const timescaleName = 'timescale';
}

export { ProgramViewInfo, ProgramViewModel };

