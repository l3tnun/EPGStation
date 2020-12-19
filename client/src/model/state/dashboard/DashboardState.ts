import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IReservesApiModel from '../../api/reserves/IReservesApiModel';
import IDashboardState from './IDashboardState';

@injectable()
export default class DashboardState implements IDashboardState {
    private reserveApiModel: IReservesApiModel;

    constructor(@inject('IReservesApiModel') reserveApiModel: IReservesApiModel) {
        this.reserveApiModel = reserveApiModel;
    }

    private cnts: apid.ReserveCnts = {
        normal: 0,
        conflicts: 0,
        skips: 0,
        overlaps: 0,
    };

    /**
     * 取得した予約数情報をクリア
     */
    public clearDate(): void {
        this.cnts = {
            normal: 0,
            conflicts: 0,
            skips: 0,
            overlaps: 0,
        };
    }

    /**
     * 予約数情報を取得
     * @return Promise<void>
     */
    public async fetchData(): Promise<void> {
        this.cnts = await this.reserveApiModel.getCnts();
    }

    public getConflictCnt(): number {
        return this.cnts.conflicts;
    }
}
