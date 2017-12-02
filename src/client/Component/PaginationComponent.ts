import * as m from 'mithril';
import Component from './Component';
import Util from '../Util/Util';

interface PaginationArgs {
    total: number;
    length: number;
    page: number;
}


/**
* PaginationComponent
*/
class PaginationComponent extends Component<PaginationArgs> {
    /**
    * view
    */
    public view(vnode: m.Vnode<PaginationArgs, this>): m.Child | null {
        if(vnode.attrs.total === 0 || vnode.attrs.page <= 1 && vnode.attrs.total <= vnode.attrs.length * vnode.attrs.page) {
            return null;
        }

        return m('div', { class: 'pagination mdl-card mdl-shadow--2dp mdl-cell mdl-cell mdl-cell--12-col' }, [
            m('div', { class: 'container' }, [
                //戻る
                m('a', {
                    class: 'button hover material-icons',
                    style: vnode.attrs.page <= 1 ? 'visibility: hidden;' : '',
                    onclick: () => { this.createHref(vnode.attrs.page, -1); },
                }, 'navigate_before'),

                // text
                m('div', { class: 'text' }, vnode.attrs.page <= 1 ? '次のページ' : `ページ${ vnode.attrs.page }`),

                //進む
                m('a', {
                    class: 'button hover material-icons',
                    style: vnode.attrs.total <= vnode.attrs.length * vnode.attrs.page ? 'visibility: hidden;' : '',
                    onclick: () => { this.createHref(vnode.attrs.page, 1) },
                }, 'navigate_next'),
            ]),
        ]);
    }

    private createHref(page: number, add: number): void {
        let query = Util.getCopyQuery();
        page += add;
        if(page > 1) {
            query.page = page;
        } else {
            delete query.page;
        }

        Util.move(m.route.get().split('?')[0], query);
    }
}

export default PaginationComponent;

