import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import ProgramViewModel from '../../ViewModel/Program/ProgramViewModel';

/**
* ProgressComponent
*/
class ProgressComponent extends Component<void> {
    private viewModel: ProgramViewModel;

    constructor() {
        super();
        this.viewModel = <ProgramViewModel>(factory.get('ProgramViewModel'));
    }

    /**
    * view
    */
    public view(): m.Children | null {
        if(!this.viewModel.progressShow || this.viewModel.getSchedule().length === 0) { return null; }

        return m('div', { class: 'progress' }, [
            m('div', { class: 'mdl-spinner mdl-spinner--single-color mdl-js-spinner is-active' })
        ]);
    }
}

export default ProgressComponent;

