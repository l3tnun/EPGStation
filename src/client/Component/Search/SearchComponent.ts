import * as m from 'mithril';
import { ViewModelStatus } from '../../Enums';
import Scroll from '../../Util/Scroll';
import ProgramInfoViewModel from '../../ViewModel/Program/ProgramInfoViewModel';
import SearchViewModel from '../../ViewModel/Search/SearchViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import { BalloonComponent } from '../BalloonComponent';
import MainLayoutComponent from '../MainLayoutComponent';
import ParentComponent from '../ParentComponent';
import ProgramInfoActionComponent from '../Program/ProgramInfoActionComponent';
import ProgramInfoComponent from '../Program/ProgramInfoComponent';
import SearchAddComponent from './SearchAddComponent';
import SearchOptionComponent from './SearchOptionComponent';
import SearchResultsComponent from './SearchResultsComponent';

/**
 * SearchComponent
 */
class SearchComponent extends ParentComponent<void> {
    private viewModel: SearchViewModel;

    constructor() {
        super();
        this.viewModel = <SearchViewModel> factory.get('SearchViewModel');
    }

    protected async parentInitViewModel(status: ViewModelStatus): Promise<void> {
        await this.viewModel.init(status);
    }

    /**
     * page name
     */
    protected getComponentName(): string { return 'Search'; }

    /**
     * view
     */
    public view(): m.Child {
        return m(MainLayoutComponent, {
            header: { title: typeof m.route.param('rule') === 'undefined' ? '検索' : 'ルール編集' },
            content: [
                m('div', { class: 'search-content' }, [
                    m(SearchOptionComponent),
                    m(SearchResultsComponent),
                    m(SearchAddComponent),
                ]),
                // scroll top button
                m('button', {
                    class: 'fab-left-bottom mdl-shadow--8dp mdl-button mdl-js-button mdl-button--fab mdl-button--colored',
                    onclick: () => {
                        const mainLayout = document.getElementsByClassName('mdl-layout__content')[0];
                        Scroll.scrollTo(mainLayout, mainLayout.scrollTop, 0, mainLayout.scrollTop - window.innerHeight < 600 ? 300 : 500);
                    },
                }, m('i', { class: 'material-icons' }, 'arrow_upward')),
            ],
            notMainContent: [
                m(BalloonComponent, {
                    id: ProgramInfoViewModel.id,
                    content: m(ProgramInfoComponent),
                    action: m(ProgramInfoActionComponent),
                    maxWidth: 450,
                    maxHeight: 450,
                    dialogMaxWidth: 600,
                    forceDialog: window.innerHeight < 900,
                }),
            ],
        });
    }
}

export default SearchComponent;

