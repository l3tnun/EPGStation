import { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 子process（プロセスグループ）の生存確認・終了・コマンド文字列の分解等、外部process
 * 起動まわりで共通して使う補助関数群。
 */
namespace ProcessUtil {
    export const wait = (milliseconds: number): Promise<void> => {
        return new Promise(resolve => {
            setTimeout(resolve, milliseconds);
        });
    };

    export const isProcessGroupAlive = (pgid: number): boolean => {
        try {
            process.kill(-pgid, 0);
            return true;
        } catch (err: any) {
            if (err?.code === 'ESRCH') {
                return false;
            }
            throw err;
        }
    };

    export const killProcessGroup = (pgid: number, signal: NodeJS.Signals): void => {
        process.kill(-pgid, signal);
    };

    /**
     * セットしたプロセスを前処理をしてから殺す
     * @param child: ChildProcess
     * @param wait: number default 500
     */
    export const kill = (child: ChildProcess, wait = 500): Promise<void> => {
        return new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
            try {
                if (child.stdin !== null) {
                    child.stdin.end();
                }
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
            } catch (err: any) {
                reject(err);
            }
        });
    };

    export interface Cmds {
        bin: string;
        args: string[];
    }

    export const ROOT_PATH = path.join(import.meta.dirname, '..', '..').replace(new RegExp(`\\${path.sep}$`), '');

    /**
     * 渡された cmd 文字列を bin と args に分離する
     * @param cmd: string
     * @return ProcessUtil.Cmds
     */
    export const parseCmdStr = (cmd: string): ProcessUtil.Cmds => {
        let args = cmd.split(' ');
        let bin = args.shift() as string;
        // %NODE% の replace
        bin = bin.replace(/%NODE%/g, process.argv[0]);

        // bin の存在確認
        try {
            fs.statSync(bin);
        } catch (e: any) {
            throw new Error('CmdBinIsNotFound', { cause: e });
        }

        args = args
            .map(arg => {
                // 引数内の %ROOT% を置換
                return arg.replace(/%ROOT%/g, ROOT_PATH);
            })
            .map(arg => {
                // 引数内の %SPACE% を半角スペースに置換
                return arg.replace(/%SPACE%/g, ' ');
            });

        return {
            bin: bin,
            args: args.filter(arg => {
                return arg.length > 0;
            }),
        };
    };

    /**
     * プロセスが終了しているか
     * @param child ChildProcess
     * @return boolean 終了していれば true を返す
     */
    export const isExited = (child: ChildProcess): boolean => {
        return child.exitCode !== null;
    };
}

export default ProcessUtil;
