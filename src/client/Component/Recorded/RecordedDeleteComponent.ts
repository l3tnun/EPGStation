import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import RecordedMenuViewModel from '../../ViewModel/Recorded/RecordedMenuViewModel';

/**
* RecordedDeleteComponent
*/
class RecordedDeleteComponent extends Component<void> {
    private viewModel: RecordedMenuViewModel;

    constructor() {
        super();
        this.viewModel = <RecordedMenuViewModel>(factory.get('RecordedMenuViewModel'));
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

export default RecordedDeleteComponent;

