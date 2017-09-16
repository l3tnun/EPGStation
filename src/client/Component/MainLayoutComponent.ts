import * as m from 'mithril';
import Component from './Component';
import NavigationComponent from './NavigationComponent';
import { HeaderArgs, HeaderComponent } from './HeaderComponent';
import HeaderMenuComponent from './HeaderMenuComponent';
import HeaderViewModel from '../ViewModel/HeaderViewModel';
import { BalloonComponent } from './BalloonComponent';
import SnackbarComponent from './Snackbar/SnackbarComponent';
import StorageComponent from './Storage/StorageComponent';
import StorageViewModel from '../ViewModel/Storage/StorageViewModel';

interface MainLayoutArgs {
    header?: HeaderArgs;
    content?: m.Children | m.Children[] | null;
    notMainContent?: m.Children | m.Children[];
    menuWidth?: number;
    menuContent?: { attrs: { [key: string]: any }, text: string }[];
    mainLayoutStyle?: string;
    mainLayoutClass?: string;
}

/**
* MainLayoutComponent
*/
class MainLayoutComponent extends Component<MainLayoutArgs> {
    /**
    * view
    */
    public view(vnode: m.Vnode<MainLayoutArgs, this>): m.Children {
        let main: m.Child;
        if(typeof vnode.attrs.content !== 'undefined') {
            main = m('main', { class: 'mdl-layout__content non-scroll' }, [
                m('div', { class: 'page-content' }, vnode.attrs.content)
            ])
        }

        let attr: { [key: string]: any } = { class: 'mdl-layout mdl-js-layout mdl-layout--fixed-header' };
        if(typeof vnode.attrs.mainLayoutStyle !== 'undefined') {
            attr.style = vnode.attrs.mainLayoutStyle;
        }

        if(typeof vnode.attrs.mainLayoutClass !== 'undefined') {
            attr.class += ' ' + vnode.attrs.mainLayoutClass;
        }

        return m('div', attr, [
            typeof vnode.attrs.header === 'undefined' ? m(HeaderComponent) : m(HeaderComponent, vnode.attrs.header),
            m(NavigationComponent),
            main,
            vnode.attrs.notMainContent,
            m(BalloonComponent, {
                id: HeaderViewModel.menuId,
                content: m(HeaderMenuComponent, {
                    content: vnode.attrs.menuContent
                }),
                maxWidth: typeof vnode.attrs.menuWidth === 'undefined' ? 160 : vnode.attrs.menuWidth,
                verticalOnly: true,
            }),
            m(BalloonComponent, {
                id: StorageViewModel.id,
                content: m(StorageComponent),
                maxWidth: 250,
                maxHeight: 260,
                forceDialog: true,
            }),
            m(SnackbarComponent),
        ]);
    }
}

export default MainLayoutComponent;

