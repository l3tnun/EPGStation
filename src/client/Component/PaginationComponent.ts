import * as m from 'mithril';
import Util from '../Util/Util';
import Component from './Component';

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
        const maxPage = Math.ceil(vnode.attrs.total / vnode.attrs.length);
        if (maxPage === 1 || vnode.attrs.page > maxPage) {
            return null;
        }

        // ページ番号生成
        let startPage = (vnode.attrs.page <= PaginationComponent.PAGINATION_CENTER - 1)
            ? 1
            : (maxPage - vnode.attrs.page >= PaginationComponent.PAGINATION_CENTER - 1)
                ? vnode.attrs.page - (PaginationComponent.PAGINATION_CENTER - 1)
                : maxPage - PaginationComponent.PAGINATION_MAX_SIZE + 1;
        if (startPage <= 0) {
            startPage = 1;
        }

        const pages = [];
        for (let i = 0; i < PaginationComponent.PAGINATION_MAX_SIZE; i++) {
            if (i + startPage > maxPage) { break; }
            pages.push(i + startPage);
        }

        return m('div', { class: 'pagination' }, [
            m('div', { class: 'container' }, [
                m('div', {
                    class: 'button navigation material-icons mdl-shadow--2dp mdl-cell mdl-cell mdl-cell--12-col',
                    style: vnode.attrs.page === 1 ? 'display: none;' : '',
                    onclick: () => { this.createHref(1); },
                }, 'navigate_before'),

                pages.map((p) => {
                    return m('div', {
                        class: 'button mdl-shadow--2dp mdl-cell mdl-cell mdl-cell--12-col '
                            + (p === vnode.attrs.page ? 'primary' : ''),
                        onclick: () => { this.createHref(p); },
                    }, p);
                }),

                m('div', {
                    class: 'button navigation material-icons mdl-shadow--2dp mdl-cell mdl-cell mdl-cell--12-col',
                    style: vnode.attrs.page === maxPage ? 'display: none;' : '',
                    onclick: () => { this.createHref(maxPage); },
                }, 'navigate_next'),
            ]),
        ]);
    }

    private createHref(page: number): void {
        const query = Util.getCopyQuery();
        query.page = page;

        Util.move(m.route.get().split('?')[0], query);
    }
}

namespace PaginationComponent {
    export const PAGINATION_MAX_SIZE = 5;
    export const PAGINATION_CENTER = Math.ceil(PAGINATION_MAX_SIZE / 2);
}

export default PaginationComponent;

