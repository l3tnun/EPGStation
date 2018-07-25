import * as m from 'mithril';
import RecordedInfoViewModel from '../../ViewModel/Recorded/RecordedInfoViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * RecordedErrorLogComponent
 */
class RecordedErrorLogComponent extends Component<void> {
    private viewModel: RecordedInfoViewModel;

    constructor() {
        super();

        this.viewModel = <RecordedInfoViewModel> factory.get('RecordedInfoViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', [
            m('div', { id: 'recorded-error-log-content' }, [
                m('div', { class: 'title' }, `エラーログ: ${ this.viewModel.getTitle() }`),
                this.createContent(),
            ]),
        ]);
    }

    /**
     * create content
     * @return m.Child
     */
    public createContent(): m.Child {
        const recorded = this.viewModel.getRecorded();
        const logStr = this.viewModel.getLogStr();

        if (recorded === null || typeof recorded.errorCnt === 'undefined' || logStr === null) {
            return m('div', { class: 'not-found-log-file' }, 'ログファイルがありません');
        }

        return m('div', { class: 'log-str' }, m('pre', logStr));
    }
}

export default RecordedErrorLogComponent;

