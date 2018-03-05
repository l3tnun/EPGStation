import * as m from 'mithril';
import Util from '../../Util/Util';
import ReservesMenuViewModel from '../../ViewModel/Reserves/ReservesMenuViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * ReservesMenuComponent
 */
class ReservesMenuComponent extends Component<void> {
    private viewModel: ReservesMenuViewModel;

    constructor() {
        super();
        this.viewModel = <ReservesMenuViewModel> factory.get('ReservesMenuViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', { class: 'reserve-menu' }, [
            this.createItem({
                onclick: () => {
                    this.viewModel.close();
                    const ruleId = this.viewModel.getRuleId();
                    if (ruleId === null) { return; }
                    setTimeout(() => { Util.move('/search', { rule: ruleId }); }, 200);
                },
                style: this.viewModel.getRuleId() === null ? 'display: none;' : '',
            }, 'mode_edit', 'edit'),
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
            m('i', { class: 'menu-icon material-icons' }, iconName),
            m('div', { class: 'menu-text' }, text),
        ]);
    }
}

export default ReservesMenuComponent;

