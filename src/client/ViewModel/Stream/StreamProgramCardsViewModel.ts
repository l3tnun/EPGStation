import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import { ConfigApiModelInterface } from '../../Model/Api/ConfigApiModel';
import { ScheduleApiModelInterface } from '../../Model/Api/ScheduleApiModel';
import { TabModelInterface } from '../../Model/Tab/TabModel';
import ViewModel from '../ViewModel';

/**
 * StreamProgramCardsViewModel
 */
class StreamProgramCardsViewModel extends ViewModel {
    private scheduleApiModel: ScheduleApiModelInterface;
    private tab: TabModelInterface;
    private configApiModel: ConfigApiModelInterface;
    private timer: NodeJS.Timer | null = null;

    public additionTime: number = 0;

    constructor(
        scheduleApiModel: ScheduleApiModelInterface,
        tab: TabModelInterface,
        configApiModel: ConfigApiModelInterface,
    ) {
        super();
        this.scheduleApiModel = scheduleApiModel;
        this.tab = tab;
        this.configApiModel = configApiModel;
    }

    /**
     * init
     */
    public async init(status: ViewModelStatus = 'init'): Promise<void> {
        super.init(status);

        if (status === 'init') {
            this.additionTime = 0;
            this.scheduleApiModel.init();
        }

        await this.updateProgram();
    }

    /**
     * 番組データ更新 & 自動更新用のタイマーをセット
     */
    private async updateProgram(): Promise<void> {
        this.stopTimer();
        try {
            await this.scheduleApiModel.fetchScheduleBroadcasting(this.additionTime);
        } catch (err) {
            console.error(err);
            setTimeout(() => { this.updateProgram(); }, 5000);

            return;
        }

        let minEndTime = 6048000000;
        const now = new Date().getTime();
        this.scheduleApiModel.getSchedule().forEach((item) => {
            const endTime = item.programs[0].endAt - now;
            if (minEndTime > endTime) {
                minEndTime = endTime;
            }
        });

        if (minEndTime < 0) { minEndTime = 0; }

        this.timer = setTimeout(() => {
            this.updateProgram();
        }, minEndTime);
    }

    /**
     * ChannelType を指定して番組情報を取得
     * @param channelType: apid.ChannelType
     * @return apid.ScheduleProgram[]
     */
    public getPrograms(channelType: apid.ChannelType): apid.ScheduleProgram[] {
        const results: apid.ScheduleProgram[] = [];

        this.scheduleApiModel.getSchedule().forEach((program) => {
            if (program.channel.channelType !== channelType) { return; }

            results.push(program);
        });

        return results;
    }

    /**
     * タイマー停止
     */
    public stopTimer(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    /**
     * tab position
     */
    public getTabPosition(): number {
        return this.tab.get();
    }

    /**
     * 放送波のリストを返す
     * @return apid.ChannelType[]
     */
    public getBroadcastList(): apid.ChannelType[] {
        const config = this.configApiModel.getConfig();
        if (config === null) { return []; }

        const results: apid.ChannelType[] = [];
        if (config.broadcast.GR) { results.push('GR'); }
        if (config.broadcast.BS) { results.push('BS'); }
        if (config.broadcast.CS) { results.push('CS'); }
        if (config.broadcast.SKY) { results.push('SKY'); }

        return results;
    }

    /**
     * 時間を 10 分加算して更新する
     */
    public async addTime(): Promise<void> {
        this.additionTime += 10;
        await this.updateProgram();
    }

    /**
     * 時間をリセットして更新する
     */
    public async resetTime(): Promise<void> {
        this.additionTime = 0;
        await this.updateProgram();
    }
}

namespace StreamProgramCardsViewModel {
    export const contentId = 'stream-programs-cards-content';
}

export default StreamProgramCardsViewModel;

