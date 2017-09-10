import * as events from 'events';
import Base from '../Base';
import { RuleInterface } from './RuleInterface';
import { RulesDBInterface } from '../Model/DB/RulesDB';
import * as DBSchema from '../Model/DB/DBSchema';
import CheckRule from '../Util/CheckRule';

interface RuleManagerInterface {
    add(rule: RuleInterface): Promise<number>;
    update(ruleId: number, rule: RuleInterface): Promise<void>;
    enable(ruleId: number): Promise<void>;
    disable(ruleId: number): Promise<void>;
    delete(ruleId: number): Promise<void>;
}

type RuleEventStatus = 'add' | 'update' | 'enable' | 'disable' | 'delete'

/**
* 録画ルールの管理を行う
* @throws RuleManagerCreateError init が呼ばれていないとき
*/
class RuleManager extends Base implements RuleManagerInterface {
    private static instance: RuleManager;
    private static inited: boolean = false;
    private isRunning: boolean = false;
    private listener: events.EventEmitter = new events.EventEmitter();
    private rulesDB: RulesDBInterface;

    public static getInstance(): RuleManager {
        if(!this.inited) {
            throw new Error('RuleManagerCreateError');
        }

        return this.instance;
    }

    public static init(rulesDB: RulesDBInterface): void {
        if(this.inited) { return; }
        this.instance = new RuleManager(rulesDB);
        this.inited = true;
    }

    private constructor(rulesDB: RulesDBInterface) {
        super();
        this.rulesDB = rulesDB;
    }

    /**
    * ルール更新時に実行されるイベントに追加
    @param callback ルール更新時に実行される
    */
    public addListener(callback: (ruleId: number, status: RuleEventStatus) => void): void {
        this.listener.on(RuleManager.RULE_UPDATE_EVENT, (ruleId: number, status: RuleEventStatus) => { callback(ruleId, status); });
    }

    /**
    * ルール追加
    * @param rule: RuleInterface
    * @throws RuleManagerIsRunning 他で実行中
    * @throws AddRuleError 追加しようとしたルールに問題がある場合
    * @return Promise<number> 追加した rule の id が格納される
    */
    public async add(rule: RuleInterface): Promise<number> {
        if(this.isRunning) { throw new Error(RuleManager.RunningError); }
        this.isRunning = true;

        // option のチェック
        if(new CheckRule().checkRule(rule)) {
            // rule を DB に追加
            let ruleId: number;
            try {
                let result = await this.rulesDB.insert(this.convertRule(rule));
                ruleId = <number>(result.insertId);
            } catch(err) {
                this.isRunning = false;
                throw err;
            }
            this.log.system.info('add New Rule');
            this.eventsNotify(ruleId, 'add');
            this.isRunning = false;

            return ruleId;
        } else {
            this.isRunning = false;
            this.log.system.info('add New Rule failed');
            throw new Error('AddRuleError');
        }
    }

    /**
    * ルールの更新
    * @param ruleId: rule id
    * @param rule: RuleInterface
    * @throws UpdateRuleError 追加しようとしたルールに問題がある場合
    * @return Promise<void>
    */
    public async update(ruleId: number, rule: RuleInterface): Promise<void> {
        if(this.isRunning) { throw new Error(RuleManager.RunningError); }
        this.isRunning = true;

        // rule が存在するか db 上から検索
        let result: DBSchema.RulesSchema[];
        try {
            result = await this.rulesDB.findId(ruleId);
        } catch(err) {
            this.isRunning = false;
            throw err;
        }

        // option のチェック
        if(new CheckRule().checkRule(rule)) {
            // rule 更新
            try {
                await this.rulesDB.update(ruleId, this.convertRule(rule));
            } catch(err) {
                this.isRunning = false;
                throw err;
            }
            this.isRunning = false;

            this.log.system.info('update Rule');
            this.eventsNotify(ruleId, 'update');
        } else {
            this.isRunning = false;
            this.log.system.info('update Rule failed');
            throw new Error('UpdateRuleError');
        }
    }
  
    /**
    * ルールの有効化
    * @param id: number
    * @throws RuleManagerIsRunning 他で実行中
    * @return Promise<void>;
    */
    public async enable(ruleId: number): Promise<void> {
        if(this.isRunning) { throw new Error(RuleManager.RunningError); }
        this.isRunning = true;

        try {
            await this.rulesDB.enable(ruleId);
        } catch(err) {
            this.isRunning = false;
            throw err;
        }

        this.log.system.info(`enable Rule: ${ ruleId }`);
        this.eventsNotify(ruleId, 'enable');
        this.isRunning = false;
    }

    /**
    * ルールの無効化
    * @param id: number
    * @throws RuleManagerIsRunning 他で実行中
    * @return Promise<void>;
    */
    public async disable(ruleId: number): Promise<void> {
        if(this.isRunning) { throw new Error(RuleManager.RunningError); }
        this.isRunning = true;

        try {
            await this.rulesDB.disable(ruleId);
        } catch(err) {
            this.isRunning = false;
            throw err;
        }

        this.log.system.info(`disable Rule: ${ ruleId }`);
        this.eventsNotify(ruleId, 'disable');
        this.isRunning = false;
    }

    /**
    * ルールの削除
    * @param id: number
    * @throws RuleManagerIsRunning 他で実行中
    * @return Promise<void>;
    */
    public async delete(ruleId: number): Promise<void> {
        if(this.isRunning) { throw new Error(RuleManager.RunningError); }
        this.isRunning = true;

        try {
            await this.rulesDB.delete(ruleId);
        } catch(err) {
            this.isRunning = false;
            throw err;
        }

        this.log.system.info(`delete Rule: ${ ruleId }`);
        this.eventsNotify(ruleId, 'delete');
        this.isRunning = false;
    }

    /**
    * RuleInterface を DBSchema.RulesSchema へ変換する
    * @param rule: RuleInterface
    * @return DBSchema.RulesSchema
    */
    private convertRule(rule: RuleInterface): DBSchema.RulesSchema {
        let data: DBSchema.RulesSchema = {
            id: 0,
            keyword: typeof rule.search.keyword === 'undefined' ? null : rule.search.keyword,
            ignoreKeyword: typeof rule.search.ignoreKeyword === 'undefined' ? null : rule.search.ignoreKeyword,
            keyCS: typeof rule.search.keyCS === 'undefined' ? null : rule.search.keyCS,
            keyRegExp: typeof rule.search.keyRegExp === 'undefined' ? null : rule.search.keyRegExp,
            title: typeof rule.search.title === 'undefined' ? null : rule.search.title,
            description: typeof rule.search.description === 'undefined' ? null : rule.search.description,
            extended: typeof rule.search.extended === 'undefined' ? null : rule.search.extended,
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
            enable: rule.option.enable,
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

        if(typeof rule.encode !== 'undefined') {
            data.mode1 = typeof rule.encode.mode1 === 'undefined' ? null : rule.encode.mode1;
            data.directory1 = typeof rule.encode.directory1 === 'undefined' ? null : rule.encode.directory1;
            data.mode2 = typeof rule.encode.mode2 === 'undefined' ? null : rule.encode.mode2;
            data.directory2 = typeof rule.encode.directory2 === 'undefined' ? null : rule.encode.directory2;
            data.mode3 = typeof rule.encode.mode3 === 'undefined' ? null : rule.encode.mode3;
            data.directory3 = typeof rule.encode.directory3 === 'undefined' ? null : rule.encode.directory3;
            data.delTs = rule.encode.delTs;
        }

        return data;
    }

    /**
    * ルール変更を通知
    * @param ruleId: rule id
    * @param status: status
    */
    private eventsNotify(ruleId: number, status: RuleEventStatus): void {
        this.listener.emit(RuleManager.RULE_UPDATE_EVENT, ruleId, status)
    }
}

namespace RuleManager {
    export const RULE_UPDATE_EVENT = 'updateRules';
    export const RunningError = 'RuleManagerIsRunning';
}

export { RuleEventStatus, RuleManagerInterface, RuleManager };

