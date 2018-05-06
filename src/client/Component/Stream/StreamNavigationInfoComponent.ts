import * as m from 'mithril';
import Util from '../../Util/Util';
import StreamInfoViewModel from '../../ViewModel/Stream/StreamInfoViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * StreamNavigationInfoComponent
 */
class StreamNavigationInfoComponent extends Component<void> {
    private viewModel: StreamInfoViewModel;

    constructor() {
        super();
        this.viewModel = <StreamInfoViewModel> factory.get('StreamInfoViewModel');
    }

    public onremove(vnode: m.VnodeDOM<void, this>): any {
        this.viewModel.stopTimer();

        return super.onremove(vnode);
    }

    /**
     * view
     */
    public view(): m.Child[] | null {
        if (this.viewModel.getStreamInfos().length === 0) { return null; }

        return [
            m('span', { class: 'mdl-layout-title' }, '配信中'),
            m('nav', { class: 'mdl-navigation' }, [
                this.viewModel.getStreamInfos().map((info, index) => {
                    return m('a', {
                        class: 'mdl-navigation__link' + (info.type === 'WebMLive' ? ' disable' : ''),
                        onclick: () => {
                            if (info.type === 'WebMLive') { return; }

                            Util.closeNavigation();
                            this.viewModel.view(index);
                        },
                    }, typeof info.type !== 'undefined' && info.type.includes('Live') ? info.channelName : info.title);
                }),
            ]),
        ];
    }
}

export default StreamNavigationInfoComponent;

