import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IRuleDB from '../../db/IRuleDB';
import IRuleEvent from '../../event/IRuleEvent';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IReserveOptionChecker from '../IReserveOptionChecker';
import IRuleManageModel from './IRuleManageModel';

@injectable()
export default class RuleManageModel implements IRuleManageModel {
    private isRunning: boolean = false;
    private lockTimer: NodeJS.Timeout | undefined;

    private log: ILogger;
    private optionChecker: IReserveOptionChecker;
    private ruleDB: IRuleDB;
    private ruleEvent: IRuleEvent;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IReserveOptionChecker') optionChecker: IReserveOptionChecker,
        @inject('IRuleDB') ruleDB: IRuleDB,
        @inject('IRuleEvent') ruleEvent: IRuleEvent,
    ) {
        this.log = logger.getLogger();
        this.optionChecker = optionChecker;
        this.ruleDB = ruleDB;
        this.ruleEvent = ruleEvent;
    }

    /**
     * ルールの追加
     * @param rule: apid.AddRuleOption
     * @return Promise<apid.Rule>
     */
    public async add(rule: apid.AddRuleOption): Promise<apid.RuleId> {
        this.lockExecution();

        this.log.system.info('add rule');

        // check option
        if (this.optionChecker.checkRuleOption(rule) === false) {
            this.unlockExecution();
            this.log.system.error('failed to add rule');
            throw new Error('AddRuleError');
        }

        let ruleId!: apid.RuleId;
        try {
            ruleId = await this.ruleDB.insertOnce(rule);
        } catch (err) {
            this.unlockExecution();
            this.log.system.error('insert rule error');
            this.log.system.error(err);
        }

        this.unlockExecution();
        this.log.system.info(`rule added successfully: ${ruleId}`);

        // 通知
        this.ruleEvent.emitAdded(ruleId);

        return ruleId;
    }

    /**
     * ルールの更新
     * @param rule: apid.Rule
     */
    public async update(rule: apid.Rule): Promise<void> {
        this.lockExecution();

        // rule が存在するか確認
        const oldRule = await this.ruleDB.findId(rule.id).catch(err => {
            this.unlockExecution();
            this.log.system.error(err);
            throw err;
        });

        if (oldRule === null) {
            this.unlockExecution();
            throw new Error('RuleIsNotFound');
        }

        this.log.system.info(`update rule: ${rule.id}`);

        // check option
        if (this.optionChecker.checkRuleOption(rule) === false) {
            this.unlockExecution();
            this.log.system.error('failed to update rule');
            throw new Error('UpdateRuleError');
        }

        // rule 更新
        try {
            await this.ruleDB.updateOnce(rule);
        } catch (err) {
            this.unlockExecution();
            this.log.system.error(`update rule error: ${rule.id}`);
            throw err;
        }
        this.unlockExecution();
        this.log.system.info(`rule updated successfully: ${rule.id}`);

        // 通知
        this.ruleEvent.emitUpdated(rule.id);
    }

    /**
     * ルール有効化
     * @param ruleId: rule id
     */
    public async enable(ruleId: apid.RuleId): Promise<void> {
        this.lockExecution();

        this.log.system.info(`enable rule: ${ruleId}`);

        try {
            await this.ruleDB.enableOnce(ruleId);
        } catch (err) {
            this.unlockExecution();
            this.log.system.error(`enable rule error: ${ruleId}`);
            throw err;
        }

        this.unlockExecution();
        this.log.system.info(`rule enabled successfully: ${ruleId}`);

        // 通知
        this.ruleEvent.emitEnabled(ruleId);
    }

    /**
     * ルール無効化
     * @param ruleId: rule id
     */
    public async disable(ruleId: apid.RuleId): Promise<void> {
        this.lockExecution();

        this.log.system.info(`disable rule: ${ruleId}`);

        try {
            await this.ruleDB.disableOnce(ruleId);
        } catch (err) {
            this.unlockExecution();
            this.log.system.error(`disable rule error: ${ruleId}`);
            throw err;
        }

        this.unlockExecution();
        this.log.system.info(`rule disabled successfully: ${ruleId}`);

        // 通知
        this.ruleEvent.emitDisabled(ruleId);
    }

    /**
     * ルール削除
     * @param ruleId: rule id
     */
    public async delete(ruleId: apid.RuleId): Promise<void> {
        this.lockExecution();

        this.log.system.info(`delete rule: ${ruleId}`);

        try {
            await this.ruleDB.deleteOnce(ruleId);
        } catch (err) {
            this.unlockExecution();
            this.log.system.error(`delete rule error: ${ruleId}`);
            throw err;
        }

        this.unlockExecution();
        this.log.system.info(`rule deleted successfully: ${ruleId}`);

        // 通知
        this.ruleEvent.emitDeleted(ruleId);
    }

    /**
     * ルール複数削除
     * @param ruleIds: rule ids
     * @return Promise<apid.RuleId[]> 削除出来なかった ruleId を返す
     */
    public async deletes(ruleIds: apid.RuleId[]): Promise<apid.RuleId[]> {
        const failedIds: apid.RuleId[] = [];

        this.log.system.info('deletes rule');
        for (const ruleId of ruleIds) {
            try {
                await this.delete(ruleId);
            } catch (err) {
                failedIds.push(ruleId);
            }
        }

        return failedIds;
    }

    /**
     * 実行権をロックする
     */
    private lockExecution(): void {
        if (this.isRunning === true) {
            throw new Error('RuleManageModelIsRunning');
        }
        this.isRunning = false;

        this.lockTimer = setTimeout(() => {
            this.unlockExecution();
        }, 1000 * 10);
    }

    /**
     * 実行権の開放
     */
    private unlockExecution(): void {
        this.isRunning = false;
        clearTimeout(<any>this.lockTimer);
    }
}
