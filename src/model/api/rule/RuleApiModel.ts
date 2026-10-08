import { inject, injectable, unmanaged } from 'inversify';
import type * as apid from '../../../../api.js';
import IReserveDB from '../../db/IReserveDB.js';
import IRuleDB from '../../db/IRuleDB.js';
import IIPCClient from '../../ipc/IIPCClient.js';
import IRuleApiModel from './IRuleApiModel.js';
import IRuleReservationCountPort from './IRuleReservationCountPort.js';

const isReservationCountPort = (source: IReserveDB | IRuleReservationCountPort): source is IRuleReservationCountPort =>
    'countByRuleIds' in source;

const adaptReserveDB = (reserveDB: IReserveDB): IRuleReservationCountPort => ({
    async countByRuleIds(ruleIds, state) {
        const counts = await reserveDB.countRuleIds([...ruleIds], state);
        return counts.map(count => ({ ruleId: count.ruleId, count: count.ruleIdCnt }));
    },
});

/** `IRuleApiModel` の実装。詳細は `IRuleApiModel` を参照。 */
@injectable()
export default class RuleApiModel implements IRuleApiModel {
    private ipc: IIPCClient;
    private ruleDB: IRuleDB;
    private reservationCountPort: IRuleReservationCountPort;

    constructor(
        @inject('IIPCClient') ipc: IIPCClient,
        @inject('IRuleDB') ruleDB: IRuleDB,
        @inject('IReserveDB') reserveDBOrCountPort: IReserveDB | IRuleReservationCountPort,
        @unmanaged() reservationCountPort?: IRuleReservationCountPort,
    ) {
        this.ipc = ipc;
        this.ruleDB = ruleDB;
        this.reservationCountPort =
            reservationCountPort ??
            (isReservationCountPort(reserveDBOrCountPort)
                ? reserveDBOrCountPort
                : adaptReserveDB(reserveDBOrCountPort));
    }

    /**
     * ルールの追加
     * @param rule: apid.AddRuleOption
     * @return Promise<apid.RuleId>
     */
    public add(rule: apid.AddRuleOption): Promise<apid.RuleId> {
        return this.ipc.rule.add(rule);
    }

    /**
     * 指定されたルールを取得する
     * @param ruleId: apid.RuleId
     * @return Promise<apid.Rule | null>
     */
    public async get(ruleId: apid.RuleId): Promise<apid.Rule | null> {
        return await this.ruleDB.findId(ruleId, false);
    }

    /**
     * ルール情報の取得
     * @param option: apid.GetRuleOption
     * @return Promise<apid.Rules>
     */
    public async gets(option: apid.GetRuleOption): Promise<apid.Rules> {
        const [rules, total] = await this.ruleDB.findAll(option);

        if (typeof option.type !== 'undefined') {
            const ruleIds: apid.RuleId[] = (rules as apid.Rule[]).map(r => {
                return r.id;
            });

            if (ruleIds.length > 0) {
                // 予約数カウント結果取得
                const reservesCnt = await this.reservationCountPort.countByRuleIds(ruleIds, option.type);

                // 索引作成
                const reserveCntIndex: { [key: number]: number } = {};
                for (const r of reservesCnt) {
                    reserveCntIndex[r.ruleId] = r.count;
                }

                // reserveCnt セット
                for (const rule of rules) {
                    rule.reservesCnt = typeof reserveCntIndex[rule.id] === 'undefined' ? 0 : reserveCntIndex[rule.id];
                }
            }
        }

        return {
            rules,
            total,
        };
    }

    /**
     * キーワード検索
     * @param option: apid.GetRuleOption
     * @return Promise<apid.RuleKeywordItem[]>
     */
    public async searchKeyword(option: apid.GetRuleOption): Promise<apid.RuleKeywordItem[]> {
        return this.ruleDB.findKeyword(option);
    }

    /**
     * ルールの更新
     * @param rule: apid.Rule
     */
    public update(rule: apid.Rule): Promise<void> {
        return this.ipc.rule.update(rule);
    }

    /**
     * ルール有効化
     * @param ruleId: rule id
     */
    public enable(ruleId: apid.RuleId): Promise<void> {
        return this.ipc.rule.enable(ruleId);
    }

    /**
     * ルール無効化
     * @param ruleId: rule id
     */
    public disable(ruleId: apid.RuleId): Promise<void> {
        return this.ipc.rule.disable(ruleId);
    }

    /**
     * ルール削除
     * @param ruleId: rule id
     */
    public delete(ruleId: apid.RuleId): Promise<void> {
        return this.ipc.rule.delete(ruleId);
    }
}
