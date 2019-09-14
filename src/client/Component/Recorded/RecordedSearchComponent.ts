import * as m from 'mithril';
import * as apid from '../../../../api';
import GenreUtil from '../../Util/GenreUtil';
import RecordedSearchViewModel from '../../ViewModel/Recorded/RecordedSearchViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * RecordedSearchComponent
 */
class RecordedSearchComponent extends Component<void> {
    private viewModel: RecordedSearchViewModel;

    constructor() {
        super();

        this.viewModel = <RecordedSearchViewModel> factory.get('RecordedSearchViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        const tags = this.viewModel.getTags();

        return m('div', [
            m('div', { class: 'recorded-search' }, [
                this.createSearchTextField(), // 検索テキストフィールド
                this.createRuleSelector(tags.rule), // キーワード
                this.createChannelSelector(tags.channel), // 放送局
                this.createCategorySelector(tags.genre), // ジャンル
                this.createOption(),
            ]),
        ]);
    }

    /**
     * search text field を生成する
     */
    private createSearchTextField(): m.Child {
        return m('div', { class: 'textfield mdl-textfield mdl-js-textfield' }, [
            // search textfield
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
     * keyword selector
     */
    private createRuleSelector(rules: apid.RecordedRuleTag[]): m.Child[] {
        return [
            m('div', 'ルール'),
            m('div', { class: 'pulldown mdl-layout-spacer' }, [
                m('select', {
                    value: this.viewModel.rule,
                    onchange: (e: Event) => {
                        this.viewModel.rule = parseInt((<HTMLInputElement> e.target!).value, 10);
                    },
                    onupdate: (vnode: m.VnodeDOM<void, this>) => {
                        this.selectOnUpdate(<HTMLInputElement> vnode.dom, this.viewModel.rule);
                    },
                }, [
                    m('option', { value: '-1' }, 'ルールを選択'),
                    rules.map((rule) => {
                        return m('option', { value: rule.ruleId === null ? 0 : rule.ruleId }, `${ rule.name }(${ rule.cnt })`);
                    }),
                ]),
            ]),
        ];
    }

    /**
     * 放送局 selector
     */
    private createChannelSelector(channels: apid.RecordedChannelTag[]): m.Child[] {
        return [
            m('div', { style: 'margin-top: 10px;' }, '放送局'),
            m('div', { class: 'pulldown mdl-layout-spacer' }, [
                m('select', {
                    value: this.viewModel.channel,
                    onchange: (e: Event) => {
                        this.viewModel.channel = parseInt((<HTMLInputElement> e.target!).value, 10);
                    },
                    onupdate: (vnode: m.VnodeDOM<void, this>) => {
                        this.selectOnUpdate(<HTMLInputElement> vnode.dom, this.viewModel.channel);
                    },
                }, [
                    m('option', { value: '-1' }, 'すべて'),
                    channels.map((channel) => {
                        return m('option', { value: channel.channelId }, `${ channel.name }(${ channel.cnt })`);
                    }),
                ]),
            ]),
        ];
    }

    /**
     * ジャンル selector
     */
    private createCategorySelector(genres: apid.RecordedGenreTag[]): m.Child[] {
        return [
            m('div', { style: 'margin-top: 10px;' }, 'ジャンル'),
            m('div', { class: 'pulldown mdl-layout-spacer' }, [
                m('select', {
                    value: this.viewModel.genre,
                    onchange: (e: Event) => {
                        this.viewModel.genre = parseInt((<HTMLInputElement> e.target!).value, 10);
                    },
                    onupdate: (vnode: m.VnodeDOM<void, this>) => {
                        this.selectOnUpdate(<HTMLInputElement> vnode.dom, this.viewModel.genre);
                    },
                }, [
                    m('option', { value: '-1' }, 'すべて'),
                    genres.map((genre) => {
                        return m('option', { value: genre.genre1 === null ? 0 : genre.genre1 }, this.createGenreName(genre.genre1, genre.cnt));
                    }),
                ]),
            ]),
        ];
    }

    /**
     * ジャンル名生成
     */
    private createGenreName(genre1: number | null, cnt: number): string {
        if (genre1 === null) { return `ジャンルなし(${ cnt })`; }
        const str = GenreUtil.getGenre1(genre1);

        return str === null ? `ジャンルなし(${ cnt })` : str + `(${ cnt })`;
    }

    /**
     * checkbox option
     * @return m.Child[]
     */
    private createOption(): m.Child[] {
        return [
            m('div', { style: 'margin-top: 10px;' }, 'オプション'),
            m('div', { class: 'mdl-layout-spacer' }, [
                this.createCheckBox(
                    'TS を必ず含む',
                    () => { return this.viewModel.hasTs; },
                    (value: boolean) => { this.viewModel.hasTs = value; },
                ),
            ]),
        ];
    }

    /**
     * create checkbox
     * @param labelName
     * @param checked: checked
     * @param onclick: onclick
     */
    protected createCheckBox(labelName: string, checked: () => boolean, onclick: (value: boolean) => void): m.Child {
        return m('label', { class: 'mdl-checkbox mdl-js-checkbox mdl-js-ripple-effect' }, [
            m('input', {
                type: 'checkbox',
                class: 'mdl-checkbox__input',
                checked: checked(),
                onclick: (e: Event) => { onclick((<HTMLInputElement> e.target!).checked); },
                onupdate: (vnode: m.VnodeDOM<void, this>) => { this.checkboxOnUpdate(<HTMLInputElement> (vnode.dom)); },
            }),
            m('span', { class: 'mdl-checkbox__label' }, labelName),
        ]);
    }
}

export default RecordedSearchComponent;

