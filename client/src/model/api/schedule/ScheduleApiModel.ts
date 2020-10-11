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
     * 指定した program id の番組情報を取得する
     * @param programId: apid.ProgramId
     * @param isHalfWidth: boolean 半角で取得するか
     * @return Promise<apid.ScheduleProgramItem>
     */
    public async getSchedule(programId: apid.ProgramId, isHalfWidth: boolean): Promise<apid.ScheduleProgramItem> {
        const result = await this.repository.get(`/schedules/detail/${programId.toString(10)}`, {
            params: {
                isHalfWidth: isHalfWidth,
            },
        });

        return result.data;
    }

    /**
     * 番組表データの取得
     * @param option: ScheduleOption
     * @return Promise<apid.Schedule[]>
     */
    public async getSchedules(option: apid.ScheduleOption): Promise<apid.Schedule[]> {
        const result = await this.repository.get('/schedules', {
            params: option,
        });

        return result.data;
    }

    /**
     * 放送局を指定した番組表データの取得
     * @param option: apid.ChannelScheduleOption
     * @return Promise<apid.Schedule[]>
     */
    public async getChannelSchedule(option: apid.ChannelScheduleOption): Promise<apid.Schedule[]> {
        const result = await this.repository.get(`/schedules/${option.channelId}`, {
            params: {
                startAt: option.startAt,
                days: option.days,
                isHalfWidth: option.isHalfWidth,
            },
        });

        return result.data;
    }

    /**
     * 番組検索結果の取得
     * @param option: apid.ScheduleSearchOption
     * @return Promise<apid.ScheduleProgramItem[]>
     */
    public async getScheduleSearch(option: apid.ScheduleSearchOption): Promise<apid.ScheduleProgramItem[]> {
        const result = await this.repository.post('/schedules/search', option);

        return result.data;
    }

    /**
     * 放映中番組情報の取得
     * @param option: apid.BroadcastingScheduleOption
     * @return Promise<apid.Schedule[]>
     */
    public async getScheduleOnAir(option: apid.BroadcastingScheduleOption): Promise<apid.Schedule[]> {
        const result = await this.repository.get('/schedules/broadcasting', {
            params: option,
        });

        return result.data;
    }
}
