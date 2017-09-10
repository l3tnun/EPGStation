import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import StreamSelectViewModel from '../../ViewModel/Stream/StreamSelectViewModel';

/**
* StreamSelectComponent
*/
class StreamSelectComponent extends Component<void> {
    private viewModel: StreamSelectViewModel;

    constructor() {
        super();
        this.viewModel = <StreamSelectViewModel>(factory.get('StreamSelectViewModel'));
    }

    /**
    * view
    */
    public view(): m.Child {
        return m('div', [

            m('div', { class: 'stream-select-content' }, [
                m('div', { class: 'name' }, this.viewModel.getName()),
                m('div', { class: 'pulldown mdl-layout-spacer' }, [
                    m('select', {
                        class: 'mdl-textfield__input program-dialog-label',
                        onchange: m.withAttr('value', (value) => { this.viewModel.streamOptionValue = Number(value); }),
                        onupdate: (vnode: m.VnodeDOM<void, this>) => {
                            this.selectOnUpdate(<HTMLInputElement>(vnode.dom), this.viewModel.streamOptionValue)
                        },
                    }, this.createOptions()),
                ]),
            ]),

            m('div', { class: 'mdl-dialog__actions' }, [
                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: () => {
                        this.viewModel.close();
                        this.viewModel.view();
                    }
                }, '視聴'),

                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    style: this.viewModel.hasJumpStationButton() ? 'left: 8px; position: absolute;' : 'display: none;',
                    onclick: () => {
                        this.viewModel.close();
                        setTimeout(() => {
                            this.viewModel.moveStationPage();
                        }, 200);
                    }
                }, '単局表示'),

                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-js-button mdl-button--accent close',
                    onclick: () => { this.viewModel.close(); }
                }, '閉じる'),
            ]),
        ]);
    }

    /**
    * selector の option を生成する
    * @return m.Child[]
    */
    private createOptions(): m.Child[] {
        return this.viewModel.getOptions().map((option) => {
            return m('option', { value: option.value }, option.name);
        });
    }
}

export default StreamSelectComponent;

