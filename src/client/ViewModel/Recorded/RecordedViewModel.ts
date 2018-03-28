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

    private isEditMode: boolean = false;
    private editSelectIndex: { [key: number]: boolean } = {};

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

        if (status === 'init' || status === 'update') { this.endEditMode(); }
        if (status === 'reload' || status === 'updateIo') { return this.fetchData(); }

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
            return this.fetchData();
        });
    }

    /**
     * データ取得
     */
    private async fetchData(): Promise<void> {
        await this.recordedApiModel.fetchRecorded(this.limit, this.offset, this.option);
        await this.recordedApiModel.fetchTags();

        if (this.isEditing()) {
            this.setEditSelectIndex();
        }
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

    /**
     * 編集中か
     * @return boolean
     */
    public isEditing(): boolean {
        return this.isEditMode;
    }

    /**
     * 編集中に切り替え
     */
    public startEditMode(): void {
        this.setEditSelectIndex();
        this.isEditMode = true;
    }

    /**
     * 編集モード終了
     */
    public endEditMode(): void {
        this.editSelectIndex = {};
        this.isEditMode = false;
    }

    /**
     * set edit select Index
     */
    private setEditSelectIndex(): void {
        const recorded = this.getRecorded().recorded;
        const newSelectIndex: { [key: number]: boolean } = {};
        for (const r of recorded) {
            const oldData = this.editSelectIndex[r.id];
            newSelectIndex[r.id] = typeof oldData === 'undefined' ? false : oldData;
        }

        // update
        this.editSelectIndex = newSelectIndex;
    }

    /**
     * select
     * @param recordedId: recorded id
     */
    public select(recordedId: number): void {
        if (!this.isEditing()) { return; }
        if (typeof this.editSelectIndex[recordedId] === 'undefined') {
            throw new Error(`${ recordedId } is not found.`);
        }

        this.editSelectIndex[recordedId] = !this.editSelectIndex[recordedId];

        m.redraw();
    }

    /**
     * select all
     * 全て選択済みであれば選択を解除する
     */
    public selectAll(): void {
        let isUnselect = true;
        for (const key in this.editSelectIndex) {
            if (!this.editSelectIndex[key]) {
                isUnselect = false;
            }
            this.editSelectIndex[key] = true;
        }

        if (isUnselect) {
            for (const key in this.editSelectIndex) {
                this.editSelectIndex[key] = false;
            }
        }

        m.redraw();
    }

    /**
     * is selecting
     * @param recordedId: recorded id
     * @return boolean
     */
    public isSelecting(recordedId: number): boolean {
        if (!this.isEditing()) { return false; }

        return this.editSelectIndex[recordedId];
    }

    /**
     * 選択した要素の件数を返す
     * @return number
     */
    public getSelectedCnt(): number {
        if (!this.isEditing()) { return 0; }

        let cnt = 0;
        for (const key in this.editSelectIndex) {
            if (this.editSelectIndex[key]) { cnt += 1; }
        }

        return cnt;
    }
}

export default RecordedViewModel;
