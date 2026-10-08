import * as events from 'events';
import * as fs from 'fs';
import * as http from 'http';
import { inject, injectable } from 'inversify';
import * as net from 'net';
import * as path from 'path';
import * as stream from 'stream';
import type * as apid from '../../../../api.js';
import DropLogFile from '../../../db/entities/DropLogFile.js';
import Recorded from '../../../db/entities/Recorded.js';
import RecordedHistory from '../../../db/entities/RecordedHistory.js';
import Reserve from '../../../db/entities/Reserve.js';
import VideoFile from '../../../db/entities/VideoFile.js';
import FileUtil from '../../../util/FileUtil.js';
import StrUtil from '../../../util/StrUtil.js';
import IDropLogFileDB from '../../db/IDropLogFileDB.js';
import IProgramDB from '../../db/IProgramDB.js';
import IRecordedDB from '../../db/IRecordedDB.js';
import IRecordedHistoryDB from '../../db/IRecordedHistoryDB.js';
import IReserveDB from '../../db/IReserveDB.js';
import IVideoFileDB from '../../db/IVideoFileDB.js';
import IRecordingEvent from '../../event/IRecordingEvent.js';
import IConfigFile from '../../IConfigFile.js';
import IConfiguration from '../../IConfiguration.js';
import ILogger from '../../ILogger.js';
import ILoggerModel from '../../ILoggerModel.js';
import { TunerProgram, TunerServerAccess } from '../../tuner/types.js';
import IDropCheckerModel from './IDropCheckerModel.js';
import IRecorderModel, { RecordingScheduleSessionBinding } from './IRecorderModel.js';
import IRecordingStreamCreator from './IRecordingStreamCreator.js';
import IRecordingUtilModel, { RecFilePathInfo } from './IRecordingUtilModel.js';
import RecordingRecordedUseProvider, { RecordingSessionRecordedUse } from './RecordingRecordedUseProvider.js';
import { isPathSelectionOverdueError, PathSelectionOverdueError } from './RecordingUtilModel.js';

/** `stopForDeletion`が発行する後始末待ち（`DeletionTerminalLatch.terminal`）に許容する
 *  最大時間。超過すると`boundDeletionStop`が`DeletionStopTimeoutError`で reject する。 */
const DELETION_STOP_TIMEOUT_MS = 60_000;
/** DB登録（`addRecorded`）が完了しないまま`'Registering'`/`'RegistrationOverdue'`に
 *  留まり続けることを検知するための待ち時間。 */
const REGISTRATION_OWNER_WATCHDOG_TIMEOUT_MS = 600_000;

/** DB登録処理（`addRecorded`）が完了した後、その登録に対して何をすべきかを表す。
 *  `'None'`は「そのまま録画を続ける」、`'Cancel'`/`'Replacement'`/`'Deletion'`は登録完了後に
 *  取り消し・後始末が必要なことを示す。複数の要求が競合した場合は
 *  `registrationTerminationIntentPriority`の優先順位で最も強いものが残る。 */
type RegistrationTerminationIntent = 'None' | 'Cancel' | 'Replacement' | 'Deletion';

/**
 * DB登録（`addRecorded`）が進行中のスケジュールsession 1件分の識別子と、その登録が完了した
 * 時点で適用すべき終了意図。DB書き込み自体は途中で中断できないため、登録中に届いた
 * cancel/replacement/deletion要求はいったんこの`intent`に記録しておき、登録完了時に
 * まとめて反映する（`registrationOwners`に集約される）。
 */
interface RegistrationOwner {
    readonly reservationId: RecordingScheduleSessionBinding['reservationId'];
    readonly generation: RecordingScheduleSessionBinding['generation'];
    readonly sessionToken: RecordingScheduleSessionBinding['sessionToken'];
    intent: RegistrationTerminationIntent;
}

/** `RegistrationTerminationIntent`の強さの順序。複数の終了要求が同じ登録に対して競合した
 *  場合、`promoteRegistrationTerminationIntent`はこの順位でより強い方だけを採用する
 *  （一度`Deletion`になったら`Cancel`には戻さない、等）。 */
const registrationTerminationIntentPriority: Readonly<Record<RegistrationTerminationIntent, number>> = {
    None: 0,
    Cancel: 1,
    Replacement: 2,
    Deletion: 3,
};

/**
 * `stopForDeletion`が起こす複数の非同期後始末処理（準備中断待ち・finalize待ち等）が
 * 全て終わったことを表す`terminal`を提供する、手動カウント式のwait group。初期カウントは
 * 1（`stopForDeletion`が全ての`observe`呼び出しを終えるまでの間の分）で、各`observe`が
 * 対象のPromise解決/棄却を待って1減らし、最後に`stopForDeletion`が`release()`で
 * 初期分を減らす。カウントが0になった時点で`terminal`が解決する。
 */
class DeletionTerminalLatch {
    private pending = 1;
    private readonly resolveTerminal: () => void;
    public readonly terminal: Promise<void>;

    constructor() {
        let resolveTerminal!: () => void;
        this.terminal = new Promise<void>(resolve => {
            resolveTerminal = resolve;
        });
        this.resolveTerminal = resolveTerminal;
    }

    /** `operation`の完了（成功/失敗いずれも）を待つべき後始末として登録する。 */
    public observe(operation: Promise<unknown>): void {
        this.pending += 1;
        void operation.then(
            () => this.release(),
            () => this.release(),
        );
    }

    /** 1件分の完了を通知する。カウントが0になった時点で`terminal`を解決する。 */
    public release(): void {
        this.pending -= 1;
        if (this.pending === 0) this.resolveTerminal();
    }
}

/** `stopForDeletion`が進行中であることを示す状態。`bounded`はタイムアウト付きで外部へ返す
 *  Promise、`terminal`は実際の後始末完了、`latch`はその完了を集計する
 *  `DeletionTerminalLatch`本体。 */
interface DeletionStopState {
    readonly bounded: Promise<void>;
    readonly latch: DeletionTerminalLatch;
    readonly terminal: Promise<void>;
}

/** DB登録は完了したがまだ最終確定（録画終了・cleanup）していない録画のリソース一式。
 *  登録直後にcancel/deletion/replacementが起きた場合、`cleanupPendingRegistration`が
 *  これを使って中途半端な`Recorded`行・ファイルを後始末する。 */
interface PendingRegistrationResources {
    cleanupLifetime: Promise<void> | null;
    dropLogFileId: apid.DropLogFileId | null;
    readonly filePath: string;
    recordedId: apid.RecordedId | null;
    videoFileId: apid.VideoFileId | null;
}

/**
 * `IRecorderModel`の実装。予約1件（`reserve`）につきこの class を1つ生成して使う、録画の
 * 準備開始からファイル確定までの全ライフサイクルを担う中心 class。`RecordingManageModel`が
 * `bindScheduleSession`で渡す`RecordingScheduleSessionBinding`（現在有効なsessionの
 * 世代・token・phaseと、phase遷移を行うための窓口）を通じてのみ`scheduleController`側の
 * 状態を確認・変更する。DB登録（チューナー確保・番組情報登録）はいったん開始すると
 * 直接中断できないため、登録処理の完了前に届いたcancel/replacement/deletion要求は
 * `registrationOwners`に意図として記録しておき、登録完了時にまとめて反映する。
 * 削除予定のキャンセル（`stopForDeletion`）は、進行中の複数の非同期後始末を
 * `DeletionTerminalLatch`で集約し、全て完了してから呼び出し元へ返す。
 */
@injectable()
class RecorderModel implements IRecorderModel {
    private log: ILogger;
    private config: IConfigFile;
    private programDB: IProgramDB;
    private reserveDB: IReserveDB;
    private recordedDB: IRecordedDB;
    private recordedHistoryDB: IRecordedHistoryDB;
    private videoFileDB: IVideoFileDB;
    private dropLogFileDB: IDropLogFileDB;
    private streamCreator: IRecordingStreamCreator;
    private dropChecker: IDropCheckerModel;
    private recordingUtil: IRecordingUtilModel;
    private recordingEvent: IRecordingEvent;
    private recordedUseProvider: RecordingRecordedUseProvider;
    private tunerServerAccess: TunerServerAccess;

    /** この Recorder が担当する予約情報。`setTimer`で設定され、`update`で更新される。 */
    private reserve!: Reserve;
    /** DB登録済みの`Recorded`行のid（未登録なら`null`）。 */
    private recordedId: apid.RecordedId | null = null;
    /** DB登録済みの`VideoFile`行のid（未登録なら`null`）。 */
    private videoFileId: apid.VideoFileId | null = null;
    /** 録画中の実ファイルの絶対パス（未確定なら`null`）。 */
    private videoFileFulPath: string | null = null;
    /** 準備開始タイマーのid（`setTimer`でセット、実行/キャンセル時に`null`へ戻す）。 */
    private timerId: NodeJS.Timeout | null = null;
    /** チューナーから取得中のTSストリーム（未取得/終了後は`null`）。 */
    private stream: http.IncomingMessage | null = null;
    /** 録画ファイルへの書き込みstream（未開始/終了後は`null`）。 */
    private recFile: fs.WriteStream | null = null;
    /** 録画準備中のキャンセル要求フラグ。準備処理の各段階でこれを確認して中断する。 */
    private isStopPrepRec: boolean = false;
    /** `true`の間は、録画終了時に予約自体の削除（`ReserveDB`からの削除）を要求する
     *  （キャンセル等で不要になった場合に`false`へ倒す）。 */
    private isNeedDeleteReservation: boolean = true;
    /** 現在「録画準備中」フェーズか。 */
    private isPrepRecording: boolean = false;
    /** 現在「録画中（データ受信中）」フェーズか。 */
    private isRecording: boolean = false;
    /** この録画が削除される予定か（`stopForDeletion`経由のキャンセルで`true`になる）。 */
    private isPlanToDelete: boolean = false;
    private isCanceledCallingFinished: boolean = false; // mirakurun の stream の終了検知をキャンセルするか
    /** `CANCEL_EVENT`等、この class 内部だけで完結する通知に使う event emitter。 */
    private eventEmitter = new events.EventEmitter();
    /** `RecordingManageModel`から`bindScheduleSession`で渡された、現在有効なsessionの
     *  窓口。未バインドなら`null`。 */
    private scheduleBinding: RecordingScheduleSessionBinding | null = null;
    /** 録画データの最初の1バイトを待つ処理のキャンセル窓口（待機中でなければ`null`）。 */
    private firstDataWait: { cancel(): void } | null = null;
    /** リトライ待ち（`RetryWaiting`）のタイマーid。 */
    private retryTimerId: NodeJS.Timeout | null = null;
    /** 現在待機中のリトライの試行回数（待機中でなければ`null`）。 */
    private retryAttempt: number | null = null;
    /** `invalidateRetry`のたびに増分される世代カウンタ。リトライタイマー発火時、
     *  発行時点からこの値が変わっていれば（別の理由で無効化された）発火を無視する。 */
    private retryLifecycleToken = 0n;
    /** 準備の失敗を1回ごとに運用logへ記録するattemptの数（attempt 0〜3）。 */
    private static readonly PREP_FAILURE_LOG_INDIVIDUAL_ATTEMPTS = 4;
    /** attempt 4以降の失敗をまとめて運用logへ記録する間隔（ms）。 */
    private static readonly PREP_FAILURE_LOG_INTERVAL_MS = 60_000;
    /** 番組指定予約が準備の再試行を続けている間、まだ運用logへ書いていない失敗の集計。
     *  attempt 4以降の失敗だけが対象で、開始時や録画開始・準備失敗の通知後は`null`。 */
    private prepFailureLog: {
        lastError: unknown;
        lastLoggedAt: number;
        pendingFailures: number;
        totalFailures: number;
    } | null = null;
    /** 現在進行中の準備処理（`runPreparation`）本体。進行中でなければ`null`。 */
    private preparationLifetime: Promise<void> | null = null;
    /** `stopForDeletion`実行中の状態（進行中でなければ`null`）。重複呼び出しは
     *  この状態の`bounded`へ合流する。 */
    private deletionStop: DeletionStopState | null = null;
    /** ドロップチェッカー（`dropChecker`）が現在稼働中か。 */
    private isDropCheckerActive = false;
    /** ドロップチェッカー停止処理が進行中ならその Promise（未実行なら`null`）。重複停止要求を
     *  同じ Promise へ合流させる。 */
    private dropCheckerStopLifetime: Promise<void> | null = null;
    /** 録画終了時の最終処理（`finalizeRecording`）が進行中ならその Promise（未実行なら`null`）。 */
    private finalizationLifetime: Promise<void> | null = null;
    /** `finalizeRecording`から派生した、まだ完了していない付随処理の集合。削除待ち
     *  （`awaitFinalizationContinuations`）がこれらの完了も合わせて待つ。 */
    private readonly finalizationContinuations = new Set<Promise<unknown>>();
    private resolveNormalRecordingTerminal!: () => void;
    /** 「異常終了ではない、通常の録画終了」を外部（`whenNormalRecordingTerminal`）へ
     *  通知するための Promise。`settleNormalRecordingTerminal`で一度だけ解決される。 */
    private readonly normalRecordingTerminal = new Promise<void>(resolve => {
        this.resolveNormalRecordingTerminal = resolve;
    });
    /** 現在「使用中」として`recordedUseProvider`に登録している録画済みファイルの状態
     *  （未登録なら`null`）。 */
    private activeRecordedUse: Extract<RecordingSessionRecordedUse, { readonly status: 'active' }> | null = null;
    /** 通常終了待ちに付随する後始末処理の Promise（進行中でなければ`null`）。 */
    private normalRecordingTerminalLifetime: Promise<void> | null = null;
    /** 直近に`destroyStream()`が実際に終了させたrecFile（書き込みwriter）の'close'待ち
     *  Promise。`observeWriterTermination`は対象writerが`null`でない呼び出しの分だけこれを
     *  更新し、`null`の呼び出し（recFileが既に終了済みで所有権が無い等）では上書きしない。
     *  `finalizeRecording`はファイルサイズ更新の開始をこれの完了後まで遅らせることで、
     *  writer側のバッファが確実にディスクへ渡ってから`stat()`でサイズを読む（未設定なら
     *  `null`。この遅延はfinalizeRecording自身の完了は止めない）。 */
    private recFileCloseTerminal: Promise<void> | null = null;
    /** DB登録は完了したがまだ最終確定していない録画のリソース一式（無ければ`null`）。 */
    private pendingRegistrationResources: PendingRegistrationResources | null = null;
    /** 現在DB登録処理中のsessionの終了意図を保持する集合。詳細は`RegistrationOwner`を参照。 */
    private readonly registrationOwners = new Set<RegistrationOwner>();

    /** ドロップログファイルのid（未作成なら`null`）。 */
    private dropLogFileId: apid.DropLogFileId | null = null;

    /** チューナーからのストリーム取得要求を中断するための controller（要求中でなければ`null`）。 */
    private abortController: AbortController | null = null;

    // イベントリレータイマー
    private eventRelayTimerId: NodeJS.Timeout | null = null;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IProgramDB') programDB: IProgramDB,
        @inject('IReserveDB') reserveDB: IReserveDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IRecordedHistoryDB') recordedHistoryDB: IRecordedHistoryDB,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IDropLogFileDB') dropLogFileDB: IDropLogFileDB,
        @inject('IRecordingStreamCreator')
        streamCreator: IRecordingStreamCreator,
        @inject('IDropCheckerModel') dropChecker: IDropCheckerModel,
        @inject('IRecordingUtilModel') recordingUtil: IRecordingUtilModel,
        @inject('IRecordingEvent') recordingEvent: IRecordingEvent,
        @inject('TunerServerAccess') tunerServerAccess: TunerServerAccess,
        @inject('RecordingRecordedUseProvider')
        recordedUseProvider: RecordingRecordedUseProvider = new RecordingRecordedUseProvider(),
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.programDB = programDB;
        this.reserveDB = reserveDB;
        this.recordedDB = recordedDB;
        this.recordedHistoryDB = recordedHistoryDB;
        this.videoFileDB = videoFileDB;
        this.dropLogFileDB = dropLogFileDB;
        this.streamCreator = streamCreator;
        this.dropChecker = dropChecker;
        this.recordingUtil = recordingUtil;
        this.recordingEvent = recordingEvent;
        this.recordedUseProvider = recordedUseProvider;
        this.tunerServerAccess = tunerServerAccess;
    }

    /**
     * `RecordingManageModel`から、現在有効なsessionの窓口を受け取る（session内でphaseだけが
     * 進む場合にも呼ばれる）。以前の窓口から別のsession（reservationId/generation/token）へ
     * 切り替わる場合、旧sessionでDB登録処理中だった`registrationOwner`があれば
     * `'Replacement'`の終了意図を記録する。また、旧sessionが`RetryWaiting`で
     * リトライ待ちだった場合、その待機（試行回数含む）を新しいsessionへ引き継ぐ。
     * @param binding 新しく有効になったsessionの窓口
     */
    public bindScheduleSession(binding: RecordingScheduleSessionBinding): void {
        const previous = this.scheduleBinding;
        const bindingChanged = previous !== null && !this.isSameScheduleSessionBinding(previous, binding);
        if (previous !== null && bindingChanged) {
            for (const owner of this.registrationOwners) {
                if (this.matchesRegistrationOwner(owner, previous)) {
                    this.promoteRegistrationTerminationIntent(owner, 'Replacement');
                }
            }
        }
        const retryAttempt =
            previous !== null &&
            previous.generation !== binding.generation &&
            previous.sessionToken === binding.sessionToken &&
            binding.phase === 'RetryWaiting' &&
            this.retryTimerId !== null
                ? this.retryAttempt
                : null;
        const invalidatesRetry =
            bindingChanged ||
            binding.phase === 'Finishing' ||
            binding.phase === 'Completed' ||
            binding.phase === 'Cancelled';
        if (invalidatesRetry) this.invalidateRetry();
        this.scheduleBinding = binding;
        if (this.timerId !== null) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
        if (retryAttempt !== null) this.scheduleRetry(retryAttempt, binding, 'RetryWaiting');
    }

    /**
     * `owner`の終了意図を`intent`へ更新する。既に、より強い意図（`registrationTerminationIntentPriority`
     * の優先順位でより高い）が設定済みの場合は上書きしない（一度`Deletion`になったら
     * `Cancel`で弱められない、等）。
     * @param owner 更新対象
     * @param intent 新たに適用したい意図
     */
    private promoteRegistrationTerminationIntent(
        owner: RegistrationOwner,
        intent: Exclude<RegistrationTerminationIntent, 'None'>,
    ): void {
        if (registrationTerminationIntentPriority[intent] <= registrationTerminationIntentPriority[owner.intent])
            return;
        owner.intent = intent;
    }

    /**
     * 現在のsessionに対応する`registrationOwner`（DB登録が進行中であれば）に終了意図を記録する。
     * `_cancel`/`stopForDeletion`/`finishAtTimeSpecifiedEnd`から、DB登録の完了を待たずに
     * 呼ばれる（登録処理自体は`intent`を見て完了後に自分で後始末する）。
     * @param intent 記録したい終了意図
     */
    private recordRegistrationTerminationIntent(intent: Exclude<RegistrationTerminationIntent, 'None'>): void {
        const current = this.scheduleBinding;
        if (current === null) return;
        for (const owner of this.registrationOwners) {
            if (this.matchesRegistrationOwner(owner, current)) {
                this.promoteRegistrationTerminationIntent(owner, intent);
            }
        }
    }

    /** `binding`に対応するDB登録が現在進行中か（進行中の登録処理が自分で後始末を
     *  行うため、呼び出し元はここが`true`の間は自分でphase遷移をしない）。 */
    private hasRegistrationOwner(binding: RecordingScheduleSessionBinding | null): boolean {
        return (
            binding !== null &&
            [...this.registrationOwners].some(owner => this.matchesRegistrationOwner(owner, binding))
        );
    }

    private isSameScheduleSessionBinding(
        left: RecordingScheduleSessionBinding,
        right: RecordingScheduleSessionBinding,
    ): boolean {
        return (
            left.reservationId === right.reservationId &&
            left.generation === right.generation &&
            left.sessionToken === right.sessionToken
        );
    }

    private matchesRegistrationOwner(
        owner: RegistrationOwner,
        binding: RecordingScheduleSessionBinding | null,
    ): boolean {
        if (binding === null) return false;
        return (
            owner.reservationId === binding.reservationId &&
            owner.generation === binding.generation &&
            owner.sessionToken === binding.sessionToken
        );
    }

    public startPreparation(): Promise<void> {
        return this.runPreparation(0, this.scheduleBinding);
    }

    /**
     * タイマーをセットする
     * @param reserve: Reserve 予約情報
     * @param isSuppressLog: boolean ログ出力を抑えるか
     * @return boolean セットに成功したら true を返す
     */
    public setTimer(reserve: Reserve, isSuppressLog: boolean): boolean {
        this.reserve = reserve;

        // 除外, 重複しているものはタイマーをセットしない
        if (this.reserve.isSkip === true || this.reserve.isOverlap === true) {
            return false;
        }

        const now = new Date().getTime();
        if (now >= this.reserve.endAt) {
            return false;
        }

        if (this.scheduleBinding !== null) {
            if (this.timerId !== null) {
                clearTimeout(this.timerId);
                this.timerId = null;
            }
            if (isSuppressLog === false) {
                this.log.system.info(`set central schedule: ${this.reserve.id}`);
            }
            return true;
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

        if (isSuppressLog === false) {
            this.log.system.info(`set timer: ${this.reserve.id}, ${time}`);
        }
        this.timerId = setTimeout(async () => {
            try {
                await this.runPreparation();
            } catch (err: any) {
                this.log.system.error(`failed prep record: ${this.reserve.id}`);
            }
        }, time);

        return true;
    }

    /**
     * 録画準備
     */
    private async prepRecord(
        retry: number = 0,
        scheduledSession: RecordingScheduleSessionBinding | null = this.scheduleBinding,
    ): Promise<void> {
        const expectedSessionToken = scheduledSession?.sessionToken;
        if (scheduledSession !== null && !this.isCurrentScheduleBinding(scheduledSession, 'Preparing')) return;
        if (this.isStopPrepRec === true) {
            this.emitCancelEvent();

            return;
        }

        if (retry < RecorderModel.PREP_FAILURE_LOG_INDIVIDUAL_ATTEMPTS) {
            this.log.system.info(`preprec: ${this.reserve.id}`);
        }

        this.isPrepRecording = true;
        this.isRecording = false;
        this.isPlanToDelete = false;

        if (retry === 0) {
            this.prepFailureLog = null;
            // 録画準備開始通知
            this.recordingEvent.emitStartPrepRecording(this.reserve);
        }

        // 番組ストリームを取得する
        // このprepRecord呼び出しが取得したstreamをacquiredStreamへ保持する。await中に後続の
        // 呼び出し(retry/replacement)がthis.streamへ別のstreamを設定した場合でも、cleanupは
        // 必ずこのacquiredStreamだけを対象にし、成功中のstreamを誤って破棄しない。
        let acquiredStream: http.IncomingMessage | null = null;
        try {
            // 番組開始時刻が変更されたことに伴い番組間に重なりが生じ、当該番組が削除されている
            // NOTE: mirakurunの不具合に対処
            if (this.reserve.programId) {
                const program = await this.programDB.findId(this.reserve.programId);
                if (program === null) {
                    this.log.system.warn(
                        `the program data does not found in database. retry later, (reerveId: ${this.reserve.id}, programId: ${this.reserve.programId})`,
                    );
                    this.emitCancelEvent();
                    return;
                }
            }
            if (this.shouldStopPreparation()) {
                this.emitCancelEvent();
                return;
            }

            this.abortController = new AbortController();
            this.stream = await this.streamCreator.create(
                this.reserve,
                this.abortController.signal,
                scheduledSession === null ? undefined : { isTimeSpecifiedEndExternallyScheduled: true },
            );
            acquiredStream = this.stream;

            // 録画準備のキャンセル or ストリーム取得中に予約が削除されていないかチェック
            const latestReserve = await this.reserveDB.findId(this.reserve.id);
            if (this.shouldStopPreparation()) {
                this.destroyAcquiredStream(acquiredStream);
                this.emitCancelEvent();
            } else if (latestReserve === null) {
                this.log.system.error(`canceled preprec: ${this.reserve.id}`);
                this.destroyAcquiredStream(acquiredStream);
                this.emitCancelEvent();
            } else {
                const currentSchedule = this.currentScheduleBinding(expectedSessionToken);
                if (scheduledSession !== null) {
                    if (currentSchedule === null || !currentSchedule.tryTransition('Preparing', 'Recording')) {
                        this.destroyAcquiredStream(acquiredStream);
                        return;
                    }
                    this.reserve = currentSchedule.reservation as Reserve;
                    if (this.reserve.isTimeSpecified === true || this.reserve.programId === null) {
                        currentSchedule.registerTimeSpecifiedEnd(
                            this.reserve.endAt + this.config.timeSpecifiedEndMargin * 1_000,
                        );
                        this.streamCreator.releaseTimeSpecifiedEnd?.(this.reserve.id);
                    }
                }
                this.logPrepFailureSummary('recovered');
                await this.doRecord(currentSchedule);
            }
        } catch (err: any) {
            if (isPathSelectionOverdueError(err)) {
                this.handlePathSelectionOverdue(err, scheduledSession, acquiredStream);
                return;
            }
            if ((this.isStopPrepRec as any) === true) {
                this.destroyAcquiredStream(acquiredStream);
                this.emitCancelEvent();
                return;
            }

            // The stream opened by this preparation attempt is abandoned regardless of whether its
            // schedule session is still current, so it must always be released here. Computing
            // currentRetryPhase/currentRetrySession below only decides whether to schedule a retry or
            // emit failure events for a still-current session; it must not gate this cleanup.
            this.destroyAcquiredStream(acquiredStream);

            const currentRetryPhase =
                scheduledSession === null
                    ? null
                    : this.findCurrentSchedulePhase(scheduledSession, [
                          'Preparing',
                          // stream取得後はdoRecordの前にRecordingへ進むため、録画先の選択・作成の失敗はこのphaseで届く
                          'Recording',
                          'AwaitingFirstData',
                          'Registering',
                          'RegistrationOverdue',
                      ]);
            if (scheduledSession !== null && currentRetryPhase === null) return;
            // doRecordが録画中の印を立てて準備中の印を外した後に失敗した場合も、再試行待ちは録画していない準備中である。
            this.isRecording = false;
            this.isPrepRecording = true;

            const currentRetrySession =
                scheduledSession === null ? null : this.currentScheduleBinding(expectedSessionToken);

            // 再試行回数が残っているか、番組指定予約で終了時刻前であれば5秒後に再試行する。
            // 番組指定予約のストリームは放送波上で番組が始まるまで応答しないため、放送開始の遅れで回数を使い切っても終了時刻まで待つ。
            const willRetry = retry < 3 || (!this.reserve.isTimeSpecified && this.reserve.endAt > Date.now());
            this.logPrepFailure(retry, err, willRetry);
            if (willRetry) {
                this.scheduleRetry(retry + 1, currentRetrySession, currentRetryPhase);
            } else {
                this.isPrepRecording = false;
                const currentSchedule = this.currentScheduleBinding(expectedSessionToken);
                currentSchedule?.removeTimeSpecifiedEnd();
                if (
                    scheduledSession !== null &&
                    (currentRetryPhase === null ||
                        !this.transitionSchedulePhase(currentSchedule, [currentRetryPhase], 'Completed'))
                ) {
                    return;
                }
                this.invalidateRetry();
                // 録画準備失敗を通知
                this.recordingEvent.emitPrepRecordingFailed(this.reserve);
            }
        } finally {
            this.abortController = null;
        }
    }

    /**
     * 録画準備の失敗を運用logへ記録する。
     * attempt 0〜3の失敗は1回ごとに記録する。番組指定予約が終了時刻まで続けるattempt 4以降の失敗は、
     * 失敗回数と最後のエラーだけを保持し、直前の記録から60秒以上たった失敗の時点、または準備失敗を
     * 通知する失敗の時点で1回にまとめて記録する。
     * @param retry 失敗した準備のattempt（初回は0）
     * @param err 失敗の原因
     * @param willRetry この失敗の後に再試行を続けるか
     */
    private logPrepFailure(retry: number, err: unknown, willRetry: boolean): void {
        const now = Date.now();
        if (retry < RecorderModel.PREP_FAILURE_LOG_INDIVIDUAL_ATTEMPTS) {
            this.log.system.error(`preprec failed: ${this.reserve.id}`);
            this.log.system.error(err);
            this.prepFailureLog =
                willRetry && retry === RecorderModel.PREP_FAILURE_LOG_INDIVIDUAL_ATTEMPTS - 1
                    ? { lastError: err, lastLoggedAt: now, pendingFailures: 0, totalFailures: retry + 1 }
                    : null;
            return;
        }

        const state = (this.prepFailureLog ??= {
            lastError: err,
            lastLoggedAt: now,
            pendingFailures: 0,
            totalFailures: retry,
        });
        state.lastError = err;
        state.pendingFailures += 1;
        state.totalFailures = retry + 1;
        if (!willRetry) {
            this.logPrepFailureSummary('failed');
        } else if (now - state.lastLoggedAt >= RecorderModel.PREP_FAILURE_LOG_INTERVAL_MS) {
            this.logPrepFailureSummary('failed');
            state.lastLoggedAt = now;
            state.pendingFailures = 0;
            this.prepFailureLog = state;
        }
    }

    /**
     * 保持している準備失敗の集計を、まだ記録していない失敗があれば運用logへ1回にまとめて記録し、集計を破棄する。
     * 番組指定予約がattempt 4以降まで再試行した場合だけ記録する。
     * @param outcome `failed`は準備失敗の通知前または60秒ごとの記録、`recovered`は取得に成功して録画へ進むときの記録、`canceled`は準備を取り消すときの記録
     */
    private logPrepFailureSummary(outcome: 'failed' | 'recovered' | 'canceled'): void {
        const state = this.prepFailureLog;
        if (state === null) return;
        this.prepFailureLog = null;
        // 準備失敗の通知前は直前の失敗が必ず未記録なので、未記録の失敗が無いのは取得成功・取消のときだけ。
        if (state.pendingFailures === 0) return;
        const message = `preprec ${outcome}: ${this.reserve.id} (${state.pendingFailures} failures since the last log, ${state.totalFailures} in total)`;
        if (outcome === 'failed') {
            this.log.system.error(message);
            this.log.system.error(state.lastError);
        } else {
            this.log.system.warn(message);
            this.log.system.warn(state.lastError);
        }
    }

    /**
     * 録画準備キャンセル完了時に発行するイベント
     */
    private emitCancelEvent(): void {
        this.logPrepFailureSummary('canceled');
        this.invalidateRetry();
        this.isStopPrepRec = false;
        this.isPrepRecording = false;
        this.isRecording = false;

        const currentSchedule = this.scheduleBinding;
        currentSchedule?.removeTimeSpecifiedEnd();
        if (this.isPlanToDelete === false) {
            this.transitionSchedulePhase(
                currentSchedule,
                [
                    'Waiting',
                    'Preparing',
                    'RetryWaiting',
                    'Recording',
                    'AwaitingFirstData',
                    'Registering',
                    'RegistrationOverdue',
                ],
                'Cancelled',
            );
        }

        this.eventEmitter.emit(RecorderModel.CANCEL_EVENT);
    }

    /**
     * prepRecord内で取得したstreamだけをcleanupする。所有権規則は次のとおり:
     * acquiredStreamがnullの呼び出しはstreamを一切所有していないため、this.streamに何か
     * (successorが取得したstream等)が入っていれば一切触れずreturnする。this.streamも
     * nullなら(=誰も何も所有していない)destroyStream()でrecFile終了・dropChecker停止・
     * deletion latch/finalization追跡だけを行う。this.streamが依然として同一streamを
     * 指していれば通常のdestroyStream()へ委譲する。後続の呼び出し(retry/replacement)が
     * this.streamを別のstreamへ差し替えていた場合は、その差し替え後のstream(this.stream)
     * へは一切触れず、acquiredStreamだけを直接破棄する。
     * @param acquiredStream: この呼び出しが取得したstream、またはまだ未取得ならnull
     */
    private destroyAcquiredStream(acquiredStream: http.IncomingMessage | null): void {
        // acquiredStreamがnullになるのはthis.programDB.findId()やthis.streamCreator.create()が
        // 例外を投げ、この呼び出しが自前のstreamを一度も取得できなかった場合である。その間に
        // 後続の呼び出しがthis.streamへ自分のstreamを設定していることがあり、その場合
        // this.streamはこの呼び出しの取得前後で変わり得る。acquiredStreamが無い以上そのstreamの
        // 所有権はこの呼び出しにはないため、無条件でdestroyStream()を呼ばず一切触れない。
        if (acquiredStream === null && this.stream !== null) return;

        if (acquiredStream === null || this.stream === acquiredStream) {
            this.destroyStream();
            return;
        }
        // ここに来るのは、後続の呼び出し(retry/replacement)がthis.streamを別のstreamへ差し替えた
        // 場合である。差し替え後のstream(this.stream)、recFile、dropCheckerはその後続呼び出しが
        // 所有しているため一切触れず、acquiredStreamだけを直接破棄する。
        if (acquiredStream.destroyed) return;

        this.observeStreamTermination(acquiredStream);
        try {
            acquiredStream.unpipe();
            acquiredStream.destroy();
            acquiredStream.push(null);
            acquiredStream.removeAllListeners('data');
        } catch (err: any) {
            this.log.system.error(`destroy acquired stream error: ${this.reserve.id}`);
            this.log.system.error(err);
        }
    }

    /**
     * streamの終端をdeletion latchまたはfinalization continuationへ登録する。
     * destroyStream()とdestroyAcquiredStream()の不一致分岐が共有する。
     * @param currentStream: 追跡対象のstream
     */
    private observeStreamTermination(currentStream: http.IncomingMessage | null): void {
        const deletionLatch = this.deletionStop?.latch;
        const streamTerminal = this.waitForStreamTerminal(currentStream);
        if (deletionLatch !== undefined) {
            deletionLatch.observe(streamTerminal);
        } else if (currentStream !== null && !currentStream.closed && !currentStream.readableEnded) {
            this.trackFinalizationContinuation(streamTerminal);
        }
    }

    /**
     * 書き込みwriterの終端をdeletion latchまたはfinalization continuationへ登録する。
     * @param currentWriter: 追跡対象のwriter
     */
    private observeWriterTermination(currentWriter: fs.WriteStream | null): void {
        const deletionLatch = this.deletionStop?.latch;
        const writerTerminal = this.waitForWriterTerminal(currentWriter);
        // currentWriterがnullなのは、この呼び出しがrecFileを所有していない(既に別の呼び出しが
        // 終了させた)場合である。その場合は直近の実際の終了待ちPromiseを上書きせず残す。
        if (currentWriter !== null) {
            this.recFileCloseTerminal = writerTerminal;
        }
        if (deletionLatch !== undefined) {
            deletionLatch.observe(writerTerminal);
        } else if (currentWriter !== null && !currentWriter.closed) {
            this.trackFinalizationContinuation(writerTerminal);
        }
    }

    /**
     * strem 破棄
     * @param needesUnpip: boolean
     */
    private destroyStream(needesUnpip: boolean = true, stopDropCheck: boolean = true): void {
        this.observeStreamTermination(this.stream);
        this.observeWriterTermination(this.recFile);

        // stop stream
        if (this.stream !== null) {
            try {
                if (needesUnpip === true) {
                    this.stream.unpipe();
                }
                this.stream.destroy();
                this.stream.push(null); // eof 通知
                this.stream.removeAllListeners('data');
                this.stream = null;
            } catch (err: any) {
                this.log.system.error(`destroy stream error: ${this.reserve.id}`);
                this.log.system.error(err);
            }
        }

        // stop save file
        const recFile = this.recFile;
        if (recFile !== null) {
            this.recFile = null;
            try {
                recFile.removeAllListeners('error');
                recFile.end();
            } catch (err: any) {
                this.log.system.error(`end recFile error: ${this.reserve.id}`);
                this.log.system.error(err);
            }
        }

        // stop drop check
        if (stopDropCheck) {
            const dropStop = this.stopDropChecker();
            if (dropStop === null) return;
            const deletionLatch = this.deletionStop?.latch;
            if (deletionLatch !== undefined) {
                deletionLatch.observe(dropStop);
            } else {
                this.trackFinalizationContinuation(dropStop);
            }
            dropStop.catch(err => {
                this.log.system.error(`dropChecker stop error: ${this.reserve.id}`);
                this.log.system.error(err);
            });
        }
    }

    /**
     * 録画処理
     */
    private async doRecord(
        scheduledSession: RecordingScheduleSessionBinding | null = this.scheduleBinding,
    ): Promise<void> {
        const expectedSessionToken = scheduledSession?.sessionToken;
        if (this.stream === null) {
            return;
        }

        // 録画キャンセル
        if (this.isStopPrepRec === true) {
            this.log.system.error(`cancel recording: ${this.reserve.id}`);
            this.destroyStream();
            this.emitCancelEvent();

            return;
        }

        this.isPrepRecording = false;
        this.isRecording = true;

        // 録画開始内部イベント発行
        // 時刻指定予約で録画準備中に endAt を変えようとした場合にこのイベントを受信してから変える
        this.eventEmitter.emit(RecorderModel.START_RECORDING_EVENT);

        // 保存先を取得
        const recPath = await this.recordingUtil.getRecPath(this.reserve, true, true);
        const writerOwnership = { isOwned: recPath.fileHandle !== undefined };
        const cleanupUnstartedRecFile = async (
            recFile: fs.WriteStream | null = null,
            ownership: { isOwned: boolean } = writerOwnership,
            shouldUnlink: boolean = true,
        ): Promise<void> => {
            if (recFile !== null) {
                const terminal = this.waitForWriterTerminal(recFile);
                try {
                    recFile.removeAllListeners('error');
                    // Teardown sink absorbing a late-arriving write-completion error for this
                    // writer, which we are already discarding and unlinking; there is no
                    // recovery action to take.
                    recFile.once('error', () => {});
                    recFile.destroy();
                } catch (err: any) {
                    this.log.system.error(`close recFile error: ${this.reserve.id}`);
                    this.log.system.error(err);
                }
                await terminal;
            } else if (recPath.fileHandle !== undefined) {
                await recPath.fileHandle.close().catch(err => {
                    this.log.system.error(`close recFile error: ${this.reserve.id}`);
                    this.log.system.error(err);
                });
            }

            if (ownership.isOwned === false || shouldUnlink === false) return;
            await FileUtil.unlink(recPath.fullPath).catch(err => {
                this.log.system.error(`delete error: ${this.reserve.id} ${recPath.fullPath}`);
                this.log.system.error(err);
            });
        };

        const shouldStopPreparation = this.shouldStopPreparation();
        const streamWasDestroyed = this.stream?.destroyed === true;
        if (this.stream === null || streamWasDestroyed || shouldStopPreparation) {
            this.destroyStream();
            await cleanupUnstartedRecFile();
            if (shouldStopPreparation) this.emitCancelEvent();
            return;
        }

        this.log.system.info(`recording: ${this.reserve.id} ${recPath.fullPath}`);

        // save stream
        let recFile: fs.WriteStream;
        try {
            recFile =
                recPath.fileHandle === undefined
                    ? fs.createWriteStream(recPath.fullPath, { flags: 'wx' })
                    : recPath.fileHandle.createWriteStream();
        } catch (err) {
            await cleanupUnstartedRecFile();
            throw err;
        }
        if (recPath.fileHandle === undefined) {
            recFile.once('open', () => {
                writerOwnership.isOwned = true;
            });
        }
        this.recFile = recFile;
        let settleStartFailure: ((error: Error) => void) | null = null;
        let bufferedStartFailure: Error | null = null;
        let firstDataGateAvailable = false;
        recFile.once('error', async err => {
            // 書き込みエラー発生
            this.log.system.error(`recFile error reserveId: ${this.reserve.id}, recordedId: ${this.recordedId}`);
            this.log.system.error(err);
            if (settleStartFailure !== null) {
                settleStartFailure(err);
                return;
            }
            if (firstDataGateAvailable === false) {
                bufferedStartFailure = err;
                return;
            }
            if (this.videoFileFulPath === null) await cleanupUnstartedRecFile(recFile, writerOwnership);
            if (this.stream === null) {
                this.cancel(false);
            } else {
                this.isCanceledCallingFinished = true; // mirakurun の stream の終了処理を行わないようにセット
                await this.recFailed(err, scheduledSession).catch(err => {
                    this.log.system.fatal(
                        `Unexpected recFailed error: reserveId: ${this.reserve.id}, recordedId: ${this.recordedId}`,
                    );
                    this.log.system.fatal(err);
                });
            }
        });

        // drop checker の準備は stream を流し始める前に済ませる。
        // 流し始めた後に await すると、その間の chunk が録画 file にだけ流れて drop の集計から漏れる。
        // 時刻指定予約の stream は読み捨てのために flowing のまま渡されるので、準備の間は止めて data を保持する。
        // 再開は、後の録画 file への pipe が行う。
        let isDropCheckerPrepared = false;
        if (this.config.isEnabledDropCheck === true) {
            this.stream.pause();
            try {
                await this.dropChecker.prepare(this.config.dropLog, recPath.fullPath);
                isDropCheckerPrepared = true;
            } catch (err: any) {
                this.log.system.error(`drop check error: ${recPath.fullPath}`);
                this.log.system.error(err);
            }
        }

        // 録画 file への pipe と drop checker の attach は同じ tick で行う
        let isDropCheckerAttached = false;
        if (this.stream !== null) {
            try {
                this.stream.pipe(recFile);
            } catch (err) {
                this.recFile = null;
                await cleanupUnstartedRecFile(recFile, writerOwnership);
                throw err;
            }
            if (isDropCheckerPrepared === true) {
                try {
                    this.dropChecker.attach(recPath.fullPath, this.stream);
                    isDropCheckerAttached = true;
                } catch (err: any) {
                    this.log.system.error(`drop check error: ${recPath.fullPath}`);
                    this.log.system.error(err);
                }
            }
        }

        // drop checker
        if (this.config.isEnabledDropCheck === true) {
            let dropFilePath: string | null = null;
            if (isDropCheckerAttached === true) {
                this.isDropCheckerActive = true;
                this.dropCheckerStopLifetime = null;
                dropFilePath = this.dropChecker.getFilePath();
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
                } catch (err: any) {
                    this.dropLogFileId = null;
                    this.log.system.error(`add drop log file error: ${dropFilePath}`);
                    this.log.system.error(err);
                }
            }
        }

        const firstDataSchedule = this.currentScheduleBinding(expectedSessionToken);
        if (
            scheduledSession !== null &&
            (firstDataSchedule === null || !firstDataSchedule.tryTransition('Recording', 'AwaitingFirstData'))
        ) {
            this.destroyStream();
            return;
        }

        return new Promise<void>((resolve: () => void, reject: (error: Error) => void) => {
            if (this.stream === null) {
                reject(new Error('StreamIsNull'));

                return;
            }

            const waitingStream = this.stream;
            let firstDataObserved = false;
            let outcomeSettled = false;
            let registrationSettled = false;
            let cancellationPending = false;
            let registrationResources: PendingRegistrationResources | null = null;
            let registrationOwner: RegistrationOwner | null = null;
            let registrationWatchdogId: NodeJS.Timeout | null = null;
            const releaseWait = (wait: { cancel(): void }): void => {
                if (this.firstDataWait === wait) this.firstDataWait = null;
            };
            const clearRegistrationWatchdog = (): void => {
                if (registrationWatchdogId === null) return;
                clearTimeout(registrationWatchdogId);
                registrationWatchdogId = null;
            };
            const releaseRegistrationOwner = (): void => {
                clearRegistrationWatchdog();
                if (registrationOwner === null) return;
                this.registrationOwners.delete(registrationOwner);
                registrationOwner = null;
            };
            const releaseListeners = (): void => {
                clearTimeout(recordingTimeoutId);
                waitingStream.removeListener('data', onData);
                waitingStream.removeListener('error', onStreamError);
                releaseWait(wait);
            };
            const takeOutcome = (): boolean => {
                if (outcomeSettled) return false;
                outcomeSettled = true;
                releaseListeners();
                settleStartFailure = null;
                return true;
            };
            const destroyReplacedWaitingStream = (): void => {
                if (waitingStream.closed || waitingStream.readableEnded) return;
                try {
                    waitingStream.unpipe();
                    waitingStream.destroy();
                    waitingStream.push(null);
                    waitingStream.removeAllListeners('data');
                } catch (err: any) {
                    this.log.system.error(`destroy replaced stream error: ${this.reserve.id}`);
                    this.log.system.error(err);
                }
            };
            const isReplacementRegistrationOwner = (): boolean => {
                if (registrationOwner === null) return false;
                return registrationOwner.intent === 'Replacement';
            };
            const cleanupRegistrationFailureResources = async (shouldUnlink: boolean = true): Promise<void> => {
                await cleanupUnstartedRecFile(recFile, writerOwnership, shouldUnlink);

                const resources = registrationResources;
                if (resources !== null && resources.recordedId !== null && resources.videoFileId === null) {
                    let deletedRecordedId = false;
                    try {
                        await this.recordedDB.deleteOnce(resources.recordedId);
                        deletedRecordedId = true;
                    } catch (err: any) {
                        this.log.system.error(`delete recorded error: ${resources.recordedId}`);
                        this.log.system.error(err);
                    }
                    if (this.recordedId === resources.recordedId) this.recordedId = null;
                    if (deletedRecordedId) resources.recordedId = null;
                }
                if (this.pendingRegistrationResources === resources) this.pendingRegistrationResources = null;
            };
            const settleFailure = async (error: Error): Promise<void> => {
                if (!takeOutcome()) return;
                try {
                    this.destroyStream();
                    await cleanupRegistrationFailureResources();
                } finally {
                    reject(error);
                }
            };
            const settleStaleRegistrationFailure = async (): Promise<void> => {
                if (!takeOutcome()) return;
                try {
                    await cleanupRegistrationFailureResources();
                } finally {
                    resolve();
                }
            };
            const settleCancelled = (waitForRegistration: boolean = false): void => {
                if (!takeOutcome()) return;
                if (waitForRegistration) {
                    cancellationPending = true;
                    return;
                }
                resolve();
            };
            const settlePendingCancellation = async (): Promise<void> => {
                if (!cancellationPending) return;
                cancellationPending = false;
                if (registrationResources !== null) {
                    await this.cleanupPendingRegistration(registrationResources);
                }
                resolve();
            };
            const settleTerminatedRegistration = async (): Promise<void> => {
                if (isReplacementRegistrationOwner()) destroyReplacedWaitingStream();
                if (registrationOwner === null || registrationOwner.intent !== 'Deletion') {
                    await cleanupRegistrationFailureResources();
                }
                if (registrationResources !== null) {
                    await this.cleanupPendingRegistration(registrationResources);
                }
                await settlePendingCancellation();
                if (!outcomeSettled) settleCancelled();
                const currentSchedule = this.scheduleBinding;
                if (
                    registrationOwner?.intent === 'Cancel' &&
                    this.matchesRegistrationOwner(registrationOwner, currentSchedule)
                ) {
                    this.transitionSchedulePhase(currentSchedule, ['Registering', 'RegistrationOverdue'], 'Cancelled');
                }
                releaseRegistrationOwner();
            };
            const onData = async () => {
                if (firstDataObserved || outcomeSettled) return;
                firstDataObserved = true;
                clearTimeout(recordingTimeoutId);

                const registeringSchedule = this.currentScheduleBinding(expectedSessionToken);
                if (
                    scheduledSession !== null &&
                    (registeringSchedule === null ||
                        !this.isCurrentScheduleBinding(scheduledSession, 'AwaitingFirstData') ||
                        !registeringSchedule.tryTransition('AwaitingFirstData', 'Registering'))
                ) {
                    settleCancelled();
                    return;
                }

                // 番組情報追加
                let recorded: Recorded | null;
                if (scheduledSession !== null) {
                    registrationOwner = {
                        reservationId: scheduledSession.reservationId,
                        generation: scheduledSession.generation,
                        sessionToken: scheduledSession.sessionToken,
                        intent: 'None',
                    };
                    this.registrationOwners.add(registrationOwner);
                    registrationWatchdogId = setTimeout(() => {
                        registrationWatchdogId = null;
                        const currentSchedule = this.currentScheduleBinding(expectedSessionToken);
                        if (
                            currentSchedule === null ||
                            registrationSettled ||
                            registrationOwner === null ||
                            !this.matchesRegistrationOwner(registrationOwner, currentSchedule) ||
                            !this.isCurrentScheduleBinding(scheduledSession, 'Registering')
                        ) {
                            return;
                        }
                        currentSchedule.tryTransition('Registering', 'RegistrationOverdue');
                    }, REGISTRATION_OWNER_WATCHDOG_TIMEOUT_MS);
                    registrationWatchdogId.unref?.();
                }
                const registration = this.addRecorded(recPath, true, scheduledSession);
                registrationResources = this.pendingRegistrationResources;
                try {
                    recorded = await registration;
                } catch (err: any) {
                    registrationSettled = true;
                    clearRegistrationWatchdog();
                    const registrationError = err instanceof Error ? err : new Error('AddRecordedDBError');
                    if (registrationOwner !== null && registrationOwner.intent !== 'None') {
                        await settleTerminatedRegistration();
                    } else if (
                        scheduledSession !== null &&
                        this.findCurrentSchedulePhase(scheduledSession, ['Registering', 'RegistrationOverdue']) === null
                    ) {
                        await settleStaleRegistrationFailure();
                        releaseRegistrationOwner();
                    } else {
                        await settleFailure(registrationError);
                        releaseRegistrationOwner();
                    }
                    await settlePendingCancellation();
                    return;
                }
                registrationSettled = true;
                clearRegistrationWatchdog();
                if (recorded === null) {
                    await settlePendingCancellation();
                    settleCancelled();
                    releaseRegistrationOwner();
                    return;
                }
                if (outcomeSettled) {
                    if (isReplacementRegistrationOwner()) destroyReplacedWaitingStream();
                    if (registrationOwner === null || registrationOwner.intent !== 'Deletion') {
                        await cleanupRegistrationFailureResources();
                    }
                    if (registrationResources !== null) await this.cleanupPendingRegistration(registrationResources);
                    await settlePendingCancellation();
                    const currentSchedule = this.scheduleBinding;
                    if (
                        registrationOwner?.intent === 'Cancel' &&
                        this.matchesRegistrationOwner(registrationOwner, currentSchedule)
                    ) {
                        this.transitionSchedulePhase(
                            currentSchedule,
                            ['Registering', 'RegistrationOverdue'],
                            'Cancelled',
                        );
                    }
                    releaseRegistrationOwner();
                    return;
                }

                const recordedUse = Object.freeze({ recordedId: recorded.id, status: 'active' as const });
                const useRegistration = this.recordedUseProvider.tryRegisterSessionUse(this, recordedUse);
                if (useRegistration !== 'registered') {
                    this.destroyStream();
                    await cleanupRegistrationFailureResources(false);
                    await this.awaitFinalizationContinuations();
                    // addRecorded は Promise を返す前に resources を登録するため、recorded が存在するこの経路では必ず存在する。
                    await this.cleanupPendingRegistration(registrationResources!);
                    this.emitCancelEvent();
                    this.recordingEvent.emitCancelPrepRecording(this.reserve);
                    releaseRegistrationOwner();
                    resolve();
                    return;
                }

                const activeSchedule = this.currentScheduleBinding(expectedSessionToken);
                const registrationPhase =
                    scheduledSession === null
                        ? null
                        : this.findCurrentSchedulePhase(scheduledSession, ['Registering', 'RegistrationOverdue']);
                if (
                    scheduledSession !== null &&
                    (activeSchedule === null ||
                        registrationPhase === null ||
                        !activeSchedule.tryTransition(registrationPhase, 'Recording'))
                ) {
                    this.recordedUseProvider.releaseSessionUse(this, recordedUse);
                    if (isReplacementRegistrationOwner()) destroyReplacedWaitingStream();
                    if (registrationResources !== null) {
                        if (!this.isPlanToDelete) await cleanupRegistrationFailureResources(false);
                        await this.awaitFinalizationContinuations();
                        await this.cleanupPendingRegistration(registrationResources);
                    }
                    await settlePendingCancellation();
                    settleCancelled();
                    releaseRegistrationOwner();
                    return;
                }

                // 終了処理セット
                if (this.stream === null) {
                    await settleFailure(new Error('StreamIsNull'));
                    return;
                }
                if (!takeOutcome()) {
                    this.recordedUseProvider.releaseSessionUse(this, recordedUse);
                    return;
                }
                this.activeRecordedUse = recordedUse;
                if (this.pendingRegistrationResources === registrationResources)
                    this.pendingRegistrationResources = null;
                releaseRegistrationOwner();
                this.setEndProcess(this.stream, activeSchedule);

                // 録画開始を通知
                this.recordingEvent.emitStartRecording(this.reserve, recorded);

                // program id が指定されていればイベントリレーの確認を行う
                if (this.reserve.programId !== null) {
                    // イベントリレーを確認するために番組終了時間間近にタイマーをセットする
                    this.setEventRelayTimer(this.reserve);
                }

                resolve();
            };
            const onStreamError = (err: Error): void => {
                void settleFailure(err);
            };
            const wait = {
                cancel: () => {
                    settleCancelled(firstDataObserved);
                },
            };
            const recordingTimeoutId = setTimeout(async () => {
                if (firstDataObserved || outcomeSettled) return;
                firstDataObserved = true;
                this.log.system.error(`recording failed: ${this.reserve.id}`);
                await settleFailure(new Error('recordingStartError'));
            }, 1000 * 5);

            // stream データ受診時のコールバック設定
            this.firstDataWait = wait;
            firstDataGateAvailable = true;
            this.stream.once('data', onData);
            this.stream.once('error', onStreamError);
            settleStartFailure = error => {
                void settleFailure(error);
            };
            if (bufferedStartFailure !== null) settleStartFailure(bufferedStartFailure);
        }).catch(err => {
            // 予想外の録画失敗エラー
            if (this.stream !== null) this.destroyStream();
            throw err;
        });
    }

    /**
     * 録画開始時の録画番組情報追加処理
     * @param recPath: RecFilePathInfo
     * @returns Promise<Recorded>
     */
    private async addRecorded(
        recPath: RecFilePathInfo,
        deferFailureCleanup: boolean = false,
        registrationSession: RecordingScheduleSessionBinding | null = null,
    ): Promise<Recorded | null> {
        this.log.system.info(`add recorded ${this.reserve.id} ${recPath.fullPath}`);
        const resources: PendingRegistrationResources = {
            cleanupLifetime: null,
            dropLogFileId: this.dropLogFileId,
            filePath: recPath.fullPath,
            recordedId: null,
            videoFileId: null,
        };
        this.pendingRegistrationResources = resources;
        const ownsRegistrationState = (): boolean =>
            registrationSession === null ||
            this.findCurrentSchedulePhase(registrationSession, ['Registering', 'RegistrationOverdue']) !== null;
        try {
            const recorded = await this.createRecorded();
            if (this.isPlanToDelete) {
                await this.cleanupPendingRegistration(resources);
                return null;
            }
            resources.recordedId = await this.recordedDB.insertOnce(recorded);
            if (ownsRegistrationState()) this.recordedId = resources.recordedId;
            recorded.id = resources.recordedId;
            this.log.system.info(`recording added reserveId: ${this.reserve.id}, recordedId: ${resources.recordedId}`);
            if (this.isPlanToDelete) {
                await this.cleanupPendingRegistration(resources);
                return null;
            }

            // add video file
            const videoFile = new VideoFile();
            videoFile.parentDirectoryName = recPath.parendDir.name;
            videoFile.filePath = path.join(recPath.subDir, recPath.fileName);
            videoFile.type = 'ts';
            videoFile.name = 'TS';
            videoFile.recordedId = resources.recordedId;
            this.log.system.info(`create video file: ${videoFile.filePath}`);
            resources.videoFileId = await this.videoFileDB.insertOnce(videoFile);
            if (ownsRegistrationState()) {
                this.videoFileId = resources.videoFileId;
                this.videoFileFulPath = recPath.fullPath;
            }
            if (this.isPlanToDelete) {
                await this.cleanupPendingRegistration(resources);
                return null;
            }

            recorded.videoFiles = [videoFile];

            return recorded;
        } catch (err: any) {
            // DB 登録エラー
            this.log.system.error('add recorded DB error');
            this.log.system.error(err);
            if (deferFailureCleanup === false) this.destroyStream();

            if (this.isPlanToDelete) {
                await this.cleanupPendingRegistration(resources);
                return null;
            }
            if (deferFailureCleanup === false) {
                // 作成済みの録画済み番組・録画ファイル・drop log の行と録画ファイルを削除する
                await this.cleanupPendingRegistration(resources);
            }

            throw new Error('AddRecordedDBError', { cause: err });
        }
    }

    private cleanupPendingRegistration(resources: PendingRegistrationResources): Promise<void> {
        if (resources.cleanupLifetime !== null) return resources.cleanupLifetime;

        const cleanup = async (): Promise<void> => {
            if (resources.videoFileId !== null) {
                try {
                    await this.videoFileDB.deleteOnce(resources.videoFileId);
                } catch (err: any) {
                    this.log.system.error(`delete video file error: ${resources.videoFileId}`);
                    this.log.system.error(err);
                }
            }
            if (resources.recordedId !== null) {
                try {
                    await this.recordedDB.deleteOnce(resources.recordedId);
                } catch (err: any) {
                    this.log.system.error(`delete recorded error: ${resources.recordedId}`);
                    this.log.system.error(err);
                }
            }
            if (resources.dropLogFileId !== null) {
                try {
                    await this.dropLogFileDB.deleteOnce(resources.dropLogFileId);
                } catch (err: any) {
                    this.log.system.error(`delete drop log file error: ${resources.dropLogFileId}`);
                    this.log.system.error(err);
                }
            }
            try {
                await FileUtil.unlink(resources.filePath);
            } catch (err: any) {
                this.log.system.error(`delete error: ${this.reserve.id} ${resources.filePath}`);
                this.log.system.error(err);
            }

            if (resources.videoFileId !== null && this.videoFileId === resources.videoFileId) {
                this.videoFileId = null;
            }
            if (resources.recordedId !== null && this.recordedId === resources.recordedId) {
                this.recordedId = null;
            }
            if (resources.dropLogFileId !== null && this.dropLogFileId === resources.dropLogFileId) {
                this.dropLogFileId = null;
            }
            if (this.videoFileFulPath === resources.filePath) this.videoFileFulPath = null;
            if (this.pendingRegistrationResources === resources) this.pendingRegistrationResources = null;
        };

        resources.cleanupLifetime = cleanup();
        return resources.cleanupLifetime;
    }

    /**
     * 終了処理追加
     * @param s: Mirakurun からのストリーム
     * @returns Promise<Recorded>
     */
    private async setEndProcess(
        s: http.IncomingMessage,
        failureSession: RecordingScheduleSessionBinding | null = this.scheduleBinding,
    ): Promise<void> {
        this.log.system.info(`set stream.finished: reserveId: ${this.reserve.id} recordedId: ${this.recordedId}`);
        stream.finished(s, {}, async err => {
            // 終了処理が呼ばれていたら無視する
            if (this.isCanceledCallingFinished === true) {
                return;
            }

            if (err) {
                this.log.system.error(
                    `stream.finished error: reserveId: ${this.reserve.id} recordedId: ${this.recordedId}`,
                );
                await this.recFailed(err, failureSession);
            } else {
                await this.recEnd().catch(e => {
                    this.log.system.fatal(
                        `unexpected recEnd error: reserveId: ${this.reserve.id} recordedId: ${this.recordedId}`,
                    );
                    this.log.system.fatal(e);
                });
            }
        });
    }

    /**
     * 録画失敗処理
     * @param err: Error
     */
    private async recFailed(
        err: Error,
        failureSession: RecordingScheduleSessionBinding | null = this.scheduleBinding,
    ): Promise<void> {
        const entryFailureSession =
            failureSession === null ? null : this.currentScheduleBinding(failureSession.sessionToken);
        const canPublishFailure =
            failureSession === null ||
            (entryFailureSession !== null &&
                this.findCurrentSchedulePhase(entryFailureSession, [
                    'Recording',
                    'PathSelectionOverdue',
                    'AwaitingFirstData',
                    'Registering',
                    'RegistrationOverdue',
                ]) !== null);
        this.destroyStream(true, this.isPlanToDelete === false);
        this.log.system.error(`recording end error reserveId: ${this.reserve.id} recordedId: ${this.recordedId}`);
        this.log.system.error(err);

        // 録画終了処理
        this.isNeedDeleteReservation = false;
        await this.recEnd().catch(e => {
            this.log.system.error(`recEnd error reserveId: ${this.reserve.id} recordedId: ${this.recordedId}`);
            this.log.system.error(e);
        });

        // 録画終了処理失敗を通知
        let recorded: Recorded | null = null;
        if (this.recordedId !== null) {
            try {
                recorded = await this.recordedDB.findId(this.recordedId);
            } catch (e: any) {
                this.log.system.error(`reocrded is deleted: ${this.recordedId}`);
                recorded = null;
            }
        }
        if (!canPublishFailure) return;
        if (failureSession === null) {
            this.recordingEvent.emitRecordingFailed(this.reserve, recorded);
            return;
        }

        const latestFailureSession = this.currentScheduleBinding(failureSession.sessionToken);
        if (
            latestFailureSession === null ||
            this.findCurrentSchedulePhase(latestFailureSession, [
                'Recording',
                'PathSelectionOverdue',
                'AwaitingFirstData',
                'Registering',
                'RegistrationOverdue',
                'Finishing',
                'Completed',
            ]) === null
        ) {
            return;
        }
        this.recordingEvent.emitRecordingFailed(
            latestFailureSession.reservation as Reserve,
            recorded,
            latestFailureSession,
        );
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
                recorded.rawExtended = program.rawExtended;
                recorded.rawHalfWidthExtended = program.rawHalfWidthExtended;
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
            recorded.rawExtended = this.reserve.rawExtended;
            recorded.rawHalfWidthExtended = this.reserve.rawHalfWidthExtended;
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
     */
    private recEnd(isScheduleAlreadyFinishing: boolean = false): Promise<void> {
        if (this.finalizationLifetime !== null) return this.finalizationLifetime;

        let resolveLifetime!: () => void;
        let rejectLifetime!: (error: unknown) => void;
        const lifetime = new Promise<void>((resolve, reject) => {
            resolveLifetime = resolve;
            rejectLifetime = reject;
        });
        this.finalizationLifetime = lifetime;
        void this.finalizeRecording(isScheduleAlreadyFinishing).then(resolveLifetime, rejectLifetime);
        void lifetime.then(
            () => this.settleNormalRecordingTerminal(),
            () => this.settleNormalRecordingTerminal(),
        );
        return lifetime;
    }

    private async finalizeRecording(isScheduleAlreadyFinishing: boolean): Promise<void> {
        this.log.system.info(`start recEnd reserveId: ${this.reserve.id} recordedId: ${this.recordedId}`);
        this.invalidateRetry();

        const currentSchedule = this.scheduleBinding;
        const expectedSessionToken = currentSchedule?.sessionToken;
        currentSchedule?.removeTimeSpecifiedEnd();
        if (!isScheduleAlreadyFinishing) {
            this.transitionSchedulePhase(
                currentSchedule,
                ['Recording', 'PathSelectionOverdue', 'AwaitingFirstData', 'Registering', 'RegistrationOverdue'],
                'Finishing',
            );
        }

        // stream 停止
        this.destroyStream(true, this.isPlanToDelete === false);

        // イベントリレーのチェック用タイマーをクリア
        if (this.eventRelayTimerId !== null) {
            clearTimeout(this.eventRelayTimerId);
        }

        // 削除予定か?
        if (this.isPlanToDelete === true) {
            this.log.system.info(`plan to delete reserveId: ${this.reserve.id} recordedId: ${this.recordedId}`);

            const dropStop = this.stopDropChecker();
            if (dropStop !== null) {
                await dropStop.catch(err => {
                    this.log.system.error(`stop drop checker error: ${this.dropLogFileId}`);
                    this.log.system.error(err);
                });
            }

            return;
        }

        if (this.recordedId !== null) {
            // remove recording flag
            this.log.system.info(`remove recording flag: ${this.recordedId}`);
            await this.recordedDB.removeRecording(this.recordedId);
            this.isRecording = false;

            // tmp に録画していた場合は移動する
            if (typeof this.config.recordedTmp !== 'undefined' && this.videoFileId !== null) {
                try {
                    const newVdeoFileFulPath = await this.recordingUtil.movingFromTmp(this.reserve, this.videoFileId);
                    this.videoFileFulPath = newVdeoFileFulPath;
                } catch (err: any) {
                    this.log.system.fatal(`movingFromTmp error: ${this.videoFileId}`);
                    this.log.system.fatal(err);
                }
            }

            // update video file size
            if (this.videoFileId !== null && this.videoFileFulPath !== null) {
                const videoFileId = this.videoFileId;
                const dispatchSizeUpdate = (): Promise<void> =>
                    this.recordingUtil.updateVideoFileSize(videoFileId).catch(err => {
                        this.log.system.error(`update file size error: ${videoFileId}`);
                        this.log.system.error(err);
                    });
                // recFileへの書き込みが実際にディスクへ渡り終える('close')前にstat()すると、
                // 書き込み未完了のサイズ(0や途中の値)を読んでしまう競合があるため、直近の
                // recFile終了待ち(this.recFileCloseTerminal、既にobserveWriterTerminationが
                // 生成・追跡している)があればその完了後にサイズ更新を開始する。終了待ちが無い
                // (recFileを介さない、あるいは既に別経路で終了済み)場合は従来どおり即時に開始
                // する。この待ちはfinalizeRecording自体の完了(drop更新・再照会・完了通知)を
                // 止めない。sizeUpdateはこれまでと同じくfinalizationContinuationsで追跡され、
                // recFileCloseTerminal自体もそこに含まれているため、無期限に終わらない場合の
                // 挙動は既存のwriter終了待ちと同じ(通常終了時は無タイムアウト、削除時は
                // DELETION_STOP_TIMEOUT_MSで打ち切り)。
                const closeWait = this.recFileCloseTerminal;
                const sizeUpdate =
                    closeWait === null ? dispatchSizeUpdate() : closeWait.then(dispatchSizeUpdate, dispatchSizeUpdate);
                this.trackFinalizationContinuation(sizeUpdate);
            }

            // drop 情報更新
            await this.updateDropFileLog().catch(err => {
                this.log.system.fatal(`updateDropFileLog error: ${this.dropLogFileId}`);
                this.log.stream.fatal(err);
            });

            // recorded 情報取得
            const recorded = await this.recordedDB.findId(this.recordedId);

            // Recorded history 追加
            if (
                this.reserve.isTimeSpecified === false &&
                this.reserve.ruleId !== null &&
                this.reserve.isEventRelay === false &&
                this.isNeedDeleteReservation === true
            ) {
                // ルール(Program Id 予約)の場合のみ記録する
                try {
                    if (recorded !== null) {
                        this.log.system.info(`add recorded history: ${this.recordedId}`);
                        const history = new RecordedHistory();
                        history.name = StrUtil.deleteBrackets(recorded.halfWidthName);
                        history.channelId = recorded.channelId;
                        history.endAt = recorded.endAt;
                        await this.recordedHistoryDB.insertOnce(history);
                    }
                } catch (err: any) {
                    this.log.system.error(`add recorded history error: ${this.recordedId}`);
                    this.log.system.error(err);
                }
            }

            // 録画完了の通知
            if (recorded !== null) {
                this.log.system.info(
                    `emit finish recording reserveId: ${this.reserve.id}, recordedId: ${this.recordedId}, isNeedDeleteReservation: ${this.isNeedDeleteReservation}`,
                );
                this.recordingEvent.emitFinishRecording(this.reserve, recorded, this.isNeedDeleteReservation);
            }
        } else {
            this.log.system.info('failed to recording: recorded id is null');
        }

        this.log.system.info(
            `recording finish reserveId: ${this.reserve.id}, recordedId: ${this.recordedId}, videoFileFulPath: ${this.videoFileFulPath}`,
        );
        this.transitionSchedulePhase(this.currentScheduleBinding(expectedSessionToken), ['Finishing'], 'Completed');
    }

    private trackFinalizationContinuation(operation: Promise<unknown>): void {
        this.finalizationContinuations.add(operation);
        const release = () => this.finalizationContinuations.delete(operation);
        void operation.then(release, release);
    }

    private settleNormalRecordingTerminal(): void {
        if (this.normalRecordingTerminalLifetime !== null || this.isPlanToDelete) return;
        const lifetime = this.awaitFinalizationContinuations();
        this.normalRecordingTerminalLifetime = lifetime;
        void lifetime.then(() => {
            this.releaseActiveRecordedUse();
            this.resolveNormalRecordingTerminal();
        });
    }

    private releaseActiveRecordedUse(): void {
        const recordedUse = this.activeRecordedUse;
        if (recordedUse === null) return;
        this.recordedUseProvider.releaseSessionUse(this, recordedUse);
        this.activeRecordedUse = null;
    }

    private async awaitFinalizationForDeletion(startIfMissing: boolean): Promise<void> {
        if (this.finalizationLifetime === null && startIfMissing) void this.recEnd(true);
        if (this.finalizationLifetime !== null) await Promise.allSettled([this.finalizationLifetime]);

        await this.awaitFinalizationContinuations();
    }

    private async awaitFinalizationContinuations(): Promise<void> {
        while (this.finalizationContinuations.size > 0) {
            await Promise.allSettled([...this.finalizationContinuations]);
        }
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
        } catch (err: any) {
            this.log.system.error(`get drop result error: ${this.dropLogFileId}`);
            this.log.system.error(err);
            await this.dropChecker.stop().catch(() => {});

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
     * 予約のキャンセル
     */
    private async _cancel(): Promise<void> {
        this.recordRegistrationTerminationIntent('Cancel');
        const currentSchedule = this.scheduleBinding;
        if (
            this.retryTimerId !== null ||
            (currentSchedule !== null && this.isCurrentScheduleBinding(currentSchedule, 'RetryWaiting'))
        ) {
            this.emitCancelEvent();
            return;
        }
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
                this.isStopPrepRec = true;
                if (this.abortController !== null) {
                    this.abortController.abort();
                }
                this.eventEmitter.once(RecorderModel.CANCEL_EVENT, () => {
                    clearTimeout(timerId);
                    // prep rec キャンセル完了
                    resolve();
                });
            });
        } else if (this.isRecording === true) {
            this.log.system.info(`stop recording: ${this.reserve.id}`);
            // 録画中
            this.cancelFirstDataWait();
            const currentStream = this.stream;
            if (currentStream !== null) {
                // 取消の時点までに受信 socket へ届いている data を読み取り、録画 file へ渡し切ってから止める
                if (RecorderModel.isReadingFromReceiver(currentStream)) {
                    await this.readArrivedStreamData(currentStream);
                }
                // 読み切る間に stream が終わった場合は、その終了処理がすでに stream を止めている
                if (currentStream.destroyed === false) {
                    currentStream.destroy();
                    currentStream.push(null); // eof 通知
                }
            }
        }
    }

    /**
     * 録画 file への pipe が受信 socket から読んでいる stream か。
     * 受信 socket を持たない stream と、まだ録画 file へ pipe していない stream には、読み切って書く data が無い。
     * @param currentStream: 録画中の stream
     */
    private static isReadingFromReceiver(currentStream: http.IncomingMessage): boolean {
        return currentStream.socket instanceof net.Socket && currentStream.listenerCount('data') > 0;
    }

    /**
     * 受信 socket と stream の buffer に届いている data を、録画 file への pipe が読み終えるまで待つ。
     * event loop を一周させるごとに受信量を確かめ、受信量が増えず buffer が空になった時点、stream が終わった時点、
     * または `CANCEL_DRAIN_LIMIT_MS` を過ぎた時点で戻る。
     * 同期の DB 処理などで event loop が直前まで塞がれていた間に届いた data を、stream の破棄で捨てないために使う。
     * @param currentStream: 録画中の stream
     */
    private async readArrivedStreamData(currentStream: http.IncomingMessage): Promise<void> {
        const socket = currentStream.socket;
        const deadline = Date.now() + RecorderModel.CANCEL_DRAIN_LIMIT_MS;
        let lastBytesRead = -1;
        while (currentStream.destroyed === false && currentStream.readableEnded === false && Date.now() < deadline) {
            await new Promise<void>(resolve => setImmediate(resolve));
            if (socket.bytesRead === lastBytesRead && currentStream.readableLength === 0) return;
            lastBytesRead = socket.bytesRead;
        }
    }

    /**
     * 自動予約ルールの予約（番組リレーを除く）で、予約終了時刻を過ぎているか。
     * 予約終了時刻を過ぎてからの取消は、番組を終わりまで録画した正常終了として扱う。同じルールの録画が同時に終わり、
     * 先に終えた録画の完了通知による予約の再計算が、まだ stream の終わりを処理していない録画の予約を削除する場合に当たる。
     * 手動予約と番組リレー予約は、取消の時点で予約がすでに削除されているので対象にしない。
     */
    private hasRuleReservationReachedEnd(): boolean {
        return this.reserve.ruleId !== null && this.reserve.isEventRelay === false && this.reserve.endAt <= Date.now();
    }

    /**
     * 予約のキャンセル
     * @param isPlanToDelete: boolean ファイルが削除される予定か
     */
    public async cancel(isPlanToDelete: boolean): Promise<void> {
        this.log.system.info(
            `recording cancel reserveId: ${this.reserve.id}, recordedId: ${this.recordedId}, isPlanToDelete: ${isPlanToDelete}`,
        );

        if (isPlanToDelete) return this.stopForDeletion();
        if (this.deletionStop !== null) return this.deletionStop.bounded;

        this.isPlanToDelete = false;

        if (this.isPrepRecording === true) {
            await this._cancel();
            // 録画準備失敗を通知
            this.recordingEvent.emitCancelPrepRecording(this.reserve);
        } else if (this.isRecording === true) {
            // 取消の処理中に stream が終わっても、取消として扱うかどうかが変わらないよう、先に決める
            if (this.hasRuleReservationReachedEnd() === false) this.isNeedDeleteReservation = false;
            await this._cancel();
        } else {
            await this._cancel();
        }

        const currentSchedule = this.scheduleBinding;
        currentSchedule?.removeTimeSpecifiedEnd();
        if (!this.hasRegistrationOwner(currentSchedule)) {
            this.transitionSchedulePhase(
                currentSchedule,
                [
                    'Waiting',
                    'Preparing',
                    'RetryWaiting',
                    'Recording',
                    'AwaitingFirstData',
                    'Registering',
                    'RegistrationOverdue',
                ],
                'Cancelled',
            );
        }
    }

    public async finishAtTimeSpecifiedEnd(): Promise<void> {
        this.recordRegistrationTerminationIntent('Cancel');
        this.isCanceledCallingFinished = true;
        this.cancelFirstDataWait();
        // 終了時刻までに受信 socket へ届いている data を読み取り、録画 file へ渡し切ってから止める
        const currentStream = this.stream;
        if (currentStream !== null && RecorderModel.isReadingFromReceiver(currentStream)) {
            await this.readArrivedStreamData(currentStream);
        }
        this.destroyStream();
        void this.recEnd(true).catch(err => {
            this.log.system.error(`time specified recEnd error reserveId: ${this.reserve.id}`);
            this.log.system.error(err);
        });
    }

    public whenDeletionTerminal(): Promise<void> {
        return this.deletionStop?.terminal ?? Promise.resolve();
    }

    public whenNormalRecordingTerminal(): Promise<void> {
        return this.normalRecordingTerminal;
    }

    /**
     * 予約情報を更新する
     * @param newReserve: 新しい予約情報
     * @param isSuppressLog: boolean ログ出力を抑えるか
     */
    public async update(newReserve: Reserve, isSuppressLog: boolean): Promise<void> {
        if (newReserve.isSkip === true || newReserve.isOverlap === true) {
            // skip されたかチェック
            this.log.system.info(
                `cancel recording by skip or overlap reserveId: ${this.reserve.id}, recordedId: ${this.recordedId}`,
            );
            await this.cancel(false).catch(err => {
                this.log.system.error(`cancel recording error: ${newReserve.id}`);
                this.log.system.error(err);
            });
        } else if (this.reserve.startAt !== newReserve.startAt || this.reserve.endAt !== newReserve.endAt) {
            // 時刻に変更がないか確認
            // 録画処理が実行されていない場合
            if (this.isPrepRecording === false && this.isRecording === false) {
                this.setTimer(newReserve, isSuppressLog);
            } else {
                // 録画準備中 or 録画中
                if (this.reserve.programId === null) {
                    // 時間指定予約で時刻に変更があった
                    // TODO 現時点では時刻指定で時間変更を受け入れられるようにな api になっていない
                    // TODO 録画中 or 録画準備中の開始時刻変更にも対応していない
                    if (this.reserve.endAt !== newReserve.endAt) {
                        // 時間指定予約で終了時刻に変更があった
                        this.log.system.info(`change recording endAt: ${newReserve.id}`);

                        if (this.isPrepRecording === true) {
                            // 録画準備中なら録画中になるまで待つ
                            await new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
                                this.log.system.debug(`wait change endAt: ${newReserve.id}`);
                                const onStartRecording = (): void => {
                                    clearTimeout(timeoutId);
                                    resolve();
                                };
                                // タイムアウト設定。reject 前に one-shot listener を外し、待機資源を残さない
                                const timeoutId = setTimeout(() => {
                                    this.eventEmitter.off(RecorderModel.START_RECORDING_EVENT, onStartRecording);
                                    reject(new Error('ChangeEndAtTimeoutError'));
                                }, IRecordingStreamCreator.PREP_TIME);

                                // 録画開始内部イベント発行待ち
                                this.eventEmitter.once(RecorderModel.START_RECORDING_EVENT, onStartRecording);
                            });
                        }

                        const currentSchedule = this.scheduleBinding;
                        if (currentSchedule !== null) {
                            currentSchedule.registerTimeSpecifiedEnd(
                                newReserve.endAt + this.config.timeSpecifiedEndMargin * 1_000,
                            );
                            this.streamCreator.releaseTimeSpecifiedEnd?.(newReserve.id);
                        } else {
                            // 終了時刻変更
                            try {
                                this.streamCreator.changeEndAt(newReserve);
                            } catch (err: any) {
                                this.log.system.error(`change recording endAt: ${newReserve.id}`);
                                this.log.system.error(err);
                            }
                        }
                    }
                } else {
                    // 録画中に終了時間が変更されたらイベントリレーの確認タイマーも再設定する
                    if (this.reserve.endAt !== newReserve.endAt && this.isRecording === true) {
                        this.setEventRelayTimer(newReserve);
                    }

                    if (this.reserve.startAt < newReserve.startAt) {
                        // 開始時刻が遅くなった
                        if (this.isRecording === false) {
                            // まだ録画準備中なのでキャンセルしてタイマーを再セット
                            this.log.system.info(
                                `cancel prepare recording.`,
                                `(reserveId: ${this.reserve.id}, programId: ${this.reserve.programId}, recordedId: ${this.recordedId})`,
                            );
                            const rescheduleSessionToken = this.scheduleBinding?.sessionToken;
                            await this._cancel().catch(err => {
                                this.log.system.error(
                                    `cancel recording error: (reserveId: ${newReserve.id}, programId: ${this.reserve.programId})`,
                                );
                                this.log.system.error(err);
                            });
                            if (rescheduleSessionToken === undefined) {
                                this.setTimer(newReserve, isSuppressLog);
                            } else {
                                const rescheduleSession = this.currentScheduleBinding(rescheduleSessionToken);
                                if (rescheduleSession?.requeueAfterReschedule?.() === true) {
                                    this.setTimer(newReserve, isSuppressLog);
                                }
                            }
                        } else {
                            // 録画中
                            // NOTE:
                            //  EPGstationがスケジュール変更を遅れて把握した可能性がある
                            //  一度ストリームを開始した番組の開始時刻が変更されることはないのでここでは何もしない
                            this.log.system.info(
                                `Ignores schedule changes because this program is already recording.`,
                                ` (reserveId: ${this.reserve.id}, programId: ${this.reserve.programId}, recordedId: ${this.recordedId})`,
                            );
                        }
                    }
                }
            }
        }

        this.reserve = newReserve;

        // update recorded DB
        if (this.isRecording === true && this.recordedId !== null) {
            const recordedId = this.recordedId;
            const recorded = await this.createRecorded();
            this.log.system.info(`update reocrded: ${this.recordedId}`);
            this.recordedDB.updateOnce(recorded).catch(err => {
                this.log.system.error(`update recorded error: ${recordedId}`);
                this.log.system.error(err);
            });
        }
    }

    /**
     * イベントリレーをチェックするためのタイマーをセットする
     * @param reserve: Reserve 予約情報
     */
    /**
     * 録画終了予定時刻の`EVENT_RELAY_CHECK_TIME`前に`checkEventRelay`を実行するタイマーを
     * セットし直す（既存タイマーがあれば張り替える）。番組の中継（イベントリレー）先が
     * 終了間際に判明するケースに備え、録画終了の直前に再確認する。
     * @param reserve 対象の予約情報
     */
    private setEventRelayTimer(reserve: Reserve): void {
        // 除外, 重複しているものはタイマーをセットしない
        if (reserve.isSkip === true || reserve.isOverlap === true) {
            return;
        }

        // 待機時間を計算
        const now = new Date().getTime();
        let time = reserve.endAt - RecorderModel.EVENT_RELAY_CHECK_TIME - now;
        if (time < 0) {
            time = 0;
        }

        // タイマーをセットする
        if (this.eventRelayTimerId !== null) {
            clearTimeout(this.eventRelayTimerId);
        }
        this.eventRelayTimerId = setTimeout(async () => {
            await this.checkEventRelay();
        }, time);
    }

    /**
     * イベントリレーの対象となる予約情報の確認を行う
     */
    private async checkEventRelay(): Promise<void> {
        // ProgramId の指定がない場合は何もしない
        if (this.reserve.programId === null) {
            return;
        }

        this.log.system.debug(
            `check event relay program. reserveId: ${this.reserve.id}, programId: ${this.reserve.programId}`,
        );
        // program 情報の取得
        let parentProgram: TunerProgram;
        try {
            parentProgram = await this.tunerServerAccess.getProgram(this.reserve.programId);
            this.log.system.debug(parentProgram);
        } catch (err: any) {
            this.log.system.error(
                `failed to get event relay info. reserveId: ${this.reserve.id}, programId: ${this.reserve.programId}`,
            );
            return;
        }

        // event relay の設定の有無を調べる
        if (typeof parentProgram.relatedItems === 'undefined') {
            this.log.system.debug(
                `event relay porgram does not exist. reserveId: ${this.reserve.id}, programId: ${this.reserve.programId}`,
            );
            return;
        }

        // event relay 対象の ProgramId のリストを作成する
        const reserveProgramIds: { programId: apid.ProgramId; parentReserve: Reserve }[] = [];
        for (const relatedItem of parentProgram.relatedItems) {
            // type が ralay 出ないなら skip
            if (relatedItem.type !== 'relay') {
                continue;
            }

            // 番組を予約するための networkId を生成する
            let networkId = relatedItem.networkId;
            if (typeof networkId === 'undefined' || networkId === null) {
                // 本来 networkId は null を取らないはずだが、mirakc は null を返す
                // networkId が存在しない場合は自ネットワークのイベントリレーと判断する
                networkId = parentProgram.networkId;
            }

            // networkId, serviceId, eventId から該当する番組情報を検索する
            const reserveProgram = await this.programDB.findEventRelayProgram(
                networkId,
                relatedItem.serviceId,
                relatedItem.eventId,
            );
            if (reserveProgram === null) {
                this.log.system.warn(
                    `event relay program is not found. networkId: ${networkId}, serviceId: ${relatedItem.serviceId}, eventId: ${relatedItem.eventId}`,
                );
                continue;
            }

            // 予約に必要な情報を詰める
            // parentReserve は deep copy して渡す
            reserveProgramIds.push({ programId: reserveProgram.id, parentReserve: Object.assign({}, this.reserve) });
            this.log.system.info(
                `set event relay program. programId ${this.reserve.programId} -> ${reserveProgram.id}`,
            );
        }

        // イベントリレーの ProgramId が存在するなら予約を依頼する
        if (reserveProgramIds.length > 0) {
            this.recordingEvent.emitEventRelay(reserveProgramIds);
        }
    }

    private currentScheduleBinding(
        expectedSessionToken?: RecordingScheduleSessionBinding['sessionToken'],
    ): RecordingScheduleSessionBinding | null {
        const current = this.scheduleBinding;
        if (current === null) return null;
        if (expectedSessionToken !== undefined && current.sessionToken !== expectedSessionToken) return null;
        return current;
    }

    /**
     * `RecordingUtilModel.getRecPath`の排他制御がタイムアウトした（`PathSelectionOverdueError`）
     * 場合の処理。ファイル選択処理自体は`error.terminal`で継続しているため、その完了を待ってから
     * （まだ`PathSelectionOverdue`のままなら）録画を`Cancelled`へ遷移させる。取得済みの
     * ストリームは即座に破棄する。
     * @param error パス選択のタイムアウトを表すエラー（`error.terminal`が実処理の完了を表す）
     * @param scheduledSession 遷移を試みる時点のsession（`null`なら何もしない）
     * @param acquiredStream 破棄する取得済みストリーム（無ければ`null`）
     */
    private handlePathSelectionOverdue(
        error: PathSelectionOverdueError,
        scheduledSession: RecordingScheduleSessionBinding | null,
        acquiredStream: http.IncomingMessage | null,
    ): void {
        const transitioned = this.transitionSchedulePhase(scheduledSession, ['Recording'], 'PathSelectionOverdue');
        this.destroyAcquiredStream(acquiredStream);
        void error.terminal.then(() => {
            if (!transitioned) return;
            const currentSession = scheduledSession!;
            if (!this.isCurrentScheduleBinding(currentSession, 'PathSelectionOverdue')) return;
            this.isPrepRecording = false;
            this.isRecording = false;
            currentSession.removeTimeSpecifiedEnd();
            if (currentSession.tryTransition('PathSelectionOverdue', 'Cancelled')) {
                this.eventEmitter.emit(RecorderModel.CANCEL_EVENT);
            }
        });
    }

    private isCurrentScheduleBinding(
        expected: RecordingScheduleSessionBinding,
        expectedPhase: RecordingScheduleSessionBinding['phase'],
    ): boolean {
        const current = this.currentScheduleBinding(expected.sessionToken);
        if (current === null || current.reservationId !== expected.reservationId) return false;
        // `current` is always the latest bound session (see currentScheduleBinding), so when it
        // exposes isCurrent(), that closure already re-checks generation/token/phase against the
        // latest schedule snapshot on its own terms. Gating on `current.generation === expected.generation`
        // here would compare the latest generation against `expected` -- a snapshot captured when this
        // preparation attempt started, before any same-session rebind -- and wrongly treat a deferred
        // failure from an in-flight attempt as stale merely because the reservation was updated
        // (generation bumped) while still Preparing.
        if (current.isCurrent) return current.isCurrent(expectedPhase);
        return current.generation === expected.generation && current.phase === expectedPhase;
    }

    private findCurrentSchedulePhase(
        expected: RecordingScheduleSessionBinding,
        phases: ReadonlyArray<RecordingScheduleSessionBinding['phase']>,
    ): RecordingScheduleSessionBinding['phase'] | null {
        return phases.find(phase => this.isCurrentScheduleBinding(expected, phase)) ?? null;
    }

    /**
     * 録画準備の失敗を受けて、5秒後に`runPreparation`を再試行するタイマーをセットする
     * （sessionがあれば`RetryWaiting`へ遷移させたうえで）。`retryLifecycleToken`を進めて
     * 直前の（無効化されるべき）リトライ待ちを失効させてから新しい待ちを開始する。
     * タイマー発火時、token・タイマーid・試行回数のいずれかが発火時点と食い違っていれば
     * （その間に別の理由で無効化されていれば）何もしない。
     * @param attempt 今回のリトライの試行回数
     * @param scheduledSession 対象のsession（`null`ならphase遷移をせずに待つだけ）
     * @param currentPhase 遷移元として期待するphase（一致しなければ何もしない）
     */
    private scheduleRetry(
        attempt: number,
        scheduledSession: RecordingScheduleSessionBinding | null,
        currentPhase: RecordingScheduleSessionBinding['phase'] | null,
    ): void {
        if (scheduledSession !== null) {
            if (currentPhase === null) return;
            if (currentPhase === 'RetryWaiting') {
                if (!this.isCurrentScheduleBinding(scheduledSession, 'RetryWaiting')) return;
            } else if (!scheduledSession.tryTransition(currentPhase, 'RetryWaiting')) {
                return;
            }
        }

        this.invalidateRetry();
        const retryToken = this.retryLifecycleToken;
        this.retryAttempt = attempt;
        const timer = setTimeout(() => {
            if (
                this.retryTimerId !== timer ||
                this.retryLifecycleToken !== retryToken ||
                this.retryAttempt !== attempt
            ) {
                return;
            }
            this.retryTimerId = null;
            this.retryAttempt = null;
            if (
                scheduledSession !== null &&
                (!this.isCurrentScheduleBinding(scheduledSession, 'RetryWaiting') ||
                    !scheduledSession.tryTransition('RetryWaiting', 'Preparing'))
            ) {
                return;
            }
            void this.runPreparation(attempt, scheduledSession);
        }, 5_000);
        timer.unref?.();
        this.retryTimerId = timer;
    }

    /** 進行中のリトライ待ちを無効化する（`retryLifecycleToken`を進めて発火済みタイマーの
     *  コールバックを無効にし、タイマー自体もクリアする）。 */
    private invalidateRetry(): void {
        this.retryLifecycleToken += 1n;
        this.retryAttempt = null;
        if (this.retryTimerId === null) return;
        clearTimeout(this.retryTimerId);
        this.retryTimerId = null;
    }

    private runPreparation(
        retry: number = 0,
        scheduledSession: RecordingScheduleSessionBinding | null = this.scheduleBinding,
    ): Promise<void> {
        const lifetime = this.prepRecord(retry, scheduledSession);
        this.preparationLifetime = lifetime;
        const clear = () => {
            if (this.preparationLifetime === lifetime) this.preparationLifetime = null;
        };
        void lifetime.then(clear, clear);
        return lifetime;
    }

    private shouldStopPreparation(): boolean {
        return this.isStopPrepRec;
    }

    /**
     * `cancel(true)`（削除予定のキャンセル）の実処理。重複呼び出しは進行中の`deletionStop.bounded`
     * へ合流する。DB登録処理中であれば直接中断できないため`recordRegistrationTerminationIntent`で
     * `'Deletion'`を記録するに留め、進行中の各処理（準備処理・録画終了処理）の完了を
     * `DeletionTerminalLatch`へ`observe`登録することで、それら全てが終わってから
     * `terminal`（ひいては戻り値の`bounded`）を解決させる。
     * @returns 削除に伴う後始末が全て完了する Promise（`DELETION_STOP_TIMEOUT_MS`超過でreject）
     */
    private stopForDeletion(): Promise<void> {
        if (this.deletionStop !== null) return this.deletionStop.bounded;

        this.isPlanToDelete = true;
        this.isNeedDeleteReservation = false;
        this.recordRegistrationTerminationIntent('Deletion');
        const currentSchedule = this.scheduleBinding;
        const deletionPhase =
            currentSchedule === null
                ? null
                : this.findCurrentSchedulePhase(currentSchedule, [
                      'Waiting',
                      'RetryWaiting',
                      'Preparing',
                      'Recording',
                      'AwaitingFirstData',
                      'Registering',
                      'RegistrationOverdue',
                      'Finishing',
                  ]);
        if (currentSchedule !== null && deletionPhase !== null) {
            currentSchedule.tryTransition(deletionPhase, 'StoppingForDeletion');
        }
        currentSchedule?.removeTimeSpecifiedEnd();

        const latch = new DeletionTerminalLatch();
        const terminal = latch.terminal.then(() => {
            this.isStopPrepRec = false;
            this.isPrepRecording = false;
            this.isRecording = false;
            this.transitionSchedulePhase(
                this.currentScheduleBinding(currentSchedule?.sessionToken),
                ['StoppingForDeletion'],
                'Cancelled',
            );
        });
        const bounded = this.boundDeletionStop(terminal);
        this.deletionStop = { bounded, latch, terminal };

        this.invalidateRetry();
        if (this.timerId !== null) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }

        const preparationLifetime = this.preparationLifetime;
        if (deletionPhase === 'Preparing' && preparationLifetime === null) {
            const preparationCancelled = new Promise<void>(resolve => {
                this.eventEmitter.once(RecorderModel.CANCEL_EVENT, resolve);
            });
            latch.observe(preparationCancelled);
        } else if (deletionPhase === 'RetryWaiting') {
            this.isPrepRecording = false;
        }

        if (preparationLifetime !== null) {
            this.isStopPrepRec = true;
            this.abortController?.abort();
            latch.observe(preparationLifetime);
        } else if (deletionPhase === 'Preparing') {
            this.isStopPrepRec = true;
            this.abortController?.abort();
        }
        this.cancelFirstDataWait();

        const hasUnstartedFinalizationResources =
            this.stream !== null ||
            this.recFile !== null ||
            this.dropLogFileId !== null ||
            this.recordedId !== null ||
            this.isRecording;
        const hasFinalizationWork =
            this.finalizationLifetime !== null ||
            this.finalizationContinuations.size > 0 ||
            hasUnstartedFinalizationResources;
        if (hasFinalizationWork) {
            this.isCanceledCallingFinished = true;
            latch.observe(this.awaitFinalizationForDeletion(hasUnstartedFinalizationResources));
        }

        latch.release();
        return bounded;
    }

    /**
     * `terminal`（削除に伴う後始末の完了）に`DELETION_STOP_TIMEOUT_MS`のタイムアウトを付けて
     * 返す。呼び出し元（`RecordingManageModel`等）が後始末の完了をいつまでも待ち続けないための
     * 安全弁。
     * @param terminal 後始末の完了を表す Promise
     * @returns タイムアウト付きでラップした Promise
     */
    private boundDeletionStop(terminal: Promise<void>): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('DeletionStopTimeoutError')), DELETION_STOP_TIMEOUT_MS);
            timeout.unref?.();
            void terminal.then(
                () => {
                    clearTimeout(timeout);
                    resolve();
                },
                error => {
                    clearTimeout(timeout);
                    reject(error);
                },
            );
        });
    }

    private waitForStreamTerminal(currentStream: http.IncomingMessage | null): Promise<void> {
        if (currentStream === null || currentStream.closed || currentStream.readableEnded) return Promise.resolve();
        return new Promise(resolve => {
            const settle = () => {
                currentStream.removeListener('close', settle);
                currentStream.removeListener('end', settle);
                currentStream.removeListener('error', settle);
                resolve();
            };
            currentStream.once('close', settle);
            currentStream.once('end', settle);
            currentStream.once('error', settle);
        });
    }

    private waitForWriterTerminal(writer: fs.WriteStream | null): Promise<void> {
        if (writer === null || writer.closed) return Promise.resolve();
        return new Promise(resolve => {
            writer.once('close', resolve);
        });
    }

    private stopDropChecker(): Promise<void> | null {
        if (this.dropCheckerStopLifetime !== null) return this.dropCheckerStopLifetime;
        if (this.isDropCheckerActive === false && this.dropLogFileId === null) return null;

        this.isDropCheckerActive = false;
        this.dropCheckerStopLifetime = this.dropChecker.stop();
        return this.dropCheckerStopLifetime;
    }

    private cancelFirstDataWait(): void {
        this.firstDataWait?.cancel();
    }

    private transitionSchedulePhase(
        binding: RecordingScheduleSessionBinding | null,
        expectedPhases: ReadonlyArray<Parameters<RecordingScheduleSessionBinding['tryTransition']>[0]>,
        nextPhase: Parameters<RecordingScheduleSessionBinding['tryTransition']>[1],
    ): boolean {
        if (binding === null) return false;
        for (const expectedPhase of expectedPhases) {
            if (!binding.tryTransition(expectedPhase, nextPhase)) continue;
            if (nextPhase === 'Completed' || nextPhase === 'Cancelled') this.invalidateRetry();
            return true;
        }
        return false;
    }

    /**
     * タイマーを再設定する
     * @return boolean セットに成功したら true を返す
     */
    public resetTimer(): boolean {
        // 録画中ならイベントリレーのチェック用のタイマーを再設定
        if (this.isRecording === true) {
            if (this.eventRelayTimerId !== null) {
                this.setEventRelayTimer(this.reserve);
            }
            return true;
        }

        return this.setTimer(this.reserve, false);
    }
}

namespace RecorderModel {
    /** 取消・時刻指定終了のときに、受信 socket へ届いている data を読み切るのを待つ上限 */
    export const CANCEL_DRAIN_LIMIT_MS = 1000;
    export const CANCEL_EVENT = 'RecordingCancelEvent';
    export const START_RECORDING_EVENT = 'StartRecordingEvent';
    export const EVENT_RELAY_CHECK_TIME = 20 * 1000; // イベントリレーの確認時間 20秒
}

export default RecorderModel;
declare const __EPGSTATION_COVERAGE_EXCLUSION_RECORDER_MODEL_ONDATA_TIMEOUT_GUARDS_20260924: unique symbol;
