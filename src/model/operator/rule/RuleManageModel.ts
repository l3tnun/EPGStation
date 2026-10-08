import { inject, injectable } from 'inversify';
import type * as apid from '../../../../api.js';
import { hasSubDirectoryOutsideRoot, INVALID_SUB_DIRECTORY_ERROR } from '../../../util/SubDirectoryUtil.js';
import IRuleDB from '../../db/IRuleDB.js';
import IRuleEvent from '../../event/IRuleEvent.js';
import ILogger from '../../ILogger.js';
import ILoggerModel from '../../ILoggerModel.js';
import IReserveOptionChecker from '../IReserveOptionChecker.js';
import IRuleManageModel from './IRuleManageModel.js';

/**
 * `IRuleManageModel` の実装。詳細は `IRuleManageModel` を参照。
 *
 * `add` / `update` / `enable` / `disable` / `delete` は呼ばれた順に1本ずつ実行する
 * 直列 queue（`mutationQueue`）を共有する。重なって呼ばれても2本目を拒否せず、1本目が
 * 成功・失敗のどちらで終わっても2本目をそのまま実行して成功させる。v2 はこの排他を
 * 持たず重なった呼び出しは並行実行されていたため、重なった場合の実行順は v2 と異なる
 * （v2: 並行、v3: 直列）が、両方とも成功する点は同じ結果になる。
 */
@injectable()
export default class RuleManageModel implements IRuleManageModel {
    /**
     * mutation を直列に実行するための queue。常に resolve する Promise として保つ
     * （個々の mutation の成否は `enqueue` が返す Promise 側で表現する）ことで、
     * 1本が reject しても queue 自体が詰まらず次の mutation を実行できるようにする。
     */
    private mutationQueue: Promise<void> = Promise.resolve();

    /**
     * queue の先頭が確定しないまま次を進めるまでの安全弁時間（ミリ秒）。
     * `ruleDB` への問い合わせは typeorm 経由の DB 通信であり、接続断や DB 側のロック
     * 待ちで応答が返らない場合を明示的な timeout なしに待ち続け得る。この値は、そうした
     * 個別の mutation が確定しない間も後続の mutation を進行させるためのものであり、
     * 先頭の mutation 自体を中断・失敗させるものではない（先頭はその後確定した時点で、
     * 自分自身の呼び出し元にだけ結果を返す）。他の呼び出し元から実行権を奪うことはない。
     */
    private static readonly QUEUE_ADVANCE_TIMEOUT_MS = 1000 * 10;

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
     * ルールを1件追加する。他の mutation と直列に実行され、検査と保存が終わるまで
     * 後続の mutation はこの呼び出しの後ろで待つ。
     * 挿入が失敗した場合は、そのエラーを記録して呼び出し元へ再送出し、追加成功の記録と追加通知は行わない。
     * @param rule 追加するルール。検査に失敗した場合は保存しない
     * @returns 保存できたときのルール id
     */
    public async add(rule: apid.AddRuleOption): Promise<apid.RuleId> {
        return this.enqueue(async () => {
            this.log.system.info('add rule');

            let ruleId: apid.RuleId;

            // 保存先の外を指すディレクトリは受け付けない
            if (hasSubDirectoryOutsideRoot(rule.saveOption, rule.encodeOption) === true) {
                this.log.system.error('failed to add rule: sub directory is outside the recorded directory');
                throw new Error(INVALID_SUB_DIRECTORY_ERROR);
            }

            // check option
            if (this.optionChecker.checkRuleOption(rule) === false) {
                this.log.system.error('failed to add rule');
                throw new Error('AddRuleError');
            }

            try {
                ruleId = await this.ruleDB.insertOnce(rule);
            } catch (err: any) {
                this.log.system.error('insert rule error');
                this.log.system.error(err);
                throw err;
            }

            this.log.system.info(`rule added successfully: ${ruleId}`);

            // 通知
            this.ruleEvent.emitAdded(ruleId);

            return ruleId;
        });
    }

    /**
     * 既存ルールを更新する。他の mutation と直列に実行され、存在確認から保存まで
     * 完了するまで後続の mutation はこの呼び出しの後ろで待つ。
     * @param rule 更新後のルール。id で既存行を引く
     */
    public async update(rule: apid.Rule): Promise<void> {
        return this.enqueue(async () => {
            // rule が存在するか確認
            const oldRule = await this.ruleDB.findId(rule.id).catch(err => {
                this.log.system.error(err);
                throw err;
            });

            if (oldRule === null) {
                throw new Error('RuleIsNotFound');
            }

            this.log.system.info(`update rule: ${rule.id}`);

            // 保存先の外を指すディレクトリは受け付けない
            if (hasSubDirectoryOutsideRoot(rule.saveOption, rule.encodeOption) === true) {
                this.log.system.error('failed to update rule: sub directory is outside the recorded directory');
                throw new Error(INVALID_SUB_DIRECTORY_ERROR);
            }

            // check option
            if (this.optionChecker.checkRuleOption(rule) === false) {
                this.log.system.error('failed to update rule');
                throw new Error('UpdateRuleError');
            }

            // rule 更新
            try {
                await this.ruleDB.updateOnce(rule);
            } catch (err: any) {
                this.log.system.error(`update rule error: ${rule.id}`);
                throw err;
            }

            this.log.system.info(`rule updated successfully: ${rule.id}`);

            // 通知
            this.ruleEvent.emitUpdated(rule.id);
        });
    }

    /**
     * ルールを有効にする。他の mutation と直列に実行され、保存が終わるまで後続の
     * mutation はこの呼び出しの後ろで待つ。
     * @param ruleId 有効にするルールの id
     */
    public async enable(ruleId: apid.RuleId): Promise<void> {
        return this.enqueue(async () => {
            this.log.system.info(`enable rule: ${ruleId}`);

            try {
                await this.ruleDB.enableOnce(ruleId);
            } catch (err: any) {
                this.log.system.error(`enable rule error: ${ruleId}`);
                throw err;
            }

            this.log.system.info(`rule enabled successfully: ${ruleId}`);

            // 通知
            this.ruleEvent.emitEnabled(ruleId);
        });
    }

    /**
     * ルールを無効にする。他の mutation と直列に実行され、保存が終わるまで後続の
     * mutation はこの呼び出しの後ろで待つ。
     * @param ruleId 無効にするルールの id
     */
    public async disable(ruleId: apid.RuleId): Promise<void> {
        return this.enqueue(async () => {
            this.log.system.info(`disable rule: ${ruleId}`);

            try {
                await this.ruleDB.disableOnce(ruleId);
            } catch (err: any) {
                this.log.system.error(`disable rule error: ${ruleId}`);
                throw err;
            }

            this.log.system.info(`rule disabled successfully: ${ruleId}`);

            // 通知
            this.ruleEvent.emitDisabled(ruleId);
        });
    }

    /**
     * ルールを1件削除する。他の mutation と直列に実行され、保存が終わるまで後続の
     * mutation はこの呼び出しの後ろで待つ。
     * @param ruleId 削除するルールの id
     */
    public async delete(ruleId: apid.RuleId): Promise<void> {
        return this.enqueue(async () => {
            this.log.system.info(`delete rule: ${ruleId}`);

            try {
                await this.ruleDB.deleteOnce(ruleId);
            } catch (err: any) {
                this.log.system.error(`delete rule error: ${ruleId}`);
                throw err;
            }

            this.log.system.info(`rule deleted successfully: ${ruleId}`);

            // 通知
            this.ruleEvent.emitDeleted(ruleId);
        });
    }

    /**
     * 呼び出された `task` を、既存の mutation queue の後ろへ1本つなげる。
     * `task` の呼び出し自体は、前段が queue を進めた時点（前段の完了時、または前段の
     * 安全弁 timeout 到達時）まで遅らせる。こうすることで `QUEUE_ADVANCE_TIMEOUT_MS` の
     * 安全弁 timer は「この task が実際に実行を始めてから」始まり、queue にまだ入っただけの
     * 待機時間を timeout に含めない。
     * 前段の task が reject しても `mutationQueue` 自体は resolve した状態へ畳み込み、
     * 後続の task を必ず実行する。前段の失敗はここで返す Promise を通じて元の
     * 呼び出し元にだけ伝わり、他の呼び出しには影響しない。
     * @param task 直列に実行する1件の mutation 本体
     * @returns task の結果。task が reject した場合は同じ理由で reject する
     */
    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        const previous = this.mutationQueue;
        let settleResult!: (value: T) => void;
        let rejectResult!: (reason?: unknown) => void;
        const result = new Promise<T>((resolve, reject) => {
            settleResult = resolve;
            rejectResult = reject;
        });

        const run = (): Promise<void> => {
            const started = task();
            started.then(settleResult, rejectResult);

            return this.waitForAdvance(started);
        };

        this.mutationQueue = previous.then(run, run);

        return result;
    }

    /**
     * queue の先頭（`settling`）が確定するか、`QUEUE_ADVANCE_TIMEOUT_MS` が経過するかの
     * どちらか早い方まで待つ。timeout で先に進めた場合でも `settling` はキャンセルされず、
     * 確定した時点でその呼び出し元へ結果を返す。timer は `unref` し、queue 自体の解決を
     * 待つだけの理由で process を起動したままにしない。
     * @param settling 先頭で実行中の mutation の Promise
     * @returns 次の mutation を開始してよくなったら resolve する、常に成功する Promise
     */
    private waitForAdvance(settling: Promise<unknown>): Promise<void> {
        return new Promise<void>(resolve => {
            let advanced = false;
            const advance = (): void => {
                if (advanced === true) {
                    return;
                }
                advanced = true;
                clearTimeout(timer);
                resolve();
            };

            const timer = setTimeout(advance, RuleManageModel.QUEUE_ADVANCE_TIMEOUT_MS);
            timer.unref();

            settling.then(advance, advance);
        });
    }
}
