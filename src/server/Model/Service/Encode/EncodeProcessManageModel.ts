import * as events from 'events';
import * as path from 'path';
import * as fs from 'fs';
import Model from '../../Model';
import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import ProcessUtil from '../../../Util/ProcessUtil';

interface EncodeProcessManageModelInterface extends Model {
    eventsNotify(createTime: number): void;
    create(input: string, output: string, cmd: string, priority: number, spawnOption?:SpawnOptions): Promise<ChildProcess>;
}

/**
* config のエンコードプロセス数の上限に沿ってプロセスの生成を行う
*/
class EncodeProcessManageModel extends Model implements EncodeProcessManageModelInterface {
    private maxEncode: number;
    private childs: { child: ChildProcess, priority: number, createTime: number }[] = [];
    private listener: events.EventEmitter = new events.EventEmitter();

    constructor() {
        super();
        let config = this.config.getConfig();

        this.maxEncode = config.maxEncode || 0;
    }

    /**
    * child process が死んだことを通知する
    */
    public eventsNotify(createTime: number): void {
        this.listener.emit(EncodeProcessManageModel.killChildEvent, createTime);
    }

    /**
    * エンコードプロセスを生成する
    * プロセスが上限に達しているとき priority が高いプロセスが生成されようとすると、それより低いプロセスが殺される
    * @param input: input file name
    * @param output: output file name
    * @param cmd: cmd string %INPUT% と %OUTPUT% を input と output で置換する
    * @param priority: number 大きいほど優先度が高くなる
    * @param spawnOption?:SpawnOptions
    * @return Promise<ChildProcess>
    */
    public create(input: string, output: string, cmd: string, priority: number, spawnOption?:SpawnOptions): Promise<ChildProcess> {
        // replace %ROOT%
        if(process.platform === 'win32') {
            cmd = cmd.replace('%ROOT%', path.join(__dirname, '..', '..', '..', '..', '..',).replace(/\\/g, '\\\\'));
        } else {
            cmd = cmd.replace('%ROOT%', path.join(__dirname, '..', '..', '..', '..', '..',));
        }

        return new Promise<ChildProcess>(async (resolve: (child: ChildProcess) => void, reject: (err: Error) => void) => {
            // プロセス数が上限に達しているとき
            if(this.childs.length >= this.maxEncode) {

                // kill 可能な child を探す
                let isFound = false;
                for(let i = 0; i < this.childs.length; i++) {
                    // priority が低いプロセスが見つかった
                    if(priority > this.childs[i].priority) {
                        // kill
                        await this.killChild(this.childs[i].createTime)

                        // 殺されるのを待つ
                        this.listener.once(EncodeProcessManageModel.killChildEvent, () => {
                            // プロセス生成 & 登録
                            let child = this.buildProcess(input, output, cmd, priority, spawnOption);
                            this.childs.unshift(child);
                            resolve(child.child);
                            this.log.system.info(`kill & create new encode child`);
                        });
                        isFound = true;
                    }
                }

                //殺せるプロセスが無くプロセスの生成ができなかった
                if(!isFound) {
                    reject(new Error('EncodeProcessManageModelCreateError'));
                }
            } else {
                // プロセス生成 & 登録
                let child = this.buildProcess(input, output, cmd, priority, spawnOption);
                this.childs.unshift(child);
                resolve(child.child);
                this.log.system.info(`create new encode child`);
            }
        });
    }

    /**
    * エンコードプロセスを生成する
    * @param input: input file name
    * @param output: output file name
    * @param cmd: cmd string %INPUT% と %OUTPUT% を input と output で置換する
    * @param priority: number
    * @param spawnOption?:SpawnOptions
    * @return ChildProcess
    * @throws EncodeProcessManageModelNotFoundBin cmd で指定したプロセスが存在しない場合
    */
    private buildProcess(input: string, output: string, cmd: string, priority: number, spawnOption?:SpawnOptions): {
        child: ChildProcess,
        priority: number,
        createTime: number
    } {
        let args = cmd.split(' ');
        let bin = args.shift();

        // input, output を置換
        for(let i = 0; i < args.length; i++) {
            args[i] = args[i].replace(/%INPUT%/g, input);
            args[i] = args[i].replace(/%OUTPUT%/g, output);
        }

        if(typeof bin === 'undefined') {
            throw new Error(EncodeProcessManageModel.NotFoundBinError);
        }

        // bin の存在確認
        try {
            fs.statSync(bin);
        } catch(e) {
            this.log.system.error(`${ bin } is not found`);
            throw new Error(EncodeProcessManageModel.NotFoundBinError);
        }

        let child = spawn(bin, args, spawnOption);
        let createTime = new Date().getTime();

        // this.childs から削除
        child.on('error', () => {
            this.killChild(createTime, true)
            .catch((err) => { this.log.system.error(err); });
            this.eventsNotify(createTime);
        });

        child.on('exit', () => {
            this.killChild(createTime, true)
            .catch((err) => { this.log.system.error(err); });
            this.eventsNotify(createTime);
        });

        return { child: child, priority: priority, createTime: createTime }
    }

    /**
    * 指定された createTime の child を殺して削除する
    * @param createTime: number
    * @param removeOnly: boolean childs から削除するのみ
    * @throws EncodeProcessManageModelKillChildError 該当する child がなかった場合
    */
    private async killChild(createTime: number, removeOnly: boolean = false): Promise<void> {
        let isError = true;

        for(let i = 0; i < this.childs.length; i++) {
            if(this.childs[i].createTime === createTime) {
                isError = false;
                try {
                    if(!removeOnly) {
                        this.log.system.info('kill child: ' + createTime)
                        await ProcessUtil.kill(this.childs[i].child);
                    }
                } catch(err) {
                    this.log.system.error(err);
                }

                this.childs.splice(i, 1);
                break;
            }
        }

        if(isError && !removeOnly) {
            throw new Error('EncodeProcessManageModelKillChildError');
        }
    }
}

namespace EncodeProcessManageModel {
    export const NotFoundBinError = 'EncodeProcessManageModelNotFoundBin';
    export const killChildEvent = 'killChild'
}

export { EncodeProcessManageModelInterface, EncodeProcessManageModel }

