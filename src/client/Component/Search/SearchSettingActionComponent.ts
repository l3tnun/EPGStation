import * as m from 'mithril';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import SearchSettingViewModel from '../../ViewModel/Search/SearchSettingViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * SearchSettingActionComponent
 */
class SearchSettingActionComponent extends Component<void> {
    private viewModel: SearchSettingViewModel;
    private balloon: BalloonViewModel;

    constructor() {
        super();

        this.viewModel = <SearchSettingViewModel> factory.get('SearchSettingViewModel');
        this.balloon = <BalloonViewModel> factory.get('BalloonViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', [
            m('hr', { style: 'margin: 0;' }),
            m('div', { class: 'mdl-dialog__actions', style: 'height: 36px;' }, [
                // 更新ボタン
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: () => {
                        this.viewModel.save();
                        this.balloon.close();
                    },
                }, '更新'),

                // キャンセルボタン
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--accent',
                    onclick: () => {
                        this.balloon.close();
                    },
                }, 'キャンセル'),
            ]),
        ]);
    }
}

export default SearchSettingActionComponent;

