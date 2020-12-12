import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import DateUtil from '../../../util/DateUtil';
import IEncodeApiModel from '../../api/encode/IEncodeApiModel';
import IChannelModel from '../../channels/IChannelModel';
import IEncodeState, { EncodeInfoDisplayData, EncodeInfoDisplayItem } from './IEncodeState';

interface SelectedIndex {
    [encodeId: number]: boolean;
}
@injectable()
export default class EncodeState implements IEncodeState {
    private encodeApiModel: IEncodeApiModel;
    private channelModel: IChannelModel;

    private encodeInfo: EncodeInfoDisplayData | null = null;

    constructor(@inject('IEncodeApiModel') encodeApiModel: IEncodeApiModel, @inject('IChannelModel') channelModel: IChannelModel) {
        this.encodeApiModel = encodeApiModel;
        this.channelModel = channelModel;
    }

    /**
     * 取得した録画情報をクリア
     */
    public clearData(): void {
        this.encodeInfo = null;
    }

    /**
     * エンコード情報を取得
     * @param isHalfWidth: 半角で取得するか
     * @return Promise<void>
     */
    public async fetchData(isHalfWidth: boolean): Promise<void> {
        const info = await this.encodeApiModel.gets(isHalfWidth);

        const oldSelectedIndex: SelectedIndex = {};
        if (this.encodeInfo !== null) {
            for (const e of this.encodeInfo.runningItems) {
                oldSelectedIndex[e.encodeItem.id] = e.isSelected;
            }
        }

        this.encodeInfo = {
            runningItems: [],
            waitItems: [],
        };

        this.encodeInfo.runningItems = info.runningItems.map(i => {
            return this.convertEncodeProgramItemToDiplayData(i, isHalfWidth, oldSelectedIndex);
        });
        this.encodeInfo.waitItems = info.waitItems.map(i => {
            return this.convertEncodeProgramItemToDiplayData(i, isHalfWidth, oldSelectedIndex);
        });
    }

    /**
     * EncodeInfoDisplayItem を EncodeInfoDisplayItem へ変換する
     * @param item: apid.EncodeProgramItem
     * @param isHalfWidth: チャンネル情報を半角で取得するか
     * @param isSelectedIndex?: SelectedIndex
     * @return EncodeInfoDisplayItem
     */
    private convertEncodeProgramItemToDiplayData(item: apid.EncodeProgramItem, isHalfWidth: boolean, isSelectedIndex: SelectedIndex): EncodeInfoDisplayItem {
        const startAt = DateUtil.getJaDate(new Date(item.recorded.startAt));
        const endAt = DateUtil.getJaDate(new Date(item.recorded.endAt));
        const channel = this.channelModel.findChannel(item.recorded.channelId, isHalfWidth);

        const result: EncodeInfoDisplayItem = {
            display: {
                channelName: channel === null ? item.recorded.channelId.toString(10) : channel.name,
                name: item.recorded.name,
                time: DateUtil.format(startAt, 'MM/dd(w) hh:mm ~ ') + DateUtil.format(endAt, 'hh:mm'),
                duration: Math.floor((item.recorded.endAt - item.recorded.startAt) / 1000 / 60),
                topThumbnailPath:
                    typeof item.recorded.thumbnails === 'undefined' || item.recorded.thumbnails.length === 0
                        ? './img/noimg.png'
                        : `./api/thumbnails/${item.recorded.thumbnails[0]}`,
                mode: item.mode,
            },
            encodeItem: item,
            isSelected: typeof isSelectedIndex[item.id] === 'undefined' ? false : isSelectedIndex[item.id],
        };

        if (typeof item.percent !== 'undefined' && typeof item.log !== 'undefined') {
            result.display.encodeInfo = `${Math.floor(item.percent * 100)}% ${item.log}`;
            result.display.percent = item.percent * 100;
        }

        return result;
    }

    /**
     * 取得したエンコード情報を返す
     * @return EncodeInfoDisplayData[]
     */
    public getEncodeInfo(): EncodeInfoDisplayData {
        return this.encodeInfo === null
            ? {
                  runningItems: [],
                  waitItems: [],
              }
            : this.encodeInfo;
    }

    /**
     * 選択した番組数を返す
     * @return number
     */
    public getSelectedCnt(): number {
        if (this.encodeInfo === null) {
            return 0;
        }

        let selectedCnt = 0;
        for (const r of this.encodeInfo.runningItems) {
            if (r.isSelected === true) {
                selectedCnt++;
            }
        }

        for (const r of this.encodeInfo.waitItems) {
            if (r.isSelected === true) {
                selectedCnt++;
            }
        }

        return selectedCnt;
    }

    /**
     * 選択 (削除時の複数選択)
     * @param encodeId: apid.EncodeId
     */
    public select(encodeId: apid.EncodeId): void {
        if (this.encodeInfo === null) {
            return;
        }

        for (const r of this.encodeInfo.runningItems) {
            if (r.encodeItem.id === encodeId) {
                r.isSelected = !r.isSelected;

                return;
            }
        }

        for (const r of this.encodeInfo.waitItems) {
            if (r.encodeItem.id === encodeId) {
                r.isSelected = !r.isSelected;

                return;
            }
        }
    }

    /**
     * 全て選択 (削除時の複数選択)
     */
    public selectAll(): void {
        if (this.encodeInfo === null) {
            return;
        }

        let isUnselectAll = true;
        for (const r of this.encodeInfo.runningItems) {
            if (r.isSelected === false) {
                isUnselectAll = false;
            }
            r.isSelected = true;
        }
        for (const r of this.encodeInfo.waitItems) {
            if (r.isSelected === false) {
                isUnselectAll = false;
            }
            r.isSelected = true;
        }

        // 全て選択済みであれば選択を解除する
        if (isUnselectAll === true) {
            for (const r of this.encodeInfo.runningItems) {
                r.isSelected = false;
            }
            for (const r of this.encodeInfo.waitItems) {
                r.isSelected = false;
            }
        }
    }

    /**
     * 全ての選択解除 (削除時の複数選択)
     */
    public clearSelect(): void {
        if (this.encodeInfo === null) {
            return;
        }

        for (const r of this.encodeInfo.runningItems) {
            r.isSelected = false;
        }
        for (const r of this.encodeInfo.waitItems) {
            r.isSelected = false;
        }
    }

    /**
     * 選択したエンコードをキャンセルする
     * @return Promise<void>
     */
    public async multiplueDeletion(): Promise<void> {
        if (this.encodeInfo === null) {
            return;
        }

        // 削除する video file を列挙する
        const reserveIds: apid.ReserveId[] = [];
        for (const r of this.encodeInfo.runningItems) {
            if (r.isSelected === true) {
                reserveIds.push(r.encodeItem.id);
            }
        }
        for (const r of this.encodeInfo.waitItems) {
            if (r.isSelected === true) {
                reserveIds.push(r.encodeItem.id);
            }
        }

        // 選択状態を元に戻す
        this.clearSelect();

        // 列挙した予約をキャンセルする
        let hasError = false;
        for (const id of reserveIds) {
            try {
                await this.encodeApiModel.cancel(id);
            } catch (err) {
                console.error(err);
                hasError = true;
            }
        }

        if (hasError === true) {
            throw new Error();
        }
    }
}
