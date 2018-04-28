import * as m from 'mithril';
import SearchSettingViewModel from '../../ViewModel/Search/SearchSettingViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * SearchSettingComponent
 */
class SearchSettingComponent extends Component<void> {
    private viewModel: SearchSettingViewModel;

    constructor() {
        super();

        this.viewModel = <SearchSettingViewModel> factory.get('SearchSettingViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', [
            m('div', { class: 'search-setting' },
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
                '検索時にキーワードをコピー',
                this.createToggle(
                    () => { return this.viewModel.tmpValue.setKeyowordToDirectory; },
                    (value) => { this.viewModel.tmpValue.setKeyowordToDirectory = value; },
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

export default SearchSettingComponent;

