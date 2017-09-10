import Base from '../Base';
import { RuleInterface, SearchInterface, OptionInterface, EncodeInterface } from '../Operator/RuleInterface';

/**
* Rule の各オプションがただしいかチェックする
*/

class CheckRule extends Base {
    public checkRule(rule: RuleInterface): boolean {
        return this.checkRuleSearch(rule.search) 
            && this.checkRuleOption(rule.option)
            && (typeof rule.encode === 'undefined' || this.checkEncodeOption(rule.encode));
    }

    /**
    * ルールの search option 部分をチェックする
    * @param search: SearchInterface
    * @return true: 追加可能なルール false: 追加不可能なルール
    */
    public checkRuleSearch(search: SearchInterface): boolean {
        //keyword
        if(typeof search.keyword !== 'undefined' && typeof search.keyword !== 'string') { return false; }
        if(typeof search.ignoreKeyword !== 'undefined' && typeof search.ignoreKeyword !== 'string') { return false; }

        let keyOption = {
            cs: Boolean(search.keyCS),
            regExp: Boolean(search.keyRegExp),
            title: Boolean(search.title),
            description: Boolean(search.description),
            extended: Boolean(search.extended),
        }

        //keyword option
        if(typeof search.keyword !== 'undefined' || typeof search.ignoreKeyword !== 'undefined') {
            if(!keyOption.cs && !keyOption.regExp && !keyOption.title && !keyOption.description && !keyOption.extended) {
                return false;
            } else {
                if(!keyOption.title && !keyOption.description && !keyOption.extended) { return false; }
            }
        } else if(keyOption.cs || keyOption.regExp || keyOption.title || keyOption.description || keyOption.extended) {
            return false;
        }

        let broadcasts = {
            GR: Boolean(search.GR),
            BS: Boolean(search.BS),
            CS: Boolean(search.CS),
            SKY: Boolean(search.SKY)
        }

        // station & broadcast
        if(typeof search.station === 'undefined') {
            // station が無効のときは broadcast を1 つ以上有効化する
            if(!broadcasts.GR && !broadcasts.BS && !broadcasts.CS && !broadcasts.SKY) { return false; }
        } else {
            // sataion が有効のときは broadcas の指定は無し
            if(broadcasts.GR || broadcasts.BS || broadcasts.CS || broadcasts.SKY) { return false; }
        }

        //genre
        if(typeof search.genrelv1 !== 'undefined' && !(0x0 <= search.genrelv1 && search.genrelv1 <= 0xF)) { return false; }
        if(typeof search.genrelv2 !== 'undefined' && !(0x0 <= search.genrelv2 && search.genrelv2 <= 0xF)) { return false; }

        //startTime
        if(typeof search.startTime !== 'undefined' && !(0 <= search.startTime && search.startTime <= 23)) { return false; }

        //timeRange
        if(typeof search.startTime === 'undefined' && typeof search.timeRange !== 'undefined') { return false; }
        if(typeof search.startTime !== 'undefined' && typeof search.timeRange === 'undefined') { return false; }
        if(typeof search.startTime !== 'undefined' && typeof search.timeRange !== 'undefined' && !(1 <= search.timeRange && search.timeRange <= 23)) { return false; }

        //week
        if(typeof search.week === 'undefined' || search.week === 0) { return false; }

        // duration
        if(typeof search.durationMin !== 'undefined' && search.durationMin < 0) { return false; }
        if(typeof search.durationMax !== 'undefined' && search.durationMax < 0) { return false; }
        if(typeof search.durationMin !== 'undefined' && typeof search.durationMax !== 'undefined' && search.durationMin > search.durationMax) { return false; }

        return true;
    }

    /**
    * ルールの option 部分をチェックする
    * @param option: OptionInterface
    * @return true: 追加可能なルール false: 追加不可能なルール
    */
    public checkRuleOption(option: OptionInterface): boolean {
        if(typeof option.enable === 'undefined') { return false; }

        return true;
    }

    /**
    * encode オプションをチェックする
    * @param option: EncodeInterface
    * @return true: 追加可能なルール false: 追加不可能なルール
    */
    public checkEncodeOption(option: EncodeInterface): boolean {
        let encodeConfig = this.config.getConfig().encode;
        if(typeof encodeConfig === 'undefined') { return false; }

        if(typeof option.mode1 !== 'undefined' && typeof encodeConfig[option.mode1] === 'undefined') { return false; }
        if(typeof option.mode2 !== 'undefined' && typeof encodeConfig[option.mode2] === 'undefined') { return false; }
        if(typeof option.mode3 !== 'undefined' && typeof encodeConfig[option.mode3] === 'undefined') { return false; }
        if(typeof option.mode1 === 'undefined' && typeof option.directory1 !== 'undefined') { return false; }
        if(typeof option.mode2 === 'undefined' && typeof option.directory2 !== 'undefined') { return false; }
        if(typeof option.mode3 === 'undefined' && typeof option.directory3 !== 'undefined') { return false; }

        return true;
    }
}

export default CheckRule;

