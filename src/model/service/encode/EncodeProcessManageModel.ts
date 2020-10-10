import { ChildProcess, spawn } from 'child_process';
import * as events from 'events';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import ProcessUtil from '../../../util/ProcessUtil';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IEncodeProcessManageModel, { CreateProcessOption } from './IEncodeProcessManageModel';

interface ChildProcessInfo {
    child: ChildProcess;
    priority: number;
    processId: number;
}

@injectable()
class EncodeProcessManageModel implements IEncodeProcessManageModel {
    private log: ILogger;
    private maxEncode: number;
    private childs: ChildProcessInfo[] = [];
    private listener: events.EventEmitter = new events.EventEmitter();

    constructor(@inject('ILoggerModel') logeer: ILoggerModel, @inject('IConfiguration') configure: IConfiguration) {
        this.log = logeer.getLogger();
        this.maxEncode = configure.getConfig().encodeProcessNum;
    }

    /**
     * エンコードプロセスを生成する
     * プロセスが上限に達しているとき priority が高いプロセスが生成されようとすると、それより低いプロセスが殺される
     * @param option: CreateProcessOption
     * @return Promise<ChildProcess>
     */
    public create(option: CreateProcessOption): Promise<ChildProcess> {
        // replace %ROOT%
        option.cmd =
            process.platform === 'win32'
                ? option.cmd.replace('%ROOT%', EncodeProcessManageModel.ROOT_PATH.replace(/\\/g, '\\\\'))
                : option.cmd.replace('%ROOT%', EncodeProcessManageModel.ROOT_PATH);

        return new Promise<ChildProcess>(async (resolve, reject) => {
            if (this.childs.length >= this.maxEncode) {
                // プロセス数が上限に達しているとき
                // kill 可能な child を探す
                for (let i = 0; i < this.childs.length; i++) {
                    // priority が低いプロセスが見つかった
                    if (option.priority > this.childs[i].priority) {
                        // kill & create process
                        try {
                            const child = await this.killAndCreateProcess(this.childs[i].processId, option);
                            resolve(child);
                        } catch (err) {
                            reject(err);
                        }

                        return;
                    }
                }

                // 殺せるプロセスが無くプロセスの生成ができなかった
                reject(new Error('EncodeProcessManageModelCreateError'));
            } else {
                // create process
                try {
                    const child = this.buildProcess(option);
                    this.childs.unshift(child);
                    resolve(child.child);
                    this.log.system.info(`create new encode process: ${child.processId}`);
                } catch (err) {
                    this.log.system.error('create encode process failed');
                    this.log.system.error(err);
                    reject(err);
                }
            }
        });
    }

    /**
     * 指定された processId のプロセスを殺して、option で指定されたコマンドのプロセスを生成する
     * @param planToKillProcessId; number
     * @param option: CreateProcessOption
     * @return Promise<ChildProcess>
     */
    private killAndCreateProcess(planToKillProcessId: number, option: CreateProcessOption): Promise<ChildProcess> {
        return new Promise<ChildProcess>(async (resolve, reject) => {
            let timeoutId: NodeJS.Timer | null = null;

            /**
             * プロセスを生成
             *  プロセスが殺されたら呼ばされる
             */
            const createChild = (killedProcessId: number) => {
                // 殺されたプロセスが planToKillProcessId ではないのでスルー
                if (killedProcessId !== planToKillProcessId) {
                    return;
                }

                // リスナー登録解除
                this.removeListener(createChild);

                // プロセス生成 & 登録
                try {
                    const child = this.buildProcess(option);
                    this.childs.unshift(child);
                    resolve(child.child);
                    if (timeoutId !== null) {
                        clearInterval(timeoutId); // timeout クリア
                    }
                    this.log.system.info(`kill & create new encode process: ${child.processId}`);
                } catch (err) {
                    this.log.system.error('kill & create new encode process failed');
                    this.log.system.error(err);
                    reject(err);
                }
            };

            /**
             * timeout 設定
             * 時間内にプロセスが殺せなかったらエラー
             */
            timeoutId = setTimeout(() => {
                this.removeListener(createChild);
                this.log.system.error(`EncodeProcessManageModel timeout error: ${planToKillProcessId}`);
                reject(new Error('EncodeProcessManageModelTimeoutError'));
            }, 3 * 1000);

            // プロセスが死んだら呼び出されるようにリスナーに追加
            this.addListener(createChild);

            // kill
            try {
                await this.killChild(planToKillProcessId);
            } catch (err) {
                this.log.system.error(`kill process failed: ${planToKillProcessId}`);
                this.log.system.error(err);
                this.removeListener(createChild);
                reject(err);
            }
        });
    }

    /**
     * add listener
     * プロセスが死んだら呼ばれる
     * @param callback: (killedProcessId: number) => void
     */
    private addListener(callback: (killedProcessId: number) => void): void {
        this.listener.on(EncodeProcessManageModel.KILL_CHILD_EVENT, callback);
    }

    /**
     * remove listener
     * @param callback: (killedProcessId: number) => void
     */
    private removeListener(callback: (killedProcessId: number) => void): void {
        this.listener.removeListener(EncodeProcessManageModel.KILL_CHILD_EVENT, callback);
    }

    /**
     * 指定された processId のプロセスを殺して this.childs から削除する
     * @param processId: number
     * @param isRemoveOnly: boolean true の場合はプロセスを殺さない
     * @return Promise<void>
     */
    private async killChild(processId: number, isRemoveOnly: boolean = false): Promise<void> {
        let isError = true;

        for (let i = 0; i < this.childs.length; i++) {
            if (this.childs[i].processId === processId) {
                isError = false;
                try {
                    if (isRemoveOnly === false) {
                        this.log.system.info(`kill child: ${processId}`);
                        await ProcessUtil.kill(this.childs[i].child);
                    }
                } catch (err) {
                    this.log.system.error(err);
                }

                this.childs.splice(i, 1);
                break;
            }
        }

        if (isError && isRemoveOnly === false) {
            throw new Error('EncodeProcessManageModelKillChildError');
        }
    }

    /**
     * option で指定されたコマンドのプロセスを生成する
     * @param option: CreateProcessOption
     * @return ChildProcessInfo
     */
    private buildProcess(option: CreateProcessOption): ChildProcessInfo {
        let cmds: ProcessUtil.Cmds;
        try {
            cmds = ProcessUtil.parseCmdStr(option.cmd);
        } catch (err) {
            this.log.system.error(`build process error: ${option.cmd}`);
            throw err;
        }

        // input, output を置換
        for (let i = 0; i < cmds.args.length; i++) {
            if (option.input !== null) {
                cmds.args[i] = cmds.args[i].replace(/%INPUT%/g, option.input);
            }

            if (option.output !== null) {
                cmds.args[i] = cmds.args[i].replace(/%OUTPUT%/g, option.output);
            }
        }

        // プロセス生成
        const child =
            typeof option.spawnOption === 'undefined'
                ? spawn(cmds.bin, cmds.args)
                : spawn(cmds.bin, cmds.args, option.spawnOption);
        const processId = new Date().getTime();

        // エラー発生時にプロセスを停止して this.childs から削除する
        child.on('error', async () => {
            await this.killChild(processId, true).catch(err => {
                this.log.system.error(err);
            });
            this.eventsNotify(processId);
        });
        child.on('exit', async () => {
            await this.killChild(processId, true).catch(err => {
                this.log.system.error(err);
            });
            this.eventsNotify(processId);
        });

        // buffer が埋まらないようにする
        if (child.stdout !== null) {
            child.stdout.on('data', () => {});
        }
        if (child.stderr !== null) {
            child.stderr.on('data', () => {});
        }

        return {
            child: child,
            priority: option.priority,
            processId: processId,
        };
    }

    /**
     * エンコードプロセスの死亡を通知する
     * @param processId: number
     */
    private eventsNotify(processId: number): void {
        this.listener.emit(EncodeProcessManageModel.KILL_CHILD_EVENT, processId);
    }
}

namespace EncodeProcessManageModel {
    export const ROOT_PATH = path.join(__dirname, '..', '..', '..', '..');
    export const KILL_CHILD_EVENT = 'killChild';
}

export default EncodeProcessManageModel;
