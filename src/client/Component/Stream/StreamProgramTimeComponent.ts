import * as m from 'mithril';
import StreamProgramCardsViewModel from '../../ViewModel/Stream/StreamProgramCardsViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * StreamProgramTimeComponent
 */
class StreamProgramTimeComponent extends Component<void> {
    private viewModel: StreamProgramCardsViewModel;

    constructor() {
        super();
        this.viewModel = <StreamProgramCardsViewModel> factory.get('StreamProgramCardsViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', { class: 'stream-time-content' }, [
            m('button', {
                class: 'stream-reset-time-button mdl-shadow--8dp mdl-button mdl-button--raised ripple mdl-button--accent',
                onclick: () => { this.viewModel.resetTime(); },
            }, 'NOW'),
            m('button', {
                class: 'mdl-shadow--8dp mdl-button mdl-button--raised mdl-button--accent',
                onclick: () => { this.viewModel.addTime(); },
            }, '+10分'),
        ]);
    }
}

export default StreamProgramTimeComponent;

