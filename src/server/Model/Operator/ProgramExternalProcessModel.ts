import { spawn } from 'child_process';
import ProcessUtil from '../../Util/ProcessUtil';
import { ProgramSchema } from '../DB/DBSchema';
import { ServicesDBInterface } from '../DB/ServicesDB';
import QueueProcessBaseModel from './QueueProcessBaseModel';

interface ProgramExternalProcessModelInterface extends QueueProcessBaseModel {
    run(cmd: string, program: ProgramSchema, name: string): Promise<void>;
}

/**
 * ProgramExternalProcessMode
 * 番組情報を元に外部コマンドを実行する
 */
class ProgramExternalProcessModel extends QueueProcessBaseModel implements ProgramExternalProcessModelInterface {
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
        await this.push(async() => {
            this.log.system.info(`${ name } process run: ${ cmd }`);

            let cmds: ProcessUtil.Cmds;
            try {
                cmds = ProcessUtil.parseCmdStr(cmd);
            } catch (err) {
                this.log.system.error(<any> err);

                return;
            }

            const channel = await this.servicesDB.findId(program.channelId);

            return new Promise<void>((resolve: () => void) => {
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
                } as any);

                child.on('exit', () => {
                    this.log.system.info(`${ name } process is fin`);
                    resolve();
                });

                child.on('error', (err) => {
                    this.log.system.error(`${ name } process is error`);
                    this.log.system.error(String(err));
                    resolve();
                });
            });
        });
    }
}

export { ProgramExternalProcessModelInterface, ProgramExternalProcessModel };

