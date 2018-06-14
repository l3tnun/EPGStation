import { ChildProcess } from 'child_process';
import * as fs from 'fs';

namespace ProcessUtil {
    /**
     * セットしたプロセスを前処理をしてから殺す
     * @param child: ChildProcess
     * @param wait: number default 500
     */
    export const kill = (child: ChildProcess, wait = 500): Promise<void> => {
        return new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
            try {
                child.stdin.end();
                child.stdout.unpipe();
                child.stderr.unpipe();
                child.stdout.destroy();
                child.stderr.destroy();
                child.stdout.removeAllListeners('data');
                child.stderr.removeAllListeners('data');

                setTimeout(() => {
                    child.kill('SIGINT');
                    resolve();
                }, wait);
            } catch (err) {
                reject(err);
            }
        });
    };

    export interface Cmds {
        bin: string;
        args: string[];
    }

    /**
     * 渡された cmd 文字列を bin と args に分離する
     * @param cmd: string
     * @return ProcessUtil.Cmds
     */
    export const parseCmdStr = (cmd: string): ProcessUtil.Cmds => {
        const args = cmd.split(' ');
        const bin = args.shift();
        if (typeof bin === 'undefined') {
            throw new Error('CmdParseError');
        }

        // bin の存在確認
        try {
            fs.statSync(bin);
        } catch (e) {
            throw new Error('CmdBinIsNotFound');
        }

        return {
            bin: bin,
            args: args.filter((arg) => {
                return arg.length > 0;
            }),
        };
    };
}

export default ProcessUtil;

