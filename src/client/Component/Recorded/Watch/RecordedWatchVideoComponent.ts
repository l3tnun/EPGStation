import * as m from 'mithril';
import Util from '../../../Util/Util';
import RecordedWatchViewModel from '../../../ViewModel/Recorded/RecordedWatchViewModel';
import factory from '../../../ViewModel/ViewModelFactory';
import Component from '../../Component';

/**
 * RecordedWatchVideoComponent
 */
class RecordedWatchVideoComponent extends Component<void> {
    private viewModel: RecordedWatchViewModel;

    private source: string;

    constructor() {
        super();
        this.viewModel = <RecordedWatchViewModel> factory.get('RecordedWatchViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('video', {
            preload: 'none',
            height: '$auto',
            width: '100%',
            controls: ' ',
            playsinline: ' ',
            oncreate: (vnode: m.VnodeDOM<void, this>) => {
                const element = <HTMLVideoElement> vnode.dom;
                this.source = this.viewModel.getSource();

                // 再生
                try {
                    element.src = this.source;
                    element.load();
                    element.play();
                } catch (err) {
                    console.error(err);
                }
            },
            onupdate: async(vnode: m.VnodeDOM<void, this>) => {
                const source = this.viewModel.getSource();

                // video source 変更
                if (source !== this.source) {
                    const element = <HTMLVideoElement> vnode.dom;
                    this.source = source;

                    try {
                        element.pause();
                        element.src = this.source;
                        await Util.sleep(500);
                        element.load();
                        element.play();
                    } catch (err) {
                        console.error(err);
                    }
                }
            },
            onremove: (vnode: m.VnodeDOM<void, this>) => {
                const element = <HTMLVideoElement> vnode.dom;
                try {
                    element.pause();
                    element.src = '';
                    element.load();
                } catch (err) {
                    console.error(err);
                }
            },
        });
    }
}

export default RecordedWatchVideoComponent;

