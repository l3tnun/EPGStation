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
            m('div', { class: 'mdl-card__supporting-text' }, [
                this.createOptionCheckBox(),
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
        return m('div', { style: 'width: 100%;' }, [
            // セレクタ
            m('div', { style: 'display: table-cell;' }, `設定${ num + 1 }: モード`),
            m('div', { style: 'display: table-cell; padding: 0px 12px;' }, [
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

