import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import ProgramTimeBalloonViewModel from '../../ViewModel/Program/ProgramTimeBalloonViewModel';

/**
* ProgramTimeBalloonComponent
*/
class ProgramTimeBalloonComponent extends Component<void> {
    private viewModel: ProgramTimeBalloonViewModel;

    constructor() {
        super();
        this.viewModel = <ProgramTimeBalloonViewModel>(factory.get('ProgramTimeBalloonViewModel'));
    }

    /**
    * view
    */
    public view(): m.Children {
        return [
            m('div', { class: 'program-time-balloon' }, [
                this.createSelect('days',
                    (value: number) => { this.viewModel.dayValue = Number(value); },
                    (vnode: m.VnodeDOM<void, this>) => { this.selectOnUpdate(<HTMLInputElement>(vnode.dom), this.viewModel.dayValue); },
                    this.viewModel.getDays(),
                ),
                this.createSelect('hours',
                    (value: number) => { this.viewModel.hourValue = Number(value); },
                    (vnode: m.VnodeDOM<void, this>) => { this.selectOnUpdate(<HTMLInputElement>(vnode.dom), this.viewModel.hourValue); },
                    this.viewModel.getHours(),
                ),
            ]),
            m('div', { class: 'mdl-dialog__actions' }, [
                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: () => { this.viewModel.show(); },
                }, '表示'),
                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-js-button mdl-button--accent close',
                    onclick: () => { this.viewModel.close(); },
                }, '閉じる'),
            ]),
        ];
    }

    /**
    * create select
    */
    private createSelect(
        name: string,
        onchange: (value: number) => void,
        onupdate: (vnode: m.VnodeDOM<void, this>) => void,
        values: { value: number, name: string }[],
    ): m.Child {
        return m('div', { class: `pulldown mdl-layout-spacer ${ name }` }, [
            m('select', {
                class: 'mdl-textfield__input program-dialog-label',
                onchange: m.withAttr('value', (value) => { onchange(value); }),
                onupdate: (vnode: m.VnodeDOM<void, this>) => { onupdate(vnode); },
            },
                values.map((v) => {
                    return m('option', { value: v.value, }, v.name);
                })
            )
        ]);
    }
}

export default ProgramTimeBalloonComponent;

