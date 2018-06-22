import { spawn } from 'child_process';
import ProcessUtil from '../../Util/ProcessUtil';
import { ProgramSchema } from '../DB/DBSchema';
import { ServicesDBInterface } from '../DB/ServicesDB';
import Model from '../Model';

interface ReserveExternalProcessModelInterface extends Model {
    run(cmd: string, program: ProgramSchema, name: string): Promise<void>;
}

/**
 * ReserveExternalProcessMode
 * 番組情報を元に外部コマンドを実行する
 */
class ReserveExternalProcessModel extends Model implements ReserveExternalProcessModelInterface {
    private servicesDB: ServicesDBInterface;

    constructor(servicesDB: ServicesDBInterface) {
        super();

        this.servicesDB = servicesDB;
    }

    /**
     * @param cmd: cmd
     * @param program: ProgramSchema
     * @param name: process name
     */
    public async run(cmd: string, program: ProgramSchema, name: string): Promise<void> {
        this.log.system.info(`${ name } process run: ${ cmd }`);

        let cmds: ProcessUtil.Cmds;
        try {
            cmds = ProcessUtil.parseCmdStr(cmd);
        } catch (err) {
            this.log.system.error(<any> err);

            return;
        }

        const channel = await this.servicesDB.findId(program.channelId);

        const child = spawn(cmds.bin, cmds.args, {
            env: {
                PROGRAMID: program.id,
                CHANNELTYPE: program.channelType,
                CHANNELID: program.channelId,
                CHANNELNAME: channel === null ? null : channel.name,
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

