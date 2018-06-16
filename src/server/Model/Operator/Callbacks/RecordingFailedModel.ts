import * as DBSchema from '../../DB/DBSchema';
import Model from '../../Model';
import { ExternalProcessModelInterface } from '../../Operator/ExternalProcessModel';
import { RecordingManageModelInterface } from '../../Operator/Recording/RecordingManageModel';
import CallbackBaseModelInterface from './CallbackBaseModelInterface';

/**
 * RecordingFailedModel
 * 録画中にエラー発生時の処理
 */
class RecordingFailedModel extends Model implements CallbackBaseModelInterface {
    private recordingManage: RecordingManageModelInterface;
    private externalProcess: ExternalProcessModelInterface;

    constructor(
        recordingManage: RecordingManageModelInterface,
        externalProcess: ExternalProcessModelInterface,
    ) {
        super();

        this.recordingManage = recordingManage;
        this.externalProcess = externalProcess;
    }

    public set(): void {
        this.recordingManage.recFailedListener((program) => { this.callback(program); });
    }

    /**
     * @param program: DBSchema.RecordedSchema
     */
    private callback(program: DBSchema.RecordedSchema): void {
        // 外部コマンド実行
        const cmd = this.config.getConfig().recordedFailedCommand;
        if (typeof cmd !== 'undefined') {
            this.externalProcess.run(cmd, program);
        }
    }
}

export default RecordingFailedModel;

