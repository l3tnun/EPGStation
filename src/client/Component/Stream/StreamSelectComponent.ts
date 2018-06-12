import * as m from 'mithril';
import StreamLivePlayerViewModel from '../../ViewModel/Stream/StreamLivePlayerViewModel';
import StreamSelectViewModel from '../../ViewModel/Stream/StreamSelectViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * StreamSelectComponent
 */
class StreamSelectComponent extends Component<void> {
    private viewModel: StreamSelectViewModel;
    private livePlayerViewModel: StreamLivePlayerViewModel;

    constructor() {
        super();
        this.viewModel = <StreamSelectViewModel> factory.get('StreamSelectViewModel');
        this.livePlayerViewModel = <StreamLivePlayerViewModel> factory.get('StreamLivePlayerViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', [

            m('div', {
                class: 'stream-select-content ' + (this.viewModel.isMultiTypes()  ? 'multi-type' : ''),
            }, [
                m('div', { class: 'name' }, this.viewModel.getName()),
                m('div', { class: 'pulldown-parent' }, [
                    m('div', { class: 'type pulldown mdl-layout-spacer' }, [
                        m('select', {
                            class: 'mdl-textfield__input program-dialog-label',
                            onchange: m.withAttr('value', (value) => {
                                if (value === this.viewModel.streamTypeValue) { return; }
                                this.viewModel.streamTypeValue = value;
                                this.viewModel.streamOptionValue = 0;

                                this.viewModel.saveValues();
                            }),
                            onupdate: (vnode: m.VnodeDOM<void, this>) => {
                                this.selectOnUpdate(<HTMLInputElement> (vnode.dom), this.viewModel.streamTypeValue);
                            },
                        }, this.createTypeOption()),
                    ]),
                    m('div', { class: 'mode pulldown mdl-layout-spacer' }, [
                        m('select', {
                            class: 'mdl-textfield__input program-dialog-label',
                            onchange: m.withAttr('value', (value) => {
                                this.viewModel.streamOptionValue = Number(value);

                                this.viewModel.saveValues();
                            }),
                            onupdate: (vnode: m.VnodeDOM<void, this>) => {
                                this.selectOnUpdate(<HTMLInputElement> (vnode.dom), this.viewModel.streamOptionValue);
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
                        this.viewModel.close();
                        const type = this.viewModel.streamTypeValue;
                        if (type === 'WebM' || type === 'MP4') {
                            const channel = this.viewModel.getChannel();
                            if (channel === null) { return; }

                            this.livePlayerViewModel.set(channel, type === 'WebM' ? 'webm' : 'mp4', this.viewModel.streamOptionValue);
                            this.livePlayerViewModel.open();
                        } else {
                            this.viewModel.view();
                        }
                    },
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
                    },
                }, '単局表示'),

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
        return this.viewModel.getTypeOption().map((name) => {
            return m('option', { value: name }, name);
        });
    }

    /**
     * mode option を生成する
     * @return m.Child[]
     */
    private createOptions(): m.Child[] {
        return this.viewModel.getOptions().map((option) => {
            return m('option', { value: option.value }, option.name);
        });
    }
}

export default StreamSelectComponent;

