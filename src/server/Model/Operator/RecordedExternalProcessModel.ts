import { spawn } from 'child_process';
import ProcessUtil from '../../Util/ProcessUtil';
import { RecordedSchema } from '../DB/DBSchema';
import Model from '../Model';

interface RecordedExternalProcessModelInterface extends Model {
    run(cmd: string, program: RecordedSchema, name: string): void;
}

/**
 * RecordedExternalProcessMode
 * 録画情報を元に外部コマンドを実行する
 */
class RecordedExternalProcessModel extends Model implements RecordedExternalProcessModelInterface {
    /**
     * @param cmd: cmd
     * @param program: RecordedSchema
     * @param name: process name
     */
    public run(cmd: string, program: RecordedSchema, name: string): void {
        this.log.system.info(`${ name } process run: ${ cmd }`);

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
            this.log.system.info(`${ name } process is fin`);
        });

        child.on('error', (err) => {
            this.log.system.error(`${ name } process is error`);
            this.log.system.error(String(err));
        });
    }
}

export { RecordedExternalProcessModelInterface, RecordedExternalProcessModel };

