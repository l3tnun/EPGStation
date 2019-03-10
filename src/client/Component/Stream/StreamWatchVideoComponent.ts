import * as b24js from 'b24.js';
import * as Hls from 'hls-b24.js';
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
    private b24Renderer: b24js.WebVTTRenderer | null = null;
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
                    // b24js WebVTTRenderer
                    this.createB24Renderer(<HTMLVideoElement> vnode.dom, this.hls!);

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
                                this.destroyB24Renderer();
                                this.createHls(<HTMLVideoElement> vnode.dom);
                                this.createB24Renderer(<HTMLVideoElement> vnode.dom, this.hls);
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
                    this.destroyB24Renderer();
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
        // macOS Safari 10+ において hls.js にする
        if (!Hls.isSupported() || (Util.uaIsSafari() && !Util.uaIsSafari10OrLater()) || Util.uaIsiOS()) { return; }

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
     * create B24 subtitle renderer
     */
    private createB24Renderer(element: HTMLVideoElement, hls: Hls): void {
        if (!Hls.isSupported()) {
            return;
        }

        this.b24Renderer = new b24js.WebVTTRenderer();
        this.b24Renderer.init().then(() => {
            if (this.b24Renderer) {
                this.b24Renderer.attachMedia(element);
                this.b24Renderer.show();
            }
        });
        hls.on(Hls.Events.FRAG_PARSING_PRIVATE_DATA, (_event: string, data: any) => {
            if (this.b24Renderer === null) {
                return;
            }
            for (const sample of data.samples) {
                this.b24Renderer.pushData(sample.pid, sample.data, sample.pts);
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

    /**
     * destroy B24 subtitle renderer
     */
    private destroyB24Renderer(): void {
        if (this.b24Renderer === null) { return; }
        this.b24Renderer.detachMedia();
        this.b24Renderer.dispose();
        this.b24Renderer = null;
    }

}

export default StreamWatchVideoComponent;

