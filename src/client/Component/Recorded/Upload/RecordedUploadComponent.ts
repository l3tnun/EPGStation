import * as m from 'mithril';
import { ViewModelStatus } from '../../../Enums';
import RecordedUploadViewModel from '../../../ViewModel/Recorded/RecordedUploadViewModel';
import factory from '../../../ViewModel/ViewModelFactory';
import MainLayoutComponent from '../../MainLayoutComponent';
import ParentComponent from '../../ParentComponent';

/**
 * RecordedUploadComponent
 */
class RecordedUploadComponent extends ParentComponent<void> {
    private viewModel: RecordedUploadViewModel;

    constructor() {
        super();

        this.viewModel = <RecordedUploadViewModel> factory.get('RecordedUploadViewModel');
    }

    protected async parentInitViewModel(status: ViewModelStatus): Promise<void> {
        this.viewModel.init(status);
    }

    /**
     * page name
     */
    protected getComponentName(): string { return 'RecordedUpload'; }

    /**
     * view
     */
    public view(): m.Child {
        return m(MainLayoutComponent, {
            header: { title: 'アップロード' },
            content: [
                this.createContent(),
            ],
            scrollStoped: (scrollTop: number) => {
                this.saveHistoryData(scrollTop);
            },
        });
    }

    /**
     * create content
     * @return m.Child
     */
    public createContent(): m.Child {
        return m('div', {
            class : 'recorded-upload-content mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col',
            onupdate: () => { this.restoreMainLayoutPosition(); },
        }, [
            m('div', { class: 'mdl-card__supporting-text' }, [
                this.createBroadcaster(),
                this.createGenres(),
                this.createRules(),
                this.createTitle(),
                this.createDescription(),
                this.createExtended(),
            ]),
            this.createActionButtons(),
        ]);
    }

    /**
     * 放送局 & 放送波チェックボックス
     * @return m.Child
     */
    private createBroadcaster(): m.Child {
        return this.createContentFrame('放送局', [
            // 放送局プルダウン
            m('div', { style: 'display: flex; width: 100%;' }, [
                 m('div', { class: 'pulldown mdl-layout-spacer' }, [
                    m('select', {
                        value: this.viewModel.station,
                        onchange: m.withAttr('value', (value) => { this.viewModel.station = Number(value); }),
                    }, [
                        m('option', { value: '0' }, '指定なし'),
                        this.viewModel.getChannels().map((channel) => {
                            return m('option', { value: channel.id }, channel.name);
                        }),
                    ]),
                ]),
            ]),
        ]);
    }

    /**
     * 対象ジャンル
     * @return m.Child
     */
    private createGenres(): m.Child {
        return this.createContentFrame('対象ジャンル', [
            // ジャンルセレクタ
            m('div', { style: 'display: flex; width: 50%;' }, [
                m('div', { class: 'pulldown mdl-layout-spacer' }, [
                    m('select', {
                        value: this.viewModel.genrelv1,
                        onchange: m.withAttr('value', (value) => {
                            this.viewModel.genrelv1 = Number(value);
                            this.viewModel.initGenre2();
                        }),
                    },
                        m('option', { value: '-1' }, '指定なし'),
                        this.viewModel.getGenre1().map((genre) => {
                            return m('option', { value: genre.value }, genre.name);
                        }),
                    ),
                ]),
            ]),

            // サブジャンルセレクタ
            m('div', { style: 'display: flex; width: 50%;' }, [
                m('div', { class: 'pulldown mdl-layout-spacer' }, [
                    m('select', {
                        value: this.viewModel.genrelv2,
                        onchange: m.withAttr('value', (value) => { this.viewModel.genrelv2 = Number(value); }),
                    },
                        m('option', { value: '-1' }, '指定なし'),
                        this.viewModel.getGenre2().map((genre) => {
                            return m('option', { value: genre.value }, genre.name);
                        }),
                    ),
                ]),
            ]),
        ]);
    }

    /**
     * rule
     */
    private createRules(): m.Child | null {
        return this.createContentFrame('ルール', [
            m('div', { style: 'display: flex; width: 100%;' }, [
                 m('div', { class: 'pulldown mdl-layout-spacer' }, [
                    m('select', {
                        value: this.viewModel.ruleId,
                        onchange: m.withAttr('value', (value) => { this.viewModel.ruleId = Number(value); }),
                    }, [
                        m('option', { value: '0' }, '指定なし'),
                        this.viewModel.getRuleList().map((rule) => {
                            return m('option', { value: rule.id }, rule.keyword || '-');
                        }),
                    ]),
                ]),
            ]),
        ]);
    }

    /**
     * create title
     * @return m.Child
     */
    private createTitle(): m.Child {
        return this.createContentFrame('タイトル', [
            m('div', { class: 'mdl-cell--12-col mdl-textfield mdl-js-textfield' }, [
                m('input', {
                    class: 'mdl-textfield__input',
                    type: 'text',
                    value: this.viewModel.title,
                    onchange: m.withAttr('value', (value) => { this.viewModel.title = value; }),
                }),
            ]),
        ]);
    }

    /**
     * create description
     * @return m.Child
     */
    private createDescription(): m.Child {
        return this.createContentFrame('概要', [
            m('div', {
                class: 'mdl-cell--12-col mdl-textfield mdl-js-textfield',
            }, [
                m('textarea', {
                    class: 'mdl-textfield__input',
                    // type: 'text',
                    value: this.viewModel.description,
                    onchange: m.withAttr('value', (value) => { this.viewModel.description = value; }),
                    rows: 3,
                }),
            ]),
        ]);
    }

    /**
     * create extended
     * @return m.Child
     */
    private createExtended(): m.Child {
        return this.createContentFrame('詳細', [
            m('div', {
                class: 'mdl-cell--12-col mdl-textfield mdl-js-textfield',
            }, [
                m('textarea', {
                    class: 'mdl-textfield__input',
                    value: this.viewModel.extended,
                    onchange: m.withAttr('value', (value) => { this.viewModel.extended = value; }),
                    rows: 3,
                }),
            ]),
        ]);
    }

    /**
     * create action buttons
     * @return m.Child
     */
    private createActionButtons(): m.Child {
        return m('div', { class: 'mdl-dialog__actions' }, [
            m('button', {
                type: 'button',
                class: 'mdl-button mdl-js-button mdl-button--primary',
                onclick: () => {},
            }, '保存'),
            m('button', {
                type: 'button',
                class: 'mdl-button mdl-js-button mdl-button--accent close',
                onclick: () => { this.viewModel.initInput(); },
            }, 'クリア'),
        ]);
    }

    /**
     * create content frame
     * @param name: name
     * @param content: content
     * @return m.Child
     */
    protected createContentFrame(name: string, content: m.Child | m.Child[] | null): m.Child {
        return m('div', { class: 'mdl-cell mdl-cell--12-col mdl-grid mdl-grid--no-spacing' }, [
            m('div', { class: 'title mdl-cell mdl-cell--3-col mdl-cell--2-col-tablet' }, name),
            m('div', { class: 'mdl-cell mdl-cell--6-col mdl-cell--9-col-desktop mdl-grid mdl-grid--no-spacing' }, content),
        ]);
    }
}

export default RecordedUploadComponent;

