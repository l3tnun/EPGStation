import * as m from 'mithril';
import RecordedMenuViewModel from '../../ViewModel/Recorded/RecordedMenuViewModel';
import RecordedSettingViewModel from '../../ViewModel/Recorded/RecordedSettingViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * RecordedEncodeComponent
 */
class RecordedEncodeComponent extends Component<void> {
    private viewModel: RecordedMenuViewModel;
    private settingViewModel: RecordedSettingViewModel;

    constructor() {
        super();
        this.viewModel = <RecordedMenuViewModel> factory.get('RecordedMenuViewModel');
        this.settingViewModel = <RecordedSettingViewModel> factory.get('RecordedSettingViewModel');
    }

    /**
     * view
     */
    public view(): m.Child | null {
        return m('div', [
            m('div', { class: 'recorded-encode-content' }, [
                m('div', { class: 'title' }, this.viewModel.getTitle()),
                m('div', { class: 'source-title' }, 'ソース'),
                m('div', { class: 'pulldown mdl-layout-spacer' }, [
                    m('select', {
                        class: 'mdl-textfield__input program-dialog-label',
                        onchange: m.withAttr('value', (value) => { this.viewModel.encodeSourceOptionValue = Number(value); }),
                        onupdate: (vnode: m.VnodeDOM<void, this>) => {
                            this.selectOnUpdate(<HTMLInputElement> (vnode.dom), this.viewModel.encodeSourceOptionValue);
                        },
                    }, this.viewModel.recordedFiles.map((option, i) => {
                        return m('option', { value: i }, option.name);
                    })),
                ]),
                m('div', { class: 'encode-title' }, '設定'),
                m('div', { class: 'pulldown mdl-layout-spacer' }, [
                    m('select', {
                        class: 'mdl-textfield__input program-dialog-label',
                        onchange: m.withAttr('value', (value) => { this.settingViewModel.tmpValue.encodeOption.mode = Number(value); }),
                        onupdate: (vnode: m.VnodeDOM<void, this>) => {
                            this.selectOnUpdate(<HTMLInputElement> (vnode.dom), this.settingViewModel.tmpValue.encodeOption.mode);
                            this.settingViewModel.save();
                        },
                    }, this.viewModel.getEncodeOption().map((option) => {
                        return m('option', { value: option.value }, option.name);
                    })),
                ]),
                m('div', { class: 'directory textfield mdl-textfield mdl-js-textfield' }, [
                    m('input', {
                        class: 'mdl-textfield__input',
                        type: 'text',
                        placeholder: 'directory',
                        value: this.viewModel.encodeDirectoryOptionValue,
                        onchange: m.withAttr('value', (value) => {
                            this.viewModel.encodeDirectoryOptionValue = value;
                        }),
                    }),
                ]),
                m('div', { class: 'encode-output-checkbox' }, [
                    m('label', { class: 'mdl-checkbox mdl-js-checkbox mdl-js-ripple-effect' }, [
                        m('input', {
                            type: 'checkbox',
                            class: 'mdl-checkbox__input',
                            checked: this.settingViewModel.tmpValue.encodeOption.isOutputTheOriginalDirectory,
                            onclick: m.withAttr('checked', (value) => {
                                this.settingViewModel.tmpValue.encodeOption.isOutputTheOriginalDirectory = value;
                                this.settingViewModel.save();
                            }),
                            onupdate: (vnode: m.VnodeDOM<void, this>) => { this.checkboxOnUpdate(<HTMLInputElement> (vnode.dom)); },
                        }),
                        m('span', { class: 'mdl-checkbox__label' }, '元ファイルと同じ場所に保存する'),
                    ]),
                ]),
                m('div', { class: 'encode-output-checkbox' }, [
                    m('label', { class: 'mdl-checkbox mdl-js-checkbox mdl-js-ripple-effect' }, [
                        m('input', {
                            type: 'checkbox',
                            class: 'mdl-checkbox__input',
                            checked: this.settingViewModel.tmpValue.encodeOption.delTs,
                            onclick: m.withAttr('checked', (value) => {
                                this.settingViewModel.tmpValue.encodeOption.delTs = value;
                                this.settingViewModel.save();
                            }),
                            onupdate: (vnode: m.VnodeDOM<void, this>) => { this.checkboxOnUpdate(<HTMLInputElement> (vnode.dom)); },
                        }),
                        m('span', { class: 'mdl-checkbox__label' }, 'TS 削除 (ソースが TS の場合に限る)'),
                    ]),
                ]),
            ]),
            m('div', { class: 'mdl-dialog__actions' }, [
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: () => {
                        // add encode
                        this.viewModel.addEncode(this.settingViewModel.getValue().encodeOption);
                        this.viewModel.close();
                    },
                }, '追加'),
                m('button', {
                    class: 'mdl-button mdl-js-button mdl-button--accent',
                    onclick: () => { this.viewModel.close(); },
                }, 'キャンセル'),
            ]),
        ]);
    }
}

export default RecordedEncodeComponent;

