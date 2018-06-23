import * as DBSchema from '../../DB/DBSchema';
import { IPCServerInterface } from '../../IPC/IPCServer';
import Model from '../../Model';
import { RecordedExternalProcessModelInterface } from '../../Operator/RecordedExternalProcessModel';
import { RecordingManageModelInterface } from '../../Operator/Recording/RecordingManageModel';
import CallbackBaseModelInterface from './CallbackBaseModelInterface';

/**
 * RecordingStartModel
 * 録画開始後の処理
 */
class RecordingStartModel extends Model implements CallbackBaseModelInterface {
    private recordingManage: RecordingManageModelInterface;
    private externalProcess: RecordedExternalProcessModelInterface;
    private ipc: IPCServerInterface;
    private cmd: string;

    constructor(
        recordingManage: RecordingManageModelInterface,
        externalProcess: RecordedExternalProcessModelInterface,
        ipc: IPCServerInterface,
    ) {
        super();

        this.recordingManage = recordingManage;
        this.externalProcess = externalProcess;
        this.ipc = ipc;

        this.cmd = this.config.getConfig().recordedStartCommand;
    }

    public set(): void {
        if (typeof this.cmd === 'undefined') { return; }

        this.recordingManage.recStartListener((program) => { this.callback(program); });
    }

    /**
     * @param program: DBSchema.RecordedSchema
     */
    private async callback(program: DBSchema.RecordedSchema): Promise<void> {
        // socket.io で通知
        this.ipc.notifIo();

        // 外部コマンド実行
        await this.externalProcess.run(this.cmd, program, 'recording start');
    }
}

export default RecordingStartModel;

