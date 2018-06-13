import * as apid from '../../../../api';
import ApiModel from './ApiModel';

interface ScheduleQuery {
    type: apid.ChannelType;
    time?: number;
    length: number;
}

interface ScheduleApiModelInterface extends ApiModel {
    init(): void;
    fetchSchedule(type: apid.ChannelType, time: number, length?: number): Promise<void>;
    fetchScheduleId(channelId: apid.ServiceItemId, time: number, days: number): Promise<void>;
    fetchScheduleDetail(programId: apid.ProgramId): Promise<void>;
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
        const query: ScheduleQuery = {
            type: type,
            length: length,
            time: time,
        };

        try {
            this.schedulePrograms = await <any> this.request({
                method: 'GET',
                url: './api/schedule',
                data: query,
            });
        } catch (err) {
            this.schedulePrograms = [];
            console.error('./api/schedule');
            console.error(err);
            this.openSnackbar('番組情報取得に失敗しました');
        }
    }

    /**
     * channelId を指定して番組表を取得
     * /api/schedule/{id}
     */
    public async fetchScheduleId(channelId: apid.ServiceItemId, time: number, days: number): Promise<void> {
        const query = {
            time: time,
            days: days,
        };

        try {
            this.schedulePrograms = await <any> this.request({
                method: 'GET',
                url: `./api/schedule/${ channelId }`,
                data: query,
            });
        } catch (err) {
            this.schedulePrograms = [];
            console.error(`./api/schedule/${ channelId }`);
            console.error(err);
            this.openSnackbar('単局番組情報取得に失敗しました');
        }
    }

    /**
     * programId を指定して番組情報を取得
     * /api/schedule/detail/{id}
     */
    public async fetchScheduleDetail(programId: apid.ProgramId): Promise<void> {
        try {
            this.schedulePrograms = await <any> this.request({
                method: 'GET',
                url: `./api/schedule/detail/${ programId }`,
            });
        } catch (err) {
            this.schedulePrograms = [];
            console.error('./api/schedule/detail');
            console.error(err);
            this.openSnackbar('番組情報取得に失敗しました');
        }
    }

    /**
     * 放送中の番組情報を取得
     * /api/schedule/broadcasting
     */
    public async fetchScheduleBroadcasting(time: number = 0): Promise<void> {
        const query = time > 0 ? `?time=${ time }` : '';

        try {
            this.schedulePrograms = await <any> this.request({
                method: 'GET',
                url: `./api/schedule/broadcasting${ query }`,
            });
        } catch (err) {
            this.schedulePrograms = [];
            console.error('./api/schedule/broadcasting');
            console.error(err);
            this.openSnackbar('放映中の番組情報取得に失敗しました');
        }
    }

    /**
     * 予約情報更新
     */
    public async startUpdateReserves(): Promise<void> {
        try {
            await this.request({
                method: 'PUT',
                url: './api/schedule/update',
            });
            this.openSnackbar('予約情報更新を開始しました');
        } catch (err) {
            console.error('./api/schedule/update');
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
        return await <any> this.request({
            method: 'POST',
            url: './api/schedule/search',
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

