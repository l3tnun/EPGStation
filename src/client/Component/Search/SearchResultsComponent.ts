import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import SearchViewModel from '../../ViewModel/Search/SearchViewModel';
import * as apid from '../../../../api';
import Scroll from '../../Util/Scroll';
import DateUtil from '../../Util/DateUtil';
import GenreUtil from '../../Util/GenreUtil';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import ProgramInfoViewModel from '../../ViewModel/Program/ProgramInfoViewModel';

/**
* SearchResultsComponent
*/
class SearchResultsComponent extends Component<void> {
    private viewModel: SearchViewModel;
    private balloon: BalloonViewModel;
    private infoViewModel: ProgramInfoViewModel;

    constructor() {
        super();
        this.viewModel = <SearchViewModel>(factory.get('SearchViewModel'));
        this.balloon = <BalloonViewModel>(factory.get('BalloonViewModel'));
        this.infoViewModel = <ProgramInfoViewModel>(factory.get('ProgramInfoViewModel'));
    }

    public view(): m.Child | null {
        let results = this.viewModel.getSearchResults();
        if(results === null) { return null; }

        return m('div', { style: 'margin-top: 32px;' }, [
            //ヒット件数
            m('div', {
                class: 'hit-num',
                oncreate: (vnode: m.VnodeDOM<void, this>) => { this.scroll(vnode.dom); },
                onupdate: (vnode: m.VnodeDOM<void, this>) => { this.scroll(vnode.dom); }
            }, results.length + '件ヒットしました。'),

            //検索結果
            results.map((program) => {
                return this.createContent(program);
            }),
        ]);
    }

    /**
    * スクロール処理
    */
    private scroll(element: Element): void {
        if(!this.viewModel.isNeedScroll) { return; }
        this.viewModel.isNeedScroll = false;
        let mainLayout = document.getElementsByClassName('mdl-layout__content')[0];
        let start = mainLayout.scrollTop;
        let end = element.getBoundingClientRect().top - 70 + mainLayout.scrollTop;

        setTimeout(() => { Scroll.scrollTo(mainLayout, start, end, 200); }, 100);
    }

    /**
    * create content
    * @param program: ScheduleProgramItem
    * @return content
    */
    private createContent(program: apid.ScheduleProgramItem): m.Child {
        let status = this.viewModel.getReserveStatus(program.id);
        let classStr = 'result-card mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col';
        if(status !== null) { classStr += ' ' + status; }

        return m('div', {
            class: classStr,
            onclick: (e: Event) => {
                let channel = this.viewModel.getChannel(program.channelId);
                if(channel === null) { return; }

                this.infoViewModel.set(program, channel);
                this.balloon.open(ProgramInfoViewModel.id, e);
            },
        },  m('div', { class: 'mdl-card__supporting-text' }, [
            m('div', { class: 'title' }, program.name),
            m('div', { class: 'time' }, this.createTimeStr(program)),
            m('div', { class: 'genre' }, GenreUtil.getGenres(program.genre1, program.genre2)),
            m('div', { class: 'channel' }, this.viewModel.getChannelName(program.channelId)),
            m('div', { class: 'description' }, program.description),
        ]));
    }

    /**
    * create time str
    * @param program: ScheduleProgramItem
    * @return time str
    */
    private createTimeStr(program: apid.ScheduleProgramItem): string {
        let start = DateUtil.getJaDate(new Date(program.startAt));
        let end = DateUtil.getJaDate(new Date(program.endAt));
        let duration = Math.floor((program.endAt - program.startAt) / 1000 / 60);

        return DateUtil.format(start, 'MM/dd(w) hh:mm:ss') + ' ~ ' + DateUtil.format(end, 'hh:mm:ss') + `(${ duration }分)`;
    }
}

export default SearchResultsComponent;

