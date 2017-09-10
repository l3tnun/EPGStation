import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import ProgramViewModel from '../../ViewModel/Program/ProgramViewModel';

/**
* TimeScaleComponent
*/
class TimeScaleComponent extends Component<void> {
    private viewModel: ProgramViewModel;

    constructor() {
        super();
        this.viewModel = <ProgramViewModel>(factory.get('ProgramViewModel'));
    }

    /**
    * view
    */
    public view(): m.Children {
        return m('div', { class: ProgramViewModel.timescaleName }, [
            this.viewModel.getTimes().map((time) => {
                return m('div', { class: `item time-${ time }` }, `0${time}`.slice(-2));
            }),
            // 終端までスクロールした時にずれが発生するためダミー要素を追加する
            m('div', { class: 'item', style: 'visibility: hidden;' }),
        ]);
    }
}

export default TimeScaleComponent;

