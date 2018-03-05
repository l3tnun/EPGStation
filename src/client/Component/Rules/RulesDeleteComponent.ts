import * as m from 'mithril';
import RulesDeleteViewModel from '../../ViewModel/Rules/RulesDeleteViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * RulesDeleteComponent
 */
class RulesDeleteComponent extends Component<void> {
    private viewModel: RulesDeleteViewModel;

    constructor() {
        super();
        this.viewModel = <RulesDeleteViewModel> factory.get('RulesDeleteViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', [
            m('div', { class: 'rules-delete' }, this.viewModel.getKeyword() + 'を削除しますか。'),
            m('div', { class: 'mdl-dialog__actions' }, [
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: () => {
                        // delete rule
                        this.viewModel.delete();
                        this.viewModel.close();
                    },
                }, '削除'),
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--accent',
                    onclick: () => { this.viewModel.close(); },
                }, 'キャンセル'),
            ]),
        ]);
    }
}

export default RulesDeleteComponent;

