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
                    href: this.createHref(vnode.attrs.page, -1),
                    oncreate: m.route.link,
                }, 'navigate_before'),

                // text
                m('div', { class: 'text' }, vnode.attrs.page <= 1 ? '次のページ' : `ページ${ vnode.attrs.page }`),

                //進む
                m('a', {
                    class: 'button hover material-icons',
                    style: vnode.attrs.total <= vnode.attrs.length * vnode.attrs.page ? 'visibility: hidden;' : '',
                    href: this.createHref(vnode.attrs.page, 1),
                    oncreate: m.route.link,
                }, 'navigate_next'),
            ]),
        ]);
    }

    private createHref(page: number, add: number): string {
        let query = Util.getCopyQuery();
        page += add;
        if(page > 1) {
            query.page = page;
        } else {
            delete query.page;
        }

        let route = m.route.get().split('?')[0];
        let queryStr = m.buildQueryString(query);

        return queryStr.length === 0 ? route : route + '?' +  queryStr;
    }
}

export default PaginationComponent;

