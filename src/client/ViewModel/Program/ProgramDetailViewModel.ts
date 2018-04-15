import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import { ScheduleApiModelInterface } from '../../Model/Api/ScheduleApiModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import Util from '../../Util/Util';
import ViewModel from '../ViewModel';

/**
 * ProgramDetailViewModel
 */
class ProgramDetailViewModel extends ViewModel {
    private scheduleApiModel: ScheduleApiModelInterface;
    private snackbar: SnackbarModelInterface;

    private programId: apid.ProgramId | null = null;

    constructor(
        scheduleApiModel: ScheduleApiModelInterface,
        snackbar: SnackbarModelInterface,
    ) {
        super();
        this.scheduleApiModel = scheduleApiModel;
        this.snackbar = snackbar;
    }

    /**
     * init
     * @param status: ViewModelStatus
     */
    public init(status: ViewModelStatus = 'init'): Promise<void> {
        super.init(status);

        // 初期化
        this.scheduleApiModel.init();
        m.redraw();

        return Util.sleep(100)
        .then(() => {
            return this.updateSchedule();
        });
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
     * open snack bar
     * @param str: string
     */
    public openSnackbar(str: string): void {
        this.snackbar.open(str);
    }
}

export default ProgramDetailViewModel;

