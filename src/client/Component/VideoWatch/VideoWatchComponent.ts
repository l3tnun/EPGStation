import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import DateUtil from '../../Util/DateUtil';
import StreamInfoViewModel from '../../ViewModel/Stream/StreamInfoViewModel';
import VideoWatchViewModel from '../../ViewModel/VideoWatch/VideoWatchViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import MainLayoutComponent from '../MainLayoutComponent';
import ParentComponent from '../ParentComponent';
import VideoContainerComponent from '../Video/VideoContainerComponent';

/**
 * VideoWatchComponent
 */
class VideoWatchComponent extends ParentComponent<void> {
    private viewModel: VideoWatchViewModel;
    private streamInfo: StreamInfoViewModel;

    constructor() {
        super();

        this.viewModel = <VideoWatchViewModel> factory.get('VideoWatchViewModel');
        this.streamInfo = <StreamInfoViewModel> factory.get('StreamInfoViewModel');
    }

    protected async parentInitViewModel(status: ViewModelStatus = 'init'): Promise<void> {
        await this.viewModel.init(status);
    }

    /**
     * page name
     */
    protected getComponentName(): string { return 'VideoWatchComponent'; }

    /**
     * view
     */
    public view(): m.Children {
        return m(MainLayoutComponent, {
            header: {
                title: '再生',
            },
            content: [
                this.createContent(),
            ],
        });
    }

    /**
     * content
     * @return m.Child
     */
    private createContent(): m.Child {
        return m('div', {
            class: 'recorded-watch',
        }, [
            m('div', { class: 'video-parent' }, [
                this.createVideoContainer(),
            ]),
            this.createInfo(),
        ]);
    }

    /**
     * create video container
     * @return m.Child | null
     */
    private createVideoContainer(): m.Child | null {
        return m(VideoContainerComponent, {
            video: this.createVideo(),
            isLiveStreaming: this.viewModel.getRecorded() === null,
        });
    }

    /**
     * create info
     * @return m.Child | null
     */
    private createInfo(): m.Child | null {
        let content: m.Child[] | null = null;

        if (this.viewModel.getRecorded() !== null) {
            content = this.createRecordedInfo();
        }

        if (this.viewModel.getChannelId() !== null) {
            content = this.createStreamInfo();
        }

        if (content === null) { return null; }

        return m('div', { class: 'recorded-info' }, [
            m('div', {
                class: 'mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col',
                onclick: () => {
                    if (this.viewModel.getRecorded() !== null) { return; }
                    this.streamInfo.updateInfos();
                },
            }, [
                m('div', { class: 'mdl-card__supporting-text' }, [
                    content,
                ]),
            ]),
        ]);
    }

    /**
     * create recorded info
     * @return m.Child[] | null
     */
    private createRecordedInfo(): m.Child[] | null {
        const recorded = this.viewModel.getRecorded();
        if (recorded === null) {
            return null;
        }

        return [
            m('div', { class: 'title' }, recorded.name),
            m('div', { class: 'time' }, this.createTimeStr(recorded.startAt, recorded.startAt)),
            m('div', { class: 'name' }, this.viewModel.getChannelName(recorded.channelId)),
            m('div', { class: 'description' }, recorded.description),
        ];
    }

    /**
     * create recorded time
     * @param startAt: apid.UnixtimeMS
     * @param endAt: apid.UnixtimeMS
     */
    private createTimeStr(startAt: apid.UnixtimeMS, endAt: apid.UnixtimeMS): m.Child {
        const start = DateUtil.getJaDate(new Date(startAt));
        const end = DateUtil.getJaDate(new Date(endAt));
        const duration = Math.floor((endAt - startAt) / 1000 / 60);

        return DateUtil.format(start, 'MM/dd(w) hh:mm:ss') + ' ~ ' + DateUtil.format(end, 'hh:mm:ss') + ` (${ duration }分)`;
    }

    /**
     * create stream info
     * @return m.Child[] | null
     */
    private createStreamInfo(): m.Child[] | null {
        const info = this.viewModel.getInfo();
        if (info === null) { return null; }

        return [
            m('div', { class: 'title' }, info.channelName),
            m('div', { class: 'time' }, this.createTimeStr(info.startAt!, info.endAt!)),
            m('div', { class: 'name' }, info.title),
            m('div', { class: 'description' }, info.description),
        ];
    }

    /**
     * create video
     * @return m.Child
     */
    private createVideo(): m.Child | null {
        return m('video', {
            oncreate: (vnode: m.VnodeDOM<void, this>) => {
                // set src
                const src = this.viewModel.getSrc();
                (<HTMLVideoElement> vnode.dom).src = src;

                // 再生
                try {
                    (<HTMLVideoElement> vnode.dom).load();
                    (<HTMLVideoElement> vnode.dom).play()
                    .catch((err) => {
                        console.error(err);
                    });
                } catch (err) {
                    console.error(err);
                }
            },
            onremove: (vnode: m.VnodeDOM<void, this>) => {
                try {
                    (<HTMLVideoElement> vnode.dom).pause();
                    (<HTMLVideoElement> vnode.dom).src = '';
                    (<HTMLVideoElement> vnode.dom).load();
                } catch (err) {
                    console.error(err);
                }
            },
        });
    }
}

export default VideoWatchComponent;

