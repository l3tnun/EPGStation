import * as m from 'mithril';
import Base from '../Base';

abstract class Component<T> extends Base implements m.ClassComponent<T> {
    /**
    * ViewModel の init
    * overwrite して使う
    */
    protected initViewModel(): void {}

    public oninit(_vnode: m.Vnode<T, this>): any {
        this.initViewModel();
    }

    public oncreate(_vnode: m.VnodeDOM<T, this>): any {}
    public onbeforeremove(_vnode: m.VnodeDOM<T, this>): Promise<any> | void {}
    public onremove(_vnode: m.VnodeDOM<T, this>): any {}
    public onbeforeupdate(_vnode: m.Vnode<T, this>, _old: m.VnodeDOM<T, this>): boolean | void {}
    public onupdate(_vnode: m.VnodeDOM<T, this>): any {}

    public abstract view(vnode: m.Vnode<T, this>): m.Children | null | void;

    /**
    * checkbox の設定
    * @param element: element
    */
    protected checkboxOnUpdate(element: HTMLInputElement): void {
        if(element.checked && (<Element>element.parentNode).className.indexOf('is-checked') == -1 ) {
            (<Element>element.parentNode).classList.add('is-checked');
        } else if(!element.checked && (<Element>element.parentNode).className.indexOf('is-checked') != -1) {
            (<Element>element.parentNode).classList.remove('is-checked');
        }
    }

    /**
    * select の設定
    * @param element: element
    * @param value: value
    */
    protected selectOnUpdate(element: HTMLInputElement, value: number | string | null): void {
        if(typeof value === 'undefined' || value === null) { return; }

        if(typeof value === 'number' && Number(element.value) != value) {
            element.value = String(value);
        } else if(typeof value === 'string' && element.value != value) {
            element.value = value;
        }
    }

    /**
    * toggle label の設定
    * @param element: element
    * @param value: value
    */
    protected toggleLabelOnUpdate(element: HTMLInputElement, value: boolean): void {
        if(value && element.className.indexOf('is-checked') === -1) {
            element.classList.add('is-checked');
        } else if(!value && element.className.indexOf('is-checked') !== -1) {
            element.classList.remove('is-checked');
        }
    }

    /**
    * text (number) の設定
    * @param element: element
    * @param value: value
    */
    protected inputNumberOnUpdate(element: HTMLInputElement, value: number): void {
        if(Number(element.value) !== value) {
            element.value = String(value);
        }

        if(value <= 0) {
            element.value = '';
        }
    }
}

export default Component;

