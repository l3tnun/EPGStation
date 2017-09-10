import * as m from 'mithril';
import * as Hls from 'hls.js';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import StreamWatchViewModel from '../../ViewModel/Stream/StreamWatchViewModel';

/**
* StreamWatchVideoComponent
*/
class StreamWatchVideoComponent extends Component<void> {
    private viewModel: StreamWatchViewModel;
    private hls: Hls | null = null;
    private videoSrc: string;

    constructor() {
        super();

        this.viewModel = <StreamWatchViewModel>(factory.get('StreamWatchViewModel'));
    }

    /**
    * view
    */
    public view(): m.Child {
        if(this.viewModel.isEnable()) {
            return m('video', {
                preload: 'none',
                height: '$auto',
                width: '100%',
                controls: ' ',
                playsinline: ' ',
                oncreate: (vnode: m.VnodeDOM<void, this>) => {
                    if(typeof m.route.param('stream') === 'undefined') { return; }

                    //set source
                    this.videoSrc = this.viewModel.getSource();
                    (<HTMLVideoElement>(vnode.dom)).src = this.videoSrc;

                    //hls.js
                    this.createHls(<HTMLVideoElement>vnode.dom);
                    if(this.hls !== null) { return; }

                    //error 処理追加
                    (<HTMLVideoElement>(vnode.dom)).addEventListener('error', () => {
                        this.viewModel.openSnackbar('ビデオ再生に失敗しました');
                    }, true);

                    //再生
                    try {
                        (<HTMLVideoElement>(vnode.dom)).load();
                        (<HTMLVideoElement>(vnode.dom)).play();
                    } catch(err) {
                        console.error(err);
                    }
                },
                onupdate: (vnode: m.VnodeDOM<void, this>) => {
                    if(typeof m.route.param('stream') === 'undefined') { return; }

                    // video src とページの stream のズレを修正
                    if(this.viewModel.getSource() !== this.videoSrc) {
                        this.videoSrc = this.viewModel.getSource();
                        try {
                            (<HTMLVideoElement>(vnode.dom)).pause();
                        } catch(err) {
                            console.error(err);
                        }
                        try {
                            if(this.hls === null) {
                                (<HTMLVideoElement>(vnode.dom)).src = this.videoSrc;
                                (<HTMLVideoElement>(vnode.dom)).load();
                                (<HTMLVideoElement>(vnode.dom)).play();
                            } else {
                                this.destoryHls();
                                this.createHls(<HTMLVideoElement>vnode.dom);
                            }
                        } catch(err) {
                            console.error(err);
                        }
                    }
                },
                onremove: (vnode: m.VnodeDOM<void, this>) => {
                    try {
                        (<HTMLVideoElement>(vnode.dom)).pause();
                        (<HTMLVideoElement>(vnode.dom)).src = '';
                        (<HTMLVideoElement>(vnode.dom)).load();
                    } catch(err) {
                        console.log(err);
                    }

                    this.destoryHls();
                }
            });
        } else {
            // 視聴可能になるまで待機中
            return m('div', { class: 'video-player-background' },[
                m('div', {
                    class: 'mdl-spinner mdl-spinner--single-color mdl-js-spinner is-active'
                })
            ]);
        }
    }

    /**
    * create hls
    */
    private createHls(element: HTMLVideoElement): void {
        if(!Hls.isSupported()) { return; }

        this.hls = new Hls();
        this.hls.loadSource(this.videoSrc);
        this.hls.attachMedia(element);
        this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
            element.play();
        });
    }

    /**
    * destory hls
    */
    private destoryHls(): void {
        if(this.hls === null) { return; }
        this.hls.destroy();
        this.hls = null;
    }
}

export default StreamWatchVideoComponent;

