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
        const schedule = this.viewModel.getSchedule();
        if (schedule === null) { return null; }

        return m('div', {
            class: 'program-detail-content',
            onupdate: () => { this.restoreMainLayoutPosition(); },
        }, [
            this.createProgramCard(schedule),
            this.createOptionCard(),
        ]);
    }

    /**
     * program card
     * @param schedule: apid.ScheduleProgram
     * @return m.Child
     */
    private createProgramCard(schedule: apid.ScheduleProgram): m.Child {
        return m('div', {
            class: 'program-card mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col',
        }, [
            m('div', { class: 'mdl-card__supporting-text' }, [
                m('div', { class: 'title' }, schedule.programs[0].name),
                m('div', { class: 'channel' }, schedule.channel.name),
                m('div', { class: 'time' },
                    this.viewModel.createTimeStr(schedule.programs[0].startAt, schedule.programs[0].endAt),
                ),
                m('div', { class: 'genre' },
                    this.viewModel.createGenresStr(schedule.programs[0].genre1, schedule.programs[0].genre2),
                ),
                m('div', { class: 'description' }, schedule.programs[0].description),
                m('div', { class: 'video' },
                    '映像: ' + this.viewModel.createVideoInfoStr(schedule.programs[0].videoComponentType),
                ),
                m('div', { class: 'audio-mode' },
                    '音声: ' + this.viewModel.createAudioModeStr(schedule.programs[0].audioComponentType),
                ),
                m('div', { class: 'audio-sampling-rate' },
                    'サンプリングレート: ' + this.viewModel.createAudioSamplingRateStr(schedule.programs[0].audioSamplingRate),
                ),
                m('div', { class: 'is-free' }, schedule.programs[0].isFree ? '無料放送' : '有料放送'),
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
                this.createSaveDirectory(),
                this.createFileNameFormat(),
                this.createEncode(),
            ]),
            this.createActionButons(),
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
            m('div', { class: 'option-text-box mdl-cell--12-col mdl-textfield mdl-js-textfield' }, [
                m('input', {
                    class: 'mdl-textfield__input',
                    type: 'text',
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
            m('button', {
                class: 'mdl-button mdl-js-button mdl-button--primary',
                onclick: async() => {
                    // 予約追加 or 更新
                    const isEditMode = this.viewModel.isEditMode();
                    try {
                        if (isEditMode) {
                            await this.viewModel.update();
                        } else {
                            await this.viewModel.add();
                        }
                        this.viewModel.openSnackbar(isEditMode ? '予約更新' : '予約追加');
                        await Util.sleep(1000);
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
     * @return m.Child
     */
    protected createContentFrame(name: string, content: m.Child | m.Child[] | null): m.Child {
        return m('div', { class: 'option-content mdl-cell mdl-cell--12-col mdl-grid mdl-grid--no-spacing' }, [
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
                onclick: m.withAttr('checked', (value) => { onclick(value); }),
                onupdate: (vnode: m.VnodeDOM<void, this>) => { this.checkboxOnUpdate(<HTMLInputElement> (vnode.dom)); },
            }),
            m('span', { class: 'mdl-checkbox__label' }, labelName),
        ]);
    }
}

export default ProgramDetailComponent;

