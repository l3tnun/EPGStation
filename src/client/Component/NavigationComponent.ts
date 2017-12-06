import * as m from 'mithril';
import Util from '../Util/Util';
import Component from './Component';
import factory from '../ViewModel/ViewModelFactory';
import NavigationViewModel from '../ViewModel/NavigationViewModel';
import StreamNavigationInfoComponent from './Stream/StreamNavigationInfoComponent';

/**
* NavigationComponent
*/
class NavigationComponent extends Component<void> {
    private viewModel: NavigationViewModel;
    private broadcastLink: m.Child[] = [];

    constructor() {
        super();
        this.viewModel = <NavigationViewModel>(factory.get('NavigationViewModel'));
    }

    /**
    * 送波のリンクを生成する
    */
    private setBroadcastLink(): void {
        if(this.broadcastLink.length !== 0) { return; }

        let config = this.viewModel.getConfig();
        this.broadcastLink = []
        if(config !== null) {
            if(typeof config.mpegTsStreaming !== 'undefined') { this.broadcastLink.push(this.createLink('ライブ', '/stream/program')); }
            if(config.broadcast.GR) { this.broadcastLink.push(this.createLink('番組表(GR)', '/program', { type: 'GR' })); }
            if(config.broadcast.BS) { this.broadcastLink.push(this.createLink('番組表(BS)', '/program', { type: 'BS' })); }
            if(config.broadcast.CS) { this.broadcastLink.push(this.createLink('番組表(CS)', '/program', { type: 'CS' })); }
            if(config.broadcast.SKY) { this.broadcastLink.push(this.createLink('番組表(SKY)', '/program', { type: 'SKY' })); }
        }
    }

    /**
    * view
    */
    public view(): m.Children {
        this.setBroadcastLink();

        return m('div', {
            class: 'mdl-layout__drawer',
            oncreate: () => {
                Util.upgradeMdl();
                if(m.route.get() === '/') {
                    if(window.innerWidth <= 1024 && this.viewModel.isAutoOpen()) {
                        setTimeout(() => { this.open(); }, 200);
                    }
                }
            },
            onupdate: () => { Util.upgradeMdl(); },
        }, [
            m(StreamNavigationInfoComponent),
            this.createTitle('EPGStation', {
                onclick: () => { if(m.route.get().split('?')[0] !== '/') { Util.move('/'); } }
            }),
            m('nav', { class: 'mdl-navigation' }, [
                this.broadcastLink,
                this.createLink('録画済み', '/recorded'),
                this.createLink('予約', '/reserves'),
                this.createLink('重複', '/reserves', { mode: 'conflicts' }),
                this.createLink('検索', '/search'),
                this.createLink('ルール', '/rules'),
                this.createLink('設定', '/setting'),
            ])
        ])
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
    * @return m.Child
    */
    private createLink(name: string, href: string, query: any = {}): m.Child {
        return m('a', {
            class: 'mdl-navigation__link',
            onclick: () => {
                return new Promise<void>((resolve: () => void): void => {
                    this.close();

                    if(Util.isEqualURL(href, query)) { return; }
                    setTimeout(() => { Util.move(href, query); resolve(); }, 200);
                });
            },
        }, name);
    }

    /**
    * navigation を開く
    */
    private open(): void {
        let navi = document.getElementsByClassName('mdl-layout__obfuscator');
        let naviVisible = document.getElementsByClassName('mdl-layout__obfuscator is-visible');
        if(navi.length > 0 && naviVisible.length == 0) {
            (<HTMLElement>navi[0]).click();
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

