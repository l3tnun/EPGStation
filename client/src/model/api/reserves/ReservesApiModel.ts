import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IReservesApiModel from './IReservesApiModel';

@injectable()
export default class ReservesApiModel implements IReservesApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    /**
     * 手動予約の追加
     * @param option: ManualReserveOption
     * @return Promise<ReserveId>
     */
    public async add(option: apid.ManualReserveOption): Promise<apid.ReserveId> {
        const result = await this.repository.post('/reserves', option);

        return <any>result.data;
    }

    /**
     * 予約情報の取得
     * @param option: GetReserveOption
     * @return Promise<Reserves>
     */
    public async gets(option: apid.GetReserveOption): Promise<apid.Reserves> {
        const result = await this.repository.get('/reserves', {
            params: option,
        });

        return <any>result.data;
    }

    /**
     * 予約リスト情報の取得
     * @param option: GetReserveListsOption
     * @return Promise<ReserveLists>
     */
    public async getLists(option: apid.GetReserveListsOption): Promise<apid.ReserveLists> {
        const result = await this.repository.get('/reserves/lists', {
            params: option,
        });

        return <any>result.data;
    }

    /**
     * 予約のキャンセル
     * @param reserveId: ReserveId
     * @return Promise<void>
     */
    public async cancel(reserveId: apid.ReserveId): Promise<void> {
        await this.repository.delete(`/reserves/${reserveId}`);
    }

    /**
     * 予約の除外状態を解除
     * @param reserveId: ReserveId
     * @return Promise<void>
     */
    public async removeSkip(reserveId: apid.ReserveId): Promise<void> {
        await this.repository.delete(`/reserves/${reserveId}/skip`);
    }

    /**
     * 予約の重複状態を解除
     * @param reserveId: ReserveId
     * @return Promise<void>
     */
    public async removeOverlap(reserveId: apid.ReserveId): Promise<void> {
        await this.repository.delete(`/reserves/${reserveId}/overlap`);
    }

    /**
     * 予約情報の更新を開始する
     * @return Promise<void>
     */
    public async updateAll(): Promise<void> {
        await this.repository.post('/reserves/update');
    }
}
