import * as m from 'mithril';
import ApiModel from './ApiModel';
import * as apid from '../../../../api';

interface ScheduleQuery {
    type: apid.ChannelType;
    time?: number;
    length: number;
}

interface ScheduleApiModelInterface extends ApiModel {
    init(): void;
    fetchSchedule(type: apid.ChannelType, time: number, length?: number): Promise<void>;
    fetchScheduleId(channelId: apid.ServiceItemId, time: number): Promise<void>;
    fetchScheduleBroadcasting(time: number): Promise<void>;
    startUpdateReserves(): Promise<void>;
    search(option: apid.RuleSearch): Promise<apid.ScheduleProgramItem[]>;
    getSchedule(): apid.ScheduleProgram[];
}

/**
* ScheduleApiModel
* /api/schedule を取得
*/
class ScheduleApiModel extends ApiModel implements ScheduleApiModelInterface {
    private schedulePrograms: apid.ScheduleProgram[] = [];

    public init(): void {
        super.init();
        this.schedulePrograms = [];
    }

    /**
    * 番組表を取得
    * /api/schedule
    */
    public async fetchSchedule(type: apid.ChannelType, time: number, length: number = 24): Promise<void> {
        let query: ScheduleQuery = {
            type: type,
            length: length,
            time: time,
        }

        try {
            this.schedulePrograms = await <any> m.request({
                method: 'GET',
                url: '/api/schedule',
                data: query,
            });
        } catch(err) {
            this.schedulePrograms = [];
            console.error('/api/schedule');
            console.error(err);
            this.openSnackbar('番組情報取得に失敗しました');
        }
    }

    /**
    * channelId を指定して番組表を取得
    * /api/schedule/{id}
    */
    public async fetchScheduleId(channelId: apid.ServiceItemId, time: number): Promise<void> {
        let query = {
            time: time
        }

        try {
            this.schedulePrograms = await <any> m.request({
                method: 'GET',
                url: `/api/schedule/${ channelId }`,
                data: query,
            });
        } catch(err) {
            this.schedulePrograms = [];
            console.error(`/api/schedule/${ channelId }`);
            console.error(err);
            this.openSnackbar('単局番組情報取得に失敗しました');
        }
    }

    /**
    * 放送中の番組情報を取得
    * /api/schedule/broadcasting
    */
    public async fetchScheduleBroadcasting(time: number = 0): Promise<void> {
        let query = time > 0 ? `?time=${ time }` : '';

        try {
            this.schedulePrograms = await <any> m.request({
                method: 'GET',
                url: `/api/schedule/broadcasting${ query }`,
            });
        } catch(err) {
            this.schedulePrograms = [];
            console.error(`/api/schedule/broadcasting`);
            console.error(err);
            this.openSnackbar('放映中の番組情報取得に失敗しました');
        }
    }

    /**
    * 予約情報更新
    */
    public async startUpdateReserves(): Promise<void> {
        try {
            await m.request({
                method: 'PUT',
                url: '/api/schedule/update',
            });
            this.openSnackbar('予約情報更新を開始しました');
        } catch(err) {
            console.error('/api/schedule/update');
            console.error(err);
            this.openSnackbar('予約更新に失敗しました');
        }
    }

    /**
    * search
    * @param option: apid.RuleSearch
    * @return Promise<apid.ScheduleProgramItem[]>
    */
    public async search(option: apid.RuleSearch): Promise<apid.ScheduleProgramItem[]> {
        return await <any> m.request({
            method: 'POST',
            url: '/api/schedule/search',
            data: option,
        });
    }

    /**
    * schedule の取得
    * @return apid.ScheduleProgram[]
    */
    public getSchedule(): apid.ScheduleProgram[] {
        return this.schedulePrograms;
    }
}

export { ScheduleApiModelInterface, ScheduleApiModel };

