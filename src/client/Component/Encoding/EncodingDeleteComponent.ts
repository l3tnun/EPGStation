import * as m from 'mithril';
import EncodingDeleteViewModel from '../../ViewModel/Encoding/EncodingDeleteViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * EncodingDeleteComponent
 */
class EncodingDeleteComponent extends Component<void> {
    private viewModel: EncodingDeleteViewModel;

    constructor() {
        super();

        this.viewModel = <EncodingDeleteViewModel> factory.get('EncodingDeleteViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', [
            m('div', { class: 'balloon-with-action-enclosure-margin' }, this.viewModel.getTitle() + 'を停止しますか。'),
            m('div', { class: 'mdl-dialog__actions' }, [
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: () => {
                        // stop encoding
                        this.viewModel.stop();
                        this.viewModel.close();
                    },
                }, '停止'),
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--accent',
                    onclick: () => { this.viewModel.close(); },
                }, 'キャンセル'),
            ]),
        ]);
    }
}

export default EncodingDeleteComponent;

