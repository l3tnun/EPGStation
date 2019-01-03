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
            m('div', { class: 'rule-delete-content balloon-with-action-enclosure-margin' }, [
                m('div', { class: 'title' }, this.viewModel.getKeyword() + 'を削除しますか。'),
                m('div', { class: 'checkbox' }, [
                    m('label', { class: 'mdl-checkbox mdl-js-checkbox mdl-js-ripple-effect' }, [
                        m('input', {
                            type: 'checkbox',
                            class: 'mdl-checkbox__input',
                            checked: this.viewModel.isDeleteRecorded,
                            onclick: m.withAttr('checked', (value) => { this.viewModel.isDeleteRecorded = value; }),
                            onupdate: (vnode: m.VnodeDOM<void, this>) => { this.checkboxOnUpdate(<HTMLInputElement> (vnode.dom)); },
                        }),
                        m('span', { class: 'mdl-checkbox__label' }, '録画も一緒に削除する'),
                    ]),
                ]),
            ]),
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

