import * as m from 'mithril';
import RecordedUploadViewModel from '../../../ViewModel/Recorded/RecordedUploadViewModel';
import factory from '../../../ViewModel/ViewModelFactory';
import Component from '../../Component';

/**
 * RecordedUploadBalloonComponnet
 */
class RecordedUploadBalloonComponnet extends Component<void> {
    private viewModel: RecordedUploadViewModel;

    constructor() {
        super();

        this.viewModel = <RecordedUploadViewModel> factory.get('RecordedUploadViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', { class: 'recorded-upload-balloon' }, [
            m('div', { class: 'mdl-card__supporting-text' }, [
                m('div', { class: 'progress' }, [
                    m('div', { class: 'title' }, 'アップロード中'),
                    m('div', { class: 'mdl-spinner mdl-spinner--single-color mdl-js-spinner is-active' }),
                ]),
            ]),
            m('div', { class: 'mdl-dialog__actions' }, [
                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-js-button mdl-button--accent close',
                    onclick: async() => {
                        await this.viewModel.abortUpload()
                        .catch((err) => { console.error(err); });
                        this.viewModel.close();
                    },
                }, 'キャンセル'),
            ]),
        ]);
    }
}

export default RecordedUploadBalloonComponnet;

