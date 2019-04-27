import * as m from 'mithril';
import { ViewModelStatus } from '../../../Enums';
import Util from '../../../Util/Util';
import ProgramSettingViewModel from '../../../ViewModel/Program/ProgramSettingViewModel';
import factory from '../../../ViewModel/ViewModelFactory';
import MainLayoutComponent from '../../MainLayoutComponent';
import ParentComponent from '../../ParentComponent';

/**
 * ProgramSettingComponent
 */
class ProgramSettingComponent extends ParentComponent<void> {
    private viewModel: ProgramSettingViewModel;

    constructor() {
        super();
        this.viewModel = <ProgramSettingViewModel> factory.get('ProgramSettingViewModel');
    }

    protected async parentInitViewModel(status: ViewModelStatus): Promise<void> {
        if (status === 'init') {
            this.viewModel.resetTmp();
        }

        await Util.sleep(100);
    }

    /**
     * page name
     */
    protected getComponentName(): string { return 'ProgramSetting'; }

    /**
     * view
     */
    public view(): m.Child {
        return m(MainLayoutComponent, {
            header: { title: '番組表設定' },
            content: [
                this.createContent(),
            ],
            scrollStoped: (scrollTop: number) => {
                this.saveHistoryData(scrollTop);
            },
        });
    }

    /**
     * create content
     * @return m.Child
     */
    public createContent(): m.Child {
        const buttonHover = Util.uaIsMobile() ? ' no-hover' : '';

        return m('div', {
            class : 'program-setting-content mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col',
            onupdate: () => { this.restoreMainLayoutPosition(); },
        }, [
            m('div', { class: 'mdl-card__supporting-text' }, [
                this.createContentFrame('タブレット', [
                    this.createNumberBox('横幅 (px)',
                        () => { return this.viewModel.tmpValue.tablet.channelWidth; },
                        (value) => { this.viewModel.tmpValue.tablet.channelWidth = value; },
                    ),
                    this.createNumberBox('1時間あたりの高さ (px)',
                        () => { return this.viewModel.tmpValue.tablet.timescaleHeight; },
                        (value) => { this.viewModel.tmpValue.tablet.timescaleHeight = value; },
                    ),
                    this.createNumberBox('文字サイズ (pt)',
                        () => { return this.viewModel.tmpValue.tablet.boardFontsize; },
                        (value) => { this.viewModel.tmpValue.tablet.boardFontsize = value; },
                    ),
                ]),
                this.createContentFrame('スマートフォン', [
                    this.createNumberBox('横幅 (px)',
                        () => { return this.viewModel.tmpValue.mobile.channelWidth; },
                        (value) => { this.viewModel.tmpValue.mobile.channelWidth = value; },
                    ),
                    this.createNumberBox('1時間あたりの高さ (px)',
                        () => { return this.viewModel.tmpValue.mobile.timescaleHeight; },
                        (value) => { this.viewModel.tmpValue.mobile.timescaleHeight = value; },
                    ),
                    this.createNumberBox('文字サイズ (pt)',
                        () => { return this.viewModel.tmpValue.mobile.boardFontsize; },
                        (value) => { this.viewModel.tmpValue.mobile.boardFontsize = value; },
                    ),
                ]),
            ]),
            m('div', { class: 'mdl-dialog__actions' }, [
                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-js-button mdl-button--primary' + buttonHover,
                    onclick: () => { this.viewModel.save(); },
                }, '保存'),

                m('button', {
                    type: 'button',
                    class: 'mdl-button mdl-js-button mdl-button--accent close' + buttonHover,
                    onclick: () => { this.viewModel.reset(); },
                }, 'リセット'),
            ]),
        ]);
    }

    /**
     * create content frame
     * @param name: name
     * @param content: content
     * @return m.Child
     */
    protected createContentFrame(name: string, content: m.Child | m.Child[] | null): m.Child {
        return m('div', { class: 'mdl-cell mdl-cell--12-col mdl-grid mdl-grid--no-spacing' }, [
            m('div', { class: 'title mdl-cell mdl-cell--3-col mdl-cell--2-col-tablet' }, name),
            m('div', { class: 'mdl-cell mdl-cell--6-col mdl-cell--9-col-desktop mdl-grid mdl-grid--no-spacing' }, content),
        ]);
    }

    /**
     * create number Box
     * @param getValue: () => string
     * @param setValue: (value: string) => void
     * @return m.Child
     */
    private createNumberBox(name: string, getValue: () => number, setValue: (value: number) => void): m.Child {
        return m('div', { class: 'number-box' }, [
            m('div', { class: 'number-title' }, name),
            m('div', { class: 'mdl-textfield mdl-js-textfield' }, [
                 m('input', {
                    class: 'mdl-textfield__input',
                    type: 'number',
                    pattern: '-?[0-9]*(\.[0-9]+)?',
                    step: '0.01',
                    min: '1',
                    value: getValue(),
                    onchange: m.withAttr('value', (value) => {
                        const num = parseFloat(value);
                        if (isNaN(num) || typeof num !== 'number' || num < 0.01) { return; }
                        setValue(num);
                    }),
                    onupdate: (vnode: m.VnodeDOM<void, this>) => {
                        this.inputNumberOnUpdate(<HTMLInputElement> vnode.dom, getValue());
                    },
                }),
            ]),
        ]);
    }
}

export default ProgramSettingComponent;

