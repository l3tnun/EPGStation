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
                onchange: m.withAttr('value', (value) => {
                    this.viewModel.keyword = value;
                }),
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
                    onchange: m.withAttr('value', (value) => {
                        this.viewModel.rule = Number(value);
                    }),
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
                    onchange: m.withAttr('value', (value) => {
                        this.viewModel.channel = Number(value);
                    }),
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
                    onchange: m.withAttr('value', (value) => {
                        this.viewModel.genre = Number(value);
                    }),
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
}

export default RecordedSearchComponent;

