import * as m from 'mithril';
import * as apid from '../../../../../api';
import { ViewModelStatus } from '../../../Enums';
import Util from '../../../Util/Util';
import ProgramDetailViewModel from '../../../ViewModel/Program/ProgramDetailViewModel';
import factory from '../../../ViewModel/ViewModelFactory';
import MainLayoutComponent from '../../MainLayoutComponent';
import ParentComponent from '../../ParentComponent';

/**
 * ProgramDetailComponent
 */
class ProgramDetailComponent extends ParentComponent<void> {
    private viewModel: ProgramDetailViewModel;

    constructor() {
        super();
        this.viewModel = <ProgramDetailViewModel> factory.get('ProgramDetailViewModel');
    }

    protected async parentInitViewModel(status: ViewModelStatus): Promise<void> {
        await this.viewModel.init(status, m.route.param('mode') === 'edit');
    }

    /**
     * page name
     */
    protected getComponentName(): string { return 'ProgramDetail'; }

    /**
     * view
     */
    public view(): m.Child {
        return m(MainLayoutComponent, {
            header: { title: this.viewModel.isEditMode() ? '番組予約編集' : '番組詳細予約' },
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
     * @return m.Child | null
     */
    public createContent(): m.Child {
        const program = this.viewModel.getProgram();
        const channel = this.viewModel.getChannel();
        if (program === null || channel === null) { return null; }

        return m('div', {
            class: 'program-detail-content',
            onupdate: () => { this.restoreMainLayoutPosition(); },
        }, [
            this.createProgramCard(program, channel),
            this.createOptionCard(),
        ]);
    }

    /**
     * program card
     * @param program: apid.ScheduleProgramItem | apid.ReserveProgram,
     * @param channel: apid.ScheduleServiceItem | apid.ServiceItem,
     * @return m.Child
     */
    private createProgramCard(
        program: apid.ScheduleProgramItem | apid.ReserveProgram,
        channel: apid.ScheduleServiceItem | apid.ServiceItem,
    ): m.Child {
        return m('div', {
            class: 'program-card mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col',
        }, [
            m('div', { class: 'mdl-card__supporting-text' }, [
                this.viewModel.isTimeSpecified()
                    ? this.createTimeSpecifitedProgramContent()
                    : this.createNormalProgramContent(program, channel),
            ]),
            this.createToggle(),
        ]);
    }

    /**
     * 時刻指定予約番組
     * @return m.Child[] | null
     */
    private createTimeSpecifitedProgramContent(): m.Child[] | null {
        const option = this.viewModel.addReserveProgram;
        if (option === null) { return null; }

        return [
            this.createBroadcaster(option),
            this.createGenres(option),
            this.createDate('開始時刻',
                () => { return this.viewModel.getDateStr(true); },
                (date: string) => { this.viewModel.setDateStr(true, date); },
                () => { return this.viewModel.getTimeStr(true); },
                (time: string) => { this.viewModel.setTimeStr(true, time); },
            ),
            this.createDate('終了時刻',
                () => { return this.viewModel.getDateStr(false); },
                (date: string) => { this.viewModel.setDateStr(false, date); },
                () => { return this.viewModel.getTimeStr(false); },
                (time: string) => { this.viewModel.setTimeStr(false, time); },
            ),
            this.createTitle(option),
            this.createDescription(option),
            this.createExtended(option),
        ];
    }

    /**
     * 放送局プルダウン
     * @param option: apid.AddReserveProgram
     * @return m.Child
     */
    private createBroadcaster(option: apid.AddReserveProgram): m.Child {
        return this.createContentFrame('放送局※', [
            // 放送局プルダウン
            m('div', { style: 'display: flex; width: 100%;' }, [
                 m('div', { class: 'pulldown mdl-layout-spacer' }, [
                    m('select', {
                        value: option.channelId,
                        onchange: (e: Event) => {
                            option.channelId = parseInt((<HTMLInputElement> e.target!).value, 10);
                        },
                    }, [
                        this.viewModel.getChannels().map((channel) => {
                            return m('option', { value: channel.id }, channel.name);
                        }),
                    ]),
                ]),
            ]),
        ], 'required');
    }

    /**
     * ジャンル
     * @param option: apid.AddReserveProgram
     * @return m.Child
     */
    private createGenres(option: apid.AddReserveProgram): m.Child {
        return this.createContentFrame('ジャンル', [
            // ジャンルセレクタ
            m('div', { style: 'display: flex; width: 50%;' }, [
                m('div', { class: 'pulldown mdl-layout-spacer' }, [
                    m('select', {
                        value: option.genre1,
                        onchange: (e: Event) => {
                            option.genre1 = parseInt((<HTMLInputElement> e.target!).value, 10);
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
                        value: option.genre2,
                        onchange: (e: Event) => { option.genre2 = parseInt((<HTMLInputElement> e.target!).value, 10); },
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
     * 時刻
     * @param getDate: () => string
     * @param setDate: (date: string) => void
     * @param getTime: () => string
     * @param setTime: (time: string) => void
     * @return m.Child
     */
    private createDate(
        name: string,
        getDate: () => string,
        setDate: (date: string) => void,
        getTime: () => string,
        setTime: (time: string) => void,
    ): m.Child {
        return this.createContentFrame(name + '※', [
            m('div', {
                class: 'mdl-cell--12-col mdl-textfield mdl-js-textfield',
                style: 'display: flex; width: 50%;',
            }, [
                m('input', {
                    class: 'mdl-textfield__input',
                    type: 'date',
                    value: getDate(),
                    onchange: (e: Event) => { setDate((<HTMLInputElement> e.target!).value); },
                }),
            ]),
            m('div', {
                class: 'mdl-cell--12-col mdl-textfield mdl-js-textfield',
                style: 'display: flex; width: 50%;',
            }, [
                m('input', {
                    class: 'mdl-textfield__input',
                    type: 'time',
                    value: getTime(),
                    step: 1,
                    onchange: (e: Event) => { setTime((<HTMLInputElement> e.target!).value); },
                }),
            ]),
        ], 'required');
    }

    /**
     * 番組タイトル
     * @param option: apid.AddReserveProgram
     * @return m.Child
     */
    private createTitle(option: apid.AddReserveProgram): m.Child {
        return this.createContentFrame('タイトル※', [
            m('div', { class: 'mdl-cell--12-col mdl-textfield mdl-js-textfield' }, [
                m('input', {
                    class: 'mdl-textfield__input',
                    type: 'text',
                    placeholder: 'title',
                    value: option.name,
                    onchange: (e: Event) => { option.name = (<HTMLInputElement> e.target!).value; },
                }),
            ]),
        ], 'required');
    }

    /**
     * 番組概要
     * @param option: apid.AddReserveProgram
     * @return m.Child
     */
    private createDescription(option: apid.AddReserveProgram): m.Child {
        return this.createContentFrame('概要', [
            m('div', {
                class: 'mdl-cell--12-col mdl-textfield mdl-js-textfield',
            }, [
                m('textarea', {
                    class: 'mdl-textfield__input',
                    placeholder: '概要',
                    value: option.description,
                    onchange: (e: Event) => { option.description = (<HTMLInputElement> e.target!).value; },
                    rows: 3,
                }),
            ]),
        ]);
    }

    /**
     * 番組詳細
     * @param option: apid.AddReserveProgram
     * @return m.Child
     */
    private createExtended(option: apid.AddReserveProgram): m.Child {
        return this.createContentFrame('詳細', [
            m('div', {
                class: 'mdl-cell--12-col mdl-textfield mdl-js-textfield',
            }, [
                m('textarea', {
                    class: 'mdl-textfield__input',
                    placeholder: '詳細',
                    value: option.extended,
                    onchange: (e: Event) => { option.extended = (<HTMLInputElement> e.target!).value; },
                    rows: 3,
                }),
            ]),
        ]);
    }

    /**
     * 通常時番組情報
     * @return m.Child[]
     */
    private createNormalProgramContent(
        program: apid.ScheduleProgramItem | apid.ReserveProgram,
        channel: apid.ScheduleServiceItem | apid.ServiceItem,
    ): m.Child[] {
        return [
            m('div', { class: 'title' }, program.name),
            m('div', { class: 'channel' }, channel.name),
            m('div', { class: 'time' },
                this.viewModel.createTimeStr(program.startAt, program.endAt),
            ),
            m('div', { class: 'genre' },
                this.viewModel.createGenresStr(program.genre1, program.genre2),
            ),
            m('div', { class: 'genre' },
                this.viewModel.createGenresStr(program.genre3, program.genre4),
            ),
            m('div', { class: 'genre' },
                this.viewModel.createGenresStr(program.genre5, program.genre6),
            ),
            m('div', { class: 'description' }, program.description),
            m('div', { class: 'extended' }, program.extended),
            m('div', { class: 'video' },
                '映像: ' + this.viewModel.createVideoInfoStr(program.videoComponentType),
            ),
            m('div', { class: 'audio-mode' },
                '音声: ' + this.viewModel.createAudioModeStr(program.audioComponentType),
            ),
            m('div', { class: 'audio-sampling-rate' },
                'サンプリングレート: ' + this.viewModel.createAudioSamplingRateStr(program.audioSamplingRate),
            ),
            m('div', { class: 'is-free' }, program.isFree ? '無料放送' : '有料放送'),
        ];
    }

    /**
     * 手動予約と時刻指定予約を入れ替えるトグル
     * @return m.Child
     */
    private createToggle(): m.Child {
        return m('div', { class: 'time-specifited-toggle' }, [
            m('span', { class: 'time-specifited-toggle-name' }, '時刻指定予約'),
            m('label', {
                class: 'mdl-switch mdl-js-switch mdl-js-ripple-effect',
                onupdate: (vnode: m.VnodeDOM<void, this>) => {
                    this.toggleLabelOnUpdate(<HTMLInputElement> vnode.dom, this.viewModel.isTimeSpecified());
                },
            }, [
                m('input', {
                    type: 'checkbox',
                    class: 'mdl-switch__input',
                    disabled: this.viewModel.isEditMode() ? 'disabled' : '',
                    checked: this.viewModel.isTimeSpecified(),
                    onclick: (e: Event) => {
                        this.viewModel.setTimeSpecifited((<HTMLInputElement> e.target!).checked);
                    },
                }),
                m('span', { class: 'mdl-switch__label' }),
            ]),
        ]);
    }

    /**
     * option card
     * @return m.Child
     */
    private createOptionCard(): m.Child {
        return m('div', {
            class: 'option-card mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col',
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
                    '状況に応じて末尾が欠ける事を許可',
                    () => { return this.viewModel.allowEndLack; },
                    (value: boolean) => { this.viewModel.allowEndLack = value; },
                ),
            ]),
        ]);
    }

    /**
     * ディレクトリ
     */
    private createSaveDirectory(): m.Child {
        return this.createContentFrame('ディレクトリ', [
            m('div', { class: 'option-text-box mdl-cell--12-col mdl-textfield mdl-js-textfield' }, [
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
     * ファイル名形式
     */
    private createFileNameFormat(): m.Child {
        return this.createContentFrame('ファイル名形式', [
            m('div', { class: 'option-text-box mdl-cell--12-col mdl-textfield mdl-js-textfield' }, [
                m('input', {
                    class: 'mdl-textfield__input',
                    type: 'text',
                    placeholder: 'file format',
                    value: this.viewModel.recordedFormat,
                    onchange: (e: Event) => { this.viewModel.recordedFormat = (<HTMLInputElement> e.target!).value; },
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
                        onchange: (e: Event) => {
                            this.viewModel.encodeModes[num].mode = parseInt((<HTMLInputElement> e.target!).value, 10);
                        },
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
                    onchange: (e: Event) => {
                        this.viewModel.encodeModes[num].directory = (<HTMLInputElement> e.target!).value;
                    },
                }),
            ]),
        ]);
    }

    /**
     * アクションボタン
     */
    private createActionButons(): m.Child {
        return m('div', { class: 'mdl-dialog__actions mdl-card__actions mdl-card--border' }, [
            m('button', {
                class: 'mdl-button mdl-js-button mdl-button--primary',
                onclick: async() => {
                    // 予約追加 or 更新
                    const isEditMode = this.viewModel.isEditMode();
                    let programId: apid.ProgramId | null = null;

                    try {
                        if (isEditMode) {
                            await this.viewModel.update();
                        } else {
                            programId = await this.viewModel.add();
                        }
                        this.viewModel.openSnackbar(isEditMode ? '予約更新' : '予約追加');
                        await Util.sleep(1000);

                        if (programId !== null && this.viewModel.isTimeSpecified()) {
                            // 時刻指定予約の場合該当の予約一覧の該当ページへ飛ぶ
                            const position = await this.viewModel.getReservePagePosition(programId);
                            Util.move('/reserves', { page: position });

                            return;
                        }
                    } catch (err) {
                        this.viewModel.openSnackbar((isEditMode ? '予約更新' : '予約追加') + 'に失敗しました');

                        return;
                    }

                    window.history.back();
                },
            }, this.viewModel.isEditMode() ? '更新' : '予約'),

            // キャンセルボタン
            m('button', {
                class: 'mdl-button mdl-js-button mdl-button--accent',
                onclick: () => {
                    window.history.back();
                },
            }, 'キャンセル'),
        ]);
    }

    /**
     * create content frame
     * @param name: name
     * @param content: content
     * @param classStr: class
     * @return m.Child
     */
    protected createContentFrame(name: string, content: m.Child | m.Child[] | null, classStr: string = ''): m.Child {
        return m('div', { class: 'option-content mdl-cell mdl-cell--12-col mdl-grid mdl-grid--no-spacing ' + classStr }, [
            m('div', { class: 'option-title mdl-cell mdl-cell--3-col mdl-cell--2-col-tablet' }, name),
            m('div', { class: 'mdl-cell mdl-cell--6-col mdl-cell--9-col-desktop mdl-grid mdl-grid--no-spacing' }, content),
        ]);
    }

    /**
     * create checkbox
     * @param labelName
     * @param checked: checked
     * @param onclick: onclick
     */
    protected createCheckBox(labelName: string, checked: () => boolean, onclick: (value: boolean) => void): m.Child {
        return m('label', { class: 'option-checkbox mdl-checkbox mdl-js-checkbox mdl-js-ripple-effect' }, [
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

export default ProgramDetailComponent;

