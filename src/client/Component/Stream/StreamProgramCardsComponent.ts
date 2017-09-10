import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import StreamProgramCardsViewModel from '../../ViewModel/Stream/StreamProgramCardsViewModel';
import TabComponent from '../TabComponent';
import * as apid from '../../../../api';
import DateUtil from '../../Util/DateUtil';
import StreamSelectViewModel from '../../ViewModel/Stream/StreamSelectViewModel'
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';

/**
* StreamProgramCardsComponent
*/
class StreamProgramCardsComponent extends Component<void> {
    private viewModel: StreamProgramCardsViewModel;
    private selectorViewModel: StreamSelectViewModel;
    private balloon: BalloonViewModel;

    constructor() {
        super();
        this.viewModel = <StreamProgramCardsViewModel>(factory.get('StreamProgramCardsViewModel'));
        this.selectorViewModel = <StreamSelectViewModel>(factory.get('StreamSelectViewModel'));
        this.balloon = <BalloonViewModel>(factory.get('BalloonViewModel'));
    }

    protected initViewModel(): void {
        super.initViewModel();
        //setTimeout を挟まないとストレージ空き容量ダイアログのグラフが描画されなくなる
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
        let broadcasts = this.viewModel.getBroadcastList();

        return m('div', { class: 'stream-programs-cards' }, [
            m(TabComponent, { tabs: broadcasts, contentId: StreamProgramCardsViewModel.contentId }),
            m('div', { id: StreamProgramCardsViewModel.contentId, class: 'non-scroll' }, [
                this.viewModel.getPrograms(broadcasts[this.viewModel.getTabPosition()]).map((item) => {
                    return m('div', { class: 'mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col' },
                        this.createContent(item)
                    )
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
            }
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
        let start = DateUtil.getJaDate(new Date(program.startAt));
        let end = DateUtil.getJaDate(new Date(program.endAt));

        return DateUtil.format(start, 'hh:mm:ss') + ' ~ ' + DateUtil.format(end, 'hh:mm:ss');
    }
}

export default StreamProgramCardsComponent;

