import * as m from 'mithril';
import Util from '../Util/Util';
import NavigationViewModel from '../ViewModel/NavigationViewModel';
import factory from '../ViewModel/ViewModelFactory';
import Component from './Component';
import StreamNavigationInfoComponent from './Stream/StreamNavigationInfoComponent';

/**
 * NavigationComponent
 */
class NavigationComponent extends Component<void> {
    private viewModel: NavigationViewModel;

    constructor() {
        super();
        this.viewModel = <NavigationViewModel> factory.get('NavigationViewModel');
    }

    /**
     * 送波のリンクを生成する
     */
    private getBroadcastLink(): m.Child[] {
        const broadcastLink: m.Child[] = [];

        const config = this.viewModel.getConfig();
        if (config !== null) {
            if (typeof config.mpegTsStreaming !== 'undefined') { broadcastLink.push(this.createLink('ライブ', '/stream/program')); }
            if (config.broadcast.GR) { broadcastLink.push(this.createLink('番組表(GR)', '/program', { type: 'GR' }, true)); }
            if (config.broadcast.BS) { broadcastLink.push(this.createLink('番組表(BS)', '/program', { type: 'BS' }, true)); }
            if (config.broadcast.CS) { broadcastLink.push(this.createLink('番組表(CS)', '/program', { type: 'CS' }, true)); }
            if (config.broadcast.SKY) { broadcastLink.push(this.createLink('番組表(SKY)', '/program', { type: 'SKY' }, true)); }
        }

        return broadcastLink;
    }

    /**
     * view
     */
    public view(): m.Children {
        return m('div', {
            class: 'mdl-layout__drawer',
            oncreate: () => {
                Util.upgradeMdl();
                if (m.route.get() === '/') {
                    if (window.innerWidth <= 1024 && this.viewModel.isAutoOpen()) {
                        window.setTimeout(() => { this.open(); }, 200);
                    }
                }
            },
            onupdate: () => { Util.upgradeMdl(); },
        }, [
            m(StreamNavigationInfoComponent),
            this.createTitle('EPGStation', {
                onclick: () => { if (m.route.get().split('?')[0] !== '/') { Util.move('/'); } },
            }),
            m('nav', { class: 'mdl-navigation' }, [
                this.getBroadcastLink(),
                this.createLink('録画済み', '/recorded'),
                this.createLink('エンコード', '/encoding'),
                this.createLink('予約', '/reserves', { mode: 'reserves' }, true),
                this.createLink('競合', '/reserves', { mode: 'conflicts' }, true),
                this.createLink('重複', '/reserves', { mode: 'overlaps' }, true),
                this.createLink('検索', '/search'),
                this.createLink('ルール', '/rules'),
                this.createLink('設定', '/setting'),
            ]),
        ]);
    }

    /**
     * title を作成
     * @param title: title
     * @return m.Child
     */
    private createTitle(title: string, attrs: { [key: string]: any } = {}): m.Child {
        attrs.class = 'mdl-layout-title';

        return m('span', attrs, title);
    }

    /**
     * link を作成
     * @param name: name
     * @param href: href
     * @param query: any = {}
     * @param needCheckQuery: boolean = false
     * @return m.Child
     */
    private createLink(name: string, href: string, query: any = {}, needCheckQuery: boolean = false): m.Child {
        return m('a', {
            class: 'mdl-navigation__link',
            oncreate: (vnode: m.VnodeDOM<void, any>) => {
                this.setActive(<HTMLElement> vnode.dom, href, query, needCheckQuery);
            },
            onupdate: (vnode: m.VnodeDOM<void, any>) => {
                this.setActive(<HTMLElement> vnode.dom, href, query, needCheckQuery);
            },
            onclick: () => {
                return new Promise<void>((resolve: () => void): void => {
                    this.close();

                    if (Util.isEqualURL(href, query)) { return; }
                    window.setTimeout(() => { Util.move(href, query); resolve(); }, 200);
                });
            },
        }, name);
    }

    /**
     * is-active の設定を行う
     * @param element: HTMLElement
     * @param href: string
     * @param query: {}
     * @param needCheckQuery: boolean
     */
    private setActive(element: HTMLElement, href: string, query: any, needCheckQuery: boolean): void {
        let isActive = m.route.get().split('?')[0] === href;
        if (needCheckQuery && isActive) {
            isActive = false;
            const param = m.route.param();
            for (const key in query) {
                if (key !== 'dummy' && param[key] === query[key]) {
                    isActive = true;
                    break;
                }
            }
        }

        if (isActive) {
            element.classList.add('is-active');
        } else {
            element.classList.remove('is-active');
        }
    }

    /**
     * navigation を開く
     */
    private open(): void {
        const navi = document.getElementsByClassName('mdl-layout__obfuscator');
        const naviVisible = document.getElementsByClassName('mdl-layout__obfuscator is-visible');
        if (navi.length > 0 && naviVisible.length === 0) {
            (<HTMLElement> navi[0]).click();
        }
    }

    /**
     * navigation を閉じる
     */
    private close(): void {
        Util.closeNavigation();
    }
}

export default NavigationComponent;

