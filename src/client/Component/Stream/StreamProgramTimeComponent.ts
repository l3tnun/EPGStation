import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import StreamProgramCardsViewModel from '../../ViewModel/Stream/StreamProgramCardsViewModel';

/**
* StreamProgramTimeComponent
*/
class StreamProgramTimeComponent extends Component<void> {
    private viewModel: StreamProgramCardsViewModel;

    constructor() {
        super();
        this.viewModel = <StreamProgramCardsViewModel>(factory.get('StreamProgramCardsViewModel'));
    }

    /**
    * view
    */
    public view(): m.Child {
        return m('div', { class: 'stream-time-content' }, [
            m('button', {
                class: 'stream-reset-time-button mdl-shadow--8dp mdl-button mdl-js-button mdl-button--raised mdl-js-ripple-effect mdl-button--accent',
                onclick: () => { this.viewModel.resetTime(); },
            }, 'NOW'),
            m('button', {
                class: 'mdl-shadow--8dp mdl-button mdl-js-button mdl-button--raised mdl-js-ripple-effect mdl-button--accent',
                onclick: () => { this.viewModel.addTime(); },
            }, '+10分'),
        ]);
    }
}

export default StreamProgramTimeComponent;

