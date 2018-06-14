import { spawn } from 'child_process';
import ProcessUtil from '../../Util/ProcessUtil';
import { RecordedSchema } from '../DB/DBSchema';
import Model from '../Model';

interface ExternalProcessModelInterface extends Model {
    run(cmd: string, program: RecordedSchema): void;
}

/**
 * ExternalProcessMode
 * 録画開始時や終了時に外部コマンドを実行する
 */
class ExternalProcessModel extends Model implements ExternalProcessModelInterface {
    public run(cmd: string, program: RecordedSchema): void {
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
                RECORDEDID: program.id,
                PROGRAMID: program.programId,
                CHANNELTYPE: program.channelType,
                STARTAT: program.startAt,
                ENDAT: program.endAt,
                DURATION: program.duration,
                NAME: program.name,
                DESCRIPTION: program.description,
                EXTENDED: program.extended,
            },
        });

        child.on('exit', () => {
            this.log.system.info('external process is fin');
        });

        child.on('error', (err) => {
            this.log.system.error('external process is error');
            this.log.system.error(String(err));
        });
    }
}

export { ExternalProcessModelInterface, ExternalProcessModel };

