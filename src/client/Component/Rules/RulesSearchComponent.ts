import * as m from 'mithril';
import RulesSearchViewModel from '../../ViewModel/Rules/RulesSearchViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * RulesSearchComponent
 */
class RulesSearchComponent extends Component<void> {
    private viewModel: RulesSearchViewModel;

    constructor() {
        super();

        this.viewModel = <RulesSearchViewModel> factory.get('RulesSearchViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', [
            m('div', { class: 'rules-search' }, [
                this.createSearchTextFiled(), // 検索テキストフィールド
                this.createEnableOnlyToggle(), // 有効ルールのみ表示トグル
            ]),
        ]);
    }

    /**
     * 検索テキストフィールド
     * @return m.Child
     */
    private createSearchTextFiled(): m.Child {
        return m('div', { class: 'textfield mdl-textfield mdl-js-textfield' }, [
            m('input', {
                class: 'mdl-textfield__input',
                type: 'text',
                placeholder: 'keyword',
                value: this.viewModel.keyword,
                onchange: (e: Event) => {
                    this.viewModel.keyword = (<HTMLInputElement> e.target!).value;
                },
                oncreate: (vnode: m.VnodeDOM<void, this>) => {
                    // enter key で検索
                    (<HTMLInputElement> vnode.dom).onkeydown = (e) => {
                        if (e.keyCode === 13) {
                            this.viewModel.keyword = (<HTMLInputElement> vnode.dom).value;
                            this.viewModel.search();
                            (<HTMLInputElement> vnode.dom).blur();
                        }
                    };
                },
            }),
        ]);
    }

    /**
     * 有効ルールのみ表示トグル
     * @return m.Child
     */
    private createEnableOnlyToggle(): m.Child {
        return m('label', { class: 'option-checkbox mdl-checkbox mdl-js-checkbox mdl-js-ripple-effect' }, [
            m('input', {
                type: 'checkbox',
                class: 'mdl-checkbox__input',
                checked: this.viewModel.enableonly,
                onclick: (e: Event) => { this.viewModel.enableonly = (<HTMLInputElement> e.target!).checked; },
            }),
            m('span', { class: 'mdl-checkbox__label' }, '有効ルールのみ表示'),
        ]);
    }
}

export default RulesSearchComponent;

