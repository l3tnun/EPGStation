import * as m from 'mithril';
import EncodeDeleteViewModel from '../../ViewModel/Encode/EncodeDeleteViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * EncodeDeleteComponent
 */
class EncodeDeleteComponent extends Component<void> {
    private viewModel: EncodeDeleteViewModel;

    constructor() {
        super();

        this.viewModel = <EncodeDeleteViewModel> factory.get('EncodeDeleteViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', [
            m('div', { class: 'encoding-delete' }, this.viewModel.getTitle() + 'を停止しますか。'),
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

export default EncodeDeleteComponent;

