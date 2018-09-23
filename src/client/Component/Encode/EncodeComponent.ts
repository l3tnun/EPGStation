import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import Util from '../../Util/Util';
import EncodeDeleteViewModel from '../../ViewModel/Encode/EncodeDeleteViewModel';
import EncodeViewModel from '../../ViewModel/Encode/EncodeViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import { BalloonComponent } from '../BalloonComponent';
import MainLayoutComponent from '../MainLayoutComponent';
import ParentComponent from '../ParentComponent';
import EncodeDeleteComponent from './EncodeDeleteComponent';

/**
 * EncodeComponent
 */
class EncodeComponent extends ParentComponent<void> {
    private viewModel: EncodeViewModel;
    private deleteViewModel: EncodeDeleteViewModel;

    constructor() {
        super();

        this.viewModel = <EncodeViewModel> factory.get('EncodeViewModel');
        this.deleteViewModel = <EncodeDeleteViewModel> factory.get('EncodeDeleteViewModel');
    }

    protected async parentInitViewModel(status: ViewModelStatus): Promise<void> {
        await this.viewModel.init(status);
    }

    /**
     * page name
     */
    protected getComponentName(): string { return 'Encode'; }

    /**
     * view
     */
    public view(): m.Child {
        return m(MainLayoutComponent, {
            header: { title: 'エンコード' },
            content: [
                this.createContent(),
            ],
            scrollStoped: (scrollTop: number) => {
                this.saveHistoryData(scrollTop);
            },
            notMainContent: [
                m(BalloonComponent, {
                    id: EncodeDeleteViewModel.id,
                    content: m(EncodeDeleteComponent),
                    maxWidth: 300,
                    forceDialog: true,
                }),
            ],
        });
    }

    /**
     * content
     * @return m.Child
     */
    private createContent(): m.Child {
        return m('div', {
            class: 'encoding-content',
            onupdate: () => {
                this.restoreMainLayoutPosition();
            },
        }, [
            this.viewModel.getEncodes().map((encode) => {
                return this.createCard(encode);
            }),
        ]);
    }

    /**
     * card
     * @param encode: apid.EncodingProgram
     * @return m.Child
     */
    private createCard(encode: apid.EncodingProgram): m.Child {
        return m('div', {
            class: 'encoding-card mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col',
        }, [
            m('button', {
                class: 'mdl-button mdl-js-button mdl-button--icon',
                onclick: () => {
                    this.deleteViewModel.set(encode);
                    this.deleteViewModel.open();
                },
            }, [
                m('i', { class: 'material-icons' }, 'close'),
            ]),
            m('div', [
                m('div', {
                    class: 'thumbnail-container',
                    onclick: (e: Event) => {
                        // firefox にて pointer-events: none; では img が白くなってしまうため
                        if (Util.uaIsFirefox()) {
                            setTimeout(() => {
                                (<HTMLElement> (<HTMLElement> e.target).parentNode).click();
                            }, 10);
                        }
                    },
                }, [
                    m('img', {
                        class: 'thumbnail',
                        src: encode.program.hasThumbnail ? `./api/recorded/${ encode.program.id }/thumbnail` : './img/noimg.png',
                        onerror: (e: Event) => { (<HTMLImageElement> e.target).src = './img/noimg.png'; },
                    }),
                ]),
                m('div', { class: 'text-container' }, [
                    m('div', { class: 'title' }, encode.program.name),
                    m('div', { class: 'channel' }, this.viewModel.getChannelName(encode.program.channelId)),
                    m('div', { class: 'time' }, this.viewModel.getTimeStr(encode.program)),
                    m('div', { class: 'encode-name' }, encode.name),
                ]),
            ]),
        ]);
    }
}

export default EncodeComponent;

