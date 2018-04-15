import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import { audioComponentType, audioSamplingRate, videoComponentType } from '../../lib/event';
import { ConfigApiModelInterface } from '../../Model/Api/ConfigApiModel';
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
    private config: ConfigApiModelInterface;
    private snackbar: SnackbarModelInterface;

    private programId: apid.ProgramId | null = null;
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
        config: ConfigApiModelInterface,
        snackbar: SnackbarModelInterface,
    ) {
        super();
        this.scheduleApiModel = scheduleApiModel;
        this.config = config;
        this.snackbar = snackbar;
    }

    /**
     * init
     * @param status: ViewModelStatus
     */
    public init(status: ViewModelStatus = 'init'): Promise<void> {
        super.init(status);

        if (status === 'reload' || status === 'updateIo') { return this.reloadUpdate(); }

        // 初期化
        this.initInputOption();
        this.scheduleApiModel.init();
        m.redraw();

        return Util.sleep(100)
        .then(() => {
            return this.updateSchedule();
        })
        .then(() => {
            return this.setConfig();
        });
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
        const programId = parseInt(m.route.param('programId'), 10);
        if (isNaN(programId)) {
            this.openSnackbar('Program Id が不正です。');
            throw new Error('program id is NaN');
        }
        this.programId = programId;

        // 番組情報の取得
        await this.scheduleApiModel.fetchScheduleDetail(this.programId);
    }

    /**
     * getSchedule
     * @return apid.ScheduleProgram
     */
    public getSchedule(): apid.ScheduleProgram | null {
        const schedule = this.scheduleApiModel.getSchedule();

        return schedule.length === 0 ? null : schedule[0];
    }

    /**
     * get encode option
     * @return encode option
     */
    public getEncodeOption(): string[] {
        return this.encodeOption;
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

