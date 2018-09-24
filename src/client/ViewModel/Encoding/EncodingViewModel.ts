import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import { ChannelsApiModelInterface } from '../../Model/Api/ChannelsApiModel';
import { EncodingApiModelInterface } from '../../Model/Api/EncodingApiModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import DateUtil from '../../Util/DateUtil';
import Util from '../../Util/Util';
import ViewModel from '../ViewModel';


/**
 * EncodingViewModel
 */
class EncodingViewModel extends ViewModel {
    private encodingApiModel: EncodingApiModelInterface;
    private channels: ChannelsApiModelInterface;
    private snackbar: SnackbarModelInterface;
    private encoding: apid.EncodingProgram[] = [];

    private isEditMode: boolean = false;
    private editSelectIndex: { [id: string]: boolean } = {};

    constructor(
        encodingApiModel: EncodingApiModelInterface,
        channels: ChannelsApiModelInterface,
        snackbar: SnackbarModelInterface,
    ) {
        super();

        if (status === 'init' || status === 'update') { this.endEditMode(); }

        this.encodingApiModel = encodingApiModel;
        this.channels = channels;
        this.snackbar = snackbar;
    }

    /**
     * init
     * @param status: ViewModelStatus
     */
    public async init(status: ViewModelStatus = 'init'): Promise<void> {
        super.init(status);

        this.encodingApiModel.init();

        await Util.sleep(100);
        await this.fetchData();
    }

    /**
     * fetchData
     */
    private async fetchData(): Promise<void> {
        await this.encodingApiModel.fetchInfo();
        const info = this.encodingApiModel.getInfo();

        if (typeof info.encoding === 'undefined') {
            this.encoding = [];

            return;
        }

        this.encoding = [info.encoding];
        this.encoding.push(...info.queue);
    }

    /**
     * encoding 一覧を返す
     * @return apid.EncodingProgram[]
     */
    public getEncoding(): apid.EncodingProgram[] {
        return this.encoding;
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
     * set edit select Index
     */
    private setEditSelectIndex(): void {
        const newSelectIndex: { [key: number]: boolean } = {};
        for (const program of this.encoding) {
            const oldProgram = this.editSelectIndex[program.id];
            newSelectIndex[program.id] = typeof oldProgram === 'undefined' ? false : oldProgram;
        }

        // update
        this.editSelectIndex = newSelectIndex;
    }

    /**
     * 編集モード終了
     */
    public endEditMode(): void {
        this.editSelectIndex = {};
        this.isEditMode = false;
    }

    /**
     * select
     * @param encodeId: encode id
     */
    public select(encodeId: string): void {
        if (!this.isEditing()) { return; }
        if (typeof this.editSelectIndex[encodeId] === 'undefined') {
            throw new Error(`${ encodeId } is not found.`);
        }

        this.editSelectIndex[encodeId] = !this.editSelectIndex[encodeId];

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
     * @param encodeId: encode id
     * @return boolean
     */
    public isSelecting(encodeId: string): boolean {
        if (!this.isEditing()) { return false; }

        return !!this.editSelectIndex[encodeId];
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

    /**
     * 選択した番組のエンコードを停止
     * @return Promise<void>
     */
    public async stopSelectedEncode(): Promise<void> {
        const ids: string[] = [];
        for (const key in this.editSelectIndex) {
            if (this.editSelectIndex[key]) {
                ids.push(key);
            }
        }

        try {
            await this.encodingApiModel.stops(ids);
            this.openSnackbar('選択した番組のエンコードを停止しました');
        } catch (err) {
            this.openSnackbar('エンコード停止エラー');
        }

        this.endEditMode();
        m.redraw();
    }

    /**
     * open snack bar
     * @param str: string
     */
    public openSnackbar(str: string): void {
        this.snackbar.open(str);
    }
}

namespace EncodingViewModel {
    export const multipleStopId = 'multipleStop';
}

export default EncodingViewModel;

