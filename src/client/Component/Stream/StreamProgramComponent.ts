import * as m from 'mithril';
import { ViewModelStatus } from '../../Enums';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import StreamForcedStopViewModel from '../../ViewModel/Stream/StreamForcedStopViewModel';
import StreamProgramCardsViewModel from '../../ViewModel/Stream/StreamProgramCardsViewModel';
import StreamSelectViewModel from '../../ViewModel/Stream/StreamSelectViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import { BalloonComponent } from '../BalloonComponent';
import MainLayoutComponent from '../MainLayoutComponent';
import ParentComponent from '../ParentComponent';
import StreamProgramCardsComponent from './StreamProgramCardsComponent';
import StreamProgramTimeComponent from './StreamProgramTimeComponent';
import StreamSelectComponent from './StreamSelectComponent';

/**
 * StreamProgramComponent
 */
class StreamProgramComponent extends ParentComponent<void> {
    private cardsViewModel: StreamProgramCardsViewModel;
    private forcedStop: StreamForcedStopViewModel;
    private balloon: BalloonViewModel;

    constructor() {
        super();
        this.cardsViewModel = <StreamProgramCardsViewModel> factory.get('StreamProgramCardsViewModel');
        this.forcedStop = <StreamForcedStopViewModel> factory.get('StreamForcedStopViewModel');
        this.balloon = <BalloonViewModel> factory.get('BalloonViewModel');
    }

    protected initViewModel(status: ViewModelStatus = 'init'): void {
        super.initViewModel(status);

        if (status === 'reload' || status === 'updateIo') {
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
            menuContent: [
                {
                    attrs: {
                        onclick: () => {
                            this.balloon.close();
                            setTimeout(() => {
                                this.forcedStop.forcedStopAll();
                            }, 200);
                        },
                    },
                    text: '全ての配信を停止',
                },
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

