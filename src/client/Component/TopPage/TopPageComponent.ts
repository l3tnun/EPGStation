import * as m from 'mithril';
import ParentComponent from '../ParentComponent';
import { ViewModelStatus } from '../../Enums';
import MainLayoutComponent from '../MainLayoutComponent';
import factory from '../../ViewModel/ViewModelFactory';
import * as apid from '../../../../api';
import RecordedViewModel from '../../ViewModel/Recorded/RecordedViewModel';
import { BalloonComponent } from '../BalloonComponent';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import RecordedInfoComponent from '../Recorded/RecordedInfoComponent';
import RecordedInfoViewModel from '../../ViewModel/Recorded/RecordedInfoViewModel';
import RecordedMenuViewModel from '../../ViewModel/Recorded/RecordedMenuViewModel';
import RecordedMenuComponent from '../Recorded/RecordedMenuComponent';
import RecordedDeleteComponent from '../Recorded/RecordedDeleteComponent';
import TabComponent from '../TabComponent';

/**
* TopPageComponent
*/
class TopPageComponent extends ParentComponent<void> {
    private recordedViewModel: RecordedViewModel;
    private recordedMenuViewModel: RecordedMenuViewModel;
    private recordedInfoViewModel: RecordedInfoViewModel;
    private balloon: BalloonViewModel;

    constructor() {
        super();
        this.recordedViewModel = <RecordedViewModel>(factory.get('RecordedViewModel'));
        this.recordedMenuViewModel = <RecordedMenuViewModel>(factory.get('RecordedMenuViewModel'));
        this.recordedInfoViewModel = <RecordedInfoViewModel>(factory.get('RecordedInfoViewModel'));
        this.balloon = <BalloonViewModel>(factory.get('BalloonViewModel'));
    }

    protected initViewModel(status: ViewModelStatus = 'init'): void {
        super.initViewModel(status);
        this.recordedViewModel.init(status);
        this.recordedMenuViewModel = <RecordedMenuViewModel>(factory.get('RecordedMenuViewModel'));
    }

    /**
    * page name
    */
    protected getComponentName(): string { return 'TopPage'; }

    /**
    * view
    */
    public view(): m.Children {
        return m(MainLayoutComponent, {
            header: { title: 'EPGStation' },
            content: [
                this.createContent(),
            ],
            notMainContent: [
                m(BalloonComponent, {
                    id: RecordedInfoViewModel.id,
                    head: m(TabComponent, { tabs: this.recordedInfoViewModel.getTabTitles(), contentId: 'recorded-info-content' }),
                    content: m(RecordedInfoComponent),
                    maxWidth: 400,
                    maxHeight: 480,
                    dialogMaxWidth: 600,
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
            ],
        });
    }

    /**
    * main content
    * @return m.Child
    */
    private createContent(): m.Child {
        return m('div', { class: 'top-page' }, [
            this.createRecorded(),
            this.createReserves(),
        ]);
    }

    /**
    * recorded content
    * @return m.Child
    */
    private createRecorded(): m.Child {
        return m('div', { class: 'recorded mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col' }, [
            m('div', { class: 'parent-title' }, '録画済み'),

            this.recordedViewModel.getRecorded().recorded.map((recorded) => {
                return this.createRecordedCard(recorded);
            }),
        ]);
    }

    /**
    * recorded card
    * @param recorded: apid.RecordedProgram
    * @return m.Child
    */
    private createRecordedCard(recorded: apid.RecordedProgram): m.Child {
        return m('div', { class: 'recorded-card mdl-card mdl-cell mdl-cell--12-col' }, [
            m('button', {
                class: 'mdl-button mdl-js-button mdl-button--icon',
                onclick: (e: Event) => {
                    this.recordedMenuViewModel.set(recorded);
                    this.balloon.open(RecordedMenuViewModel.id, e);
                }
            }, [
                m('i', { class: 'material-icons' }, 'more_vert' ),
            ]),
            m('div', {
                onclick: (e: Event) => {
                    this.recordedInfoViewModel.set(recorded);
                    this.balloon.open(RecordedInfoViewModel.id, e);
                }
            }, [
                m('div', { class: 'thumbnail-container' }, [
                    m('img', {
                        class: 'thumbnail',
                        src: recorded.hasThumbnail ? `/thumbnail/${ recorded.id }.jpg` : '/img/noimg.png',
                        onerror: (e: Event) => { (<HTMLImageElement>e.target).src = '/img/noimg.png'; },
                    }),
                ]),
                m('div', { class: 'text-container' }, [
                    m('div', { class: 'title' }, recorded.name ),
                    m('div', { class: 'channel' }, this.recordedViewModel.getChannelName(recorded.channelId)),
                    m('div', { class: 'time' }, this.recordedViewModel.getTimeStr(recorded) ),
                    m('div', { class: 'description' }, recorded.description ),
                ]),
            ]),
        ]);
    }

    /**
    * reserves content
    * @return m.Child
    */
    private createReserves(): m.Child {
        return m('div', { class: 'reserves mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col' }, [
            m('div', { class: 'parent-title' }, '予約'),
        ]);
    }
}

export default TopPageComponent;

