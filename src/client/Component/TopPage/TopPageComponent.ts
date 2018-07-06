import { throttle } from 'lodash';
import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import DateUtil from '../../Util/DateUtil';
import Util from '../../Util/Util';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import MainLayoutViewModel from '../../ViewModel/MainLayoutViewModel';
import ProgramInfoViewModel from '../../ViewModel/Program/ProgramInfoViewModel';
import RecordedInfoViewModel from '../../ViewModel/Recorded/RecordedInfoViewModel';
import RecordedMenuViewModel from '../../ViewModel/Recorded/RecordedMenuViewModel';
import RecordedPlayerViewModel from '../../ViewModel/Recorded/RecordedPlayerViewModel';
import RecordedViewModel from '../../ViewModel/Recorded/RecordedViewModel';
import RecordedWatchSelectViewModel from '../../ViewModel/Recorded/RecordedWatchSelectViewModel';
import ReservesMenuViewModel from '../../ViewModel/Reserves/ReservesMenuViewModel';
import { ReservesViewModel } from '../../ViewModel/Reserves/ReservesViewModel';
import TopPageViewModel from '../../ViewModel/TopPageViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import { BalloonComponent } from '../BalloonComponent';
import MainLayoutComponent from '../MainLayoutComponent';
import ParentComponent from '../ParentComponent';
import ProgramInfoComponent from '../Program/ProgramInfoComponent';
import RecordedDeleteComponent from '../Recorded/RecordedDeleteComponent';
import RecordedEncodeComponent from '../Recorded/RecordedEncodeComponent';
import RecordedInfoComponent from '../Recorded/RecordedInfoComponent';
import RecordedMenuComponent from '../Recorded/RecordedMenuComponent';
import RecordedPlayerComponent from '../Recorded/RecordedPlayerComponent';
import RecordedWatchSelectComponent from '../Recorded/RecordedWatchSelectComponent';
import ReservesDeleteComponent from '../Reserves/ReservesDeleteComponent';
import ReservesMenuComponent from '../Reserves/ReservesMenuComponent';
import TabComponent from '../TabComponent';

interface ScrollPosition {
    main: number;
    recorded: number;
    reserves: number;
}

/**
 * TopPageComponent
 */
class TopPageComponent extends ParentComponent<void> {
    private viewModel: TopPageViewModel;
    private mainLayoutViewModel: MainLayoutViewModel;
    private recordedViewModel: RecordedViewModel;
    private recordedMenuViewModel: RecordedMenuViewModel;
    private recordedInfoViewModel: RecordedInfoViewModel;
    private reservesViewModel: ReservesViewModel;
    private reservesMenuViewModel: ReservesMenuViewModel;
    private programInfo: ProgramInfoViewModel;
    private balloon: BalloonViewModel;
    private scrollPosition: ScrollPosition = { main: 0, recorded: 0, reserves: 0 };

    constructor() {
        super();
        this.viewModel = <TopPageViewModel> factory.get('TopPageViewModel');
        this.mainLayoutViewModel = <MainLayoutViewModel> factory.get('MainLayoutViewModel');
        this.recordedViewModel = <RecordedViewModel> factory.get('RecordedViewModel');
        this.recordedMenuViewModel = <RecordedMenuViewModel> factory.get('RecordedMenuViewModel');
        this.recordedInfoViewModel = <RecordedInfoViewModel> factory.get('RecordedInfoViewModel');
        this.reservesViewModel = <ReservesViewModel> factory.get('ReservesViewModel');
        this.reservesMenuViewModel = <ReservesMenuViewModel> factory.get('ReservesMenuViewModel');
        this.programInfo = <ProgramInfoViewModel> factory.get('ProgramInfoViewModel');
        this.balloon = <BalloonViewModel> factory.get('BalloonViewModel');
        this.recordedMenuViewModel = <RecordedMenuViewModel> factory.get('RecordedMenuViewModel');
    }

    protected async parentInitViewModel(status: ViewModelStatus = 'init'): Promise<void> {
        await this.recordedViewModel.init(status, 0);
        await this.reservesViewModel.init(status, 0);

        if (status !== 'init') {
            this.recordedInfoViewModel.update();
        }

        this.viewModel.init()
        .catch((err) => {
            console.error(err);
        });
    }

    /**
     * page name
     */
    protected getComponentName(): string { return 'TopPage'; }

    /**
     * view
     */
    public view(): m.Children {
        return m(MainLayoutComponent, {
            header: { title: 'EPGStation' },
            notMainContent: [
                this.createContent(),
                m(BalloonComponent, {
                    id: RecordedInfoViewModel.id,
                    head: m(TabComponent, {
                        id: RecordedInfoViewModel.tabId,
                        tabs: this.recordedInfoViewModel.getTabTitles(),
                        contentId: RecordedInfoViewModel.contentId,
                    }),
                    content: m(RecordedInfoComponent),
                    maxWidth: 400,
                    maxHeight: 480,
                    dialogMaxWidth: 600,
                    forceDialog: Util.uaIsiOS(),
                }),
                m(BalloonComponent, {
                    id: RecordedWatchSelectViewModel.id,
                    content: m(RecordedWatchSelectComponent),
                    maxWidth: 400,
                    forceDialog: true,
                }),
                m(BalloonComponent, {
                    id: RecordedMenuViewModel.id,
                    content: m(RecordedMenuComponent),
                    maxWidth: 106,
                    horizontalOnly: true,
                }),
                m(BalloonComponent, {
                    id: RecordedMenuViewModel.deleteId,
                    content: m(RecordedDeleteComponent),
                    maxWidth: 300,
                    forceDialog: true,
                }),
                m(BalloonComponent, {
                    id: RecordedMenuViewModel.encodeId,
                    content: m(RecordedEncodeComponent),
                    maxWidth: 350,
                }),
                m(BalloonComponent, {
                    id: RecordedPlayerViewModel.id,
                    content: m(RecordedPlayerComponent),
                    maxWidth: RecordedPlayerViewModel.maxWidth,
                    dialogMargin: 0,
                    forceDialog: true,
                }),
                m(BalloonComponent, {
                    id: ProgramInfoViewModel.id,
                    content: m(ProgramInfoComponent),
                    maxWidth: 450,
                    maxHeight: 450,
                    dialogMaxWidth: 600,
                    forceDialog: window.innerHeight < 900 && window.innerWidth < 780 || Util.uaIsiOS(),
                }),
                m(BalloonComponent, {
                    id: ReservesMenuViewModel.id,
                    content: m(ReservesMenuComponent),
                    maxWidth: 94,
                    horizontalOnly: true,
                }),
                m(BalloonComponent, {
                    id: ReservesMenuViewModel.deleteId,
                    content: m(ReservesDeleteComponent),
                    maxWidth: 300,
                    forceDialog: true,
                }),
            ],
        });
    }

    /**
     * main content
     * @return m.Child
     */
    private createContent(): m.Child {
        return m('div', {
            class: 'main-layout-animation top-page' + (window.innerWidth < 800 ? ' non-scroll' : ''),
            oncreate: (vnode: m.VnodeDOM<void, this>) => {
                // scroll position を保存
                const main = <HTMLElement> vnode.dom;
                const recorded = <HTMLElement> document.getElementById(TopPageComponent.recordedId);
                const reserves = <HTMLElement> document.getElementById(TopPageComponent.reservesId);
                let url = location.href;

                main.addEventListener('scroll', throttle(() => {
                    if (url !== location.href) {
                        url = location.href;

                        return;
                    }
                    this.scrollPosition.main = main.scrollTop;
                    this.scrollPosition.recorded = 0;
                    this.scrollPosition.reserves = 0;
                    this.saveHistoryData(this.scrollPosition);
                }, 50));

                recorded.addEventListener('scroll', throttle(() => {
                    if (url !== location.href) {
                        url = location.href;

                        return;
                    }
                    this.scrollPosition.main = 0;
                    this.scrollPosition.recorded = recorded.scrollTop;
                    this.saveHistoryData(this.scrollPosition);
                }, 50));

                reserves.addEventListener('scroll', throttle(() => {
                    if (url !== location.href) {
                        url = location.href;

                        return;
                    }
                    this.scrollPosition.main = 0;
                    this.scrollPosition.reserves = reserves.scrollTop;
                    this.saveHistoryData(this.scrollPosition);
                }, 50));

            },
            onupdate: (vnode: m.VnodeDOM<void, this>) => {
                (<HTMLElement> vnode.dom).style.opacity = this.mainLayoutViewModel.isShow() ? '1' : '0';

                if (!this.isNeedRestorePosition) { return; }
                this.isNeedRestorePosition = false;

                // scroll position の復元
                const position = <ScrollPosition | null> this.getHistoryData();
                if (position === null) { return; }

                vnode.dom.scrollTop = position.main;
                document.getElementById(TopPageComponent.recordedId)!.scrollTop = position.recorded;
                document.getElementById(TopPageComponent.reservesId)!.scrollTop = position.reserves;
            },
        }, [
            this.createRecorded(),
            this.createReserves(),
            m('div', { class: 'clear: both;' }),
        ]);
    }

    /**
     * recorded content
     * @return m.Child
     */
    private createRecorded(): m.Child {
        const viewLength = this.recordedViewModel.getRecordeds().recorded.length;
        const total = this.recordedViewModel.getRecordeds().total;

        return m('div', { class: 'recorded mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col' }, [
            m('div', { class: 'parent-title' }, `録画済み ${ viewLength }/${ total }`),

            m('div', {
                id: TopPageComponent.recordedId,
                class: 'child non-scroll',
            }, [
                this.recordedViewModel.getRecordeds().recorded.map((recorded) => {
                    return this.createRecordedCard(recorded);
                }),
                this.createMore(viewLength, total, '/recorded', { page: 2 }),
            ]),
        ]);
    }

    /**
     * recorded card
     * @param recorded: apid.RecordedProgram
     * @return m.Child
     */
    private createRecordedCard(recorded: apid.RecordedProgram): m.Child {
        return m('div', { class: 'recorded-card mdl-card mdl-cell mdl-cell--12-col' }, [
            m('button', {
                class: 'mdl-button mdl-js-button mdl-button--icon',
                onclick: (e: Event) => {
                    this.recordedMenuViewModel.set(recorded);
                    this.balloon.open(RecordedMenuViewModel.id, e);
                },
            }, [
                m('i', { class: 'material-icons' }, 'more_vert'),
            ]),
            m('div', {
                onclick: (e: Event) => {
                    this.recordedInfoViewModel.set(recorded);
                    this.balloon.open(RecordedInfoViewModel.id, e);
                },
            }, [
                m('div', { class: 'thumbnail-container' }, [
                    m('img', {
                        class: 'thumbnail',
                        src: recorded.hasThumbnail ? `./api/recorded/${ recorded.id }/thumbnail` : './img/noimg.png',
                        onerror: (e: Event) => { (<HTMLImageElement> e.target).src = './img/noimg.png'; },
                    }),
                ]),
                m('div', { class: 'text-container' }, [
                    m('div', { class: 'title' }, recorded.name),
                    m('div', { class: 'channel' }, this.recordedViewModel.getChannelName(recorded.channelId)),
                    m('div', { class: 'time' }, this.recordedViewModel.getTimeStr(recorded)),
                    m('div', { class: 'description' }, recorded.description),
                ]),
            ]),
        ]);
    }

    /**
     * reserves content
     * @return m.Child
     */
    private createReserves(): m.Child {
        const viewLength = this.reservesViewModel.getReserves().reserves.length;
        const total = this.reservesViewModel.getReserves().total;
        const conflictsCount = this.viewModel.getConflictsCount();
        const title = conflictsCount === 0 ? `予約 ${ viewLength }/${ total }` :
            m('div', {
                // tslint:disable-next-line
                class: 'mdl-badge', 
                'data-badge': conflictsCount,
                // tslint:disable-next-line
                onclick: () => { Util.move('/reserves', { mode: 'conflicts' }); },
            }, `予約 ${ viewLength }/${ total }`);

        return m('div', { class: 'reserves mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col' }, [
            m('div', { class: 'parent-title mdl-badge' }, title),
            m('div', {
                id: TopPageComponent.reservesId,
                class: 'child non-scroll',
            }, [
                this.reservesViewModel.getReserves().reserves.map((reserve) => {
                    return this.createReserveCard(reserve);
                }),
                this.createMore(viewLength, total, '/reserves', { page: 2 }),
            ]),
        ]);
    }

    /**
     * reserve card
     * @param reserve: apid.Reserve
     * @return m.Child
     */
    private createReserveCard(reserve: apid.Reserve): m.Child {
        return m('div', { class: 'reserves-card not-hide mdl-card mdl-cell mdl-cell--12-col' }, [
            m('button', {
                class: 'mdl-button mdl-js-button mdl-button--icon',
                style: 'position: absolute; right: 0px;',
                onclick: (e: Event) => {
                    this.reservesMenuViewModel.set(reserve);
                    this.balloon.open(ReservesMenuViewModel.id, e);
                },
            }, [
                m('i', { class: 'material-icons' }, 'more_vert'), // menu icon
            ]),
            // 番組情報
            m('div', {
                class: 'mdl-card__supporting-text',
                onclick: (event: Event) => { this.openProgramInfo(event, reserve); },
            }, [
                m('div', { class: 'title' }, reserve.program.name),
                m('div', { class: 'time' }, this.getReservesCardTime(reserve.program)),
                m('div', { class: 'channel' }, this.reservesViewModel.getChannelName(reserve.program.channelId)),
                m('div', { class: 'description' }, reserve.program.description),
            ]),
        ]);
    }

    /**
     * click 時に programInfo を開く
     * @param event: Event
     * @param reserve: reserve
     */
    private openProgramInfo(event: Event, reserve: apid.Reserve): void {
        const channel = this.reservesViewModel.getChannel(reserve.program.channelId);
        if (channel === null) { return; }

        const reservesOption = {
            ruleId: reserve.ruleId,
            option: reserve.option,
            encode: reserve.encode,
        };

        let isNull = true;
        for (const key in reservesOption) {
            if (typeof reservesOption[key] === 'undefined') {
                delete reservesOption[key];
            } else {
                isNull = false;
            }
        }

        this.programInfo.set(reserve.program, channel, isNull ? null : reservesOption);
        this.balloon.open(ProgramInfoViewModel.id, event);
    }

    /**
     * getReservesCardTime
     * @return string
     */
    private getReservesCardTime(program: apid.ReserveProgram): string {
        const start = DateUtil.getJaDate(new Date(program.startAt));
        const end = DateUtil.getJaDate(new Date(program.endAt));
        const duration = Math.floor((program.endAt - program.startAt) / 1000 / 60);

        return DateUtil.format(start, 'MM/dd(w) hh:mm:ss') + '~' + DateUtil.format(end, 'hh:mm:ss') + `(${ duration }分)`;
    }

    /**
     * more
     * @param viewLength: 表示件数
     * @param total: 総数
     * @param href: url
     */
    private createMore(viewLength: number, total: number, href: string, query: { [key: string]: any }): m.Child | null {
        if (!(total > viewLength)) { return null; }

        return m('div', { class: 'more' } , [
            m('a', {
                class: 'mdl-button mdl-js-button mdl-js-ripple-effect mdl-button--primary',
                onclick: () => { Util.move(href, query); },
            }, 'more'),
        ]);
    }
}

namespace TopPageComponent {
    export const recordedId = 'recorded-main';
    export const reservesId = 'reserves-main';
}

export default TopPageComponent;

