import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as events from 'events';
import * as mkdirp from 'mkdirp'
import Base from '../Base';
import Mirakurun from 'mirakurun';
import * as apid from '../../../node_modules/mirakurun/api';
import { RecordedDBInterface } from '../Model/DB/RecordedDB';
import { EncodedDBInterface } from '../Model/DB/EncodedDB';
import { ServicesDBInterface } from '../Model/DB/ServicesDB';
import { ProgramsDBInterface } from '../Model/DB/ProgramsDB';
import * as DBSchema from '../Model/DB/DBSchema';
import CreateMirakurunClient from '../Util/CreateMirakurunClient';
import { ReserveProgram } from './ReserveProgramInterface';
import { EncodeInterface } from './RuleInterface';
import DateUtil from '../Util/DateUtil';
import Util from '../Util/Util';
import { ReservationManagerInterface } from './ReservationManager';

interface recordingProgram {
    reserve: ReserveProgram;
    stream?: http.IncomingMessage;
    recPath?: string;
}

interface RecordingManagerInterface {
    deleteAll(id: number): Promise<void>;
    deleteRule(id: number): Promise<void>;
    addThumbnail(id: number, thumbnailPath: string): Promise<void>;
    addEncodeFile(recordedId: number, name: string, filePath: string, delTs: boolean): Promise<number>;
    check(reserves: ReserveProgram[]): void;
    stop(id: number): void;
    stopRuleId(ruleId: number): void;
    cleanRecording(): void;
}

/**
* 録画を行う
* @throws RecordingManagerCreateInstanceError init が呼ばれていない場合
*/
class RecordingManager extends Base implements RecordingManagerInterface {
    private static instance: RecordingManager;
    private static inited: boolean = false;
    private listener: events.EventEmitter = new events.EventEmitter();
    private recording: recordingProgram[] = [];
    private mirakurun: Mirakurun;
    private recordedDB: RecordedDBInterface;
    private encodedDB: EncodedDBInterface;
    private servicesDB: ServicesDBInterface;
    private programsDB: ProgramsDBInterface;
    private reservationManager: ReservationManagerInterface;

    public static getInstance(): RecordingManager {
        if(!this.inited) {
            throw new Error('RecordingManagerCreateInstanceError');
        }

        return this.instance;
    }

    public static init(
        recordedDB: RecordedDBInterface,
        encodedDB: EncodedDBInterface,
        servicesDB: ServicesDBInterface,
        programsDB: ProgramsDBInterface,
        reservationManager: ReservationManagerInterface,
    ): void {
        if(this.inited) { return; }
        this.instance = new RecordingManager(recordedDB, encodedDB, servicesDB, programsDB, reservationManager);
        this.inited = true;
    }

    private constructor(
        recordedDB: RecordedDBInterface,
        encodedDB: EncodedDBInterface,
        servicesDB: ServicesDBInterface,
        programsDB: ProgramsDBInterface,
        reservationManager: ReservationManagerInterface,
    ) {
        super();

        this.recordedDB = recordedDB;
        this.encodedDB = encodedDB;
        this.servicesDB = servicesDB;
        this.programsDB = programsDB;
        this.reservationManager = reservationManager;
        this.mirakurun = CreateMirakurunClient.get();
    }

    /**
    * 録画開始時に実行されるイベントに追加
    * @param callback 録画開始時に実行される
    */
    public recStartListener(callback: (program: DBSchema.RecordedSchema) => void): void {
        this.listener.on(RecordingManager.RECORDING_START_EVENT, (program: DBSchema.RecordedSchema) => {
            callback(program);
        });
    }

    /**
    * 録画完了時に実行されるイベントに追加
    * @param callback 録画完了時に実行される
    */
    public recEndListener(callback: (program: DBSchema.RecordedSchema | null, encodeOption: EncodeInterface | null) => void): void {
        this.listener.on(RecordingManager.RECORDING_FIN_EVENT, (program: DBSchema.RecordedSchema | null, encodeOption: EncodeInterface | null) => {
            callback(program, encodeOption);
        });
    }

    /**
    * id で指定した録画を削除
    * @param id: recorded id
    * @throws RecordingManagerNotFoundRecordedProgram id で指定したプログラムが存在しない場合
    * @return Promise<void>
    */
    public async deleteAll(id: number): Promise<void> {
        this.log.system.info(`delete recorded file ${ id }`);

        // id で指定された recorded を取得
        let results = await this.recordedDB.findId(id);
        if(results.length == 0) {
            // id で指定された recorded がなかった
            throw new Error('RecordingManagerNotFoundRecordedProgram');
        }

        let recorded = results[0];
        //エンコードデータを取得
        let encoded = await this.encodedDB.findRecordedId(id)

        //エンコードデータを DB 上から削除
        await this.encodedDB.deleteRecordedId(id);
        //録画データを DB 上から削除
        await this.recordedDB.delete(id);

        if(Boolean(recorded.recording)) {
            //録画中なら録画停止
            this.stop(recorded.programId);
        }

        if(recorded.recPath !== null) {
            //録画実データを削除
            fs.unlink(String(recorded.recPath), (err) => {
            if(err) {
                    this.log.system.error(`delete recorded error: ${ id }`);
                    this.log.system.error(String(err));
                }
            });
        }

        //エンコード実データを削除
        encoded.forEach((file) => {
            fs.unlink(String(file.path), (err) => {
                if(err) {
                    this.log.system.error(`delete encode file error: ${ file.path }`);
                    this.log.system.error(String(err));
                }
            });
        });

        //サムネイルを削除
        if(recorded.thumbnailPath !== null) {
            fs.unlink(String(recorded.thumbnailPath), (err) => {
                if(err) {
                    this.log.system.error(`recorded failed to delete thumbnail ${ id }`);
                    this.log.system.error(String(err));
                }
            });
        }
    }

    /**
    * id で指定した ruleId をもつ recorded 内のプログラムの ruleId をすべて削除(nullにする)
    * rule が削除されたときに呼ぶ
    * @param id: rule id
    */
    public deleteRule(id: number): Promise<void> {
        this.log.system.info(`delete recorded program ruleId ${ id }`);
        return this.recordedDB.deleteRuleId(id);
    }

    /**
    * サムネイルのパスを追加する
    * @param id: recorded id
    * @param thumbnailPath: thumbnail file path
    * @return Promise<void>
    */
    public addThumbnail(id: number, thumbnailPath: string): Promise<void> {
        this.log.system.info(`add thumbnail: ${ id }`);
        return this.recordedDB.addThumbnail(id, thumbnailPath);
    }

    /**
    * エンコードしたファイルのパスを追加する
    * @param id: recorded id
    * @param filePath: encode file path
    * @return Promise<void>
    */
    public async addEncodeFile(recordedId: number, name: string, filePath: string, delTs: boolean): Promise<number> {
        this.log.system.info(`add encode file: ${ recordedId }`);

        // DB にエンコードファイルを追加
        let encoded = await this.encodedDB.insert(recordedId, name, filePath);
        //encoded id
        let encodedId = <number>(encoded.insertId);

        // ts 削除
        if(delTs) {
            let recorded = await this.recordedDB.findId(recordedId);

            //削除するデータがある場合
            if(recorded.length !== 0 && recorded[0].recPath !== null) {
                //削除
                fs.unlink(String(recorded[0].recPath), (err) => {
                    this.log.system.info(`delete ts file: ${ recordedId }`);
                    if(err) {
                        this.log.system.error(`delete ts file error: ${ recordedId }`);
                    }
                });

                // DB 上から recPath を削除
                await this.recordedDB.deleteRecPath(recordedId);
            }
        }

        return encodedId;
    }

    /**
    * 予約が録画時間かチェックする
    * @param reserves: 予約データ
    */
    public check(reserves: ReserveProgram[]): void {
        let now = new Date().getTime();
        reserves.forEach((reserve) => {
            // スキップ || コンフリクト || 時刻超過
            if(reserve.isSkip || now > reserve.program.endAt) { return; }

            if(reserve.program.startAt - now < RecordingManager.prepTime && !this.isRecording(reserve.program.id)) {
                //録画準備
                this.prepRecord(reserve);
            }
        });
    }

    /**
    * 録画停止
    * @param id: programId
    */
    public stop(id: number): void {
        const record = this.recording.find((record) => {
            return record.reserve.program.id === id;
        });

        if(record && record.stream) {
            record.stream.destroy();
            this.log.system.info(`stop recording: ${ record.reserve.program.id } ${ record.reserve.program.name }`);
        }
    }

    /**
    * ruleId を指定して録画を停止
    * @param ruleId: rule id
    */
    public stopRuleId(ruleId: number): void {
        this.log.system.info(`stop ruleId recording: ${ ruleId }`);
        const records = this.recording.filter((record) => {
            return record.reserve.ruleId === ruleId
        });

        for(let record of records) {
            this.stop(record.reserve.program.id);
        }
    }

    /**
    * 12 時間以上たった recording を削除
    */
    public cleanRecording(): void {
        this.log.system.info(`clean recording`);

        let now = new Date().getTime();
        this.recording = this.recording.filter((record) => {
            return now - record.reserve.program.endAt < (12 * 60 * 60 * 1000);
        });
    }

    /**
    * 録画中か判定する
    * @param programId: programId
    * @return true: 録画中, false: 録画中ではない
    */
    private isRecording(programId: apid.ProgramId): boolean {
        for(let i = 0; i < this.recording.length; i++) {
            if(this.recording[i].reserve.program.id === programId) {
                return true;
            }
        };

        return false;
    }

    /**
    * 録画中から削除
    * @param programId: programId
    */
    private removeRecording(programId: apid.ProgramId): void {
        for(let i = 0; i < this.recording.length; i++) {
            if(this.recording[i].reserve.program.id === programId) {
                this.recording.splice(i, 1);
                return;
            }
        };
    }

    /**
    * 録画準備
    * @param reserve: ReserveProgram
    */
    private async prepRecord(reserve: ReserveProgram, retry: number = 0): Promise<void> {
        this.log.system.info(`preprec: ${ reserve.program.id } ${ reserve.program.name }`);

        //録画優先度を設定
        this.mirakurun.priority = reserve.isConflict ? (this.config.getConfig().conflictPriority || 1) : (this.config.getConfig().recPriority || 2);

        let recData: recordingProgram | null = null;
        if(retry === 0) {
            // recording へ追加
            recData = { reserve: reserve };
            this.recording.push(recData);
        } else {
            // retry であるためデータを探す
            for(let i = 0; i < this.recording.length; i++) {
                if(this.recording[i].reserve.program.id === reserve.program.id) {
                    recData = this.recording[i];
                    break;
                }
            };
        }

        //番組ストリームを取得
        try {
            let stream = await this.mirakurun.getProgramStream(reserve.program.id, true);

            // 録画予約がストリーム準備中に削除されていないか確認
            if(this.reservationManager.getReserve(reserve.program.id) === null) {
                // 予約が削除されていた
                this.log.system.error(`program id: ${ reserve.program.id } is deleted`);
                //stream 停止
                stream.unpipe();
                stream.destroy();

                // recording から削除
                this.removeRecording(reserve.program.id);
            } else if(recData !== null) {
                this.doRecord(recData, stream);
            }
        } catch(err) {
            this.log.system.error(`preprec failed: ${ reserve.program.id } ${ reserve.program.name }`);
            this.log.system.error(err);

            //retry
            setTimeout(() => {
                if(retry <= 3) {
                    this.prepRecord(reserve, retry + 1);
                } else {
                    this.removeRecording(reserve.program.id);
                }
            }, 5000);
        }
    }

    /**
    * 録画処理
    * @param reserve: ReserveProgram
    * @param stream: http.IncomingMessage
    */
    private async doRecord(recData: recordingProgram, stream: http.IncomingMessage): Promise<void> {
        //保存先パス
        const recPath = await this.getRecPath(recData.reserve);
        recData.recPath = recPath;
        recData.stream = stream;

        this.log.system.info(`recording: ${ recData.reserve.program.id } ${ recData.reserve.program.name }`);

        //保存ストリーム
        const recFile = fs.createWriteStream(recPath, { flags: 'a' });
        this.log.system.info(`recording stream: ${ recPath }`);
        stream.pipe(recFile);

        //recorded に追加
        let recorded = {
            id: 0,
            programId: recData.reserve.program.id,
            channelId: recData.reserve.program.channelId,
            channelType: recData.reserve.program.channelType,
            startAt: recData.reserve.program.startAt,
            endAt: recData.reserve.program.endAt,
            duration: recData.reserve.program.duration,
            name: recData.reserve.program.name,
            description: recData.reserve.program.description,
            extended: recData.reserve.program.extended,
            genre1: recData.reserve.program.genre1,
            genre2: recData.reserve.program.genre2,
            videoType: recData.reserve.program.videoType,
            videoResolution: recData.reserve.program.videoResolution,
            videoStreamContent: recData.reserve.program.videoStreamContent,
            videoComponentType: recData.reserve.program.videoComponentType,
            audioSamplingRate: recData.reserve.program.audioSamplingRate,
            audioComponentType: recData.reserve.program.audioComponentType,
            recPath: recData.recPath!,
            ruleId: typeof recData.reserve.ruleId === 'undefined' ? null : recData.reserve.ruleId,
            thumbnailPath: null,
            recording: true,
        };

        try {
            recorded.id = <number>(( await this.recordedDB.insert(recorded) ).insertId);
            //録画終了時処理
            stream.once('end', () => { this.recEnd(recData, recFile, recorded); });

            //録画開始を通知
            this.startEventsNotify(recorded);
        } catch(err) {
            this.log.system.error(`recording add DB error: ${ recData.reserve.program.id } ${ recData.reserve.program.name }`);
            this.log.system.error(err);

            //録画を終了させる
            this.recEnd(recData, recFile, null);
        }
    }

    /**
    * 録画終了処理
    * @param recData
    * @param recFile: fs.WriteStream
    * @param recorded: DBSchema.RecordedSchema | null DB 上のデータ
    */
    private async recEnd(recData: recordingProgram, recFile: fs.WriteStream, recorded: DBSchema.RecordedSchema | null): Promise<void> {
        if(typeof recData.stream === 'undefined') { return; }

        //stream 停止
        recData.stream.unpipe();
        recData.stream.destroy();

        //stop recFile
        recFile.end();

        try {
            if(recorded === null) {
                // DB に録画データが書き込めなかったとき
                throw new Error(`recorded data is not found: ${ recData.reserve.program.id }`);
            }

            // recorded から削除されていないか確認
            let results =  await this.recordedDB.findId(recorded.id);
            if(results.length !== 0) {
                // recording 状態を解除
                await this.recordedDB.removeRecording(recorded.id)

                // 番組情報を最新に更新する
                const program = await this.programsDB.findId(recorded.programId);
                if(program.length > 0) {
                    await this.recordedDB.replace({
                        id: recorded.id,
                        programId: recorded.programId,
                        channelId: program[0].channelId,
                        channelType: program[0].channelType,
                        startAt: program[0].startAt,
                        endAt: program[0].endAt,
                        duration: program[0].duration,
                        name: program[0].name,
                        description: program[0].description,
                        extended: program[0].extended,
                        genre1: program[0].genre1,
                        genre2: program[0].genre2,
                        videoType: program[0].videoType,
                        videoResolution: program[0].videoResolution,
                        videoStreamContent: program[0].videoStreamContent,
                        videoComponentType: program[0].videoComponentType,
                        audioSamplingRate: program[0].audioSamplingRate,
                        audioComponentType: program[0].audioComponentType,
                        recPath: recData.recPath!,
                        ruleId: typeof recData.reserve.ruleId === 'undefined' ? null : recData.reserve.ruleId,
                        thumbnailPath: null,
                        recording: false,
                    });
                }

                //録画完了を通知
                let encodeOption = typeof recData.reserve.encodeOption === 'undefined' ? null : recData.reserve.encodeOption;
                this.finEventsNotify(recorded, encodeOption);

                this.log.system.info(`recording finish: ${ recData.reserve.program.id } ${ recData.reserve.program.name }`);
            } else {
                // recorded から削除されていた
                this.finEventsNotify(null, null);
                this.log.system.info(`recoding deleted: ${ recData.reserve.program.name }`);
            }
        } catch(err) {
            this.log.system.error(err);
        }

        //予約一覧から削除
        this.reservationManager.cancel(recData.reserve.program.id);
        this.reservationManager.clean();

        //録画中から削除
        this.removeRecording(recData.reserve.program.id);
    }

    /**
    * 録画先のパスを返す
    * @param reserve: ReserveProgram
    * @param conflict: number 名前がコンフリクトした場合、再帰でカウントされていく
    * @return Promise<string>: path
    */
    private async getRecPath(reserve: ReserveProgram, conflict: number = 0): Promise<string> {
        let config = this.config.getConfig();

        //ファイル名
        let fileName = '';
        // base file name
        if(typeof reserve.ruleOption !== 'undefined' && typeof reserve.ruleOption.recordedFormat !== 'undefined') {
            fileName = reserve.ruleOption.recordedFormat;
        } else {
            fileName = config.recordedFormat || '%YEAR%年%MONTH%月%DAY%日%HOUR%時%MIN%分%SEC%秒-%TITLE%';
        }

        let jaDate = DateUtil.getJaDate(new Date(reserve.program.startAt));

        // get channel name
        let channelName = String(reserve.program.channelId);
        try {
            let results = await this.servicesDB.findId(reserve.program.channelId)
            if(results.length !== 0) {
                channelName = results[0].name;
            }
        } catch(err) {
            this.log.system.error(err);
        }

        //replace filename
        fileName = fileName.replace(/%YEAR%/, DateUtil.format(jaDate, 'yyyy'))
            .replace(/%SHORTYEAR%/, DateUtil.format(jaDate, 'YY'))
            .replace(/%MONTH%/, DateUtil.format(jaDate, 'MM'))
            .replace(/%DAY%/, DateUtil.format(jaDate, 'dd'))
            .replace(/%HOUR%/, DateUtil.format(jaDate, 'hh'))
            .replace(/%MIN%/, DateUtil.format(jaDate, 'mm'))
            .replace(/%SEC%/, DateUtil.format(jaDate, 'ss'))
            .replace(/%DOW%/, DateUtil.format(jaDate, 'w'))
            .replace(/%TYPE%/, reserve.program.channelType)
            .replace(/%CHID%/, `${ reserve.program.channelId }`)
            .replace(/%CHNAME%/, channelName)
            .replace(/%CH%/, reserve.program.channel)
            .replace(/%SID%/, `${ reserve.program.serviceId }`)
            .replace(/%ID%/, `${ reserve.program.id }`)
            .replace(/%TITLE%/, reserve.program.name);

        // 使用禁止文字列
        fileName = fileName.replace(/\//g, '／');
        fileName = Util.replacePathName(fileName);

        if(conflict > 0) { fileName += `(${ conflict })`; }

        //拡張子
        fileName += config.fileExtension || '.ts';

        // ディレクトリ
        let recDir = Util.getRecordedPath();
        if(typeof reserve.ruleOption !== 'undefined' && typeof reserve.ruleOption.directory !== 'undefined') {
            recDir = path.join(recDir, Util.replacePathName(reserve.ruleOption.directory));
        }

        //ファイルパス
        let recPath = path.join(recDir, fileName);

        //ディレクトリが存在するか確認
        try {
            fs.statSync(recDir);
        } catch(e) {
            //ディレクトリが存在しなければ作成する
            this.log.system.info(`mkdirp: ${ recDir }`);
            mkdirp.sync(recDir);
        }

        //同名ファイルが存在するか確認
        try {
            fs.statSync(recPath);
            return await this.getRecPath(reserve, conflict + 1);
        } catch(e) {
            return recPath;
        }
    }

    /**
    * 録画完了を通知
    * @param program: DBSchema.RecordedSchema | null
    * @param encodeOption: EncodeInterface | null
    */
    private finEventsNotify(program: DBSchema.RecordedSchema | null, encodeOption: EncodeInterface | null): void {
        this.listener.emit(RecordingManager.RECORDING_FIN_EVENT, program, encodeOption);
    }

    /**
    * 録画開始を通知
    * @param program: DBSchema.RecordedSchema | null
    */
    private startEventsNotify(program: DBSchema.RecordedSchema): void {
        this.listener.emit(RecordingManager.RECORDING_START_EVENT, program);
    }
}

namespace RecordingManager {
    export const RECORDING_START_EVENT = 'recordingStart';
    export const RECORDING_FIN_EVENT = 'recordingFin';
    export const prepTime: number = 1000 * 15;
}

export { RecordingManagerInterface, RecordingManager };

