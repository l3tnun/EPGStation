import * as apid from '../../../../../node_modules/mirakurun/api';
import { RecordedHistoryDBInterface } from '../../DB/RecordedHistoryDB';
import Model from '../../Model';
import { MirakurunManageModelInterface } from '../../Operator/EPGUpdate/MirakurunManageModel';
import { RecordingStreamCreatorInterface } from '../../Operator/Recording/RecordingStreamCreator';
import { ReservationManageModelInterface } from '../../Operator/Reservation/ReservationManageModel';
import CallbackBaseModelInterface from './CallbackBaseModelInterface';

/**
 * EPGUpdateFinModel
 * EPG 更新終了後の処理
 */
class EPGUpdateFinModel extends Model implements CallbackBaseModelInterface {
    private mirakurunManage: MirakurunManageModelInterface;
    private recordingStreamCreator: RecordingStreamCreatorInterface;
    private reservationManage: ReservationManageModelInterface;
    private recordedHistoryDB: RecordedHistoryDBInterface;
    private recordedHistoryRetentionPeriodDays: number;

    constructor(
        mirakurunManage: MirakurunManageModelInterface,
        recordingStreamCreator: RecordingStreamCreatorInterface,
        reservationManage: ReservationManageModelInterface,
        recordedHistoryDB: RecordedHistoryDBInterface,
    ) {
        super();

        this.mirakurunManage = mirakurunManage;
        this.recordingStreamCreator = recordingStreamCreator;
        this.reservationManage = reservationManage;
        this.recordedHistoryDB = recordedHistoryDB;

        this.recordedHistoryRetentionPeriodDays = this.config.getConfig().recordedHistoryRetentionPeriodDays || 30;
    }

    public set(): void {
        this.mirakurunManage.addListener((tuners) => { this.callback(tuners); });
    }

    private async callback(tuners: apid.TunerDevice[]): Promise<void> {
        this.recordingStreamCreator.setTuners(tuners);
        this.reservationManage.setTuners(tuners);

        // RecordedHistory の保存期間外のデータを削除
        await this.recordedHistoryDB.delete(new Date().getTime() - this.recordedHistoryRetentionPeriodDays * 24 * 60 * 60 * 1000)
        .catch((err) => {
            this.log.system.error('RecordedHistory Delete Error');
            this.log.system.error(err);
        });

        // すべての予約を更新
        await this.reservationManage.updateAll()
        .catch((err) => {
            this.log.system.error('ReservationManage update Error');
            this.log.system.error(err);

            setTimeout(() => { this.callback(tuners); }, 1000);
        });
    }
}

export default EPGUpdateFinModel;

