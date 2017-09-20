import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import RecordedMenuViewModel from '../../ViewModel/Recorded/RecordedMenuViewModel';

/**
* RecordedMenuComponent
*/
class RecordedMenuComponent extends Component<void> {
    private viewModel: RecordedMenuViewModel;

    constructor() {
        super();
        this.viewModel = <RecordedMenuViewModel>(factory.get('RecordedMenuViewModel'));
    }

    /**
    * view
    */
    public view(): m.Child {
        const ruleId = this.viewModel.getRuleId();

        return m('div', { class: 'recorded-menu' }, [
            this.createItem({
                style: ruleId === null ? 'display: none;' : '',
                onclick: () => {
                    this.viewModel.close();
                    if(Number(m.route.param('rule')) === ruleId) { return; };
                    m.route.set('/recorded', { rule: ruleId });
                },
            }, 'search', 'search'),
            this.createItem({
                onclick: () => {
                    this.viewModel.openDelete();
                },
            }, 'delete', 'delete'),
        ]);
    }

    private createItem(attrs: { [key: string]: any }, iconName: string, text: string): m.Child {
        attrs.class = 'menu-item';

        return m('div', attrs, [
            m('i', { class: 'menu-icon material-icons' }, iconName ),
            m('div', { class: 'menu-text' }, text)
        ]);
    }
}

export default RecordedMenuComponent;

