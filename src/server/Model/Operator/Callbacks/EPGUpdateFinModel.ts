import * as apid from '../../../../../node_modules/mirakurun/api';
import Model from '../../Model';
import CallbackBaseModelInterface from './CallbackBaseModelInterface';
import { MirakurunManageModelInterface } from '../../Operator/EPGUpdate/MirakurunManageModel';
import { ReservationManageModelInterface } from '../../Operator/Reservation/ReservationManageModel';

/**
* EPGUpdateFinModel
* EPG 更新終了後の処理
*/
class EPGUpdateFinModel extends Model implements CallbackBaseModelInterface {
    private mirakurunManage: MirakurunManageModelInterface;
    private reservationManage: ReservationManageModelInterface;
    
    constructor(
        mirakurunManage: MirakurunManageModelInterface,
        reservationManage: ReservationManageModelInterface,
    ) {
        super();

        this.mirakurunManage = mirakurunManage;
        this.reservationManage = reservationManage;
    }

    public set(): void {
        this.mirakurunManage.addListener((tuners) => { this.callback(tuners); });
    }

    private async callback(tuners: apid.TunerDevice[]): Promise<void> {
        this.reservationManage.setTuners(tuners);

        //すべての予約を更新
        try {
            await this.reservationManage.updateAll();
        } catch(err) {
            this.log.system.error('ReservationManage update Error');
            this.log.system.error(err);

            setTimeout(() => { this.callback(tuners) }, 1000);
        };
    }
}

export default EPGUpdateFinModel;

