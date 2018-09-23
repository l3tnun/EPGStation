import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import Util from '../../Util/Util';
import EncodingDeleteViewModel from '../../ViewModel/Encoding/EncodingDeleteViewModel';
import EncodingViewModel from '../../ViewModel/Encoding/EncodingViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import { BalloonComponent } from '../BalloonComponent';
import MainLayoutComponent from '../MainLayoutComponent';
import ParentComponent from '../ParentComponent';
import EncodingDeleteComponent from './EncodingDeleteComponent';

/**
 * EncodingComponent
 */
class EncodingComponent extends ParentComponent<void> {
    private viewModel: EncodingViewModel;
    private deleteViewModel: EncodingDeleteViewModel;

    constructor() {
        super();

        this.viewModel = <EncodingViewModel> factory.get('EncodingViewModel');
        this.deleteViewModel = <EncodingDeleteViewModel> factory.get('EncodingDeleteViewModel');
    }

    protected async parentInitViewModel(status: ViewModelStatus): Promise<void> {
        await this.viewModel.init(status);
    }

    /**
     * page name
     */
    protected getComponentName(): string { return 'Encoding'; }

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
                    id: EncodingDeleteViewModel.id,
                    content: m(EncodingDeleteComponent),
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
            this.viewModel.getEncoding().map((encode) => {
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

export default EncodingComponent;

