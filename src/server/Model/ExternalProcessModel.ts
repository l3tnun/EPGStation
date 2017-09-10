import * as fs from 'fs';
import { spawn } from 'child_process';
import Model from './Model';
import { RecordedSchema } from './DB/DBSchema';

interface ExternalProcessModelInterface extends Model {
    run(cmd: string, program: RecordedSchema): void;
}

/**
* ExternalProcessMode
* 録画開始時や終了時に外部コマンドを実行する
*/
class ExternalProcessModel extends Model implements ExternalProcessModelInterface {
    public run(cmd: string, program: RecordedSchema): void {
        const args = cmd.split(' ');
        const bin = args.shift();

        if(typeof bin === 'undefined') {
            this.log.system.error('cmd is not found');
            return;
        }

        // bin の存在確認
        try {
            fs.statSync(bin);
        } catch(err) {
            this.log.system.error(`${ bin } is not found`);
            return;
        }

        const child = spawn(bin, args, {
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

export { ExternalProcessModelInterface, ExternalProcessModel }

