import * as m from 'mithril';
import ParentComponent from '../ParentComponent';
import { ViewModelStatus } from '../../Enums';
import MainLayoutComponent from '../MainLayoutComponent';
import StreamProgramCardsComponent from './StreamProgramCardsComponent';
import factory from '../../ViewModel/ViewModelFactory';
import StreamProgramCardsViewModel from '../../ViewModel/Stream/StreamProgramCardsViewModel';
import { BalloonComponent } from '../BalloonComponent';
import StreamSelectComponent from './StreamSelectComponent';
import StreamSelectViewModel from '../../ViewModel/Stream/StreamSelectViewModel'
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import StreamForcedStopViewModel from '../../ViewModel/Stream/StreamForcedStopViewModel';
import StreamProgramTimeComponent from './StreamProgramTimeComponent';

/**
* StreamProgramComponent
*/
class StreamProgramComponent extends ParentComponent<void> {
    private cardsViewModel: StreamProgramCardsViewModel;
    private forcedStop: StreamForcedStopViewModel;
    private balloon: BalloonViewModel;

    constructor() {
        super();
        this.cardsViewModel = <StreamProgramCardsViewModel>(factory.get('StreamProgramCardsViewModel'));
        this.forcedStop = <StreamForcedStopViewModel>(factory.get('StreamForcedStopViewModel'));
        this.balloon = <BalloonViewModel>(factory.get('BalloonViewModel'));
    }

    protected initViewModel(status: ViewModelStatus = 'init'): void {
        super.initViewModel(status);

        if(status === 'reload' || status === 'updateIo') {
            this.cardsViewModel.init(status);
        }
    }

    /**
    * page name
    */
    protected getComponentName(): string { return 'StreamPrograms'; }

    /**
    * view
    */
    public view(): m.Child {
        return m(MainLayoutComponent, {
            header: { title: 'ライブ' },
            menuContent:[
                { attrs: {
                    onclick: () => {
                        this.balloon.close();
                        setTimeout(() => {
                            this.forcedStop.forcedStopAll();
                        }, 200);
                    }
                }, text: '全ての配信を停止' }
            ],
            notMainContent: [
                m(StreamProgramCardsComponent),
                m(BalloonComponent, {
                    id: StreamSelectViewModel.id,
                    content: m(StreamSelectComponent),
                    maxWidth: 400,
                    forceDialog: window.innerHeight < 480,
                }),
                m(StreamProgramTimeComponent),
            ],
        });
    }
}

export default StreamProgramComponent;

