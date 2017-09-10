import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import ReservesMenuViewModel from '../../ViewModel/Reserves/ReservesMenuViewModel';

/**
* ReservesDeleteComponent
*/
class ReservesDeleteComponent extends Component<void> {
    private viewModel: ReservesMenuViewModel;

    constructor() {
        super();
        this.viewModel = <ReservesMenuViewModel>(factory.get('ReservesMenuViewModel'));
    }

    /**
    * view
    */
    public view(): m.Child {
        return m('div', [
            m('div', { class: 'recorded-delete' }, this.viewModel.getTitle() + 'を削除しますか。'),
            m('div', { class: 'mdl-dialog__actions' }, [
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: () => {
                        // delete video
                        this.viewModel.delete();
                        this.viewModel.close();
                    }
                }, '削除'),
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--accent',
                    onclick: () => { this.viewModel.close(); }
                }, 'キャンセル' ),
            ])
        ]);
    }
}

export default ReservesDeleteComponent;

