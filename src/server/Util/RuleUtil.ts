import Configuration from '../Configuration';
import * as DBSchema from '../Model/DB/DBSchema';
import { ReserveOptionInterface } from '../Model/Operator/ReserveProgramInterface';
import { EncodeInterface, OptionInterface, RuleInterface, SearchInterface } from '../Model/Operator/RuleInterface';

/**
 * Rule Util
 */
namespace RuleUtil {
    export interface KeywordOption {
        cs: boolean;
        regExp: boolean;
        title: boolean;
        description: boolean;
        extended: boolean;
    }

    /**
     * Rule が正しいかチェック
     * @param rule: RuleInterface
     * @return boolean
     */
    export const checkRule = (rule: RuleInterface): boolean => {
        return RuleUtil.checkRuleSearch(rule.search)
            && RuleUtil.checkRuleOption(rule.option)
            && (typeof rule.encode === 'undefined' || RuleUtil.checkEncodeOption(rule.encode));
    };

    /**
     * ルールの search option 部分をチェックする
     * @param search: SearchInterface
     * @return true: 追加可能なルール false: 追加不可能なルール
     */
    export const checkRuleSearch = (search: SearchInterface): boolean => {
        // keyword
        if (typeof search.keyword !== 'undefined' && typeof search.keyword !== 'string') { return false; }
        if (typeof search.ignoreKeyword !== 'undefined' && typeof search.ignoreKeyword !== 'string') { return false; }

        const keyOption: KeywordOption = {
            cs: Boolean(search.keyCS),
            regExp: Boolean(search.keyRegExp),
            title: Boolean(search.title),
            description: Boolean(search.description),
            extended: Boolean(search.extended),
        };

        const ignoreKeyOption: KeywordOption = {
            cs: Boolean(search.ignoreKeyCS),
            regExp: Boolean(search.ignoreKeyRegExp),
            title: Boolean(search.ignoreTitle),
            description: Boolean(search.ignoreDescription),
            extended: Boolean(search.ignoreExtended),
        };

        // keyword option
        if (!checkKeywordOption(search, keyOption, false) || !checkKeywordOption(search, ignoreKeyOption, true)) {
            return false;
        }

        const broadcasts = {
            GR: Boolean(search.GR),
            BS: Boolean(search.BS),
            CS: Boolean(search.CS),
            SKY: Boolean(search.SKY),
        };

        // station & broadcast
        if (typeof search.station === 'undefined') {
            // station が無効のときは broadcast を1 つ以上有効化する
            if (!broadcasts.GR && !broadcasts.BS && !broadcasts.CS && !broadcasts.SKY) { return false; }
        } else {
            // sataion が有効のときは broadcas の指定は無し
            if (broadcasts.GR || broadcasts.BS || broadcasts.CS || broadcasts.SKY) { return false; }
        }

        // genre
        if (typeof search.genrelv1 !== 'undefined' && !(0x0 <= search.genrelv1 && search.genrelv1 <= 0xF)) { return false; }
        if (typeof search.genrelv2 !== 'undefined' && !(0x0 <= search.genrelv2 && search.genrelv2 <= 0xF)) { return false; }

        // startTime
        if (typeof search.startTime !== 'undefined' && !(0 <= search.startTime && search.startTime <= 23)) { return false; }

        // timeRange
        if (typeof search.startTime === 'undefined' && typeof search.timeRange !== 'undefined') { return false; }
        if (typeof search.startTime !== 'undefined' && typeof search.timeRange === 'undefined') { return false; }
        if (typeof search.startTime !== 'undefined' && typeof search.timeRange !== 'undefined' && !(1 <= search.timeRange && search.timeRange <= 23)) { return false; }

        // week
        if (typeof search.week === 'undefined' || search.week === 0) { return false; }

        // duration
        if (typeof search.durationMin !== 'undefined' && search.durationMin < 0) { return false; }
        if (typeof search.durationMax !== 'undefined' && search.durationMax < 0) { return false; }
        if (typeof search.durationMin !== 'undefined' && typeof search.durationMax !== 'undefined' && search.durationMin > search.durationMax) { return false; }

        return true;
    };

    /**
     * check keyword option
     * @param search: SearchInterface
     * @param keyOption: KeywordOption
     * @param isIgnoreKeyword: boolean
     * @return boolean keyword option が正しくない場合 false を返す
     */
    const checkKeywordOption = (search: SearchInterface, keyOption: KeywordOption, isIgnoreKeyword: boolean): boolean => {
        if (typeof (isIgnoreKeyword ? search.ignoreKeyword : search.keyword) !== 'undefined') {
            if (!keyOption.cs && !keyOption.regExp && !keyOption.title && !keyOption.description && !keyOption.extended) {
                return false;
            } else {
                if (!keyOption.title && !keyOption.description && !keyOption.extended) { return false; }
            }
        } else if (keyOption.cs || keyOption.regExp || keyOption.title || keyOption.description || keyOption.extended) {
            return false;
        }

        return true;
    };

    /**
     * ルールの option 部分をチェックする
     * @param option: OptionInterface
     * @return true: 追加可能なルール false: 追加不可能なルール
     */
    export const checkRuleOption = (option: OptionInterface): boolean => {
        if (typeof option.enable === 'undefined') { return false; }

        return true;
    };

    /**
     * encode オプションをチェックする
     * @param option: EncodeInterface
     * @return true: 追加可能なルール false: 追加不可能なルール
     */
    export const checkEncodeOption = (option: EncodeInterface): boolean => {
        const encodeConfig = Configuration.getInstance().getConfig().encode;
        if (typeof encodeConfig === 'undefined') { return false; }

        if (typeof option.mode1 !== 'undefined' && typeof encodeConfig[option.mode1] === 'undefined') { return false; }
        if (typeof option.mode2 !== 'undefined' && typeof encodeConfig[option.mode2] === 'undefined') { return false; }
        if (typeof option.mode3 !== 'undefined' && typeof encodeConfig[option.mode3] === 'undefined') { return false; }
        if (typeof option.mode1 === 'undefined' && typeof option.directory1 !== 'undefined') { return false; }
        if (typeof option.mode2 === 'undefined' && typeof option.directory2 !== 'undefined') { return false; }
        if (typeof option.mode3 === 'undefined' && typeof option.directory3 !== 'undefined') { return false; }

        return true;
    };

    /**
     * RulesSchema から searchInterface を生成する
     * @param rule: DBSchema.RulesSchema
     * @return SearchInterface
     */
    export const createSearchOption = (rule: DBSchema.RulesSchema): SearchInterface => {
        const search: SearchInterface = {
            week: rule.week,
            avoidDuplicate: rule.avoidDuplicate,
        };

        if (rule.keyword !== null) { search.keyword = rule.keyword; }
        if (rule.ignoreKeyword !== null) { search.ignoreKeyword = rule.ignoreKeyword; }
        if (rule.keyCS !== null) { search.keyCS = rule.keyCS; }
        if (rule.keyRegExp !== null) { search.keyRegExp = rule.keyRegExp; }
        if (rule.title !== null) { search.title = rule.title; }
        if (rule.description !== null) { search.description = rule.description; }
        if (rule.extended !== null) { search.extended = rule.extended; }
        if (rule.ignoreKeyCS !== null) { search.ignoreKeyCS = rule.ignoreKeyCS; }
        if (rule.ignoreKeyRegExp !== null) { search.ignoreKeyRegExp = rule.ignoreKeyRegExp; }
        if (rule.ignoreTitle !== null) { search.ignoreTitle = rule.ignoreTitle; }
        if (rule.ignoreDescription !== null) { search.ignoreDescription = rule.ignoreDescription; }
        if (rule.ignoreExtended !== null) { search.ignoreExtended = rule.ignoreExtended; }
        if (rule.GR !== null) { search.GR = rule.GR; }
        if (rule.BS !== null) { search.BS = rule.BS; }
        if (rule.CS !== null) { search.CS = rule.CS; }
        if (rule.SKY !== null) { search.SKY = rule.SKY; }
        if (rule.station !== null) { search.station = rule.station; }
        if (rule.genrelv1 !== null) { search.genrelv1 = rule.genrelv1; }
        if (rule.genrelv2 !== null) { search.genrelv2 = rule.genrelv2; }
        if (rule.startTime !== null) { search.startTime = rule.startTime; }
        if (rule.timeRange !== null) { search.timeRange = rule.timeRange; }
        if (rule.isFree !== null) { search.isFree = rule.isFree; }
        if (rule.durationMin !== null) { search.durationMin = rule.durationMin; }
        if (rule.durationMax !== null) { search.durationMax = rule.durationMax; }
        if (rule.periodToAvoidDuplicate !== null) { search.periodToAvoidDuplicate = rule.periodToAvoidDuplicate; }

        return search;
    };

    /**
     * RulesSchema から EncodeInterface を生成する
     * @param rule: DBSchema.RulesSchema
     * @return OptionInterface | null
     */
    export const createEncodeOption = (rule: DBSchema.RulesSchema): EncodeInterface | null => {
        if (rule.delTs === null) { return null; }

        const encode: EncodeInterface = {
            delTs: rule.delTs,
        };

        if (rule.mode1 !== null) { encode.mode1 = rule.mode1; }
        if (rule.directory1 !== null) { encode.directory1 = rule.directory1; }
        if (rule.mode2 !== null) { encode.mode2 = rule.mode2; }
        if (rule.directory2 !== null) { encode.directory2 = rule.directory2; }
        if (rule.mode3 !== null) { encode.mode3 = rule.mode3; }
        if (rule.directory3 !== null) { encode.directory3 = rule.directory3; }

        return encode;
    };

    /**
     * RulesSchema から OptionInterface を生成する
     * @param rule: DBSchema.RulesSchema
     * @return OptionInterface
     */
    export const createOption = (rule: DBSchema.RulesSchema): ReserveOptionInterface | null => {
        const option: ReserveOptionInterface = {};

        if (rule.directory !== null) { option.directory = rule.directory; }
        if (rule.recordedFormat !== null) { option.recordedFormat = rule.recordedFormat; }

        return option;
    };

    /**
     * RuleInterface を DBSchema.RulesSchema へ変換する
     * @param rule: RuleInterface
     * @return DBSchema.RulesSchema
     */
    export const convertRule = (rule: RuleInterface): DBSchema.RulesSchema => {
        const data: DBSchema.RulesSchema = {
            id: 0,
            keyword: typeof rule.search.keyword === 'undefined' ? null : rule.search.keyword,
            ignoreKeyword: typeof rule.search.ignoreKeyword === 'undefined' ? null : rule.search.ignoreKeyword,
            keyCS: typeof rule.search.keyCS === 'undefined' ? null : rule.search.keyCS,
            keyRegExp: typeof rule.search.keyRegExp === 'undefined' ? null : rule.search.keyRegExp,
            title: typeof rule.search.title === 'undefined' ? null : rule.search.title,
            description: typeof rule.search.description === 'undefined' ? null : rule.search.description,
            extended: typeof rule.search.extended === 'undefined' ? null : rule.search.extended,
            ignoreKeyCS: typeof rule.search.ignoreKeyCS === 'undefined' ? null : rule.search.ignoreKeyCS,
            ignoreKeyRegExp: typeof rule.search.ignoreKeyRegExp === 'undefined' ? null : rule.search.ignoreKeyRegExp,
            ignoreTitle: typeof rule.search.ignoreTitle === 'undefined' ? null : rule.search.ignoreTitle,
            ignoreDescription: typeof rule.search.ignoreDescription === 'undefined' ? null : rule.search.ignoreDescription,
            ignoreExtended: typeof rule.search.ignoreExtended === 'undefined' ? null : rule.search.ignoreExtended,
            GR: typeof rule.search.GR === 'undefined' ? null : rule.search.GR,
            BS: typeof rule.search.BS === 'undefined' ? null : rule.search.BS,
            CS: typeof rule.search.CS === 'undefined' ? null : rule.search.CS,
            SKY: typeof rule.search.SKY === 'undefined' ? null : rule.search.SKY,
            station: typeof rule.search.station === 'undefined' ? null : rule.search.station,
            genrelv1: typeof rule.search.genrelv1 === 'undefined' ? null : rule.search.genrelv1,
            genrelv2: typeof rule.search.genrelv2 === 'undefined' ? null : rule.search.genrelv2,
            startTime: typeof rule.search.startTime === 'undefined' ? null : rule.search.startTime,
            timeRange: typeof rule.search.timeRange === 'undefined' ? null : rule.search.timeRange,
            week: rule.search.week,
            isFree: typeof rule.search.isFree === 'undefined' ? null : rule.search.isFree,
            durationMin: typeof rule.search.durationMin === 'undefined' ? null : rule.search.durationMin,
            durationMax: typeof rule.search.durationMax === 'undefined' ? null : rule.search.durationMax,
            avoidDuplicate: typeof rule.search.avoidDuplicate === 'undefined' ? false : rule.search.avoidDuplicate,
            periodToAvoidDuplicate: typeof rule.search.periodToAvoidDuplicate === 'undefined' ? null : rule.search.periodToAvoidDuplicate,
            enable: rule.option.enable,
            allowEndLack: rule.option.allowEndLack,
            directory: typeof rule.option.directory === 'undefined' ? null : rule.option.directory,
            recordedFormat: typeof rule.option.recordedFormat === 'undefined' ? null : rule.option.recordedFormat,
            mode1: null,
            directory1: null,
            mode2: null,
            directory2: null,
            mode3: null,
            directory3: null,
            delTs: null,
        };

        if (typeof rule.encode !== 'undefined') {
            data.mode1 = typeof rule.encode.mode1 === 'undefined' ? null : rule.encode.mode1;
            data.directory1 = typeof rule.encode.directory1 === 'undefined' ? null : rule.encode.directory1;
            data.mode2 = typeof rule.encode.mode2 === 'undefined' ? null : rule.encode.mode2;
            data.directory2 = typeof rule.encode.directory2 === 'undefined' ? null : rule.encode.directory2;
            data.mode3 = typeof rule.encode.mode3 === 'undefined' ? null : rule.encode.mode3;
            data.directory3 = typeof rule.encode.directory3 === 'undefined' ? null : rule.encode.directory3;
            data.delTs = rule.encode.delTs;
        }

        return data;
    };
}

export default RuleUtil;

