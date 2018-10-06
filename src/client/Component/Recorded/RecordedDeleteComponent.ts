import * as m from 'mithril';
import RecordedMenuViewModel from '../../ViewModel/Recorded/RecordedMenuViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * RecordedDeleteComponent
 */
class RecordedDeleteComponent extends Component<void> {
    private viewModel: RecordedMenuViewModel;

    constructor() {
        super();
        this.viewModel = <RecordedMenuViewModel> factory.get('RecordedMenuViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        const files: m.Child[] = [];
        for (let i = 0; i < this.viewModel.recordedFiles.length; i++) {
            files.push(m('label', { class: 'mdl-checkbox mdl-js-checkbox mdl-js-ripple-effect' }, [
                m('input', {
                    type: 'checkbox',
                    class: 'mdl-checkbox__input',
                    checked: this.viewModel.recordedFiles[i].checked,
                    onclick: m.withAttr('checked', (value) => { this.viewModel.recordedFiles[i].checked = value; }),
                    onupdate: (vnode: m.VnodeDOM<void, this>) => { this.checkboxOnUpdate(<HTMLInputElement> (vnode.dom)); },
                }),
                m('span', { class: 'mdl-checkbox__label' }, this.viewModel.recordedFiles[i].name),
            ]));
        }

        return m('div', [
            m('div', { class: 'balloon-with-action-enclosure-margin' }, this.viewModel.getTitle() + 'を削除しますか。'),
            m('div', { class: 'recorded-delete-files' }, files),
            m('div', { class: 'mdl-dialog__actions' }, [
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: () => {
                        // delete video
                        this.viewModel.delete();
                        this.viewModel.close();
                    },
                }, '削除'),
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--accent',
                    onclick: () => { this.viewModel.close(); },
                }, 'キャンセル'),
            ]),
        ]);
    }
}

export default RecordedDeleteComponent;

