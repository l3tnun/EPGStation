import * as m from 'mithril';
import ReservesMenuViewModel from '../../ViewModel/Reserves/ReservesMenuViewModel';
import { ReserveMode, ReservesViewModel } from '../../ViewModel/Reserves/ReservesViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * ReservesDeleteComponent
 */
class ReservesDeleteComponent extends Component<void> {
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

        return m('div', [
            m('div', { class: 'balloon-with-action-enclosure-margin' }, `${ this.viewModel.getTitle() }を${ isOverlap ? '重複解除' : '削除' }しますか。`),
            m('div', { class: 'mdl-dialog__actions' }, [
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: () => {
                        // delete video
                        if (isOverlap) {
                            this.viewModel.disableOverlap();
                        } else {
                            this.viewModel.delete();
                        }
                        this.viewModel.close();
                    },
                }, isOverlap ? '重複解除' : '削除'),
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--accent',
                    onclick: () => { this.viewModel.close(); },
                }, 'キャンセル'),
            ]),
        ]);
    }
}

export default ReservesDeleteComponent;

