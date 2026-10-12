import { inject, injectable } from 'inversify';
import type * as apid from '../../../api.js';
import type Reserve from '../../db/entities/Reserve.js';
import IConfigFile from '../IConfigFile.js';
import IConfiguration from '../IConfiguration.js';
import ILogger from '../ILogger.js';
import ILoggerModel from '../ILoggerModel.js';
import IIPCServer from '../ipc/IIPCServer.js';
import IExternalCommandManageModel from '../operator/externalCommand/IExternalCommandManageModel.js';
import IRecordedManageModel from '../operator/recorded/IRecordedManageModel.js';
import IRecordedTagManadeModel from '../operator/recordedTag/IRecordedTagManadeModel.js';
import IRecordingManageModel from '../operator/recording/IRecordingManageModel.js';
import IReservationManageModel from '../operator/reservation/IReservationManageModel.js';
import IThumbnailManageModel from '../operator/thumbnail/IThumbnailManageModel.js';
import IOperatorEncodeEvent from './IOperatorEncodeEvent.js';
import OperatorEncodeEventBinding from './OperatorEncodeEventBinding.js';
import IEPGUpdateEvent from './IEPGUpdateEvent.js';
import IEventSetter from './IEventSetter.js';
import IRecordedEvent from './IRecordedEvent.js';
import IRecordedTagEvent from './IRecordedTagEvent.js';
import IRecordingEvent from './IRecordingEvent.js';
import IReserveEvent from './IReserveEvent.js';
import IRuleEvent from './IRuleEvent.js';
import IThumbnailEvent from './IThumbnailEvent.js';

/**
 * 各種 event（EPG更新・rule・予約・録画・タグ・サムネイル・エンコード）の発生を購読し、
 * IPC client への通知や各 ManageModel への反映・外部コマンド実行へ橋渡しする配線 class。
 * `set()` を1回呼ぶことで、コンストラクタで受け取った全 event source へ購読を登録する
 * （購読の解除は行わない。プロセス生存期間中ずっと有効）。
 */
@injectable()
export default class EventSetter implements IEventSetter {
    private log: ILogger;
    /** 以下、コンストラクタで注入され `set()` 内の購読・呼び出しにのみ使う event source / ManageModel 群。 */
    private epgUpdateEvent: IEPGUpdateEvent;
    private encodeEvent: IOperatorEncodeEvent;
    private encodeEventBinding: OperatorEncodeEventBinding;
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

    /** 保留した予約削除 command の期限（ミリ秒）。録画完了・失敗がこの時間内に来なければ、その時点で積む。
     *  録画の一時 directory から保存先への copy が終わるまで録画完了は出ないので、copy の時間を見込んで長めにする。 */
    public static readonly RESERVE_DELETION_HOLD_LIMIT_MS = 10 * 60 * 1000;

    /** 番組の終了時刻を過ぎて録画中に削除された予約の、保留中の予約削除 command（予約 id ごとに受け付けた順）。
     *  その録画の録画完了・録画失敗の command を積んだ直後に積む。 */
    private readonly heldReserveDeletions = new Map<
        apid.ReserveId,
        { reserve: Reserve; isSuppressLog: boolean; timer: ReturnType<typeof setTimeout> }[]
    >();

    /** 予約更新イベントの初回発火かどうか。`set()` 内の `epgUpdateEvent.setUpdated` callback が
     *  初回だけ異なる引数で `reservationManage.updateAll` を呼ぶために使い、初回実行後は `false` に固定する。 */
    private isFirstreserveationUpdate: boolean = true;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IEPGUpdateEvent') epgUpdateEvent: IEPGUpdateEvent,
        @inject('IOperatorEncodeEvent') encodeEvent: IOperatorEncodeEvent,
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
        @inject('OperatorEncodeEventBinding') encodeEventBinding: OperatorEncodeEventBinding,
    ) {
        this.log = logger.getLogger();
        this.epgUpdateEvent = epgUpdateEvent;
        this.encodeEvent = encodeEvent;
        this.encodeEventBinding = encodeEventBinding;
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
        // encode 完了通知の受け口（IPCServer 側の sink）を登録する。登録は重複排除されないので、`set()` を起動時に1回だけ呼ぶ前提でここで1回行う。
        this.encodeEventBinding.setup();

        // EPG 更新完了イベント
        this.epgUpdateEvent.setUpdated(async () => {
            await this.recordedManage.historyCleanup().catch(() => {});

            await this.reservationManage.updateAll(this.isFirstreserveationUpdate);
            this.isFirstreserveationUpdate = false;
        });

        // ルール追加イベント
        this.ruleEvent.setAdded(ruleId => {
            this.attemptDestination(() => this.ipc.notifyClient());
            this.attemptDestination(() => this.reservationManage.updateRule(ruleId));
        });

        // ルール更新イベント
        this.ruleEvent.setUpdated(ruleId => {
            this.attemptDestination(() => this.ipc.notifyClient());
            this.attemptDestination(() => this.reservationManage.updateRule(ruleId));
        });

        // ルール有効化イベント
        this.ruleEvent.setEnabled(ruleId => {
            this.attemptDestination(() => this.ipc.notifyClient());
            this.attemptDestination(() => this.reservationManage.updateRule(ruleId));
        });

        // ルール無効化イベント
        this.ruleEvent.setDisabled(ruleId => {
            this.attemptDestination(() => this.ipc.notifyClient());
            this.attemptDestination(() => this.reservationManage.updateRule(ruleId));
        });

        // ルール削除イベント
        this.ruleEvent.setDeleted(ruleId => {
            this.attemptDestination(() => this.ipc.notifyClient());
            this.attemptDestination(() => this.recordedManage.removeRuleId(ruleId));
            this.attemptDestination(() => this.reservationManage.updateRule(ruleId));
        });

        // 予約情報更新イベント
        this.reserveEvent.setUpdated(diff => {
            // 録画実行へ差分を渡すと録画中の判定が消えるので、その前に見分ける
            const deleted = diff.delete ?? [];
            const held = this.selectDeletionsAwaitingRecordingEnd(deleted);
            this.attemptDestination(() => this.ipc.notifyClient());
            this.attemptDestination(() => this.recordingManage.acceptMutation(diff));

            // コマンド実行
            // 起動時の送り直しの update は予約の変更ではないので、予約変更コマンドへは渡さない
            const forwarded = diff.isStartupRebuild === true ? { ...diff, update: [] } : diff;
            this.attemptDestination(() =>
                this.externalCommandManage.addUpdateReseves(
                    held.length === 0 ? forwarded : { ...forwarded, delete: deleted.filter(r => !held.includes(r)) },
                ),
            );
            for (const reserve of held) {
                this.holdReserveDeletion(reserve, diff.isSuppressLog);
            }
        });

        // 録画準備開始イベント
        this.recordingEvent.setStartPrepRecording(reserve => {
            this.attemptDestination(() => this.ipc.notifyClient());
            this.attemptDestination(() => this.externalCommandManage.addRecordingPrepStartCmd(reserve));
        });

        // 録画準備キャンセルイベント
        this.recordingEvent.setCancelPrepRecording(reserve => {
            this.attemptDestination(() => this.ipc.notifyClient());
            this.attemptDestination(() => this.externalCommandManage.addRecordingPrepRecFailedCmd(reserve));
            this.releaseReserveDeletions(reserve.id);
        });

        // 録画準備失敗イベント
        this.recordingEvent.setPrepRecordingFailed(reserve => {
            this.attemptDestination(() => this.ipc.notifyClient());
            this.attemptDestination(() => this.reservationManage.cancel(reserve.id)); // 予約から削除
            this.attemptDestination(() => this.externalCommandManage.addRecordingPrepRecFailedCmd(reserve));
            this.releaseReserveDeletions(reserve.id);
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

            this.attemptDestination(() => this.ipc.notifyClient());
            this.attemptDestination(() => this.externalCommandManage.addRecordingStartCmd(recorded));
        });

        // 録画失敗イベント
        this.recordingEvent.setRecordingFailed((reserve, recorded) => {
            this.attemptDestination(() => this.ipc.notifyClient());
            if (recorded !== null) {
                this.attemptDestination(() => this.externalCommandManage.addRecordingFailedCmd(recorded));
            }
            this.releaseReserveDeletions(reserve.id);
        });

        // 録画リトライオーバーイベント
        this.recordingEvent.setRecordingRetryOver(reserve => {
            // 予約から削除
            this.attemptDestination(() => this.reservationManage.cancel(reserve.id));
        });

        // 録画完了
        this.recordingEvent.setFinishRecording(async (reserve, recorded, isNeedDeleteReservation) => {
            if (isNeedDeleteReservation === true) {
                if (reserve.ruleId === null || reserve.isEventRelay == true) {
                    // 手動予約 or ルール予約によるイベントリレー予約を削除
                    this.attemptDestination(() => this.reservationManage.cancel(reserve.id));
                } else {
                    // 重複を更新するために予約更新
                    const ruleId = reserve.ruleId;
                    this.attemptDestination(() => this.reservationManage.updateRule(ruleId));
                }
            }

            if (typeof recorded.videoFiles !== 'undefined' && recorded.videoFiles.length > 0) {
                const sourceVideoFileId = recorded.videoFiles[0].id;
                // サムネイル作成
                this.thumbnailManage.add(sourceVideoFileId);

                // エンコード追加 1
                const encodeMode1 = reserve.encodeMode1;
                if (encodeMode1 !== null) {
                    this.ipc.setEncode({
                        recordedId: recorded.id,
                        sourceVideoFileId,
                        parentDir:
                            reserve.encodeParentDirectoryName1 === null
                                ? this.config.recorded[0].name
                                : reserve.encodeParentDirectoryName1,
                        directory: reserve.encodeDirectory1 === null ? undefined : reserve.encodeDirectory1,
                        mode: encodeMode1,
                        removeOriginal: reserve.isDeleteOriginalAfterEncode,
                    });
                }

                // エンコード追加 2
                const encodeMode2 = reserve.encodeMode2;
                if (encodeMode2 !== null) {
                    this.ipc.setEncode({
                        recordedId: recorded.id,
                        sourceVideoFileId,
                        parentDir:
                            reserve.encodeParentDirectoryName2 === null
                                ? this.config.recorded[0].name
                                : reserve.encodeParentDirectoryName2,
                        directory: reserve.encodeDirectory2 === null ? undefined : reserve.encodeDirectory2,
                        mode: encodeMode2,
                        removeOriginal: reserve.isDeleteOriginalAfterEncode,
                    });
                }

                // エンコード追加 3
                const encodeMode3 = reserve.encodeMode3;
                if (encodeMode3 !== null) {
                    this.ipc.setEncode({
                        recordedId: recorded.id,
                        sourceVideoFileId,
                        parentDir:
                            reserve.encodeParentDirectoryName3 === null
                                ? this.config.recorded[0].name
                                : reserve.encodeParentDirectoryName3,
                        directory: reserve.encodeDirectory3 === null ? undefined : reserve.encodeDirectory3,
                        mode: encodeMode3,
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
            this.attemptDestination(() => this.externalCommandManage.addRecordingFinishCmd(recorded));
            this.releaseReserveDeletions(reserve.id);

            this.attemptDestination(() => this.ipc.notifyClient());
        });

        // イベントリレーによる予約依頼
        this.recordingEvent.setEventRelay(async programs => {
            for (const program of programs) {
                try {
                    const reserveId = await this.reservationManage.addEventRelay(
                        program.programId,
                        program.parentReserve,
                    );
                    if (reserveId === null) {
                        this.log.system.error(new Error(`event relay duplicate: ${program.programId}`));
                    }
                } catch (err: unknown) {
                    this.log.system.error(
                        Object.assign(new Error(`event relay failed: ${program.programId}`), { cause: err }),
                    );
                }
            }
        });

        // サムネイル作成完了
        this.thumbnailEvent.setAdded((_videoFileId, _recordedId) => {
            this.attemptDestination(() => this.ipc.notifyClient());
        });

        // サムネイル削除
        this.thumbnailEvent.setDeleted(() => {
            this.attemptDestination(() => this.ipc.notifyClient());
        });

        // 録画削除
        this.recordedEvent.setDeleteRecorded(recorded => {
            this.attemptDestination(() => this.ipc.notifyClient());

            // cancel reserve
            if (recorded.isRecording === true && recorded.reserveId !== null) {
                const reserveId = recorded.reserveId;
                this.attemptDestination(() => this.reservationManage.cancel(reserveId));
            }
        });

        // video file サイズ更新
        this.recordedEvent.setUpdateVideoFileSize(() => {
            this.attemptDestination(() => this.ipc.notifyClient());
        });

        // video file 追加
        this.recordedEvent.setAddVideoFile(() => {
            this.attemptDestination(() => this.ipc.notifyClient());
        });

        // 録画済み番組新規追加
        this.recordedEvent.setCreateNewRecorded(() => {
            this.attemptDestination(() => this.ipc.notifyClient());
        });

        // upload video file
        this.recordedEvent.setAddUploadedVideoFile((videoFileId, needsCreateThumbnail) => {
            this.attemptDestination(() => this.ipc.notifyClient());
            // サムネイル作成
            if (needsCreateThumbnail === true) {
                this.attemptDestination(() => this.thumbnailManage.add(videoFileId));
            }
        });

        // video file 削除
        this.recordedEvent.setDeleteVideoFile(() => {
            this.attemptDestination(() => this.ipc.notifyClient());
        });

        // ドロップログ登録情報変更
        this.recordedEvent.setDropLogFileChanged(() => {
            this.attemptDestination(() => this.ipc.notifyClient());
        });

        // タグ作成
        this.recordedTagEvent.setCreated(_tag => {
            this.attemptDestination(() => this.ipc.notifyClient());
        });

        // タグ更新
        this.recordedTagEvent.setUpdated(_tagId => {
            this.attemptDestination(() => this.ipc.notifyClient());
        });

        // タグ関連付け
        this.recordedTagEvent.setRelated((_tagId, _recordedId) => {
            this.attemptDestination(() => this.ipc.notifyClient());
        });

        // タグ削除
        this.recordedTagEvent.setDeleted(_tagId => {
            this.attemptDestination(() => this.ipc.notifyClient());
        });

        // タグ関連付け削除
        this.recordedTagEvent.setDeletedRelation((_tagId, _recordedId) => {
            this.attemptDestination(() => this.ipc.notifyClient());
        });

        // 保護状態変更
        this.recordedEvent.setChangeProtect(() => {
            this.attemptDestination(() => this.ipc.notifyClient());
        });

        // エンコード完了
        this.encodeEvent.setFinishEncode(info => {
            this.attemptDestination(() => this.externalCommandManage.addEncodingFinishCmd(info));
        });
    }

    /**
     * 予約差分の削除のうち、番組の終了時刻を過ぎていて録画実行がまだ録画中として保持している予約を返す。
     * これらの録画は届いた data を読み終えてから正常終了するので、予約削除 command を録画完了の後に積む。
     * 録画中の判定に失敗した予約は記録して、保留せずに通常どおり積む。
     * @param deleted 予約の変更差分の削除
     * @return 予約削除 command を保留する予約
     */
    private selectDeletionsAwaitingRecordingEnd(deleted: Reserve[]): Reserve[] {
        if (deleted.length === 0) return [];
        const now = Date.now();
        return deleted.filter(reserve => {
            if (reserve.endAt > now) return false;
            try {
                return this.recordingManage.hasReserve(reserve.id);
            } catch (err: any) {
                this.log.system.error(err);
                return false;
            }
        });
    }

    /**
     * 予約削除 command を保留する。期限までに録画完了・失敗が来なければ、その時点で積む。
     * @param reserve 削除された予約
     * @param isSuppressLog 元の差分の log の抑制
     */
    private holdReserveDeletion(reserve: Reserve, isSuppressLog: boolean): void {
        const timer = setTimeout(
            () => this.releaseReserveDeletions(reserve.id),
            EventSetter.RESERVE_DELETION_HOLD_LIMIT_MS,
        );
        timer.unref();
        const list = this.heldReserveDeletions.get(reserve.id) ?? [];
        list.push({ reserve, isSuppressLog, timer });
        this.heldReserveDeletions.set(reserve.id, list);
    }

    /**
     * 保留した予約削除 command を、受け付けた順に積む。保留が無ければ何もしない。
     * @param reserveId 予約 id
     */
    private releaseReserveDeletions(reserveId: apid.ReserveId): void {
        const list = this.heldReserveDeletions.get(reserveId);
        if (typeof list === 'undefined') return;
        this.heldReserveDeletions.delete(reserveId);
        for (const held of list) {
            clearTimeout(held.timer);
            this.attemptDestination(() =>
                this.externalCommandManage.addUpdateReseves({
                    insert: [],
                    update: [],
                    delete: [held.reserve],
                    isSuppressLog: held.isSuppressLog,
                }),
            );
        }
    }

    private attemptDestination(destination: () => unknown): void {
        try {
            void Promise.resolve(destination()).catch(err => {
                this.log.system.error(err);
            });
        } catch (err: any) {
            this.log.system.error(err);
        }
    }

    /**
     * 指定した recordedId に tag 情報を関連付けさせる
     * @param recordedId: apid.RecordedId
     * @param tagsStr: string
     * @return Promise<void>
     */
    private async setTag(recordedId: apid.RecordedId, tagsStr: string): Promise<void> {
        let tags: apid.RecordedTagId[];
        try {
            tags = JSON.parse(tagsStr);
            if (!Array.isArray(tags)) {
                throw new Error('reserve tags must be an array');
            }
        } catch (err: any) {
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
