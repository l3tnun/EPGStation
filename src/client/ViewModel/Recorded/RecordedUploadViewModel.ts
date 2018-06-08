import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import { genre1, genre2 } from '../../lib/event';
import { ChannelsApiModelInterface } from '../../Model/Api/ChannelsApiModel';
import { RecordedApiModelInterface, UploadQueryOption } from '../../Model/Api/RecordedApiModel';
import { RulesApiModelInterface } from '../../Model/Api/RulesApiModel';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import ViewModel from '../ViewModel';

interface UploadFile {
    file: File | null;
    name: string;
}

/**
 * RecordedUploadViewModel
 */
class RecordedUploadViewModel extends ViewModel {
    private channels: ChannelsApiModelInterface;
    private rules: RulesApiModelInterface;
    private recorded: RecordedApiModelInterface;
    private snackbar: SnackbarModelInterface;
    private balloon: BalloonModelInterface;

    private newRecordedId: number | null = null;

    public station: number = 0;
    public genrelv1: apid.ProgramGenreLv1 = -1;
    public genrelv2: apid.ProgramGenreLv1 = -1;
    public ruleId: number = 0;
    public date: string = '';
    public time: string = '';
    public duration: number = 0;
    public title: string = '';
    public description: string = '';
    public extended: string = '';
    public directory: string = '';
    public tsFile: File | null = null;
    public tsName: string = '';
    public encodeFiles: UploadFile[] = [];

    constructor(
        channels: ChannelsApiModelInterface,
        rules: RulesApiModelInterface,
        recorded: RecordedApiModelInterface,
        snackbar: SnackbarModelInterface,
        balloon: BalloonModelInterface,
    ) {
        super();

        this.channels = channels;
        this.rules = rules;
        this.recorded = recorded;
        this.snackbar = snackbar;
        this.balloon = balloon;

        this.balloon.regDisableCloseAllId(RecordedUploadViewModel.uploadingId);
    }

    /**
     * init
     */
    public async init(status: ViewModelStatus = 'init'): Promise<void> {
        super.init(status);

        if (status === 'init' || status === 'update') {
            this.initInput();
            this.newRecordedId = null;

            await this.rules.fetchRuleList();
        }
    }

    /**
     * init input
     */
    public initInput(): void {
        this.station = 0;
        this.genrelv1 = -1;
        this.initGenre2();
        this.ruleId = 0;
        this.date = '';
        this.time = '';
        this.duration = 0;
        this.title = '';
        this.description = '';
        this.extended = '';
        this.directory = '';
        this.tsFile = null;
        this.tsName = '';
        this.encodeFiles = [];
    }

    /**
     * get channels
     * @return channels
     */
    public getChannels(): apid.ServiceItem[] {
        return this.channels.getChannels();
    }

    /**
     * get genre1
     * @return genre1
     */
    public getGenre1(): { value: number; name: string }[] {
        const result: { value: number; name: string }[] = [];
        for (let i = 0x0; i <= 0xF; i++) {
            if (genre1[i].length === 0) { continue; }
            result.push({ value: i, name: genre1[i] });
        }

        return result;
    }

    /**
     * get genre2
     * @return genre2
     */
    public getGenre2(): { value: number; name: string }[] {
        const result: { value: number; name: string }[] = [];
        if (typeof genre2[this.genrelv1] === 'undefined') { return []; }

        for (let i = 0x0; i <= 0xF; i++) {
            if (genre2[this.genrelv1][i].length === 0) { continue; }
            result.push({ value: i, name: genre2[this.genrelv1][i] });
        }

        return result;
    }

    /**
     * init genre2
     */
    public initGenre2(): void {
        this.genrelv2 = -1;
    }

    /**
     * get rule list
     * @return apid.RuleList[]
     */
    public getRuleList(): apid.RuleList[] {
        return this.rules.getRuleList();
    }

    /**
     * create new encode file
     */
    public createNewEncode(): void {
        this.encodeFiles.push({
            file: null,
            name: '',
        });
    }

    /**
     * upload file
     */
    public async upload(): Promise<void> {
        // 必須項目が埋まっているかチェック
        if (this.station === 0 || this.date.length === 0 || this.time.length === 0 || this.duration === 0 || this.title.length === 0) {
            this.snackbar.open('必要な項目が入力されていません。');

            return;
        }

        if (this.tsFile === null) {
            let isError = true;
            for (const encoded of this.encodeFiles) {
                if (encoded.file !== null) {
                    isError = false;
                    break;
                }
            }

            if (isError) {
                this.snackbar.open('アップロードするファイルを 1 つ以上選択してください。');

                return;
            }
        }

        // startAt
        const dates = this.date.split('-');
        const startAt = new Date(`${ dates[0] }/${ dates[1] }/${ dates[2] } ${ this.time }:00 +0900`).getTime();

        // create new recorded option
        const newRecorded: apid.NewRecorded = {
            channelId: this.station,
            startAt: startAt,
            endAt: startAt + (this.duration * 60 * 1000),
            name: this.title,
        };

        if (this.description.length !== 0) { newRecorded.description = this.description; }
        if (this.extended.length !== 0) { newRecorded.extended = this.extended; }
        if (this.genrelv1 !== -1) {
            newRecorded.genre1 = this.genrelv1;
            if (this.genrelv2 !== -1) {
                newRecorded.genre2 = this.genrelv2;
            }
        }
        if (this.ruleId !== 0) { newRecorded.ruleId = this.ruleId; }

        // create new recorded
        this.newRecordedId = await this.recorded.createNewRecord(newRecorded);

        // create upload file option
        const files: UploadQueryOption[] = [];

        // ts file option
        if (this.tsFile !== null) {
            const tsOption: UploadQueryOption = {
                id: this.newRecordedId,
                encoded: false,
                name: this.tsName.length === 0 ? 'TS' : this.tsName,
                file: this.tsFile,
            };
            if (this.directory.length !== 0) {
                tsOption.directory = this.directory;
            }

            files.push(tsOption);
        }

        // encoded file option
        for (const encoded of this.encodeFiles) {
            if (encoded.file === null) { continue; }

            const option: UploadQueryOption = {
                id: this.newRecordedId,
                encoded: true,
                name: encoded.name.length === 0 ? 'TS' : encoded.name,
                file: encoded.file,
            };
            if (this.directory.length !== 0) {
                option.directory = this.directory;
            }

            files.push(option);
        }

        this.open();

        // upload file
        for (const file of files) {
            await this.recorded.uploadFile(file)
            .catch((err) => {
                console.error(err);
            });

            // upload 中断
            if (this.newRecordedId === null) {
                this.close();

                return;
            }
        }

        this.newRecordedId = null;
        this.close();
        this.snackbar.open('アップロードが完了しました。');
    }

    /**
     * file upload をキャンセル
     */
    public async abortUpload(): Promise<void> {
        if (this.newRecordedId === null) { return; }

        // cancel upload
        this.recorded.abortUpload();

        // delete recorded
        await this.recorded.deleteAll(this.newRecordedId);
        this.newRecordedId = null;

        this.snackbar.open('アップロードを中断しました。');
    }

    /**
     * open balloon
     */
    private open(): void {
        this.balloon.open(RecordedUploadViewModel.uploadingId);
    }

    /**
     * close balloon
     */
    public close(): void {
        this.balloon.close(RecordedUploadViewModel.uploadingId);
    }
}

namespace RecordedUploadViewModel {
    export const uploadingId = 'uploading';
}

export default RecordedUploadViewModel;

