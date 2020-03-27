import { ChildProcess } from 'child_process';
import * as events from 'events';
import * as fs from 'fs';
import * as mkdirp from 'mkdirp';
import * as path from 'path';
import ProcessUtil from '../../../Util/ProcessUtil';
import Util from '../../../Util/Util';
import * as DBSchema from '../../DB/DBSchema';
import { RecordedDBInterface } from '../../DB/RecordedDB';
import Model from '../../Model';
import { EncodeProcessManageModelInterface } from './EncodeProcessManageModel';

interface EncodeProgram {
    recordedId: number;
    encodedId?: number;
    source: string;
    mode?: number; // tsModify の場合存在しない
    directory?: string;
    delTs: boolean;
    recordedProgram: DBSchema.RecordedSchema;
}

interface EncodeQueue extends EncodeProgram {
    id: string;
    name: string;
    cmd: string;
    suffix: string | null;
    rate: number;
}

interface EncodingProgram {
    id: string;
    name: string;
    recordedId: number;
    encodedId?: number;
    mode?: number;
    source?: string;
    program: DBSchema.RecordedSchema;
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
    addEncodeDoneListener(callback: (recordedId: number, encodedId: number | null, name: string, output: string | null, delTs: boolean) => void): void;
    addEncodeErrorListener(callback: () => void): void;
    getEncodingId(): number | null;
    getEncodingInfo(needSource?: boolean): EncodingInfo;
    cancel(id: string): Promise<void>;
    cancels(ids: string[]): Promise<void>;
    cancelByRecordedId(recordedId: number): void;
    updateProgram(recordedId: number): Promise<void>;
    push(program: EncodeProgram, isManual?: boolean): void;
}

/**
 * 録画済みファイルのエンコードを行う
 */
class EncodeManageModel extends Model implements EncodeManageModelInterface {
    private encodeProcessManage: EncodeProcessManageModelInterface;
    private recordedDB: RecordedDBInterface;
    private queue: EncodeQueue[] = [];
    private isRunning: boolean = false;

    // エンコード中のプロセスとプログラムを格納する
    private encodingData: {
        child: ChildProcess;
        program: EncodeQueue;
        name: string;
        source: string;
        output: string | null;
        timerId: NodeJS.Timer;
        isStoped: boolean; // encode 停止時に ture にする
    } | null = null;

    private listener: events.EventEmitter = new events.EventEmitter();

    constructor(
        encodeProcessManage: EncodeProcessManageModelInterface,
        recordedDB: RecordedDBInterface,
    ) {
        super();
        this.encodeProcessManage = encodeProcessManage;
        this.recordedDB = recordedDB;
    }

    /**
     * エンコード完了時に実行されるイベントに追加
     * @param callback ルール更新時に実行される
     */
    public addEncodeDoneListener(callback: (recordedId: number, encodedId: number | null, name: string, output: string | null, delTs: boolean) => void): void {
        this.listener.on(EncodeManageModel.ENCODE_FIN_EVENT, (recordedId: number, encodedId: number | null, name: string, output: string | null, delTs: boolean) => {
            try {
                callback(recordedId, encodedId, name, output, delTs);
            } catch (err) {
                this.log.system.info(<any> err);
            }
        });
    }

    /**
     * エンコード失敗時に実行されるイベントに追加
     * @param callback
     */
    public addEncodeErrorListener(callback: () => void): void {
        this.listener.on(EncodeManageModel.ENCODE_ERROR_EVENT, () => {
            try {
                callback();
            } catch (err) {
                this.log.system.error(<any> err);
            }
        });
    }

    /**
     * エンコード中、待機中の情報を取得
     * @param needSource: boolean
     * @return
     */
    public getEncodingInfo(needSource: boolean = true): EncodingInfo {
        const result: EncodingInfo = {
            encoding: null,
            queue: [],
        };

        if (this.encodingData !== null) {
            result.encoding = {
                id: this.encodingData.program.id,
                name: this.encodingData.name,
                recordedId: this.encodingData.program.recordedId,
                program: this.encodingData.program.recordedProgram,
            };
            if (needSource) { result.encoding.source = this.encodingData.source; }
            if (typeof this.encodingData.program.encodedId !== 'undefined') {
                result.encoding.encodedId = this.encodingData.program.encodedId;
            }
            if (typeof this.encodingData.program.mode !== 'undefined') {
                result.encoding.mode = this.encodingData.program.mode;
            }
        }

        for (const program of this.queue) {
            const info: EncodingProgram = {
                id: program.id,
                name: program.name,
                recordedId: program.recordedId,
                program: program.recordedProgram,
            };
            if (needSource) { info.source = program.source; }
            if (typeof program.encodedId !== 'undefined') {
                info.encodedId = program.encodedId;
            }
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
     * @param id: string
     */
    public async cancel(id: string): Promise<void> {
        // エンコード中のプロセスが該当 id
        if (this.encodingData !== null && this.encodingData.program.id === id) {
            this.log.system.info(`cancel encode: ${ id }`);

            // kill
            this.encodingData.isStoped = true;
            await ProcessUtil.kill(this.encodingData.child);

            return;
        }

        // queue から該当 id の program を探索
        let recordedId: number | null = null;
        let position: number | null = null;
        for (let i = this.queue.length - 1; i >= 0; i--) {
            if (this.queue[i].id === id) {
                if (this.queue[i].delTs) {
                    // delTs を引き継ぐために recordedId を記録
                    recordedId = this.queue[i].recordedId;
                }

                // 削除位置を記憶
                position = i;
            } else if (recordedId !== null && recordedId === this.queue[i].recordedId) {
                // delTs 付け替え
                this.queue[i].delTs = true;
                recordedId = null;
                break;
            }
        }

        // 該当 id の program を queue から削除
        if (position !== null) {
            this.log.system.info(`remove encode: ${ id }`);
            this.queue.splice(position, 1);
        }

        // encode 中のプロセスに delTs を付け替える
        if (recordedId !== null && this.encodingData !== null && this.encodingData.program.recordedId === recordedId) {
            this.encodingData.program.delTs = true;
        }
    }

    /**
     * encode cancel
     * @param ids: string[]
     */
    public async cancels(ids: string[]): Promise<void> {
        if (this.encodingData === null) { return; }

        let isStopEncoding = false;

        for (const id of ids) {
            if (this.encodingData.program.id === id) {
                isStopEncoding = true;
            }

            await this.cancel(id);
        }

        if (isStopEncoding) {
            await this.cancel(this.encodingData.program.id);
        }
    }

    /**
     * エンコードキャンセル (recordedId)
     * @param recordedId: recorded id
     */
    public async cancelByRecordedId(recordedId: number): Promise<void> {
        // queue から該当する id のプログラムを削除
        const newQueue = this.queue.filter((program) => {
            return !(program.recordedId === recordedId);
        });

        if (this.queue.length !== newQueue.length) {
            this.log.system.info(`remove encode by recordedId: ${ recordedId }`);
        }

        this.queue = newQueue;

        // 現在エンコード中ならプロセスを kill
        if (this.encodingData !== null && this.encodingData.program.recordedId === recordedId) {
            this.log.system.info(`cancel encode by recordedId: ${ recordedId }`);

            // kill
            this.encodingData.isStoped = true;
            await ProcessUtil.kill(this.encodingData.child);
        }
    }

    /**
     * 番組情報更新
     * @param recordedId: number
     */
    public async updateProgram(recordedId: number): Promise<void> {
        if (this.encodingData === null) { return; }

        let hasProgram = false;
        let program: DBSchema.RecordedSchema | null = null;
        const getProgram = async() => {
            hasProgram = true;
            program = await this.recordedDB.findId(recordedId);
        };

        if (this.encodingData.program.recordedId === recordedId) {
            await getProgram();
            if (program !== null) {
                this.encodingData.program.recordedProgram = program;
            }
        }

        for (let i = 0; i < this.queue.length; i++) {
            if (this.queue[i].recordedId === recordedId) {
                if (!hasProgram) { await getProgram(); }
                if (program === null) { break; }

                this.queue[i].recordedProgram = program;
            }
        }
    }

    /**
     * キューにプログラムを積む
     * @param program: EncodeProgram
     * @param isManual: 手動エンコード追加か
     */
    public push(program: EncodeProgram, isManual: boolean = false): void {
        this.log.system.info(`push encode: ${ program.source } ${ typeof program.mode === 'undefined' ? EncodeManageModel.TSModifyName : program.mode }`);

        // 手動エンコード追加の場合はすでに存在する同じ recordedId のエンコードの delTs を付け替える
        // ただし encodedId が無い === ソースファイルが TS に限る
        if (isManual && typeof program.encodedId === 'undefined') {
            // 現在エンコード中か？
            if (this.encodingData !== null && program.recordedId === this.encodingData.program.recordedId && this.encodingData.program.delTs) {
                this.encodingData.program.delTs = false;
                program.delTs = true;
            }

            // エンコード待ち
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

        (<EncodeQueue> program).id = new Date().getTime().toString(16) + Math.floor(1000 * Math.random()).toString(16);
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
        const dir = typeof program.directory === 'undefined' ? Util.getRecordedPath() : path.join(Util.getRecordedPath(), Util.replaceDirName(program.directory));
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
        let child: ChildProcess;
        try {
            child = await this.encodeProcessManage.create(program.source, output, program.cmd, EncodeManageModel.priority, {
                env: {
                    PATH: process.env['PATH'],
                    RECORDEDID: program.recordedId,
                    INPUT: program.source,
                    OUTPUT: output === null ? '' : output,
                    DIR: program.directory || '',
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
                    GENRE3: program.recordedProgram.genre3,
                    GENRE4: program.recordedProgram.genre4,
                    GENRE5: program.recordedProgram.genre5,
                    GENRE6: program.recordedProgram.genre6,
                    logPath: program.recordedProgram.logPath,
                    errorCnt: program.recordedProgram.errorCnt,
                    dropCnt: program.recordedProgram.dropCnt,
                    scramblingCnt: program.recordedProgram.scramblingCnt,
                },
            } as any);
        } catch (err) {
            this.log.system.error('encode process create error');
            this.finalize();
            this.errorNotify();

            return;
        }

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
        if (child.stderr !== null) {
            child.stderr.on('data', (data) => { this.log.system.debug(String(data)); });
        }

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
                this.log.system.info(`fin encode: ${ output === null ? program.source : output }`);

                isError = false;
                const encodedId = typeof program.encodedId === 'undefined' ? null : program.encodedId;
                this.doneNotify(program.recordedId, encodedId, program.name, output, this.encodingData.program.delTs);
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
     * @param encodedId: encoded id | null
     * @param name: program name
     * @param output: output
     * @param delTs: ts を削除するか
     */
    private doneNotify(recordedId: number, encodedId: number | null, name: string, output: string | null, delTs: boolean): void {
        this.listener.emit(EncodeManageModel.ENCODE_FIN_EVENT, recordedId, encodedId, name, output, delTs);
    }

    /**
     * エンコード失敗を通知
     */
    private errorNotify(): void {
        this.listener.emit(EncodeManageModel.ENCODE_ERROR_EVENT);
    }
}

namespace EncodeManageModel {
    export const TSModifyName = 'tsModify';
    export const priority = 10;
    export const ENCODE_FIN_EVENT = 'encodeFin';
    export const ENCODE_ERROR_EVENT = 'encodeError';
}

export { EncodeManageModelInterface, EncodeProgram, EncodingInfo, EncodingProgram, EncodeManageModel };

