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

            this.viewModel.getEncofing().map((video) => {
                return m('a', {
                    class: 'recorded-link mdl-button mdl-js-button mdl-button--raised mdl-button--colored mdl-js-ripple-effect',
                    disabled: ' ',
                }, video.name);
            }),

            this.createThumnbail(),
            m('div', { class: 'description' }, this.viewModel.getDescription()),
            m('div', {
                class: 'extended',
                onupdate: (vnode: m.VnodeDOM<void, this>) => {
                    let str = this.viewModel.getExtended();
                    if(str.length === 0) { str = ' '; }

                    str = str.replace(/(http:\/\/[\x21-\x7e]+)/gi, "<a href='$1' target='_blank'>$1</a>");
                    str = str.replace(/(https:\/\/[\x21-\x7e]+)/gi, "<a href='$1' target='_blank'>$1</a>");
                    (<HTMLElement>vnode.dom).innerHTML = str;
                },
            }, this.viewModel.getExtended()),
        ];
    }

    /**
    * download tab
    */
    private createDownload(): m.Child[] {
        return <m.Child[]>[
            m('div', { class: 'video-title' }, 'ビデオファイル'),
            this.viewModel.getVideoSrc(true).map((video) => {
                return m('a', {
                    class: 'recorded-link mdl-button mdl-js-button mdl-button--raised mdl-button--colored mdl-js-ripple-effect',
                    href: video.path,
                }, video.name);
            }),

            this.viewModel.getEncofing().map((video) => {
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

            this.viewModel.getEncofing().map((video) => {
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
        return <m.Child[]>[
            m('div', { class: 'video-title' }, 'HLS 配信'),
            m('div', { class: 'pulldown mdl-layout-spacer' }, [
                m('select', {
                    class: 'mdl-textfield__input program-dialog-label',
                    onchange: m.withAttr('value', (value) => { this.viewModel.hlsOptionValue = Number(value); }),
                    onupdate: (vnode: m.VnodeDOM<void, this>) => {
                        this.selectOnUpdate(<HTMLInputElement>(vnode.dom), this.viewModel.hlsOptionValue);
                    },
                }, this.createOptions()),
            ]),

            this.viewModel.getVideoInfo().map((video) => {
                return m('a', {
                    class: 'recorded-link mdl-button mdl-js-button mdl-button--raised mdl-button--colored mdl-js-ripple-effect',
                    onclick: () => {
                        this.viewModel.startHLSStreaming(typeof video.encodedId === 'undefined' ? null : video.encodedId);
                    },
                }, video.name);
            }),
        ];
    }

    /**
    * selector の option を生成する
    * @return m.Child[]
    */
    private createOptions(): m.Child[] {
        return this.viewModel.getHLSOptions().map((option) => {
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

