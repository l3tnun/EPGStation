import { inject, injectable } from 'inversify';
import IConfigFile from '../IConfigFile';
import IConfiguration from '../IConfiguration';
import IIPCServer from '../ipc/IIPCServer';
import IRecordingManageModel from '../operator/recording/IRecordingManageModel';
import IReservationManageModel from '../operator/reservation/IReservationManageModel';
import IThumbnailManageModel from '../operator/thumbnail/IThumbnailManageModel';
import IEPGUpdateEvent from './IEPGUpdateEvent';
import IEventSetter from './IEventSetter';
import IRecordedEvent from './IRecordedEvent';
import IRecordingEvent from './IRecordingEvent';
import IReserveEvent from './IReserveEvent';
import IRuleEvent from './IRuleEvent';
import IThumbnailEvent from './IThumbnailEvent';

@injectable()
export default class EventSetter implements IEventSetter {
    private epgUpdateEvent: IEPGUpdateEvent;
    private ruleEvent: IRuleEvent;
    private reserveEvent: IReserveEvent;
    private recordedEvent: IRecordedEvent;
    private recordingEvent: IRecordingEvent;
    private thumbnailEvent: IThumbnailEvent;
    private reservationManage: IReservationManageModel;
    private recordingManage: IRecordingManageModel;
    private thumbnailManage: IThumbnailManageModel;
    private ipc: IIPCServer;
    private config: IConfigFile;

    constructor(
        @inject('IEPGUpdateEvent') epgUpdateEvent: IEPGUpdateEvent,
        @inject('IRuleEvent') ruleEvent: IRuleEvent,
        @inject('IReserveEvent') reserveEvent: IReserveEvent,
        @inject('IRecordingEvent') recordingEvent: IRecordingEvent,
        @inject('IRecordedEvent') recordedEvent: IRecordedEvent,
        @inject('IThumbnailEvent') thumbnailEvent: IThumbnailEvent,
        @inject('IReservationManageModel')
        reservationManage: IReservationManageModel,
        @inject('IRecordingManageModel') recordingManage: IRecordingManageModel,
        @inject('IThumbnailManageModel') thumbnailManage: IThumbnailManageModel,
        @inject('IIPCServer') ipc: IIPCServer,
        @inject('IConfiguration') configure: IConfiguration,
    ) {
        this.epgUpdateEvent = epgUpdateEvent;
        this.ruleEvent = ruleEvent;
        this.reserveEvent = reserveEvent;
        this.recordedEvent = recordedEvent;
        this.recordingEvent = recordingEvent;
        this.thumbnailEvent = thumbnailEvent;
        this.reservationManage = reservationManage;
        this.recordingManage = recordingManage;
        this.thumbnailManage = thumbnailManage;
        this.ipc = ipc;
        this.config = configure.getConfig();
    }

    /**
     * event をセットする
     */
    public set(): void {
        // EPG 更新完了イベント
        this.epgUpdateEvent.setUpdated(() => {
            this.reservationManage.updateAll();
        });

        // ルール追加イベント
        this.ruleEvent.setAdded(ruleId => {
            this.ipc.notifyClient();
            this.reservationManage.updateRule(ruleId);
        });

        // ルール更新イベント
        this.ruleEvent.setUpdated(ruleId => {
            this.ipc.notifyClient();
            this.reservationManage.updateRule(ruleId);
        });

        // ルール有効化イベント
        this.ruleEvent.setEnabled(ruleId => {
            this.ipc.notifyClient();
            this.reservationManage.updateRule(ruleId);
        });

        // ルール無効化イベント
        this.ruleEvent.setDisabled(ruleId => {
            this.ipc.notifyClient();
            this.reservationManage.updateRule(ruleId);
        });

        // ルール削除イベント
        this.ruleEvent.setDeleted(ruleId => {
            this.ipc.notifyClient();
            this.reservationManage.updateRule(ruleId);
        });

        // 予約情報更新イベント
        this.reserveEvent.setUpdated(diff => {
            this.ipc.notifyClient();
            this.recordingManage.update(diff);
        });

        // 録画開始イベント
        this.recordingEvent.setStartPrepRecording(_reseve => {
            this.ipc.notifyClient();
            // TODO run cmd
        });

        // 録画準備キャンセルイベント
        this.recordingEvent.setCancelPrepRecording(_reserve => {
            this.ipc.notifyClient();
            // TODO run cmd
        });

        // 録画準備失敗イベント
        this.recordingEvent.setPrepRecordingFailed(reserve => {
            this.ipc.notifyClient();
            this.reservationManage.cancel(reserve.id); // 予約から削除
            // TODO run cmd
        });

        // 録画開始イベント
        this.recordingEvent.setStartRecording(_reserve => {
            this.ipc.notifyClient();
            // TODO run cmd
        });

        // 録画失敗イベント
        this.recordingEvent.setRecordingFailed(reserve => {
            this.ipc.notifyClient();
            this.reservationManage.cancel(reserve.id); // 予約から削除
            // TODO run cmd
        });

        // 録画完了
        this.recordingEvent.setFinishRecording((reserve, recorded, isStopRec) => {
            if (isStopRec === false) {
                if (reserve.ruleId === null) {
                    this.reservationManage.cancel(reserve.id); // 予約から削除
                } else {
                    // 重複を更新するために予約更新
                    this.reservationManage.updateRule(reserve.ruleId).catch(() => {});
                }
            }

            if (typeof recorded.videoFiles !== 'undefined' && recorded.videoFiles.length > 0) {
                // サムネイル作成
                this.thumbnailManage.add(recorded.videoFiles[0].id);

                // エンコード追加 1
                if (reserve.encodeMode1 !== null) {
                    this.ipc.setEncode({
                        recordedId: recorded.id,
                        sourceVideoFileId: recorded.videoFiles[0].id,
                        parentDir:
                            reserve.encodeParentDirectoryName1 === null
                                ? this.config.recorded[0].name
                                : reserve.encodeParentDirectoryName1,
                        directory: reserve.encodeDirectory1 === null ? undefined : reserve.encodeDirectory1,
                        mode: reserve.encodeMode1,
                        removeOriginal: false,
                    });
                }

                // エンコード追加 2
                if (reserve.encodeMode2 !== null) {
                    this.ipc.setEncode({
                        recordedId: recorded.id,
                        sourceVideoFileId: recorded.videoFiles[0].id,
                        parentDir:
                            reserve.encodeParentDirectoryName2 === null
                                ? this.config.recorded[0].name
                                : reserve.encodeParentDirectoryName2,
                        directory: reserve.encodeDirectory2 === null ? undefined : reserve.encodeDirectory2,
                        mode: reserve.encodeMode2,
                        removeOriginal: false,
                    });
                }

                // エンコード追加 3
                if (reserve.encodeMode3 !== null) {
                    this.ipc.setEncode({
                        recordedId: recorded.id,
                        sourceVideoFileId: recorded.videoFiles[0].id,
                        parentDir:
                            reserve.encodeParentDirectoryName3 === null
                                ? this.config.recorded[0].name
                                : reserve.encodeParentDirectoryName3,
                        directory: reserve.encodeDirectory3 === null ? undefined : reserve.encodeDirectory3,
                        mode: reserve.encodeMode3,
                        removeOriginal: false,
                    });
                }
            }

            this.ipc.notifyClient();
        });

        // サムネイル作成完了
        this.thumbnailEvent.setAdded((_videoFileId, _recordedId) => {
            this.ipc.notifyClient();
        });

        // 録画削除
        this.recordedEvent.setDeleteRecorded(recorded => {
            this.ipc.notifyClient();

            // cancel reserve
            if (recorded.isRecording === true && recorded.reserveId !== null) {
                this.reservationManage.cancel(recorded.reserveId);
            }

            // TODO run cmd
        });

        // video file サイズ更新
        this.recordedEvent.setUpdateVideoFileSize(() => {
            this.ipc.notifyClient();
        });

        // video file 追加
        this.recordedEvent.setAddVideoFile(() => {
            this.ipc.notifyClient();
        });

        // video file 削除
        this.recordedEvent.setDeleteVideoFile(() => {
            this.ipc.notifyClient();
        });
    }
}
