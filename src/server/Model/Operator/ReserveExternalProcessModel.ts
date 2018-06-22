import { spawn } from 'child_process';
import ProcessUtil from '../../Util/ProcessUtil';
import { ProgramSchema } from '../DB/DBSchema';
import Model from '../Model';

interface ReserveExternalProcessModelInterface extends Model {
    run(cmd: string, program: ProgramSchema, name: string): void;
}

/**
 * ReserveExternalProcessMode
 * 番組情報を元に外部コマンドを実行する
 */
class ReserveExternalProcessModel extends Model implements ReserveExternalProcessModelInterface {
    /**
     * @param cmd: cmd
     * @param program: ProgramSchema
     * @param name: process name
     */
    public run(cmd: string, program: ProgramSchema, name: string): void {
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
            this.log.system.info(`${ name } process is fin`);
        });

        child.on('error', (err) => {
            this.log.system.error(`${ name } process is error`);
            this.log.system.error(String(err));
        });
    }
}

export { ReserveExternalProcessModelInterface, ReserveExternalProcessModel };

