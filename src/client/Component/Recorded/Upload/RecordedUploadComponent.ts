import * as m from 'mithril';
import { ViewModelStatus } from '../../../Enums';
import Scroll from '../../../Util/Scroll';
import Util from '../../../Util/Util';
import RecordedUploadViewModel from '../../../ViewModel/Recorded/RecordedUploadViewModel';
import factory from '../../../ViewModel/ViewModelFactory';
import { BalloonComponent } from '../../BalloonComponent';
import MainLayoutComponent from '../../MainLayoutComponent';
import ParentComponent from '../../ParentComponent';
import RecordedUploadBalloonComponnet from './RecordedUploadBalloonComponnet';

interface HTMLInputEvent extends Event {
    target: HTMLInputElement & EventTarget;
}

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

        await Util.sleep(100);
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
                m('button', {
                    class: 'fab-right-bottom mdl-shadow--8dp mdl-button mdl-js-button mdl-button--fab mdl-button--colored',
                    onclick: async() => {
                        this.viewModel.createNewEncode();

                        await Util.sleep(100);
                        m.redraw();

                        const mainLayout = this.getMainLayout();
                        if (mainLayout === null) { return; }

                        Scroll.scrollTo(mainLayout, mainLayout.scrollTop, mainLayout.scrollHeight - mainLayout.clientHeight, 300);
                    },
                }, m('i', { class: 'material-icons' }, 'add')),
            ],
            scrollStoped: (scrollTop: number) => {
                this.saveHistoryData(scrollTop);
            },
            notMainContent: [
                m(BalloonComponent, {
                    id: RecordedUploadViewModel.uploadingId,
                    content: m(RecordedUploadBalloonComponnet),
                    maxWidth: 300,
                    maxHeight: 300,
                    forceDialog: true,
                    forceModal: true,
                }),
            ],
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
                this.createDate(),
                this.createDuration(),
                this.createTitle(),
                this.createDescription(),
                this.createExtended(),
                this.createDirectory(),
                this.createTsFile(),
                this.createEncodeFiles(),
            ]),
            this.createActionButtons(),
        ]);
    }

    /**
     * 放送局 & 放送波チェックボックス
     * @return m.Child
     */
    private createBroadcaster(): m.Child {
        return this.createContentFrame('放送局※', [
            // 放送局プルダウン
            m('div', { style: 'display: flex; width: 100%;' }, [
                 m('div', { class: 'pulldown mdl-layout-spacer' }, [
                    m('select', {
                        value: this.viewModel.station,
                        onchange: (e: Event) => { this.viewModel.station = parseInt((<HTMLInputElement> e.target!).value, 10); },
                    }, [
                        m('option', { value: '0' }, '指定なし'),
                        this.viewModel.getChannels().map((channel) => {
                            return m('option', { value: channel.id }, channel.name);
                        }),
                    ]),
                ]),
            ]),
        ], 'required');
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
                        onchange: (e: Event) => {
                            this.viewModel.genrelv1 = parseInt((<HTMLInputElement> e.target!).value, 10);
                            this.viewModel.initGenre2();
                        },
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
                        onchange: (e: Event) => { this.viewModel.genrelv2 = parseInt((<HTMLInputElement> e.target!).value, 10); },
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
                        onchange: (e: Event) => { this.viewModel.ruleId = parseInt((<HTMLInputElement> e.target!).value, 10); },
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
     * create date
     * @return m.Child
     */
    private createDate(): m.Child {
        return this.createContentFrame('日付※', [
            m('div', {
                class: 'mdl-cell--12-col mdl-textfield mdl-js-textfield',
                style: 'display: flex; width: 50%;',
            }, [
                m('input', {
                    class: 'mdl-textfield__input',
                    type: 'date',
                    value: this.viewModel.date,
                    onchange: (e: Event) => { this.viewModel.date = (<HTMLInputElement> e.target!).value; },
                }),
            ]),
            m('div', {
                class: 'mdl-cell--12-col mdl-textfield mdl-js-textfield',
                style: 'display: flex; width: 50%;',
            }, [
                m('input', {
                    class: 'mdl-textfield__input',
                    type: 'time',
                    value: this.viewModel.time,
                    onchange: (e: Event) => { this.viewModel.time = (<HTMLInputElement> e.target!).value; },
                }),
            ]),
        ], 'required');
    }

    /**
     * create duration
     * @return m.Child
     */
    private createDuration(): m.Child {
        return this.createContentFrame('長さ(分)※', [
            m('div', { class: 'mdl-cell--12-col mdl-textfield mdl-js-textfield' }, [
                m('input', {
                    class: 'mdl-textfield__input',
                    type: 'number', pattern: '-?[0-9]*(\.[0-9]+)?',
                    placeholder: '長さ',
                    value: (() => {
                        if (this.viewModel.duration === 0) { return; }
                        else { return this.viewModel.duration; }
                    })(),
                    onchange: (e: Event) => {
                        let num = parseInt((<HTMLInputElement> e.target!).value, 10);
                        if (isNaN(num)) { num = 0; }
                        this.viewModel.duration = num;
                    },
                    onupdate: (vnode: m.VnodeDOM<void, this>) => {
                        this.inputNumberOnUpdate(<HTMLInputElement> vnode.dom, this.viewModel.duration);
                    },
                }),
            ]),
        ], 'required');
    }

    /**
     * create title
     * @return m.Child
     */
    private createTitle(): m.Child {
        return this.createContentFrame('タイトル※', [
            m('div', { class: 'mdl-cell--12-col mdl-textfield mdl-js-textfield' }, [
                m('input', {
                    class: 'mdl-textfield__input',
                    type: 'text',
                    placeholder: 'title',
                    value: this.viewModel.title,
                    onchange: (e: Event) => { this.viewModel.title = (<HTMLInputElement> e.target!).value; },
                }),
            ]),
        ], 'required');
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
                    placeholder: '概要',
                    value: this.viewModel.description,
                    onchange: (e: Event) => { this.viewModel.description = (<HTMLInputElement> e.target!).value; },
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
                    placeholder: '詳細',
                    value: this.viewModel.extended,
                    onchange: (e: Event) => { this.viewModel.extended = (<HTMLInputElement> e.target!).value; },
                    rows: 3,
                }),
            ]),
        ]);
    }

    /**
     * create directory
     * @return m.Child
     */
    private createDirectory(): m.Child {
        return this.createContentFrame('ディレクトリ', [
            m('div', { class: 'mdl-cell--12-col mdl-textfield mdl-js-textfield' }, [
                m('input', {
                    class: 'mdl-textfield__input',
                    type: 'text',
                    placeholder: 'directory',
                    value: this.viewModel.directory,
                    onchange: (e: Event) => { this.viewModel.directory = (<HTMLInputElement> e.target!).value; },
                }),
            ]),
        ]);
    }

    /**
     * create ts file
     * @return m.Child
     */
    private createTsFile(): m.Child {
        return this.createContentFrame('TS ファイル', [
            this.createFileInput('File',
                () => { return this.viewModel.tsFile; },
                (file) => { this.viewModel.tsFile = file; },
                () => { return this.viewModel.tsName; },
                (dir) => { this.viewModel.tsName = dir; },
            ),
        ]);
    }

    /**
     * create file input
     * @param id
     * m.Child
     */
    private createFileInput(
        placeholder: string,
        getFile: () => File | null,
        setFile: (file: File | null) => void,
        getName: () => string,
        getDir: (name: string) => void,
    ): m.Child {
        const file = getFile();

        return m('div', { class: 'file mdl-cell--12-col' }, [
            m('div', { class: 'mdl-textfield mdl-js-textfield file-field' }, [
                m('input', {
                    class: 'mdl-textfield__input',
                    placeholder: placeholder,
                    onupdate: (vnode: m.VnodeDOM<void, any>) => {
                        (<HTMLInputElement> vnode.dom).value = file === null ? placeholder : file.name;
                    },
                    type: 'text',
                    readonly: ' ',
                }),
                m('label', { class: 'mdl-button mdl-js-button mdl-button--icon' }, [
                    file === null
                    ? m('i', { class: 'material-icons' }, [
                        'attach_file',
                        m('input', {
                            type: 'file',
                            onchange: (e: HTMLInputEvent) => {
                                if (e.target.files === null) { return; }
                                setFile(e.target.files[0]);
                            },
                        }),
                    ])
                    : m('i', {
                        class: 'material-icons',
                        onclick: () => {
                            setFile(null);

                            return false;
                        },
                    }, 'clear'),
                ]),
            ]),
            m('div', { class: 'mdl-textfield mdl-js-textfield directory-field' }, [
                m('input', {
                    class: 'mdl-textfield__input',
                    type: 'text',
                    placeholder: 'name',
                    value: getName(),
                    onchange: (e: Event) => { getDir((<HTMLInputElement> e.target!).value); },
                }),
            ]),
        ]);
    }

    /**
     * create encode files
     * @return m.Child
     */
    private createEncodeFiles(): m.Child | null {
        if (this.viewModel.encodeFiles.length === 0) { return null; }

        return this.createContentFrame('エンコードファイル',
            this.viewModel.encodeFiles.map((_encode, idx) => {
                return this.createFileInput(`Encode File${ idx + 1 }`,
                    () => { return this.viewModel.encodeFiles[idx].file; },
                    (file) => { this.viewModel.encodeFiles[idx].file = file; },
                    () => { return this.viewModel.encodeFiles[idx].name; },
                    (name) => { this.viewModel.encodeFiles[idx].name = name; },
                );
            }),
        );
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
                onclick: () => {
                    this.viewModel.upload();
                },
            }, 'アップロード'),
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
     * @param classStr: style
     * @return m.Child
     */
    protected createContentFrame(name: string, content: m.Child | m.Child[] | null, classStr: string = ''): m.Child {
        return m('div', { class: 'mdl-cell mdl-cell--12-col mdl-grid mdl-grid--no-spacing ' + classStr }, [
            m('div', { class: 'title mdl-cell mdl-cell--3-col mdl-cell--2-col-tablet' }, name),
            m('div', { class: 'mdl-cell mdl-cell--6-col mdl-cell--9-col-desktop mdl-grid mdl-grid--no-spacing' }, content),
        ]);
    }
}

export default RecordedUploadComponent;

