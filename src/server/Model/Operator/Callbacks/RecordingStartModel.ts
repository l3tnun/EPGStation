import Model from '../../Model';
import CallbackBaseModelInterface from './CallbackBaseModelInterface';
import * as DBSchema from '../../DB/DBSchema';
import { RecordingManageModelInterface } from '../../Operator/Recording/RecordingManageModel';
import { ExternalProcessModelInterface } from '../../Operator/ExternalProcessModel';
import { IPCServerInterface } from '../../IPC/IPCServer';

/**
* RecordingStartModel
* 録画開始後の処理
*/
class RecordingStartModel extends Model implements CallbackBaseModelInterface {
    private recordingManage: RecordingManageModelInterface;
    private externalProcess: ExternalProcessModelInterface;
    private ipc: IPCServerInterface;

    constructor(
        recordingManage: RecordingManageModelInterface,
        externalProcess: ExternalProcessModelInterface,
        ipc: IPCServerInterface,
    ) {
        super();

        this.recordingManage = recordingManage;
        this.externalProcess = externalProcess;
        this.ipc = ipc;
    }

    public set(): void {
        this.recordingManage.recStartListener((program) => { this.callback(program); });
    }

    /**
    * @param program: DBSchema.RecordedSchema
    */
    private callback(program: DBSchema.RecordedSchema): void {
        // socket.io で通知
        this.ipc.notifIo();

        // 外部コマンド実行
        let cmd = this.config.getConfig().recordedStartCommand;
        if(typeof cmd !== 'undefined') {
            this.externalProcess.run(cmd, program);
        }
    }
}

export default RecordingStartModel;

