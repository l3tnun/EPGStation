import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IReservesApiModel from '../..//api/reserves/IReservesApiModel';
import IGuideReserveUtil, { ReserveStateItemIndex } from './IGuideReserveUtil';

@injectable()
export default class GuideReserveUtil implements IGuideReserveUtil {
    private reservesApiModel: IReservesApiModel;

    constructor(@inject('IReservesApiModel') reservesApiModel: IReservesApiModel) {
        this.reservesApiModel = reservesApiModel;
    }

    /**
     * 予約索引情報を取得
     * @param startAt: UnixtimeMS
     * @param endAt: UnixtimeMS
     * @return Promise<ReserveStateItemIndex>
     */
    public async getReserveIndex(option: apid.GetReserveListsOption): Promise<ReserveStateItemIndex> {
        const lists = await this.reservesApiModel.getLists(option);

        const result: ReserveStateItemIndex = {};

        for (const reserve of lists.normal) {
            if (typeof reserve.programId !== 'undefined') {
                result[reserve.programId] = {
                    type: 'reserve',
                    item: reserve,
                };
            }
        }
        for (const reserve of lists.conflicts) {
            if (typeof reserve.programId !== 'undefined') {
                result[reserve.programId] = {
                    type: 'conflict',
                    item: reserve,
                };
            }
        }
        for (const reserve of lists.skips) {
            if (typeof reserve.programId !== 'undefined') {
                result[reserve.programId] = {
                    type: 'skip',
                    item: reserve,
                };
            }
        }
        for (const reserve of lists.overlaps) {
            if (typeof reserve.programId !== 'undefined') {
                result[reserve.programId] = {
                    type: 'overlap',
                    item: reserve,
                };
            }
        }

        return result;
    }
}
