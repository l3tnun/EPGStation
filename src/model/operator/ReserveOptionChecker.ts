import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import IConfigFile from '../IConfigFile';
import IConfiguration from '../IConfiguration';
import IReserveOptionChecker from './IReserveOptionChecker';

export interface KeywordOption {
    cs: boolean;
    regExp: boolean;
    name: boolean;
    description: boolean;
    extended: boolean;
}

/**
 * 予約オプションチェッカー
 */
@injectable()
export default class ReserveOptionChecker implements IReserveOptionChecker {
    private conf: IConfiguration;

    constructor(@inject('IConfiguration') conf: IConfiguration) {
        this.conf = conf;
    }

    /**
     * rule オプションチェック
     * @param rule: apid.Rule | apid.AddRuleOption
     * @return boolean 問題なければ true を返す
     */
    public checkRuleOption(rule: apid.Rule | apid.AddRuleOption): boolean {
        return (
            this.checkSearchOption(rule.isTimeSpecification, rule.searchOption) &&
            this.checkReserveOption(rule.reserveOption) &&
            this.checkEncodeOption(rule.encodeOption)
        );
    }

    /**
     * rule 検索オプションチェック
     * @param isTimeSpecification: 時刻指定予約か
     * @param rule: apid.RuleSearchOption
     * @return boolean 問題なければ true を返す
     */
    private checkSearchOption(isTimeSpecification: boolean, option: apid.RuleSearchOption): boolean {
        // keyword option
        const keyOption: KeywordOption = {
            cs: !!option.keyCS,
            regExp: !!option.keyRegExp,
            name: !!option.name,
            description: !!option.description,
            extended: !!option.extended,
        };

        const ignoreKeyOption: KeywordOption = {
            cs: !!option.ignoreKeyCS,
            regExp: !!option.ignoreKeyRegExp,
            name: !!option.ignoreName,
            description: !!option.ignoreDescription,
            extended: !!option.ignoreExtended,
        };

        // 時刻指定予約
        if (isTimeSpecification === true) {
            if (
                typeof option.keyword === 'undefined' ||
                typeof option.channelIds === 'undefined' ||
                typeof option.times === 'undefined'
            ) {
                return false;
            }

            for (const time of option.times) {
                if (
                    typeof time.start === 'undefined' ||
                    typeof time.range === 'undefined' ||
                    0 > time.start ||
                    0 >= time.range
                ) {
                    return false;
                }
            }

            return true;
        }

        if (
            this.checkKeywordOption(option.keyword, keyOption) === false ||
            this.checkKeywordOption(option.ignoreKeyword, ignoreKeyOption) === false
        ) {
            return false;
        }

        // channel と 放送局
        if (typeof option.channelIds !== 'undefined') {
            // channleIds が有効な場合は false でないといけない
            if (!!option.GR === true || !!option.BS === true || !!option.CS === true || !!option.SKY === true) {
                return false;
            }
        }

        // genre
        if (typeof option.genres !== 'undefined') {
            for (const genre of option.genres) {
                if (
                    (0x00 <= genre.genre && genre.genre <= 0xf) === false ||
                    (typeof genre.subGenre !== 'undefined' &&
                        (0x00 <= genre.subGenre && genre.subGenre <= 0xf) === false)
                ) {
                    return false;
                }
            }
        }

        // times
        if (typeof option.times !== 'undefined') {
            for (const time of option.times) {
                if (time.week === 0) {
                    return false;
                }
                if (typeof time.start !== 'undefined' && typeof time.range !== 'undefined') {
                    // id 指定予約
                    if ((0 <= time.start && time.start <= 23) === false) {
                        return false;
                    } else if ((1 <= time.range && time.range <= 23) === false) {
                        return false;
                    }
                }
            }
        }

        // duration
        if (typeof option.durationMin !== 'undefined' && option.durationMin < 0) {
            return false;
        }
        if (typeof option.durationMax !== 'undefined' && option.durationMax < 0) {
            return false;
        }
        if (
            typeof option.durationMin !== 'undefined' &&
            typeof option.durationMax !== 'undefined' &&
            option.durationMin > option.durationMax
        ) {
            return false;
        }

        return true;
    }

    /**
     * キーワード検索オプションのチェック
     * @param keyword: string | undefined
     * @param option: KeywordOption
     * @return boolean 問題なければ true を返す
     */
    private checkKeywordOption(keyword: string | undefined, option: KeywordOption): boolean {
        if (typeof keyword !== 'undefined') {
            if (
                option.cs === false &&
                option.regExp === false &&
                option.name === false &&
                option.description === false &&
                option.extended === false
            ) {
                return false;
            } else {
                if (option.name === false && option.description === false && option.extended === false) {
                    return false;
                }
            }
        } else if (
            option.cs === true ||
            option.regExp === true ||
            option.name === true ||
            option.description === true ||
            option.extended === true
        ) {
            return false;
        }

        return true;
    }

    /**
     * 保存オプションチェック
     * @param option: apid.RuleReserveOption
     * @return boolean 問題がなければ true を返す
     */
    public checkReserveOption(option: apid.RuleReserveOption): boolean {
        // 重複
        if (typeof option.periodToAvoidDuplicate !== 'undefined' && option.avoidDuplicate === false) {
            return false;
        }

        return true;
    }

    /**
     * エンコードオプションチェック
     * @param option: apid.ReserveEncodedOption | undefined
     * @return boolean 問題がなければ true を返す
     */
    public checkEncodeOption(option: apid.ReserveEncodedOption | undefined): boolean {
        if (typeof option === 'undefined') {
            return true;
        }

        const config = this.conf.getConfig();
        if (typeof config.encode === 'undefined') {
            // エンコードオプションが存在しないため
            return false;
        }

        // prettier-ignore
        if (typeof option.mode1 !== 'undefined' && this.hasEncodeMode(config, option.mode1) === false) { return false; }
        // prettier-ignore
        if (typeof option.mode2 !== 'undefined' && this.hasEncodeMode(config, option.mode2) === false) { return false; }
        // prettier-ignore
        if (typeof option.mode3 !== 'undefined' && this.hasEncodeMode(config, option.mode3) === false) { return false; }
        // prettier-ignore
        if (typeof option.mode1 === 'undefined' && typeof option.directory1 !== 'undefined') { return false; }
        // prettier-ignore
        if (typeof option.mode2 === 'undefined' && typeof option.directory2 !== 'undefined') { return false; }
        // prettier-ignore
        if (typeof option.mode3 === 'undefined' && typeof option.directory3 !== 'undefined') { return false; }

        return true;
    }

    /**
     * config の中に指定された名前の encode mode が存在するかチェック
     * @param config: IConfigFile
     * @param mode: string mode name
     * @return boolean true なら存在する
     */
    private hasEncodeMode(config: IConfigFile, mode: string): boolean {
        for (const e of config.encode) {
            if (e.name === mode) {
                return true;
            }
        }

        return false;
    }
}
