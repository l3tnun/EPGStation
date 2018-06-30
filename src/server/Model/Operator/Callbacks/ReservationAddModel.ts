import * as DBSchema from '../../DB/DBSchema';
import Model from '../../Model';
import { ProgramExternalProcessModelInterface } from '../../Operator/ProgramExternalProcessModel';
import { ReservationManageModelInterface } from '../../Operator/Reservation/ReservationManageModel';
import CallbackBaseModelInterface from './CallbackBaseModelInterface';

/**
 * ReservationAddModel
 * 録画準備開始後の処理
 */
class ReservationAddModel extends Model implements CallbackBaseModelInterface {
    private reservationManage: ReservationManageModelInterface;
    private externalProcess: ProgramExternalProcessModelInterface;
    private cmd: string;

    constructor(
        reservationManage: ReservationManageModelInterface,
        externalProcess: ProgramExternalProcessModelInterface,
    ) {
        super();

        this.reservationManage = reservationManage;
        this.externalProcess = externalProcess;

        this.cmd = this.config.getConfig().reservationAddCommand;
    }

    public set(): void {
        if (typeof this.cmd === 'undefined') { return; }

        this.reservationManage.addReservationListener((program) => { this.callback(program); });
    }

    /**
     * @param program: DBSchema.ProgramSchema
     */
    private async callback(program: DBSchema.ProgramSchema): Promise<void> {
        // 外部コマンド実行
        await this.externalProcess.run(this.cmd, program, 'reservation add start');
    }
}

export default ReservationAddModel;

