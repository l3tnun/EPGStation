import * as m from 'mithril';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import Util from '../../Util/Util';
import ViewModel from '../ViewModel';

/**
 * RulesSearchViewModel
 */
class RulesSearchViewModel extends ViewModel {
    private balloon: BalloonModelInterface;

    public keyword: string = '';

    constructor(
        balloon: BalloonModelInterface,
    ) {
        super();
        this.balloon = balloon;

        if (Util.uaIsAndroid()) {
            this.balloon.regDisableCloseAllId(RulesSearchViewModel.id);

            window.addEventListener('orientationchange', () => {
                if (document.getElementById(RulesSearchViewModel.id) === null || !this.balloon.isOpen(RulesSearchViewModel.id)) { return; }

                this.close();
            }, false);
        }
    }

    /**
     * 入力項目のリセット
     */
    public reset(): void {
        this.keyword = typeof m.route.param('keyword') === 'undefined' ? '' : m.route.param('keyword');
    }

    /**
     * search
     */
    public search(): void {
        this.close();
        window.setTimeout(() => {
            const query = Util.getCopyQuery();

            delete query.keyword;
            delete query.page;

            if (this.keyword.length > 0) { query.keyword = this.keyword; }

            const route = m.route.get().split('?')[0];
            if (Util.isEqualURL(route, query)) { return; }
            Util.move(route, query);
        }, 200);
    }

    /**
     * close balloon
     */
    public close(): void {
        this.balloon.close(RulesSearchViewModel.id);
    }
}

namespace RulesSearchViewModel {
    export const id = 'rules-search';
}

export default RulesSearchViewModel;

