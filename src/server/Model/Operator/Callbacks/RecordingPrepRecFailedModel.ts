import * as DBSchema from '../../DB/DBSchema';
import Model from '../../Model';
import { ProgramExternalProcessModelInterface } from '../../Operator/ProgramExternalProcessModel';
import { RecordingManageModelInterface } from '../../Operator/Recording/RecordingManageModel';
import CallbackBaseModelInterface from './CallbackBaseModelInterface';

/**
 * RecordingPrepRecFailedModel
 * 録画準備開失敗時の処理
 */
class RecordingPrepRecFailedModel extends Model implements CallbackBaseModelInterface {
    private recordingManage: RecordingManageModelInterface;
    private externalProcess: ProgramExternalProcessModelInterface;
    private cmd: string;

    constructor(
        recordingManage: RecordingManageModelInterface,
        externalProcess: ProgramExternalProcessModelInterface,
    ) {
        super();

        this.recordingManage = recordingManage;
        this.externalProcess = externalProcess;

        this.cmd = this.config.getConfig().recordedPrepRecFailedCommand;
    }

    public set(): void {
        if (typeof this.cmd === 'undefined') { return; }

        this.recordingManage.preprecFailedListener((program) => { this.callback(program); });
    }

    /**
     * @param program: DBSchema.ProgramSchema
     */
    private async callback(program: DBSchema.ProgramSchema): Promise<void> {
        // 外部コマンド実行
        await this.externalProcess.run(this.cmd, program, 'recording preprec failed');
    }
}

export default RecordingPrepRecFailedModel;

