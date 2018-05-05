import * as m from 'mithril';
import * as apid from '../../../../api';
import DateUtil from '../../Util/DateUtil';
import Util from '../../Util/Util';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import MainLayoutViewModel from '../../ViewModel/MainLayoutViewModel';
import StreamProgramCardsViewModel from '../../ViewModel/Stream/StreamProgramCardsViewModel';
import StreamSelectViewModel from '../../ViewModel/Stream/StreamSelectViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';
import TabComponent from '../TabComponent';

/**
 * StreamProgramCardsComponent
 */
class StreamProgramCardsComponent extends Component<void> {
    private viewModel: StreamProgramCardsViewModel;
    private mainLayoutViewModel: MainLayoutViewModel;
    private selectorViewModel: StreamSelectViewModel;
    private balloon: BalloonViewModel;

    constructor() {
        super();
        this.viewModel = <StreamProgramCardsViewModel> factory.get('StreamProgramCardsViewModel');
        this.mainLayoutViewModel = <MainLayoutViewModel> factory.get('MainLayoutViewModel');
        this.selectorViewModel = <StreamSelectViewModel> factory.get('StreamSelectViewModel');
        this.balloon = <BalloonViewModel> factory.get('BalloonViewModel');
    }

    protected initViewModel(): void {
        super.initViewModel();
        // setTimeout を挟まないとストレージ空き容量ダイアログのグラフが描画されなくなる
        this.viewModel.init();
    }

    public onremove(vnode: m.VnodeDOM<void, this>): any {
        this.viewModel.stopTimer();

        return super.onremove(vnode);
    }

    /**
     * view
     */
    public view(): m.Child {
        const broadcasts = this.viewModel.getBroadcastList();

        return m('div', {
            class: 'stream-programs-cards main-layout-animation',
            onupdate: async(vnode: m.VnodeDOM<void, this>) => {
                if (this.mainLayoutViewModel.isShow()) {
                    await Util.sleep(100);
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
            m('div', { id: StreamProgramCardsViewModel.contentId, class: 'non-scroll' }, [
                this.viewModel.getPrograms(broadcasts[this.viewModel.getTabPosition()]).map((item) => {
                    return m('div', { class: 'mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col' },
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
                this.selectorViewModel.set(item.channel);
                this.balloon.open(StreamSelectViewModel.id, e);
            },
        }, [
            m('div', { class: 'name' }, item.channel.name),
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

