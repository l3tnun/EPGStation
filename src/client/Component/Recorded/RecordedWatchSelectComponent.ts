import * as m from 'mithril';
import RecordedWatchSelectViewModel from '../../ViewModel/Recorded/RecordedWatchSelectViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * RecordedWatchSelectComponent
 */
class RecordedWatchSelectComponent extends Component<void> {
    private viewModel: RecordedWatchSelectViewModel;

    constructor() {
        super();

        this.viewModel = <RecordedWatchSelectViewModel> factory.get('RecordedWatchSelectViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', [
            m('div', { class: 'streaming-select-content' }, [
                m('div', { class: 'name' }, this.viewModel.getName()),
                m('div', { class: 'pulldown-parent' }, [
                    m('div', { class: 'type pulldown mdl-layout-spacer' }, [
                        m('select', {
                            class: 'mdl-textfield__input',
                            onchange: m.withAttr('value', (value) => {
                                this.viewModel.streamingTypeValue = value;

                                const options = this.viewModel.getOptions();
                                if (typeof options[this.viewModel.streamingModeValue] === 'undefined') {
                                    this.viewModel.streamingModeValue = 0;
                                }
                            }),
                            onupdate: (vnode: m.VnodeDOM<void, this>) => {
                                this.selectOnUpdate(<HTMLInputElement> (vnode.dom), this.viewModel.streamingTypeValue);
                            },
                        }, this.createTypeOption()),
                    ]),
                    m('div', { class: 'mode pulldown mdl-layout-spacer' }, [
                        m('select', {
                            class: 'mdl-textfield__input',
                            onchange: m.withAttr('value', (value) => {
                                this.viewModel.streamingModeValue = Number(value);
                            }),
                            onupdate: (vnode: m.VnodeDOM<void, this>) => {
                                this.selectOnUpdate(<HTMLInputElement> (vnode.dom), this.viewModel.streamingModeValue);
                            },
                        }, this.createOptions()),
                    ]),
                ]),
            ]),

            m('div', { class: 'mdl-dialog__actions' }, [
                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: () => {
                        this.viewModel.view();
                    },
                }, '視聴'),
                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: () => {
                        this.viewModel.viewOriginal();
                        this.viewModel.close();
                    },
                }, '無変換'),
                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-js-button mdl-button--accent close',
                    onclick: () => { this.viewModel.close(); },
                }, '閉じる'),
            ]),
        ]);
    }

    /**
     * type option を生成する
     * @return m.Child[]
     */
    private createTypeOption(): m.Child[] {
        return (<string[]> this.viewModel.getTypeOption()).map((name) => {
            return m('option', { value: name }, name);
        });
    }

    /**
     * mode option を生成する
     * @return m.Child[]
     */
    private createOptions(): m.Child[] {
        return this.viewModel.getOptions().map((name, idx) => {
            return m('option', { value: idx }, name);
        });
    }
}

export default RecordedWatchSelectComponent;

