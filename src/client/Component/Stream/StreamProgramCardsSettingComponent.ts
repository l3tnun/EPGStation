import * as m from 'mithril';
import StreamProgramCardsSettingViewModel from '../../ViewModel/Stream/StreamProgramCardsSettingViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * StreamProgramCardsSettingComponent
 */
class StreamProgramCardsSettingComponent extends Component<void> {
    private viewModel: StreamProgramCardsSettingViewModel;

    constructor() {
        super();

        this.viewModel = <StreamProgramCardsSettingViewModel> factory.get('StreamProgramCardsSettingViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', [
            m('div', { class: 'small-setting' },
                this.createContent(),
            ),
        ]);
    }

    /**
     * create content
     */
    private createContent(): m.Child[] | null {
        if (typeof this.viewModel.tmpValue === 'undefined') { return null; }

        return [
            this.createListItem(
                'タブを非表示にする',
                this.createToggle(
                    () => { return this.viewModel.tmpValue.isHideTabMode; },
                    (value) => {
                        this.viewModel.tmpValue.isHideTabMode = value;
                        this.viewModel.save();
                    },
                ),
            ),
        ];
    }

    /**
     * create list item
     * @param name: name
     * @param child m.child
     * @return m.Child
     */
    private createListItem(name: string, child: m.Child): m.Child {
        return m('li', { class: 'mdl-list__item' }, [
            m('span', { class: 'mdl-list__item-primary-content' }, name),
            m('span', { class: 'mdl-list__item-secondary-action' }, child),
        ]);
    }

    /**
     * create Toggle
     * @param getValue: () => boolean 入力値
     * @param setValue: (value: boolean) => void toogle 変更時に実行される
     * @return m.Child
     */
    private createToggle(getValue: () => boolean, setValue: (value: boolean) => void): m.Child {
        return m('label', {
            class: 'mdl-switch mdl-js-switch mdl-js-ripple-effect',
            onupdate: (vnode: m.VnodeDOM<void, this>) => {
                this.toggleLabelOnUpdate(<HTMLInputElement> vnode.dom, getValue());
            },
        }, [
            m('input', {
                type: 'checkbox',
                class: 'mdl-switch__input',
                checked: getValue(),
                onclick: m.withAttr('checked', (value) => {
                    setValue(value);
                }),
            }),
            m('span', { class: 'mdl-switch__label' }),
        ]);
    }
}

export default StreamProgramCardsSettingComponent;

