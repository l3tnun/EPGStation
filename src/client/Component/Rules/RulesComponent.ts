import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import Util from '../../Util/Util';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import RulesDeleteViewModel from '../../ViewModel/Rules/RulesDeleteViewModel';
import RulesInfoViewModel from '../../ViewModel/Rules/RulesInfoViewModel';
import RulesSearchViewModel from '../../ViewModel/Rules/RulesSearchViewModel';
import RulesViewModel from '../../ViewModel/Rules/RulesViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import { BalloonComponent } from '../BalloonComponent';
import EditHeaderComponent from '../EditHeaderComponent';
import MainLayoutComponent from '../MainLayoutComponent';
import PaginationComponent from '../PaginationComponent';
import ParentComponent from '../ParentComponent';
import RulesDeleteComponent from './RulesDeleteComponent';
import RulesInfoActionComponent from './RulesInfoActionComponent';
import RulesInfoComponent from './RulesInfoComponent';
import RulesMultipleDeleteCompoent from './RulesMultipleDeleteCompoent';
import RulesSearchActionComponent from './RulesSearchActionComponent';
import RulesSearchComponent from './RulesSearchComponent';
import RulesUtil from './RulesUtil';

/**
 * RulesComponent
 */
class RulesComponent extends ParentComponent<void> {
    private viewModel: RulesViewModel;
    private balloon: BalloonViewModel;
    private deleteViewModel: RulesDeleteViewModel;
    private infoViewModel: RulesInfoViewModel;
    private searchViewModel: RulesSearchViewModel;

    constructor() {
        super();
        this.viewModel = <RulesViewModel> factory.get('RulesViewModel');
        this.balloon = <BalloonViewModel> factory.get('BalloonViewModel');
        this.deleteViewModel = <RulesDeleteViewModel> factory.get('RulesDeleteViewModel');
        this.infoViewModel = <RulesInfoViewModel> factory.get('RulesInfoViewModel');
        this.searchViewModel = <RulesSearchViewModel> factory.get('RulesSearchViewModel');
    }

    protected async parentInitViewModel(status: ViewModelStatus): Promise<void> {
        await this.viewModel.init(status);
    }

    /**
     * page name
     */
    protected getComponentName(): string { return 'Rule'; }

    /**
     * view
     */
    public view(): m.Child {
        return m(MainLayoutComponent, {
            header: {
                title: 'ルール',
                button: [
                    m('label', {
                        class: 'header-menu-button mdl-button mdl-js-button mdl-button--icon',
                        onclick: (e: Event) => {
                            this.searchViewModel.reset();
                            this.balloon.open(RulesSearchViewModel.id, e);
                        },
                    }, m('i', { class: 'material-icons' }, 'search')),
                ],
            },
            menuContent: [
                {
                    attrs: {
                        onclick: () => {
                            this.balloon.close();
                            this.viewModel.startEditMode();
                        },
                    },
                    text: '編集',
                },
            ],
            content: [
                this.createContent(),
            ],
            scrollStoped: (scrollTop: number) => {
                this.saveHistoryData(scrollTop);
            },
            notMainContent: [
                m(BalloonComponent, {
                    id: RulesDeleteViewModel.id,
                    content: m(RulesDeleteComponent),
                    maxWidth: 340,
                    forceDialog: true,
                }),
                m(BalloonComponent, {
                    id: RulesInfoViewModel.id,
                    content: m(RulesInfoComponent),
                    action: m(RulesInfoActionComponent),
                    maxWidth: 400,
                    verticalOnly: true,
                    forceDialog: window.innerHeight < 600,
                }),
                m(BalloonComponent, {
                    id: RulesSearchViewModel.id,
                    content: m(RulesSearchComponent),
                    action: m(RulesSearchActionComponent),
                    maxWidth: 400,
                    verticalOnly: true,
                    foreBalloon: true,
                }),
                m(BalloonComponent, {
                    id: RulesViewModel.multipleDeleteId,
                    content: m(RulesMultipleDeleteCompoent),
                    maxWidth: 340,
                    forceDialog: true,
                }),
                m(EditHeaderComponent, {
                    title: `${ this.viewModel.getSelectedCnt() } 件選択`,
                    button: [
                        {
                            onclick: () => { this.viewModel.selectAll(); },
                            name: 'select_all',
                        },
                        {
                            onclick: () => {
                                if (this.viewModel.getSelectedCnt() > 0) {
                                    this.balloon.open(RulesViewModel.multipleDeleteId);
                                } else {
                                    this.viewModel.openSnackbar('番組を選択してください。');
                                }
                            },
                            name: 'delete',
                        },
                    ],
                    isShow: () => { return this.viewModel.isEditing(); },
                    close: () => { this.viewModel.endEditMode(); },
                }),
            ],
        });
    }

    /**
     * content
     * @return m.Child
     */
    private createContent(): m.Child {
        return m('div', {
            class: 'rules-content'
                + (this.viewModel.isEditing() ? ' is-editing' : ''),
            onupdate: () => { this.restoreMainLayoutPosition(); },
        }, [
            this.createCardView(),
            this.createTableView(),
            m(PaginationComponent, {
                total: this.viewModel.getRules().total,
                length: this.viewModel.getLimit(),
                page: this.viewModel.getPage(),
            }),
        ]);
    }

    /**
     * create card content
     * @return m.Child[]
     */
    private createCardView(): m.Child[] {
        return this.viewModel.getRules().rules.map((rule) => {
            return m('div', {
                class: 'rule-card mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col',
                onclick: () => {
                    if (!this.viewModel.isEditing()) { return; }

                    // editing
                    this.viewModel.select(rule.id);
                },
                onupdate: (vnode: m.VnodeDOM<void, any>) => {
                    if (this.viewModel.isSelecting(rule.id)) {
                        (<HTMLElement> vnode.dom).classList.add('selected');
                    } else {
                        (<HTMLElement> vnode.dom).classList.remove('selected');
                    }
                },
            }, [
                m('div', {
                    class: 'mdl-card__supporting-text',
                    onclick: (e: Event) => {
                        if (this.viewModel.isEditing()) { return; }

                        // toggle
                        if ((<HTMLElement> e.target).className.indexOf('mdl-card__supporting-text') === -1) { return; }

                        this.infoViewModel.set(rule);
                        this.balloon.open(RulesInfoViewModel.id, e);
                    },
                }, [
                    // text
                    m('div', { class: 'title' }, rule.keyword),

                    // toogle
                    this.createToggle(rule),
                ]),
            ]);
        });
    }

    /**
     * create toggle
     * @return m.Chid
     */
    private createToggle(rule: apid.Rule): m.Child {
        return m('label', {
            class: 'mdl-switch mdl-js-switch mdl-js-ripple-effect',
            onupdate: (vnode: m.VnodeDOM<void, this>) => {
                this.toggleLabelOnUpdate(<HTMLInputElement> vnode.dom, rule.enable);
            },
        }, [
            m('input', {
                type: 'checkbox',
                class: 'mdl-switch__input',
                checked: rule.enable,
                onclick: m.withAttr('checked', (value) => {
                    if (this.viewModel.isEditing()) { return; }

                    if (value) {
                        this.viewModel.enable(rule);
                    } else {
                        this.viewModel.disable(rule);
                    }
                }),
            }),
            m('span', { class: 'mdl-switch__label' }),
        ]);
    }

    /**
     * create chanel name
     * @param rule: Rule
     * @return string
     */
    private createChannelName(rule: apid.Rule): string {
        if (typeof rule.station === 'undefined') { return RulesUtil.createBroadcastStr(rule); }

        return this.viewModel.getChannelName(rule.station);
    }

    /**
     * create table content
     * @param rule: Rule
     * @return m.Child
     */
    private createTableView(): m.Child {
        return m('table', {
            class: 'mdl-data-table mdl-js-data-table mdl-shadow--2dp',
            style: this.viewModel.getRules().rules.length === 0 ? 'display: none;' : '',
        }, [
            m('thead', m('tr', [
                m('th', { class: RulesComponent.nonNumeric }, ''), // toggle
                m('th', { class: RulesComponent.nonNumeric }, 'キーワード'),
                m('th', { class: RulesComponent.nonNumeric }, '除外キーワード'),
                m('th', { class: RulesComponent.nonNumeric }, 'オプション'),
                m('th', { class: RulesComponent.nonNumeric }, '放送局'),
                m('th', { class: RulesComponent.nonNumeric }, 'ジャンル'),
                m('th', { class: RulesComponent.nonNumeric }, 'サブジャンル'),
                m('th', { class: RulesComponent.nonNumeric }, '時刻'),
                m('th', { class: RulesComponent.nonNumeric }, '曜日'),
                m('th', { class: RulesComponent.nonNumeric }, '予約数'),
                m('th', { class: RulesComponent.nonNumeric }, ''), // option
            ])),

            m('tbody', this.viewModel.getRules().rules.map((rule) => {
                return m('tr', {
                    onclick: () => {
                        if (!this.viewModel.isEditing()) { return; }

                        // editing
                        this.viewModel.select(rule.id);
                    },
                    onupdate: (vnode: m.VnodeDOM<void, any>) => {
                        if (this.viewModel.isSelecting(rule.id)) {
                            (<HTMLElement> vnode.dom).classList.add('selected');
                        } else {
                            (<HTMLElement> vnode.dom).classList.remove('selected');
                        }
                    },
                }, [
                    m('td', { class: 'toggle' }, m('div', { class: 'toggle-container' }, this.createToggle(rule))),
                    m('td', { class: RulesComponent.nonNumeric + ' keyword' }, RulesUtil.createKeywordStr(rule)),
                    m('td', { class: RulesComponent.nonNumeric + ' ignore-keyword' }, RulesUtil.createIgnoreKeywordStr(rule)),
                    m('td', { class: RulesComponent.nonNumeric + ' search-option' }, m('div', [
                        m('div', RulesUtil.createOptionStr(rule)),
                        m('div', RulesUtil.createIgnoreOptionStr(rule)),
                    ])),
                    m('td', { class: RulesComponent.nonNumeric + ' channel' }, this.createChannelName(rule)),
                    m('td', { class: RulesComponent.nonNumeric + ' genre1' }, RulesUtil.createGenre1(rule)),
                    m('td', { class: RulesComponent.nonNumeric + ' genre2' }, RulesUtil.createGenre2(rule)),
                    m('td', { class: RulesComponent.nonNumeric + ' time' }, RulesUtil.createTimStr(rule)),
                    m('td', { class: RulesComponent.nonNumeric + ' dow' }, RulesUtil.createDowStr(rule)),
                    m('td', { class: RulesComponent.nonNumeric + ' reservation' }, this.viewModel.getRuleReservesCount(rule.id)),
                    this.createTableOption(rule),
                ]);
            })),
        ]);
    }

    /**
     * create table option
     * @param rule: Rule
     * @return m.Child
     */
    private createTableOption(rule: apid.Rule): m.Child {
        return m('td', { class: RulesComponent.nonNumeric + ' option' }, [
            m('div', { class: 'option-container' }, [
                // list recorded
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--icon',
                    onclick: () => {
                        if (this.viewModel.isEditing()) { return; }

                        Util.move('/recorded', { rule: rule.id });
                    },
                },
                    m('i', { class: 'material-icons' }, 'list'),
                ),
                // edit rule
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--icon',
                    onclick: () => {
                        if (this.viewModel.isEditing()) { return; }

                        Util.move('/search', { rule: rule.id });
                    },
                },
                    m('i', { class: 'material-icons' }, 'mode_edit'),
                ),
                // delete
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--icon',
                    onclick: (e: Event) => {
                        if (this.viewModel.isEditing()) { return; }

                        this.deleteViewModel.set(rule);
                        this.balloon.open(RulesDeleteViewModel.id, e);
                    },
                },
                    m('i', { class: 'material-icons' }, 'delete'),
                ),
            ]),
        ]);
    }
}

namespace RulesComponent {
    export const nonNumeric = 'mdl-data-table__cell--non-numeric';
}

export default RulesComponent;

