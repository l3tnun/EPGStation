import * as m from 'mithril';
import { ProgramViewModel } from '../../ViewModel/Program/ProgramViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * ProgressComponent
 */
class ProgressComponent extends Component<void> {
    private viewModel: ProgramViewModel;

    constructor() {
        super();
        this.viewModel = <ProgramViewModel> factory.get('ProgramViewModel');
    }

    /**
     * view
     */
    public view(): m.Children | null {
        if (!this.viewModel.progressShow) { return null; }

        return m('div', { class: 'progress' }, [
            m('div', { class: 'mdl-spinner mdl-spinner--single-color mdl-js-spinner is-active' }),
        ]);
    }
}

export default ProgressComponent;

