import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import DateUtil from '../../Util/DateUtil';
import Util from '../../Util/Util';
import MainLayoutViewModel from '../../ViewModel/MainLayoutViewModel';
import StreamWatchViewModel from '../../ViewModel/Stream/StreamWatchViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import MainLayoutComponent from '../MainLayoutComponent';
import ParentComponent from '../ParentComponent';
import VideoContainerComponent from '../Video/VideoContainerComponent';
import StreamWatchVideoComponent from './StreamWatchVideoComponent';

/**
 * StreamWatchComponent
 */
class StreamWatchComponent extends ParentComponent<void> {
    private viewModel: StreamWatchViewModel;
    private mainLayoutViewModel: MainLayoutViewModel;
    private hasInfo: boolean = false;
    private isLive: boolean = false;

    constructor() {
        super();

        this.viewModel = <StreamWatchViewModel> factory.get('StreamWatchViewModel');
        this.mainLayoutViewModel = <MainLayoutViewModel> factory.get('MainLayoutViewModel');
    }

    protected async parentInitViewModel(status: ViewModelStatus): Promise<void> {
        if (status === 'init' || status === 'update') {
            this.hasInfo = false;
        }

        await this.viewModel.init(status);
        await Util.sleep(300);
    }

    /**
     * page name
     */
    protected getComponentName(): string { return 'StreamWatch'; }

    /**
     * view
     */
    public view(): m.Child {
        return m(MainLayoutComponent, {
            header: { title: '視聴' },
            content: [
                m('div', {
                    class: 'stream-video main-layout-animation',
                    onupdate: (vnode: m.VnodeDOM<void, this>) => {
                        (<HTMLElement> vnode.dom).style.opacity = this.mainLayoutViewModel.isShow() ? '1' : '0';
                    },
                }, [
                    this.createStopButton(),
                    m(VideoContainerComponent, {
                        isLiveStreaming: this.isLive,
                        video: m(StreamWatchVideoComponent),
                    }),
                    this.createStreamInfo(),
                ]),
            ],
        });
    }

    /**
     * 配信停止ボタン
     */
    private createStopButton(): m.Child {
        return m('button', {
            class: 'fab-right-bottom mdl-shadow--8dp mdl-button mdl-js-button mdl-button--fab mdl-button--colored',
            onclick: async() => {
                await this.viewModel.stop();
            },
        }, [
            m('i', { class: 'material-icons' }, 'stop'),
        ]);
    }

    /**
     * create stream info
     */
    private createStreamInfo(): m.Child | null {
        const info = this.viewModel.getInfo();
        if (info === null) {
            if (this.hasInfo && this.mainLayoutViewModel.isShow()) {
                // 他の端末でストリームが停止された
                this.hasInfo = false;
                history.back();
            }

            return null;
        }

        this.isLive = typeof info.type !== 'undefined' && info.type.includes('Live');
        this.hasInfo = true;

        return m('div', { class: 'stream-info' }, [
            m('div', { class: 'mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col' }, [
                m('div', { class: 'mdl-card__supporting-text' }, [
                    m('div', { class: 'title' }, this.isLive ? info.channelName : info.title),
                    m('div', { class: 'time' }, this.createTimeStr(info)),
                    m('div', { class: 'name' }, this.isLive ? info.title : info.channelName),
                    m('div', { class: 'description' }, info.description),
                ]),
            ]),
        ]);
    }

    /**
     * create time str
     * @param info: apid.StreamInfo
     * @param string
     */
    private createTimeStr(info: apid.StreamInfo): string {
        if (typeof info.startAt === 'undefined' || typeof info.endAt === 'undefined') { return ''; }
        const start = DateUtil.getJaDate(new Date(info.startAt));
        const end = DateUtil.getJaDate(new Date(info.endAt));
        const duration = Math.floor((info.endAt - info.startAt) / 1000 / 60);

        return DateUtil.format(start, 'MM/dd(w) hh:mm:ss') + ' ~ ' + DateUtil.format(end, 'hh:mm:ss') + ` (${ duration }分)`;
    }
}

export default StreamWatchComponent;

