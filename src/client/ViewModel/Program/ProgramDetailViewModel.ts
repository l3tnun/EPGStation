import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import { ConfigApiModelInterface } from '../../Model/Api/ConfigApiModel';
import { ScheduleApiModelInterface } from '../../Model/Api/ScheduleApiModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
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
            this.setConfig();
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
    private setConfig(): void {
        const config = this.config.getConfig();
        if (config === null) { return; }

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
        this.scheduleApiModel.fetchScheduleDetail(this.programId);
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
     * open snack bar
     * @param str: string
     */
    public openSnackbar(str: string): void {
        this.snackbar.open(str);
    }
}

export default ProgramDetailViewModel;

