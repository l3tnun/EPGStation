import * as path from 'path';
import * as fs from 'fs';
import * as events from 'events';
import { ChildProcess } from 'child_process';
import * as mkdirp from 'mkdirp';
import Base from '../Base';
import { EncodeProcessManagerInterface } from './EncodeProcessManager';
import * as DBSchema from '../Model/DB/DBSchema';
import Util from '../Util/Util';

interface EncodeProgram {
    recordedId: number;
    source: string;
    mode: number;
    directory?: string;
    delTs: boolean;
    recordedProgram: DBSchema.RecordedSchema;
}

interface EncodingProgram {
    recordedId: number;
    mode: number;
    source: string;
}

interface EncodingInfo {
    encoding: EncodingProgram | null
    queue: EncodingProgram[];
}

interface EncodeManagerInterface {
    addListener(callback: (recordedId: number, name: string, output: string, delTs: boolean) => void): void;
    getEncodingId(): number | null;
    getEncodingInfo(): EncodingInfo;
    cancel(recordedId: number): void;
    push(program: EncodeProgram, isCopy?: boolean): void;
}

/**
* 録画済みファイルのエンコードを行う
* @throws EncodeManagerCreateInstanceError init が呼ばれなかった場合
*/
class EncodeManager extends Base implements EncodeManagerInterface {
    private static instance: EncodeManager;
    private static inited: boolean = false;
    private encodeProcessManager: EncodeProcessManagerInterface;
    private queue: EncodeProgram[] = [];
    private isRunning: boolean = false;
    //エンコード中のプロセスとプログラムを格納する
    private encodingData: { child: ChildProcess, program: EncodeProgram, source: string, output: string, timerId: NodeJS.Timer } | null = null;
    private listener: events.EventEmitter = new events.EventEmitter();

    public static getInstance(): EncodeManager {
        if(!this.inited) {
            throw new Error('EncodeManagerCreateInstanceError');
        }

        return this.instance;
    }

   public static init(encodeProcessManager: EncodeProcessManagerInterface) {
        if(this.inited) { return; }
        this.instance = new EncodeManager(encodeProcessManager);
        this.inited = true;
    }

    private constructor(encodeProcessManager: EncodeProcessManagerInterface) {
        super();
        this.encodeProcessManager = encodeProcessManager;
    }

    /**
    * エンコード完了時に実行されるイベントに追加
    @param callback ルール更新時に実行される
    */
    public addListener(callback: (recordedId: number, name: string, output: string, delTs: boolean) => void): void {
        this.listener.on(EncodeManager.ENCODE_FIN_EVENT, (recordedId: number, name: string, output: string, delTs: boolean) => {
            callback(recordedId, name, output, delTs);
        });
    }

    /**
    * エンコード中、待機中の情報を取得
    * @return
    */
    public getEncodingInfo(): EncodingInfo {
        let result: EncodingInfo = {
            encoding: null,
            queue: [],
        }

        if(this.encodingData !== null) {
            result.encoding = {
                recordedId: this.encodingData.program.recordedId,
                mode: this.encodingData.program.mode,
                source: this.encodingData.source,
            }
        }

        for(let program of this.queue) {
            result.queue.push({
                recordedId: program.recordedId,
                mode: program.mode,
                source: program.source,
            });
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
    public cancel(recordedId: number): void {
        this.log.system.info(`cancel encode: ${ recordedId }`);

        // queue から該当する id のプログラムを削除
        this.queue = this.queue.filter((program) => {
            return !(program.recordedId === recordedId);
        });

        // 現在エンコード中ならプロセスを kill
        if(this.encodingData !== null && this.encodingData.program.recordedId === recordedId) {
            // kill する前にファイルパスを記憶
            let output = this.encodingData.output;

            //kill
            this.encodingData. child.kill('SIGKILL');
            this.log.system.info(`stop encode: ${ recordedId }`);

            // 少し待ってから削除
            setTimeout(() => {
                fs.unlink(output, (err) => {
                    this.log.system.info(`delete encode file: ${ output }`);
                    if(err) {
                        this.log.system.error(`delete encode file error: ${ output }`);
                        this.log.system.error(String(err));
                    }
                    this.finalize();
                });
            }, 1000);
        }
    }

    /**
    * キューにプログラムを積む
    * @param program: EncodeProgram
    * @param isCopy: true: delTs を受け継ぐ, false: 受け継がない
    */
    public push(program: EncodeProgram, isCopy: boolean = false): void {
        this.log.system.info(`push encode: ${ program.source } ${ program.mode }`);

        // ts 削除設定を同じ recordedId の program から受け継ぐ
        if(isCopy) {
            if(this.encodingData !== null && program.recordedId === this.encodingData.program.recordedId && this.encodingData.program.delTs) {
                this.encodingData.program.delTs = false;
                program.delTs = true;
            }
            for(let i = 0; i < this.queue.length; i++) {
                if(program.recordedId === this.queue[i].recordedId && this.queue[i].delTs) {
                    this.queue[i].delTs = false;
                    program.delTs = true;
                }
            }
        }

        this.queue.push(program);
        this.encode();
    }

    /**
    * queue からプログラムを取り出してエンコードする
    */
    private encode(): void {
        //実行中なら return
        if(this.isRunning) { return; }
        this.isRunning = true; //ロック

        //プログラムが空なら終了
        let program = this.queue.shift();
        if(typeof program === 'undefined') { this.isRunning = false; return; }

        // config のエンコード設定をチェック
        let config = this.config.getConfig();
        let encodeConfig = config.encode;
        if(typeof encodeConfig === 'undefined' || typeof encodeConfig[program.mode] === 'undefined') {
            this.log.system.error(`encode config is not found: ${ program.mode }`);
            this.finalize();
            return;
        }

        // エンコードするファイルの存在確認
        try {
            fs.statSync(program.source);
        } catch(e) {
            // ファイルが存在しない
            this.log.system.error(`encode file is not found: ${ program.source }`);
            this.finalize();
            return;
        }

        let dir = path.join(Util.getRecordedPath(), Util.replacePathName(program.directory || ''));

        // dir の存在確認
        try {
            fs.statSync(dir);
        } catch(e) {
            // ディレクトリが存在しなければ作成
            this.log.system.info(`mkdirp: ${ dir }`);
            mkdirp.sync(dir);
        }

        this.log.system.info(`encode start: ${ program.source }`);
        let output = this.getFilePath(dir, program.source, encodeConfig[program.mode].suffix);
        let name = encodeConfig[program.mode].name;

        let option = {
            env: {
                INPUT: program.source,
                OUTPUT: output,
                FFMPEG: Util.getFFmpegPath(),
                VIDEOTYPE: program.recordedProgram.videoType || '',
                VIDEORESOLUTION: program.recordedProgram.videoResolution || '',
                VIDEOSTREAMCONTENT: program.recordedProgram.videoStreamContent || '',
                VIDEOCOMPONENTTYPE: program.recordedProgram.videoComponentType || '',
                AUDIOSAMPLINGRATE: program.recordedProgram.audioSamplingRate || '',
                AUDIOCOMPONENTTYPE: program.recordedProgram.audioComponentType || '',
                CHANNELID: program.recordedProgram.channelId,
            }
        }
        this.encodeProcessManager.create(program.source, output, encodeConfig[program.mode].cmd, EncodeManager.priority, option)
        .then((child) => {
            if(typeof program === 'undefined') { return; }

            const timeout = program.recordedProgram.duration * ( encodeConfig[program.mode].rate || 4 );
            this.encodingData = {
                child: child,
                program: program,
                source: program.source,
                output: output,
                timerId: setTimeout(() => { child.kill('SIGKILL'); }, timeout),
            };

            // debug 用
            child.stderr.on('data', (data) => { this.log.system.debug(String(data)); });

            child.on('exit', (code) => {
                if(typeof program === 'undefined') {
                    fs.unlink(output, (err) => {
                        this.log.system.error(`delete encode file, program is no found: ${ output }`);
                        if(err) {
                            this.log.system.error(`delete encode file failed: ${ output }`);
                            this.log.system.error(String(err));
                        }
                    });
                } else {
                    if(code !== 0) {
                        this.log.system.error(`encode failed: ${ output }`);
                    } else {
                        this.log.system.info(`fin encode: ${ output }`);

                        //通知
                        this.eventsNotify(program.recordedId, name, output, this.encodingData!.program.delTs);
                    }
                }

                this.finalize();
            });

            child.on('error', (err) => {
                this.log.system.error(`encode error`);
                this.log.system.error(String(err));
                this.finalize();
            });
        })
        .catch((err) => {
            this.log.system.error(`encode error`);
            this.log.system.error(String(err));
            this.finalize();
        });
    }

    /**
    * 実行ロックを解除して encode を呼び出す
    */
    private finalize(): void {
        // タイマー停止
        if(this.encodingData !== null) {
            clearTimeout(this.encodingData.timerId);
        }
        this.isRunning = false;
        this.encodingData = null;
        setTimeout(() => { this.encode(); }, 0);
    }

    /**
    * エンコードで出力されるファイル名を取得する
    * @param dir: dir
    * @param sourcePath: source file
    * @param suffix: suffix
    * @param conflict: number
    */
    private getFilePath(dir: string, sourcePath: string, suffix: string, conflict: number = 0): string {
        //ファイルパス生成
        let fileName = path.basename(sourcePath,  path.extname(sourcePath));
        if(conflict > 0) { fileName += `(${ conflict })`; }
        fileName += suffix;
        let source = path.join(dir, fileName);

        //同名ファイルが存在するか確認
        try {
            fs.statSync(source);
            return this.getFilePath(dir, sourcePath, suffix, conflict + 1);
        } catch(e) {
            return source;
        }
    }

    /**
    * エンコード完了を通知
    * @param recordedId: recorded id
    * @param output: output
    */
    private eventsNotify(recordedId: number, name: string, output: string, delTs: boolean): void {
        this.listener.emit(EncodeManager.ENCODE_FIN_EVENT, recordedId, name, output, delTs);
    }
}

namespace EncodeManager {
    export const priority = 10;
    export const ENCODE_FIN_EVENT = 'encodeFin'
}

export { EncodeManagerInterface, EncodeProgram, EncodingInfo, EncodeManager };

