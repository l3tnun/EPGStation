import { spawn } from 'child_process';
import * as fs from 'fs';
import * as DBSchema from '../../DB/DBSchema';
import { IPCServerInterface } from '../../IPC/IPCServer';
import Model from '../../Model';
import { RecordingManageModelInterface } from '../../Operator/Recording/RecordingManageModel';
import CallbackBaseModelInterface from './CallbackBaseModelInterface';

/**
 * RecordingPreStartModel
 * 録画準備開始後の処理
 */
class RecordingPreStartModel extends Model implements CallbackBaseModelInterface {
    private recordingManage: RecordingManageModelInterface;
    private ipc: IPCServerInterface;

    constructor(
        recordingManage: RecordingManageModelInterface,
        ipc: IPCServerInterface,
    ) {
        super();

        this.recordingManage = recordingManage;
        this.ipc = ipc;
    }

    public set(): void {
        this.recordingManage.recPreStartListener((program) => { this.callback(program); });
    }

    /**
     * @param program: DBSchema.RecordedSchema
     */
    private callback(program: DBSchema.ProgramSchema): void {
        // socket.io で通知
        this.ipc.notifIo();

        // 外部コマンド実行
        const cmd = this.config.getConfig().recordedPreStartCommand;
        if (typeof cmd === 'undefined') { return; }

        const args = cmd.split(' ');
        const bin = args.shift();

        if (typeof bin === 'undefined') {
            this.log.system.error('cmd is not found');

            return;
        }

        // bin の存在確認
        try {
            fs.statSync(bin);
        } catch (err) {
            this.log.system.error(`${ bin } is not found`);

            return;
        }

        const child = spawn(bin, args, {
            env: {
                PROGRAMID: program.id,
                CHANNELTYPE: program.channelType,
                CHANNELID: program.channelId,
                STARTAT: program.startAt,
                ENDAT: program.endAt,
                DURATION: program.duration,
                NAME: program.name,
                DESCRIPTION: program.description,
                EXTENDED: program.extended,
            },
        });

        child.on('exit', () => {
            this.log.system.info('recording pre start process is fin');
        });

        child.on('error', (err) => {
            this.log.system.error('recording pre start process is error');
            this.log.system.error(String(err));
        });
    }
}

export default RecordingPreStartModel;

