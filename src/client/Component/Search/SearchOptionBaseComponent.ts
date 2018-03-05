import * as m from 'mithril';
import Component from '../Component';

/**
 * SearchOptionBaseComponent
 */
abstract class SearchOptionBaseComponent<T> extends Component<T> {
    /**
     * create content frame
     * @param name: name
     * @param content: content
     * @return m.Child
     */
    protected createContentFrame(name: string, content: m.Child | m.Child[] | null): m.Child {
        return m('div', { class: 'option-content mdl-cell mdl-cell--12-col mdl-grid mdl-grid--no-spacing' }, [
            m('div', { class: 'option-title mdl-cell mdl-cell--3-col mdl-cell--2-col-tablet' }, name),
            m('div', { class: 'mdl-cell mdl-cell--6-col mdl-cell--9-col-desktop mdl-grid mdl-grid--no-spacing' }, content),
        ]);
    }

    /**
     * create checkbox
     * @param labelName
     * @param checked: checked
     * @param onclick: onclick
     */
    protected createCheckBox(labelName: string, checked: () => boolean, onclick: (value: boolean) => void): m.Child {
        return m('label', { class: 'option-checkbox mdl-checkbox mdl-js-checkbox mdl-js-ripple-effect' }, [
            m('input', {
                type: 'checkbox',
                class: 'mdl-checkbox__input',
                checked: checked(),
                onclick: m.withAttr('checked', (value) => { onclick(value); }),
                onupdate: (vnode: m.VnodeDOM<T, this>) => { this.checkboxOnUpdate(<HTMLInputElement> (vnode.dom)); },
            }),
            m('span', { class: 'mdl-checkbox__label' }, labelName),
        ]);
    }

    public abstract view(vnode: m.Vnode<T, this>): m.Children | null | void;
}

export default SearchOptionBaseComponent;

