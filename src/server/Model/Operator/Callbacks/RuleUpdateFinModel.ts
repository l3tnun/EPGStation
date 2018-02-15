import Model from '../../Model';
import CallbackBaseModelInterface from './CallbackBaseModelInterface';
import { ReservationManageModelInterface } from '../../Operator/Reservation/ReservationManageModel';
import { RecordingManageModelInterface } from '../../Operator/Recording/RecordingManageModel';
import { RecordedManageModelInterface } from '../../Operator/Recorded/RecordedManageModel';
import { RuleEventStatus, RuleManageModelInterface } from '../../Operator/Rule/RuleManageModel';
import Util from '../../../Util/Util';

/**
* RuleUpdateFinModel
* Rule 更新終了後の処理
*/
class RuleUpdateFinModel extends Model implements CallbackBaseModelInterface {
    private reservationManage: ReservationManageModelInterface;
    private recordingManage: RecordingManageModelInterface;
    private recordedManage: RecordedManageModelInterface;
    private ruleManage: RuleManageModelInterface;

    constructor(
        reservationManage: ReservationManageModelInterface,
        recordingManage: RecordingManageModelInterface,
        recordedManage: RecordedManageModelInterface,
        ruleManage: RuleManageModelInterface,
    ) {
        super();

        this.recordingManage = recordingManage;
        this.recordedManage = recordedManage;
        this.reservationManage = reservationManage;
        this.ruleManage = ruleManage;
    }

    public set(): void {
        this.ruleManage.addListener((id, status) => { this.callback(id, status); });
    }

    /**
    * @param ruleId: rule id
    * @param status: RuleEventStatus
    * @param isRetry: true: retry, false: retry ではない
    */
    private async callback(ruleId: number, status: RuleEventStatus, isRetry: boolean = false): Promise<void> {
        // ルールが削除 or 無効化されたとき、そのルールの予約を停止する
        if(!isRetry && (status === 'delete' || status === 'disable')) {
            this.recordingManage.stopRuleId(ruleId);
        }

        // ルールが削除されたとき recorded の整合性をとる
        if(!isRetry && status === 'delete') {
            // SQLite3 使用時に正しく動作しないので sleep
            await Util.sleep(100);
            try {
                await this.recordedManage.deleteRule(ruleId);
            } catch(err) {
                this.log.system.error(err);
            }
        }

        // ルールが更新されたので予約を更新する
        try {
            await this.reservationManage.updateRule(ruleId);
        } catch(err) {
            this.log.system.error('ReservationManage update Error');
            this.log.system.error(err);
            setTimeout(() => { this.callback(ruleId, status, true) }, 1000);
        }
    }
}

export default RuleUpdateFinModel;

