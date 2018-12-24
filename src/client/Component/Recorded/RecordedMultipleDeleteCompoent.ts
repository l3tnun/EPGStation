import * as m from 'mithril';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import RecordedViewModel from '../../ViewModel/Recorded/RecordedViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * RecordedMultipleDeleteComponent
 */
class RecordedMultipleDeleteComponent extends Component<void> {
    private viewModel: RecordedViewModel;
    private balloon: BalloonViewModel;

    constructor() {
        super();
        this.viewModel = <RecordedViewModel> factory.get('RecordedViewModel');
        this.balloon = <BalloonViewModel> factory.get('BalloonViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', [
            m('div', { class: 'balloon-with-action-enclosure-margin' }, [
                m('div', `選択した ${ this.viewModel.getSelectedCnt() } 件の録画を削除しますか。`),
                m('div', { style: 'margin-top: 12px;' }, '削除オプション'),
                m('div', { class: 'pulldown mdl-layout-spacer', style: 'width: 100%;' }, [
                    m('select', {
                        value: this.viewModel.deleteOption,
                        onchange: m.withAttr('value', (value) => {
                            this.viewModel.deleteOption = Number(value);
                        }),
                        onupdate: (vnode: m.VnodeDOM<void, this>) => {
                            this.selectOnUpdate(<HTMLInputElement> vnode.dom, this.viewModel.deleteOption);
                        },
                    }, [
                        m('option', { value: '0' }, 'すべて'),
                        m('option', { value: '1' }, 'TS のみ削除'),
                        m('option', { value: '2' }, 'エンコードファイル削除のみ'),
                    ]),
                ]),
            ]),
            m('div', { class: 'mdl-dialog__actions' }, [
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: () => {
                        // delete video
                        this.viewModel.deleteSelectedRecorded();
                        this.balloon.close();
                    },
                }, '削除'),
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--accent',
                    onclick: () => { this.balloon.close(); },
                }, 'キャンセル'),
            ]),
        ]);
    }
}

export default RecordedMultipleDeleteComponent;

