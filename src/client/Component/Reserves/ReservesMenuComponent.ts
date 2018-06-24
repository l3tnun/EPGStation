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
        return m('div', { class: 'reserve-menu' }, [
            this.createItem({
                onclick: () => {
                    this.viewModel.close();
                    const ruleId = this.viewModel.getRuleId();
                    setTimeout(() => {
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
            }, 'delete', 'delete',
            this.reservesViewModel.getMode() === ReserveMode.overlaps),
        ]);
    }

    private createItem(attrs: { [key: string]: any }, iconName: string, text: string, isHidden: boolean = false): m.Child {
        attrs.class = 'menu-item' + (isHidden ? ' dsable' : '');

        return m('div', attrs, [
            m('i', { class: 'menu-icon material-icons' }, iconName),
            m('div', { class: 'menu-text' }, text),
        ]);
    }
}

export default ReservesMenuComponent;

