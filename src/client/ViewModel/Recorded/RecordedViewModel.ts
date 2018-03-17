import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import { ChannelsApiModelInterface } from '../../Model/Api/ChannelsApiModel';
import { FindQueryOption, RecordedApiModelInterface } from '../../Model/Api/RecordedApiModel';
import { SettingModelInterface } from '../../Model/Setting/SettingModel';
import DateUtil from '../../Util/DateUtil';
import Util from '../../Util/Util';
import ViewModel from '../ViewModel';

/**
 * RecordedViewModel
 */
class RecordedViewModel extends ViewModel {
    private recordedApiModel: RecordedApiModelInterface;
    private channels: ChannelsApiModelInterface;
    private setting: SettingModelInterface;
    private limit: number = 0;
    private offset: number = 0;
    private option: FindQueryOption = {};

    constructor(
        recordedApiModel: RecordedApiModelInterface,
        channels: ChannelsApiModelInterface,
        setting: SettingModelInterface,
    ) {
        super();
        this.recordedApiModel = recordedApiModel;
        this.channels = channels;
        this.setting = setting;
    }

    /**
     * init
     * @param status: ViewModelStatus
     */
    public init(status: ViewModelStatus = 'init', wait: number = 100): Promise<void> {
        super.init(status);

        if (status === 'reload' || status === 'updateIo') { return this.reloadInit(); }

        this.limit = typeof m.route.param('length') === 'undefined' ? this.setting.value.recordedLength : Number(m.route.param('length'));
        this.offset = typeof m.route.param('page') === 'undefined' ? 0 : (Number(m.route.param('page')) - 1) * this.limit;

        this.option = {};
        if (typeof m.route.param('rule') !== 'undefined') { this.option.rule = Number(m.route.param('rule')); }
        if (typeof m.route.param('genre1') !== 'undefined') { this.option.genre1 = Number(m.route.param('genre1')); }
        if (typeof m.route.param('channel') !== 'undefined') { this.option.channel = Number(m.route.param('channel')); }
        if (typeof m.route.param('keyword') !== 'undefined') { this.option.keyword = m.route.param('keyword'); }

        this.recordedApiModel.init();
        m.redraw();

        // 録画一覧を更新
        return Util.sleep(wait)
        .then(() => {
            return this.recordedApiModel.fetchRecorded(this.limit, this.offset, this.option);
        })
        .then(() => {
            return this.recordedApiModel.fetchTags();
        });
    }

    /**
     * reload 時の init
     */
    private async reloadInit(): Promise<void> {
        await this.recordedApiModel.fetchRecorded(this.limit, this.offset, this.option);
        await this.recordedApiModel.fetchTags();
    }

    /**
     * recorded 一覧を返す
     * @return apid.RecordedPrograms
     */
    public getRecorded(): apid.RecordedPrograms {
        return this.recordedApiModel.getRecorded();
    }

    /**
     * id を指定して channel 名を取得する
     * @param channelId: channel id
     * @return string
     */
    public getChannelName(channelId: number): string {
        const channel = this.channels.getChannel(channelId);

        return channel === null ? String(channelId) : channel.name;
    }

    /**
     * get time str
     * @param recorded: apid.RecordedProgram
     * @return string
     */
    public getTimeStr(recorded: apid.RecordedProgram): string {
        const start = DateUtil.getJaDate(new Date(recorded.startAt));
        const end = DateUtil.getJaDate(new Date(recorded.endAt));
        const duration = Math.floor((recorded.endAt - recorded.startAt) / 1000 / 60);

        return DateUtil.format(start, 'MM/dd(w) hh:mm:ss') + ' ~ ' + DateUtil.format(end, 'hh:mm:ss') + `(${ duration }分)`;
    }

    /**
     * limit を返す
     */
    public getLimit(): number {
        return this.limit;
    }
}

export default RecordedViewModel;
