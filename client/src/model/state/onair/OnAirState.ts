import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import DateUtil from '@/util/DateUtil';
import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IScheduleApiModel from '../../api/schedule/IScheduleApiModel';
import IGuideReserveUtil, { ReserveStateItemIndex } from '../guide/IGuideReserveUtil';
import IOnAirState, { OnAirDisplayData } from './IOnAirState';

@injectable()
export default class OnAirState implements IOnAirState {
    public selectedTab: apid.ChannelType | undefined;

    private scheduleApiModel: IScheduleApiModel;
    private reserveUtil: IGuideReserveUtil;
    private schedules: OnAirDisplayData[] = [];
    private reserveIndex: ReserveStateItemIndex = {};
    private tabs: apid.ChannelType[] = [];

    constructor(
        @inject('IServerConfigModel') serverConfigModel: IServerConfigModel,
        @inject('IScheduleApiModel') scheduleApiModel: IScheduleApiModel,
        @inject('IGuideReserveUtil') reserveUtil: IGuideReserveUtil,
    ) {
        this.scheduleApiModel = scheduleApiModel;
        this.reserveUtil = reserveUtil;

        // tab 設定
        const config = serverConfigModel.getConfig();
        if (config !== null) {
            if (config.broadcast.GR === true) {
                this.tabs.push('GR');
            }
            if (config.broadcast.BS === true) {
                this.tabs.push('BS');
            }
            if (config.broadcast.CS === true) {
                this.tabs.push('CS');
            }
            if (config.broadcast.SKY === true) {
                this.tabs.push('SKY');
            }
        }
    }

    /**
     * 取得した番組情報をクリア
     */
    public clearData(): void {
        this.schedules = [];
        this.reserveIndex = {};
    }

    /**
     * 番組情報を取得する
     * @param option: apid.BroadcastingScheduleOption
     */
    public async fetchData(option: apid.BroadcastingScheduleOption): Promise<void> {
        const now = new Date().getTime();
        this.reserveIndex = await this.reserveUtil.getReserveIndex({
            startAt: now,
            endAt: now + 3600 * 1000,
        });
        const datas = await this.scheduleApiModel.getScheduleOnAir(option);

        this.schedules = datas.map(d => {
            return this.createDisplayData(now, d);
        });
    }

    /**
     * apid.Schedule から OnAirDisplayData を生成する
     * @param baseTime: apid.UnixtimeMS
     * @param schedule: apid.Schedule
     * @return OnAirDisplayData
     */
    private createDisplayData(baseTime: apid.UnixtimeMS, schedule: apid.Schedule): OnAirDisplayData {
        const startAt = DateUtil.getJaDate(new Date(schedule.programs[0].startAt));
        const endAt = DateUtil.getJaDate(new Date(schedule.programs[0].endAt));

        const result: OnAirDisplayData = {
            display: {
                channelId: schedule.channel.id,
                channelName: schedule.channel.name,
                time: `${DateUtil.format(startAt, 'hh:mm')} ~ ${DateUtil.format(endAt, 'hh:mm')}`,
                name: schedule.programs[0].name,
                description: schedule.programs[0].description,
                extended: schedule.programs[0].extended,
                digestibility: this.getDigestibility(baseTime, schedule.programs[0].startAt, schedule.programs[0].endAt),
            },
            schedule: schedule,
        };

        if (schedule.channel.hasLogoData === true) {
            result.display.logoSrc = `./api/channels/${schedule.channel.id.toString(10)}/logo`;
        }

        return result;
    }

    /**
     * 番組終了までの割合を返す 0 ~ 100
     * @param baseTime: apid.UnixtimeMS
     * @param startAt: apid.UnixtimeMS
     * @param endAt: apid.UnixtimeMS
     * @return number
     */
    private getDigestibility(baseTime: apid.UnixtimeMS, startAt: apid.UnixtimeMS, endAt: apid.UnixtimeMS): number {
        if (baseTime <= startAt) {
            return 0;
        }

        return ((baseTime - startAt) / (endAt - startAt)) * 100;
    }

    /**
     * digestibility を更新する
     */
    public updateDigestibility(): void {
        const now = new Date().getTime();

        for (const s of this.schedules) {
            s.display.digestibility = s.schedule.programs.length === 0 ? 0 : this.getDigestibility(now, s.schedule.programs[0].startAt, s.schedule.programs[0].endAt);
        }
    }

    /**
     * 取得した番組情報を返す
     * @return OnAirDisplayData[]
     */
    public getSchedules(type?: apid.ChannelType): OnAirDisplayData[] {
        return typeof type === 'undefined'
            ? this.schedules
            : this.schedules.filter(s => {
                  return s.schedule.channel.channelType === type;
              });
    }

    /**
     * 予約情報の索引を返す
     * @return ReserveStateItemIndex
     */
    public getReserveIndex(): ReserveStateItemIndex {
        return this.reserveIndex;
    }

    /**
     * 放送波名の配列を返す
     * @return string[]
     */
    public getTabs(): apid.ChannelType[] {
        return this.tabs;
    }

    /**
     * 次の更新までの待ち時間を返す (ms)
     * @return number
     */
    public getUpdateTime(): number {
        if (this.schedules.length === 0) {
            return 1000;
        }

        let min = 6048000000;
        const now = new Date().getTime();
        for (const s of this.schedules) {
            const endTime = s.schedule.programs[0].endAt - now;
            if (min > endTime) {
                min = endTime;
            }
        }
        if (min < 0) {
            min = 0;
        }

        return min;
    }
}
