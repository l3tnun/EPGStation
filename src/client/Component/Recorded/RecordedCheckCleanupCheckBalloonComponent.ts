import * as m from 'mithril';
import RecordedCleanupViewModel from '../../ViewModel/Recorded/RecordedCleanupViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * RecordedCheckCleanupCheckBalloonComponent
 */
class RecordedCheckCleanupCheckBalloonComponent extends Component<void> {
    private viewModel: RecordedCleanupViewModel;

    constructor() {
        super();
        this.viewModel = <RecordedCleanupViewModel> factory.get('RecordedCleanupViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', [
            m('div', {
                class: 'balloon-with-action-enclosure-margin',
            }, '録画ディレクトリにある EPGStation の管理外ファイル、ディレクトリを削除します。実行しますか?'),
            m('div', { class: 'mdl-dialog__actions' }, [
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: async() => {
                        this.viewModel.close();
                        this.viewModel.init();
                        this.viewModel.open();
                        await this.viewModel.cleanup();
                    },
                }, '実行'),
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--accent',
                    onclick: () => { this.viewModel.close(); },
                }, 'キャンセル'),
            ]),
        ]);
    }
}

export default RecordedCheckCleanupCheckBalloonComponent;

