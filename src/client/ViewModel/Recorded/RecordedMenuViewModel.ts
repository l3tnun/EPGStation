import * as apid from '../../../../api';
import { ConfigApiModelInterface } from '../../Model/Api/ConfigApiModel';
import { EncodeQueryOption, RecordedApiModelInterface } from '../../Model/Api/RecordedApiModel';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import Util from '../../Util/Util';
import ViewModel from '../ViewModel';

/**
 * RecordedMenuViewModel
 */
class RecordedMenuViewModel extends ViewModel {
    private balloon: BalloonModelInterface;
    private recordedApiModel: RecordedApiModelInterface;
    private snackbar: SnackbarModelInterface;
    private config: ConfigApiModelInterface;
    private recorded: apid.RecordedProgram | null = null;
    private encodeStatus: boolean = false; // true: encode 有効

    public recordedFiles: {
        name: string;
        encodedId: number | null;
        checked: boolean;
        size: number | null;
    }[] = [];
    public encodeSourceOptionValue: number = 0;
    public encodeDirectoryOptionValue: string = '';
    public isOutputTheOriginalDirectory: boolean = false;
    public delTs: boolean = false;

    constructor(
        balloon: BalloonModelInterface,
        recordedApiModel: RecordedApiModelInterface,
        snackbar: SnackbarModelInterface,
        config: ConfigApiModelInterface,
    ) {
        super();
        this.balloon = balloon;
        this.recordedApiModel = recordedApiModel;
        this.snackbar = snackbar;
        this.config = config;

        if (Util.uaIsAndroid()) {
            this.balloon.regDisableCloseAllId(RecordedMenuViewModel.encodeId);

            window.addEventListener('orientationchange', () => {
                if (document.getElementById(RecordedMenuViewModel.encodeId) === null || !this.balloon.isOpen(RecordedMenuViewModel.encodeId)) { return; }

                this.close();
            }, false);
        }
    }

    /**
     * recorded のセット
     * @param recorded: recorded
     */
    public set(recorded: apid.RecordedProgram): void {
        this.recorded = recorded;

        this.recordedFiles = [];
        if (this.recorded.original) {
            this.recordedFiles.push({
                name: 'TS',
                encodedId: null,
                checked: true,
                size: typeof recorded.filesize === 'undefined' ? null : recorded.filesize,
            });
        }
        if (typeof this.recorded.encoded !== 'undefined') {
            for (const encoded of this.recorded.encoded) {
                this.recordedFiles.push({
                    name: encoded.name,
                    encodedId: encoded.encodedId,
                    checked: true,
                    size: typeof encoded.filesize === 'undefined' ? null : encoded.filesize,
                });
            }
        }

        const config = this.config.getConfig();
        if (config === null) { return; }
        this.encodeStatus = config.enableEncode;
        this.encodeSourceOptionValue = 0;
        this.encodeDirectoryOptionValue = '';
    }

    /**
     * get title
     * @return title
     */
    public getTitle(): string {
        return this.recorded === null ? '' : this.recorded.name;
    }

    /**
     * get rule id
     * @return rule id | null
     */
    public getRuleId(): apid.RuleId | null {
        return this.recorded === null || typeof this.recorded.ruleId === 'undefined' ? null : this.recorded.ruleId;
    }

    /**
     * open delete dialog
     */
    public openDelete(): void {
        this.close();
        window.setTimeout(() => {
            this.balloon.open(RecordedMenuViewModel.deleteId);
        }, 200);
    }

    /**
     * close balloon
     */
    public close(): void {
        this.balloon.close();
        this.balloon.close(RecordedMenuViewModel.encodeId);
    }

    /**
     * delete recorded file
     */
    public async delete(): Promise<void> {
        if (this.recorded === null) { return; }

        let deleteCnt = 0;
        this.recordedFiles.map((file) => {
            if (file.checked) { deleteCnt += 1; }
        });

        if (deleteCnt === this.recordedFiles.length) {
            // delete all
            try {
                await this.recordedApiModel.deleteAll(this.recorded.id);
                this.snackbar.open(`削除: ${ this.recorded.name }`);
            } catch (err) {
                if (err.message === RecordedApiModelInterface.isStreamingNowError) {
                    this.snackbar.open(`配信中のため削除失敗: ${ this.recorded.name }`);
                } else {
                    console.error(err);
                    this.snackbar.open(`削除失敗: ${ this.recorded.name }`);
                }
            }
        } else {
            deleteCnt = 0;
            // 個別削除
            for (const file of this.recordedFiles) {
                if (!file.checked) { continue; }

                try {
                    await this.recordedApiModel.delete(this.recorded!.id, file.encodedId);
                    deleteCnt += 1;
                } catch (err) {
                    console.error(err);
                    if (err.message === RecordedApiModelInterface.isLockedError) {
                        this.snackbar.open(`ファイルがロックされています: ${ file.name }`);
                    } else {
                        this.snackbar.open(`ファイルの削除に失敗しました: ${ file.name }`);
                    }
                }
            }

            if (deleteCnt > 0) {
                this.snackbar.open(`指定したファイルを削除しました: ${ this.recorded.name }`);
            }
        }

        await this.recordedApiModel.update();
        await this.recordedApiModel.fetchTags();
    }

    /**
     * エンコードオプションが有効か
     * @return true: 有効, false: 無効
     */
    public isEnableEncode(): boolean {
        return this.encodeStatus && this.recorded !== null && !this.recorded.recording;
    }

    /**
     * エンコードオプションを取得する
     * @return encode option
     */
    public getEncodeOption(): { value: number; name: string }[] {
        const config = this.config.getConfig();
        if (!this.encodeStatus || config === null || typeof config.encodeOption === 'undefined') { return []; }

        const result: { value: number; name: string }[] = [];
        config.encodeOption.forEach((option, i) => {
            result.push({ value: i, name: option });
        });

        return result;
    }

    /**
     * open encode dialog
     */
    public openEncode(): void {
        this.close();
        window.setTimeout(() => {
            this.balloon.open(RecordedMenuViewModel.encodeId);
        }, 200);
    }

    /**
     * encode 追加
     */
    public async addEncode(option: EncodeQueryOption): Promise<void> {
        if (this.recorded === null) { return; }

        const encodedId = this.recordedFiles[this.encodeSourceOptionValue].encodedId;
        if (encodedId !== null) {
            option.encodedId = encodedId;
        }

        if (this.encodeDirectoryOptionValue.length > 0) {
            option.directory = this.encodeDirectoryOptionValue;
        }

        try {
            await this.recordedApiModel.addEncode(this.recorded.id, option);
            this.snackbar.open('エンコードキューに追加しました');
        } catch (err) {
            this.snackbar.open('エンコードキューへの追加に失敗しました');
        }
    }

    /**
     * encode 中か
     * @return boolean
     */
    public isEncoding(): boolean {
        return this.recorded === null ? false : typeof this.recorded.encoding !== 'undefined';
    }

    /**
     * encode cancel
     */
    public async cancelEncode(): Promise<void> {
        if (this.recorded === null) { return; }

        try {
            await this.recordedApiModel.cancelEncode(this.recorded.id);
            this.snackbar.open('エンコードをキャンセルしました');
        } catch (err) {
            this.snackbar.open('エンコードのキャンセルに失敗しました');
        }
    }
}

namespace RecordedMenuViewModel {
    export const id = 'recorded-menu';
    export const deleteId = 'recorded-delete';
    export const encodeId = 'recorded-encode';
}

export default RecordedMenuViewModel;

