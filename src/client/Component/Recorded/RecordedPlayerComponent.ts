import * as m from 'mithril';
import RecordedPlayerViewModel from '../../ViewModel/Recorded/RecordedPlayerViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';
import VideoContainerComponent from '../Video/VideoContainerComponent';

/**
 * RecordedPlayerComponent
 */
class RecordedPlayerComponent extends Component<void> {
    private viewModel: RecordedPlayerViewModel;

    constructor() {
        super();
        this.viewModel = <RecordedPlayerViewModel> factory.get('RecordedPlayerViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        let width = window.innerWidth;
        if (width > RecordedPlayerViewModel.maxWidth) { width = RecordedPlayerViewModel.maxWidth; }
        const height = width / 16 * 9;

        return m('div', {
            class: 'recorded-player-parent',
        }, [
            m('div', {
                class: 'recorded-player',
                style: `margin: 0 auto; width: ${ width }px; height: ${ height }px;`,
            }, [
                m(VideoContainerComponent, {
                    video: this.createVideo(),
                    height: height,
                    enableCloseButton: true,
                    closeButtonCallback: () => { this.viewModel.close(); },
                }),
            ]),
        ]);
    }

    /**
     * create video
     * @return m.Child | null
     */
    private createVideo(): m.Child {
        if (this.viewModel.getSrc() === null) { return m('div', 'dummy'); }

        return m('video', {
            preload: 'none',
            height: '$auto',
            width: '100%',
            controls: ' ',
            playsinline: ' ',
            oncreate: (vnode: m.VnodeDOM<void, this>) => {
                const src = this.viewModel.getSrc();
                if (src === null) { return; }

                // set src
                (<HTMLVideoElement> vnode.dom).src = src;

                // set callback
                this.viewModel.setCloseCallback(() => {
                    try {
                        (<HTMLVideoElement> vnode.dom).pause();
                        (<HTMLVideoElement> vnode.dom).src = '';
                        (<HTMLVideoElement> vnode.dom).load();
                    } catch (err) {
                        console.error(err);
                    }
                });

                // 再生
                try {
                    (<HTMLVideoElement> vnode.dom).load();
                    (<HTMLVideoElement> vnode.dom).play();
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

export default RecordedPlayerComponent;

