import DateUtil from '@/util/DateUtil';
import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IScheduleApiModel from '../../api/schedule/IScheduleApiModel';
import IOnAirState, { OnAirDisplayData } from './IOnAirState';

@injectable()
export default class OnAirState implements IOnAirState {
    private scheduleApiModel: IScheduleApiModel;

    private schedules: OnAirDisplayData[] = [];

    constructor(@inject('IScheduleApiModel') scheduleApiModel: IScheduleApiModel) {
        this.scheduleApiModel = scheduleApiModel;
    }

    /**
     * 取得した番組情報をクリア
     */
    public clearData(): void {}

    /**
     * 番組情報を取得する
     * @param option: apid.BroadcastingScheduleOption
     */
    public async fetchData(option: apid.BroadcastingScheduleOption): Promise<void> {
        const datas = await this.scheduleApiModel.getScheduleOnAir(option);

        this.schedules = datas.map(d => {
            return this.createDisplayData(d);
        });
    }

    /**
     * apid.Schedule から OnAirDisplayData を生成する
     * @param schedule: apid.Schedule
     * @return OnAirDisplayData
     */
    private createDisplayData(schedule: apid.Schedule): OnAirDisplayData {
        const startAt = DateUtil.getJaDate(new Date(schedule.programs[0].startAt));
        const endAt = DateUtil.getJaDate(new Date(schedule.programs[0].endAt));

        return {
            display: {
                channelName: schedule.channel.name,
                time: `${DateUtil.format(startAt, 'hh:mm')} ~ ${DateUtil.format(endAt, 'hh:mm')}`,
                name: schedule.programs[0].name,
                description: schedule.programs[0].description,
                extended: schedule.programs[0].extended,
            },
            schedule: schedule,
        };
    }

    /**
     * 取得した番組情報を返す
     * @return OnAirDisplayData[]
     */
    public getSchedules(): OnAirDisplayData[] {
        return this.schedules;
    }
}
