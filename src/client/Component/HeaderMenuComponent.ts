import * as m from 'mithril';
import HeaderViewModel from '../ViewModel/HeaderViewModel';
import StorageViewModel from '../ViewModel/Storage/StorageViewModel';
import factory from '../ViewModel/ViewModelFactory';
import Component from './Component';

interface HeaderMenuArgs {
    content?: { attrs: { [key: string]: any }; text: string }[];
}

/**
 * HeaderMenuComponent
 */
class HeaderMenuComponent extends Component<HeaderMenuArgs> {
    private viewModel: HeaderViewModel;
    private storage: StorageViewModel;

    constructor() {
        super();
        this.viewModel = <HeaderViewModel> factory.get('HeaderViewModel');
        this.storage = <StorageViewModel> factory.get('StorageViewModel');
    }

    /**
     * view
     */
    public view(vnode: m.Vnode<HeaderMenuArgs, this>): m.Child {
        const child: m.Child[] = [];

        if (typeof vnode.attrs.content !== 'undefined') {
            vnode.attrs.content.map((con) => {
                child.push(this.createItem(con.attrs, con.text));
            });
        }

        child.push(this.createItem({
            onclick: () => {
                this.viewModel.close();
                this.storage.init();
                window.setTimeout(() => { this.storage.open(); }, 200);
            },
        }, 'ストレージ空き容量'));

        return m('div', [
            m('div', { class: 'header-menu-content' }, child),
        ]);
    }

    private createItem(attrs: { [key: string]: any }, text: string): m.Child {
        attrs.class = 'item';

        return m('div', attrs, text);
    }
}

export default HeaderMenuComponent;

