import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IVideoApiModel from '../..//api/video/IVideoApiModel';
import IRecordedApiModel from '../../api/recorded/IRecordedApiModel';
import IRecordedState, { MultipleDeletionOption, SelectedInfo } from './IRecordedState';
import IRecordedUtil, { RecordedDisplayData } from './IRecordedUtil';

@injectable()
export default class RecordedState implements IRecordedState {
    private recordedApiModel: IRecordedApiModel;
    private recordedUtil: IRecordedUtil;
    private videoApiModel: IVideoApiModel;

    private recorded: RecordedDisplayData[] | null = null;
    private total: number = 0;

    constructor(
        @inject('IRecordedApiModel') recordedApiModel: IRecordedApiModel,
        @inject('IRecordedUtil') recordedUtil: IRecordedUtil,
        @inject('IVideoApiModel') videoApiModel: IVideoApiModel,
    ) {
        this.recordedApiModel = recordedApiModel;
        this.recordedUtil = recordedUtil;
        this.videoApiModel = videoApiModel;
    }

    /**
     * 取得した録画情報をクリア
     */
    public clearData(): void {
        this.recorded = null;
        this.total = 0;
    }

    /**
     * 録画情報を取得
     * @param option: apid.GetRecordedOption
     * @return Promise<void>
     */
    public async fetchData(option: apid.GetRecordedOption): Promise<void> {
        const recrods = await this.recordedApiModel.gets(option);
        this.total = recrods.total;

        const oldSelectedIndex: { [recordedId: number]: boolean } = {};
        if (this.recorded !== null) {
            for (const r of this.recorded) {
                oldSelectedIndex[r.recordedItem.id] = r.isSelected;
            }
        }

        this.recorded = recrods.records.map(r => {
            const result = this.recordedUtil.convertRecordedItemToDisplayData(r, option.isHalfWidth);
            if (typeof oldSelectedIndex[result.recordedItem.id] !== 'undefined') {
                result.isSelected = oldSelectedIndex[result.recordedItem.id];
            }

            return result;
        });
    }

    /**
     * 取得した録画情報を返す
     * @return RecordedStateData[]
     */
    public getRecorded(): RecordedDisplayData[] {
        return this.recorded === null ? [] : this.recorded;
    }

    /**
     * 取得した録画の総件数を返す
     * @return number
     */
    public getTotal(): number {
        return this.total;
    }

    /**
     * エンコード停止
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async stopEncode(recordedId: apid.RecordedId): Promise<void> {
        await this.recordedApiModel.stopEncode(recordedId);
    }

    /**
     * 選択した番組数を返す
     * @return SelectedInfo
     */
    public getSelectedCnt(): SelectedInfo {
        if (this.recorded === null) {
            return {
                cnt: 0,
                size: 0,
            };
        }

        let selectedCnt = 0;
        let selectedSize = 0;
        for (const r of this.recorded) {
            if (r.isSelected === true) {
                selectedCnt++;
                if (typeof r.recordedItem.videoFiles !== 'undefined') {
                    for (const v of r.recordedItem.videoFiles) {
                        selectedSize += v.size;
                    }
                }
            }
        }

        return {
            cnt: selectedCnt,
            size: selectedSize,
        };
    }

    /**
     * 選択 (削除時の複数選択)
     * @param recordedId: apid.RecordedId
     */
    public select(recordedId: apid.RecordedId): void {
        if (this.recorded === null) {
            return;
        }

        for (const r of this.recorded) {
            if (r.recordedItem.id === recordedId) {
                r.isSelected = !r.isSelected;

                return;
            }
        }
    }

    /**
     * 全て選択 (削除時の複数選択)
     */
    public selectAll(): void {
        if (this.recorded === null) {
            return;
        }

        let isUnselectAll = true;
        for (const r of this.recorded) {
            if (r.isSelected === false) {
                isUnselectAll = false;
            }
            r.isSelected = true;
        }

        // 全て選択済みであれば選択を解除する
        if (isUnselectAll === true) {
            for (const r of this.recorded) {
                r.isSelected = false;
            }
        }
    }

    /**
     * 全ての選択解除 (削除時の複数選択)
     */
    public clearSelect(): void {
        if (this.recorded === null) {
            return;
        }

        for (const r of this.recorded) {
            r.isSelected = false;
        }
    }

    /**
     * 選択した番組を削除する
     * @param option: MultipleDeletionOption
     */
    public async multiplueDeletion(option: MultipleDeletionOption): Promise<void> {
        if (this.recorded === null) {
            return;
        }

        // 削除する video file を列挙する
        const videoFileIds: apid.VideoFileId[] = [];
        for (const r of this.recorded) {
            if (r.isSelected === false || typeof r.recordedItem.videoFiles === 'undefined') {
                continue;
            }

            for (const v of r.recordedItem.videoFiles) {
                if (option === 'All' || (option === 'OnlyOriginalFile' && v.type === 'ts') || (option === 'OnlyEncodedFile' && v.type === 'encoded')) {
                    videoFileIds.push(v.id);
                }
            }
        }

        // 選択状態を元に戻す
        this.clearSelect();

        // 列挙したビデオファイルを削除する
        let hasError = false;
        for (const v of videoFileIds) {
            try {
                await this.videoApiModel.delete(v);
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
