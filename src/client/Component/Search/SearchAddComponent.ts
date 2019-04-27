import * as m from 'mithril';
import SearchViewModel from '../../ViewModel/Search/SearchViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import SearchOptionBaseComponent from './SearchOptionBaseComponent';

/**
 * SearchOptionComponent
 */
class SearchAddComponent extends SearchOptionBaseComponent<void> {
    private viewModel: SearchViewModel;

    constructor() {
        super();
        this.viewModel = <SearchViewModel> factory.get('SearchViewModel');
    }

    public view(): m.Child | null {
        if (this.viewModel.getSearchResults() === null) { return null; }

        return m('div', {
            class: 'option-card mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col',
            style: 'margin: 38px auto;',
        }, [
            m('div', {
                id: SearchViewModel.addCardId,
                class: 'add-card mdl-card__supporting-text',
            }, [
                this.createOptionCheckBox(),
                this.createAvoidDuplicate(),
                this.createSaveDirectory(),
                this.createFileNameFormat(),
                this.createEncode(),
            ]),
            this.createActionButons(),
        ]);
    }

    /**
     * オプション部分
     */
    private createOptionCheckBox(): m.Child {
        return this.createContentFrame('オプション', [
            m('div', { style: 'margin-top: 12px;' } , [
                this.createCheckBox(
                    '有効',
                    () => { return this.viewModel.enable; },
                    (value: boolean) => { this.viewModel.enable = value; },
                ),
                this.createCheckBox(
                    '状況に応じて末尾が欠ける事を許可',
                    () => { return this.viewModel.allowEndLack; },
                    (value: boolean) => { this.viewModel.allowEndLack = value; },
                ),
            ]),
        ]);
    }

    /**
     * 重複回避
     */
    private createAvoidDuplicate(): m.Child {
        return this.createContentFrame('重複', [
            m('div', { class: 'option-text-box mdl-cell--12-col mdl-textfield mdl-js-textfield' }, [
                m('div', { style: 'margin-top: 12px;' } , [
                    this.createCheckBox(
                        '録画済み番組を排除',
                        () => { return this.viewModel.avoidDuplicate; },
                        (value: boolean) => { this.viewModel.avoidDuplicate = value; },
                    ),
                ]),
                m('div', { class: 'period-box' }, [
                    m('input', {
                        class: 'mdl-textfield__input',
                        type: 'number', pattern: '^[0-9]+$',
                        value: (() => {
                            return this.viewModel.periodToAvoidDuplicate;
                        })(),
                        onchange: m.withAttr('value', (value) => {
                            let num = Number(value);
                            if (value.length === 0 || isNaN(num)) { num = 6; }
                            this.viewModel.periodToAvoidDuplicate = num;
                        }),
                        onupdate: (vnode: m.VnodeDOM<void, this>) => {
                            this.inputNumberOnUpdate(<HTMLInputElement> vnode.dom, this.viewModel.periodToAvoidDuplicate);
                        },
                    }),

                    m('div', { class: 'period-text' }, '日間'),
                ]),
            ]),
        ]);
    }

    /**
     * ディレクトリ
     */
    private createSaveDirectory(): m.Child {
        return this.createContentFrame('ディレクトリ', [
            m('div', { class: '.option-text-box mdl-cell--12-col mdl-textfield mdl-js-textfield' }, [
                m('input', {
                    class: 'mdl-textfield__input',
                    type: 'text',
                    placeholder: 'directory',
                    value: this.viewModel.directory,
                    onchange: m.withAttr('value', (value) => { this.viewModel.directory = value; }),
                }),
            ]),
        ]);
    }

    /**
     * ファイル名形式
     */
    private createFileNameFormat(): m.Child {
        return this.createContentFrame('ファイル名形式', [
            m('div', { class: '.option-text-box mdl-cell--12-col mdl-textfield mdl-js-textfield' }, [
                m('input', {
                    class: 'mdl-textfield__input',
                    type: 'text',
                    placeholder: 'file format',
                    value: this.viewModel.recordedFormat,
                    onchange: m.withAttr('value', (value) => { this.viewModel.recordedFormat = value; }),
                }),
            ]),
        ]);
    }

    /**
     * エンコード
     */
    private createEncode(): m.Child | null {
        if (!this.viewModel.isEnableEncode()) { return null; }

        return this.createContentFrame('エンコード', [
            this.createTranscodeContent(0),
            this.createTranscodeContent(1),
            this.createTranscodeContent(2),
            this.createCheckBox(
                '元ファイルの自動削除',
                () => { return this.viewModel.delTs; },
                (value: boolean) => { this.viewModel.delTs = value; },
            ),
        ]);
    }

    /**
     * トランスコードのオプションを生成する
     */
    private createTranscodeContent(num: number): m.Child {
        return m('div', { class: 'encode-content' }, [
            // セレクタ
            m('div', { class: 'mode' }, `設定${ num + 1 }: モード`),
            m('div', { class: 'selector' }, [
                m('div', { class: 'pulldown mdl-layout-spacer' }, [
                    m('select', {
                        value: this.viewModel.encodeModes[num].mode,
                        onchange: m.withAttr('value', (value) => {
                            this.viewModel.encodeModes[num].mode = Number(value);
                        }),
                    }, [
                        m('option', { value: '-1' }, '未指定'),
                        this.viewModel.getEncodeOption().map((name, i) => {
                            return m('option', { value: i }, name);
                        }),
                    ]),
                ]),
            ]),

            // 保存ディレクトリ
            m('div', { class: 'search-result-text-box mdl-cell--12-col mdl-textfield mdl-js-textfield' }, [
                m('input', {
                    class: 'mdl-textfield__input',
                    type: 'text',
                    placeholder: 'directory',
                    value: this.viewModel.encodeModes[num].directory,
                    onchange: m.withAttr('value', (value) => {
                        this.viewModel.encodeModes[num].directory = value;
                    }),
                }),
            ]),
        ]);
    }

    /**
     * アクションボタン
     */
    private createActionButons(): m.Child {
        return m('div', { class: 'mdl-dialog__actions mdl-card__actions mdl-card--border' }, [
            // 追加 or 更新ボタン
            m('button', {
                class: 'mdl-button mdl-js-button mdl-button--primary',
                onclick: () => {
                    if (typeof m.route.param('rule') !== 'undefined') {
                        this.viewModel.updateRule();
                    } else {
                        this.viewModel.addRule();
                    }
                },
            }, typeof m.route.param('rule') === 'undefined' ? '追加' : '更新'),

            // キャンセルボタン
            m('button', {
                class: 'mdl-button mdl-js-button mdl-button--accent',
                onclick: () => {
                    // 1 つ前のページに戻る
                    window.history.back();
                },
            }, 'キャンセル'),
        ]);
    }
}

export default SearchAddComponent;

