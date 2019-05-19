import * as m from 'mithril';
import Util from '../../Util/Util';
import RecordedInfoViewModel from '../../ViewModel/Recorded/RecordedInfoViewModel';
import RecordedPlayerViewModel from '../../ViewModel/Recorded/RecordedPlayerViewModel';
import RecordedWatchSelectViewModel from '../../ViewModel/Recorded/RecordedWatchSelectViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * RecrodedInfoComponent
 */
class RecordedInfoComponent extends Component<void> {
    private viewModel: RecordedInfoViewModel;
    private playerViewModel: RecordedPlayerViewModel;
    private selectViewModel: RecordedWatchSelectViewModel;

    constructor() {
        super();

        this.viewModel = <RecordedInfoViewModel> factory.get('RecordedInfoViewModel');
        this.playerViewModel = <RecordedPlayerViewModel> factory.get('RecordedPlayerViewModel');
        this.selectViewModel = <RecordedWatchSelectViewModel> factory.get('RecordedWatchSelectViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', { id: 'recorded-info-content' }, [
            m('div', { class: 'tab-content' }, this.createTabContent()),
        ]);
    }

    /**
     * tab content
     */
    private createTabContent(): m.Child[] | null {
        switch (this.viewModel.getTabPosition()) {
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
        return <m.Child[]> [
            m('div', { class: 'title' }, this.viewModel.getTitle()),
            m('div', { class: 'channel' }, this.viewModel.getChannelName()),
            m('div', { class: 'time' }, this.viewModel.getTimeStr()),
            m('div', { class: 'genre' }, this.viewModel.getGenres()),
            m('div', {
                class: 'error-cnt',
                onclick: () => { this.viewModel.openErrorLog(); },
            }, this.viewModel.getDropCnt()),

            m('div', { class: 'video-title' }, 'ビデオファイル'),
            this.viewModel.getVideoSrc().map((video) => {
                return m('a', {
                    class: 'recorded-link mdl-button mdl-js-button mdl-button--raised mdl-button--colored mdl-js-ripple-effect',
                    onclick: async() => {
                        if (this.selectViewModel.isEnabledStreaming() && typeof video.encodedId === 'undefined' && !Util.uaIsiOS()) {
                            // TS ストリーミング再生
                            const recorded = this.viewModel.getRecorded();
                            if (recorded === null) { return; }

                            this.selectViewModel.set(recorded, () => {
                                if (video.isUrlScheme) {
                                    if (Util.uaIsFirefox()) {
                                        const w = window.open(video.path);
                                        if (w !== null) {
                                            window.setTimeout(() => { w.close(); }, 200);
                                        }
                                    } else {
                                        location.href = video.path;
                                        if (Util.uaIsiOS()) { this.viewModel.close(); }
                                    }
                                } else {
                                    location.href = video.path;
                                    if (Util.uaIsiOS()) { this.viewModel.close(); }
                                }
                            });

                            this.viewModel.close();
                            this.selectViewModel.open();
                        } else if (video.isUrlScheme) {
                            if (Util.uaIsFirefox()) {
                                const w = window.open(video.path);
                                if (w !== null) {
                                    window.setTimeout(() => { w.close(); }, 200);
                                }
                            } else {
                                location.href = video.path;
                                if (Util.uaIsiOS()) { this.viewModel.close(); }
                            }
                        } else if (video.useWebPlayer && typeof video.encodedId !== 'undefined') {
                            const recorded = this.viewModel.getRecorded();
                            if (recorded !== null) {
                                if (Util.uaIsAndroid()) {
                                    this.viewModel.close();
                                    await Util.sleep(300);
                                }

                                if (Util.uaIsAndroid()) {
                                    Util.move('/video/watch', {
                                        recordedId: recorded.id,
                                        encodedId: video.encodedId,
                                    });
                                } else {
                                    this.playerViewModel.set(recorded, video.encodedId);
                                    this.playerViewModel.open();
                                }
                            }
                        } else {
                            location.href = video.path;
                            if (Util.uaIsiOS()) { this.viewModel.close(); }
                        }
                    },
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
            this.createExtended(),
        ];
    }

    /**
     * exntended 生成
     */
    private createExtended(): m.Child | null {
        const extended = this.viewModel.getExtended();
        if (extended === '') { return null; }

        const str = this.viewModel.getExtended()
            .split(RecordedInfoComponent.linkReplacementCondition);

        const content: m.Child[] = [];
        for (const s of str) {
            if (typeof s === 'undefined') { continue; }

            if (s.match(RecordedInfoComponent.linkReplacementCondition)) {
                content.push(m('a', { href: s, target: '_blank' }, s));
                continue;
            }

            content.push(s);
        }

        return m('div', { class: 'extended' }, content);
    }

    /**
     * download tab
     */
    private createDownload(): m.Child[] {
        return <m.Child[]> [
            m('div', { class: 'title' }, this.viewModel.getTitle()),
            m('div', { class: 'video-title' }, 'ビデオファイル'),
            this.viewModel.getVideoSrc(true).map((video) => {
                let str = video.name;
                if (video.filesize !== null) { str += ` (${ video.filesize })`; }

                return m('a', {
                    class: 'recorded-link mdl-button mdl-js-button mdl-button--raised mdl-button--colored mdl-js-ripple-effect',
                    href: video.path,
                    onclick: () => { if (Util.uaIsiOS()) { this.viewModel.close(); } },
                }, str);
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
                if (Util.uaIsAndroid() || Util.uaIsiOS()) { return null; }

                return m('a', {
                    class: 'recorded-link mdl-button mdl-js-button mdl-button--raised mdl-button--colored mdl-js-ripple-effect',
                    href: video.path,
                }, video.name);
            }),

            this.viewModel.getEncoding().map((video) => {
                if (Util.uaIsMobile()) { return null; }

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
        const child: m.Child[] = [ m('div', { class: 'title' }, this.viewModel.getTitle()) ];

        // HLS 配信
        if (this.viewModel.isEnabledRecordedHLS()) {
            Array.prototype.push.apply(child, [
                m('div', { class: 'video-title' }, 'HLS 配信'),
                m('div', { class: 'pulldown mdl-layout-spacer' }, [
                    m('select', {
                        class: 'mdl-textfield__input program-dialog-label',
                        onchange: m.withAttr('value', (value) => { this.viewModel.hlsOptionValue = Number(value); }),
                        onupdate: (vnode: m.VnodeDOM<void, this>) => {
                            this.selectOnUpdate(<HTMLInputElement> (vnode.dom), this.viewModel.hlsOptionValue);
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
        if (this.viewModel.isEnabledKodi()) {
            Array.prototype.push.apply(child, [
                m('div', { class: 'video-title' }, 'kodi 配信'),
                m('div', { class: 'pulldown mdl-layout-spacer' }, [
                    m('select', {
                        class: 'mdl-textfield__input program-dialog-label',
                        onchange: m.withAttr('value', (value) => { this.viewModel.kodiOptionValue = Number(value); }),
                        onupdate: (vnode: m.VnodeDOM<void, this>) => {
                            this.selectOnUpdate(<HTMLInputElement> (vnode.dom), this.viewModel.kodiOptionValue);
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
                }),
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
        const src = this.viewModel.getThumnbailSrc();
        if (src === null) { return null; }

        return m('img', {
            class: 'thumbnail',
            src: src,
            onerror: (e: Event) => { (<HTMLImageElement> e.target).src = '/img/noimg.png'; },
        });
    }
}

namespace RecordedInfoComponent {
    export const downloadPanel = 'recorded-donwload-panel';
    export const watchPanel = 'recorded-watch-panel';
    export const linkReplacementCondition = /(http:\/\/[\x21-\x7e]+)|(https:\/\/[\x21-\x7e]+)/;
}

export default RecordedInfoComponent;

