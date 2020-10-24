import { ChildProcess } from 'child_process';
import * as fs from 'fs';
import Util from './Util';

namespace ProcessUtil {
    /**
     * セットしたプロセスを前処理をしてから殺す
     * @param child: ChildProcess
     * @param wait: number default 500
     */
    export const kill = (child: ChildProcess, wait = 500): Promise<void> => {
        return new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
            try {
                if (child.stdin !== null) { child.stdin.end(); }
                if (child.stdout !== null) {
                    child.stdout.unpipe();
                    child.stdout.destroy();
                    child.stdout.removeAllListeners('data');
                }
                if (child.stderr !== null) {
                    child.stderr.unpipe();
                    child.stderr.destroy();
                    child.stderr.removeAllListeners('data');
                }

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
        let args = cmd.split(' ');
        let bin = args.shift();
        if (typeof bin === 'undefined') {
            throw new Error('CmdParseError');
        }

        // %NODE% の replace
        bin = bin.replace(/%NODE%/g, process.argv[0]).replace(/%FFMPEG%/g, Util.getFFmpegPath());

        // bin の存在確認
        try {
            fs.statSync(bin);
        } catch (e) {
            throw new Error('CmdBinIsNotFound');
        }

        // 引数内の %SPACE% を半角スペースに置換
        args = args.map(arg => {
            return arg.replace(/%SPACE%/g, ' ');
        });

        return {
            bin: bin,
            args: args.filter((arg) => {
                return arg.length > 0;
            }),
        };
    };
}

export default ProcessUtil;

