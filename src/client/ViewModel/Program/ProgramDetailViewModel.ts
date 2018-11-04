import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import { audioComponentType, audioSamplingRate, videoComponentType } from '../../lib/event';
import { ChannelsApiModelInterface } from '../../Model/Api/ChannelsApiModel';
import { ConfigApiModelInterface } from '../../Model/Api/ConfigApiModel';
import { ReservesApiModelInterface } from '../../Model/Api/ReservesApiModel';
import { ScheduleApiModelInterface } from '../../Model/Api/ScheduleApiModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import DateUtil from '../../Util/DateUtil';
import GenreUtil from '../../Util/GenreUtil';
import Util from '../../Util/Util';
import ViewModel from '../ViewModel';

/**
 * ProgramDetailViewModel
 */
class ProgramDetailViewModel extends ViewModel {
    private scheduleApiModel: ScheduleApiModelInterface;
    private reserves: ReservesApiModelInterface;
    private channels: ChannelsApiModelInterface;
    private config: ConfigApiModelInterface;
    private snackbar: SnackbarModelInterface;

    private isEditing: boolean = false;
    private reserve: apid.Reserve | null = null;

    private enableEncode: boolean = false;
    private encodeOption: string[] = [];


    public directory: string = '';
    public recordedFormat: string = '';
    public encodeModes: { mode: number; directory: string }[] = [
        { mode: -1, directory: '', },
        { mode: -1, directory: '', },
        { mode: -1, directory: '', },
    ];
    public delTs: boolean = false;

    constructor(
        scheduleApiModel: ScheduleApiModelInterface,
        reserves: ReservesApiModelInterface,
        channels: ChannelsApiModelInterface,
        config: ConfigApiModelInterface,
        snackbar: SnackbarModelInterface,
    ) {
        super();
        this.scheduleApiModel = scheduleApiModel;
        this.reserves = reserves;
        this.channels = channels;
        this.config = config;
        this.snackbar = snackbar;
    }

    /**
     * init
     * @param status: ViewModelStatus
     */
    public async init(status: ViewModelStatus = 'init', isEditing: boolean = false): Promise<void> {
        super.init(status);

        if (status === 'reload' || status === 'updateIo') { return this.reloadUpdate(); }

        // 初期化
        this.reserve = null;
        this.isEditing = isEditing;
        if (this.isEditing) {
            // 予約情報取得
            await this.reserves.fetchReserve(this.getProgramId())
            .catch((err) => {
                console.error(err);
                this.openSnackbar('予約情報取得に失敗しました');
            });
            this.reserve = this.reserves.getReserve();
        }

        this.initInputOption();
        this.scheduleApiModel.init();
        if (status === 'update') { m.redraw(); }

        return Util.sleep(100)
        .then(() => {
            return this.updateSchedule();
        })
        .then(() => {
            return this.setConfig();
        });
    }

    /**
     * get Program Id
     * @return number
     */
    private getProgramId(): number {
        const programId = parseInt(m.route.param('programId'), 10);
        if (typeof programId !== 'number') {
            this.openSnackbar('Program Id が不正です。');
            throw new Error('program id is NaN');
        }

        return programId;
    }

    /**
     * reload 時の更新
     */
    public async reloadUpdate(): Promise<void> {
        await this.updateSchedule();
    }

    /**
     * init input option
     */
    private initInputOption(): void {
        this.directory = '';
        this.recordedFormat = '';
        this.encodeModes = [
            { mode: -1, directory: '', },
            { mode: -1, directory: '', },
            { mode: -1, directory: '', },
        ];
        this.delTs = false;

        // 予約情報から各種オプションを取得する
        if (this.reserve !== null) {
            // option
            if (typeof this.reserve.option !== 'undefined') {
                if (typeof this.reserve.option.directory !== 'undefined') {
                    this.directory = this.reserve.option.directory;
                }
                if (typeof this.reserve.option.recordedFormat !== 'undefined') {
                    this.recordedFormat = this.reserve.option.recordedFormat;
                }
            }

            // encode
            if (typeof this.reserve.encode !== 'undefined') {
                // mode1
                if (typeof this.reserve.encode.mode1 !== 'undefined') {
                    this.encodeModes[0].mode = this.reserve.encode.mode1;
                }
                if (typeof this.reserve.encode.directory1 !== 'undefined') {
                    this.encodeModes[0].directory = this.reserve.encode.directory1;
                }

                // mode2
                if (typeof this.reserve.encode.mode2 !== 'undefined') {
                    this.encodeModes[1].mode = this.reserve.encode.mode2;
                }
                if (typeof this.reserve.encode.directory2 !== 'undefined') {
                    this.encodeModes[1].directory = this.reserve.encode.directory2;
                }

                // mode3
                if (typeof this.reserve.encode.mode3 !== 'undefined') {
                    this.encodeModes[2].mode = this.reserve.encode.mode3;
                }
                if (typeof this.reserve.encode.directory3 !== 'undefined') {
                    this.encodeModes[2].directory = this.reserve.encode.directory3;
                }

                // delTs
                this.delTs = this.reserve.encode.delTs;
            }
        }
    }

    /**
     * config から設定を読み込む
     */
    private async setConfig(): Promise<void> {
        const config = this.config.getConfig();
        if (config === null) {
            await Util.sleep(300);

            return this.setConfig();
        }

        this.enableEncode = config.enableEncode;
        this.encodeOption = this.enableEncode && typeof config.encodeOption !== 'undefined' ? config.encodeOption : [];
    }

    /**
     * 番組データを取得する
     */
    public async updateSchedule(): Promise<void> {
        const programId = this.getProgramId();
        if (programId < 0) { return; }

        // 番組情報の取得
        await this.scheduleApiModel.fetchScheduleDetail(this.getProgramId());
    }

    /**
     * 予約追加
     * @return Promise<void>
     */
    public async add(): Promise<void> {
        await this.reserves.addReserve(this.createAddReserve());
    }

    /**
     * 予約更新
     * @return Promise<void>
     */
    public async update(): Promise<void> {
        await this.reserves.updateReserve(this.createAddReserve());
    }

    /**
     * create AddReserve
     * @return apid.AddReserve
     */
    private createAddReserve(): apid.AddReserve {
        const option: apid.AddReserve = {
            programId: this.getProgramId(),
        };

        // option
        if (this.directory.length !== 0 || this.recordedFormat.length !== 0) {
            option.option = {};
            if (this.directory.length !== 0) { option.option.directory = this.directory; }
            if (this.recordedFormat.length !== 0) { option.option.recordedFormat = this.recordedFormat; }
        }

        // encode
        if (this.encodeModes[0].mode !== -1) {
            option.encode = {
                mode1: this.encodeModes[0].mode,
                delTs: this.delTs,
            };
            // mode1 directory
            if (this.encodeModes[0].directory.length !== 0) {
                option.encode.directory1 = this.encodeModes[0].directory;
            }

            // mode2
            if (this.encodeModes[1].mode !== -1) {
                option.encode.mode2 = this.encodeModes[1].mode;
            }
            if (this.encodeModes[1].directory.length !== 0) {
                option.encode.directory2 = this.encodeModes[1].directory;
            }

            // mode3
            if (this.encodeModes[2].mode !== -1) {
                option.encode.mode3 = this.encodeModes[2].mode;
            }
            if (this.encodeModes[2].directory.length !== 0) {
                option.encode.directory3 = this.encodeModes[2].directory;
            }
        }

        return option;
    }

    /**
     * get program
     * @return apid.ScheduleProgramItem | apid.ReserveProgram | null
     */
    public getProgram(): apid.ScheduleProgramItem | apid.ReserveProgram | null {
        if (this.reserve === null) {
            const schedule = this.scheduleApiModel.getSchedule();

            return schedule.length === 0 ? null : schedule[0].programs[0];
        }

        return this.reserve.program;
    }

    /**
     * getChannel
     * @return ScheduleServiceItem | null
     */
    public getChannel(): apid.ScheduleServiceItem | apid.ServiceItem | null {
        if (this.reserve === null) {
            const schedule = this.scheduleApiModel.getSchedule();

            return schedule.length === 0 ? null : schedule[0].channel;
        }

        return this.channels.getChannel(this.reserve.program.channelId);
    }

    /**
     * get encode option
     * @return encode option
     */
    public getEncodeOption(): string[] {
        return this.encodeOption;
    }

    /**
     * encode が有効か
     * @return true: 有効, false: 無効
     */
    public isEnableEncode(): boolean {
        return this.enableEncode;
    }

    /**
     * 編集モードか
     * @return boolean
     */
    public isEditMode(): boolean {
        return this.isEditing;
    }

    /**
     * 時刻を生成
     * @param startAt: UnixtimeMS
     * @param endAt: UnixtimeMS
     * @return str
     */
    public createTimeStr(startAt: apid.UnixtimeMS, endAt: apid.UnixtimeMS): string {
        const start = DateUtil.getJaDate(new Date(startAt));
        const end = DateUtil.getJaDate(new Date(endAt));
        const duration = Math.floor((endAt - startAt) / 1000 / 60);

        return DateUtil.format(start, 'MM/dd(w) hh:mm:ss') + ' ~ ' + DateUtil.format(end, 'hh:mm:ss') + ` (${ duration }分)`;
    }

    /**
     * genre1, genre2 をまとめて生成
     * @return genre1 / genre2
     */
    public createGenresStr(genre1?: apid.ProgramGenreLv1 , genre2?: apid.ProgramGenreLv2): string {
        return GenreUtil.getGenres(genre1, genre2);
    }

    /**
     * video 情報を生成
     * @return video info
     */
    public createVideoInfoStr(type?: number): string {
        if (typeof type === 'undefined') { return ''; }
        const str = videoComponentType[type];

        return typeof str === 'undefined' ? '' : str;
    }

    /**
     * 音声情報を生成
     * @return audio info
     */
    public createAudioModeStr(type?: number): string {
        if (typeof type === 'undefined') { return ''; }
        const str = audioComponentType[type];

        return typeof str === 'undefined' ? '' : str;
    }

    /**
     * 音声サンプリングレートを生成
     * @return audio sampling rate
     */
    public createAudioSamplingRateStr(rate?: apid.ProgramAudioSamplingRate): string {
        if (typeof rate === 'undefined') { return ''; }
        const str = audioSamplingRate[rate];

        return typeof str === 'undefined' ? '' : str;
    }

    /**
     * open snack bar
     * @param str: string
     */
    public openSnackbar(str: string): void {
        this.snackbar.open(str);
    }
}

export default ProgramDetailViewModel;

