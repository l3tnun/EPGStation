import * as m from 'mithril';
import ParentComponent from '../ParentComponent';
import { ViewModelStatus } from '../../Enums';
import MainLayoutComponent from '../MainLayoutComponent';
import factory from '../../ViewModel/ViewModelFactory';
import SettingViewModel from '../../ViewModel/Setting/SettingViewModel';
import Util from '../../Util/Util';

/**
* SettingComponent
*/
class SettingComponent extends ParentComponent<void> {
    private viewModel: SettingViewModel;

    constructor() {
        super();
        this.viewModel = <SettingViewModel>(factory.get('SettingViewModel'));
    }

    protected initViewModel(status: ViewModelStatus = 'init'): void {
        super.initViewModel(status);
        if(status === 'init') {
            this.viewModel.setTemp();
        }
        Util.sleep(10)
        .then(() => {
            this.setRestorePositionFlag(status);
        });
    }

    /**
    * page name
    */
    protected getComponentName(): string { return 'Setting'; }

    /**
    * view
    */
    public view(): m.Child {
        return m(MainLayoutComponent, {
            header: { title: '設定' },
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
        let buttonHover = Util.uaIsMobile() ? ' no-hover' : '';

        let fixScroll: m.Child | null = null;
        if(Util.uaIsAndroid()) {
            fixScroll = this.createListItem(
                '番組表スクロール修正',
                this.createToggle(
                    () => { return this.viewModel.tmpValue.programFixScroll; },
                    (value) => { this.viewModel.tmpValue.programFixScroll = value; },
                )
            );
        }

        return m('div', {
            class : 'setting-content mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col',
            onupdate: () => { this.restoreMainLayoutPosition(); },
        }, [
            m('ul', { class: 'mdl-list' }, [
                this.createListItem(
                    'ナビゲーションを自動で開く',
                    this.createToggle(
                        () => { return this.viewModel.tmpValue.isAutoOpenNavigation; },
                    (value) => { this.viewModel.tmpValue.isAutoOpenNavigation = value; },
                    )
                ),

                fixScroll,

                this.createListItem(
                    '番組表時間',
                    m('div', { class: 'pulldown mdl-layout-spacer' }, [
                        m('select', {
                            class: 'mdl-textfield__input program-dialog-label',
                            onchange: m.withAttr('value', (value) => {
                                this.viewModel.tmpValue.programLength = Number(value);
                            }),
                            onupdate: (vnode: m.VnodeDOM<void, this>) => {
                                this.selectOnUpdate(<HTMLInputElement>(vnode.dom), this.viewModel.tmpValue.programLength);
                            },
                        }, this.createLengthOption(24))
                    ])
                ),

                this.createListItem(
                    '録画番組表示件数',
                    m('div', { class: 'pulldown mdl-layout-spacer' }, [
                        m('select', {
                            class: 'mdl-textfield__input program-dialog-label',
                            onchange: m.withAttr('value', (value) => {
                                this.viewModel.tmpValue.recordedLength = Number(value);
                            }),
                            onupdate: (vnode: m.VnodeDOM<void, this>) => {
                                this.selectOnUpdate(<HTMLInputElement>(vnode.dom), this.viewModel.tmpValue.recordedLength);
                            },
                        }, this.createLengthOption())
                    ])
                ),

                this.createListItem(
                    '予約表示件数',
                    m('div', { class: 'pulldown mdl-layout-spacer' }, [
                        m('select', {
                            class: 'mdl-textfield__input program-dialog-label',
                            onchange: m.withAttr('value', (value) => {
                                this.viewModel.tmpValue.reservesLength = Number(value);
                            }),
                            onupdate: (vnode: m.VnodeDOM<void, this>) => {
                                this.selectOnUpdate(<HTMLInputElement>(vnode.dom), this.viewModel.tmpValue.reservesLength);
                            },
                        }, this.createLengthOption())
                    ])
                ),

                this.createListItem(
                    'ルール表示件数',
                    m('div', { class: 'pulldown mdl-layout-spacer' }, [
                        m('select', {
                            class: 'mdl-textfield__input program-dialog-label',
                            onchange: m.withAttr('value', (value) => {
                                this.viewModel.tmpValue.ruleLength = Number(value);
                            }),
                            onupdate: (vnode: m.VnodeDOM<void, this>) => {
                                this.selectOnUpdate(<HTMLInputElement>(vnode.dom), this.viewModel.tmpValue.ruleLength);
                            },
                        }, this.createLengthOption())
                    ])
                ),

                this.createListItem(
                    'ライブ視聴のURL設定',
                    this.createToggle(
                        () => { return this.viewModel.tmpValue.isEnableMegTsStreamingURLScheme; },
                        (value) => { this.viewModel.tmpValue.isEnableMegTsStreamingURLScheme = value; },
                    )
                ),
                this.createTextBox(
                    () => {
                        const value = this.viewModel.tmpValue.customMegTsStreamingURLScheme;
                        return value === null ? '' : value;
                    },
                    (value) => {
                        this.viewModel.tmpValue.customMegTsStreamingURLScheme = value ? value : null;
                    }
                ),

                this.createListItem(
                    '録画視聴のURL設定',
                    this.createToggle(
                        () => { return this.viewModel.tmpValue.isEnableRecordedViewerURLScheme; },
                        (value) => { this.viewModel.tmpValue.isEnableRecordedViewerURLScheme = value; },
                    )
                ),
                this.createTextBox(
                    () => {
                        const value = this.viewModel.tmpValue.customRecordedViewerURLScheme;
                        return value === null ? '' : value;
                    },
                    (value) => {
                        this.viewModel.tmpValue.customRecordedViewerURLScheme = value ? value : null;
                    }
                ),

                this.createListItem(
                    '録画保存のURL設定',
                    this.createToggle(
                        () => { return this.viewModel.tmpValue.isEnableRecordedDownloaderURLScheme; },
                        (value) => { this.viewModel.tmpValue.isEnableRecordedDownloaderURLScheme = value; },
                    )
                ),
                this.createTextBox(
                    () => {
                        const value = this.viewModel.tmpValue.customRecordedDownloaderURLScheme;
                        return value === null ? '' : value;
                    },
                    (value) => {
                        this.viewModel.tmpValue.customRecordedDownloaderURLScheme = value ? value : null;
                    }
                ),
            ]),

            m('div', { class: 'mdl-dialog__actions' }, [
                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-js-button mdl-button--primary' + buttonHover,
                    onclick: () => { this.viewModel.save(); }
                }, '保存'),

                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-js-button mdl-button--accent close' + buttonHover,
                    onclick: () => { this.viewModel.reset(); },
                }, 'リセット'),
            ]),
        ]);
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
    * create length option
    * @param maxValue: number
    * @return m.Child[]
    */
    private createLengthOption(maxValue: number = 50): m.Child[] {
        let results: m.Child[] = [];

        for(let i = 1; i <= maxValue; i++) {
            results.push(m('option', { value: i }, i));
        }

        return results;
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
                this.toggleLabelOnUpdate(<HTMLInputElement>vnode.dom, getValue());
            },
        }, [
            m('input', {
                type: 'checkbox',
                class: 'mdl-switch__input',
                checked: getValue(),
                onclick: m.withAttr('checked', (value) => {
                    setValue(value);
                }),
            }),
            m('span', { class: 'mdl-switch__label' }),
        ]);
    }

    /**
    * create TextBox
    * @param getValue: () => string
    * @param setValue: (value: string) => void
    * @return m.Child
    */
    private createTextBox(getValue: () => string, setValue: (value: string) => void): m.Child {
        return m('li', { class: 'mdl-list__item' }, [
            m('div', { class: 'mdl-cell--12-col mdl-textfield mdl-js-textfield' }, [
                 m('input', {
                    class: 'mdl-textfield__input',
                    type: 'text',
                    value: getValue(),
                    onchange: m.withAttr('value', (value) => { setValue(value); }),
                })
            ]),
        ]);
    }
}

export default SettingComponent;

