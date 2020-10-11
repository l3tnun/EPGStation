import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import DateUtil from '../../../util/DateUtil';
import IReservesApiModel from '../../api/reserves/IReservesApiModel';
import IReservesState from './IReservesState';
import IReserveStateUtil, { ReserveStateData, SelectedIndex } from './IReserveStateUtil';

@injectable()
export default class ReservesState implements IReservesState {
    private reserveApiModel: IReservesApiModel;
    private reserveStateUtil: IReserveStateUtil;

    private reserves: ReserveStateData[] | null = null;
    private total: number = 0;

    constructor(@inject('IReservesApiModel') reserveApiModel: IReservesApiModel, @inject('IReserveStateUtil') reserveStateUtil: IReserveStateUtil) {
        this.reserveApiModel = reserveApiModel;
        this.reserveStateUtil = reserveStateUtil;
    }

    /**
     * 取得した予約情報をクリア
     */
    public clearDate(): void {
        this.reserves = null;
        this.total = 0;
    }

    /**
     * 予約情報の取得
     * @param option: apid.GetReserveOption
     */
    public async fetchData(option: apid.GetReserveOption): Promise<void> {
        const reserves = await this.reserveApiModel.gets(option);
        this.total = reserves.total;

        const oldSelectedIndex: SelectedIndex = {};
        if (this.reserves !== null) {
            for (const r of this.reserves) {
                oldSelectedIndex[r.reserveItem.id] = r.isSelected;
            }
        }
        this.reserves = this.reserveStateUtil.convertReserveItemsToStateDatas(reserves.reserves, option.isHalfWidth, oldSelectedIndex);
    }

    /**
     * 取得した予約情報を返す
     * @return ReserveStateData[]
     */
    public getReserves(): ReserveStateData[] {
        return this.reserves === null ? [] : this.reserves;
    }

    /**
     * 取得した予約の総件数を返す
     * @return number
     */
    public getTotal(): number {
        return this.total;
    }

    /**
     * 選択した番組数を返す
     * @return number
     */
    public getSelectedCnt(): number {
        if (this.reserves === null) {
            return 0;
        }

        let selectedCnt = 0;
        for (const r of this.reserves) {
            if (r.isSelected === true) {
                selectedCnt++;
            }
        }

        return selectedCnt;
    }

    /**
     * 選択 (削除時の複数選択)
     * @param reserveId: apid.ReserveId
     */
    public select(reserveId: apid.ReserveId): void {
        if (this.reserves === null) {
            return;
        }

        for (const r of this.reserves) {
            if (r.reserveItem.id === reserveId) {
                r.isSelected = !r.isSelected;

                return;
            }
        }
    }

    /**
     * 全て選択 (削除時の複数選択)
     */
    public selectAll(): void {
        if (this.reserves === null) {
            return;
        }

        let isUnselectAll = true;
        for (const r of this.reserves) {
            if (r.isSelected === false) {
                isUnselectAll = false;
            }
            r.isSelected = true;
        }

        // 全て選択済みであれば選択を解除する
        if (isUnselectAll === true) {
            for (const r of this.reserves) {
                r.isSelected = false;
            }
        }
    }

    /**
     * 全ての選択解除 (削除時の複数選択)
     */
    public clearSelect(): void {
        if (this.reserves === null) {
            return;
        }

        for (const r of this.reserves) {
            r.isSelected = false;
        }
    }

    /**
     * 選択した番組を削除する
     * @return Promise<void>
     */
    public async multiplueDeletion(): Promise<void> {
        if (this.reserves === null) {
            return;
        }

        // 削除する video file を列挙する
        const reserveIds: apid.ReserveId[] = [];
        for (const r of this.reserves) {
            if (r.isSelected === true) {
                reserveIds.push(r.reserveItem.id);
            }
        }

        // 選択状態を元に戻す
        this.clearSelect();

        // 列挙した予約をキャンセルする
        let hasError = false;
        for (const id of reserveIds) {
            try {
                await this.reserveApiModel.cancel(id);
            } catch (err) {
                console.error(err);
                hasError = true;
            }
        }

        if (hasError === true) {
            throw new Error();
        }
    }
}
