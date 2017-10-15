import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import RecordedMenuViewModel from '../../ViewModel/Recorded/RecordedMenuViewModel';

/**
* RecordedDeleteComponent
*/
class RecordedDeleteComponent extends Component<void> {
    private viewModel: RecordedMenuViewModel;

    constructor() {
        super();
        this.viewModel = <RecordedMenuViewModel>(factory.get('RecordedMenuViewModel'));
    }

    /**
    * view
    */
    public view(): m.Child {
        let files: m.Child[] = [];
        for(let i = 0; i < this.viewModel.deleteFiles.length; i++) {
            files.push(m('label', { class: 'mdl-checkbox mdl-js-checkbox mdl-js-ripple-effect' }, [
                m('input', {
                    type: 'checkbox',
                    class: 'mdl-checkbox__input',
                    checked: this.viewModel.deleteFiles[i].checked,
                    onclick: m.withAttr('checked', (value) => { this.viewModel.deleteFiles[i].checked = value; }),
                    onupdate: (vnode: m.VnodeDOM<void, this>) => { this.checkboxOnUpdate(<HTMLInputElement>(vnode.dom)); },
                }),
                m('span', { class: 'mdl-checkbox__label' }, this.viewModel.deleteFiles[i].name),
            ]));
        }

        return m('div', [
            m('div', { class: 'recorded-delete' }, this.viewModel.getTitle() + 'を削除しますか。'),
            m('div', { class: 'recorded-delete-files' }, files),
            m('div', { class: 'mdl-dialog__actions' }, [
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: () => {
                        // delete video
                        this.viewModel.delete();
                        this.viewModel.close();
                    }
                }, '削除'),
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--accent',
                    onclick: () => { this.viewModel.close(); }
                }, 'キャンセル' ),
            ])
        ]);
    }
}

export default RecordedDeleteComponent;

