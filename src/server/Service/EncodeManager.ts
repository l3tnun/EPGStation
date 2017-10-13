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
    filePath: string;
    mode: number;
    directory?: string;
    delTs: boolean;
    recordedProgram: DBSchema.RecordedSchema;
}

interface EncodingProgram {
    recordedId: number;
    mode: number;
}

interface EncodingInfo {
    encoding: EncodingProgram | null
    queue: EncodingProgram[];
}

interface EncodeManagerInterface {
    addListener(callback: (recordedId: number, name: string, filePath: string, delTs: boolean) => void): void;
    getEncodingId(): number | null;
    getEncodingInfo(): EncodingInfo;
    cancel(recordedId: number): void;
    push(program: EncodeProgram): void;
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
    private encodingData: { child: ChildProcess, program: EncodeProgram, filePath: string, timerId: NodeJS.Timer } | null = null;
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
    public addListener(callback: (recordedId: number, name: string, filePath: string, delTs: boolean) => void): void {
        this.listener.on(EncodeManager.ENCODE_FIN_EVENT, (recordedId: number, name: string, filePath: string, delTs: boolean) => {
            callback(recordedId, name, filePath, delTs);
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
            }
        }

        for(let program of this.queue) {
            result.queue.push({
                recordedId: program.recordedId,
                mode: program.mode,
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
            let filePath = this.encodingData.filePath;

            //kill
            this.encodingData. child.kill('SIGKILL');
            this.log.system.info(`stop encode: ${ recordedId }`);

            // 少し待ってから削除
            setTimeout(() => {
                fs.unlink(filePath, (err) => {
                    this.log.system.info(`delete encode file: ${ filePath }`);
                    if(err) {
                        this.log.system.error(`delete encode file error: ${ filePath }`);
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
    */
    public push(program: EncodeProgram): void {
        this.log.system.info(`push encode: ${ program.filePath } ${ program.mode }`);
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
            fs.statSync(program.filePath);
        } catch(e) {
            // ファイルが存在しない
            this.log.system.error(`encode file is not found: ${ program.filePath }`);
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

        this.log.system.info(`encode start: ${ program.filePath}`);
        let output = this.getFilePath(dir, program.filePath, encodeConfig[program.mode].suffix);
        let name = encodeConfig[program.mode].name;

        let option = {
            env: {
                INPUT: program.filePath,
                OUTPUT: output,
                VIDEOTYPE: program.recordedProgram.videoType || '',
                VIDEORESOLUTION: program.recordedProgram.videoResolution || '',
                VIDEOSTREAMCONTENT: program.recordedProgram.videoStreamContent || '',
                VIDEOCOMPONENTTYPE: program.recordedProgram.videoComponentType || '',
                AUDIOSAMPLINGRATE: program.recordedProgram.audioSamplingRate || '',
                AUDIOCOMPONENTTYPE: program.recordedProgram.audioComponentType || '',
                CHANNELID: program.recordedProgram.channelId,
            }
        }
        this.encodeProcessManager.create(program.filePath, output, encodeConfig[program.mode].cmd, EncodeManager.priority, option)
        .then((child) => {
            if(typeof program === 'undefined') { return; }

            const timeout = program.recordedProgram.duration * ( encodeConfig[program.mode].rate || 4 );
            this.encodingData = {
                child: child,
                program: program,
                filePath: output,
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
                        this.log.system.error(`encode failed: ${ program.filePath }`);
                    } else {
                        this.log.system.info(`fin encode: ${ program.filePath}`);

                        //通知
                        this.eventsNotify(program.recordedId, name, output, program.delTs);
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
        let fileName = path.basename(sourcePath);
        if(conflict > 0) { fileName += `(${ conflict })`; }
        fileName += suffix;
        let filePath = path.join(dir, fileName);

        //同名ファイルが存在するか確認
        try {
            fs.statSync(filePath);
            return this.getFilePath(dir, sourcePath, suffix, conflict + 1);
        } catch(e) {
            return filePath;
        }
    }

    /**
    * エンコード完了を通知
    * @param recordedId: recorded id
    * @param filePath: filePath
    */
    private eventsNotify(recordedId: number, name: string, filePath: string, delTs: boolean): void {
        this.listener.emit(EncodeManager.ENCODE_FIN_EVENT, recordedId, name, filePath, delTs);
    }
}

namespace EncodeManager {
    export const priority = 10;
    export const ENCODE_FIN_EVENT = 'encodeFin'
}

export { EncodeManagerInterface, EncodeProgram, EncodingInfo, EncodeManager };

