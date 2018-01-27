import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import RecordedInfoViewModel from '../../ViewModel/Recorded/RecordedInfoViewModel';
import Util from '../../Util/Util'

/**
* RecrodedInfoComponent
*/
class RecordedInfoComponent extends Component<void> {
    private viewModel: RecordedInfoViewModel;

    constructor() {
        super();

        this.viewModel = <RecordedInfoViewModel>(factory.get('RecordedInfoViewModel'));
    }

    /**
    * view
    */
    public view(): m.Child {
        return m('div', { id: 'recorded-info-content' } ,[
            m('div', { class: 'tab-content' }, this.createTabContent()),
        ]);
    }

    /**
    * tab content
    */
    private createTabContent(): m.Child[] | null {
        switch(this.viewModel.getTabPosition()) {
            case 0:
                return this.createInfo();
            case 1:
                return this.createDownload();
            case 2:
                return this.createStreaming();
            default:
                return null;
        }
    }

    /**
    * info tab
    */
    private createInfo(): m.Child[] {
        let extended = this.viewModel.getExtended();

        return <m.Child[]>[
            m('div', { class: 'title' }, this.viewModel.getTitle()),
            m('div', { class: 'channel' }, this.viewModel.getChannelName()),
            m('div', { class: 'time' }, this.viewModel.getTimeStr()),

            m('div', { class: 'video-title' }, 'ビデオファイル'),
            this.viewModel.getVideoSrc().map((video) => {
                return m('a', {
                    class: 'recorded-link mdl-button mdl-js-button mdl-button--raised mdl-button--colored mdl-js-ripple-effect',
                    href: video.path,
                }, video.name);
            }),

            this.viewModel.getEncoding().map((video) => {
                return m('a', {
                    class: 'recorded-link mdl-button mdl-js-button mdl-button--raised mdl-button--colored mdl-js-ripple-effect',
                    disabled: ' ',
                }, video.name);
            }),

            this.createThumnbail(),
            m('div', { class: 'description' }, this.viewModel.getDescription()),
            m('div', {
                class: 'extended',
                style: extended.length === 0 ? 'display: none;' : '',
                onupdate: (vnode: m.VnodeDOM<void, this>) => {
                    if(extended.length === 0) { return; }
                    extended = extended.replace(/(http:\/\/[\x21-\x7e]+)/gi, "<a href='$1' target='_blank'>$1</a>");
                    extended = extended.replace(/(https:\/\/[\x21-\x7e]+)/gi, "<a href='$1' target='_blank'>$1</a>");
                    (<HTMLElement>vnode.dom).innerHTML = extended;
                },
            }, this.viewModel.getExtended()),
        ];
    }

    /**
    * download tab
    */
    private createDownload(): m.Child[] {
        return <m.Child[]>[
            m('div', { class: 'title' }, this.viewModel.getTitle()),
            m('div', { class: 'video-title' }, 'ビデオファイル'),
            this.viewModel.getVideoSrc(true).map((video) => {
                return m('a', {
                    class: 'recorded-link mdl-button mdl-js-button mdl-button--raised mdl-button--colored mdl-js-ripple-effect',
                    href: video.path,
                }, video.name);
            }),

            this.viewModel.getEncoding().map((video) => {
                return m('a', {
                    class: 'recorded-link mdl-button mdl-js-button mdl-button--raised mdl-button--colored mdl-js-ripple-effect',
                    disabled: ' ',
                }, video.name);
            }),

            m('div', {
                class: 'video-title',
                style: Util.uaIsMobile() ? 'display: none;' : '',
            }, 'プレイリスト'),
            this.viewModel.getPlayList().map((video) => {
                if(Util.uaIsAndroid() || Util.uaIsiOS()) { return null; }
                return m('a', {
                    class: 'recorded-link mdl-button mdl-js-button mdl-button--raised mdl-button--colored mdl-js-ripple-effect',
                    href: video.path,
                }, video.name);
            }),

            this.viewModel.getEncoding().map((video) => {
                if(Util.uaIsMobile()) { return null; }
                return m('a', {
                    class: 'recorded-link mdl-button mdl-js-button mdl-button--raised mdl-button--colored mdl-js-ripple-effect',
                    disabled: ' ',
                }, video.name);
            }),
        ];
    }

    /**
    * createStreaming tab
    */
    private createStreaming(): m.Child[] {
        let child: m.Child[] = [ m('div', { class: 'title' }, this.viewModel.getTitle()) ];

        // HLS 配信
        if(this.viewModel.isEnabledRecordedHLS()) {
            Array.prototype.push.apply(child,[
                m('div', { class: 'video-title' }, 'HLS 配信'),
                m('div', { class: 'pulldown mdl-layout-spacer' }, [
                    m('select', {
                        class: 'mdl-textfield__input program-dialog-label',
                        onchange: m.withAttr('value', (value) => { this.viewModel.hlsOptionValue = Number(value); }),
                        onupdate: (vnode: m.VnodeDOM<void, this>) => {
                            this.selectOnUpdate(<HTMLInputElement>(vnode.dom), this.viewModel.hlsOptionValue);
                        },
                    }, this.createHLSOptions()),
                ]),

                this.viewModel.getVideoInfo().map((video) => {
                    return m('a', {
                        class: 'recorded-link mdl-button mdl-js-button mdl-button--raised mdl-button--colored mdl-js-ripple-effect',
                        onclick: () => {
                            this.viewModel.startHLSStreaming(typeof video.encodedId === 'undefined' ? null : video.encodedId);
                        },
                    }, video.name);
                }),
            ]);
        }

        // kodi 配信
        if(this.viewModel.isEnabledKodi()) {
            Array.prototype.push.apply(child,[
                m('div', { class: 'video-title' }, 'kodi 配信'),
                m('div', { class: 'pulldown mdl-layout-spacer' }, [
                    m('select', {
                        class: 'mdl-textfield__input program-dialog-label',
                        onchange: m.withAttr('value', (value) => { this.viewModel.kodiOptionValue = Number(value); }),
                        onupdate: (vnode: m.VnodeDOM<void, this>) => {
                            this.selectOnUpdate(<HTMLInputElement>(vnode.dom), this.viewModel.kodiOptionValue);
                        },
                    }, this.createKodiOptions()),
                ]),

                this.viewModel.getVideoInfo().map((video) => {
                    return m('a', {
                        class: 'recorded-link mdl-button mdl-js-button mdl-button--raised mdl-button--colored mdl-js-ripple-effect',
                        onclick: () => {
                            this.viewModel.sendToKodi(typeof video.encodedId === 'undefined' ? null : video.encodedId);
                        },
                    }, video.name);
                })
            ]);
        }

        return child;
    }

    /**
    * HLS 配信の option を生成する
    * @return m.Child[]
    */
    private createHLSOptions(): m.Child[] {
        return this.viewModel.getHLSOptions().map((option) => {
            return m('option', { value: option.value }, option.name);
        });
    }

    /**
    * kodi 配信の option を生成する
    * @return m.Child[]
    */
    private createKodiOptions(): m.Child[] {
        return this.viewModel.getKodiOptions().map((option) => {
            return m('option', { value: option.value }, option.name);
        });
    }

    /**
    * thumnbail 要素を生成
    * @return m.Child | null
    */
    private createThumnbail(): m.Child | null {
        let src = this.viewModel.getThumnbailSrc();
        if(src === null) { return null; }

        return m('img', {
            class: 'thumbnail',
            src: src,
            onerror: (e: Event) => { (<HTMLImageElement>e.target).src = '/img/noimg.png'; },
        });
    }
}

namespace RecordedInfoComponent {
    export const downloadPanel = 'recorded-donwload-panel';
    export const watchPanel = 'recorded-watch-panel'
}

export default RecordedInfoComponent;

