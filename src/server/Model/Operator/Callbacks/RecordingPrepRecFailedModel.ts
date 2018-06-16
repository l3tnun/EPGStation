import { spawn } from 'child_process';
import ProcessUtil from '../../../Util/ProcessUtil';
import * as DBSchema from '../../DB/DBSchema';
import Model from '../../Model';
import { RecordingManageModelInterface } from '../../Operator/Recording/RecordingManageModel';
import CallbackBaseModelInterface from './CallbackBaseModelInterface';

/**
 * RecordingPrepRecFailedModel
 * 録画準備開失敗時の処理
 */
class RecordingPrepRecFailedModel extends Model implements CallbackBaseModelInterface {
    private recordingManage: RecordingManageModelInterface;

    constructor(
        recordingManage: RecordingManageModelInterface,
    ) {
        super();

        this.recordingManage = recordingManage;
    }

    public set(): void {
        this.recordingManage.preprecFailedListener((program) => { this.callback(program); });
    }

    /**
     * @param program: DBSchema.RecordedSchema
     */
    private callback(program: DBSchema.ProgramSchema): void {
        // 外部コマンド実行
        const cmd = this.config.getConfig().recordedPrepRecFailedCommand;
        if (typeof cmd === 'undefined') { return; }

        this.log.system.info(`run: ${ cmd }`);

        let cmds: ProcessUtil.Cmds;
        try {
            cmds = ProcessUtil.parseCmdStr(cmd);
        } catch (err) {
            this.log.system.error(<any> err);

            return;
        }

        const child = spawn(cmds.bin, cmds.args, {
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
            this.log.system.info('recording preprec failed process is fin');
        });

        child.on('error', (err) => {
            this.log.system.error('recording preprec failed process is error');
            this.log.system.error(String(err));
        });
    }
}

export default RecordingPrepRecFailedModel;

