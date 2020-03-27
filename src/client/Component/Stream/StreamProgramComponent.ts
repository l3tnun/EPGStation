import * as m from 'mithril';
import { ViewModelStatus } from '../../Enums';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import ProgramInfoViewModel from '../../ViewModel/Program/ProgramInfoViewModel';
import StreamForcedStopViewModel from '../../ViewModel/Stream/StreamForcedStopViewModel';
import StreamLivePlayerViewModel from '../../ViewModel/Stream/StreamLivePlayerViewModel';
import StreamProgramCardsSettingViewModel from '../../ViewModel/Stream/StreamProgramCardsSettingViewModel';
import StreamProgramCardsViewModel from '../../ViewModel/Stream/StreamProgramCardsViewModel';
import StreamSelectViewModel from '../../ViewModel/Stream/StreamSelectViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import { BalloonComponent } from '../BalloonComponent';
import MainLayoutComponent from '../MainLayoutComponent';
import ParentComponent from '../ParentComponent';
import ProgramInfoActionComponent from '../Program/ProgramInfoActionComponent';
import ProgramInfoComponent from '../Program/ProgramInfoComponent';
import StreamLivePlayerComponent from './StreamLivePlayerComponent';
import StreamProgramCardsComponent from './StreamProgramCardsComponent';
import StreamProgramCardsSettingComponent from './StreamProgramCardsSettingComponent';
import StreamProgramTimeComponent from './StreamProgramTimeComponent';
import StreamSelectComponent from './StreamSelectComponent';

/**
 * StreamProgramComponent
 */
class StreamProgramComponent extends ParentComponent<void> {
    private cardsViewModel: StreamProgramCardsViewModel;
    private forcedStop: StreamForcedStopViewModel;
    private cardSettingViewModel: StreamProgramCardsSettingViewModel;
    private balloon: BalloonViewModel;

    constructor() {
        super();
        this.cardsViewModel = <StreamProgramCardsViewModel> factory.get('StreamProgramCardsViewModel');
        this.forcedStop = <StreamForcedStopViewModel> factory.get('StreamForcedStopViewModel');
        this.cardSettingViewModel = <StreamProgramCardsSettingViewModel> factory.get('StreamProgramCardsSettingViewModel');
        this.balloon = <BalloonViewModel> factory.get('BalloonViewModel');
    }

    protected async parentInitViewModel(status: ViewModelStatus): Promise<void> {
        if (status === 'reload' || status === 'updateIo') {
            await this.cardsViewModel.init(status);
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
                            window.setTimeout(() => {
                                this.forcedStop.forcedStopAll();
                            }, 200);
                        },
                    },
                    text: '全ての配信を停止',
                },
                {
                    attrs: {
                        onclick: () => {
                            this.balloon.close();
                            window.setTimeout(() => {
                                this.cardSettingViewModel.resetTmp();
                                this.balloon.open(StreamProgramCardsSettingViewModel.id);
                            }, 200);
                        },
                    },
                    text: '設定',
                },
            ],
            notMainContent: [
                m(StreamProgramCardsComponent, {
                    scrollStoped: (scroll: number, tab: number) => {
                        this.saveHistoryData({ scroll: scroll, tab: tab });
                    },
                    isNeedRestorePosition: () => {
                        return this.isNeedRestorePosition;
                    },
                    resetRestorePositionFlag: () => {
                        this.isNeedRestorePosition = false;
                    },
                    getPosition: () => {
                        return <{ scroll: number; tab: number } | null> this.getHistoryData();
                    },
                }),
                m(BalloonComponent, {
                    id: StreamSelectViewModel.id,
                    content: m(StreamSelectComponent),
                    maxWidth: 400,
                    forceDialog: window.innerHeight < 480,
                }),
                m(BalloonComponent, {
                    id: ProgramInfoViewModel.id,
                    content: m(ProgramInfoComponent),
                    action: m(ProgramInfoActionComponent),
                    maxWidth: 500,
                    maxHeight: 450,
                    dialogMaxWidth: 600,
                }),
                m(BalloonComponent, {
                    id: StreamLivePlayerViewModel.id,
                    content: m(StreamLivePlayerComponent),
                    maxWidth: StreamLivePlayerViewModel.maxWidth,
                    dialogMargin: 0,
                    forceDialog: true,
                }),
                m(BalloonComponent, {
                    id: StreamProgramCardsSettingViewModel.id,
                    content: m(StreamProgramCardsSettingComponent),
                    maxWidth: 310,
                }),
                m(StreamProgramTimeComponent),
            ],
        });
    }
}

export default StreamProgramComponent;

