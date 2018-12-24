import * as m from 'mithril';
import * as apid from '../../../../api';
import { RecordedApiModelInterface } from '../../Model/Api/RecordedApiModel';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import Util from '../../Util/Util';
import ViewModel from '../ViewModel';

/**
 * RecordedSearchViewModel
 */
class RecordedSearchViewModel extends ViewModel {
    private balloon: BalloonModelInterface;
    private recordedApiModel: RecordedApiModelInterface;

    public keyword: string = '';
    public rule: apid.RuleId = -1;
    public channel: apid.ServiceItemId = -1;
    public genre: apid.ProgramGenreLv1 = -1;
    public hasTs: boolean = false;

    constructor(
        balloon: BalloonModelInterface,
        recordedApiModel: RecordedApiModelInterface,
    ) {
        super();
        this.balloon = balloon;
        this.recordedApiModel = recordedApiModel;

        if (Util.uaIsAndroid()) {
            this.balloon.regDisableCloseAllId(RecordedSearchViewModel.id);

            window.addEventListener('orientationchange', () => {
                if (document.getElementById(RecordedSearchViewModel.id) === null || !this.balloon.isOpen(RecordedSearchViewModel.id)) { return; }

                this.close();
            }, false);
        }
    }

    /**
     * recorded tags を返す
     * @return apid.RecordedTags
     */
    public getTags(): apid.RecordedTags {
        return this.recordedApiModel.getTags();
    }

    /**
     * 入力項目のリセット
     */
    public reset(): void {
        this.keyword = typeof m.route.param('keyword') === 'undefined' ? '' : m.route.param('keyword');
        this.rule = typeof m.route.param('rule') === 'undefined' ? -1 : Number(m.route.param('rule'));
        this.channel = typeof m.route.param('channel') === 'undefined' ? -1 : Number(m.route.param('channel'));
        this.genre = typeof m.route.param('genre1') === 'undefined' ? -1 : Number(m.route.param('genre1'));
        this.hasTs = typeof m.route.param('hasTs') === 'undefined' ? false : <boolean> <any> m.route.param('hasTs');
    }

    /**
     * search
     */
    public search(): void {
        this.close();
        window.setTimeout(() => {
            const query = Util.getCopyQuery();

            delete query.keyword;
            delete query.rule;
            delete query.channel;
            delete query.genre1;
            delete query.page;
            delete query.hasTs;

            if (this.keyword.length > 0) { query.keyword = this.keyword; }
            if (this.rule !== -1) { query.rule = this.rule; }
            if (this.channel !== -1) { query.channel = this.channel; }
            if (this.genre !== -1) { query.genre1 = this.genre; }
            if (this.hasTs) { query.hasTs = this.hasTs; }

            const route = m.route.get().split('?')[0];
            if (Util.isEqualURL(route, query)) { return; }
            Util.move(route, query);
        }, 200);
    }

    /**
     * close balloon
     */
    public close(): void {
        this.balloon.close(RecordedSearchViewModel.id);
    }
}

namespace RecordedSearchViewModel {
    export const id = 'recorded-search';
}

export default RecordedSearchViewModel;

