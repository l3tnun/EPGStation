import * as events from 'events';
import * as fs from 'fs';
import * as http from 'http';
import * as mkdirp from 'mkdirp';
import * as path from 'path';
import * as apid from '../../../../../node_modules/mirakurun/api';
import DateUtil from '../../../Util/DateUtil';
import FileUtil from '../../../Util/FileUtil';
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
import { RecordingStreamCreatorInterface } from './RecordingStreamCreator';
import { TSCheckerModelInterface } from './TSCheckerModel';

interface RecordingProgram {
    reserve: ReserveProgram;
    stream?: http.IncomingMessage;
    checker?: TSCheckerModelInterface;
    recPath?: string;
}

interface RecordingManageModelInterface extends Model {
    recPreStartListener(callback: (program: DBSchema.ProgramSchema) => void): void;
    preprecFailedListener(callback: (program: DBSchema.ProgramSchema) => void): void;
    recStartListener(callback: (program: DBSchema.RecordedSchema) => void): void;
    recEndListener(callback: (program: DBSchema.RecordedSchema | null, encodeOption: EncodeInterface | null) => void): void;
    recFailedListener(callback: (program: DBSchema.RecordedSchema) => void): void;
    check(reserves: ReserveProgram[]): void;
    stop(id: number, isDeletedLog?: boolean): void;
    stopRuleId(ruleId: number): void;
    cleanRecording(): void;
    isRecording(programId: apid.ProgramId): boolean;
    getRecordingPath(): string[];
}

namespace RecordingManageModelInterface {
    export const prepTime: number = 1000 * 15;
}

/**
 * 録画を行う
 * @throws RecordingManageModelCreateInstanceError init が呼ばれていない場合
 */
class RecordingManageModel extends Model implements RecordingManageModelInterface {
    private listener: events.EventEmitter = new events.EventEmitter();
    private recording: RecordingProgram[] = [];
    private recordedDB: RecordedDBInterface;
    private servicesDB: ServicesDBInterface;
    private programsDB: ProgramsDBInterface;
    private recordedHistoryDB: RecordedHistoryDBInterface;
    private reservationManage: ReservationManageModelInterface;
    private streamCreator: RecordingStreamCreatorInterface;
    private getTsChecker: () => TSCheckerModelInterface;

    constructor(
        recordedDB: RecordedDBInterface,
        servicesDB: ServicesDBInterface,
        programsDB: ProgramsDBInterface,
        recordedHistoryDB: RecordedHistoryDBInterface,
        reservationManage: ReservationManageModelInterface,
        streamCreator: RecordingStreamCreatorInterface,
        getTsChecker: () => TSCheckerModelInterface,
    ) {
        super();

        this.recordedDB = recordedDB;
        this.servicesDB = servicesDB;
        this.programsDB = programsDB;
        this.recordedHistoryDB = recordedHistoryDB;
        this.reservationManage = reservationManage;
        this.streamCreator = streamCreator;
        this.getTsChecker = getTsChecker;
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

            if (reserve.program.startAt - now <= RecordingManageModelInterface.prepTime && !this.isRecording(reserve.program.id)) {
                // 録画準備
                this.prepRecord(reserve);
            }
        });
    }

    /**
     * 録画停止
     * @param id: programId
     * @param isDeletedLog: boolean
     */
    public stop(id: number, isDeletedLog: boolean = false): void {
        this.streamCreator.deleteProgram(id); // prep rec で止まった場合残ってしまうため

        const record = this.recording.find((r) => {
            return r.reserve.program.id === id;
        });

        if (record && record.stream) {
            if (isDeletedLog && typeof record.checker !== 'undefined') {
                record.checker.setDeleted();
            }
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
     * 録画中のファイルパスを返す
     * @return string[]
     */
    public getRecordingPath(): string[] {
        const results: string[] = [];
        for (const program of this.recording) {
            if (typeof program.recPath !== 'undefined') {
                results.push(program.recPath);
            }
        }

        return results;
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
            const stream = await this.streamCreator.create(reserve);

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

            // retry
            setTimeout(() => {
                if (retry < 3) {
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
        const config = this.config.getConfig();

        // 保存先パス
        const recPath = await this.getRecPath(recData.reserve, true);
        recData.recPath = recPath;
        recData.stream = stream;

        this.log.system.info(`recording: ${ recData.reserve.program.id } ${ recData.reserve.program.name }`);

        // ストリームを保存
        const recFile = fs.createWriteStream(recPath, { flags: 'a' });
        this.log.system.info(`recording stream: ${ recPath }`);
        stream.pipe(recFile);

        // ts checker 追加
        let logFilePath: string | null = null;
        if (config.isEnabledDropCheck || false) {
            const tsChecker = this.getTsChecker();
            await tsChecker.set(
                typeof config.recordedTmp === 'undefined' ? recPath : await this.getRecPath(recData.reserve, false),
                stream,
            );
            logFilePath = tsChecker.getFilePath();
            recData.checker = tsChecker;
        }

        return new Promise<void>((resolve: () => void, reject: (error: Error) => void) => {
            // set timeout
            const recordingStartTimer = setTimeout(async() => {
                this.log.system.error(`recording failed: ${ recData.reserve.program.id } ${ recData.reserve.program.name }`);

                // disconnect stream
                stream.unpipe();
                stream.destroy();

                // delete file
                await FileUtil.promiseUnlink(recPath)
                .catch((err) => {
                    this.log.system.error(`delete error: ${ recData.reserve.program.id } ${ recData.reserve.program.name }`);
                    this.log.system.error(<any> err);
                });

                // delete log file
                if (logFilePath !== null) {
                    await FileUtil.promiseUnlink(logFilePath)
                    .catch((err) => {
                        this.log.system.error(`delete log file error: ${ recData.reserve.program.id } ${ recData.reserve.program.name }`);
                        this.log.system.error(<any> err);
                    });
                }

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
                    genre3: recData.reserve.program.genre3,
                    genre4: recData.reserve.program.genre4,
                    genre5: recData.reserve.program.genre5,
                    genre6: recData.reserve.program.genre6,
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
                    logPath: logFilePath,
                    errorCnt: null,
                    dropCnt: null,
                    scramblingCnt: null,
                    isTmp: typeof config.recordedTmp !== 'undefined',
                };

                try {
                    recorded.id = await this.recordedDB.insert(recorded);
                    // 録画終了時処理
                    stream.once('close', () => {
                        stream.emit('end'); // for node v14 node-aribts が stream 終了を検知できないため
                        this.recEnd(recData, recFile, recorded);
                    });

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
    private async recEnd(
        recData: RecordingProgram,
        recFile: fs.WriteStream,
        recorded: DBSchema.RecordedSchema | null,
    ): Promise<void> {
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

                if (recorded.programId > 0) {
                    // programId 予約の場合、番組情報を最新に更新する
                    const program = await this.programsDB.findId(recorded.programId);
                    if (program !== null) {
                        await this.recordedDB.updateProgramInfo(recorded.id, {
                            startAt: program.startAt,
                            endAt: program.endAt,
                            duration: program.duration,
                            name: program.name,
                            description: program.description,
                            extended: program.extended,
                            genre1: program.genre1,
                            genre2: program.genre2,
                            genre3: program.genre3,
                            genre4: program.genre4,
                            genre5: program.genre5,
                            genre6: program.genre6,
                            videoType: program.videoType,
                            videoResolution: program.videoResolution,
                            videoStreamContent: program.videoStreamContent,
                            videoComponentType: program.videoComponentType,
                            audioSamplingRate: program.audioSamplingRate,
                            audioComponentType: program.audioComponentType,
                        })
                        .catch(() => {
                            this.log.system.warn(`recorded program info update error: ${ recorded!.id }`);
                        });

                        recorded.startAt = program.startAt;
                        recorded.endAt = program.endAt;
                        recorded.duration = program.duration;
                        recorded.name = program.name;
                        recorded.description = program.description;
                        recorded.extended = program.extended;
                        recorded.genre1 = program.genre1;
                        recorded.genre2 = program.genre2;
                        recorded.genre3 = program.genre3;
                        recorded.genre4 = program.genre4;
                        recorded.genre5 = program.genre5;
                        recorded.genre6 = program.genre6;
                        recorded.videoType = program.videoType;
                        recorded.videoResolution = program.videoResolution;
                        recorded.videoStreamContent = program.videoStreamContent;
                        recorded.videoComponentType = program.videoComponentType;
                        recorded.audioSamplingRate = program.audioSamplingRate;
                        recorded.audioComponentType = program.audioComponentType;

                        historyProgram = {
                            id: 0,
                            name: program.name,
                            channelId: program.channelId,
                            endAt: program.endAt,
                        };
                    } else {
                        historyProgram = {
                            id: 0,
                            name: recorded.name,
                            channelId: recorded.channelId,
                            endAt: recorded.endAt,
                        };
                    }
                } else {
                    // 時間指定予約の場合 ビデオやオーディオ情報を更新する
                    const now = new Date().getTime();
                    const time = now <= recData.reserve.program.endAt
                        ? -1000
                        : -1000 + recData.reserve.program.endAt - now;
                    const programs = await this.programsDB.findBroadcastingChanel(recData.reserve.program.channelId, time);

                    if (programs.length !== 0) {
                        // 更新
                        const recordedId = recorded.id;
                        const program = programs[0];
                        await this.recordedDB.updateVideoInfo(recordedId, {
                            videoType: program.videoType,
                            videoResolution: program.videoResolution,
                            videoStreamContent: program.videoStreamContent,
                            videoComponentType: program.videoComponentType,
                            audioSamplingRate: program.audioSamplingRate,
                            audioComponentType: program.audioComponentType,
                        })
                        .catch((err) => {
                            this.log.system.error(`update video info error: ${ recordedId }`);
                            this.log.system.error(err);
                        });

                        recorded.videoType = program.videoType;
                        recorded.videoResolution = program.videoResolution;
                        recorded.videoStreamContent = program.videoStreamContent;
                        recorded.videoComponentType = program.videoComponentType;
                        recorded.audioSamplingRate = program.audioSamplingRate;
                        recorded.audioComponentType = program.audioComponentType;
                    }
                }

                // update filesize
                await this.recordedDB.updateFileSize(recorded.id);

                // drop 情報
                if (typeof recData.checker !== 'undefined') {
                    const result = await recData.checker.getResult();
                    let error = 0;
                    let drop = 0;
                    let scrambling = 0;

                    for (const pid in result) {
                        error += result[pid].error;
                        drop += result[pid].drop;
                        scrambling += result[pid].scrambling;
                    }

                    this.log.system.info(<any> {
                        programId: recData.reserve.program.id,
                        error: error,
                        drop: drop,
                        scrambling: scrambling,
                    });

                    // update cnt
                    await this.recordedDB.updateCnt(recorded.id, {
                        error: error,
                        drop: drop,
                        scrambling: scrambling,
                    });

                    recorded.errorCnt = error;
                    recorded.dropCnt = drop;
                    recorded.scramblingCnt = scrambling;
                }

                if (recorded.isTmp) {
                    // 一時領域から移動
                    const newFilePath = await this.getRecPath(recData.reserve, false);
                    const oldFilePath = recorded.recPath!;
                    recorded.recPath = newFilePath;
                    this.log.system.info(`move file: ${ oldFilePath } -> ${ newFilePath }`);

                    let doneMove = false;
                    try {
                        // 移動
                        await FileUtil.promiseRename(oldFilePath, newFilePath)
                        .catch(async() => {
                            await FileUtil.promiseMove(oldFilePath, newFilePath);
                        });
                        doneMove = true;
                    } catch (err) {
                        this.log.system.error(`move file error: ${ oldFilePath } -> ${ newFilePath }`);
                    }

                    if (doneMove) {
                        try {
                            // DB 更新
                            await this.recordedDB.updateTsFilePath(recorded.id, newFilePath, false);
                        } catch (err) {
                            this.log.system.error(`filePath update Error: { id: ${ recorded.id }, path: ${ newFilePath } }`);
                            this.log.system.error(err);
                        }
                    }
                }

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
        if (recorded === null || recorded.endAt <= new Date().getTime() + RecordingManageModelInterface.prepTime + 1000) {
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
     * @param enableTmp: boolean
     * @param conflict: number 名前がコンフリクトした場合、再帰でカウントされていく
     * @return Promise<string>: path
     */
    private async getRecPath(reserve: ReserveProgram, enableTmp: boolean, conflict: number = 0): Promise<string> {
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
        fileName = Util.replaceFileName(fileName);

        if (conflict > 0) { fileName += `(${ conflict })`; }

        // 拡張子
        fileName += config.fileExtension || '.ts';

        // ディレクトリ
        let recDir = !enableTmp || typeof config.recordedTmp === 'undefined' ? Util.getRecordedPath() : Util.getRecordedTmpPath()!;
        if (typeof option !== 'undefined' && typeof option.directory !== 'undefined') {
            recDir = path.join(recDir, Util.replaceDirName(option.directory));
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

            return await this.getRecPath(reserve, enableTmp, conflict + 1);
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
}

export { RecordingManageModelInterface, RecordingManageModel };

