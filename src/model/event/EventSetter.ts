import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import IConfigFile from '../IConfigFile';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IIPCServer from '../ipc/IIPCServer';
import IExternalCommandManageModel from '../operator/externalCommand/IExternalCommandManageModel';
import IRecordedManageModel from '../operator/recorded/IRecordedManageModel';
import IRecordedTagManadeModel from '../operator/recordedTag/IRecordedTagManadeModel';
import IRecordingManageModel from '../operator/recording/IRecordingManageModel';
import IReservationManageModel from '../operator/reservation/IReservationManageModel';
import IThumbnailManageModel from '../operator/thumbnail/IThumbnailManageModel';
import IEPGUpdateEvent from './IEPGUpdateEvent';
import IEventSetter from './IEventSetter';
import IRecordedEvent from './IRecordedEvent';
import IRecordedTagEvent from './IRecordedTagEvent';
import IRecordingEvent from './IRecordingEvent';
import IReserveEvent from './IReserveEvent';
import IRuleEvent from './IRuleEvent';
import IThumbnailEvent from './IThumbnailEvent';

@injectable()
export default class EventSetter implements IEventSetter {
    private log: ILogger;
    private epgUpdateEvent: IEPGUpdateEvent;
    private ruleEvent: IRuleEvent;
    private reserveEvent: IReserveEvent;
    private recordedEvent: IRecordedEvent;
    private recordingEvent: IRecordingEvent;
    private recordedTagEvent: IRecordedTagEvent;
    private thumbnailEvent: IThumbnailEvent;
    private reservationManage: IReservationManageModel;
    private recordingManage: IRecordingManageModel;
    private recordedManage: IRecordedManageModel;
    private recordedTagManage: IRecordedTagManadeModel;
    private thumbnailManage: IThumbnailManageModel;
    private externalCommandManage: IExternalCommandManageModel;
    private ipc: IIPCServer;
    private config: IConfigFile;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IEPGUpdateEvent') epgUpdateEvent: IEPGUpdateEvent,
        @inject('IRuleEvent') ruleEvent: IRuleEvent,
        @inject('IReserveEvent') reserveEvent: IReserveEvent,
        @inject('IRecordingEvent') recordingEvent: IRecordingEvent,
        @inject('IRecordedTagEvent') recordedTagEvent: IRecordedTagEvent,
        @inject('IRecordedEvent') recordedEvent: IRecordedEvent,
        @inject('IThumbnailEvent') thumbnailEvent: IThumbnailEvent,
        @inject('IReservationManageModel')
        reservationManage: IReservationManageModel,
        @inject('IRecordingManageModel') recordingManage: IRecordingManageModel,
        @inject('IRecordedManageModel') recordedManage: IRecordedManageModel,
        @inject('IRecordedTagManadeModel') recordedTagManage: IRecordedTagManadeModel,
        @inject('IThumbnailManageModel') thumbnailManage: IThumbnailManageModel,
        @inject('IExternalCommandManageModel') externalCommandManage: IExternalCommandManageModel,
        @inject('IIPCServer') ipc: IIPCServer,
        @inject('IConfiguration') configure: IConfiguration,
    ) {
        this.log = logger.getLogger();
        this.epgUpdateEvent = epgUpdateEvent;
        this.ruleEvent = ruleEvent;
        this.reserveEvent = reserveEvent;
        this.recordedEvent = recordedEvent;
        this.recordingEvent = recordingEvent;
        this.recordedTagEvent = recordedTagEvent;
        this.thumbnailEvent = thumbnailEvent;
        this.reservationManage = reservationManage;
        this.recordingManage = recordingManage;
        this.recordedManage = recordedManage;
        this.recordedTagManage = recordedTagManage;
        this.thumbnailManage = thumbnailManage;
        this.externalCommandManage = externalCommandManage;
        this.ipc = ipc;
        this.config = configure.getConfig();
    }

    /**
     * event をセットする
     */
    public set(): void {
        // EPG 更新完了イベント
        this.epgUpdateEvent.setUpdated(async () => {
            await this.recordedManage.historyCleanup().catch(() => {});

            await this.reservationManage.updateAll();
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

            // コマンド実行
            this.externalCommandManage.addUpdateReseves(diff);
        });

        // 録画準備開始イベント
        this.recordingEvent.setStartPrepRecording(reserve => {
            this.ipc.notifyClient();
            this.externalCommandManage.addRecordingPrepStartCmd(reserve);
        });

        // 録画準備キャンセルイベント
        this.recordingEvent.setCancelPrepRecording(reserve => {
            this.ipc.notifyClient();
            this.externalCommandManage.addRecordingPrepRecFailedCmd(reserve);
        });

        // 録画準備失敗イベント
        this.recordingEvent.setPrepRecordingFailed(reserve => {
            this.ipc.notifyClient();
            this.reservationManage.cancel(reserve.id); // 予約から削除
            this.externalCommandManage.addRecordingPrepRecFailedCmd(reserve);
        });

        // 録画開始イベント
        this.recordingEvent.setStartRecording(async (reserve, recorded) => {
            // tag の追加
            if (reserve.tags !== null) {
                await this.setTag(recorded.id, reserve.tags).catch(err => {
                    this.log.system.fatal('setTag error');
                    this.log.system.fatal(err);
                });
            }

            this.ipc.notifyClient();
            this.externalCommandManage.addRecordingStartCmd(recorded);
        });

        // 録画失敗イベント
        this.recordingEvent.setRecordingFailed((reserve, recorded) => {
            this.ipc.notifyClient();
            this.reservationManage.cancel(reserve.id); // 予約から削除
            this.externalCommandManage.addRecordingFailedCmd(recorded);
        });

        // 録画完了
        this.recordingEvent.setFinishRecording(async (reserve, recorded, isStopRec) => {
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
                        removeOriginal: reserve.isDeleteOriginalAfterEncode,
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
                        removeOriginal: reserve.isDeleteOriginalAfterEncode,
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
                        removeOriginal: reserve.isDeleteOriginalAfterEncode,
                    });
                }
            }

            // tag の追加
            if (reserve.tags !== null) {
                await this.setTag(recorded.id, reserve.tags).catch(err => {
                    this.log.system.fatal('setTag error');
                    this.log.system.fatal(err);
                });
            }

            // コマンド実行
            this.externalCommandManage.addRecordingFinishCmd(recorded);

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
        });

        // video file サイズ更新
        this.recordedEvent.setUpdateVideoFileSize(() => {
            this.ipc.notifyClient();
        });

        // video file 追加
        this.recordedEvent.setAddVideoFile(() => {
            this.ipc.notifyClient();
        });

        // 録画済み番組新規追加
        this.recordedEvent.setCreateNewRecorded(() => {
            this.ipc.notifyClient();
        });

        // upload video file
        this.recordedEvent.setAddUploadedVideoFile((videoFileId, needsCreateThumbnail) => {
            this.ipc.notifyClient();
            // サムネイル作成
            if (needsCreateThumbnail === true) {
                this.thumbnailManage.add(videoFileId);
            }
        });

        // video file 削除
        this.recordedEvent.setDeleteVideoFile(() => {
            this.ipc.notifyClient();
        });

        // タグ作成
        this.recordedTagEvent.setCreated(_tag => {
            this.ipc.notifyClient();
        });

        // タグ更新
        this.recordedTagEvent.setUpdated(_tagId => {
            this.ipc.notifyClient();
        });

        // タグ関連付け
        this.recordedTagEvent.setRelated((_tagId, _recordedId) => {
            this.ipc.notifyClient();
        });

        // タグ削除
        this.recordedTagEvent.setDeleted(_tagId => {
            this.ipc.notifyClient();
        });

        // タグ関連付け削除
        this.recordedTagEvent.setDeletedRelation((_tagId, _recordedId) => {
            this.ipc.notifyClient();
        });

        // 保護状態変更
        this.recordedEvent.setChangeProtect(() => {
            this.ipc.notifyClient();
        });
    }

    /**
     * 指定した recordedId に tag 情報を関連付けさせる
     * @param recordedId: apid.RecordedId
     * @param tagsStr: string
     * @return Promise<void>
     */
    private async setTag(recordedId: apid.RecordedId, tagsStr: string): Promise<void> {
        let tags: apid.RecordedTagId[] = [];
        try {
            tags = JSON.parse(tagsStr);
        } catch (err) {
            this.log.system.error(`reserve tags parese error: ${tagsStr}`);
            this.log.system.error(err);

            return;
        }

        if (tags.length > 0) {
            for (const tagId of tags) {
                await this.recordedTagManage.setRelation(tagId, recordedId).catch(err => {
                    this.log.system.error(err);
                });
            }
        }
    }
}
