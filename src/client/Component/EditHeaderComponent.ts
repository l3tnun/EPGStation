import * as m from 'mithril';
import Component from './Component';

interface EditHeaderArgs {
    title: string;
    button: {
        onclick(event: Event): void; // click 時に実行される
        name: string; // material icons name
    }[];
    isShow(): boolean; // 表示されているか判定する
    close(): void; // 非表示処理を行う
}

/**
 * EditHeaderComponent
 */
class EditHeaderComponent extends Component<EditHeaderArgs> {
    public view(vnode: m.Vnode<EditHeaderArgs, this>): m.Child | null {
        if (!vnode.attrs.isShow()) { return null; }

        return m('div', {
            class: 'edit-header',
        }, [
            m('div', {
                class: 'drawer-button',
                onclick: () => { vnode.attrs.close(); },
            }, [
                m('i', {
                    class: 'material-icons',
                }, 'close'),
            ]),
            m('span', { class: 'title' }, vnode.attrs.title),
            m('div', { class: 'menu-parent' }, [
                vnode.attrs.button.map((button) => {
                    return m('label', {
                        class: 'menu-button header-menu-button mdl-button mdl-js-button mdl-button--icon',
                        onclick: (event: Event) => { button.onclick(event); },
                    }, m('i', { class: 'material-icons' }, button.name));
                }),
            ]),
        ]);
    }
}

export default EditHeaderComponent;

