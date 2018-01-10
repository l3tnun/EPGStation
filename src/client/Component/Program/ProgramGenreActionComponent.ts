import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import ProgramGenreViewModel from '../../ViewModel/Program/ProgramGenreViewModel';
import { ProgramViewModel } from '../../ViewModel/Program/ProgramViewModel';

/**
* ProgramGenreActionComponent
*/
class ProgramGenreActionComponent extends Component<void> {
    private viewModel: ProgramGenreViewModel;
    private programViewModel: ProgramViewModel;

    constructor() {
        super();

        this.viewModel = <ProgramGenreViewModel>(factory.get('ProgramGenreViewModel'));
        this.programViewModel = <ProgramViewModel>(factory.get('ProgramViewModel'));
    }

    /**
    * view
    */
    public view(): m.Child {
        return m('div', [
            m('hr', { style: 'margin: 0;' }),
            m('div', { class: 'mdl-dialog__actions', style: 'height: 36px;' }, [
                //更新ボタン
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: () => {
                        this.viewModel.close();
                        // genre 更新
                        this.viewModel.update();

                        //番組表を再描画
                        this.programViewModel.init();
                    }
                }, '更新'),

                //キャンセルボタン
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--accent',
                    onclick: () => {
                        this.viewModel.close();
                    }
                }, 'キャンセル')
            ]),
        ]);
    }
}

export default ProgramGenreActionComponent;

