import * as m from 'mithril';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import RulesViewModel from '../../ViewModel/Rules/RulesViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * RulesMultipleDeleteComponent
 */
class RulesMultipleDeleteComponent extends Component<void> {
    private viewModel: RulesViewModel;
    private balloon: BalloonViewModel;

    constructor() {
        super();
        this.viewModel = <RulesViewModel> factory.get('RulesViewModel');
        this.balloon = <BalloonViewModel> factory.get('BalloonViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', [
            m('div', { class: 'rule-delete-content balloon-with-action-enclosure-margin' }, [
                m('div', { class: 'title' }, `選択した ${ this.viewModel.getSelectedCnt() } 件のルールを削除しますか。`),
                m('div', { class: 'checkbox' }, [
                    m('label', { class: 'mdl-checkbox mdl-js-checkbox mdl-js-ripple-effect' }, [
                        m('input', {
                            type: 'checkbox',
                            class: 'mdl-checkbox__input',
                            checked: this.viewModel.isDeleteRecorded,
                            onclick: (e: Event) => { this.viewModel.isDeleteRecorded = (<HTMLInputElement> e.target!).checked; },
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
                        // delete video
                        this.viewModel.deleteSelectedRules();
                        this.balloon.close();
                    },
                }, '削除'),
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--accent',
                    onclick: () => { this.balloon.close(); },
                }, 'キャンセル'),
            ]),
        ]);
    }
}

export default RulesMultipleDeleteComponent;

