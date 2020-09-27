import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IVideoApiModel from '../..//api/video/IVideoApiModel';
import IRecordingApiModel from '../../api/recording/IRecordingApiModel';
import IRecordedUtil, { RecordedDisplayData } from '../recorded/IRecordedUtil';
import IRecordingState from './IRecordingState';

@injectable()
export default class RecordingState implements IRecordingState {
    private recordingApiModel: IRecordingApiModel;
    private recordedUtil: IRecordedUtil;
    private videoApiModel: IVideoApiModel;

    private recorded: RecordedDisplayData[] | null = null;
    private total: number = 0;

    constructor(
        @inject('IRecordingApiModel') recordingApiModel: IRecordingApiModel,
        @inject('IRecordedUtil') recordedUtil: IRecordedUtil,
        @inject('IVideoApiModel') videoApiModel: IVideoApiModel,
    ) {
        this.recordingApiModel = recordingApiModel;
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
        const recrods = await this.recordingApiModel.gets(option);
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
     * 選択した番組数を返す
     * @return number
     */
    public getSelectedCnt(): number {
        if (this.recorded === null) {
            return 0;
        }

        let selectedCnt = 0;
        for (const r of this.recorded) {
            if (r.isSelected === true) {
                selectedCnt++;
            }
        }

        return selectedCnt;
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
     * @return Promise<void>
     */
    public async multiplueDeletion(): Promise<void> {
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
                videoFileIds.push(v.id);
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
