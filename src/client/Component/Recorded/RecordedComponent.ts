import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import Util from '../../Util/Util';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import RecordedCleanupViewModel from '../../ViewModel/Recorded/RecordedCleanupViewModel';
import RecordedInfoViewModel from '../../ViewModel/Recorded/RecordedInfoViewModel';
import RecordedMenuViewModel from '../../ViewModel/Recorded/RecordedMenuViewModel';
import RecordedPlayerViewModel from '../../ViewModel/Recorded/RecordedPlayerViewModel';
import RecordedSearchViewModel from '../../ViewModel/Recorded/RecordedSearchViewModel';
import RecordedSettingViewModel from '../../ViewModel/Recorded/RecordedSettingViewModel';
import RecordedViewModel from '../../ViewModel/Recorded/RecordedViewModel';
import RecordedWatchSelectViewModel from '../../ViewModel/Recorded/RecordedWatchSelectViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import { BalloonComponent } from '../BalloonComponent';
import EditHeaderComponent from '../EditHeaderComponent';
import MainLayoutComponent from '../MainLayoutComponent';
import PaginationComponent from '../PaginationComponent';
import ParentComponent from '../ParentComponent';
import TabComponent from '../TabComponent';
import RecordedCheckCleanupCheckBalloonComponent from './RecordedCheckCleanupCheckBalloonComponent';
import RecordedCleanupBalloonComponent from './RecordedCleanupBalloonComponent';
import RecordedDeleteComponent from './RecordedDeleteComponent';
import RecordedEncodeComponent from './RecordedEncodeComponent';
import RecordedErrorLogComponent from './RecordedErrorLogComponent';
import RecordedInfoComponent from './RecordedInfoComponent';
import RecordedMenuComponent from './RecordedMenuComponent';
import RecordedMultipleDeleteCompoent from './RecordedMultipleDeleteCompoent';
import RecordedPlayerComponent from './RecordedPlayerComponent';
import RecordedSearchActionComponent from './RecordedSearchActionComponent';
import RecordedSearchComponent from './RecordedSearchComponent';
import RecordedSettingComponent from './RecordedSettingComponent';
import RecordedWatchSelectComponent from './RecordedWatchSelectComponent';

/**
 * RecordedComponent
 */
class RecordedComponent extends ParentComponent<void> {
    private viewModel: RecordedViewModel;
    private infoViewModel: RecordedInfoViewModel;
    private menuViewModel: RecordedMenuViewModel;
    private searchViewModel: RecordedSearchViewModel;
    private recordedSettingViewModel: RecordedSettingViewModel;
    private balloon: BalloonViewModel;

    constructor() {
        super();
        this.viewModel = <RecordedViewModel> factory.get('RecordedViewModel');
        this.infoViewModel = <RecordedInfoViewModel> factory.get('RecordedInfoViewModel');
        this.menuViewModel = <RecordedMenuViewModel> factory.get('RecordedMenuViewModel');
        this.searchViewModel = <RecordedSearchViewModel> factory.get('RecordedSearchViewModel');
        this.recordedSettingViewModel = <RecordedSettingViewModel> factory.get('RecordedSettingViewModel');
        this.balloon = <BalloonViewModel> factory.get('BalloonViewModel');
    }

    protected async parentInitViewModel(status: ViewModelStatus): Promise<void> {
        await this.viewModel.init(status);

        if (status !== 'init') {
            this.infoViewModel.update();
        }
    }

    /**
     * page name
     */
    protected getComponentName(): string { return 'Recorded'; }

    /**
     * view
     */
    public view(): m.Child {
        return m(MainLayoutComponent, {
            header: {
                title: '録画済み',
                button: [
                    m('label', {
                        class: 'header-menu-button mdl-button mdl-js-button mdl-button--icon',
                        onclick: (e: Event) => {
                            this.searchViewModel.reset();
                            this.balloon.open(RecordedSearchViewModel.id, e);
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
                {
                    attrs: {
                        onclick: async() => {
                            this.balloon.close();
                            await Util.sleep(200);
                            this.balloon.open(RecordedCleanupViewModel.cleanupCheckId);
                        },
                    },
                    text: 'クリーンアップ',
                },
                {
                    attrs: {
                        style: Util.uaIsMobile() ? 'display: none;' : '',
                        onclick: async() => {
                            this.balloon.close();
                            await Util.sleep(200);
                            Util.move('/recorded/upload');
                        },
                    },
                    text: 'アップロード',
                },
                {
                    attrs: {
                        onclick: () => {
                            this.balloon.close();
                            window.setTimeout(() => {
                                this.recordedSettingViewModel.setTemp();
                                this.balloon.open(RecordedSettingViewModel.id);
                            }, 200);
                        },
                    },
                    text: '設定',
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
                    id: RecordedCleanupViewModel.cleanupCheckId,
                    content: m(RecordedCheckCleanupCheckBalloonComponent),
                    maxWidth: 300,
                    forceDialog: true,
                }),
                m(BalloonComponent, {
                    id: RecordedCleanupViewModel.cleanupId,
                    content: m(RecordedCleanupBalloonComponent),
                    maxWidth: 300,
                    maxHeight: 300,
                    forceDialog: true,
                    forceModal: true,
                }),
                m(BalloonComponent, {
                    id: RecordedInfoViewModel.id,
                    head: m(TabComponent, {
                        id: RecordedInfoViewModel.tabId,
                        tabs: this.infoViewModel.getTabTitles(),
                        contentId: RecordedInfoViewModel.contentId,
                    }),
                    content: m(RecordedInfoComponent),
                    maxWidth: 400,
                    maxHeight: 480,
                    dialogMaxWidth: RecordedComponent.cardWidth * 2 - 1,
                    forceDialog: Util.uaIsiOS(),
                }),
                m(BalloonComponent, {
                    id: RecordedInfoViewModel.errorLogId,
                    content: m(RecordedErrorLogComponent),
                    maxWidth: 620,
                    forceDialog: true,
                    forceOverflowXAuto: true,
                }),
                m(BalloonComponent, {
                    id: RecordedWatchSelectViewModel.id,
                    content: m(RecordedWatchSelectComponent),
                    maxWidth: 400,
                    forceDialog: true,
                }),
                m(BalloonComponent, {
                    id: RecordedMenuViewModel.id,
                    content: m(RecordedMenuComponent),
                    maxWidth: 106,
                    horizontalOnly: true,
                }),
                m(BalloonComponent, {
                    id: RecordedMenuViewModel.deleteId,
                    content: m(RecordedDeleteComponent),
                    maxWidth: 300,
                    forceDialog: true,
                }),
                m(BalloonComponent, {
                    id: RecordedMenuViewModel.encodeId,
                    content: m(RecordedEncodeComponent),
                    maxWidth: 350,
                    forceDialog: Util.uaIsAndroid(),
                }),
                m(BalloonComponent, {
                    id: RecordedPlayerViewModel.id,
                    content: m(RecordedPlayerComponent),
                    maxWidth: RecordedPlayerViewModel.maxWidth,
                    dialogMargin: 0,
                    forceDialog: true,
                }),
                m(BalloonComponent, {
                    id: RecordedSearchViewModel.id,
                    content: m(RecordedSearchComponent),
                    action: m(RecordedSearchActionComponent),
                    maxWidth: 400,
                    verticalOnly: true,
                    foreBalloon: true,
                }),
                m(BalloonComponent, {
                    id: RecordedViewModel.multipleDeleteId,
                    content: m(RecordedMultipleDeleteCompoent),
                    maxWidth: 300,
                    forceDialog: true,
                }),
                m(BalloonComponent, {
                    id: RecordedSettingViewModel.id,
                    content: m(RecordedSettingComponent),
                    maxWidth: 310,
                }),
                m(EditHeaderComponent, {
                    title: `${ this.viewModel.getSelectedCnt() } 件選択 (${ Util.getFileSizeStr(this.viewModel.getSelectedTotleFileSize()) })`,
                    button: [
                        {
                            onclick: () => { this.viewModel.selectAll(); },
                            name: 'select_all',
                        },
                        {
                            onclick: () => {
                                if (this.viewModel.getSelectedCnt() > 0) {
                                    this.balloon.open(RecordedViewModel.multipleDeleteId);
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
        const isEditing = this.viewModel.isEditing();

        return m('div', {
            class: 'recorded-content'
                + (isEditing ? ' is-editing' : '')
                + (this.viewModel.isEnabledListMode() ? ' is-list-view' : ''),
            oncreate: () => {
                this.recordedSettingViewModel.setTemp();
            },
            onupdate: () => {
                this.restoreMainLayoutPosition();
            },
        }, [
            this.createCardView(isEditing),
            this.createListView(),
        ]);
    }

    /**
     * card & grid view
     * @param isEditing: boolean
     * @return m.Child
     */
    private createCardView(isEditing: boolean): m.Child {
        return m('div', { class: 'card' }, [
            this.viewModel.getRecordeds().recorded.map((recorded) => {
                return this.createCard(recorded, isEditing);
            }),
            m(PaginationComponent, {
                total: this.viewModel.getRecordeds().total,
                length: this.viewModel.getLimit(),
                page: this.viewModel.getPage(),
            }),
        ]);
    }

    /**
     * card
     * @param recorded: apid.RecordedProgram
     * @param isEditing: boolean
     * @return m.Child
     */
    private createCard(recorded: apid.RecordedProgram, isEditing: boolean): m.Child {
        return m('div', {
            class: 'recorded-card mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col',
            onclick: () => {
                if (!this.viewModel.isEditing()) { return; }

                // 選択
                this.viewModel.select(recorded.id);
            },
            onupdate: (vnode: m.VnodeDOM<void, any>) => {
                if (this.viewModel.isSelecting(recorded.id)) {
                    (<HTMLElement> vnode.dom).classList.add('selected');
                } else {
                    (<HTMLElement> vnode.dom).classList.remove('selected');
                }
            },
        }, [
            m('button', {
                class: 'mdl-button mdl-js-button mdl-button--icon',
                onclick: (e: Event) => {
                    if (this.viewModel.isEditing()) { return; }

                    this.menuViewModel.set(recorded);
                    this.balloon.open(RecordedMenuViewModel.id, e);
                },
            }, [
                m('i', { class: 'material-icons' }, 'more_vert'),
            ]),
            m('div', {
                onclick: (e: Event) => {
                    if (this.viewModel.isEditing()) { return; }

                    this.infoViewModel.set(recorded);
                    this.balloon.open(RecordedInfoViewModel.id, e);
                },
            }, [
                m('div', {
                    class: 'thumbnail-container',
                    onclick: (e: Event) => {
                        if (this.viewModel.isEditing()) { return; }

                        // firefox にて pointer-events: none; では img が白くなってしまうため
                        if (Util.uaIsFirefox()) {
                            window.setTimeout(() => {
                                (<HTMLElement> (<HTMLElement> e.target).parentNode).click();
                            }, 10);
                        }
                    },
                }, [
                    m('img', {
                        class: 'thumbnail',
                        src: recorded.hasThumbnail ? `./api/recorded/${ recorded.id }/thumbnail` : './img/noimg.png',
                        onerror: (e: Event) => { (<HTMLImageElement> e.target).src = './img/noimg.png'; },
                    }),
                ]),
                m('div', { class: 'text-container' }, [
                    m('div', { class: 'title' }, recorded.name),
                    m('div', { class: 'channel' }, this.viewModel.getChannelName(recorded.channelId)),
                    m('div', { class: 'time' }, this.viewModel.getTimeStr(recorded)),
                    this.getDescription(recorded, isEditing),
                ]),
            ]),
        ]);
    }

    /**
     * 番組概要 編集中はファイルサイズを返す
     * @param recorded: apid.RecordedProgram
     * @param isEditing: boolean
     * @return m.Child
     */
    private getDescription(recorded: apid.RecordedProgram, isEditing: boolean): m.Child {
        let child: m.Child[] | string | undefined;
        if (!isEditing) {
           child = recorded.description;
        } else {
            child = [];
            if (typeof recorded.dropCnt !== 'undefined') {
                child.push(m('span', {
                    class: 'cnt' + (
                        (recorded.dropCnt !== 0 || recorded.errorCnt !== 0 || recorded.scramblingCnt !== 0)
                        ? ' cnt-error'
                        : ''
                    ),
                }, `${ recorded.dropCnt }/${ recorded.errorCnt }/${ recorded.scramblingCnt }`));
            }
            child.push(m('span', Util.getFileSizeStr(this.viewModel.getFileSize(recorded))));
        }

        return m('div', { class: 'description' }, child);
    }

    /**
     * list view
     * @return m.Child | null
     */
    private createListView(): m.Child | null {
        const recordeds = this.viewModel.getRecordeds().recorded;
        if (recordeds.length === 0) { return null; }

        return m('div', { class: 'list' }, [
            m('table', { class: 'mdl-data-table mdl-js-data-table mdl-shadow--2dp' }, [
                m('thead', m('tr', [
                    m('th', { class: RecordedComponent.nonNumeric }, 'タイトル'),
                    m('th', { class: RecordedComponent.nonNumeric }, '放送局'),
                    m('th', { class: RecordedComponent.nonNumeric }, '時間'),
                    m('th', { class: RecordedComponent.nonNumeric }, ''), // sub menu button
                ])),

                m('tbody', recordeds.map((recorded) => {
                    return this.createList(recorded);
                })),
            ]),

            m(PaginationComponent, {
                total: this.viewModel.getRecordeds().total,
                length: this.viewModel.getLimit(),
                page: this.viewModel.getPage(),
            }),
        ]);
    }


    /**
     * list
     * @param recorded: apid.RecordedProgram
     * @return m.Child
     */
    private createList(recorded: apid.RecordedProgram): m.Child {
        return m('tr', {
            onclick: (e: Event) => {
                if (this.viewModel.isEditing()) {
                    // 編集モード
                    this.viewModel.select(recorded.id);
                } else {
                    this.infoViewModel.set(recorded);
                    this.balloon.open(RecordedInfoViewModel.id, e);
                }
            },
            onupdate: (vnode: m.VnodeDOM<void, any>) => {
                if (this.viewModel.isSelecting(recorded.id)) {
                    (<HTMLElement> vnode.dom).classList.add('selected');
                } else {
                    (<HTMLElement> vnode.dom).classList.remove('selected');
                }
            },
        }, [
            m('td', { class: RecordedComponent.nonNumeric + ' title' }, recorded.name),
            m('td', { class: RecordedComponent.nonNumeric + ' channel' }, this.viewModel.getChannelName(recorded.channelId)),
            m('td', { class: RecordedComponent.nonNumeric + ' time' }, this.viewModel.getTimeStr(recorded, true)),
            m('td', { class: RecordedComponent.nonNumeric + ' menu' }, [
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--icon',
                    onclick: (e: Event) => {
                        e.stopPropagation();
                        if (this.viewModel.isEditing()) { return; }

                        this.menuViewModel.set(recorded);
                        this.balloon.open(RecordedMenuViewModel.id, e);
                    },
                }, [
                    m('i', { class: 'material-icons' }, 'more_vert'),
                ]),
            ]),
        ]);
    }
}

namespace RecordedComponent {
    export const cardWidth = 308;
    export const widthMargin = 30;
    export const nonNumeric = 'mdl-data-table__cell--non-numeric';
}

export default RecordedComponent;

