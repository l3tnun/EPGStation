import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import ProgramViewModel from '../../ViewModel/Program/ProgramViewModel';
import * as apid from '../../../../api';
import { AllReserves } from '../../Model/Api/ReservesApiModel';
import DateUtil from '../../Util/DateUtil';
import BoardBarComponent from './BoardBarComponent';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import ProgramInfoViewModel from '../../ViewModel/Program/ProgramInfoViewModel';
import ProgramGenreViewModel from '../../ViewModel/Program/ProgramGenreViewModel';

/**
* BoardComponent
*/
class BoardComponent extends Component<void> {
    private viewModel: ProgramViewModel;
    private infoViewModel: ProgramInfoViewModel;
    private genreViewModel: ProgramGenreViewModel;

    private balloon: BalloonViewModel;
    private allReserves: AllReserves;
    private storedGenre: { [key: number]: boolean; } = {};

    constructor() {
        super();
        this.viewModel = <ProgramViewModel>(factory.get('ProgramViewModel'));
        this.infoViewModel = <ProgramInfoViewModel>(factory.get('ProgramInfoViewModel'));
        this.genreViewModel = <ProgramGenreViewModel>(factory.get('ProgramGenreViewModel'));
        this.balloon = <BalloonViewModel>(factory.get('BalloonViewModel'));
    }

    /**
    * view
    */
    public view(): m.Children | null {
        // 予約情報を取得
        let reserves = this.viewModel.getReserves();
        if(reserves === null) { return null; }
        this.allReserves = reserves;

        // ジャンル情報を取得
        let genre = this.genreViewModel.get();
        this.storedGenre = genre === null ? {} : genre;

        const schedules = this.viewModel.getSchedule();

        return m('div', {
            class: 'board non-scroll',
            oncreate:(vnode: m.VnodeDOM<void, this>) => {
                if(this.viewModel.isFixScroll()) { return; }

                let element = <HTMLElement> vnode.dom;
                let channel = <HTMLElement> document.getElementsByClassName(ProgramViewModel.channlesName)[0];
                let time = <HTMLElement> document.getElementsByClassName(ProgramViewModel.timescaleName)[0];

                // scroll 設定
                element.onscroll = () => {
                    channel.scrollLeft = element.scrollLeft;
                    time.scrollTop = element.scrollTop;
                }
            },
        }, [
            schedules.map((schedule, i) => {
                return m('div', {
                    class: 'station',
                    style: `left: calc(${ i } * var(--channel-width) + var(--time-width))`,
                    oncreate: (vnode: m.VnodeDOM<void, this>) => {
                        this.createStationChild(vnode.dom, schedule, i);

                        // progress 非表示
                        if(i ==  this.viewModel.getSchedule().length - 1) {
                            setTimeout(() => { this.viewModel.progressShow = false; m.redraw(); }, 200);
                        }
                    },
                    onupdate: (vnode: m.VnodeDOM<void, this>) => {
                        if(!this.viewModel.reloadUpdateDom) { return; }

                        // remove child
                        for (let i = vnode.dom.childNodes.length - 1; i >= 0; i--) {
                            vnode.dom.removeChild(vnode.dom.childNodes[i]);
                        }

                        this.createStationChild(vnode.dom, schedule, i);

                        // progress 非表示 & reloadUpdateDom = false
                        if(i ==  this.viewModel.getSchedule().length - 1) {
                            setTimeout(() => { this.viewModel.reloadUpdateDom = false; this.viewModel.progressShow = false; m.redraw(); }, 200);
                        }
                    }
                })
            }),
            m(BoardBarComponent),
        ]);
    }

    /**
    * 番組表を生成する
    * @param element: Element
    * @param program: apid.ScheduleProgramItem
    * @param column:番組表内の列位置
    */
    private createStationChild(element: Element, schedule: apid.ScheduleProgram, column: number): void {
        let programs = schedule.programs;
        let time = this.viewModel.getTimeParam();

        // 単局表示時
        if(typeof m.route.param('ch') !== 'undefined') {
            let addTime = column * 24 * 60 * 60 * 1000;
            time.start += addTime;
            time.end += addTime;
        }

        let childs: Element[] = [];
        let programsLength = programs.length;
        programs.forEach((program, i) => {
            // 時刻
            let start = program.startAt < time.start ? time.start : program.startAt;
            let end = program.endAt > time.end ? time.end : program.endAt;

            let dummyEnd = i - 1 < 0 ? time.start : programs[i - 1].endAt;
            if(dummyEnd - start < 0) {
                // 一つ前のプログラムと連続でないため間にダミーを追加
                childs.push(this.createDummy(this.getHeight(dummyEnd, start), this.getPosition(time.start, dummyEnd)));
            }

            // 番組を追加
            if(start !== end) {
                childs.push(this.createContent(this.getHeight(start, end), this.getPosition(time.start, start), program, schedule.channel));
            }

            // 最後の番組と番組表の終了時刻に空きがあったら埋める
            if(programsLength - 1 === i && time.end > end) {
                childs.push(this.createDummy(this.getHeight(end, time.end), this.getPosition(time.start, end)));
            }
        });

        // programs が空
        if(childs.length === 0) {
            childs.push(this.createDummy(this.getHeight(time.start, time.end), this.getPosition(time.start, time.start)));
        }

        let fragment = document.createDocumentFragment();
        childs.map((child) => {
            fragment.appendChild(child);
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
    * dummy 要素を作成
    * @param heght: height
    * @param position: position
    * @return Element
    */
    private createDummy(height: number, position: number): Element {
        if(height == 0) { return document.createElement('div'); }

        return this.createTextElement('div', {
            class: 'item nodata',
            style: `height: calc(${ height } * var(--time-base-height)); top: calc(${ position } * var(--time-base-height));`,
        },
        'n');
    }

    /**
    * 通常の番組情報を作成
    * @param height: height
    * @param position: position
    * @param program: program
    * @return Element
    */
    private createContent(height: number, position: number, program: apid.ScheduleProgramItem, channel: apid.ScheduleServiceItem): Element {
        if(height === 0) { return document.createElement('div'); }

        let classStr = 'item';
        if(typeof program.genre1 !== 'undefined') {
            if(typeof this.storedGenre[program.genre1] !== 'undefined' && !this.storedGenre[program.genre1]) {
                classStr += ' hide';
            } else {
                classStr += ` ctg-${ program.genre1 }`;
            }
        }
        if(typeof this.allReserves[program.id] !== 'undefined') {
            switch(this.allReserves[program.id].status) {
                case 'reserve':
                    classStr += ' reserve';
                    break;
                case 'conflict':
                    classStr += ' conflict';
                    break;
                case 'skip':
                    classStr += ' skip';
                    break;
            }
        }

        let child: Element[] = [];
        child.push(this.createTextElement('div', { class: 'title' }, program.name));
        child.push(this.createTextElement('div', { class: 'time' }, DateUtil.format(DateUtil.getJaDate(new Date(program.startAt)), 'hh:mm:ss')));
        if(typeof program.description !== 'undefined') {
            child.push(this.createTextElement('div', { class: 'description' }, program.description))
        }

        let element = this.createParentElement('div', {
            class: classStr,
            style: `height: calc(${ height } * var(--time-base-height)); top: calc(${ position } * var(--time-base-height));`,
            onclick: (event: Event) => {
                this.infoViewModel.set(program, channel);
                this.balloon.open(ProgramInfoViewModel.id, event);
            }
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
    * @return Element
    */
    private createParentElement(tag: string, attrs: { [key: string]: any }, childs: Element[]): Element {
        let element = document.createElement(tag);
        for(let key in attrs) {
            if(key === 'onclick') {
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
    * @return Element
    */
    private createTextElement(tag: string, attrs: { [key: string]: any }, text: string): Element {
        let element = document.createElement(tag);
        for(let key in attrs) { element.setAttribute(key, attrs[key]); }
        element.innerText = text;

        return element;
    }
}

export default BoardComponent;

