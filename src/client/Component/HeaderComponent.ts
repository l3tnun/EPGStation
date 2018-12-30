import * as m from 'mithril';
import Util from '../Util/Util';
import BalloonViewModel from '../ViewModel/Balloon/BalloonViewModel';
import HeaderViewModel from '../ViewModel/HeaderViewModel';
import factory from '../ViewModel/ViewModelFactory';
import Component from './Component';

interface HeaderArgs {
    title: string;
    button?: m.Children[];
    headerStyle?: string;
    titleOnClick?(e: Event): void;
}

/**
 * HeaderComponent
 */
class HeaderComponent extends Component<HeaderArgs> {
    private button: m.Children[] | null;
    private tab: m.Children | null;
    private viewModel: HeaderViewModel;
    private balloon: BalloonViewModel;

    constructor() {
        super();
        this.viewModel = <HeaderViewModel> factory.get('HeaderViewModel');
        this.balloon = <BalloonViewModel> factory.get('BalloonViewModel');
    }

    protected initViewModel(): void {
        super.initViewModel();
        this.viewModel.init();
    }

    public oninit(vnode: m.Vnode<HeaderArgs, this>): void {
        super.oninit(vnode);

        if (typeof vnode.attrs.button !== 'undefined') {
            this.button = vnode.attrs.button;
        }
    }

    /**
     * 放送波のリンクを生成する
     */
    private getBroadcastLink(): m.Child[] {
        const config = this.viewModel.getConfig();
        const broadcastLink: m.Child[] = [];
        if (config !== null) {
            if (config.broadcast.GR) { broadcastLink.push(this.createLink('GR', '/program', { type: 'GR' }, true)); }
            if (config.broadcast.BS) { broadcastLink.push(this.createLink('BS', '/program', { type: 'BS' }, true)); }
            if (config.broadcast.CS) { broadcastLink.push(this.createLink('CS', '/program', { type: 'CS' }, true)); }
            if (config.broadcast.SKY) { broadcastLink.push(this.createLink('SKY', '/program', { type: 'SKY' }, true)); }
        }

        return broadcastLink;
    }

    /**
     * view
     */
    public view(vnode: m.Vnode<HeaderArgs, this>): m.Children {
        let titleCnt = 0;
        const config = this.viewModel.getConfig();
        if (config !== null) {
            if (config.broadcast.GR) { titleCnt += 1; }
            if (config.broadcast.BS) { titleCnt += 1; }
            if (config.broadcast.CS) { titleCnt += 1; }
            if (config.broadcast.SKY) { titleCnt += 1; }
        }

        return m('header', {
            class: 'mdl-layout__header',
            style: typeof vnode.attrs.headerStyle === 'undefined' ? '' : vnode.attrs.headerStyle,
            oncreate: () => { document.title = vnode.attrs.title; },
            onupdate: () => { if (vnode.attrs.title !== document.title) { document.title = vnode.attrs.title; } },
        }, [
            m('div', { class: 'mdl-layout__header-row' }, [
                // title
                m('span', {
                    class: `mdl-layout-title title-cnt-${ titleCnt } ios-no-click-color`,
                    onclick: (e: Event) => { if (typeof vnode.attrs.titleOnClick !== 'undefined') { vnode.attrs.titleOnClick(e); } },
                }, vnode.attrs.title),

                // 右側にナビゲーションを整列させる
                m('div', { class: 'mdl-layout-spacer' }),

                // 右上のナビゲーション
                m('nav', { class: 'mdl-navigation mdl-layout--large-screen-only' }, [
                    this.getBroadcastLink(),
                    this.createLink('録画済み', '/recorded'),
                    this.createLink('予約', '/reserves', { mode: 'reserves' }, true),
                    this.createLink('競合', '/reserves', { mode: 'conflicts' }, true),
                    this.createLink('重複', '/reserves', { mode: 'overlaps' }, true),
                    this.createLink('検索', '/search'),
                    this.createLink('ルール', '/rules'),
                ]),

                // button
                this.button,
                m('label', {
                    class: 'header-menu-button mdl-button mdl-js-button mdl-button--icon',
                    onclick: (e: Event) => {
                        this.balloon.open(HeaderViewModel.menuId, e);
                    },
                }, m('i', { class: 'material-icons' }, 'more_vert')),
            ]),

            // tabs
            this.tab,
        ]);
    }

    /**
     * navigation link を生成する
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
                if (Util.isEqualURL(href, query)) { return; }

                Util.move(href, query);
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
}

export { HeaderArgs, HeaderComponent };

