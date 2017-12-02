import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import RulesInfoViewModel from '../../ViewModel/Rules/RulesInfoViewModel';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import RulesDeleteViewModel from '../../ViewModel/Rules/RulesDeleteViewModel';
import Util from '../../Util/Util';

/**
* RulesInfoActionComponent
*/
class RulesInfoActionComponent extends Component<void> {
    private viewModel: RulesInfoViewModel;
    private balloon: BalloonViewModel;
    private deleteViewModel: RulesDeleteViewModel;

    constructor() {
        super();
        this.viewModel = <RulesInfoViewModel>(factory.get('RulesInfoViewModel'));
        this.balloon = <BalloonViewModel>(factory.get('BalloonViewModel'));
        this.deleteViewModel = <RulesDeleteViewModel>(factory.get('RulesDeleteViewModel'));
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
                    onclick: () => {
                        this.viewModel.close();
                        setTimeout(() => {
                            let rule = this.viewModel.get();
                            if(rule === null) { return; }
                            Util.move('/search', { rule: rule.id });
                        }, 200);
                    }
                }, '編集'),
                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: () => {
                        let rule = this.viewModel.get();
                        this.viewModel.close();

                        setTimeout(() => {
                            if(rule === null) { return; }
                            Util.move('/recorded', { rule: rule.id });
                        }, 200);
                    },
                }, '番組一覧'),
                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: (e: Event) => {
                        let rule = this.viewModel.get();
                        this.viewModel.close();

                        setTimeout(() => {
                            if(rule === null) { return; }
                            this.deleteViewModel.set(rule);
                            this.balloon.open(RulesDeleteViewModel.id, e);
                        }, 200);
                    },
                }, '削除'),
                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-button mdl-js-button mdl-button--accent close',
                    onclick: () => { this.viewModel.close(); },
                }, '閉じる'),
            ]),
        ]);
    }
}

export default RulesInfoActionComponent;

