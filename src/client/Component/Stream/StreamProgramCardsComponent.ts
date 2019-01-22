import { throttle } from 'lodash';
import * as m from 'mithril';
import * as apid from '../../../../api';
import { AllReserves } from '../../Model/Api/ReservesApiModel';
import DateUtil from '../../Util/DateUtil';
import Util from '../../Util/Util';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import MainLayoutViewModel from '../../ViewModel/MainLayoutViewModel';
import ProgramInfoViewModel from '../../ViewModel/Program/ProgramInfoViewModel';
import StreamProgramCardsViewModel from '../../ViewModel/Stream/StreamProgramCardsViewModel';
import StreamSelectViewModel from '../../ViewModel/Stream/StreamSelectViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';
import TabComponent from '../TabComponent';

interface StramCardArgs {
    scrollStoped(scroll: number, tab: number): void;
    isNeedRestorePosition(): boolean;
    resetRestorePositionFlag(): void;
    getPosition(): { scroll: number; tab: number } | null;
}

/**
 * StreamProgramCardsComponent
 */
class StreamProgramCardsComponent extends Component<StramCardArgs> {
    private viewModel: StreamProgramCardsViewModel;
    private mainLayoutViewModel: MainLayoutViewModel;
    private selectorViewModel: StreamSelectViewModel;
    private infoViewModel: ProgramInfoViewModel;
    private balloon: BalloonViewModel;
    private contentElement: HTMLElement;
    private allReserves: AllReserves | null;
    private isDoneInit: boolean = false;

    constructor() {
        super();
        this.viewModel = <StreamProgramCardsViewModel> factory.get('StreamProgramCardsViewModel');
        this.mainLayoutViewModel = <MainLayoutViewModel> factory.get('MainLayoutViewModel');
        this.selectorViewModel = <StreamSelectViewModel> factory.get('StreamSelectViewModel');
        this.infoViewModel = <ProgramInfoViewModel> factory.get('ProgramInfoViewModel');
        this.balloon = <BalloonViewModel> factory.get('BalloonViewModel');
    }

    protected async initViewModel(): Promise<void> {
        this.isDoneInit = false;
        super.initViewModel();
        await this.viewModel.init();
        window.setTimeout(() => {
            this.isDoneInit = true;
            m.redraw();
        }, 100);
    }

    public onremove(vnode: m.VnodeDOM<StramCardArgs, this>): any {
        this.viewModel.stopTimer();

        return super.onremove(vnode);
    }

    /**
     * view
     */
    public view(mainVnode: m.Vnode<StramCardArgs, this>): m.Child {
        const broadcasts = this.viewModel.getBroadcastList();

        // 予約情報を取得
        this.allReserves = this.viewModel.getReserves();

        return m('div', {
            class: 'stream-programs-cards main-layout-animation',
            onupdate: async(vnode: m.VnodeDOM<any, this>) => {
                if (this.mainLayoutViewModel.isShow() && this.isDoneInit) {
                    await Util.sleep(100);
                    if (mainVnode.attrs.isNeedRestorePosition()) {
                        mainVnode.attrs.resetRestorePositionFlag();

                        // get position
                        const position = mainVnode.attrs.getPosition();
                        if (position !== null) {
                            // restore position
                            this.viewModel.setTabPosition(position.tab);
                            this.contentElement.scrollTop = position.scroll;
                        }
                    }
                    (<HTMLElement> vnode.dom).style.opacity = '1';
                } else {
                    (<HTMLElement> vnode.dom).style.opacity = '0';
                }
            },
        }, [
            m(TabComponent, {
                id: StreamProgramCardsViewModel.tabId,
                tabs: broadcasts,
                contentId: StreamProgramCardsViewModel.contentId,
            }),
            m('div', {
                id: StreamProgramCardsViewModel.contentId,
                class: 'non-scroll',
                oncreate: (vnode: m.VnodeDOM<any, this>) => {
                    // save scroll position && tab position
                    const element = <HTMLElement> vnode.dom;
                    this.contentElement = element;
                    element.addEventListener('scroll', throttle(() => {
                        mainVnode.attrs.scrollStoped(element.scrollTop, this.viewModel.getTabPosition());
                    }, 50), false);
                },
            }, [
                this.viewModel.getPrograms(broadcasts[this.viewModel.getTabPosition()]).map((item) => {
                    let baseClass = 'mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col';
                    if (this.allReserves && this.allReserves[item.programs[0].id]) {
                        baseClass += ' mdl-card__is-recording';
                    }

                    return m('div', { class: baseClass },
                        this.createContent(item),
                    );
                }),
                m('div', { style: 'height: 36px; visibility: hidden;' }, 'dummy'),
            ]),
        ]);
    }

    /**
     * content
     * @param item: apid.ScheduleProgram
     * @return m.Child
     */
    private createContent(item: apid.ScheduleProgram): m.Child {
        return m('div', {
            class: 'mdl-card__supporting-text',
            onclick: (e: Event) => {
                this.infoViewModel.set(item.programs[0], item.channel);
                this.balloon.open(ProgramInfoViewModel.id, e);
            },
        }, [
            m('div', {
                class: 'name',
                onclick: (e: Event) => {
                    e.stopPropagation();
                    this.selectorViewModel.set(item.channel);
                    this.balloon.open(StreamSelectViewModel.id, e);
                },
            }, item.channel.name),
            m('div', { class: 'time' }, this.createTimeStr(item.programs[0])),
            m('div', { class: 'title' }, item.programs[0].name),
            m('div', { class: 'description' }, item.programs[0].description),
        ]);
    }

    /**
     * create time str
     * @param program: apid.ScheduleProgramItem
     * @param string
     */
    private createTimeStr(program: apid.ScheduleProgramItem): string {
        const start = DateUtil.getJaDate(new Date(program.startAt));
        const end = DateUtil.getJaDate(new Date(program.endAt));

        return DateUtil.format(start, 'hh:mm:ss') + ' ~ ' + DateUtil.format(end, 'hh:mm:ss');
    }
}

export default StreamProgramCardsComponent;

