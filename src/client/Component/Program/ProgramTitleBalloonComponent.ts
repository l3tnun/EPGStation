import * as m from 'mithril';
import DateUtil from '../../Util/DateUtil';
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

        const list: m.Child[] = [];
        const days = this.viewModel.getDays();

        for (let i = 0; i < days.length; i++) {
            list.push(m('li', {
                class: 'mdl-list__item',
                onclick: () => {
                    this.viewModel.dayValue = days[i].value;
                    this.viewModel.hourValue = i === 0 ? DateUtil.getJaDate(new Date()).getHours() : 0;
                    this.viewModel.show();
                },
            }, [
                m('span', { class: 'mdl-list__item-primary-content' }, `${ type } ${ days[i].name }`),
            ]));
        }

        return list;
    }
}

export default ProgramTitleBalloonComponent;

