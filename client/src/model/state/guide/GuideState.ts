import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import DateUtil from '../../../util/DateUtil';
import IReservesApiModel from '../..//api/reserves/IReservesApiModel';
import IScheduleApiModel from '../../api/schedule/IScheduleApiModel';
import ISettingStorageModel from '../../storage/setting/ISettingStorageModel';
import IGuideProgramDialogState, { ProgramDialogOpenOption } from './IGuideProgramDialogState';
import IGuideReserveUtil, { ReserveStateItemIndex } from './IGuideReserveUtil';
import IGuideState, { DisplayRange, FetchGuideOption, ProgramDomItem } from './IGuideState';

interface CreateProgramDomOption {
    top: number;
    left: number;
    height: number;
    channel: apid.ScheduleChannleItem;
    program: apid.ScheduleProgramItem;
}

@injectable()
class GuideState implements IGuideState {
    private scheduleApiModel: IScheduleApiModel;
    private reservesApiModel: IReservesApiModel;
    private settingModel: ISettingStorageModel;
    private programDialogState: IGuideProgramDialogState;
    private reserveUtil: IGuideReserveUtil;

    private displayRange: DisplayRange | null = null;
    private startAt: apid.UnixtimeMS = 0;
    private endAt: apid.UnixtimeMS = 0;
    private programDoms: ProgramDomItem[] = [];
    // 番組情報を programId 索引するための変数
    private programDomIndex: { [programId: number]: HTMLElement[] } = {};

    private startTime: string | null = null;
    private timeLength: number = 0;
    private schedules: apid.Schedule[] = [];
    private reserveIndex: ReserveStateItemIndex = {};

    constructor(
        @inject('IScheduleApiModel') scheduleApiModel: IScheduleApiModel,
        @inject('IReservesApiModel') reservesApiModel: IReservesApiModel,
        @inject('ISettingStorageModel') settingModel: ISettingStorageModel,
        @inject('IGuideProgramDialogState') programDialogState: IGuideProgramDialogState,
        @inject('IGuideReserveUtil') reserveUtil: IGuideReserveUtil,
    ) {
        this.scheduleApiModel = scheduleApiModel;
        this.reservesApiModel = reservesApiModel;
        this.settingModel = settingModel;
        this.programDialogState = programDialogState;
        this.reserveUtil = reserveUtil;
    }

    /**
     * データクリア
     */
    public clearDate(): void {
        this.displayRange = null;
        this.startAt = 0;
        this.endAt = 0;
        this.programDoms = [];
        this.programDomIndex = {};

        this.startTime = null;
        this.timeLength = 0;
        this.schedules = [];
        this.reserveIndex = {};
    }

    /**
     * 表示範囲情報の更新
     * @param baseSize: BaseSize
     */
    public setDisplayRange(baseSize: DisplayRange): void {
        this.displayRange = baseSize;
    }

    /**
     * 番組表データの取得
     * @param option
     */
    public async fetchGuide(option: FetchGuideOption): Promise<void> {
        // 開始時刻設定
        this.startTime =
            typeof option.time !== 'undefined'
                ? option.time
                : DateUtil.format(DateUtil.getJaDate(new Date()), 'YYMMddhh');
        const startAt = this.getStartTime(this.startTime);
        let endAt: number;

        if (typeof option.channelId === 'undefined') {
            // 放送局指定ではない
            endAt = startAt + option.length * 60 * 60 * 1000;

            // 表示時刻長を記録
            this.timeLength = option.length;

            const scheduleOption: apid.ScheduleOption = {
                startAt,
                endAt,
                isHalfWidth: option.isHalfWidth,
                GR: false,
                BS: false,
                CS: false,
                SKY: false,
            };

            // 放送波設定
            if (typeof option.type === 'undefined') {
                scheduleOption.GR = true;
                scheduleOption.BS = true;
                scheduleOption.CS = true;
                scheduleOption.SKY = true;
            } else {
                scheduleOption[option.type] = true;
            }

            this.schedules = await this.scheduleApiModel.getSchedule(scheduleOption);
        } else {
            // 放送局指定
            this.timeLength = GuideState.SINGLE_STATION_LENGTH;
            endAt = startAt + 60 * 60 * GuideState.SINGLE_STATION_LENGTH * 1000 * GuideState.SINGLE_STATION_GET_DAYS;

            const scheduleOption: apid.ChannelScheduleOption = {
                startAt: startAt,
                days: GuideState.SINGLE_STATION_GET_DAYS,
                isHalfWidth: option.isHalfWidth,
                channelId: option.channelId,
            };

            this.schedules = await this.scheduleApiModel.getChannelSchedule(scheduleOption);
        }

        this.startAt = startAt;
        this.endAt = endAt;

        // 予約情報取得
        this.reserveIndex = await this.reserveUtil.getReserveIndex({
            startAt,
            endAt,
        });
    }

    /**
     * 番組情報の要素を生成する
     * @param isSingleStation: boolean 単局表示か
     */
    public createProgramDoms(isSingleStation: boolean): void {
        if (this.displayRange === null) {
            throw new Error('CreateProgramDomsError');
        }

        const isHidden = this.settingModel.getSavedValue().guideMode !== 'all';

        this.programDoms = [];
        this.programDomIndex = {};
        let baseStartAt = this.startAt;
        let baseEndAt =
            isSingleStation === true ? baseStartAt + 60 * 60 * GuideState.SINGLE_STATION_LENGTH * 1000 : this.endAt;
        for (let i = 0; i < this.schedules.length; i++) {
            for (const program of this.schedules[i].programs) {
                const programStartAt = baseStartAt > program.startAt ? baseStartAt : program.startAt;

                // プログラム高さ位置
                const top = this.getTop(baseStartAt, programStartAt);
                // 番組高さ
                const height = this.getDiffMin(programStartAt, baseEndAt < program.endAt ? baseEndAt : program.endAt);
                if (height <= 0) {
                    continue;
                }
                // element
                const element = this.createProgramDom(
                    {
                        top,
                        left: i,
                        height: height,
                        channel: this.schedules[i].channel,
                        program: program,
                    },
                    isHidden,
                );

                this.programDoms.push({
                    element,
                    top,
                    left: i,
                    height,
                    isVisible: false,
                });

                // dom 索引作成
                if (typeof this.programDomIndex[program.id] === 'undefined') {
                    this.programDomIndex[program.id] = [];
                }
                this.programDomIndex[program.id].push(element);
            }

            if (isSingleStation === true) {
                baseStartAt += 60 * 60 * GuideState.SINGLE_STATION_LENGTH * 1000;
                baseEndAt = baseStartAt + 60 * 60 * GuideState.SINGLE_STATION_LENGTH * 1000;
            }
        }
    }

    /**
     * 番組表 DOM 生成
     * @param option: CreateProgramDomOption
     * @param isHidden: boolean
     * @return HTMLElement
     */
    private createProgramDom(option: CreateProgramDomOption, isHidden: boolean): HTMLElement {
        // create child
        const child: HTMLElement[] = [];
        child.push(this.createTextElement('div', { class: 'name' }, option.program.name));
        child.push(
            this.createTextElement(
                'div',
                { class: 'time' },
                DateUtil.format(DateUtil.getJaDate(new Date(option.program.startAt)), 'hh:mm'),
            ),
        );
        if (typeof option.program.description !== 'undefined') {
            child.push(this.createTextElement('div', { class: 'description' }, option.program.description));
        }

        // class
        let classStr = 'item';
        if (typeof option.program.genre1 !== 'undefined') {
            classStr += ` ctg-${option.program.genre1.toString(10)}`;
        } else if (typeof option.program.genre2 !== 'undefined') {
            classStr += ` ctg-${option.program.genre2.toString(10)}`;
        } else if (typeof option.program.genre3 !== 'undefined') {
            classStr += ` ctg-${option.program.genre3.toString(10)}`;
        } else {
            classStr += ' ctg-empty';
        }

        // 予約情報追加
        if (typeof this.reserveIndex[option.program.id] !== 'undefined') {
            const reserve = this.reserveIndex[option.program.id];
            classStr += ` ${reserve.type}`;
        }

        const element = this.createParentElement(
            'div',
            {
                class: classStr,
                style:
                    `height: calc(${option.height} * (var(--timescale-height) / 60));` +
                    `top: calc(${option.top} * (var(--timescale-height) / 60)); ` +
                    `left: calc(${option.left} * (var(--channel-width)));` +
                    (isHidden === true ? 'display: none;' : ''),
                onclick: (e: Event) => {
                    const dialogOption: ProgramDialogOpenOption = {
                        channel: option.channel,
                        program: option.program,
                    };

                    // 予約情報セット
                    if (typeof this.reserveIndex[option.program.id] !== 'undefined') {
                        dialogOption.reserve = {
                            type: this.reserveIndex[option.program.id].type,
                            reserveId: this.reserveIndex[option.program.id].item.reserveId,
                            ruleId: this.reserveIndex[option.program.id].item.ruleId,
                        };
                    }
                    this.programDialogState.open(dialogOption);
                },
            },
            child,
        );

        return element;
    }

    /**
     * 子要素付き element を生成する
     * @param tag: tag
     * @param attrs: attrs
     * @param childs: childs
     * @return HTMLElement
     */
    private createParentElement(tag: string, attrs: { [key: string]: any }, childs: HTMLElement[]): HTMLElement {
        const element = document.createElement(tag);
        for (const key in attrs) {
            if (key === 'onclick') {
                element.onclick = attrs[key];
            } else {
                element.setAttribute(key, attrs[key]);
            }
        }

        // add childs
        childs.map((child: HTMLElement) => {
            element.appendChild(child);
        });

        return element;
    }

    /**
     * 子要素付き element を生成する
     * @param tag: tag
     * @param attrs: attrs
     * @param text: text
     * @return HTMLElement
     */
    private createTextElement(tag: string, attrs: { [key: string]: any }, text: string): HTMLElement {
        const element = document.createElement(tag);
        for (const key in attrs) {
            element.setAttribute(key, attrs[key]);
        }
        element.innerText = text;

        return element;
    }

    /**
     * 番組要素の表示状態を更新する
     */
    public updateVisible(): void {
        const guideMode = this.settingModel.getSavedValue().guideMode;
        if (this.displayRange === null || guideMode === 'all') {
            return;
        }

        const topStart =
            (this.displayRange.offsetHeight - this.displayRange.maxHeight * GuideState.DisplayMargin) /
            (this.displayRange.baseHeight / 60);
        const topEnd =
            (this.displayRange.offsetHeight + this.displayRange.maxHeight * (1 + this.displayRange.maxHeight)) /
            (this.displayRange.baseHeight / 60);
        for (const dom of this.programDoms) {
            if (guideMode === 'sequential' && dom.isVisible === true) {
                continue;
            }
            let isVisible = true;

            // 幅方向
            if (
                (dom.left + 1) * this.displayRange.baseWidth <=
                    this.displayRange.offsetWidth - this.displayRange.maxWidth * GuideState.DisplayMargin ||
                dom.left * this.displayRange.baseWidth >=
                    this.displayRange.maxWidth * (1 + GuideState.DisplayMargin) + this.displayRange.offsetWidth
            ) {
                isVisible = false;
            }

            // 高さ方向
            if (dom.top >= topEnd || dom.top + dom.height <= topStart) {
                isVisible = false;
            }

            // 現在の表示と違っていれば更新
            if (dom.isVisible !== isVisible) {
                dom.isVisible = isVisible;
                dom.element.style.display = isVisible ? '' : 'none';
            }
        }
    }

    /**
     * 予約状態を更新する
     * @reutn Promise<void>
     */
    public async updateReserves(): Promise<void> {
        const newReserveIndex = await this.reserveUtil.getReserveIndex({
            startAt: this.startAt,
            endAt: this.endAt,
        });

        // 古い予約情報の class を削除
        for (const programId in this.reserveIndex) {
            if (typeof this.programDomIndex[programId] === 'undefined') {
                continue;
            }

            for (const element of this.programDomIndex[programId]) {
                element.classList.remove(this.reserveIndex[programId].type);
            }
        }

        // 新しい予約情報の class を追加
        for (const programId in newReserveIndex) {
            if (typeof this.programDomIndex[programId] === 'undefined') {
                continue;
            }

            for (const element of this.programDomIndex[programId]) {
                element.classList.add(newReserveIndex[programId].type);
            }
        }

        this.reserveIndex = newReserveIndex;

        // 番組ダイアログを開いている場合は予約情報を更新する
        if (this.programDialogState.isOpen === true) {
            const programId = this.programDialogState.getProgramId();
            if (programId !== null) {
                this.programDialogState.updateReserve(
                    typeof this.reserveIndex[programId] === 'undefined'
                        ? null
                        : {
                              type: this.reserveIndex[programId].type,
                              reserveId: this.reserveIndex[programId].item.reserveId,
                              ruleId: this.reserveIndex[programId].item.ruleId,
                          },
                );
            }
        }
    }

    /**
     * 番組情報の表示位置を返す
     * @param startAt: UnixtimeMS 番組表開始時刻
     * @param programStartAt: UnixtimeMS 番組データ開始時刻
     * @return number
     */
    private getTop(startAt: apid.UnixtimeMS, programStartAt: apid.UnixtimeMS): number {
        return startAt === programStartAt ? 0 : Math.ceil(Math.floor((programStartAt - startAt) / 1000) / 60);
    }

    /**
     * startAt と endAt の差分を分で返す
     * @param startAt: UnixtimeMS
     * @param endAt: UnixtimeMS
     * @return number
     */
    private getDiffMin(startAt: apid.UnixtimeMS, endAt: apid.UnixtimeMS): number {
        return Math.ceil((endAt - startAt) / 60 / 1000);
    }

    /**
     * 引数で渡した時刻文字列 (YYMMddhh) を を UnixtimeMS に変換する
     * @param timeStr: string | null
     * @return UnixtimeMS
     */
    private getStartTime(timeStr: string | null): apid.UnixtimeMS {
        if (timeStr === null) {
            throw new Error('StartTimeOptionIsNull');
        }

        return new Date(
            `20${timeStr.substr(0, 2)}/${timeStr.substr(2, 2)}/` +
                `${timeStr.substr(4, 2)} ${timeStr.substr(6, 2)}:00:00 +0900`,
        ).getTime();
    }

    /**
     * 放送局情報を返す
     * @return apid.ScheduleChannleItem[]
     */
    public getChannels(): apid.ScheduleChannleItem[] {
        return this.schedules.map(schedule => {
            return schedule.channel;
        });
    }

    /**
     * 放送局数の個数を返す
     * @return number
     */
    public getChannelsLength(): number {
        return this.schedules.length;
    }

    /**
     * 番組取得の開始時刻を返す
     */
    public getStartAt(): apid.UnixtimeMS {
        return this.startAt;
    }

    /**
     * 時刻表示用の数字配列を返す
     * @return number[]
     */
    public getTimes(): number[] {
        if (this.startTime === null || this.startTime.length === 0) {
            return [];
        }

        const start = parseInt(this.startTime.substr(6, 2), 10);
        if (isNaN(start) === true) {
            return [];
        }

        const result: number[] = [];
        for (let i = start; i < start + this.timeLength; i++) {
            result.push(i % 24);
        }

        return result;
    }

    /**
     * 時刻表示用の数字列の長さを返す
     * @return number
     */
    public getTimesLength(): number {
        return this.timeLength;
    }

    /**
     * 番組
     * @return ProgramDomItem[]
     */
    public getProgramDoms(): ProgramDomItem[] {
        return this.programDoms;
    }

    /**
     * title 取得
     * @param type?: string 放送波種別
     * @return string
     */
    public getTitle(type?: string): string {
        let title = '番組表';

        if (typeof type !== 'undefined') {
            title += type;
        }

        if (this.startAt > 0) {
            title += DateUtil.format(DateUtil.getJaDate(new Date(this.startAt)), ' MM/dd(w)');
        }

        return title;
    }
}

namespace GuideState {
    export const DisplayMargin = 0.5;
    export const SINGLE_STATION_GET_DAYS = 8;
    export const SINGLE_STATION_LENGTH = 24;
}

export default GuideState;
