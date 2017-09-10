import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import StorageViewModel from '../../ViewModel/Storage/StorageViewModel';

/**
* StorageComponent
*/
class StorageComponent extends Component<void> {
    private viewModel: StorageViewModel;

    constructor() {
        super();
        this.viewModel = <StorageViewModel>(factory.get('StorageViewModel'));
    }

    /**
    * view
    */
    public view(): m.Child {
        return m('div', [
            m('div', { class: 'storage-content' }, [
                m('div', { class: 'count' }, [
                    m('em', { class: 'title1' }, '空き容量'),
                    m('em', { class: 'title2' }, `${ (this.viewModel.get().free / 1024 / 1024 / 1024).toFixed(1) }GB`),
                ]),
                m('canvas', {
                    id: StorageViewModel.chartId,
                    width: '200',
                    height: '200'
                })
            ])
        ]);
    }
}

export default StorageComponent;

