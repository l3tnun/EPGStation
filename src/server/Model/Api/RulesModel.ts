import * as DBSchema from '../DB/DBSchema';
import { RecordedDBInterface } from '../DB/RecordedDB';
import { RuleFindQuery, RulesDBInterface } from '../DB/RulesDB';
import { IPCClientInterface } from '../IPC/IPCClient';
import { RuleInterface } from '../Operator/RuleInterface';
import { EncodeManageModelInterface } from '../Service/Encode/EncodeManageModel';
import { RecordedStreamStatusInfo, StreamManageModelInterface } from '../Service/Stream/StreamManageModel';
import ApiModel from './ApiModel';
import ApiUtil from './ApiUtil';

interface RulesModelInterface extends ApiModel {
    getAll(limit: number | undefined, offset: number, query?: RuleFindQuery): Promise<{}[]>;
    getId(ruleId: number): Promise<{}>;
    getRuleList(): Promise<{}[]>;
    disableRule(ruleId: number): Promise<void>;
    enableRule(ruleId: number): Promise<void>;
    deleteRule(ruleId: number, isDeleteFile: boolean): Promise<void>;
    deleteRules(ruleIds: number[], isDeleteFile: boolean): Promise<void>;
    addRule(rule: RuleInterface): Promise<{ id: number }>;
    updateRule(ruleId: number, rule: RuleInterface): Promise<void>;
}

namespace RulesModelInterface {
    export const NotFoundRuleIdError = 'NotFoundRuleId';
}

class RulesModel extends ApiModel implements RulesModelInterface {
    private ipc: IPCClientInterface;
    private recordedDB: RecordedDBInterface;
    private rulesDB: RulesDBInterface;
    private encodeManage: EncodeManageModelInterface;
    private streamManage: StreamManageModelInterface;

    constructor(
        ipc: IPCClientInterface,
        recordedDB: RecordedDBInterface,
        rulesDB: RulesDBInterface,
        encodeManage: EncodeManageModelInterface,
        streamManage: StreamManageModelInterface,
    ) {
        super();
        this.ipc = ipc;
        this.recordedDB = recordedDB;
        this.rulesDB = rulesDB;
        this.encodeManage = encodeManage;
        this.streamManage = streamManage;
    }

    /**
     * rule をすべて取得
     * @param limit: number | undefined
     * @param offset: number
     * @param query: RuleFindQuery
     * @return Promise<any>
     */
    public async getAll(limit: number | undefined, offset: number, query: RuleFindQuery = {}): Promise<any> {
        const datas = await this.rulesDB.findAll({
            limit: limit,
            offset: offset,
            query: query,
        });
        const total = await this.rulesDB.getTotal(query);

        const results: any[] = [];
        datas.forEach((result: DBSchema.RulesSchema) => {
            results.push(ApiUtil.deleteNullinHash(result));
        });

        return {
            rules: results,
            total: total,
        };
    }

    /**
     * rule を id 取得
     * @param ruleId: rule id
     * @return Promise<{}>
     */
    public async getId(ruleId: number): Promise<{}> {
        const rule = await this.rulesDB.findId(ruleId);

        if (rule === null) {
            throw new Error(RulesModelInterface.NotFoundRuleIdError);
        }

        return ApiUtil.deleteNullinHash(rule);
    }

    /**
     * rule list を取得
     * @return Promise<{}[]>
     */
    public async getRuleList(): Promise<{}[]> {
        const list = await this.rulesDB.getList();

        return list.map((l) => {
            return ApiUtil.deleteNullinHash(l);
        });
    }

    /**
     * rule を無効化
     * @param ruleId: rule id
     * @return Promise<void>
     */
    public async disableRule(ruleId: number): Promise<void> {
        await this.ipc.ruleDisable(ruleId);
    }

    /**
     * rule を有効化
     * @param ruleId: rule id
     * @return Promise<void>
     */
    public async enableRule(ruleId: number): Promise<void> {
        await this.ipc.ruleEnable(ruleId);
    }

    /**
     * rule を削除
     * @param ruleId: rule id
     * @param isDeleteFile: 録画ファイルを削除するか
     * @return Promise<void>
     */
    public async deleteRule(ruleId: number, isDeleteFile: boolean): Promise<void> {
        if (isDeleteFile) {
            // 削除する recordedIds を取得
            const list = await this.recordedDB.findRuleIdList(ruleId);
            const recordedIds: number[] = [];
            for (const l of list) { recordedIds.push(l.id); }

            // 削除
            await this.deleteRecordeds(recordedIds);
        }

        await this.ipc.ruleDelete(ruleId);
    }

    /**
     * 指定した recordedId の録画を削除する
     * @param recordedIds: recorded ids
     * @return Promise<number[]> 削除に失敗した recordedId を返す
     */
    private async deleteRecordeds(recordedIds: number[]): Promise<number[]> {
        // 配信中の録画の recordedId の索引を作成
        const infos = this.streamManage.getStreamInfos();
        const recordedStreamIndex: { [key: number]: boolean } = {};
        for (const info of infos) {
            if (typeof (<RecordedStreamStatusInfo> info).recordedId !== 'undefined') {
                recordedStreamIndex[(<RecordedStreamStatusInfo> info).recordedId!] = true;
            }
        }

        // 配信中の要素を取り除く
        const ids: number[] = [];
        const excludedIds: number[] = [];
        for (const recordedId of recordedIds) {
            // 配信中でないか?
            if (typeof recordedStreamIndex[recordedId] === 'undefined') {
                // cancel encode
                this.encodeManage.cancelByRecordedId(recordedId);
                ids.push(recordedId);
            } else {
                excludedIds.push(recordedId);
            }
        }

        // 録画削除
        const errors = await this.ipc.recordedDeletes(ids, null);

        // 削除できなかった ids と配信中で取り除かれた要素を結合
        Array.prototype.push.apply(excludedIds, errors);

        return excludedIds;
    }

    /**
     * 複数の rule を削除
     * @param ruleIds: rule ids
     * @param isDeleteFile: 録画ファイルを削除するか
     * @return Promise<void>
     */
    public async deleteRules(ruleIds: number[], isDeleteFile: boolean): Promise<void> {
        if (isDeleteFile) {
            // 削除する recordedIds を取得
            const recordedIds: number[] = [];
            for (const ruleId of ruleIds) {
                const list = await this.recordedDB.findRuleIdList(ruleId);
                for (const l of list) { recordedIds.push(l.id); }
            }

            // 削除
            await this.deleteRecordeds(recordedIds);
        }

        await this.ipc.ruleDeletes(ruleIds);
    }

    /**
     * rule を追加
     * @param rule: RuleInterface
     * @return Promise<{ id: number }>: rule id
     */
    public async addRule(rule: RuleInterface): Promise<{ id: number }> {
        const ruleId = await this.ipc.ruleAdd(rule);

        return { id: ruleId };
    }

    /**
     * rule を更新
     * @param ruleId: rule id
     * @param rule: RuleInterface
     * @return Promise<void>
     */
    public async updateRule(ruleId: number, rule: RuleInterface): Promise<void> {
        await this.ipc.ruleUpdate(ruleId, rule);
    }
}

export { RulesModelInterface, RulesModel };

