import { throttle } from 'lodash';
import * as m from 'mithril';
import * as apid from '../../../../api';
import { AllReserves } from '../../Model/Api/ReservesApiModel';
import DateUtil from '../../Util/DateUtil';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import ProgramGenreViewModel from '../../ViewModel/Program/ProgramGenreViewModel';
import ProgramInfoViewModel from '../../ViewModel/Program/ProgramInfoViewModel';
import { ProgramViewInfo, ProgramViewModel  } from '../../ViewModel/Program/ProgramViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';
import BoardBarComponent from './BoardBarComponent';
import BoardScroller from './BoardScroller';

interface BoardArgs {
    scrollStoped(top: number, left: number): void;
    isNeedRestorePosition(): boolean;
    resetRestorePositionFlag(): void;
    getPosition(): { top: number; left: number } | null;
}

/**
 * BoardComponent
 */
class BoardComponent extends Component<BoardArgs> {
    private viewModel: ProgramViewModel;
    private infoViewModel: ProgramInfoViewModel;
    private genreViewModel: ProgramGenreViewModel;

    private balloon: BalloonViewModel;
    private allReserves: AllReserves;
    private storedGenre: { [key: number]: boolean } = {};

    private scroller: BoardScroller = new BoardScroller();

    constructor() {
        super();
        this.viewModel = <ProgramViewModel> factory.get('ProgramViewModel');
        this.infoViewModel = <ProgramInfoViewModel> factory.get('ProgramInfoViewModel');
        this.genreViewModel = <ProgramGenreViewModel> factory.get('ProgramGenreViewModel');
        this.balloon = <BalloonViewModel> factory.get('BalloonViewModel');
    }

    /**
     * view
     */
    public view(mainVnode: m.Vnode<BoardArgs, this>): m.Children | null {
        // 予約情報を取得
        const reserves = this.viewModel.getReserves();
        if (reserves === null) { return null; }
        this.allReserves = reserves;

        // ジャンル情報を取得
        const genre = this.genreViewModel.get();
        this.storedGenre = genre === null ? {} : genre;

        const schedules = this.viewModel.getSchedule();
        if (schedules.length === 0) {
            this.viewModel.progressShow = false;

            return null;
        }

        return m('div', {
            class: `${ ProgramViewModel.boardName } non-scroll`,
            oncreate: (vnode: m.VnodeDOM<BoardArgs, this>) => {
                if (this.viewModel.isFixScroll()) { return; }

                // scroll
                const element = <HTMLElement> vnode.dom;
                const channel = <HTMLElement> document.getElementsByClassName(ProgramViewModel.channlesName)[0];
                const time = <HTMLElement> document.getElementsByClassName(ProgramViewModel.timescaleName)[0];
                this.scroller.set(element, channel, time,
                    () => { this.viewModel.disableShowDetail(); },
                    () => { this.viewModel.enableShowDetail(); },
                    () => { return !this.infoViewModel.isOpend(); },
                );

                // scroll position
                let url = location.href;
                element.addEventListener('scroll', throttle(() => {
                    if (this.viewModel.progressShow) { return; }
                    if (url !== location.href) {
                        url = location.href;

                        return;
                    }
                    mainVnode.attrs.scrollStoped(element.scrollTop, element.scrollLeft);
                }, 50), true);

                // 表示範囲設定
                if (this.viewModel.isEnableDraw()) {
                    element.addEventListener('scroll', () => { this.viewModel.draw(); }, true);
                }
            },
            onupdate: (vnode: m.VnodeDOM<BoardArgs, this>) => {
                if (this.viewModel.isFixScroll() || !mainVnode.attrs.isNeedRestorePosition() || this.viewModel.progressShow) { return; }
                mainVnode.attrs.resetRestorePositionFlag();

                // scroll position を復元する
                const position = mainVnode.attrs.getPosition();
                if (position === null) { return; }
                const element = <HTMLElement> vnode.dom;
                element.scrollTop = position.top;
                element.scrollLeft = position.left;
            },
            onremove: () => {
                if (this.viewModel.isFixScroll()) { return; }

                this.scroller.remove();
            },
        }, [
            m('div', {
                class: 'frame',
                style: `min-width: calc(${ schedules.length } * var(--channel-width));`
                    + `max-width: calc(${ schedules.length } * var(--channel-width));`
                    + `height: calc(var(--timescale-height) * ${ this.viewModel.getLengthParam() });`
                    + 'position: absolute;',
                oncreate: (vnode: m.VnodeDOM<BoardArgs, this>) => {
                    // add child
                    for (let i = 0; i < schedules.length; i++) {
                        this.createStationChild(vnode.dom, schedules[i], i);
                    }

                    // progress 非表示
                    this.viewModel.draw();
                    window.setTimeout(() => { this.viewModel.progressShow = false; m.redraw(); }, 200);
                },
                onupdate: (vnode: m.VnodeDOM<BoardArgs, this>) => {
                    if (!this.viewModel.reloadUpdateDom) { return; }

                    // remove child
                    for (let i = vnode.dom.childNodes.length - 1; i > 0; i--) {
                        vnode.dom.removeChild(vnode.dom.childNodes[i]);
                    }

                    // add child
                    for (let i = 0; i < schedules.length; i++) {
                        this.createStationChild(vnode.dom, schedules[i], i);
                    }

                    this.viewModel.draw();
                    window.setTimeout(() => { this.viewModel.reloadUpdateDom = false; this.viewModel.progressShow = false; m.redraw(); }, 200);
                },
            }, [
                m(BoardBarComponent),
            ]),
        ]);
    }

    /**
     * 番組表を生成する
     * @param element: Element
     * @param program: apid.ScheduleProgramItem
     * @param column:番組表内の列位置
     */
    private createStationChild(element: Element, schedule: apid.ScheduleProgram, column: number): void {
        if (column === 0) { this.viewModel.items = []; }

        const isEnableDraw = this.viewModel.isEnableDraw();
        const programs = schedule.programs;
        const time = this.viewModel.getTimeParam();

        // 単局表示時
        if (typeof m.route.param('ch') !== 'undefined') {
            const addTime = column * 24 * 60 * 60 * 1000;
            time.start += addTime;
            time.end += addTime;
        }

        const childs: ProgramViewInfo[] = [];
        const programsLength = programs.length;
        programs.forEach((program, i) => {
            // 時刻
            const start = program.startAt < time.start ? time.start : program.startAt;
            const end = program.endAt > time.end ? time.end : program.endAt;

            const dummyEnd = i - 1 < 0 ? time.start : programs[i - 1].endAt;
            if (dummyEnd - start < 0) {
                // 一つ前のプログラムと連続でないため間にダミーを追加
                const height = this.getHeight(dummyEnd, start);
                const position = this.getPosition(time.start, dummyEnd);
                childs.push({
                    element: this.createDummy(height, position, column, isEnableDraw),
                    top: position,
                    left: column,
                    end: position + height,
                    isVisible: false,
                });
            }

            // 番組を追加
            if (start !== end) {
                const height = this.getHeight(start, end);
                const position = this.getPosition(time.start, start);
                childs.push({
                    element: this.createContent(height, position, program, schedule.channel, column, isEnableDraw),
                    top: position,
                    left: column,
                    end: position + height,
                    isVisible: false,
                });
            }

            // 最後の番組と番組表の終了時刻に空きがあったら埋める
            if (programsLength - 1 === i && time.end > end) {
                const height = this.getHeight(end, time.end);
                const position = this.getPosition(time.start, end);
                childs.push({
                    element: this.createDummy(height, position, column, isEnableDraw),
                    top: position,
                    left: column,
                    end: position + height,
                    isVisible: false,
                });
            }
        });

        // programs が空
        if (childs.length === 0) {
            const height = this.getHeight(time.start, time.end);
            const position = this.getPosition(time.start, time.start);
            childs.push({
                element: this.createDummy(height, position, column, isEnableDraw),
                top: position,
                left: column,
                end: position + height,
                isVisible: false,
            });
        }

        const fragment = document.createDocumentFragment();
        childs.map((child) => {
            this.viewModel.items.push(child);
            fragment.appendChild(child.element);
        });
        element.appendChild(fragment);
    }

    /**
     * 高さを計算
     * @param start: number
     * @param end: number
     * @return height
     */
    private getHeight(start: number, end: number): number {
        // 端数秒切り捨て
        start = Math.floor(start / 10000);
        end = Math.floor(end / 10000);

        return Math.ceil((end - start) / 6);
    }

    /**
     * 位置を計算
     * @param startTime: number
     * @param startProgram: number
     * @return position
     */
    private getPosition(startTime: number, startProgram: number): number {
        // 端数秒切り捨て
        startTime = Math.floor(startTime / 10000);
        startProgram = Math.floor(startProgram / 10000);

        return Math.ceil((startProgram - startTime) / 6);
    }


    /**
     * left を生成
     * @param column: number
     * @return string;
     */
    private createLeftStyle(column: number): string {
        return `left: calc(${ column } * var(--channel-width) - 1px);`;
    }

    /**
     * dummy 要素を作成
     * @param heght: height
     * @param position: position
     * @param column: number
     * @param isEnableDraw: boolean
     * @return HTMLElement
     */
    private createDummy(height: number, position: number, column: number, isEnableDraw: boolean): HTMLElement {
        if (height === 0) { return document.createElement('div'); }

        return this.createTextElement('div', {
            class: 'item nodata',
            style: `height: calc(${ height } * (var(--timescale-height) / 60)); top: calc(${ position } * (var(--timescale-height) / 60));`
            + (isEnableDraw ? 'display: none;' : '')
            + this.createLeftStyle(column),
        },
        'n');
    }

    /**
     * 通常の番組情報を作成
     * @param height: height
     * @param position: position
     * @param program: program
     * @param column: number
     * @param isEnableDraw: boolean
     * @return HTMLElement
     */
    private createContent(
        height: number,
        position: number,
        program: apid.ScheduleProgramItem,
        channel: apid.ScheduleServiceItem,
        column: number,
        isEnableDraw: boolean,
    ): HTMLElement {
        if (height === 0) { return document.createElement('div'); }

        let classStr = 'item';
        if (typeof program.genre1 !== 'undefined') {
            if (typeof this.storedGenre[program.genre1] !== 'undefined' && !this.storedGenre[program.genre1]) {
                classStr += ' hide';
            } else {
                classStr += ` ctg-${ program.genre1 }`;
            }
        }
        if (typeof this.allReserves[program.id] !== 'undefined') {
            switch (this.allReserves[program.id].status) {
                case 'reserve':
                    classStr += ' reserve';
                    break;
                case 'conflict':
                    classStr += ' conflict';
                    break;
                case 'skip':
                    classStr += ' skip';
                    break;
                case 'overlap':
                    classStr += ' overlap';
                    break;
            }
        }

        const child: HTMLElement[] = [];
        child.push(this.createTextElement('div', { class: 'title' }, program.name));
        child.push(this.createTextElement('div', { class: 'time' }, DateUtil.format(DateUtil.getJaDate(new Date(program.startAt)), 'hh:mm')));
        if (typeof program.description !== 'undefined') {
            child.push(this.createTextElement('div', { class: 'description' }, program.description));
        }

        const element = this.createParentElement('div', {
            class: classStr,
            style: `height: calc(${ height } * (var(--timescale-height) / 60)); top: calc(${ position } * (var(--timescale-height) / 60));`
                + (isEnableDraw ? 'display: none;' : '')
                + this.createLeftStyle(column),
            onclick: (event: Event) => {
                if (!this.viewModel.isEnableShowDetail()) { return; }

                this.infoViewModel.set(program, channel);
                this.balloon.open(ProgramInfoViewModel.id, event);
            },
        }, child);

        // cache に追加
        this.viewModel.addCache(program.id, element);

        return element;
    }

    /**
     * 子要素付き element を生成する
     * @param tag: tag
     * @param attrs: attrs
     * @param childs: childs
     * @return HTMLElement
     */
    private createParentElement(tag: string, attrs: { [key: string]: any }, childs: Element[]): HTMLElement {
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
        for (const key in attrs) { element.setAttribute(key, attrs[key]); }
        element.innerText = text;

        return element;
    }
}

export default BoardComponent;

