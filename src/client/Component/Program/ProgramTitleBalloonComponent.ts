import * as m from 'mithril';
import ProgramTimeBalloonViewModel from '../../ViewModel/Program/ProgramTimeBalloonViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * ProgramTitleBalloonComponent
 */
class ProgramTitleBalloonComponent extends Component<void> {
    private viewModel: ProgramTimeBalloonViewModel;

    constructor() {
        super();
        this.viewModel = <ProgramTimeBalloonViewModel> factory.get('ProgramTimeBalloonViewModel');
    }

    /**
     * view
     */
    public view(): m.Children {
        return m('div', [
            m('div', { class: 'program-title-content' }, [
                this.createList(),
            ]),
        ]);
    }

    /**
     * list
     * @return m.Child
     */
    private createList(): m.Child[] | null {
        const type = m.route.param('type');
        if (typeof type === 'undefined') { return null; }

        return this.viewModel.getDays().map((data) => {
            return m('li', {
                class: 'mdl-list__item',
                onclick: () => {
                    this.viewModel.dayValue = data.value;
                    this.viewModel.show();
                },
            }, [
                m('span', { class: 'mdl-list__item-primary-content' }, `${ type } ${ data.name }`),
            ]);
        });
    }
}

export default ProgramTitleBalloonComponent;

