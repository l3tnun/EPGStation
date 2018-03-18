import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import { ChannelsApiModelInterface } from '../../Model/Api/ChannelsApiModel';
import { ReservesApiModelInterface } from '../../Model/Api/ReservesApiModel';
import { ScheduleApiModelInterface } from '../../Model/Api/ScheduleApiModel';
import { SettingModelInterface } from '../../Model/Setting/SettingModel';
import Util from '../../Util/Util';
import ViewModel from '../ViewModel';

enum Mode {
    reserves,
    conflicts,
}

/**
 * ReservesViewModel
 */
class ReservesViewModel extends ViewModel {
    private reservesApiModel: ReservesApiModelInterface;
    private channels: ChannelsApiModelInterface;
    private scheduleApiModel: ScheduleApiModelInterface;
    private setting: SettingModelInterface;
    private limit: number = 0;
    private offset: number = 0;
    private mode: Mode;

    constructor(
        reservesApiModel: ReservesApiModelInterface,
        channels: ChannelsApiModelInterface,
        scheduleApiModel: ScheduleApiModelInterface,
        setting: SettingModelInterface,
    ) {
        super();
        this.reservesApiModel = reservesApiModel;
        this.channels = channels;
        this.scheduleApiModel = scheduleApiModel;
        this.setting = setting;
    }

    /**
     * init
     * @param status: ViewModelStatus
     */
    public init(status: ViewModelStatus = 'init', wait: number = 200): Promise<void> {
        super.init(status);

        if (typeof m.route.param('mode') === 'undefined') {
            this.mode = Mode.reserves;
        } else if (m.route.param('mode') === 'conflicts') {
            this.mode = Mode.conflicts;
        }

        if (status === 'reload' || status === 'updateIo') {
            this.reloadInit();

            return Promise.resolve();
        }

        this.limit = typeof m.route.param('length') === 'undefined' ? this.setting.value.reservesLength : Number(m.route.param('length'));
        this.offset = typeof m.route.param('page') === 'undefined' ? 0 : (Number(m.route.param('page')) - 1) * this.limit;

        this.reservesApiModel.init();
        this.scheduleApiModel.init();
        m.redraw();

        return Util.sleep(wait)
        .then(() => {
            // 予約一覧を更新
            return this.fetch(this.limit, this.offset);
        });
    }

    /**
     * reload 時の init
     */
    private async reloadInit(): Promise<void> {
        await this.fetch(this.limit, this.offset);
    }

    /**
     * 予約を更新する
     */
    private async fetch(limit: number, offset: number): Promise<void> {
        if (this.mode === Mode.reserves) {
            return await this.reservesApiModel.fetchReserves(limit, offset);
        } else {
            return await this.reservesApiModel.fetchConflicts(limit, offset);
        }
    }

    /**
     * 予約一覧を返す
     * @return apid.Reserves
     */
    public getReserves(): apid.Reserves {
        if (this.mode === Mode.reserves) {
            return this.reservesApiModel.getReserves();
        } else {
            return this.reservesApiModel.getConflicts();
        }
    }

    /**
     * id を指定して channel 名を取得する
     * @param channelId: channel id
     * @return string
     */
    public getChannelName(channelId: apid.ServiceItemId): string {
        const channel = this.channels.getChannel(channelId);

        return channel === null ? String(channelId) : channel.name;
    }

    /**
     * id を指定して channel を取得する
     * @param channelId: channel id
     * @return apid.ServiceItem | null
     */
    public getChannel(channelId: apid.ServiceItemId): apid.ServiceItem | null {
        const channel = this.channels.getChannel(channelId);

        return channel === null ? null : channel;
    }

    /**
     * limit を返す
     */
    public getLimit(): number {
        return this.limit;
    }

    /**
     * 予約情報更新を開始する
     */
    public startUpdateReserves(): Promise<void> {
        return this.scheduleApiModel.startUpdateReserves();
    }
}

export default ReservesViewModel;

