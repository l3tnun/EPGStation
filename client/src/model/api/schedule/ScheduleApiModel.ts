import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IScheduleApiModel from './IScheduleApiModel';

@injectable()
export default class ScheduleApiModel implements IScheduleApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    /**
     * 番組表データの取得
     * @param option: ScheduleOption
     * @return Promise<apid.Schedule[]>
     */
    public async getSchedule(option: apid.ScheduleOption): Promise<apid.Schedule[]> {
        const result = await this.repository.get('/schedules', {
            params: option,
        });

        return <any>result.data;
    }

    /**
     * 番組検索結果の取得
     * @param option: apid.ScheduleSearchOption
     * @return Promise<apid.ScheduleProgramItem[]>
     */
    public async getScheduleSearch(option: apid.ScheduleSearchOption): Promise<apid.ScheduleProgramItem[]> {
        const result = await this.repository.post('/schedules/search', option);

        return <any>result.data;
    }
}
