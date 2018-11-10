import * as Hls from 'hls.js';
import * as m from 'mithril';
import Util from '../../Util/Util';
import StreamWatchViewModel from '../../ViewModel/Stream/StreamWatchViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * StreamWatchVideoComponent
 */
class StreamWatchVideoComponent extends Component<void> {
    private viewModel: StreamWatchViewModel;
    private hls: Hls | null = null;
    private videoSrc: string;

    constructor() {
        super();

        this.viewModel = <StreamWatchViewModel> factory.get('StreamWatchViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        if (this.viewModel.isEnable()) {
            return m('video', {
                id: StreamWatchViewModel.videoId,
                oncreate: (vnode: m.VnodeDOM<void, this>) => {
                    if (typeof m.route.param('stream') === 'undefined') { return; }

                    // set source
                    this.videoSrc = this.viewModel.getSource();
                    (<HTMLVideoElement> vnode.dom).src = this.videoSrc;

                    // hls.js
                    this.createHls(<HTMLVideoElement> vnode.dom);
                    if (this.hls !== null) { return; }

                    // 再生
                    try {
                        (<HTMLVideoElement> vnode.dom).load();
                        (<HTMLVideoElement> vnode.dom).play();
                    } catch (err) {
                        console.error(err);
                    }
                },
                onupdate: (vnode: m.VnodeDOM<void, this>) => {
                    if (typeof m.route.param('stream') === 'undefined') { return; }

                    // video src とページの stream のズレを修正
                    if (this.viewModel.getSource() !== this.videoSrc) {
                        this.videoSrc = this.viewModel.getSource();
                        try {
                            (<HTMLVideoElement> vnode.dom).pause();
                        } catch (err) {
                            console.error(err);
                        }
                        try {
                            if (this.hls === null) {
                                (<HTMLVideoElement> vnode.dom).src = this.videoSrc;
                                (<HTMLVideoElement> vnode.dom).load();
                                (<HTMLVideoElement> vnode.dom).play();
                            } else {
                                this.destoryHls();
                                this.createHls(<HTMLVideoElement> vnode.dom);
                            }
                        } catch (err) {
                            console.error(err);
                        }
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

                    this.destoryHls();
                },
            });
        } else {
            // 視聴可能になるまで待機中
            return m('div', { class: 'video-player-background' });
        }
    }

    /**
     * create hls
     */
    private createHls(element: HTMLVideoElement): void {
        if (!Hls.isSupported() || Util.uaIsiOS() || Util.uaIsSafari()) { return; }

        this.hls = new Hls();
        this.hls.loadSource(this.videoSrc);
        this.hls.attachMedia(element);
        this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
            try {
                element.play();
            } catch (err) {
                console.error(err);
            }
        });
    }

    /**
     * destory hls
     */
    private destoryHls(): void {
        if (this.hls === null) { return; }
        this.hls.destroy();
        this.hls = null;
    }
}

export default StreamWatchVideoComponent;

