import * as m from 'mithril';
import { throttle } from 'lodash';
import ParentComponent from '../ParentComponent';
import { ViewModelStatus } from '../../Enums';
import MainLayoutComponent from '../MainLayoutComponent';
import factory from '../../ViewModel/ViewModelFactory';
import { ProgramViewModel } from '../../ViewModel/Program/ProgramViewModel';
import ChannelComponent from './ChannelComponent';
import TimeScaleComponent from './TimeScaleComponent';
import BoardComponent from './BoardComponent';
import ProgressComponent from './ProgressComponent';
import DateUtil from '../../Util/DateUtil';
import { BalloonComponent } from '../BalloonComponent';
import ProgramInfoComponent from './ProgramInfoComponent';
import ProgramInfoActionComponent from './ProgramInfoActionComponent';
import ProgramInfoViewModel from '../../ViewModel/Program/ProgramInfoViewModel';
import ProgramTimeBalloonViewModel from '../../ViewModel/Program/ProgramTimeBalloonViewModel';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import ProgramTimeBalloonComponent from './ProgramTimeBalloonComponent';
import ProgramGenreViewModel from '../../ViewModel/Program/ProgramGenreViewModel';
import ProgramGenreComponent from './ProgramGenreComponent';
import ProgramGenreActionComponent from './ProgramGenreActionComponent';
import StreamSelectComponent from '../Stream/StreamSelectComponent';
import StreamSelectViewModel from '../../ViewModel/Stream/StreamSelectViewModel'

/**
* ProgramComponent
*/
class ProgramComponent extends ParentComponent<void> {
    private viewModel: ProgramViewModel;
    private genre: ProgramGenreViewModel;
    private timeBalloon: ProgramTimeBalloonViewModel;
    private balloon: BalloonViewModel;

    private resizeListener = throttle(() => { this.viewModel.draw(); }, 50);

    constructor() {
        super();
        this.viewModel = <ProgramViewModel>(factory.get('ProgramViewModel'));
        this.genre = <ProgramGenreViewModel>(factory.get('ProgramGenreViewModel'));
        this.timeBalloon = <ProgramTimeBalloonViewModel>(factory.get('ProgramTimeBalloonViewModel'));
        this.balloon = <BalloonViewModel>(factory.get('BalloonViewModel'));
    }

    protected initViewModel(status: ViewModelStatus = 'init'): void {
        super.initViewModel(status);
        this.viewModel.init(status)
        .then(() => {
            this.setRestorePositionFlag(status);
        });
    }

    /**
    * page name
    */
    protected getComponentName(): string { return 'Program'; }

    /**
    * view
    */
    public view(): m.Children {
        return m(MainLayoutComponent, {
            header: {
                title: this.createTitle(),
                button: [
                    m('label', {
                        class: 'header-menu-button mdl-button mdl-js-button mdl-button--icon',
                        onclick: (event: Event) => {
                            this.timeBalloon.setNowNum(this.viewModel.getTimeParam().start);
                            this.balloon.open(ProgramTimeBalloonViewModel.id, event);
                        },
                    }, m('i', { class: 'material-icons' }, 'schedule')),
                ],
                headerStyle: this.viewModel.isFixScroll() ? 'position: fixed;' : '',
            },
            menuContent: [
                { attrs: {
                    onclick: () => {
                        this.balloon.close();
                        setTimeout(() => {
                            this.genre.init();
                            this.balloon.open(ProgramGenreViewModel.id);
                        }, 200);
                    }
                }, text: '表示ジャンル' },
                { attrs: {
                    onclick: () => {
                        this.balloon.close();
                        setTimeout(() => {
                            this.viewModel.startUpdateReserves();
                        }, 200);
                    }
                }, text: '予約情報更新' },
            ],
            notMainContent: [
                m('div', {
                    class: ProgramViewModel.programTableName + (this.viewModel.isFixScroll() ? ' fix-scroll' : ''),
                    oncreate: () => {
                        // 表示範囲 resize
                        if(this.viewModel.isEnableDraw()) { window.addEventListener('resize', this.resizeListener, false); }

                        if(!this.viewModel.isFixScroll()) { return; }

                        const element = <HTMLElement>document.getElementsByClassName('mdl-layout')[0];

                        // scroll
                        const channel = <HTMLElement>document.getElementsByClassName(ProgramViewModel.channlesName)[0];
                        const time = <HTMLElement>document.getElementsByClassName(ProgramViewModel.timescaleName)[0];
                        element.addEventListener('scroll', () => {
                            channel.scrollLeft = element.scrollLeft;
                            time.scrollTop = element.scrollTop;
                        }, false);

                        // scroll position
                        let url = location.href;
                        element.addEventListener('scroll', throttle(() => {
                            if(url !== location.href) { url = location.href; return; }
                            this.saveHistoryData({ top: element.scrollTop, left: element.scrollLeft })
                        }, 50), true);

                        // 表示範囲設定
                        element.addEventListener('scroll', () => { this.viewModel.draw(); }, true);

                        // navigation のズレを修正
                        const naviButton = <HTMLElement>document.getElementsByClassName('mdl-layout__drawer-button')[0];
                        const drawer = <HTMLElement>document.getElementsByClassName('mdl-layout__drawer')[0];
                        const obfuscator = <HTMLElement>document.getElementsByClassName('mdl-layout__obfuscator')[0];
                        naviButton.onclick = () => {
                            drawer.style.position = 'fixed';
                            obfuscator.style.position = 'fixed';
                        }
                        obfuscator.onclick = () => {
                            setTimeout(() => {
                                drawer.style.position = '';
                                obfuscator.style.position = '';
                            }, 200);
                        }
                    },
                    onupdate: () => {
                        if(!this.viewModel.isFixScroll() || !this.isNeedRestorePosition || this.viewModel.progressShow) { return; }
                        this.isNeedRestorePosition = false;

                        // scroll position を復元する
                        const position = <{ top: number, left: number } | null>this.getHistoryData();
                        if(position === null) { return; }
                        const element = <HTMLElement>document.getElementsByClassName('mdl-layout')[0];
                        element.scrollTop = position.top;
                        element.scrollLeft = position.left;
                    },
                    onremove: () => {
                        // 表示範囲 resize
                        if(this.viewModel.isEnableDraw()) { window.removeEventListener('resize', this.resizeListener, false ); }
                    },
                }, [
                    m(ChannelComponent),
                    m('div', { class: 'child' }, [
                        m(TimeScaleComponent),
                        m(BoardComponent,{
                            scrollStoped: (top: number, left: number) => {
                                this.saveHistoryData({ top: top, left: left });
                            },
                            isNeedRestorePosition: () => {
                                return this.isNeedRestorePosition;
                            },
                            resetRestorePositionFlag: () => {
                                this.isNeedRestorePosition = false;
                            },
                            getPosition: () => {
                                return <{ top: number, left: number } | null>this.getHistoryData();
                            },
                        }),
                    ]),
                    m(ProgressComponent),
                ]),
                m(BalloonComponent, {
                    id: ProgramInfoViewModel.id,
                    content: m(ProgramInfoComponent),
                    action: m(ProgramInfoActionComponent),
                    maxWidth: 450,
                    maxHeight: 450,
                    dialogMaxWidth: 600,
                }),
                m(BalloonComponent, {
                    id: ProgramTimeBalloonViewModel.id,
                    content: m(ProgramTimeBalloonComponent),
                    maxWidth: 262,
                    verticalOnly: true,
                }),
                m(BalloonComponent, {
                    id: ProgramGenreViewModel.id,
                    content: m(ProgramGenreComponent),
                    action: m(ProgramGenreActionComponent),
                    maxWidth: 400,
                }),
                m(BalloonComponent, {
                    id: StreamSelectViewModel.id,
                    content: m(StreamSelectComponent),
                    maxWidth: 400,
                    forceDialog: window.innerHeight < 480,
                }),
            ],
            mainLayoutStyle: this.viewModel.isFixScroll() ? 'overflow-x: auto;' : '',
        });
    }

    /**
    * title 生成
    */
    private createTitle(): string {
        if(typeof m.route.param('type') !== 'undefined') {
            //通常の番組表表示
            let str = `番組表${ m.route.param('type') }`;
            let start = this.viewModel.getTimeParam().start;
            if(start !== 0) {
                str += DateUtil.format(DateUtil.getJaDate(new Date(start)), ' MM/dd(w)');
            }
            return str;
        } else {
            // 単局表示
            let schedules = this.viewModel.getSchedule();
            if(schedules.length === 0) { return '番組表'; }

            return schedules[0].channel.name;
        }
    }
}

export default ProgramComponent;

