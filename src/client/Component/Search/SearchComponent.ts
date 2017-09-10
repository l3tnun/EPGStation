import * as m from 'mithril';
import ParentComponent from '../ParentComponent';
import { ViewModelStatus } from '../../Enums';
import MainLayoutComponent from '../MainLayoutComponent';
import factory from '../../ViewModel/ViewModelFactory';
import SearchViewModel from '../../ViewModel/Search/SearchViewModel';
import SearchOptionComponent from './SearchOptionComponent'
import SearchResultsComponent from './SearchResultsComponent';
import SearchAddComponent from './SearchAddComponent';
import { BalloonComponent } from '../BalloonComponent';
import ProgramInfoComponent from '../Program/ProgramInfoComponent';
import ProgramInfoActionComponent from '../Program/ProgramInfoActionComponent';
import ProgramInfoViewModel from '../../ViewModel/Program/ProgramInfoViewModel';
import Scroll from '../../Util/Scroll';

/**
* SearchComponent
*/
class SearchComponent extends ParentComponent<void> {
    private viewModel: SearchViewModel;

    constructor() {
        super();
        this.viewModel = <SearchViewModel>(factory.get('SearchViewModel'));
    }

    protected initViewModel(status: ViewModelStatus = 'init'): void {
        super.initViewModel(status);
        this.viewModel.init(status);
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
                //scroll top button
                m('button', { class: 'fab-left-bottom mdl-shadow--8dp mdl-button mdl-js-button mdl-button--fab mdl-button--colored',
                    onclick: () => {
                        let mainLayout = document.getElementsByClassName('mdl-layout__content')[0];
                        Scroll.scrollTo(mainLayout, mainLayout.scrollTop, 0, mainLayout.scrollTop - window.innerHeight < 600 ? 300 : 500);
                    }
                }, m('i', { class: 'material-icons' }, 'arrow_upward') ),
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

