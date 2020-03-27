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
            m('div', { class: 'small-setting' },
                this.createContent(),
            ),
        ]);
    }

    /**
     * create content
     */
    private createContent(): m.Child[] {
        return [
            this.createListItem(
                'ルール追加/更新時に前のページに戻る',
                this.createToggle(
                    () => { return this.viewModel.tmpValue.isGoBackPreviousPage; },
                    (value) => { this.viewModel.tmpValue.isGoBackPreviousPage = value; },
                ),
            ),
            this.createListItem(
                '検索時にキーワードをコピー',
                this.createToggle(
                    () => { return this.viewModel.tmpValue.setKeyowordToDirectory; },
                    (value) => { this.viewModel.tmpValue.setKeyowordToDirectory = value; },
                ),
            ),
            this.createListItem(
                'デフォルトエンコード設定',
                this.createToggle(
                    () => { return this.viewModel.tmpValue.setDefaultEncodeOption; },
                    (value) => { this.viewModel.tmpValue.setDefaultEncodeOption = value; },
                ),
            ),
            this.createListItem(
                '録画済み番組を排除',
                this.createToggle(
                    () => { return this.viewModel.tmpValue.isEnableAvoidDuplicate; },
                    (value) => { this.viewModel.tmpValue.isEnableAvoidDuplicate = value; },
                ),
            ),
            this.createListItem(
                '元ファイルの自動削除',
                this.createToggle(
                    () => { return this.viewModel.tmpValue.delTs; },
                    (value) => { this.viewModel.tmpValue.delTs = value; },
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
                onclick: (e: Event) => {
                    setValue((<HTMLInputElement> e.target!).checked);
                },
            }),
            m('span', { class: 'mdl-switch__label' }),
        ]);
    }
}

export default SearchSettingComponent;

