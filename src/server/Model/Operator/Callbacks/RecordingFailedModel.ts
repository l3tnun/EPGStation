import * as DBSchema from '../../DB/DBSchema';
import Model from '../../Model';
import { RecordedExternalProcessModelInterface } from '../../Operator/RecordedExternalProcessModel';
import { RecordingManageModelInterface } from '../../Operator/Recording/RecordingManageModel';
import CallbackBaseModelInterface from './CallbackBaseModelInterface';

/**
 * RecordingFailedModel
 * 録画中にエラー発生時の処理
 */
class RecordingFailedModel extends Model implements CallbackBaseModelInterface {
    private recordingManage: RecordingManageModelInterface;
    private externalProcess: RecordedExternalProcessModelInterface;
    private cmd: string;

    constructor(
        recordingManage: RecordingManageModelInterface,
        externalProcess: RecordedExternalProcessModelInterface,
    ) {
        super();

        this.recordingManage = recordingManage;
        this.externalProcess = externalProcess;

        this.cmd = this.config.getConfig().recordedFailedCommand;
    }

    public set(): void {
        if (typeof this.cmd === 'undefined') { return; }

        this.recordingManage.recFailedListener((program) => { this.callback(program); });
    }

    /**
     * @param program: DBSchema.RecordedSchema
     */
    private async callback(program: DBSchema.RecordedSchema): Promise<void> {
        // 外部コマンド実行
        await this.externalProcess.run(this.cmd, program, 'recording failed');
    }
}

export default RecordingFailedModel;

