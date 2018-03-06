import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import RecordedInfoViewModel from '../../ViewModel/Recorded/RecordedInfoViewModel';
import RecordedMenuViewModel from '../../ViewModel/Recorded/RecordedMenuViewModel';
import RecordedSearchViewModel from '../../ViewModel/Recorded/RecordedSearchViewModel';
import RecordedViewModel from '../../ViewModel/Recorded/RecordedViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import { BalloonComponent } from '../BalloonComponent';
import MainLayoutComponent from '../MainLayoutComponent';
import PaginationComponent from '../PaginationComponent';
import ParentComponent from '../ParentComponent';
import TabComponent from '../TabComponent';
import RecordedDeleteComponent from './RecordedDeleteComponent';
import RecordedEncodeComponent from './RecordedEncodeComponent';
import RecordedInfoComponent from './RecordedInfoComponent';
import RecordedMenuComponent from './RecordedMenuComponent';
import RecordedSearchActionComponent from './RecordedSearchActionComponent';
import RecordedSearchComponent from './RecordedSearchComponent';

/**
 * RecordedComponent
 */
class RecordedComponent extends ParentComponent<void> {
    private viewModel: RecordedViewModel;
    private infoViewModel: RecordedInfoViewModel;
    private menuViewModel: RecordedMenuViewModel;
    private searchViewModel: RecordedSearchViewModel;
    private balloon: BalloonViewModel;
    private resizeListener = (() => { setTimeout(() => { this.resize(); }, 100); }).bind(this);
    private resizeElement: HTMLElement | null = null;

    constructor() {
        super();
        this.viewModel = <RecordedViewModel> factory.get('RecordedViewModel');
        this.infoViewModel = <RecordedInfoViewModel> factory.get('RecordedInfoViewModel');
        this.menuViewModel = <RecordedMenuViewModel> factory.get('RecordedMenuViewModel');
        this.searchViewModel = <RecordedSearchViewModel> factory.get('RecordedSearchViewModel');
        this.balloon = <BalloonViewModel> factory.get('BalloonViewModel');
    }

    protected initViewModel(status: ViewModelStatus = 'init'): void {
        super.initViewModel(status);
        this.viewModel.init(status)
        .then(() => {
            this.setRestorePositionFlag(status);
        })
        .then(() => {
            if (status !== 'init') {
                this.infoViewModel.update();
            }
        });
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
            content: [
                this.createContent(),
            ],
            scrollStoped: (scrollTop: number) => {
                this.saveHistoryData(scrollTop);
            },
            notMainContent: [
                m(BalloonComponent, {
                    id: RecordedInfoViewModel.id,
                    head: m(TabComponent, { tabs: this.infoViewModel.getTabTitles(), contentId: 'recorded-info-content' }),
                    content: m(RecordedInfoComponent),
                    maxWidth: 400,
                    maxHeight: 480,
                    dialogMaxWidth: RecordedComponent.cardWidth * 2 - 1,
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
                }),
                m(BalloonComponent, {
                    id: RecordedSearchViewModel.id,
                    content: m(RecordedSearchComponent),
                    action: m(RecordedSearchActionComponent),
                    maxWidth: 400,
                    verticalOnly: true,
                    foreBalloon: true,
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
            class: 'recorded-content',
            oncreate: (vnode: m.VnodeDOM<void, this>) => {
                this.resizeElement = <HTMLElement> (vnode.dom);
                window.addEventListener('resize', this.resizeListener, false);
            },
            onupdate: () => {
                this.resize();
                this.restoreMainLayoutPosition();
            },
            onremove: () => {
                window.removeEventListener('resize', this.resizeListener, false);
            },
        }, [
            this.viewModel.getRecorded().recorded.map((recorded) => {
                return this.createCard(recorded);
            }),
            m(PaginationComponent, {
                total: this.viewModel.getRecorded().total,
                length: this.viewModel.getLimit(),
                page: typeof m.route.param('page') === 'undefined' ? 1 : Number(m.route.param('page')),
            }),
        ]);
    }

    /**
     * resize
     */
    private resize(): void {
        if (this.resizeElement === null) { return; }

        if (window.innerWidth <= RecordedComponent.cardWidth * 2 + RecordedComponent.widthMargin) {
            this.resizeElement.style.width = '';

            return;
        }

        const width = Math.floor(window.innerWidth / RecordedComponent.cardWidth) * RecordedComponent.cardWidth || RecordedComponent.cardWidth;

        this.resizeElement.style.width = width + 'px';
    }

    /**
     * card
     * @param recorded: apid.RecordedProgram
     * @return m.Child
     */
    private createCard(recorded: apid.RecordedProgram): m.Child {
        return m('div', { class: 'recorded-card mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col' }, [
            m('button', {
                class: 'mdl-button mdl-js-button mdl-button--icon',
                onclick: (e: Event) => {
                    this.menuViewModel.set(recorded);
                    this.balloon.open(RecordedMenuViewModel.id, e);
                },
            }, [
                m('i', { class: 'material-icons' }, 'more_vert'),
            ]),
            m('div', {
                onclick: (e: Event) => {
                    this.infoViewModel.set(recorded);
                    this.balloon.open(RecordedInfoViewModel.id, e);
                },
            }, [
                m('div', { class: 'thumbnail-container' }, [
                    m('img', {
                        class: 'thumbnail',
                        src: recorded.hasThumbnail ? `/api/recorded/${ recorded.id }/thumbnail` : '/img/noimg.png',
                        onerror: (e: Event) => { (<HTMLImageElement> e.target).src = '/img/noimg.png'; },
                    }),
                ]),
                m('div', { class: 'text-container' }, [
                    m('div', { class: 'title' }, recorded.name),
                    m('div', { class: 'channel' }, this.viewModel.getChannelName(recorded.channelId)),
                    m('div', { class: 'time' }, this.viewModel.getTimeStr(recorded)),
                    m('div', { class: 'description' }, recorded.description),
                ]),
            ]),
        ]);
    }
}

namespace RecordedComponent {
    export const cardWidth = 308;
    export const widthMargin = 30;
}

export default RecordedComponent;

