import * as events from 'events';
import * as fs from 'fs';
import * as http from 'http';
import Mirakurun from 'mirakurun';
import * as mkdirp from 'mkdirp';
import * as path from 'path';
import * as apid from '../../../../../node_modules/mirakurun/api';
import CreateMirakurunClient from '../../../Util/CreateMirakurunClient';
import DateUtil from '../../../Util/DateUtil';
import StrUtil from '../../../Util/StrUtil';
import Util from '../../../Util/Util';
import * as DBSchema from '../../DB/DBSchema';
import { ProgramsDBInterface } from '../../DB/ProgramsDB';
import { RecordedDBInterface } from '../../DB/RecordedDB';
import { RecordedHistoryDBInterface } from '../../DB/RecordedHistoryDB';
import { ServicesDBInterface } from '../../DB/ServicesDB';
import Model from '../../Model';
import { ReservationManageModelInterface } from '../Reservation/ReservationManageModel';
import { ReserveProgram, RuleReserveProgram } from '../ReserveProgramInterface';
import { EncodeInterface } from '../RuleInterface';

interface RecordingProgram {
    reserve: ReserveProgram;
    stream?: http.IncomingMessage;
    recPath?: string;
}

interface RecordingManageModelInterface extends Model {
    recPreStartListener(callback: (program: DBSchema.ProgramSchema) => void): void;
    preprecFailedListener(callback: (program: DBSchema.ProgramSchema) => void): void;
    recStartListener(callback: (program: DBSchema.RecordedSchema) => void): void;
    recEndListener(callback: (program: DBSchema.RecordedSchema | null, encodeOption: EncodeInterface | null) => void): void;
    recFailedListener(callback: (program: DBSchema.RecordedSchema) => void): void;
    check(reserves: ReserveProgram[]): void;
    stop(id: number): void;
    stopRuleId(ruleId: number): void;
    cleanRecording(): void;
    isRecording(programId: apid.ProgramId): boolean;
}

/**
 * 録画を行う
 * @throws RecordingManageModelCreateInstanceError init が呼ばれていない場合
 */
class RecordingManageModel extends Model implements RecordingManageModelInterface {
    private listener: events.EventEmitter = new events.EventEmitter();
    private recording: RecordingProgram[] = [];
    private mirakurun: Mirakurun;
    private recordedDB: RecordedDBInterface;
    private servicesDB: ServicesDBInterface;
    private programsDB: ProgramsDBInterface;
    private recordedHistoryDB: RecordedHistoryDBInterface;
    private reservationManage: ReservationManageModelInterface;

    constructor(
        recordedDB: RecordedDBInterface,
        servicesDB: ServicesDBInterface,
        programsDB: ProgramsDBInterface,
        recordedHistoryDB: RecordedHistoryDBInterface,
        reservationManage: ReservationManageModelInterface,
    ) {
        super();

        this.recordedDB = recordedDB;
        this.servicesDB = servicesDB;
        this.programsDB = programsDB;
        this.recordedHistoryDB = recordedHistoryDB;
        this.reservationManage = reservationManage;
        this.mirakurun = CreateMirakurunClient.get();
    }

    /**
     * 録画開始前の準備中に実行されるイベントに追加
     * @param callback 録画開始前の準備中に実行される
     */
    public recPreStartListener(callback: (program: DBSchema.ProgramSchema) => void): void {
        this.listener.on(RecordingManageModel.RECORDING_PRE_START_EVENT, (program: DBSchema.ProgramSchema) => {
            try {
                callback(program);
            } catch (err) {
                this.log.system.error(<any> err);
            }
        });
    }

    /**
     * 録画開始前の準備中にエラーが発生した場合に実行されるイベントに追加
     * @param callback 録画開始前の準備中にエラーが発生した場合実行される
     */
    public preprecFailedListener(callback: (program: DBSchema.ProgramSchema) => void): void {
        this.listener.on(RecordingManageModel.PREPREC_FAILED_EVENT, (program: DBSchema.ProgramSchema) => {
            try {
                callback(program);
            } catch (err) {
                this.log.system.error(<any> err);
            }
        });
    }

    /**
     * 録画開始時に実行されるイベントに追加
     * @param callback 録画開始時に実行される
     */
    public recStartListener(callback: (program: DBSchema.RecordedSchema) => void): void {
        this.listener.on(RecordingManageModel.RECORDING_START_EVENT, (program: DBSchema.RecordedSchema) => {
            try {
                callback(program);
            } catch (err) {
                this.log.system.error(<any> err);
            }
        });
    }

    /**
     * 録画完了時に実行されるイベントに追加
     * @param callback 録画完了時に実行される
     */
    public recEndListener(callback: (program: DBSchema.RecordedSchema | null, encodeOption: EncodeInterface | null) => void): void {
        this.listener.on(RecordingManageModel.RECORDING_FIN_EVENT, (program: DBSchema.RecordedSchema | null, encodeOption: EncodeInterface | null) => {
            try {
                callback(program, encodeOption);
            } catch (err) {
                this.log.system.error(<any> err);
            }
        });
    }

    /**
     * 録画中にエラーが発生した時に実行されるイベントに追加
     * @param callback 録画中にエラーが発生した時に実行される
     */
    public recFailedListener(callback: (program: DBSchema.RecordedSchema) => void): void {
        this.listener.on(RecordingManageModel.RECORDING_FAILED_EVENT, (program: DBSchema.RecordedSchema) => {
            try {
                callback(program);
            } catch (err) {
                this.log.system.error(<any> err);
            }
        });
    }

    /**
     * 予約が録画時間かチェックする
     * @param reserves: 予約データ
     */
    public check(reserves: ReserveProgram[]): void {
        const now = new Date().getTime();
        reserves.forEach((reserve) => {
            if (reserve.isSkip || (<RuleReserveProgram> reserve).isOverlap || now > reserve.program.endAt) { return; }

            if (reserve.program.startAt - now < RecordingManageModel.prepTime && !this.isRecording(reserve.program.id)) {
                // 録画準備
                this.prepRecord(reserve);
            }
        });
    }

    /**
     * 録画停止
     * @param id: programId
     */
    public stop(id: number): void {
        const record = this.recording.find((r) => {
            return r.reserve.program.id === id;
        });

        if (record && record.stream) {
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

            return (<RuleReserveProgram> record.reserve).ruleId === ruleId;
        });

        for (const record of records) {
            this.stop(record.reserve.program.id);
        }
    }

    /**
     * 12 時間以上たった recording を削除
     */
    public cleanRecording(): void {
        this.log.system.info('clean recording');

        const now = new Date().getTime();
        this.recording = this.recording.filter((record) => {
            return now - record.reserve.program.endAt < (12 * 60 * 60 * 1000);
        });
    }

    /**
     * 録画中か判定する
     * @param programId: programId
     * @return true: 録画中, false: 録画中ではない
     */
    public isRecording(programId: apid.ProgramId): boolean {
        for (let i = 0; i < this.recording.length; i++) {
            if (this.recording[i].reserve.program.id === programId) {
                return true;
            }
        }

        return false;
    }

    /**
     * 録画中から削除
     * @param programId: programId
     */
    private removeRecording(programId: apid.ProgramId): void {
        for (let i = 0; i < this.recording.length; i++) {
            if (this.recording[i].reserve.program.id === programId) {
                this.recording.splice(i, 1);

                return;
            }
        }
    }

    /**
     * 録画準備
     * @param reserve: ReserveProgram
     */
    private async prepRecord(reserve: ReserveProgram, retry: number = 0): Promise<void> {
        this.log.system.info(`preprec: ${ reserve.program.id } ${ reserve.program.name }`);

        // 録画優先度を設定
        this.mirakurun.priority = reserve.isConflict ? (this.config.getConfig().conflictPriority || 1) : (this.config.getConfig().recPriority || 2);

        let recData: RecordingProgram | null = null;
        if (retry === 0) {
            // recording へ追加
            recData = { reserve: reserve };
            this.recording.push(recData);

            // 録画準備中を通知
            this.preStartEventsNotify(reserve.program);
        } else {
            // retry であるためデータを探す
            for (let i = 0; i < this.recording.length; i++) {
                if (this.recording[i].reserve.program.id === reserve.program.id) {
                    recData = this.recording[i];
                    break;
                }
            }
        }

        // 番組ストリームを取得
        try {
            const stream = await this.mirakurun.getProgramStream(reserve.program.id, true);

            // 録画予約がストリーム準備中に削除されていないか確認
            if (this.reservationManage.getReserve(reserve.program.id) === null) {
                // 予約が削除されていた
                this.log.system.error(`program id: ${ reserve.program.id } is deleted`);
                // stream 停止
                stream.unpipe();
                stream.destroy();

                // recording から削除
                this.removeRecording(reserve.program.id);
            } else if (recData !== null) {
                await this.doRecord(recData, stream);
            }
        } catch (err) {
            this.log.system.error(`preprec failed: ${ reserve.program.id } ${ reserve.program.name }`);
            this.log.system.error(err);

            // retry
            setTimeout(() => {
                if (retry < 2) {
                    this.prepRecord(reserve, retry + 1);
                } else {
                    // rmove reserves
                    this.removeRecording(reserve.program.id);
                    this.reservationManage.cancel(reserve.program.id);
                    this.prepRecFailedEventsNotify(reserve.program);
                }
            }, 1000 * 5);
        }
    }

    /**
     * 録画処理
     * @param recData: RecordingProgram
     * @param stream: http.IncomingMessage
     */
    private async doRecord(recData: RecordingProgram, stream: http.IncomingMessage): Promise<void> {
        // 保存先パス
        const recPath = await this.getRecPath(recData.reserve);
        recData.recPath = recPath;
        recData.stream = stream;

        this.log.system.info(`recording: ${ recData.reserve.program.id } ${ recData.reserve.program.name }`);

        // ストリームを保存
        const recFile = fs.createWriteStream(recPath, { flags: 'a' });
        this.log.system.info(`recording stream: ${ recPath }`);
        stream.pipe(recFile);

        return new Promise<void>((resolve: () => void, reject: (error: Error) => void) => {
            // set timeout
            const recordingStartTimer = setTimeout(() => {
                this.log.system.error(`recording failed: ${ recData.reserve.program.id } ${ recData.reserve.program.name }`);

                // delete file
                fs.unlink(recPath, (err) => {
                    if (err) {
                        this.log.system.error(`delete error: ${ recData.reserve.program.id } ${ recData.reserve.program.name }`);
                        this.log.system.error(String(err));
                    }
                });

                // disconnect stream
                stream.unpipe();
                stream.destroy();

                reject(new Error('recordingStartError'));
            }, 1000 * 5);

            stream.once('data', async() => {
                clearTimeout(recordingStartTimer);

                this.log.system.info(`add recorded: ${ recData.reserve.program.id } ${ recData.reserve.program.name }`);

                // add DB
                const ruleId = (<RuleReserveProgram> recData.reserve).ruleId;
                const recorded = {
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
                    ruleId: typeof ruleId === 'undefined' ? null : ruleId,
                    thumbnailPath: null,
                    recording: true,
                    protection: false,
                    filesize: null,
                };

                try {
                    recorded.id = await this.recordedDB.insert(recorded);
                    // 録画終了時処理
                    stream.once('end', () => { this.recEnd(recData, recFile, recorded); });

                    // 録画開始を通知
                    this.startEventsNotify(recorded);
                } catch (err) {
                    this.log.system.error(`add recording error: ${ recData.reserve.program.id } ${ recData.reserve.program.name }`);
                    this.log.system.error(err);

                    // 録画を終了させる
                    await this.recEnd(recData, recFile, null);

                    // 録画途中でエラーが発生した事を通知
                    this.recordingFailedEventsNotify(recorded);
                }

                resolve();
            });
        });
    }

    /**
     * 録画終了処理
     * @param recData
     * @param recFile: fs.WriteStream
     * @param recorded: DBSchema.RecordedSchema | null DB 上のデータ
     */
    private async recEnd(recData: RecordingProgram, recFile: fs.WriteStream, recorded: DBSchema.RecordedSchema | null): Promise<void> {
        if (typeof recData.stream === 'undefined') { return; }

        // stream 停止
        recData.stream.unpipe();
        recData.stream.destroy();

        // stop recFile
        recFile.end();

        // RecordedHistory に保存する番組情報
        let historyProgram: DBSchema.RecordedHistorySchema | null = null;
        const ruleId = (<RuleReserveProgram> recData.reserve).ruleId || null;
        try {
            if (recorded === null) {
                // DB に録画データが書き込めなかったとき
                throw new Error(`recorded data is not found: ${ recData.reserve.program.id }`);
            }

            // recorded から削除されていないか確認
            if (await this.recordedDB.findId(recorded.id) !== null) {
                // recording 状態を解除
                await this.recordedDB.removeRecording(recorded.id);

                // 番組情報を最新に更新する
                const program = await this.programsDB.findId(recorded.programId);
                if (program !== null) {
                    recorded = {
                        id: recorded.id,
                        programId: recorded.programId,
                        channelId: program.channelId,
                        channelType: program.channelType,
                        startAt: program.startAt,
                        endAt: program.endAt,
                        duration: program.duration,
                        name: program.name,
                        description: program.description,
                        extended: program.extended,
                        genre1: program.genre1,
                        genre2: program.genre2,
                        videoType: program.videoType,
                        videoResolution: program.videoResolution,
                        videoStreamContent: program.videoStreamContent,
                        videoComponentType: program.videoComponentType,
                        audioSamplingRate: program.audioSamplingRate,
                        audioComponentType: program.audioComponentType,
                        recPath: recData.recPath!,
                        ruleId: ruleId,
                        thumbnailPath: null,
                        recording: false,
                        protection: false,
                        filesize: null,
                    };
                    await this.recordedDB.replace(recorded);

                    historyProgram = {
                        id: 0,
                        name: program.name,
                        endAt: program.endAt,
                    };
                } else {
                    historyProgram = {
                        id: 0,
                        name: recorded.name,
                        endAt: recorded.endAt,
                    };
                }

                // update filesize
                await this.recordedDB.updateFileSize(recorded.id);

                // 録画完了を通知
                const encodeOption = typeof recData.reserve.encodeOption === 'undefined' ? null : recData.reserve.encodeOption;
                this.finEventsNotify(recorded, encodeOption);

                this.log.system.info(`recording finish: ${ recData.reserve.program.id } ${ recData.reserve.program.name }`);

            } else {
                // recorded から削除されていた
                recorded = null;
                this.finEventsNotify(null, null);
                this.log.system.info(`recoding deleted: ${ recData.reserve.program.name }`);
            }
        } catch (err) {
            this.log.system.error(err);
        }

        // 予約一覧から削除
        let deleted = false;
        if (recorded === null || recorded.endAt <= new Date().getTime()) {
            this.reservationManage.cancel(recData.reserve.program.id);
            this.reservationManage.clean();
            deleted = true;
        }

        // 録画中から削除
        this.removeRecording(recData.reserve.program.id);

        if (deleted && historyProgram !== null && ruleId !== null) {
            // 番組名保存
            historyProgram.name = StrUtil.deleteBrackets(historyProgram.name);
            this.log.system.info(`save recorded history: ${ historyProgram.name }`);
            await this.recordedHistoryDB.insert(historyProgram);

            // overlap 更新
            await this.reservationManage.updateRule(ruleId)
            .catch(() => {});
        }
    }

    /**
     * 録画先のパスを返す
     * @param reserve: ReserveProgram
     * @param conflict: number 名前がコンフリクトした場合、再帰でカウントされていく
     * @return Promise<string>: path
     */
    private async getRecPath(reserve: ReserveProgram, conflict: number = 0): Promise<string> {
        const config = this.config.getConfig();

        const option = reserve.option;
        // ファイル名
        // base file name
        let fileName = typeof option !== 'undefined' && typeof option.recordedFormat !== 'undefined' ?
            option.recordedFormat : config.recordedFormat || '%YEAR%年%MONTH%月%DAY%日%HOUR%時%MIN%分%SEC%秒-%TITLE%';

        const jaDate = DateUtil.getJaDate(new Date(reserve.program.startAt));

        // get channel name
        let channelName = String(reserve.program.channelId);
        try {
            const channel = await this.servicesDB.findId(reserve.program.channelId);
            if (channel !== null) {
                channelName = channel.name;
            }
        } catch (err) {
            this.log.system.error(err);
        }

        // replace filename
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

        if (conflict > 0) { fileName += `(${ conflict })`; }

        // 拡張子
        fileName += config.fileExtension || '.ts';

        // ディレクトリ
        let recDir = Util.getRecordedPath();
        if (typeof option !== 'undefined' && typeof option.directory !== 'undefined') {
            recDir = path.join(recDir, Util.replacePathName(option.directory));
        }

        // ファイルパス
        const recPath = path.join(recDir, fileName);

        // ディレクトリが存在するか確認
        try {
            fs.statSync(recDir);
        } catch (e) {
            // ディレクトリが存在しなければ作成する
            this.log.system.info(`mkdirp: ${ recDir }`);
            mkdirp.sync(recDir);
        }

        // 同名ファイルが存在するか確認
        try {
            fs.statSync(recPath);

            return await this.getRecPath(reserve, conflict + 1);
        } catch (e) {
            return recPath;
        }
    }

    /**
     * 録画準備開始を通知
     * @param program: DBSchema.ProgramSchema
     */
    private preStartEventsNotify(program: DBSchema.ProgramSchema): void {
        this.listener.emit(RecordingManageModel.RECORDING_PRE_START_EVENT, program);
    }

    /**
     * 録画準備失敗の通知
     * @param program: DBSchema.ProgramSchema
     */
    private prepRecFailedEventsNotify(program: DBSchema.ProgramSchema): void {
        this.listener.emit(RecordingManageModel.PREPREC_FAILED_EVENT, program);
    }

    /**
     * 録画開始を通知
     * @param program: DBSchema.RecordedSchema | null
     */
    private startEventsNotify(program: DBSchema.RecordedSchema): void {
        this.listener.emit(RecordingManageModel.RECORDING_START_EVENT, program);
    }

    /**
     * 録画完了を通知
     * @param program: DBSchema.RecordedSchema | null
     * @param encodeOption: EncodeInterface | null
     */
    private finEventsNotify(program: DBSchema.RecordedSchema | null, encodeOption: EncodeInterface | null): void {
        this.listener.emit(RecordingManageModel.RECORDING_FIN_EVENT, program, encodeOption);
    }

    /**
     * 録画中にエラーが発生した事を通知
     * @param program: DBSchema.ProgramSchema
     */
    private recordingFailedEventsNotify(program: DBSchema.RecordedSchema): void {
        this.listener.emit(RecordingManageModel.RECORDING_FAILED_EVENT, program);
    }
}

namespace RecordingManageModel {
    export const RECORDING_PRE_START_EVENT = 'recordingPreStart';
    export const PREPREC_FAILED_EVENT = 'preprecFailed';
    export const RECORDING_START_EVENT = 'recordingStart';
    export const RECORDING_FIN_EVENT = 'recordingFin';
    export const RECORDING_FAILED_EVENT = 'recordingFailed';
    export const prepTime: number = 1000 * 15;
}

export { RecordingManageModelInterface, RecordingManageModel };

