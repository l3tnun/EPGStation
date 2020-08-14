import * as events from 'events';
import * as fs from 'fs';
import * as http from 'http';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import DropLogFile from '../../../db/entities/DropLogFile';
import Recorded from '../../../db/entities/Recorded';
import RecordedHistory from '../../../db/entities/RecordedHistory';
import Reserve from '../../../db/entities/Reserve';
import VideoFile from '../../../db/entities/VideoFile';
import DateUtil from '../../../util/DateUtil';
import FileUtil from '../../../util/FileUtil';
import StrUtil from '../../../util/StrUtil';
import IChannelDB from '../../db/IChannelDB';
import IDropLogFileDB from '../../db/IDropLogFileDB';
import IProgramDB from '../../db/IProgramDB';
import IRecordedDB from '../../db/IRecordedDB';
import IRecordedHistoryDB from '../../db/IRecordedHistoryDB';
import IReserveDB from '../../db/IReserveDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IRecordingEvent from '../../event/IRecordingEvent';
import IConfigFile, { RecordedDirInfo } from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IDropCheckerModel from './IDropCheckerModel';
import IRecorderModel from './IRecorderModel';
import IRecordingStreamCreator from './IRecordingStreamCreator';

interface RecFilePathInfo {
    parendDir: RecordedDirInfo; // 親ディレクトリ情報
    subDir: string; // サブディレクトリ
    fileName: string; // ファイル名 (拡張子付き)
    fullPath: string;
}

/**
 * Recorder
 */
@injectable()
class RecorderModel implements IRecorderModel {
    private log: ILogger;
    private config: IConfigFile;
    private channelDB: IChannelDB;
    private programDB: IProgramDB;
    private reserveDB: IReserveDB;
    private recordedDB: IRecordedDB;
    private recordedHistoryDB: IRecordedHistoryDB;
    private videoFileDB: IVideoFileDB;
    private dropLogFileDB: IDropLogFileDB;
    private streamCreator: IRecordingStreamCreator;
    private dropChecker: IDropCheckerModel;
    private recordingEvent: IRecordingEvent;

    private reserve!: Reserve;
    private recordedId: apid.RecordedId | null = null;
    private videoFileId: apid.VideoFileId | null = null;
    private videoFileFulPath: string | null = null;
    private timerId: NodeJS.Timeout | null = null;
    private stream: http.IncomingMessage | null = null;
    private isStopPrepRec: boolean = false;
    private isStopRec: boolean = false;
    private isPrepRecording: boolean = false;
    private isRecording: boolean = false;
    private isPlanToDelete: boolean = false;
    private eventEmitter = new events.EventEmitter();

    private dropLogFileId: apid.DropLogFileId | null = null;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IProgramDB') programDB: IProgramDB,
        @inject('IReserveDB') reserveDB: IReserveDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IRecordedHistoryDB') recordedHistoryDB: IRecordedHistoryDB,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IDropLogFileDB') dropLogFileDB: IDropLogFileDB,
        @inject('IRecordingStreamCreator')
        streamCreator: IRecordingStreamCreator,
        @inject('IDropCheckerModel') dropChecker: IDropCheckerModel,
        @inject('IRecordingEvent') recordingEvent: IRecordingEvent,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.channelDB = channelDB;
        this.programDB = programDB;
        this.reserveDB = reserveDB;
        this.recordedDB = recordedDB;
        this.recordedHistoryDB = recordedHistoryDB;
        this.videoFileDB = videoFileDB;
        this.dropLogFileDB = dropLogFileDB;
        this.streamCreator = streamCreator;
        this.dropChecker = dropChecker;
        this.recordingEvent = recordingEvent;
    }

    /**
     * タイマーをセットする
     * @param reserve: Reserve 予約情報
     * @return boolean セットに成功したら true を返す
     */
    public setTimer(reserve: Reserve): boolean {
        this.reserve = reserve;

        const now = new Date().getTime();
        if (now >= this.reserve.endAt) {
            return false;
        }

        // 待機時間を計算
        let time = this.reserve.startAt - now - IRecordingStreamCreator.PREP_TIME;
        if (time < 0) {
            time = 0;
        }

        // タイマーをセット
        if (this.timerId !== null) {
            clearTimeout(this.timerId);
        }

        this.log.system.info(`set timer: ${this.reserve.id}, ${time}`);
        this.timerId = setTimeout(async () => {
            try {
                this.prepRecord();
            } catch (err) {
                this.log.system.error(`failed prep record: ${this.reserve.id}`);
            }
        }, time);

        return true;
    }

    /**
     * 録画準備
     */
    private async prepRecord(retry: number = 0): Promise<void> {
        if (this.isStopPrepRec === true) {
            this.isStopPrepRec = false;
            this.isPrepRecording = false;
            this.isRecording = false;
            this.isPlanToDelete = false;

            return;
        }

        this.log.system.info(`preprec: ${this.reserve.id}`);

        this.isPrepRecording = true;
        this.isRecording = false;
        this.isPlanToDelete = false;

        if (retry === 0) {
            // 録画準備開始通知
            this.recordingEvent.emitStartPrepRecording(this.reserve);
        }

        // 番組ストリームを取得する
        try {
            this.stream = await this.streamCreator.create(this.reserve);

            // 録画準備のキャンセル or ストリーム取得中に予約が削除されていないかチェック
            if ((await this.reserveDB.findId(this.reserve.id)) === null) {
                this.log.system.error(`canceled preprec: ${this.reserve.id}`);
                this.destoryStream();
                this.emitCancelEvent();
            } else {
                await this.doRecord();
            }
        } catch (err) {
            this.log.system.error(`preprec failed: ${this.reserve.id}`);
            // @ts-ignore
            if (this.isStopPrepRec === true) {
                this.emitCancelEvent();

                return;
            } else if (retry < 3) {
                // retry
                setTimeout(() => {
                    this.prepRecord(retry + 1);
                }, 1000 * 5);
            } else {
                this.isPrepRecording = false;
                // 録画準備失敗を通知
                this.recordingEvent.emitPrepRecordingFailed(this.reserve);
            }
        }
    }

    /**
     * 録画準備キャンセル完了時に発行するイベント
     */
    private emitCancelEvent(): void {
        this.isStopPrepRec = false;
        this.isPrepRecording = false;
        this.isRecording = false;

        // 録画準備失敗を通知
        this.recordingEvent.emitCancelPrepRecording(this.reserve);

        this.eventEmitter.emit(RecorderModel.CANCEL_EVENT);
    }

    /**
     * strem 破棄
     * @param needesUnpip: boolean
     */
    private destoryStream(needesUnpip: boolean = true): void {
        if (this.stream === null) {
            return;
        }

        try {
            if (needesUnpip === true) {
                this.stream.unpipe();
            }
            this.stream.destroy();
            this.stream.push(null); // eof 通知
            this.stream.removeAllListeners('data');
            this.stream = null;
        } catch (err) {
            this.log.system.error(`destory stream error: ${this.reserve.id}`);
        }
    }

    /**
     * 録画処理
     */
    private async doRecord(): Promise<void> {
        if (this.stream === null) {
            return;
        }

        // 録画キャンセル
        if (this.isStopPrepRec === true) {
            this.log.system.error(`cancel recording: ${this.reserve.id}`);
            this.destoryStream();
            this.emitCancelEvent();

            return;
        }

        this.isPrepRecording = false;
        this.isRecording = true;

        // 録画開始内部イベント発行
        // 時刻指定予約で録画準備中に endAt を変えようとした場合にこのイベントを受信してから変える
        this.eventEmitter.emit(RecorderModel.START_RECORDING_EVENT);

        // 保存先を取得
        const recPath = await this.getRecPath(this.reserve, true);

        this.log.system.info(`recording: ${this.reserve.id} ${recPath.fullPath}`);

        // save stream
        const recFile = fs.createWriteStream(recPath.fullPath, { flags: 'a' });
        this.stream.pipe(recFile);

        // delete file callback
        const deleteRecFile = async () => {
            await FileUtil.unlink(recPath.fullPath).catch(err => {
                this.log.system.error(`delete error: ${this.reserve.id} ${recPath.fullPath}`);
                this.log.system.error(err);
            });
        };

        // drop checker
        if (this.config.isEnabledDropCheck === true) {
            let dropFilePath: string | null = null;
            try {
                await this.dropChecker.start(this.config.dropLog, recPath.fullPath, this.stream);
                dropFilePath = this.dropChecker.getFilePath();
            } catch (err) {
                this.log.system.error(`drop check error: ${recPath.fullPath}`);
                this.log.system.error(err);
                dropFilePath = null;
            }

            // drop 情報を DB へ反映
            if (dropFilePath !== null) {
                const dropLogFile = new DropLogFile();
                dropLogFile.errorCnt = 0;
                dropLogFile.dropCnt = 0;
                dropLogFile.scramblingCnt = 0;
                dropLogFile.filePath = path.basename(dropFilePath);
                this.log.system.info(`add drop log file: ${dropFilePath}`);
                try {
                    this.dropLogFileId = await this.dropLogFileDB.insertOnce(dropLogFile);
                } catch (err) {
                    this.dropLogFileId = null;
                    this.log.system.error(`add drop log file error: ${dropFilePath}`);
                    this.log.system.error(err);
                }
            }
        }

        return new Promise<void>((resolve: () => void, reject: (error: Error) => void) => {
            if (this.stream === null) {
                reject(new Error('StreamIsNull'));

                return;
            }

            // stream からデータが来るまでの時間でタイムアウトを設定
            const recordingTimeoutId = setTimeout(async () => {
                this.log.system.error(`recording failed: ${this.reserve.id}`);

                if (this.stream !== null) {
                    this.destoryStream();

                    // delete file
                    await deleteRecFile();
                }

                reject(new Error('recordingStartError'));
            }, 1000 * 5);

            // ストリームからデータが降ってきたときの設定
            this.stream.once('data', async () => {
                clearTimeout(recordingTimeoutId);

                this.log.system.info(`add recorded: ${this.reserve.id} ${recPath.fullPath}`);
                let recorded: Recorded;
                try {
                    recorded = await this.createRecorded();
                    this.recordedId = await this.recordedDB.insertOnce(recorded);
                    recorded.id = this.recordedId;

                    // add video file
                    const videoFile = new VideoFile();
                    videoFile.parentDirectoryName = recPath.parendDir.name;
                    videoFile.filePath = path.join(recPath.subDir, recPath.fileName);
                    videoFile.type = 'ts';
                    videoFile.name = 'TS';
                    videoFile.recordedId = this.recordedId;
                    this.log.system.info(`add video file: ${videoFile.filePath}`);
                    this.videoFileId = await this.videoFileDB.insertOnce(videoFile);
                    this.videoFileFulPath = recPath.fullPath;
                } catch (err) {
                    // DB 登録エラー
                    this.log.system.error('add recorded DB error');
                    this.log.system.error(err);
                    this.destoryStream();

                    reject(new Error('AddRecordedDBError'));

                    await deleteRecFile();

                    return;
                }

                // 録画終了処理
                if (this.stream !== null) {
                    this.stream.once('end', async () => {
                        await this.recEnd(recFile)
                            .catch(err => {
                                this.log.system.error(`failed recording end: ${this.reserve.id}`);
                                this.log.system.error(err);
                            })
                            .catch(err => {
                                // 録画終了処理失敗
                                this.destoryStream();
                                this.log.system.error('recording end error');
                                this.log.system.error(err);

                                // 録画終了処理失敗を通知
                                this.recordingEvent.emitRecordingFailed(this.reserve);
                            });
                    });
                }

                // 録画開始を通知
                this.recordingEvent.emitStartRecording(this.reserve, recorded);

                resolve();
            });
        }).catch(err => {
            // 予想外の録画失敗エラー
            this.destoryStream();
            // 録画失敗を通知
            this.recordingEvent.emitRecordingFailed(this.reserve);
            throw err;
        });
    }

    /**
     * this.reserve から Recorded を生成する
     * @return Promise<Recorded>
     */
    private async createRecorded(): Promise<Recorded> {
        const recorded = new Recorded();
        if (this.recordedId !== null) {
            recorded.id = this.recordedId;
        }
        recorded.isRecording = this.isRecording;
        recorded.reserveId = this.reserve.id;
        recorded.ruleId = this.reserve.ruleId;
        recorded.programId = this.reserve.programId;
        recorded.channelId = this.reserve.channelId;
        recorded.startAt = this.reserve.startAt;
        recorded.endAt = this.reserve.endAt;
        recorded.duration = this.reserve.endAt - this.reserve.startAt;

        if (this.reserve.isTimeSpecified === true) {
            // 時刻指定予約なので channelId と startAt を元に番組情報を取得する
            const program = await this.programDB.findChannelIdAndTime(this.reserve.channelId, this.reserve.startAt);
            if (program === null) {
                // 番組情報が取れなかった場合
                this.log.system.warn(
                    `get program info warn channelId: ${this.reserve.channelId}, startAt: ${this.reserve.startAt}`,
                );
                recorded.name = '';
                recorded.halfWidthName = '';
            } else {
                recorded.name = program.name;
                recorded.halfWidthName = program.halfWidthName;
                recorded.description = program.description;
                recorded.halfWidthDescription = program.halfWidthDescription;
                recorded.extended = program.extended;
                recorded.halfWidthExtended = program.halfWidthExtended;
                recorded.genre1 = program.genre1;
                recorded.subGenre1 = program.subGenre1;
                recorded.genre2 = program.genre2;
                recorded.subGenre2 = program.subGenre2;
                recorded.genre3 = program.genre3;
                recorded.subGenre3 = program.subGenre3;
                recorded.videoType = program.videoType;
                recorded.videoResolution = program.videoResolution;
                recorded.videoStreamContent = program.videoStreamContent;
                recorded.videoComponentType = program.videoComponentType;
                recorded.audioSamplingRate = program.audioSamplingRate;
                recorded.audioComponentType = program.audioComponentType;
            }
        } else if (this.reserve.name !== null && this.reserve.halfWidthName !== null) {
            recorded.name = this.reserve.name;
            recorded.halfWidthName = this.reserve.halfWidthName;
            recorded.description = this.reserve.description;
            recorded.halfWidthDescription = this.reserve.halfWidthDescription;
            recorded.extended = this.reserve.extended;
            recorded.halfWidthExtended = this.reserve.halfWidthExtended;
            recorded.genre1 = this.reserve.genre1;
            recorded.subGenre1 = this.reserve.subGenre1;
            recorded.genre2 = this.reserve.genre2;
            recorded.subGenre2 = this.reserve.subGenre2;
            recorded.genre3 = this.reserve.genre3;
            recorded.subGenre3 = this.reserve.subGenre3;
            recorded.videoType = this.reserve.videoType;
            recorded.videoResolution = this.reserve.videoResolution;
            recorded.videoStreamContent = this.reserve.videoStreamContent;
            recorded.videoComponentType = this.reserve.videoComponentType;
            recorded.audioSamplingRate = this.reserve.audioSamplingRate;
            recorded.audioComponentType = this.reserve.audioComponentType;
        } else {
            // 時刻指定予約ではないのに、name が null
            throw new Error('CreateRecordedError');
        }

        if (this.dropLogFileId !== null) {
            recorded.dropLogFileId = this.dropLogFileId;
        }

        return recorded;
    }

    /**
     * 録画終了処理
     * @param recFile: fs.WriteStream
     */
    private async recEnd(recFile: fs.WriteStream): Promise<void> {
        if (this.stream === null) {
            return;
        }

        // stream 停止
        this.destoryStream();

        // stop save file
        recFile.end();

        // 削除予定か?
        if (this.isPlanToDelete === true) {
            this.log.system.info(`plan to delete: ${this.reserve.id}`);

            if (this.dropLogFileId !== null) {
                await this.dropChecker.stop().catch(err => {
                    this.log.system.error(`stop drop checker error: ${this.dropLogFileId}`);
                    this.log.system.error(err);
                });
            }

            return;
        }

        if (this.recordedId !== null) {
            // remove recording flag
            await this.recordedDB.removeRecording(this.recordedId);
            this.isRecording = false;

            // tmp に録画していた場合は移動する
            await this.movingFromTmp().catch(err => {
                this.log.system.fatal(`movingFromTmp error: ${this.recordedId}`);
                this.log.system.fatal(err);
            });

            // update video file size
            if (this.videoFileId !== null && this.videoFileFulPath !== null) {
                this.log.system.info(`update file size: ${this.videoFileId}`);
                try {
                    const fileSize = await FileUtil.getFileSize(this.videoFileFulPath);
                    await this.videoFileDB.updateSize(this.videoFileId, fileSize);
                } catch (err) {
                    this.log.system.error(`update file size error: ${this.videoFileId}`);
                    this.log.system.error(err);
                }
            }

            // drop 情報更新
            await this.updateDropFileLog().catch(err => {
                this.log.system.fatal(`updateDropFileLog error: ${this.dropLogFileId}`);
                this.log.stream.fatal(err);
            });

            // recorded 情報取得
            const recorded = await this.recordedDB.findId(this.recordedId);

            // Recorded history 追加
            if (this.reserve.isTimeSpecified === false && this.reserve.ruleId !== null && this.isStopRec === false) {
                // ルール(Program Id 予約)の場合のみ記録する
                try {
                    if (recorded !== null) {
                        const history = new RecordedHistory();
                        history.name = StrUtil.deleteBrackets(recorded.halfWidthName);
                        history.channelId = recorded.channelId;
                        history.endAt = recorded.endAt;
                        await this.recordedHistoryDB.insertOnce(history);
                    }
                } catch (err) {
                    this.log.system.error(`Add Recorded History Error: ${this.recordedId}`);
                    this.log.system.error(err);
                }
            }

            // 録画完了の通知
            if (recorded !== null) {
                this.recordingEvent.emitFinishRecording(this.reserve, recorded, this.isStopRec);
            }
        }

        this.log.system.info(`recording finish: ${this.reserve.id} ${this.videoFileFulPath}`);
    }

    /**
     * recordedTmp にされている録画を本来の保存場所へ移動する
     * recordedTmp の指定が無い場合は何もしない
     * @return Promise<void>
     */
    private async movingFromTmp(): Promise<void> {
        if (
            typeof this.config.recordedTmp === 'undefined' ||
            this.videoFileId === null ||
            this.videoFileFulPath === null
        ) {
            return;
        }

        // 本来の保存先を取得
        const newRecPath = await this.getRecPath(this.reserve, false);

        // recordedTmp から本来の保存先へコピー
        try {
            this.log.system.info(`move file: ${this.videoFileFulPath} -> ${newRecPath.fullPath}`);
            await FileUtil.copyFile(this.videoFileFulPath, newRecPath.fullPath);
        } catch (err) {
            this.log.system.error(`move file error: ${this.videoFileFulPath} -> ${newRecPath.fullPath}`);

            return;
        }

        // VideoFile DB 更新
        try {
            await this.videoFileDB.updateFilePath({
                videoFileId: this.videoFileId,
                parentDirectoryName: newRecPath.parendDir.name,
                filePath: path.join(newRecPath.subDir, newRecPath.fileName),
            });
        } catch (err) {
            this.log.system.error(`update VideoFileDB path error: ${this.recordedId}`);
            this.log.system.error(err);

            await FileUtil.unlink(newRecPath.fullPath).catch(err => {
                this.log.system.error(`delete new file error: ${newRecPath.fullPath}`);
                this.log.system.error(err);
            });

            return;
        }

        const oldVideoFilePath = this.videoFileFulPath;
        this.videoFileFulPath = newRecPath.fullPath;

        // recordedTmp にある古いファイルを削除する
        await FileUtil.unlink(oldVideoFilePath).catch(err => {
            this.log.system.error(`delete old file error: ${newRecPath.fullPath}`);
            this.log.system.error(err);
        });
    }

    /**
     * drop log file 情報を更新する
     * @return Promise<void>
     */
    private async updateDropFileLog(): Promise<void> {
        if (this.dropLogFileId === null) {
            return;
        }

        // ドロップ情報カウント
        let error = 0;
        let drop = 0;
        let scrambling = 0;
        try {
            const dropResult = await this.dropChecker.getResult();
            for (const pid in dropResult) {
                error += dropResult[pid].error;
                drop += dropResult[pid].drop;
                scrambling += dropResult[pid].scrambling;
            }
        } catch (err) {
            this.log.system.error(`get drop result error: ${this.dropLogFileId}`);
            this.log.system.error(err);
            await this.dropChecker.stop();

            return;
        }

        // ドロップ数をログに残す
        this.log.system.info({
            recordedId: this.recordedId,
            error: error,
            drop: drop,
            scrambling: scrambling,
        });

        // DB へ反映
        await this.dropLogFileDB
            .updateCnt({
                id: this.dropLogFileId,
                errorCnt: error,
                dropCnt: drop,
                scramblingCnt: scrambling,
            })
            .catch(err => {
                this.log.system.error(`update drop cnt error: ${this.dropLogFileId}`);
                this.log.system.error(err);
            });
    }

    /**
     * 保存先ディレクトリを取得する
     * @param reserve: Reserve
     * @param isEnableTmp: 一時保存ディレクトリを使用するか
     * @return Promise<RecFilePathInfo> 保存先ファイルパス
     */
    private async getRecPath(reserve: Reserve, isEnableTmp: boolean): Promise<RecFilePathInfo> {
        // 親ディレクトリ
        let parentDir: RecordedDirInfo | null = null;
        let subDir = ''; // サブディレクトリ

        if (isEnableTmp === true && typeof this.config.recordedTmp !== 'undefined') {
            // 一時ディレクトリに保存する
            parentDir = {
                name: 'tmp',
                path: this.config.recordedTmp,
            };
        } else {
            if (reserve.parentDirectoryName === null) {
                // 設定がない場合は recorded の戦闘に定義されている保存先を使用する
                parentDir = this.config.recorded[0];
            } else {
                for (const d of this.config.recorded) {
                    // parentDirectoryName に一致する親ディレクトリ設定を探す
                    if (d.name === reserve.parentDirectoryName) {
                        parentDir = d;
                        break;
                    }
                }
            }

            if (parentDir === null) {
                // 親ディレクトリが見つからなかった
                parentDir = this.config.recorded[0];
            }

            // サブディレクトリ
            subDir = reserve.directory === null ? '' : reserve.directory;
        }

        // 局名
        let channelName = reserve.channelId.toString(10); // 局名が取れなかったときのために id で一旦セットする
        let sid = 'NULL';
        try {
            const channel = await this.channelDB.findId(reserve.channelId);
            if (channel !== null) {
                channelName = channel.name;
                sid = channel.serviceId.toString(10);
            }
        } catch (err) {
            this.log.system.warn(`channel name get error: ${reserve.channelId}`);
        }

        // 時刻指定予約時の番組名取得
        let programName = this.reserve.name;
        if (reserve.isTimeSpecified === true) {
            // 時刻指定予約なので番組情報を取得する
            const program = await this.programDB.findChannelIdAndTime(this.reserve.channelId, this.reserve.startAt);
            programName = program === null ? '番組名なし' : program.name;
        }

        // ファイル名
        let fileName = reserve.recordedFormat === null ? this.config.recordedFormat : reserve.recordedFormat;
        const jaDate = DateUtil.getJaDate(new Date(reserve.startAt));
        fileName = fileName
            .replace(/%YEAR%/, DateUtil.format(jaDate, 'yyyy'))
            .replace(/%SHORTYEAR%/, DateUtil.format(jaDate, 'YY'))
            .replace(/%MONTH%/, DateUtil.format(jaDate, 'MM'))
            .replace(/%DAY%/, DateUtil.format(jaDate, 'dd'))
            .replace(/%HOUR%/, DateUtil.format(jaDate, 'hh'))
            .replace(/%MIN%/, DateUtil.format(jaDate, 'mm'))
            .replace(/%SEC%/, DateUtil.format(jaDate, 'ss'))
            .replace(/%DOW%/, DateUtil.format(jaDate, 'w'))
            .replace(/%TYPE%/, reserve.channelType)
            .replace(/%CHID%/, reserve.channelId.toString(10))
            .replace(/%CHNAME%/, channelName)
            .replace(/%CH%/, reserve.channel)
            .replace(/%SID%/, sid)
            .replace(/%ID%/, reserve.id.toString())
            .replace(/%TITLE%/, programName === null ? 'NULL' : programName);

        // 使用禁止文字列置き換え
        fileName = StrUtil.replaceFileName(fileName);

        // ディレクトリ
        const dir = path.join(parentDir.path, subDir);

        // ディレクトリが存在するか確認
        try {
            await FileUtil.access(dir, fs.constants.R_OK | fs.constants.W_OK);
        } catch (err) {
            if (typeof err.code !== 'undefined' && err.code === 'ENOENT') {
                // ディレクトリが存在しないので作成する
                this.log.system.info(`mkdirp: ${dir}`);
                await FileUtil.mkdir(dir);
            } else {
                // アクセス権に Read or Write が無い
                this.log.system.fatal(`dir permission error: ${dir}`);
                this.log.system.fatal(err);
                throw err;
            }
        }

        const newFileName = await this.getFileName(parentDir.path, subDir, fileName, this.config.recordedFileExtension);

        return {
            parendDir: parentDir,
            subDir: subDir,
            fileName: newFileName,
            fullPath: path.join(parentDir.path, subDir, newFileName),
        };
    }

    /**
     * 録画ファイルの重複していないファイル名(拡張子付き)を取得
     * @param parentDir: dir path
     * @param subDir: dub dir
     * @param fileName: file name
     * @param extension: ファイル拡張子
     * @param conflict: 重複回数
     */
    private async getFileName(
        parentDir: string,
        subDir: string,
        fileName: string,
        extension: string,
        conflict: number = 0,
    ): Promise<string> {
        const conflictStr = conflict === 0 ? '' : `(${conflict})`;
        const newFileName = `${fileName}${conflictStr}${extension}`;
        const fileFullPath = path.join(parentDir, subDir, newFileName);

        try {
            await FileUtil.stat(fileFullPath);

            return this.getFileName(parentDir, subDir, fileName, extension, conflict + 1);
        } catch (err) {
            return newFileName;
        }
    }

    /**
     * 予約のキャンセル
     * @param isPlanToDelete: boolean ファイルが削除される予定か
     */
    public async cancel(isPlanToDelete: boolean): Promise<void> {
        if (this.isPrepRecording === false && this.isRecording === false) {
            // 録画処理が開始されていない
            if (this.timerId !== null) {
                clearTimeout(this.timerId);
            }
        } else if (this.isPrepRecording === true) {
            this.log.system.info(`cancel preprec: ${this.reserve.id}`);

            // 録画準備中
            return new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
                // タイムアウト設定
                const timerId = setTimeout(() => {
                    reject(new Error('PrepRecCancelTimeoutError'));
                }, 60 * 1000);

                // 録画準備中
                this.eventEmitter.once(RecorderModel.CANCEL_EVENT, () => {
                    clearTimeout(timerId);
                    // prep rec キャンセル完了
                    resolve();
                });
                this.isStopPrepRec = true;
            });
        } else if (this.isRecording === true) {
            this.isPlanToDelete = isPlanToDelete;
            this.log.system.info(`stop recording: ${this.reserve.id}`);
            // 録画中
            if (this.stream !== null) {
                this.stream.destroy();
                this.stream.push(null); // eof 通知
            }
            this.isStopRec = true;
        }
    }

    /**
     * 予約情報を更新する
     * @param newReserve: 新しい予約情報
     */
    public async update(newReserve: Reserve): Promise<void> {
        if (newReserve.isSkip === true) {
            // skip されたかチェック
            await this.cancel(false).catch(err => {
                this.log.system.error(`cancel recording error: ${newReserve.id}`);
                this.log.system.error(err);
            });
        } else if (this.reserve.startAt !== newReserve.startAt || this.reserve.endAt !== newReserve.endAt) {
            // 時刻に変更がないか確認
            // 録画処理が実行されていない場合
            if (this.isPrepRecording === false && this.isRecording === false) {
                this.setTimer(newReserve);
            } else {
                // 録画準備中 or 録画中
                if (this.reserve.startAt > newReserve.startAt) {
                    // 開始時間が遅くなった
                    await this.cancel(false).catch(err => {
                        this.log.system.error(`cancel recording error: ${newReserve.id}`);
                        this.log.system.error(err);
                    });
                    this.setTimer(newReserve); // タイマー再セット
                } else if (this.reserve.endAt !== newReserve.endAt && this.reserve.programId === null) {
                    // 時間指定予約で終了時刻に変更があった
                    this.log.system.debug(`change recording endAt: ${newReserve.id}`);

                    if (this.isPrepRecording === true) {
                        // 録画準備中なら録画中になるまで待つ
                        await new Promise((resolve: () => void, reject: (err: Error) => void) => {
                            this.log.system.debug(`wait change endAt: ${newReserve.id}`);
                            // タイムアウト設定
                            const timeoutId = setTimeout(() => {
                                reject(new Error('ChangeEndAtTimeoutError'));
                            }, IRecordingStreamCreator.PREP_TIME);

                            // 録画開始内部イベント発行街
                            this.eventEmitter.once(RecorderModel.START_RECORDING_EVENT, () => {
                                clearTimeout(timeoutId);
                                resolve();
                            });
                        });
                    }

                    // 終了時刻変更
                    try {
                        this.streamCreator.changeEndAt(newReserve);
                    } catch (err) {
                        this.log.system.error(`change recording endAt: ${newReserve.id}`);
                        this.log.system.error(err);
                    }
                }
            }
        }

        this.reserve = newReserve;

        // update recorded DB
        if (this.isRecording === true && this.recordedId !== null) {
            const recorded = await this.createRecorded();
            this.log.system.info(`update reocrded: ${this.recordedId}`);
            this.recordedDB.updateOnce(recorded);
        }
    }
}

namespace RecorderModel {
    export const CANCEL_EVENT = 'RecordingCancelEvent';
    export const START_RECORDING_EVENT = 'StartRecordingEvent';
}

export default RecorderModel;
