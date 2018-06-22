import * as DBSchema from '../../DB/DBSchema';
import { IPCServerInterface } from '../../IPC/IPCServer';
import Model from '../../Model';
import { RecordingManageModelInterface } from '../../Operator/Recording/RecordingManageModel';
import { ReserveExternalProcessModelInterface } from '../../Operator/ReserveExternalProcessModel';
import CallbackBaseModelInterface from './CallbackBaseModelInterface';

/**
 * RecordingPreStartModel
 * 録画準備開始後の処理
 */
class RecordingPreStartModel extends Model implements CallbackBaseModelInterface {
    private recordingManage: RecordingManageModelInterface;
    private externalProcess: ReserveExternalProcessModelInterface;
    private ipc: IPCServerInterface;

    constructor(
        recordingManage: RecordingManageModelInterface,
        externalProcess: ReserveExternalProcessModelInterface,
        ipc: IPCServerInterface,
    ) {
        super();

        this.recordingManage = recordingManage;
        this.externalProcess = externalProcess;
        this.ipc = ipc;
    }

    public set(): void {
        this.recordingManage.recPreStartListener((program) => { this.callback(program); });
    }

    /**
     * @param program: DBSchema.ProgramSchema
     */
    private callback(program: DBSchema.ProgramSchema): void {
        // socket.io で通知
        this.ipc.notifIo();

        // 外部コマンド実行
        const cmd = this.config.getConfig().recordedPreStartCommand;
        if (typeof cmd !== 'undefined') {
            this.externalProcess.run(cmd, program, 'recording pre start');
        }
    }
}

export default RecordingPreStartModel;

