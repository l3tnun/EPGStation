import ViewModel from '../ViewModel';
import * as apid from '../../../../api';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import { EncodeQueryOption, RecordedApiModelInterface } from '../../Model/Api/RecordedApiModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import { ConfigApiModelInterface } from '../../Model/Api/ConfigApiModel';

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
    }[] = [];
    public encodeModeOptionValue: number = 0;
    public encodeSourceOptionValue: number = 0;
    public isOutputTheOriginalDirectory: boolean = false;

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
    }

    /**
    * recorded のセット
    * @param recorded: recorded
    */
    public set(recorded: apid.RecordedProgram): void {
        this.recorded = recorded;

        this.recordedFiles = [];
        if(this.recorded.original) {
            this.recordedFiles.push({ name: 'TS', encodedId: null, checked: true });
        }
        if(typeof this.recorded.encoded !== 'undefined') {
            for(let encoded of this.recorded.encoded) {
                this.recordedFiles.push({ name: encoded.name, encodedId: encoded.encodedId, checked: true });
            }
        }

        const config = this.config.getConfig();
        if(config === null) { return; }
        this.encodeStatus = config.enableEncode;
        this.encodeSourceOptionValue = 0;
        this.encodeModeOptionValue = 0;
        this.isOutputTheOriginalDirectory = false;
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
        return this.recorded == null || typeof this.recorded.ruleId === 'undefined' ? null : this.recorded.ruleId;
    }

    /**
    * open delete dialog
    */
    public openDelete(): void {
        this.close();
        setTimeout(() => {
            this.balloon.open(RecordedMenuViewModel.deleteId);
        }, 200);
    }

    /**
    * close balloon
    */
    public close(): void {
        this.balloon.close();
    }

    /**
    * delete recorded file
    */
    public async delete(): Promise<void> {
        if(this.recorded === null) { return; }

        let deleteCnt = 0;
        this.recordedFiles.map((file) => {
            if(file.checked) { deleteCnt += 1; }
        });

        if(deleteCnt === this.recordedFiles.length) {
            // delete all
            try {
                await this.recordedApiModel.deleteAll(this.recorded.id);
                this.snackbar.open(`削除: ${ this.recorded.name }`);
            } catch(err) {
                if(err.message === RecordedApiModelInterface.isStreamingNowError) {
                    this.snackbar.open(`配信中のため削除失敗: ${ this.recorded.name }`);
                } else {
                    console.error(err);
                    this.snackbar.open(`削除失敗: ${ this.recorded.name }`);
                }
            }
        } else {
            let deleteCnt = 0;
            //個別削除
            for(let file of this.recordedFiles) {
                if(!file.checked) { continue; }

                try {
                    await this.recordedApiModel.delete(this.recorded!.id, file.encodedId);
                    deleteCnt += 1;
                } catch(err) {
                    console.error(err);
                    if(err.message === RecordedApiModelInterface.isLockedError) {
                        this.snackbar.open(`ファイルがロックされています: ${ file.name }`);
                    } else {
                        this.snackbar.open(`ファイルの削除に失敗しました: ${ file.name }`);
                    }
                }
            }

            if(deleteCnt > 0) {
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
    public getEncodeOption(): { value: number, name: string }[] {
        let config = this.config.getConfig();
        if(!this.encodeStatus || config === null || typeof config.encodeOption === 'undefined') { return []; }

        let result: { value: number, name: string }[] = [];
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
        setTimeout(() => {
            this.balloon.open(RecordedMenuViewModel.encodeId);
        }, 200);
    }

    /**
    * encode 追加
    */
    public async addEncode(): Promise<void> {
        if(this.recorded === null) { return; }

        let option: EncodeQueryOption = {
            mode: this.encodeModeOptionValue,
            isOutputTheOriginalDirectory: this.isOutputTheOriginalDirectory,
        }

        const encodedId = this.recordedFiles[this.encodeSourceOptionValue].encodedId;
        if(encodedId !== null) {
            option.encodedId = encodedId;
        }

        try {
            await this.recordedApiModel.addEncode(this.recorded.id, option);
            this.snackbar.open(`エンコードキューに追加しました`);
        } catch(err) {
            this.snackbar.open(`エンコードキューに追加に失敗しました`);
        }
    }
}

namespace RecordedMenuViewModel {
    export const id = 'recorded-menu'
    export const deleteId = 'recorded-delete'
    export const encodeId = 'recorded-encode'
}

export default RecordedMenuViewModel;

