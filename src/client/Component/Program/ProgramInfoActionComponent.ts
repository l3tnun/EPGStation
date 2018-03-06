import * as m from 'mithril';
import Util from '../../Util/Util';
import ProgramInfoViewModel from '../../ViewModel/Program/ProgramInfoViewModel';
import { ProgramViewModel } from '../../ViewModel/Program/ProgramViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * ProgramInfoActionComponent
 */
class ProgramInfoActionComponent extends Component<void> {
    private viewModel: ProgramInfoViewModel;
    private programViewModel: ProgramViewModel;

    constructor() {
        super();
        this.viewModel = <ProgramInfoViewModel> factory.get('ProgramInfoViewModel');
        this.programViewModel = <ProgramViewModel> factory.get('ProgramViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', [
            m('hr', { style: 'margin: 0px;' }),

            this.createEncodeOption(),

            m('div', { class: 'mdl-dialog__actions' }, [
                this.createReserveButton(),
                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-js-button mdl-button--primary',
                    onclick: () => {
                        this.viewModel.close();
                        setTimeout(() => {
                            Util.move('/search', this.createSearchQuery());
                        }, 200);
                    },
                }, '検索'),
                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-js-button mdl-button--accent close',
                    onclick: () => { this.viewModel.close(); },
                }, '閉じる'),
            ]),
        ]);
    }

    /**
     * 予約ボタン
     * @return m.Child | null
     */
    private createReserveButton(): m.Child | null {
        const reserve = this.viewModel.getReserveStatus();
        let name = '';
        let onclick: () => Promise<void>;

        if (reserve === null) {
            name = '予約';
            onclick = () => { return this.viewModel.addReserve(); };
        } else if (reserve.status === 'reserve' || reserve.status === 'conflict') {
            name = '削除';
            onclick = () => { return this.viewModel.deleteReserve(); };
        } else {
            name = '除外解除';
            onclick = () => { return this.viewModel.deleteSkip(); };
        }

        return m('button', {
            type: 'button',
            class: 'mdl-button mdl-js-button mdl-button--primary',
            onclick: async() => {
                try {
                    await onclick();
                } catch (err) {
                    console.error(err);
                }

                // 予約情報を更新する
                this.programViewModel.updateReservesOnly();
                this.viewModel.close();
            },
        }, name);
    }

    /**
     * 検索用の query を生成する
     * @return query
     */
    private createSearchQuery(): { [key: string]: string | number } {
        const program = this.viewModel.getProgram();
        if (program === null) { return {}; }

        const query: { [key: string]: string | number } = {
            keyword: this.createKeywordStr(program.name),
            channel: program.channelId,
        };

        if (typeof program.genre1 !== 'undefined') { query.genre1 = program.genre1; }
        if (typeof program.genre2 !== 'undefined') { query.genre2 = program.genre2; }

        return query;
    }

    /**
     * 検索 query の keyword 文字列を生成する
     * @param title: title
     * @return keyword
     */
    private createKeywordStr(title: string): string {
        const outTitle = title.trim();
        let delimiter = ' #';
        if (outTitle.indexOf(' #') === -1) {
            delimiter = outTitle.indexOf('「') === -1 ? '' : '「';
        }

        let keyword: string[] = [];
        if (delimiter.length > 0) { keyword = outTitle.split(delimiter); }
        if (typeof keyword[0] === 'undefined' || keyword[0].length === 0 || keyword[0] === '') { keyword[0] = outTitle; }

        return keyword[0];
    }

    /**
     * エンコードオプション
     * @return m.Child | null
     */
    private createEncodeOption(): m.Child | null {
        if (!this.viewModel.isEnableEncode() || this.viewModel.getReserveStatus() !== null) { return null; }

        return m('div', { class: 'action' }, [
            m('div', { class: 'encode' }, [
                m('label', { class: 'mdl-checkbox mdl-js-checkbox mdl-js-ripple-effect' }, [
                    m('input', {
                        type: 'checkbox',
                        class: 'mdl-checkbox__input',
                        checked: this.viewModel.delTS,
                        onclick: m.withAttr('checked', (value) => { this.viewModel.delTS = value; }),
                        onupdate: (vnode: m.VnodeDOM<void, this>) => { this.checkboxOnUpdate(<HTMLInputElement> (vnode.dom)); },
                    }),
                    m('span', { class: 'mdl-checkbox__label' }, 'TS削除'),
                ]),
                m('div', { class: 'pulldown mdl-layout-spacer' }, [
                    m('select', {
                        class: 'mdl-textfield__input program-dialog-label',
                        onchange: m.withAttr('value', (value) => { this.viewModel.encodeOptionValue = Number(value); }),
                        onupdate: (vnode: m.VnodeDOM<void, this>) => {
                            this.selectOnUpdate(<HTMLInputElement> (vnode.dom), this.viewModel.encodeOptionValue);
                        },
                    }, this.createEncodeValues()),
                ]),
            ]),
        ]);
    }

    /**
     * エンコードオプションのセレクタの中身
     * @return m.Child[];
     */
    private createEncodeValues(): m.Child[] {
        return this.viewModel.getEncodeOption().map((option) => {
             return m('option', { value: option.value }, option.name);
        });
    }
}

export default ProgramInfoActionComponent;

