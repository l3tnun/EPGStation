import * as events from 'events';
import RuleUtil from '../../../Util/RuleUtil';
import { RulesDBInterface } from '../../DB/RulesDB';
import Model from '../../Model';
import { RuleInterface } from '../RuleInterface';

interface RuleManageModelInterface extends Model {
    addListener(callback: (ruleId: number, status: RuleEventStatus) => void): void;
    add(rule: RuleInterface): Promise<number>;
    update(ruleId: number, rule: RuleInterface): Promise<void>;
    enable(ruleId: number): Promise<void>;
    disable(ruleId: number): Promise<void>;
    delete(ruleId: number): Promise<void>;
}

type RuleEventStatus = 'add' | 'update' | 'enable' | 'disable' | 'delete';

/**
 * 録画ルールの管理を行う
 * @throws RuleManageModelCreateError init が呼ばれていないとき
 */
class RuleManageModel extends Model implements RuleManageModelInterface {
    private isRunning: boolean = false;
    private listener: events.EventEmitter = new events.EventEmitter();
    private rulesDB: RulesDBInterface;

    constructor(rulesDB: RulesDBInterface) {
        super();
        this.rulesDB = rulesDB;
    }

    /**
     * ルール更新時に実行されるイベントに追加
     * @param callback ルール更新時に実行される
     */
    public addListener(callback: (ruleId: number, status: RuleEventStatus) => void): void {
        this.listener.on(RuleManageModel.RULE_UPDATE_EVENT, (ruleId: number, status: RuleEventStatus) => {
            try {
                callback(ruleId, status);
            } catch (err) {
                this.log.system.error(<any> err);
            }
        });
    }

    /**
     * ルール追加
     * @param rule: RuleInterface
     * @throws RuleManageModelIsRunning 他で実行中
     * @throws AddRuleError 追加しようとしたルールに問題がある場合
     * @return Promise<number> 追加した rule の id が格納される
     */
    public async add(rule: RuleInterface): Promise<number> {
        if (this.isRunning) { throw new Error(RuleManageModel.RunningError); }
        this.isRunning = true;

        // option のチェック
        if (RuleUtil.checkRule(rule)) {
            // rule を DB に追加
            let ruleId: number;
            try {
                ruleId = await this.rulesDB.insert(RuleUtil.convertRule(rule));
            } catch (err) {
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
        if (this.isRunning) { throw new Error(RuleManageModel.RunningError); }
        this.isRunning = true;

        // rule が存在するか db 上から検索
        try {
            if (await this.rulesDB.findId(ruleId) === null) { throw new Error('RuleIsNotFound'); }
        } catch (err) {
            this.isRunning = false;
            throw err;
        }

        // option のチェック
        if (RuleUtil.checkRule(rule)) {
            // rule 更新
            try {
                await this.rulesDB.update(ruleId, RuleUtil.convertRule(rule));
            } catch (err) {
                this.log.system.error(`rule update error: ${ ruleId }`);
                this.log.system.error(<any> err);
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
     * @throws RuleManageModelIsRunning 他で実行中
     * @return Promise<void>;
     */
    public async enable(ruleId: number): Promise<void> {
        if (this.isRunning) { throw new Error(RuleManageModel.RunningError); }
        this.isRunning = true;

        try {
            await this.rulesDB.enable(ruleId);
        } catch (err) {
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
     * @throws RuleManageModelIsRunning 他で実行中
     * @return Promise<void>;
     */
    public async disable(ruleId: number): Promise<void> {
        if (this.isRunning) { throw new Error(RuleManageModel.RunningError); }
        this.isRunning = true;

        try {
            await this.rulesDB.disable(ruleId);
        } catch (err) {
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
     * @throws RuleManageModelIsRunning 他で実行中
     * @return Promise<void>;
     */
    public async delete(ruleId: number): Promise<void> {
        if (this.isRunning) { throw new Error(RuleManageModel.RunningError); }
        this.isRunning = true;

        try {
            await this.rulesDB.delete(ruleId);
        } catch (err) {
            this.isRunning = false;
            throw err;
        }

        this.log.system.info(`delete Rule: ${ ruleId }`);
        this.eventsNotify(ruleId, 'delete');
        this.isRunning = false;
    }

    /**
     * ルール変更を通知
     * @param ruleId: rule id
     * @param status: status
     */
    private eventsNotify(ruleId: number, status: RuleEventStatus): void {
        this.listener.emit(RuleManageModel.RULE_UPDATE_EVENT, ruleId, status);
    }
}

namespace RuleManageModel {
    export const RULE_UPDATE_EVENT = 'updateRules';
    export const RunningError = 'RuleManageModelIsRunning';
}

export { RuleEventStatus, RuleManageModelInterface, RuleManageModel };

