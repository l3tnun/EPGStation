import * as m from 'mithril';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import EncodingViewModel from '../../ViewModel/Encoding/EncodingViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * EncodingMultipleStopCompoent
 */
class EncodingMultipleStopCompoent extends Component<void> {
    private viewModel: EncodingViewModel;
    private balloon: BalloonViewModel;

    constructor() {
        super();

        this.viewModel = <EncodingViewModel> factory.get('EncodingViewModel');
        this.balloon = <BalloonViewModel> factory.get('BalloonViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', [
            m('div', { class: 'balloon-with-action-enclosure-margin' }, `選択した ${ this.viewModel.getSelectedCnt() } 件のエンコードを停止しますか。`),
            m('div', { class: 'mdl-dialog__actions' }, [
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: () => {
                        // stop encode
                        this.viewModel.stopSelectedEncode();
                        this.balloon.close();
                    },
                }, '停止'),
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--accent',
                    onclick: () => { this.balloon.close(); },
                }, 'キャンセル'),
            ]),
        ]);
    }
}

export default EncodingMultipleStopCompoent;

