import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import DateUtil from '../../../util/DateUtil';
import IReservesApiModel from '../../api/reserves/IReservesApiModel';
import IReservesState from './IReservesState';
import IReserveStateUtil, { ReserveStateData } from './IReserveStateUtil';

@injectable()
export default class ReservesState implements IReservesState {
    private reserveApiModel: IReservesApiModel;
    private reserveStateUtil: IReserveStateUtil;

    private reserves: apid.Reserves | null = null;
    private isHalfWidth: boolean = false;

    constructor(
        @inject('IReservesApiModel') reserveApiModel: IReservesApiModel,
        @inject('IReserveStateUtil') reserveStateUtil: IReserveStateUtil,
    ) {
        this.reserveApiModel = reserveApiModel;
        this.reserveStateUtil = reserveStateUtil;
    }

    /**
     * 取得した予約情報をクリア
     */
    public clearDate(): void {
        this.reserves = null;
    }

    /**
     * 予約情報の取得
     * @param option: apid.GetReserveOption
     */
    public async fetchData(option: apid.GetReserveOption): Promise<void> {
        this.isHalfWidth = option.isHalfWidth;
        this.reserves = await this.reserveApiModel.get(option);
    }

    /**
     * 取得した予約情報を返す
     * @return ReserveStateData[][]
     */
    public getReserves(): ReserveStateData[] {
        return this.reserves === null
            ? []
            : this.reserveStateUtil.convertReserveItemsToStateDatas(this.reserves.reserves, this.isHalfWidth);
    }

    /**
     * 取得した予約の総件数を返す
     * @return number
     */
    public getTotal(): number {
        return this.reserves === null ? 0 : this.reserves.total;
    }
}
