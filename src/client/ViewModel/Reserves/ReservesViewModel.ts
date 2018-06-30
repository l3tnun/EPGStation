import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import { ChannelsApiModelInterface } from '../../Model/Api/ChannelsApiModel';
import { ReservesApiModelInterface } from '../../Model/Api/ReservesApiModel';
import { ScheduleApiModelInterface } from '../../Model/Api/ScheduleApiModel';
import { SettingValue } from '../../Model/Setting/SettingModel';
import StorageTemplateModel from '../../Model/Storage/StorageTemplateModel';
import Util from '../../Util/Util';
import ViewModel from '../ViewModel';

enum ReserveMode {
    reserves,
    conflicts,
    overlaps,
}

/**
 * ReservesViewModel
 */
class ReservesViewModel extends ViewModel {
    private reservesApiModel: ReservesApiModelInterface;
    private channels: ChannelsApiModelInterface;
    private scheduleApiModel: ScheduleApiModelInterface;
    private setting: StorageTemplateModel<SettingValue>;
    private limit: number = 0;
    private offset: number = 0;
    private mode: ReserveMode;

    constructor(
        reservesApiModel: ReservesApiModelInterface,
        channels: ChannelsApiModelInterface,
        scheduleApiModel: ScheduleApiModelInterface,
        setting: StorageTemplateModel<SettingValue>,
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
            this.mode = ReserveMode.reserves;
        } else if (m.route.param('mode') === 'conflicts') {
            this.mode = ReserveMode.conflicts;
        } else if (m.route.param('mode') === 'overlaps') {
            this.mode = ReserveMode.overlaps;
        }

        if (status === 'reload' || status === 'updateIo') {
            this.reloadInit();

            return Promise.resolve();
        }

        this.limit = typeof m.route.param('length') === 'undefined' ? this.setting.getValue().reservesLength : Number(m.route.param('length'));
        this.offset = typeof m.route.param('page') === 'undefined' ? 0 : (Number(m.route.param('page')) - 1) * this.limit;

        this.reservesApiModel.init();
        this.scheduleApiModel.init();
        if (status === 'update') { m.redraw(); }

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
        if (this.mode === ReserveMode.reserves) {
            return await this.reservesApiModel.fetchReserves(limit, offset);
        } else if (this.mode === ReserveMode.conflicts) {
            return await this.reservesApiModel.fetchConflicts(limit, offset);
        } else {
            return await this.reservesApiModel.fetchOverlaps(limit, offset);
        }
    }

    /**
     * get title
     * @return string
     */
    public getTitle(): string {
        if (this.mode === ReserveMode.reserves) {
            return '予約';
        } else if (this.mode === ReserveMode.conflicts) {
            return '競合';
        } else {
            return '重複';
        }
    }

    /**
     * 予約一覧を返す
     * @return apid.Reserves
     */
    public getReserves(): apid.Reserves {
        if (this.mode === ReserveMode.reserves) {
            return this.reservesApiModel.getReserves();
        } else if (this.mode === ReserveMode.conflicts) {
            return this.reservesApiModel.getConflicts();
        } else {
            return this.reservesApiModel.getOverlaps();
        }
    }

    /**
     * 現在のページを取得
     * @return number
     */
    public getPage(): number {
        return this.reservesApiModel.getPage();
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

    public getMode(): ReserveMode {
        return this.mode;
    }
}

export { ReserveMode, ReservesViewModel };

