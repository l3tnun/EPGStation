import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import * as mapid from '../../../../node_modules/mirakurun/api';
import Reserve from '../../../db/entities/Reserve';
import IRecordedDB from '../../db/IRecordedDB';
import IReserveDB from '../../db/IReserveDB';
import IRecordingEvent from '../../event/IRecordingEvent';
import { IReserveUpdateValues } from '../../event/IReserveEvent';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IRecorderModel, { RecorderModelProvider } from './IRecorderModel';
import IRecordingManageModel from './IRecordingManageModel';
import IRecordingStreamCreator from './IRecordingStreamCreator';

interface RecordingIndex {
    [key: number]: IRecorderModel;
}

@injectable()
class RecordingManageModel implements IRecordingManageModel {
    private log: ILogger;
    private provider: RecorderModelProvider;
    private streamCreator: IRecordingStreamCreator;
    private recordedDB: IRecordedDB;
    private reserveDB: IReserveDB;
    private recordingEvent: IRecordingEvent;
    private recordingIndex: RecordingIndex = {};

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('RecorderModelProvider') provider: RecorderModelProvider,
        @inject('IRecordingEvent') recordingEvent: IRecordingEvent,
        @inject('IRecordingStreamCreator')
        streamCreator: IRecordingStreamCreator,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IReserveDB') reserveDB: IReserveDB,
    ) {
        this.log = logger.getLogger();
        this.provider = provider;
        this.recordingEvent = recordingEvent;
        this.streamCreator = streamCreator;
        this.recordedDB = recordedDB;
        this.reserveDB = reserveDB;

        this.setEvents(); // イベント設定
    }

    /**
     * 録画関連イベントに登録
     */
    private setEvents(): void {
        this.recordingEvent.setCancelPrepRecording(reserve => {
            this.deleteRecording(reserve);
        });

        this.recordingEvent.setPrepRecordingFailed(reserve => {
            this.deleteRecording(reserve);
        });

        this.recordingEvent.setRecordingFailed(reserve => {
            this.deleteRecording(reserve);
        });

        this.recordingEvent.setFinishRecording(reserve => {
            this.deleteRecording(reserve);
        });
    }

    /**
     * 録画終了時に呼ばれる
     * @param reserve: Reserve
     */
    private deleteRecording(reserve: Reserve): void {
        this.log.system.debug(`delete recording index: ${reserve.id}`);
        delete this.recordingIndex[reserve.id];
    }

    /**
     * tuner 情報セット
     * @param tuners: mapid.TunerDevice[]
     */
    public setTuner(tuners: mapid.TunerDevice[]): void {
        this.streamCreator.setTuner(tuners);
    }

    /**
     * 起動時に録画中に停止してしまった録画情報を録画中から録画済みに移行させる
     * @return Promise<void>
     */
    public async cleanup(): Promise<void> {
        this.log.system.info('start recordings cleanup ');

        // 録画中になっている番組を取り出す
        // tslint:disable-next-line: typedef
        const [records] = await this.recordedDB.findAll(
            {
                isHalfWidth: false,
                isRecording: true,
            },
            {
                isNeedVideoFiles: true,
                isNeedThumbnails: false,
                isNeedsDropLog: false,
                isNeedTags: false,
            },
        );

        for (const r of records) {
            // 録画中から録画済みへ変更
            try {
                await this.recordedDB.removeRecording(r.id);
            } catch (err) {
                this.log.system.error(`failed to remove recording: ${r.id}`);
                this.log.system.error(err);
                continue;
            }

            // reserveId がなかった
            if (r.reserveId === null) {
                this.log.system.warn(`reserveId is null: ${r.reserveId}`);
                continue;
            }

            // 予約情報取得
            const reserve = await this.reserveDB.findId(r.reserveId).catch(err => {
                this.log.system.error(`get reserve error: ${r.reserveId}`);
                this.log.system.error(err);
            });

            // 予約情報が取れなかった
            if (typeof reserve === 'undefined' || reserve === null) {
                this.log.system.warn(`reserveId is not found: ${r.reserveId}`);
                continue;
            }

            // TODO recordedTmp が有効な場合は正規の場所に移動させる

            // 終了処理
            this.recordingEvent.emitFinishRecording(reserve, r, true);
        }

        this.log.system.info('finish recordings cleanup ');
    }

    /**
     * 予約情報の更新
     * @param diff: IReserveUpdateValues
     */
    public async update(diff: IReserveUpdateValues): Promise<void> {
        // 新規追加
        if (typeof diff.insert !== 'undefined') {
            for (const reserve of diff.insert) {
                const recorder = await this.provider();
                if (recorder.setTimer(reserve) === true) {
                    this.log.system.debug(`add recording: ${reserve.id}`);
                    this.recordingIndex[reserve.id] = recorder;
                } else {
                    this.log.system.error(`add recordgin error: ${reserve.id}`);
                }
            }
        }

        // 更新
        if (typeof diff.update !== 'undefined') {
            for (const reserve of diff.update) {
                const recorder = this.recordingIndex[reserve.id];
                if (typeof recorder === 'undefined') {
                    // recorder がなかった
                    this.log.system.debug(`create new recorder: ${reserve.id}`);
                    const newRecorder = await this.provider();
                    if (newRecorder.setTimer(reserve) === true) {
                        this.recordingIndex[reserve.id] = newRecorder;
                    }
                } else {
                    this.log.system.debug(`update recording: ${reserve.id}`);
                    await recorder.update(reserve).catch(err => {
                        this.log.system.error(`update recording error: ${reserve.id}`);
                        this.log.system.error(err);
                    });
                }
            }
        }

        // 削除
        if (typeof diff.delete !== 'undefined') {
            for (const reserve of diff.delete) {
                const recorder = this.recordingIndex[reserve.id];
                if (typeof recorder !== 'undefined') {
                    this.log.system.debug(`delete recording: ${reserve.id}`);
                    await recorder.cancel(false).catch(err => {
                        this.log.system.error(`delete recording error: ${reserve.id}`);
                        this.log.system.error(err);
                    });
                }
            }
        }
    }

    /**
     * 指定された reserve id がセットされているか
     * @param reserveId: ReserveId
     * @return boolean
     */
    public hasReserve(reserveId: apid.ReserveId): boolean {
        return typeof this.recordingIndex[reserveId] !== 'undefined';
    }

    /**
     * 指定された reserve id の録画をキャンセルする
     * @param reserveId: ReserveId
     * @param isPlanToDelete: boolean 録画ファイルが削除される予定か
     * @return Promise<void>
     */
    public async cancel(reserveId: apid.ReserveId, isPlanToDelete: boolean): Promise<void> {
        if (typeof this.recordingIndex[reserveId] === 'undefined') {
            // 存在しないのでスルー
            return;
        }

        return this.recordingIndex[reserveId].cancel(isPlanToDelete);
    }
}

export default RecordingManageModel;
