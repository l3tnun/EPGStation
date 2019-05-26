import { throttle } from 'lodash';
import * as m from 'mithril';
import { ViewModelStatus } from '../../Enums';
import DateUtil from '../../Util/DateUtil';
import Util from '../../Util/Util';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import MainLayoutViewModel from '../../ViewModel/MainLayoutViewModel';
import ProgramGenreViewModel from '../../ViewModel/Program/ProgramGenreViewModel';
import ProgramInfoViewModel from '../../ViewModel/Program/ProgramInfoViewModel';
import ProgramTimeBalloonViewModel from '../../ViewModel/Program/ProgramTimeBalloonViewModel';
import { ProgramViewModel } from '../../ViewModel/Program/ProgramViewModel';
import StreamLivePlayerViewModel from '../../ViewModel/Stream/StreamLivePlayerViewModel';
import StreamSelectViewModel from '../../ViewModel/Stream/StreamSelectViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import { BalloonComponent } from '../BalloonComponent';
import MainLayoutComponent from '../MainLayoutComponent';
import ParentComponent from '../ParentComponent';
import StreamLivePlayerComponent from '../Stream/StreamLivePlayerComponent';
import StreamSelectComponent from '../Stream/StreamSelectComponent';
import BoardComponent from './BoardComponent';
import BoardScroller from './BoardScroller';
import ChannelComponent from './ChannelComponent';
import ProgramGenreActionComponent from './ProgramGenreActionComponent';
import ProgramGenreComponent from './ProgramGenreComponent';
import ProgramInfoActionComponent from './ProgramInfoActionComponent';
import ProgramInfoComponent from './ProgramInfoComponent';
import ProgramTimeBalloonComponent from './ProgramTimeBalloonComponent';
import ProgramTitleBalloonComponent from './ProgramTitleBalloonComponent';
import ProgressComponent from './ProgressComponent';
import TimeScaleComponent from './TimeScaleComponent';

/**
 * ProgramComponent
 */
class ProgramComponent extends ParentComponent<void> {
    private viewModel: ProgramViewModel;
    private mainLayoutViewModel: MainLayoutViewModel;
    private genre: ProgramGenreViewModel;
    private timeBalloon: ProgramTimeBalloonViewModel;
    private infoViewModel: ProgramInfoViewModel;
    private balloon: BalloonViewModel;

    private scroller: BoardScroller = new BoardScroller();

    private resizeListener = throttle(() => { this.viewModel.draw(); }, 50);

    constructor() {
        super();
        this.viewModel = <ProgramViewModel> factory.get('ProgramViewModel');
        this.mainLayoutViewModel = <MainLayoutViewModel> factory.get('MainLayoutViewModel');
        this.genre = <ProgramGenreViewModel> factory.get('ProgramGenreViewModel');
        this.timeBalloon = <ProgramTimeBalloonViewModel> factory.get('ProgramTimeBalloonViewModel');
        this.infoViewModel = <ProgramInfoViewModel> factory.get('ProgramInfoViewModel');
        this.balloon = <BalloonViewModel> factory.get('BalloonViewModel');
    }

    protected async parentInitViewModel(status: ViewModelStatus): Promise<void> {
        await this.viewModel.init(status);
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
                titleOnClick: (event: Event) => {
                    if (typeof m.route.param('type') === 'undefined') { return; }

                    this.timeBalloon.setNowNum(this.viewModel.getTimeParam().start);
                    this.balloon.open(ProgramTimeBalloonViewModel.titleId, event);
                },
            },
            menuContent: [
                {
                    attrs: {
                        onclick: () => {
                            this.balloon.close();
                            window.setTimeout(() => {
                                Util.move('/program/setting');
                            }, 200);
                        },
                    },
                    text: 'サイズ設定',
                },
                {
                    attrs: {
                        onclick: () => {
                            this.balloon.close();
                            window.setTimeout(() => {
                                this.genre.init();
                                this.balloon.open(ProgramGenreViewModel.id);
                            }, 200);
                        },
                    },
                    text: '表示ジャンル',
                },
                {
                    attrs: {
                        onclick: () => {
                            this.balloon.close();
                            window.setTimeout(() => {
                                this.viewModel.startUpdateReserves();
                            }, 200);
                        },
                    },
                    text: '予約情報更新',
                },
            ],
            notMainContent: [
                m('div', {
                    class: ProgramViewModel.programTableName + (this.viewModel.isFixScroll() ? ' fix-scroll' : ''),
                    oncreate: () => {
                        // 表示範囲 resize
                        if (this.viewModel.isEnableDraw()) { window.addEventListener('resize', this.resizeListener, false); }

                        // programSetting を適応
                        this.viewModel.setProgramSetting();

                        if (!this.viewModel.isFixScroll()) { return; }

                        // scroll
                        const element = Util.getMDLLayout();
                        if (element === null) { return; }
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
                            this.saveHistoryData({ top: element.scrollTop, left: element.scrollLeft });
                        }, 50), true);

                        // 表示範囲設定
                        element.addEventListener('scroll', () => { this.viewModel.draw(); }, true);

                        // navigation のズレを修正
                        const naviButton = <HTMLElement> document.getElementsByClassName('mdl-layout__drawer-button')[0];
                        const drawer = <HTMLElement> document.getElementsByClassName('mdl-layout__drawer')[0];
                        const obfuscator = <HTMLElement> document.getElementsByClassName('mdl-layout__obfuscator')[0];
                        naviButton.onclick = () => {
                            drawer.style.position = 'fixed';
                            obfuscator.style.position = 'fixed';
                        };
                        obfuscator.onclick = () => {
                            window.setTimeout(() => {
                                drawer.style.position = '';
                                obfuscator.style.position = '';
                            }, 200);
                        };
                    },
                    onupdate: () => {
                        if (!this.viewModel.isFixScroll() || !this.isNeedRestorePosition || this.viewModel.progressShow) { return; }
                        this.isNeedRestorePosition = false;

                        // scroll position を復元する
                        const position = <{ top: number; left: number } | null> this.getHistoryData();
                        if (position === null) { return; }
                        const element = Util.getMDLLayout();
                        if (element === null) { return; }
                        element.scrollTop = position.top;
                        element.scrollLeft = position.left;
                    },
                    onremove: () => {
                        // 表示範囲 resize
                        if (this.viewModel.isEnableDraw()) { window.removeEventListener('resize', this.resizeListener, false); }

                        if (this.viewModel.isFixScroll()) { this.scroller.remove(); }
                    },
                }, [
                    m('div', {
                        class: 'main-layout-animation',
                        onupdate: (vnode: m.VnodeDOM<void, this>) => {
                            (<HTMLElement> vnode.dom).style.opacity = (this.mainLayoutViewModel.isShow() && !this.viewModel.progressShow) ? '1' : '0';
                        },
                    }, [
                        m(ChannelComponent),
                        m('div', { class: 'child' }, [
                            m(TimeScaleComponent),
                            m(BoardComponent, {
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
                                    return <{ top: number; left: number } | null> this.getHistoryData();
                                },
                            }),
                        ]),
                    ]),
                    m(ProgressComponent),
                ]),
                m(BalloonComponent, {
                    id: ProgramTimeBalloonViewModel.titleId,
                    content: m(ProgramTitleBalloonComponent),
                    maxWidth: 150,
                }),
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
                    id: StreamLivePlayerViewModel.id,
                    content: m(StreamLivePlayerComponent),
                    maxWidth: StreamLivePlayerViewModel.maxWidth,
                    dialogMargin: 0,
                    forceDialog: true,
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
        if (typeof m.route.param('type') !== 'undefined') {
            // 通常の番組表表示
            let str = `番組表${ m.route.param('type') }`;
            const start = this.viewModel.getTimeParam().start;
            if (start !== 0) {
                str += DateUtil.format(DateUtil.getJaDate(new Date(start)), ' MM/dd(w)');
            }

            return str;
        } else {
            // 単局表示
            const schedules = this.viewModel.getSchedule();
            if (schedules.length === 0) { return '番組表'; }

            return schedules[0].channel.name;
        }
    }
}

export default ProgramComponent;

