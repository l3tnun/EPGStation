import * as m from 'mithril';
import RecordedSearchViewModel from '../../ViewModel/Recorded/RecordedSearchViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * RecordedSearchActionComponent
 */
class RecordedSearchActionComponent extends Component<void> {
    private viewModel: RecordedSearchViewModel;

    constructor() {
        super();

        this.viewModel = <RecordedSearchViewModel> factory.get('RecordedSearchViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', [
            m('hr', { style: 'margin: 0px;' }),

            m('div', { class: 'mdl-dialog__actions' }, [
                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: () => { this.viewModel.search(); },
                }, '検索'),

                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: () => { this.viewModel.reset(); },
                }, 'リセット'),

                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-js-button mdl-button--accent close',
                    onclick: () => { this.viewModel.close(); },
                }, '閉じる'),
            ]),
        ]);
    }
}

export default RecordedSearchActionComponent;

