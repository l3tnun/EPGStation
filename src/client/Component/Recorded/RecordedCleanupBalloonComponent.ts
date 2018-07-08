import * as m from 'mithril';
import RecordedCleanupViewModel from '../../ViewModel/Recorded/RecordedCleanupViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * RecordedCleanupBalloonComponnet
 */
class RecordedCleanupBalloonComponnet extends Component<void> {
    private viewModel: RecordedCleanupViewModel;

    constructor() {
        super();

        this.viewModel = <RecordedCleanupViewModel> factory.get('RecordedCleanupViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', { class: 'recorded-cleanup-balloon' }, [
            m('div', { class: 'mdl-card__supporting-text' }, [
                m('div', { class: `progress ${ status }` }, [
                    this.createContent(),
                ]),
            ]),
        ]);
    }

    /**
     * content
     * @return m.Child[] | null
     */
    private createContent(): m.Child[] | null {
        if (this.viewModel.getStatus() === 'CleaningUp') {
            return [
                m('div', { class: 'title' }, 'クリーンアップ中'),
                m('div', { class: 'mdl-spinner mdl-spinner--single-color mdl-js-spinner is-active' }),
            ];
        } else {
            return null;
        }
    }
}

export default RecordedCleanupBalloonComponnet;

