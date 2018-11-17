import * as m from 'mithril';
import Util from '../../Util/Util';
import ReservesMenuViewModel from '../../ViewModel/Reserves/ReservesMenuViewModel';
import { ReserveMode, ReservesViewModel } from '../../ViewModel/Reserves/ReservesViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * ReservesMenuComponent
 */
class ReservesMenuComponent extends Component<void> {
    private viewModel: ReservesMenuViewModel;
    private reservesViewModel: ReservesViewModel;

    constructor() {
        super();
        this.viewModel = <ReservesMenuViewModel> factory.get('ReservesMenuViewModel');
        this.reservesViewModel = <ReservesViewModel> factory.get('ReservesViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        const isOverlap = this.reservesViewModel.getMode() === ReserveMode.overlaps;
        const ruleId = this.viewModel.getRuleId();

        return m('div', { class: 'reserve-menu' }, [
            this.createItem({
                style: ruleId === null ? 'display: none;' : '',
                onclick: () => {
                    Util.move('/recorded', { rule: ruleId });
                },
            }, 'list', 'recorded'),
            this.createItem({
                onclick: () => {
                    this.viewModel.close();
                    window.setTimeout(() => {
                        if (ruleId === null) {
                            Util.move(`/program/detail/${ this.viewModel.getProgramId() }`, { mode: 'edit' });
                        } else {
                            Util.move('/search', { rule: ruleId });
                        }
                    }, 200);
                },
            }, 'mode_edit', 'edit'),
            this.createItem({
                onclick: () => {
                    this.viewModel.openDelete();
                },
            }, isOverlap ? 'lock_open' : 'delete', isOverlap ? 'unlock' : 'delete'),
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

