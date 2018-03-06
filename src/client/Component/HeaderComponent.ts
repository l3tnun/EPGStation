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
}

/**
 * HeaderComponent
 */
class HeaderComponent extends Component<HeaderArgs> {
    private button: m.Children[] | null;
    private tab: m.Children | null;
    private viewModel: HeaderViewModel;
    private balloon: BalloonViewModel;
    private broadcastLink: m.Child[] = [];

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
    private setBroadcastLink(): void {
        if (this.broadcastLink.length !== 0) { return; }

        const config = this.viewModel.getConfig();
        this.broadcastLink = [];
        if (config !== null) {
            if (config.broadcast.GR) { this.broadcastLink.push(this.createLink('GR', '/program', { type: 'GR' })); }
            if (config.broadcast.BS) { this.broadcastLink.push(this.createLink('BS', '/program', { type: 'BS' })); }
            if (config.broadcast.CS) { this.broadcastLink.push(this.createLink('CS', '/program', { type: 'CS' })); }
            if (config.broadcast.SKY) { this.broadcastLink.push(this.createLink('SKY', '/program', { type: 'SKY' })); }
        }
    }

    /**
     * view
     */
    public view(vnode: m.Vnode<HeaderArgs, this>): m.Children {
        this.setBroadcastLink();

        return m('header', {
            class: 'mdl-layout__header',
            style: typeof vnode.attrs.headerStyle === 'undefined' ? '' : vnode.attrs.headerStyle,
            oncreate: () => { document.title = vnode.attrs.title; },
            onupdate: () => { if (vnode.attrs.title !== document.title) { document.title = vnode.attrs.title; } },
        }, [
            m('div', { class: 'mdl-layout__header-row' }, [
                // title
                m('span', { class: 'mdl-layout-title' }, vnode.attrs.title),

                // 右側にナビゲーションを整列させる
                m('div', { class: 'mdl-layout-spacer' }),

                // 右上のナビゲーション
                m('nav', { class: 'mdl-navigation mdl-layout--large-screen-only' }, [
                    this.broadcastLink,
                    this.createLink('録画済み', '/recorded'),
                    this.createLink('予約', '/reserves'),
                    this.createLink('重複', '/reserves', { mode: 'conflicts' }),
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
     * @param query: any = {}}
     * @return m.Child
     */
    private createLink(name: string, href: string, query: any = {}): m.Child {
        return m('a', {
            class: 'mdl-navigation__link',
            onclick: () => {
                if (Util.isEqualURL(href, query)) { return; }

                Util.move(href, query);
            },
        }, name);
    }
}

export { HeaderArgs, HeaderComponent };

