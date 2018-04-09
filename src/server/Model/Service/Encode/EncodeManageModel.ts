import { ChildProcess } from 'child_process';
import * as events from 'events';
import * as fs from 'fs';
import * as mkdirp from 'mkdirp';
import * as path from 'path';
import ProcessUtil from '../../../Util/ProcessUtil';
import Util from '../../../Util/Util';
import * as DBSchema from '../../DB/DBSchema';
import Model from '../../Model';
import { EncodeProcessManageModelInterface } from './EncodeProcessManageModel';

interface EncodeProgram {
    recordedId: number;
    source: string;
    mode?: number; // tsModify の場合存在しない
    directory?: string;
    delTs: boolean;
    recordedProgram: DBSchema.RecordedSchema;
}

interface EncodeQueue extends EncodeProgram {
    name: string;
    cmd: string;
    suffix: string | null;
    rate: number;
}

interface EncodingProgram {
    name: string;
    recordedId: number;
    mode?: number;
    source: string;
}

interface EncodingInfo {
    encoding: EncodingProgram | null;
    queue: EncodingProgram[];
}

interface EncodeConfigInfo {
    name: string;
    cmd: string;
    suffix: string | null;
    rate: number;
}

interface EncodeManageModelInterface extends Model {
    addEncodeDoneListener(callback: (recordedId: number, name: string, output: string | null, delTs: boolean, isTsModify: boolean) => void): void;
    addEncodeErrorListener(callback: () => void): void;
    getEncodingId(): number | null;
    getEncodingInfo(): EncodingInfo;
    cancel(recordedId: number): void;
    push(program: EncodeProgram, isCopy?: boolean): void;
}

/**
 * 録画済みファイルのエンコードを行う
 */
class EncodeManageModel extends Model implements EncodeManageModelInterface {
    private encodeProcessManage: EncodeProcessManageModelInterface;
    private queue: EncodeQueue[] = [];
    private isRunning: boolean = false;

    // エンコード中のプロセスとプログラムを格納する
    private encodingData: {
        child: ChildProcess;
        program: EncodeProgram;
        name: string;
        source: string;
        output: string | null;
        timerId: NodeJS.Timer;
        isStoped: boolean; // encode 停止時に ture にする
    } | null = null;

    private doneListener: events.EventEmitter = new events.EventEmitter();
    private errorListener: events.EventEmitter = new events.EventEmitter();

    constructor(encodeProcessManage: EncodeProcessManageModelInterface) {
        super();
        this.encodeProcessManage = encodeProcessManage;
    }

    /**
     * エンコード完了時に実行されるイベントに追加
     * @param callback ルール更新時に実行される
     */
    public addEncodeDoneListener(callback: (recordedId: number, name: string, output: string | null, delTs: boolean, isTsModify: boolean) => void): void {
        this.doneListener.on(EncodeManageModel.ENCODE_FIN_EVENT, (recordedId: number, name: string, output: string | null, delTs: boolean, isTsModify: boolean) => {
            callback(recordedId, name, output, delTs, isTsModify);
        });
    }

    /**
     * エンコード失敗時に実行されるイベントに追加
     * @param callback
     */
    public addEncodeErrorListener(callback: () => void): void {
        this.errorListener.on(EncodeManageModel.ENCODE_ERROR_EVENT, () => {
            callback();
        });
    }

    /**
     * エンコード中、待機中の情報を取得
     * @return
     */
    public getEncodingInfo(): EncodingInfo {
        const result: EncodingInfo = {
            encoding: null,
            queue: [],
        };

        if (this.encodingData !== null) {
            result.encoding = {
                name: this.encodingData.name,
                recordedId: this.encodingData.program.recordedId,
                source: this.encodingData.source,
            };
            if (typeof this.encodingData.program.mode !== 'undefined') {
                result.encoding.mode = this.encodingData.program.mode;
            }
        }

        for (const program of this.queue) {
            const info: EncodingProgram = {
                name: program.name,
                recordedId: program.recordedId,
                source: program.source,
            };
            if (typeof program.mode !== 'undefined') {
                info.mode = program.mode;
            }

            result.queue.push(info);
        }

        return result;
    }

    /**
     * エンコード中のプログラムの id を返す
     * @return recorded id or null
     */
    public getEncodingId(): number | null {
        return this.encodingData === null ? null : this.encodingData.program.recordedId;
    }

    /**
     * エンコードキャンセル
     * @param recordedId: recorded id
     */
    public async cancel(recordedId: number): Promise<void> {
        // queue から該当する id のプログラムを削除
        const newQueue = this.queue.filter((program) => {
            return !(program.recordedId === recordedId);
        });

        if (this.queue.length !== newQueue.length) {
            this.log.system.info(`remove encode: ${ recordedId }`);
        }

        this.queue = newQueue;

        // 現在エンコード中ならプロセスを kill
        if (this.encodingData !== null && this.encodingData.program.recordedId === recordedId) {
            this.log.system.info(`cancel encode: ${ recordedId }`);

            // kill
            this.encodingData.isStoped = true;
            await ProcessUtil.kill(this.encodingData.child);
        }
    }

    /**
     * キューにプログラムを積む
     * @param program: EncodeProgram
     * @param isCopy: true: delTs を受け継ぐ, false: 受け継がない
     */
    public push(program: EncodeProgram, isCopy: boolean = false): void {
        this.log.system.info(`push encode: ${ program.source } ${ typeof program.mode === 'undefined' ? EncodeManageModel.TSModifyName : program.mode }`);

        // ts 削除設定を同じ recordedId の program から受け継ぐ
        if (isCopy) {
            if (this.encodingData !== null && program.recordedId === this.encodingData.program.recordedId && this.encodingData.program.delTs) {
                this.encodingData.program.delTs = false;
                program.delTs = true;
            }
            for (let i = 0; i < this.queue.length; i++) {
                if (program.recordedId === this.queue[i].recordedId && this.queue[i].delTs) {
                    this.queue[i].delTs = false;
                    program.delTs = true;
                }
            }
        }

        let config: EncodeConfigInfo;
        try {
            config = this.getEncodeConfig(program.mode);
        } catch (err) {
            this.log.system.error(err.message);

            return;
        }

        (<EncodeQueue> program).name = config.name;
        (<EncodeQueue> program).cmd = config.cmd;
        (<EncodeQueue> program).suffix = config.suffix;
        (<EncodeQueue> program).rate = config.rate;
        this.queue.push(<EncodeQueue> program);
        this.encode();
    }

    /**
     * エンコード設定情報を取得
     * @return EncodeConfigInfo
     * @throws tsModifyIsNotFound
     * @throws encodeConfigIsNotFound
     */
    private getEncodeConfig(mode: number | undefined): EncodeConfigInfo {
        const config = this.config.getConfig();
        const encodeConfig = config.encode;
        const tsModify = config.tsModify;

        if (typeof mode === 'undefined') {
            if (typeof tsModify === 'undefined') {
                this.log.system.error('tsModify is not found');
                throw new Error('tsModifyIsNotFound');
            }

            return {
                name: EncodeManageModel.TSModifyName,
                cmd: tsModify.cmd,
                suffix: null,
                rate: tsModify.rate || 4.0,
            };
        }

        if (typeof encodeConfig === 'undefined' || typeof encodeConfig[mode] === 'undefined') {
            this.log.system.error(`encode config is not found: ${ mode }`);
            throw new Error('encodeConfigIsNotFound');
        }

        // 非エンコードの場合 null
        const suffix = encodeConfig[mode].suffix;

        return {
            name: encodeConfig[mode].name,
            cmd: encodeConfig[mode].cmd,
            suffix: typeof suffix === 'undefined' ? null : suffix,
            rate: encodeConfig[mode].rate || 4.0,
        };
    }

    /**
     * queue からプログラムを取り出してエンコードする
     */
    private async encode(): Promise<void> {
        // 実行中なら return
        if (this.isRunning) { return; }
        this.isRunning = true; // ロック

        // プログラムが空なら終了
        const program = this.queue.shift();
        if (typeof program === 'undefined') {
            this.isRunning = false;

            return;
        }

        // エンコードするファイルの存在確認
        try {
            fs.statSync(program.source);
        } catch (e) {
            // ファイルが存在しない
            this.log.system.error(`encode file is not found: ${ program.source }`);
            this.finalize();
            this.errorNotify();

            return;
        }

        // dir の存在確認
        const dir = path.join(Util.getRecordedPath(), Util.replacePathName(program.directory || ''));
        if (program.suffix !== null) {
            // program.suffix が null でない = output がある場合はディレクトリをチェック
            try {
                fs.statSync(dir);
            } catch (e) {
                // ディレクトリが存在しなければ作成
                this.log.system.info(`mkdirp: ${ dir }`);
                mkdirp.sync(dir);
            }
        }

        this.log.system.info(`encode start: ${ program.source } ${ program.name }`);
        const output = program.suffix === null ? null : this.getFilePath(dir, program.source, program.suffix);
        const child = await this.encodeProcessManage.create(program.source, output, program.cmd, EncodeManageModel.priority, {
            env: {
                RECORDEDID: program.recordedId,
                INPUT: program.source,
                OUTPUT: output === null ? '' : output,
                CURRENTDIR: program.directory || '',
                FFMPEG: Util.getFFmpegPath(),
                NAME: program.recordedProgram.name,
                DESCRIPTION: program.recordedProgram.description || '',
                EXTENDED: program.recordedProgram.extended || '',
                VIDEOTYPE: program.recordedProgram.videoType || '',
                VIDEORESOLUTION: program.recordedProgram.videoResolution || '',
                VIDEOSTREAMCONTENT: program.recordedProgram.videoStreamContent || '',
                VIDEOCOMPONENTTYPE: program.recordedProgram.videoComponentType || '',
                AUDIOSAMPLINGRATE: program.recordedProgram.audioSamplingRate || '',
                AUDIOCOMPONENTTYPE: program.recordedProgram.audioComponentType || '',
                CHANNELID: program.recordedProgram.channelId,
                GENRE1: program.recordedProgram.genre1,
                GENRE2: program.recordedProgram.genre2,
            },
        });

        this.encodingData = {
            child: child,
            program: program,
            name: program.name,
            source: program.source,
            output: output,
            timerId: setTimeout(() => {
                // 設定した時間が経過したらエンコードを強制停止
                this.log.system.error(`encoding process timed out: ${ output }`);
                if (this.encodingData !== null && this.encodingData.source === program.source && this.encodingData.output === output) {
                    this.encodingData.isStoped = true;
                }
                ProcessUtil.kill(child);
            }, program.recordedProgram.duration * program.rate),
            isStoped: false,
        };

        // debug 用
        child.stderr.on('data', (data) => { this.log.system.debug(String(data)); });

        child.on('exit', async(code, signal) => {
            // exit code
            this.log.system.info(`code { code : ${ code }, signal: ${ signal } }`);

            let isError = true;
            if (this.encodingData === null) {
                this.log.system.fatal('encoding data is null');
            } else if (this.encodingData.isStoped) {
                // encode 停止時 かつ出力ファイルあり
                if (output !== null) {
                    // output を削除
                    this.log.system.info(`delete encoding file: ${ output }`);
                    await Util.sleep(1000);

                    try {
                        await this.removeFile(output);
                    } catch (err) {
                        this.log.system.error(`delete encoding file error: ${ output }`);
                        this.log.system.error(err.message);
                    }
                }
            } else if (code !== 0) {
                // エンコードが正常に終了しなかった
                this.log.system.error(`encode failed: ${ output }`);

                // 出力ファイルあり
                if (output !== null) {
                    // output を削除
                    this.log.system.info(`delete encoding file: ${ output }`);
                    await Util.sleep(1000);

                    try {
                        await this.removeFile(output);
                    } catch (err) {
                        this.log.system.error(`delete encoding file error: ${ output }`);
                        this.log.system.error(err.message);
                    }
                }
            } else {
                this.log.system.info(`fin encode: ${ output }`);

                isError = false;
                this.doneNotify(program.recordedId, program.name, output, this.encodingData.program.delTs, program.name === EncodeManageModel.TSModifyName);
            }

            if (isError) { this.errorNotify(); }

            this.finalize();
        });

        child.on('error', (err) => {
            this.log.system.error('encode error');
            this.log.system.error(String(err));
            this.finalize();
            this.errorNotify();
        });
    }

    /**
     * remove file
     * @param file: file path
     * @return Promise<void>
     */
    private removeFile(file: string): Promise<void> {
        return new Promise<void>((resolve: () => void, reject: (error: Error) => void) => {
            fs.unlink(file, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * 実行ロックを解除して encode を呼び出す
     */
    private finalize(): void {
        // タイマー停止
        if (this.encodingData !== null) {
            clearTimeout(this.encodingData.timerId);
        }
        this.isRunning = false;
        this.encodingData = null;
        setImmediate(() => { this.encode(); }, 0);
    }

    /**
     * エンコードで出力されるファイル名を取得する
     * @param dir: dir
     * @param sourcePath: source file
     * @param suffix: suffix
     * @param conflict: number
     */
    private getFilePath(dir: string, sourcePath: string, suffix: string, conflict: number = 0): string {
        // ファイルパス生成
        let fileName = path.basename(sourcePath,  path.extname(sourcePath));
        if (conflict > 0) { fileName += `(${ conflict })`; }
        fileName += suffix;
        const source = path.join(dir, fileName);

        // 同名ファイルが存在するか確認
        try {
            fs.statSync(source);

            return this.getFilePath(dir, sourcePath, suffix, conflict + 1);
        } catch (e) {
            return source;
        }
    }

    /**
     * エンコード完了を通知
     * @param recordedId: recorded id
     * @param name: program name
     * @param output: output
     * @param delTs: ts を削除するか
     * @param isTsModify: ts modify か
     */
    private doneNotify(recordedId: number, name: string, output: string | null, delTs: boolean, isTsModify: boolean): void {
        this.doneListener.emit(EncodeManageModel.ENCODE_FIN_EVENT, recordedId, name, output, delTs, isTsModify);
    }

    /**
     * エンコード失敗を通知
     */
    private errorNotify(): void {
        this.errorListener.emit(EncodeManageModel.ENCODE_ERROR_EVENT);
    }
}

namespace EncodeManageModel {
    export const TSModifyName = 'tsModify';
    export const priority = 10;
    export const ENCODE_FIN_EVENT = 'encodeFin';
    export const ENCODE_ERROR_EVENT = 'encodeError';
}

export { EncodeManageModelInterface, EncodeProgram, EncodingInfo, EncodeManageModel };

