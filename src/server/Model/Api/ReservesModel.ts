import ApiModel from './ApiModel';
import { IPCClientInterface } from '../IPC/IPCClient';
import { ReserveProgram } from '../../Operator/ReserveProgramInterface';
import { EncodeInterface } from '../../Operator/RuleInterface';
import ApiUtil from './ApiUtil';
import * as apid from '../../../../node_modules/mirakurun/api';

interface ReservesModelInterface extends ApiModel {
    getReserveAllId(): Promise<{}>;
    getReserves(limit: number, offset: number): Promise<{}[]>;
    getConflicts(limit: number, offset: number): Promise<{}[]>;
    getSkips(limit: number, offset: number): Promise<{}[]>;
    addReserve(programId: apid.ProgramId, encode?: EncodeInterface): Promise<void>;
    cancelReserve(programId: apid.ProgramId): Promise<void>;
    removeReserveSkip(programId: apid.ProgramId): Promise<void>;
}

namespace ReservesModelInterface {
    export const NotFoundRuleIdError = 'NotFoundRuleId'
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
    * 予約情報を取得
    * @param limit: limit
    * @param offset: offset
    * @return Promise<any>
    */
    public async getReserves(limit: number, offset: number): Promise<any> {
        let result = await this.ipc.getReserves(limit, offset);

        return {
            reserves: this.fixReserve(result.reserves),
            total: result.total,
        }
    }

    /**
    * 予約重複情報を取得
    * @param limit: limit
    * @param offset: offset
    * @return Promise<any>
    */
    public async getConflicts(limit: number, offset: number): Promise<any> {
        let result = await this.ipc.getReserveConflicts(limit, offset);

        return {
            reserves: this.fixReserve(result.reserves),
            total: result.total,
        }
    }

    /**
    * 予約スキップ情報を取得
    * @param limit: limit
    * @param offset: offset
    * @return Promise<any>
    */
    public async getSkips(limit: number, offset: number): Promise<any> {
        let result = await this.ipc.getReserveSkips(limit, offset);

        return {
            reserves: this.fixReserve(result.reserves),
            total: result.total,
        }
    }

    /**
    * ReserveProgram[] の修正
    * @param reserves: ReserveProgram[]
    * @return any[]
    */
    private fixReserve(reserves: ReserveProgram[]): any[] {
        return reserves.map((reserve) => {
            let result = {
                program: ApiUtil.fixReserveProgram(reserve.program),
            };

            if(typeof reserve.ruleId !== 'undefined') { result['ruleId'] = reserve.ruleId; }
            if(typeof reserve.isManual !== 'undefined') { result['isManual'] = reserve.isManual; }

            return result;
        });
    }

    /**
    * 予約追加
    * @param programId: program id
    * @param encode?: EncodeInterface
    * @return Promise<void>
    */
    public async addReserve(programId: apid.ProgramId, encode?: EncodeInterface): Promise<void> {
        await this.ipc.addReserve(programId, encode);
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
}

export { ReservesModelInterface, ReservesModel }

