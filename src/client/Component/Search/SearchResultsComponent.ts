import * as m from 'mithril';
import * as apid from '../../../../api';
import DateUtil from '../../Util/DateUtil';
import GenreUtil from '../../Util/GenreUtil';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import ProgramInfoViewModel from '../../ViewModel/Program/ProgramInfoViewModel';
import SearchViewModel from '../../ViewModel/Search/SearchViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * SearchResultsComponent
 */
class SearchResultsComponent extends Component<void> {
    private viewModel: SearchViewModel;
    private balloon: BalloonViewModel;
    private infoViewModel: ProgramInfoViewModel;

    constructor() {
        super();
        this.viewModel = <SearchViewModel> factory.get('SearchViewModel');
        this.balloon = <BalloonViewModel> factory.get('BalloonViewModel');
        this.infoViewModel = <ProgramInfoViewModel> factory.get('ProgramInfoViewModel');
    }

    public view(): m.Child | null {
        const results = this.viewModel.getSearchResults();
        if (results === null) { return null; }

        return m('div', { style: 'margin-top: 32px;' }, [
            // ヒット件数
            m('div', {
                id: SearchViewModel.hitId,
                class: 'hit-num',
            }, results.length + '件ヒットしました。'),

            // 検索結果
            results.map((program) => {
                return this.createContent(program);
            }),
        ]);
    }

    /**
     * create content
     * @param program: ScheduleProgramItem
     * @return content
     */
    private createContent(program: apid.ScheduleProgramItem): m.Child {
        const status = this.viewModel.getReserveStatus(program.id);
        let classStr = 'result-card mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col';
        if (status !== null) { classStr += ' ' + status; }

        return m('div', {
            class: classStr,
            onclick: (e: Event) => {
                const channel = this.viewModel.getChannel(program.channelId);
                if (channel === null) { return; }

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
        const start = DateUtil.getJaDate(new Date(program.startAt));
        const end = DateUtil.getJaDate(new Date(program.endAt));
        const duration = Math.floor((program.endAt - program.startAt) / 1000 / 60);

        return DateUtil.format(start, 'MM/dd(w) hh:mm:ss') + ' ~ ' + DateUtil.format(end, 'hh:mm:ss') + `(${ duration }分)`;
    }
}

export default SearchResultsComponent;

