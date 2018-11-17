import * as apid from '../../../../node_modules/mirakurun/api';
import { IPCClientInterface } from '../IPC/IPCClient';
import { AddReserveInterface, ManualReserveProgram, ReserveProgram, RuleReserveProgram } from '../Operator/ReserveProgramInterface';
import ApiModel from './ApiModel';
import ApiUtil from './ApiUtil';

interface ReservesModelInterface extends ApiModel {
    getReserveAllId(): Promise<{}>;
    getReserve(programId: number): Promise<{}[]>;
    getReserves(limit: number, offset: number): Promise<{}[]>;
    getConflicts(limit: number, offset: number): Promise<{}[]>;
    getSkips(limit: number, offset: number): Promise<{}[]>;
    getOverlaps(limit: number, offset: number): Promise<{}[]>;
    getPosition(programId: number): Promise<{}>;
    addReserve(option: AddReserveInterface): Promise<{}>;
    editReserve(option: AddReserveInterface): Promise<void>;
    cancelReserve(programId: apid.ProgramId): Promise<void>;
    removeReserveSkip(programId: apid.ProgramId): Promise<void>;
    disableReserveOverlap(programId: apid.ProgramId): Promise<void>;
}

namespace ReservesModelInterface {
    export const NotFoundRuleIdError = 'NotFoundRuleId';
}

class ReservesModel extends ApiModel implements ReservesModelInterface {
    private ipc: IPCClientInterface;

    constructor(ipc: IPCClientInterface) {
        super();
        this.ipc = ipc;
    }

    /**
     * 予約情報の program id をすべて取得
     * @return Prommise<{}>
     */
    public async getReserveAllId(): Promise<{}> {
        return await this.ipc.getReserveAllId();
    }

    /**
     * 予約を取得
     * @param programId: program id
     */
    public async getReserve(programId: number): Promise<any | null> {
        const result = await this.ipc.getReserve(programId);

        return result === null ? null : this.fixReserve(result);
    }

    /**
     * 予約情報を取得
     * @param limit: limit
     * @param offset: offset
     * @return Promise<any>
     */
    public async getReserves(limit: number, offset: number): Promise<any> {
        const result = await this.ipc.getReserves(limit, offset);

        return {
            reserves: this.fixReserves(result.reserves),
            total: result.total,
        };
    }

    /**
     * 予約重複情報を取得
     * @param limit: limit
     * @param offset: offset
     * @return Promise<any>
     */
    public async getConflicts(limit: number, offset: number): Promise<any> {
        const result = await this.ipc.getReserveConflicts(limit, offset);

        return {
            reserves: this.fixReserves(result.reserves),
            total: result.total,
        };
    }

    /**
     * 予約スキップ情報を取得
     * @param limit: limit
     * @param offset: offset
     * @return Promise<any>
     */
    public async getSkips(limit: number, offset: number): Promise<any> {
        const result = await this.ipc.getReserveSkips(limit, offset);

        return {
            reserves: this.fixReserves(result.reserves),
            total: result.total,
        };
    }

    /**
     * 予約 overlap 情報を取得
     * @param limit: limit
     * @param offset: offset
     * @return Promise<any>
     */
    public async getOverlaps(limit: number, offset: number): Promise<any> {
        const result = await this.ipc.getReserveOverlaps(limit, offset);

        return {
            reserves: this.fixReserves(result.reserves),
            total: result.total,
        };
    }

    /**
     * 指定した programId の予約の位置を取得
     * @param programId: number
     * @return { programId: number | null }
     */
    public async getPosition(programId: number): Promise<{}> {
        const result = await this.ipc.getReservePosition(programId);

        return result === null ? {} : {
            position: result,
        };
    }

    /**
     * ReserveProgram[] の修正
     * @param reserves: ReserveProgram[]
     * @return any[]
     */
    private fixReserves(reserves: ReserveProgram[]): any[] {
        return reserves.map((reserve) => {
            return this.fixReserve(reserve);
        });
    }

    /**
     * ReserveProgram の修正
     * @param reserve: ReserveProgram
     * @return any
     */
    private fixReserve(reserve: ReserveProgram): any {
        const result = {
            program: ApiUtil.fixReserveProgram(reserve.program),
        };

        if (typeof (<RuleReserveProgram> reserve).ruleId !== 'undefined') { result['ruleId'] = (<RuleReserveProgram> reserve).ruleId; }
        if (typeof (<ManualReserveProgram> reserve).isTimeSpecifited !== 'undefined') { result['isTimeSpecifited'] = (<ManualReserveProgram> reserve).isTimeSpecifited; }

        if (typeof reserve.option !== 'undefined') { result['option'] = reserve.option; }
        if (typeof reserve.encodeOption !== 'undefined') { result['encode'] = reserve.encodeOption; }

        return result;
    }

    /**
     * 予約追加
     * @param option: AddReserveInterface
     * @return Promise<number> ProgramId
     */
    public async addReserve(option: AddReserveInterface): Promise<{}> {
        const programId = await this.ipc.addReserve(option);

        return {
            programId: programId,
        };
    }

    /**
     * 手動予約編集
     * @param option: AddReserveInterface
     * @return Promise<void>
     */
    public async editReserve(option: AddReserveInterface): Promise<void> {
        await this.ipc.editReserve(option);
    }

    /**
     * 予約削除
     * @param programId: program id
     * @return Promise<void>
     */
    public async cancelReserve(programId: apid.ProgramId): Promise<void> {
        await this.ipc.cancelReserve(programId);
    }

    /**
     * 予約対象から除外され状態を解除する
     * @param programId: program id
     * @return Promise<void>
     */
    public async removeReserveSkip(programId: apid.ProgramId): Promise<void> {
        await this.ipc.removeReserveSkip(programId);
    }

    /**
     * overlap 状態を解除する
     * @param programId: program id
     * @return Promise<void>
     */
    public async disableReserveOverlap(programId: apid.ProgramId): Promise<void> {
        await this.ipc.disableReserveOverlap(programId);
    }
}

export { ReservesModelInterface, ReservesModel };

