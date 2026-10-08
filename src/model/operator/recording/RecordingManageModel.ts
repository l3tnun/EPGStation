import { inject, injectable } from 'inversify';
import type * as apid from '../../../../api.js';
import Reserve from '../../../db/entities/Reserve.js';
import IRecordedDB from '../../db/IRecordedDB.js';
import IReserveDB from '../../db/IReserveDB.js';
import IRecordingEvent, { RecordingFailureSessionIdentity } from '../../event/IRecordingEvent.js';
import { IReserveUpdateValues } from '../../event/IReserveEvent.js';
import IConfigFile from '../../IConfigFile.js';
import IConfiguration from '../../IConfiguration.js';
import ILogger from '../../ILogger.js';
import ILoggerModel from '../../ILoggerModel.js';
import { TunerInfo } from '../../tuner/types.js';
import IRecorderModel, { RecorderModelProvider, RecordingScheduleSessionBinding } from './IRecorderModel.js';
import IRecordingManageModel from './IRecordingManageModel.js';
import IRecordingStreamCreator from './IRecordingStreamCreator.js';
import IRecordingUtilModel from './IRecordingUtilModel.js';
import RecordingCandidateRegistry, { RecordingPhase } from './RecordingCandidateRegistry.js';
import RecordingRecordedUseProvider, { RecordingSessionRecordedUse } from './RecordingRecordedUseProvider.js';
import RecordingScheduleController, {
    RecordingScheduleMutationDispatch,
    RecordingSessionSnapshot,
} from './RecordingScheduleController.js';

/** 現在アクティブ（起動中〜録画中〜終了処理中）な予約の reservationId から
 *  その`IRecorderModel`インスタンスへの索引。 */
interface RecordingIndex {
    [key: number]: IRecorderModel;
}

/** `rebuildCandidatesAndStart`による起動シーケンスの進行状態。`NotStarted`の間に届いた
 *  `acceptMutation`/録画失敗イベントは即時反映せず`pendingStartup*`へ退避し、`Started`へ
 *  遷移した時点でまとめて反映する（起動処理と並行して届く更新の競合を避けるため）。 */
type CandidateStartupState = 'NotStarted' | 'Starting' | 'Started' | 'Failed';

/** 起動中（`candidateStartupState === 'Starting'`）に届いた録画失敗イベントを、起動完了後の
 *  `flushPendingStartupRecordingFailures`まで退避しておくための保持形。 */
interface PendingStartupRecordingFailure {
    readonly reserve: Reserve;
    readonly failure: RecordingFailureSessionIdentity | undefined;
}

/** ある`IRecorderModel`が現在「使用中」として登録している録画済みファイルの状態。
 *  `activeRecordedUseSessions`の値の型。 */
interface ActiveRecordedUseSession {
    readonly recordedUse: Extract<RecordingSessionRecordedUse, { readonly status: 'active' }>;
    readonly recordedId: number;
    readonly recorder: IRecorderModel;
    readonly reservationId: number;
}

/** `releaseRecordedUse`の呼び出し時点で「まだこの`recordedUse`のままであること」を確認する
 *  ための期待値。非同期の完了待ち（`observeNormalRecordedUseTerminal`）の間に、同じ recorder が
 *  別の録画へ使い回されていないかを確かめるのに使う。 */
interface ActiveRecordedUseExpectation {
    readonly recordedUse: ActiveRecordedUseSession['recordedUse'];
    readonly recorder: IRecorderModel;
}

/**
 * `IRecordingManageModel`の実装。`RecordingCandidateRegistry`（録画対象候補の一覧）と
 * `RecordingScheduleController`（候補ごとの Waiting→Preparing→Recording→Finishing→Completed
 * という phase 遷移とタイマー管理）を組み合わせて、実際の`IRecorderModel`インスタンスの
 * 生成・状態同期（`applyScheduleMutation`）を行う。`scheduleController`からのコールバックは
 * `sessionMutationTail`で直列化し、また各コールバックは呼ばれた時点のsession（世代・token）が
 * まだ有効かを`current.sessionToken`等で確認してから作用する。これは、非同期処理
 * （DB検索・`provider()`呼び出し等）の完了を待つ間に予約が別のsessionへ進んでしまう
 * （再スケジュールされる）競合を防ぐため。
 */
@injectable()
class RecordingManageModel implements IRecordingManageModel {
    private log: ILogger;
    private config: IConfigFile;
    private provider: RecorderModelProvider;
    private streamCreator: IRecordingStreamCreator;
    private recordedDB: IRecordedDB;
    private reserveDB: IReserveDB;
    private recordingUtil: IRecordingUtilModel;
    private recordingEvent: IRecordingEvent;
    /** 現在アクティブな reservationId → `IRecorderModel` の索引。 */
    private recordingIndex: RecordingIndex = {};
    /** 録画対象候補（isSkip/isOverlapでない今後の予約）の一覧を保持する registry。 */
    private readonly candidateRegistry: RecordingCandidateRegistry;
    /** 候補ごとの phase 遷移とタイマーを管理する controller。実際の副作用
     *  （recorder 生成・更新・削除）はこの class の `dispatch*` コールバック経由で行われる。 */
    private readonly scheduleController: RecordingScheduleController;
    /** `recordingIndex`に現在登録されている recorder が、どの session（世代・token）に
     *  紐付いて生成されたものかを記録する。`scheduleController`側の最新sessionと一致しない
     *  場合、そのrecorderは既に古いsessionのものとみなして操作を無視する。 */
    private readonly recordingSessionTokens = new Map<number, RecordingSessionSnapshot['sessionToken']>();
    /** 現在「録画失敗処理（`processRecordingFailure`）を実行中」の reservationId の集合。
     *  同じ予約について複数回失敗イベントが来ても二重に再追加/リトライしないための guard。 */
    private readonly recordingFailureClaims = new Set<number>();
    /** 各`IRecorderModel`が現在使用中として登録している録画済みファイルの状態。他の
     *  subsystem（サムネイル生成やファイル削除等）が録画中のファイルに触れないよう、
     *  外部へこの登録状況を伝える窓口（`recordedUseProvider`）に反映するための追跡台帳。 */
    private readonly activeRecordedUseSessions = new Map<IRecorderModel, ActiveRecordedUseSession>();
    /** `whenNormalRecordingTerminal`（正常終了待ち）の対象になっている
     *  `ActiveRecordedUseSession.recordedUse`。完了時、登録内容が待ち開始時から変わっていないかの
     *  確認に使う（`isAwaitingNormalRecordedUseTerminal`）。 */
    private readonly normalRecordedUseTerminals = new Map<IRecorderModel, ActiveRecordedUseSession['recordedUse']>();
    /** recordedId がまだ判明していない（`observeActiveRecordedUse`が`unknown`扱いにした）
     *  予約について、使用中登録の識別子として使う仮のオブジェクトを reservationId ごとに保持する。 */
    private readonly unknownRecordedUseSessions = new Map<number, object>();
    /** 削除予定のキャンセル（`cancel(id, true)`）が進行中の reservationId ごとの状態。重複した
     *  削除要求を新規に発行させず、同じ`request`/`terminal`へ合流させるための記録。 */
    private readonly deletionStops = new Map<
        number,
        { readonly recorder: IRecorderModel; readonly request: Promise<void>; readonly terminal: Promise<void> }
    >();
    /** session操作（`applyScheduleMutation`等）を発生順に直列実行するための Promise chain。
     *  `queueSessionOperation`で末尾に追加し、`afterSessionMutations`で「現時点までの
     *  session操作が全て終わった後」を待つのに使う。 */
    private sessionMutationTail: Promise<void> = Promise.resolve();
    /** `scheduleController.start()`を実際に呼んだか（起動は`ensureScheduleStarted`で
     *  遅延・一度きりに行う）。 */
    private scheduleStarted = false;
    /** `rebuildCandidatesAndStart`の進行状態。`'Started'`になるまで`acceptMutation`/
     *  録画失敗イベントは即時反映せず退避する。 */
    private candidateStartupState: CandidateStartupState = 'NotStarted';
    /** `rebuildCandidatesAndStart`が返す Promise。重複呼び出し時に同じ Promise を返すための保持。 */
    private candidateStartupPromise: Promise<void> | undefined;
    /** 起動完了前に届いた予約差分を、起動完了後に`flushPendingStartupMutations`で
     *  まとめて反映するための退避キュー。 */
    private readonly pendingStartupMutations: IReserveUpdateValues[] = [];
    /** 起動完了前に届いた録画失敗イベントを、起動完了後に
     *  `flushPendingStartupRecordingFailures`でまとめて処理するための退避キュー。 */
    private readonly pendingStartupRecordingFailures: PendingStartupRecordingFailure[] = [];
    /** 起動時整理で録画完了を通知し、その通知で予約が取り消される（手動予約・番組リレー予約）reservationId の集合。
     *  取消は通知の受け手が待たずに始めるため、`rebuildCandidatesAndStart`が読む保存済み予約にまだ残ることがある。
     *  候補へ入れると録画準備を始めてから取消で準備を取り消すので、候補再構築ではこの予約を除く。 */
    private readonly startupRemovedReservationIds = new Set<number>();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('RecorderModelProvider') provider: RecorderModelProvider,
        @inject('IRecordingEvent') recordingEvent: IRecordingEvent,
        @inject('IRecordingStreamCreator')
        streamCreator: IRecordingStreamCreator,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IReserveDB') reserveDB: IReserveDB,
        @inject('IRecordingUtilModel') recordingUtil: IRecordingUtilModel,
        @inject('RecordingRecordedUseProvider')
        private readonly recordedUseProvider: RecordingRecordedUseProvider = new RecordingRecordedUseProvider(),
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.provider = provider;
        this.recordingEvent = recordingEvent;
        this.streamCreator = streamCreator;
        this.recordedDB = recordedDB;
        this.reserveDB = reserveDB;
        this.recordingUtil = recordingUtil;

        this.candidateRegistry = new RecordingCandidateRegistry();
        this.scheduleController = new RecordingScheduleController({
            candidateRegistry: this.candidateRegistry,
            clock: { now: () => Date.now() },
            scheduler: {
                setTimeout: (callback, delayMs) => {
                    const timeout = setTimeout(callback, delayMs);
                    timeout.unref?.();
                    return { cancel: () => clearTimeout(timeout) };
                },
                queueMicrotask: callback => queueMicrotask(callback),
            },
            dispatchMutation: mutation => {
                this.recordingFailureClaims.delete(mutation.reservationId);
                return this.queueSessionOperation(() => this.applyScheduleMutation(mutation));
            },
            dispatchPreparation: (candidate, generation, sessionToken) =>
                this.afterSessionMutations(() => {
                    const current = this.scheduleController.getSessionSnapshot(candidate.reservationId);
                    if (
                        current?.generation !== generation ||
                        current.sessionToken !== sessionToken ||
                        current.phase !== 'Preparing'
                    ) {
                        return;
                    }
                    const recorder = this.recordingIndex[candidate.reservationId];
                    if (
                        recorder === undefined ||
                        this.recordingSessionTokens.get(candidate.reservationId) !== sessionToken
                    ) {
                        return;
                    }
                    this.bindRecorder(recorder, current);
                    this.launchSessionLifetime(
                        () => recorder.startPreparation?.(),
                        `recording preparation error: ${candidate.reservationId}`,
                    );
                }),
            dispatchReset: () => undefined,
            dispatchTimeSpecifiedEnd: milestone =>
                this.afterSessionMutations(() => {
                    const recorder = this.recordingIndex[milestone.reservationId];
                    const current = this.scheduleController.getSessionSnapshot(milestone.reservationId);
                    if (
                        recorder === undefined ||
                        this.recordingSessionTokens.get(milestone.reservationId) !== milestone.sessionToken ||
                        current?.generation !== milestone.generation ||
                        current.sessionToken !== milestone.sessionToken ||
                        current.phase !== 'Finishing'
                    ) {
                        return;
                    }
                    this.bindRecorder(recorder, current);
                    this.launchSessionLifetime(
                        () => recorder.finishAtTimeSpecifiedEnd?.(),
                        `time specified recording end error: ${milestone.reservationId}`,
                    );
                }),
            reportDispatchError: (error, context) => {
                this.log.system.error(`recording schedule dispatch error: ${context.reservationId}`);
                this.log.system.error(error);
            },
        });

        this.setEvents(); // イベント設定
    }

    /**
     * 録画関連イベントに登録
     */
    private setEvents(): void {
        this.recordingEvent.setStartPrepRecording?.(reserve => {
            this.observePreparingRecordedUse(reserve.id);
        });

        this.recordingEvent.setCancelPrepRecording(reserve => {
            this.releaseRecordedUsesForReservation(reserve.id);
            this.deleteRecording(reserve.id);
        });

        this.recordingEvent.setPrepRecordingFailed(reserve => {
            this.releaseRecordedUsesForReservation(reserve.id);
            this.deleteRecording(reserve.id);
        });

        this.recordingEvent.setStartRecording?.((reserve, recorded) => {
            this.observeActiveRecordedUse(reserve.id, recorded.id);
        });

        this.recordingEvent.setRecordingFailed(async (reserve, _recorded, failedIdentity) => {
            if (this.candidateStartupState === 'Starting') {
                this.pendingStartupRecordingFailures.push({ reserve, failure: failedIdentity });
                return;
            }
            await this.processRecordingFailure(reserve, failedIdentity);
        });

        this.recordingEvent.setFinishRecording((reserve, recorded) => {
            if (!this.isAwaitingNormalRecordedUseTerminal(reserve.id, recorded.id)) {
                this.releaseRecordedUse(reserve.id, recorded.id);
            }
            this.deleteRecording(reserve.id);
        });
    }

    private observePreparingRecordedUse(reservationId: number): void {
        const recorder = this.recordingIndex[reservationId];
        if (recorder === undefined || this.hasActiveRecordedUse(recorder)) return;
        this.recordedUseProvider.tryRegisterSessionUse(recorder, { status: 'preparing' });
    }

    private observeActiveRecordedUse(reservationId: number, recordedId: unknown): void {
        const recorder = this.recordingIndex[reservationId];
        if (recorder === undefined || !this.isRecordedUseId(recordedId)) {
            const identity = recorder ?? this.unknownRecordedUseSessions.get(reservationId) ?? Object.freeze({});
            this.unknownRecordedUseSessions.set(reservationId, identity);
            this.recordedUseProvider.tryRegisterSessionUse(identity, { status: 'unknown' });
            return;
        }

        const recordedUse = Object.freeze({
            recordedId,
            status: 'active',
        });
        const registration = this.recordedUseProvider.tryRegisterSessionUse(recorder, recordedUse);
        if (registration !== 'registered') return;

        const unknown = this.unknownRecordedUseSessions.get(reservationId);
        this.unknownRecordedUseSessions.delete(reservationId);
        if (unknown !== undefined && unknown !== recorder) this.recordedUseProvider.releaseSessionUse(unknown);
        this.activeRecordedUseSessions.set(recorder, { recordedId, recordedUse, recorder, reservationId });
        this.observeNormalRecordedUseTerminal(reservationId, recordedId, recorder, recordedUse);
    }

    private observeNormalRecordedUseTerminal(
        reservationId: number,
        recordedId: number,
        recorder: IRecorderModel,
        recordedUse: ActiveRecordedUseSession['recordedUse'],
    ): void {
        const terminal = recorder.whenNormalRecordingTerminal?.();
        if (terminal === undefined) return;
        const expectation: ActiveRecordedUseExpectation = Object.freeze({ recorder, recordedUse });
        this.normalRecordedUseTerminals.set(recorder, recordedUse);
        void terminal.then(
            () => {
                if (this.normalRecordedUseTerminals.get(recorder) !== recordedUse) return;
                this.normalRecordedUseTerminals.delete(recorder);
                this.releaseRecordedUse(reservationId, recordedId, expectation);
            },
            error => {
                this.log.system.error(`normal recording terminal error: ${reservationId}`);
                this.log.system.error(error);
            },
        );
    }

    private isAwaitingNormalRecordedUseTerminal(reservationId: number, recordedId: unknown): boolean {
        if (!this.isRecordedUseId(recordedId)) return false;
        const active = this.findActiveRecordedUse(reservationId, recordedId);
        return active !== undefined && this.normalRecordedUseTerminals.get(active.recorder) === active.recordedUse;
    }

    private releaseRecordedUse(
        reservationId: number,
        recordedId: unknown,
        expected?: ActiveRecordedUseExpectation,
    ): void {
        if (this.isRecordedUseId(recordedId)) {
            const active = this.findActiveRecordedUse(reservationId, recordedId, expected);
            if (
                active !== undefined &&
                (expected === undefined ||
                    (active.recorder === expected.recorder && active.recordedUse === expected.recordedUse))
            ) {
                this.activeRecordedUseSessions.delete(active.recorder);
                if (this.normalRecordedUseTerminals.get(active.recorder) === active.recordedUse) {
                    this.normalRecordedUseTerminals.delete(active.recorder);
                }
                this.recordedUseProvider.releaseSessionUse(active.recorder, active.recordedUse);
                return;
            }
        }

        if (expected !== undefined) return;

        const unknown = this.unknownRecordedUseSessions.get(reservationId);
        if (unknown !== undefined) {
            this.unknownRecordedUseSessions.delete(reservationId);
            this.recordedUseProvider.releaseSessionUse(unknown);
        }
    }

    private releaseRecordedUsesForReservation(reservationId: number): void {
        for (const [recorder, active] of this.activeRecordedUseSessions) {
            if (active.reservationId !== reservationId) continue;
            this.activeRecordedUseSessions.delete(recorder);
            if (this.normalRecordedUseTerminals.get(recorder) === active.recordedUse) {
                this.normalRecordedUseTerminals.delete(recorder);
            }
            this.recordedUseProvider.releaseSessionUse(recorder, active.recordedUse);
        }
        const unknown = this.unknownRecordedUseSessions.get(reservationId);
        if (unknown !== undefined) {
            this.unknownRecordedUseSessions.delete(reservationId);
            this.recordedUseProvider.releaseSessionUse(unknown);
        }
    }

    private hasActiveRecordedUse(recorder: IRecorderModel): boolean {
        return this.activeRecordedUseSessions.has(recorder);
    }

    private findActiveRecordedUse(
        reservationId: number,
        recordedId: number,
        expected?: ActiveRecordedUseExpectation,
    ): ActiveRecordedUseSession | undefined {
        if (expected !== undefined) {
            const active = this.activeRecordedUseSessions.get(expected.recorder);
            return active?.recordedUse === expected.recordedUse ? active : undefined;
        }
        for (const active of this.activeRecordedUseSessions.values()) {
            if (active.reservationId === reservationId && active.recordedId === recordedId) return active;
        }
        return undefined;
    }

    private isRecordedUseId(value: unknown): value is number {
        return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    }

    private isCurrentRecordingFailure(failure: RecordingFailureSessionIdentity): boolean {
        const currentSession = this.scheduleController.getSessionSnapshot(failure.reservationId);
        const currentCandidate = this.candidateRegistry.get(failure.reservationId);
        return (
            currentSession?.generation === failure.generation &&
            currentSession.sessionToken === failure.sessionToken &&
            currentCandidate?.generation === failure.generation &&
            currentCandidate.reservation === failure.reservation
        );
    }

    private isValidRecordingFailure(
        reserve: Reserve,
        failedIdentity: RecordingFailureSessionIdentity | undefined,
    ): failedIdentity is RecordingFailureSessionIdentity {
        return (
            failedIdentity !== undefined &&
            failedIdentity.reservationId === reserve.id &&
            this.isCurrentRecordingFailure(failedIdentity)
        );
    }

    /**
     * 録画失敗イベントを処理する。同じ予約について既に削除処理中、起動未完了、二重イベント
     * （`recordingFailureClaims`で検知）のいずれかであれば何もしない。失敗が現在のsessionに
     * 対するものであることを確認したうえで、DB上の録画済み件数が3件未満かつ予約終了時刻を
     * まだ過ぎていなければ同じ予約を候補として再投入（リトライ）し、そうでなければリトライを
     * 諦めて`emitRecordingRetryOver`で通知する。
     * @param reserve 失敗した予約
     * @param failedIdentity 失敗イベント発行時点のsession識別情報（世代・token等）。
     *   `undefined`または現在のsessionと一致しない場合は既に無効な通知として無視する。
     */
    private async processRecordingFailure(
        reserve: Reserve,
        failedIdentity: RecordingFailureSessionIdentity | undefined,
    ): Promise<void> {
        if (this.deletionStops.has(reserve.id) || this.candidateStartupState !== 'Started') return;
        if (!this.isValidRecordingFailure(reserve, failedIdentity)) return;
        if (this.recordingFailureClaims.has(reserve.id)) return;
        this.recordingFailureClaims.add(reserve.id);
        this.deleteRecording(reserve.id);

        const recordeds = await this.recordedDB.findReserveId(reserve.id);
        if (!this.isCurrentRecordingFailure(failedIdentity)) return;

        if (recordeds.length < 3) {
            if (failedIdentity.reservation.endAt <= Date.now()) {
                this.log.system.error(`readd recording error: ${reserve.id}`);
                return;
            }

            this.log.system.info(`readd recording: ${reserve.id}`);
            this.scheduleController.acceptMutation({
                insert: [failedIdentity.reservation as Reserve],
                isSuppressLog: false,
            });
            await this.scheduleController.whenIdle();
            await this.sessionMutationTail;
            return;
        }

        this.log.system.error(`recording retry over: ${reserve.id}`);
        this.recordingEvent.emitRecordingRetryOver(reserve);
    }

    private async flushPendingStartupRecordingFailures(): Promise<void> {
        const failures = this.pendingStartupRecordingFailures.splice(0);
        for (const { reserve, failure } of failures) {
            try {
                await this.processRecordingFailure(reserve, failure);
            } catch (error: unknown) {
                this.log.system.error(error);
            }
        }
    }

    /**
     * 録画終了時に呼ばれる
     * @param reserveId: Reserve Id
     */
    private deleteRecording(reserveId: apid.ReserveId): void {
        if (this.deletionStops.has(reserveId)) return;
        this.log.system.debug(`delete recording index: ${reserveId}`);
        delete this.recordingIndex[reserveId];
        this.recordingSessionTokens.delete(reserveId);
    }

    /**
     * tuner 情報セット
     * @param tuners: TunerInfo[]
     */
    public setTuner(tuners: TunerInfo[]): void {
        this.streamCreator.setTuner(tuners);
    }

    /**
     * 起動時に録画中に停止してしまった録画情報を録画中から録画済みに移行させる
     * @return Promise<void>
     */
    public cleanup(): Promise<void> {
        return this.cleanupInterruptedRecordings().catch(async error => {
            await this.failCandidateStartup(error);
            throw error;
        });
    }

    private async cleanupInterruptedRecordings(): Promise<void> {
        this.log.system.info('start recordings cleanup ');

        // 録画中になっている番組を取り出す
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
            } catch (err: any) {
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

            // video file 処理
            if (typeof r.videoFiles !== 'undefined') {
                for (const videoFile of r.videoFiles) {
                    // recordedTmp が有効な場合は正規の場所に移動させる
                    if (videoFile.parentDirectoryName === 'tmp' && typeof this.config.recordedTmp !== 'undefined') {
                        await this.recordingUtil.movingFromTmp(reserve, videoFile.id).catch(err => {
                            this.log.system.fatal(`movingFromTmp error: ${videoFile.id}`);
                            this.log.system.fatal(err);
                        });
                    }

                    // update file size
                    await this.recordingUtil.updateVideoFileSize(videoFile.id).catch(err => {
                        this.log.system.error(`update file size error: ${videoFile.id}`);
                        this.log.system.error(err);
                    });
                }
            }

            // 終了処理
            const newRecorded = await this.recordedDB.findId(r.id);
            if (newRecorded !== null) {
                // 手動予約と番組リレー予約は、この通知で予約が取り消される。ルール予約は再計算されるだけで残る
                if (reserve.ruleId === null || reserve.isEventRelay === true) {
                    this.startupRemovedReservationIds.add(reserve.id);
                }
                this.recordingEvent.emitFinishRecording(reserve, newRecorded, true);
            }
        }

        this.log.system.info('finish recordings cleanup ');
    }

    /**
     * 起動シーケンスを開始する（DBから予約一覧を取得して候補を構築し、schedule controller を
     * 起動する）。重複呼び出しは新たに起動処理を走らせず、進行中/完了済みの Promise をそのまま
     * 返す。失敗時は`failCandidateStartup`で状態を`'Failed'`に落とし、起動中に生成しかけた
     * recorder を後始末する。
     * @returns 起動完了（または失敗）を表す Promise
     */
    public rebuildCandidatesAndStart(): Promise<void> {
        if (this.candidateStartupState !== 'NotStarted') return this.candidateStartupPromise!;

        this.candidateStartupState = 'Starting';
        this.candidateStartupPromise = this.rebuildCandidatesAndStartInternal().catch(async error => {
            await this.failCandidateStartup(error);
            throw error;
        });
        return this.candidateStartupPromise;
    }

    /**
     * 起動シーケンス失敗時の後始末。起動中（`'Starting'`）に生成されていた recorder を
     * `recordingIndex`/`candidateRegistry`から取り除いたうえで `cancel(false)` させ、
     * 退避していた起動前mutation・失敗イベントは破棄する（起動が失敗した以上、それらを
     * 適用する前提の状態が無いため）。
     * @param error 起動処理を失敗させた元の Error
     */
    private async failCandidateStartup(error: unknown): Promise<void> {
        const wasStarting = this.candidateStartupState === 'Starting';
        this.candidateStartupState = 'Failed';
        this.scheduleStarted = false;
        this.pendingStartupMutations.splice(0);
        this.pendingStartupRecordingFailures.splice(0);

        const startupRecorders = new Set<IRecorderModel>();
        if (wasStarting) {
            const startupReservationIds = new Set([
                ...this.candidateRegistry.list().map(candidate => candidate.reservationId),
                ...Object.keys(this.recordingIndex).map(Number),
            ]);
            for (const reservationId of startupReservationIds) {
                const recorder = this.recordingIndex[reservationId];
                if (recorder !== undefined) startupRecorders.add(recorder);
                delete this.recordingIndex[reservationId];
                this.recordingSessionTokens.delete(reservationId);
                this.recordingFailureClaims.delete(reservationId);
                this.candidateRegistry.remove(reservationId);
            }
        }
        this.scheduleController.stop();
        await Promise.all(
            [...startupRecorders].map(recorder =>
                recorder.cancel(false).catch(cancelError => {
                    this.log.system.error('recording startup cleanup error');
                    this.log.system.error(cancelError);
                }),
            ),
        );
        if (this.candidateStartupPromise === undefined) {
            this.candidateStartupPromise = Promise.reject(error);
            void this.candidateStartupPromise.catch(() => undefined);
        }
    }

    private async rebuildCandidatesAndStartInternal(): Promise<void> {
        const reservations = await this.reserveDB.findLists();
        const candidates = reservations.filter(
            reservation =>
                reservation.isSkip === false &&
                reservation.isOverlap === false &&
                reservation.endAt > Date.now() &&
                !this.startupRemovedReservationIds.has(reservation.id),
        );

        this.candidateRegistry.rebuild(candidates);
        this.scheduleController.acceptMutation({ insert: candidates, isSuppressLog: true });
        this.flushPendingStartupMutations();
        await this.scheduleController.start();
        this.scheduleStarted = true;
        this.flushPendingStartupMutations();
        this.candidateStartupState = 'Started';
        await this.flushPendingStartupRecordingFailures();
    }

    private flushPendingStartupMutations(): void {
        for (const mutation of this.pendingStartupMutations.splice(0)) {
            this.scheduleController.acceptMutation(mutation);
        }
    }

    /**
     * 予約差分の受付
     * @param diff: IReserveUpdateValues
     */
    public acceptMutation(diff: IReserveUpdateValues): void {
        if (this.candidateStartupState === 'Failed') return;
        if (this.candidateStartupState !== 'Started') {
            const snapshot = this.snapshotStartupMutation(diff);
            if (snapshot === null) {
                this.scheduleController.acceptMutation(diff);
                return;
            }
            this.pendingStartupMutations.push(snapshot);
            return;
        }
        this.ensureScheduleStarted();
        this.scheduleController.acceptMutation(diff);
    }

    /**
     * 予約情報の更新
     * @param diff: IReserveUpdateValues
     */
    public async update(diff: IReserveUpdateValues): Promise<void> {
        this.acceptMutation(diff);
        if (this.candidateStartupState !== 'Started') return;
        await this.scheduleController.whenIdle();
        await this.sessionMutationTail;
    }

    private snapshotStartupMutation(diff: IReserveUpdateValues): IReserveUpdateValues | null {
        try {
            if (typeof diff.isSuppressLog !== 'boolean') return null;
            return {
                insert: this.snapshotStartupMutationRows(diff.insert),
                update: this.snapshotStartupMutationRows(diff.update),
                delete: this.snapshotStartupMutationRows(diff.delete),
                isSuppressLog: diff.isSuppressLog,
            };
        } catch {
            return null;
        }
    }

    private snapshotStartupMutationRows(reservations: Reserve[] | undefined): Reserve[] | undefined {
        if (reservations === undefined) return undefined;
        if (!Array.isArray(reservations)) throw new TypeError();
        return reservations.map(reservation => {
            if (typeof reservation !== 'object' || typeof reservation.id !== 'number') {
                throw new TypeError();
            }
            return { ...reservation } as Reserve;
        });
    }

    private ensureScheduleStarted(): void {
        if (this.candidateStartupState !== 'Started' || this.scheduleStarted) return;
        this.scheduleStarted = true;
        void this.scheduleController.start().catch(err => {
            this.log.system.error('recording schedule start error');
            this.log.system.error(err);
        });
    }

    /**
     * `operation`を`sessionMutationTail`の末尾に繋いで直列実行する。`scheduleController`からの
     * `dispatchMutation`はこれを経由するため、複数のmutationが同時に来ても発生順に1つずつ
     * 処理される。1つの操作が失敗しても後続を止めないよう、chain自体は必ず成功に丸める。
     * @param operation 直列実行したい処理
     * @returns この操作自体の完了を表す Promise（失敗時はreject、chain継続には影響しない）
     */
    private queueSessionOperation(operation: () => void | Promise<void>): Promise<void> {
        const result = this.sessionMutationTail.then(operation);
        this.sessionMutationTail = result.catch(() => undefined);
        return result;
    }

    /**
     * 呼び出し時点までに積まれている全ての session 操作が完了した後に`operation`を実行する。
     * `dispatchPreparation`/`dispatchTimeSpecifiedEnd`で使う。timer発火時点のsessionが
     * その時点で進行中のmutation処理より古くならないようにする。
     * @param operation session操作が全て終わった後に実行する処理
     */
    private afterSessionMutations(operation: () => void): Promise<void> {
        const prerequisite = this.sessionMutationTail;
        return prerequisite.then(operation);
    }

    private launchSessionLifetime(operation: () => void | Promise<void> | undefined, message: string): void {
        try {
            void Promise.resolve(operation()).catch(err => {
                this.log.system.error(message);
                this.log.system.error(err);
            });
        } catch (err: unknown) {
            this.log.system.error(message);
            this.log.system.error(err);
        }
    }

    /**
     * `scheduleController`からのmutation通知1件を実際の`IRecorderModel`へ反映する
     * （新規なら生成、既存なら`update`、削除なら`applyScheduleRemoval`）。反映前に、対象の
     * session（世代・token）が`mutation`発行時点からまだ有効か（`current.sessionToken`一致等）を
     * 都度確認し、既に古くなっていれば何もしない。
     * @param mutation 反映する予約変更内容
     */
    private async applyScheduleMutation(mutation: RecordingScheduleMutationDispatch): Promise<void> {
        const deletionStop = this.deletionStops.get(mutation.reservationId);
        if (deletionStop !== undefined && deletionStop.recorder === this.recordingIndex[mutation.reservationId]) {
            return;
        }

        if (mutation.action === 'remove') {
            await this.applyScheduleRemoval(mutation);
            return;
        }

        const current = this.scheduleController.getSessionSnapshot(mutation.reservationId);
        const candidate = this.candidateRegistry.get(mutation.reservationId);
        if (current === undefined || candidate === undefined || mutation.sessionToken !== current.sessionToken) {
            return;
        }

        let recorder = this.recordingIndex[mutation.reservationId];
        const indexedToken = this.recordingSessionTokens.get(mutation.reservationId);
        if (recorder !== undefined && indexedToken !== undefined && indexedToken !== current.sessionToken) return;

        if (recorder === undefined) {
            recorder = await this.provider();
            const afterProvider = this.scheduleController.getSessionSnapshot(mutation.reservationId);
            if (
                afterProvider?.generation !== current.generation ||
                afterProvider.sessionToken !== current.sessionToken
            ) {
                return;
            }
            this.bindRecorder(recorder, afterProvider);
            if (recorder.setTimer(candidate.reservation as Reserve, mutation.isSuppressLog) !== true) {
                this.scheduleController.tryTransitionSession(
                    candidate.reservationId,
                    afterProvider.generation,
                    afterProvider.sessionToken,
                    afterProvider.phase,
                    'Completed',
                );
                this.log.system.error(`add recording error: ${candidate.reservationId}`);
                return;
            }
            this.log.system.debug(`add recording: ${candidate.reservationId}`);
            this.recordingIndex[candidate.reservationId] = recorder;
            this.recordingSessionTokens.set(candidate.reservationId, afterProvider.sessionToken);
            return;
        }

        this.bindRecorder(recorder, current);
        if (candidate.kind === 'TimeSpecified') {
            this.scheduleController.registerTimeSpecifiedEnd({
                reservationId: candidate.reservationId,
                generation: current.generation,
                sessionToken: current.sessionToken,
                dueAt: candidate.endAt + (this.config.timeSpecifiedEndMargin ?? 0) * 1_000,
            });
        }
        this.log.system.debug(`update recording: ${candidate.reservationId}`);
        await recorder.update(candidate.reservation as Reserve, mutation.isSuppressLog).catch(err => {
            this.log.system.error(`update recording error: ${candidate.reservationId}`);
            this.log.system.error(err);
        });
    }

    /**
     * 予約が候補から外れた（削除・isSkip/isOverlapへの変更）際の反映。skip/overlapへの変更は
     * 録画を止めずに`recorder.update`で状態だけ反映し、それ以外（本当の削除）は
     * `recorder.cancel(false)`で録画自体を止める。
     * @param mutation 削除方向のmutation内容
     */
    private async applyScheduleRemoval(mutation: RecordingScheduleMutationDispatch): Promise<void> {
        const recorder = this.recordingIndex[mutation.reservationId];
        if (recorder === undefined) return;
        const indexedToken = this.recordingSessionTokens.get(mutation.reservationId);
        if (
            indexedToken !== undefined &&
            mutation.previousSessionToken !== undefined &&
            indexedToken !== mutation.previousSessionToken
        ) {
            return;
        }

        this.deleteRecording(mutation.reservationId);
        if (mutation.reservation.isSkip === true || mutation.reservation.isOverlap === true) {
            await recorder.update(mutation.reservation as Reserve, mutation.isSuppressLog).catch(err => {
                this.log.system.error(`update recording error: ${mutation.reservationId}`);
                this.log.system.error(err);
            });
            return;
        }

        this.log.system.debug(`delete recording: ${mutation.reservationId}`);
        await recorder.cancel(false).catch(err => {
            this.log.system.error(`delete recording error: ${mutation.reservationId}`);
            this.log.system.error(err);
        });
    }

    /**
     * `recorder`へ、呼び出し時点のsession情報（世代・token・phase）を閉じ込めた操作窓口
     * （`RecordingScheduleSessionBinding`）を渡す。recorder側はこの窓口を通じてのみ
     * `scheduleController`の状態を確認・変更でき、`isCurrent`/`tryTransition`等はいずれも
     * 「渡された時点のsessionがまだ現在のものか」を内部で確認するため、recorder側が
     * 非同期処理の完了後に古いsessionに対して誤って作用することを防ぐ。
     * @param recorder 窓口を渡す対象
     * @param session 渡す時点で有効なsessionのsnapshot
     */
    private bindRecorder(recorder: IRecorderModel, session: RecordingSessionSnapshot): void {
        const candidate = this.candidateRegistry.get(session.reservationId);
        if (candidate === undefined) return;
        const binding: RecordingScheduleSessionBinding = Object.freeze({
            ...session,
            reservation: candidate.reservation,
            isCurrent: (expectedPhase: RecordingPhase) => {
                const current = this.scheduleController.getSessionSnapshot(session.reservationId);
                return (
                    current?.generation === session.generation &&
                    current.sessionToken === session.sessionToken &&
                    current.phase === expectedPhase
                );
            },
            requeueAfterReschedule: () => {
                const requeued = this.scheduleController.tryTransitionSession(
                    session.reservationId,
                    session.generation,
                    session.sessionToken,
                    'Cancelled',
                    'Waiting',
                );
                if (requeued) this.scheduleController.wake();
                return requeued;
            },
            tryTransition: (expectedPhase: RecordingPhase, nextPhase: RecordingPhase) =>
                this.scheduleController.tryTransitionSession(
                    session.reservationId,
                    session.generation,
                    session.sessionToken,
                    expectedPhase,
                    nextPhase,
                ),
            registerTimeSpecifiedEnd: (dueAt: number) =>
                this.scheduleController.registerTimeSpecifiedEnd({
                    reservationId: session.reservationId,
                    generation: session.generation,
                    sessionToken: session.sessionToken,
                    dueAt,
                }),
            removeTimeSpecifiedEnd: () =>
                this.scheduleController.removeTimeSpecifiedEnd(
                    session.reservationId,
                    session.generation,
                    session.sessionToken,
                ),
        });
        recorder.bindScheduleSession?.(binding);
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
        const recording = this.recordingIndex[reserveId];
        if (typeof recording === 'undefined') {
            // 存在しないのでスルー
            return;
        }

        this.log.system.info(`cancel recording reserveId: ${reserveId}, isPlanToDelete: ${isPlanToDelete}`);
        const activeDeletionStop = this.deletionStops.get(reserveId);
        if (activeDeletionStop?.recorder === recording) return activeDeletionStop.request;

        if (isPlanToDelete) {
            const request = recording.cancel(true);
            const terminal = recording.whenDeletionTerminal?.() ?? request;
            const deletionStop = { recorder: recording, request, terminal };
            this.deletionStops.set(reserveId, deletionStop);
            void terminal.then(
                () => {
                    if (this.deletionStops.get(reserveId) !== deletionStop) return;
                    this.deletionStops.delete(reserveId);
                    this.releaseRecordedUsesForReservation(reserveId);
                    this.deleteRecording(reserveId);
                },
                err => {
                    this.log.system.error(`recording deletion terminal error: ${reserveId}`);
                    this.log.system.error(err);
                },
            );
            return request;
        }

        this.deleteRecording(reserveId);
        return recording.cancel(isPlanToDelete);
    }

    /**
     * `cancel(reserveId, true)`を呼び出し、そのキャンセル要求だけでなく、対応する
     * 削除terminal（`whenDeletionTerminal`。無ければ`cancel`のPromiseと同じ）まで待つ。
     * 録画ファイル削除の後始末が完全に終わるまで待ちたい呼び出し元向け。
     * @param reserveId キャンセルする予約id
     */
    public async cancelForDeletion(reserveId: apid.ReserveId): Promise<void> {
        const request = this.cancel(reserveId, true);
        const deletionStop = this.deletionStops.get(reserveId);
        await request;
        await deletionStop?.terminal;
    }

    /**
     * タイマーを再設定する
     */
    public resetTimer(): void {
        if (this.candidateStartupState !== 'Started') return;
        this.log.system.info('reset timer');

        this.ensureScheduleStarted();
        this.scheduleController.requestReset();

        for (const key in this.recordingIndex) {
            this.recordingIndex[key].resetTimer();
        }
    }
}

export default RecordingManageModel;
declare const __EPGSTATION_COVERAGE_EXCLUSION_RECORDING_MANAGE_RELEASE_USE_TERMINAL_20260924: unique symbol;
