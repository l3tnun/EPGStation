import * as apid from '../../../../api';
import GenreUtil from '../../Util/GenreUtil';

namespace RulesUtil {
    /**
     * create keyword str
     * @param rule: Rule
     * @return string
     */
    export const createKeywordStr = (rule: apid.Rule): string => {
        return typeof rule.keyword === 'undefined' ? '-' : rule.keyword;
    };

    /**
     * create ignore keyword str
     * @param rule: Rule
     * @return string
     */
    export const createIgnoreKeywordStr = (rule: apid.Rule): string => {
        return typeof rule.ignoreKeyword === 'undefined' ? '-' : rule.ignoreKeyword;
    };

    /**
     * create option str
     * @param rule: Rule
     * @return string
     */
    export const createOptionStr = (rule: apid.Rule): string => {
        let str = '';
        if (Boolean(rule.keyCS)) { str += '字'; }
        if (Boolean(rule.keyRegExp)) { str += '正'; }
        if (Boolean(rule.title)) { str += 'タ'; }
        if (Boolean(rule.description)) { str += '概'; }
        if (Boolean(rule.extended)) { str += '詳細'; }

        return str;
    };

    /**
     * create ignore option str
     * @param rule: Rule
     * @return string
     */
    export const createIgnoreOptionStr = (rule: apid.Rule): string => {
        let str = '';
        if (Boolean(rule.ignoreKeyCS)) { str += '字'; }
        if (Boolean(rule.ignoreKeyRegExp)) { str += '正'; }
        if (Boolean(rule.ignoreTitle)) { str += 'タ'; }
        if (Boolean(rule.ignoreDescription)) { str += '概'; }
        if (Boolean(rule.ignoreExtended)) { str += '詳細'; }

        return str;
    };

    /**
     * create broadcast str
     * @param rule: Rule
     * @return string
     */
    export const createBroadcastStr = (rule: apid.Rule): string => {
        let str = '';
        if (Boolean(rule.GR)) { str += 'GR '; }
        if (Boolean(rule.BS)) { str += 'BS '; }
        if (Boolean(rule.CS)) { str += 'CS '; }
        if (Boolean(rule.SKY)) { str += 'SKY'; }

        return str;
    };

    /**
     * create Genre1 str
     * @param rule: Rule
     * @return string
     */
    export const createGenre1 = (rule: apid.Rule): string => {
        const genre = GenreUtil.getGenre1(rule.genrelv1);

        return genre === null ? '-' : genre;
    };

    /**
     * create Genre2 str
     * @param rule: Rule
     * @return string
     */
    export const createGenre2 = (rule: apid.Rule): string => {
        const genre = GenreUtil.getGenre2(rule.genrelv1, rule.genrelv2);

        return genre === null ? '-' : genre;
    };

    /**
     * create time
     * @param rule: Rule
     * @return string
     */
    export const createTimStr = (rule: apid.Rule): string => {
        if (typeof rule.startTime === 'undefined' || typeof rule.timeRange === 'undefined') { return '-'; }

        return `${ rule.startTime }~${ rule.timeRange }`;
    };

    /**
     * create time
     * @param rule: Rule
     * @return string
     */
    export const createDowStr = (rule: apid.Rule): string => {
        if (rule.week === 0x7f) { return 'all'; }

        let str = '';
        if ((rule.week & 0x01) !== 0) { str += '日'; }
        if ((rule.week & 0x02) !== 0) { str += '月'; }
        if ((rule.week & 0x04) !== 0) { str += '火'; }
        if ((rule.week & 0x08) !== 0) { str += '水'; }
        if ((rule.week & 0x10) !== 0) { str += '木'; }
        if ((rule.week & 0x20) !== 0) { str += '金'; }
        if ((rule.week & 0x40) !== 0) { str += '土'; }

        return str;
    };
}

export default RulesUtil;

