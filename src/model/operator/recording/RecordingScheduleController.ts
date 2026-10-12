import Reserve from '../../../db/entities/Reserve.js';
import { IReserveUpdateValues } from '../../event/IReserveEvent.js';
import RecordingCandidateRegistry, {
    RecordingCandidate,
    RecordingGeneration,
    RecordingPhase,
} from './RecordingCandidateRegistry.js';

/**
 * 明示的なdeadlineが1つも無い場合に使う、最大待機時間（poll間隔）。`computeNextDelay`の上限として使われ、
 * 何らかの理由でdeadline計算が漏れていても、この間隔ごとに再評価が走ることで復旧できるようにする安全網。
 */
export const SCAN_INTERVAL_MS = 3_000;

declare const controllerTokenBrand: unique symbol;
declare const recordingSessionTokenBrand: unique symbol;

/**
 * 「予約待ち（timer/microtask）」1回分を指す不透明な識別子。新しいtokenを発行して
 * `currentControllerToken`を差し替えることで、それより前に予約された timer/microtask のcallbackを
 * 実際にキャンセルせずとも「古い呼び出しである」と判定して無視できるようにする。
 */
type ControllerToken = bigint & {
    readonly [controllerTokenBrand]: 'ControllerToken';
};

/**
 * 1つの予約（reservation）についての「録画session」を指す不透明な識別子。同じ予約でも
 * 内容が変わって`RecordingGeneration`が進むと新しいsession tokenが発行され、古いtokenを握ったままの
 * 非同期処理（`dispatchPreparation`等）は`tryTransitionSession`の照合で無効化される。
 */
export type RecordingSessionToken = bigint & {
    readonly [recordingSessionTokenBrand]: 'RecordingSessionToken';
};

/** `RecordingScheduleScheduler.setTimeout`が返す、予約したtimerを取り消すための操作。 */
export interface RecordingScheduleCancelHandle {
    cancel(): void;
}

/** 現在時刻の取得を差し替え可能にするための抽象。test側で任意の時刻を注入するために使う。 */
export interface RecordingScheduleClock {
    now(): number;
}

/** timer/microtaskの発行を差し替え可能にするための抽象。実運用では`setTimeout`/`queueMicrotask`を薄く包む。 */
export interface RecordingScheduleScheduler {
    setTimeout(callback: () => void, delayMs: number): RecordingScheduleCancelHandle;
    queueMicrotask(callback: () => void): void;
}

/**
 * 予約1件についての現在の録画進行状況のsnapshot。
 * `generation`は元になった`RecordingCandidate`の世代、`sessionToken`はこのsession固有の識別子
 * （世代が変われば発行し直される）、`phase`は現在の録画phase。
 */
export interface RecordingSessionSnapshot {
    readonly reservationId: number;
    readonly generation: RecordingGeneration;
    readonly sessionToken: RecordingSessionToken;
    readonly phase: RecordingPhase;
}

/**
 * 時刻指定予約（`TimeSpecified`）の終了予定時刻の登録要求。呼び出し側（録画session）が
 * 「この時刻になったら終了処理を呼んでほしい」と伝えるために使う。`sessionToken`を指定すると、
 * 登録時点のsessionと一致する場合のみ登録される（既に別sessionへ切り替わっていた場合は無視）。
 */
export interface TimeSpecifiedEndMilestone {
    readonly reservationId: number;
    readonly generation: RecordingGeneration;
    readonly sessionToken?: RecordingSessionToken;
    readonly dueAt: number;
}

/** 実際に内部で保持する形。登録が受理された時点のsessionへ`sessionToken`を確定させたもの。 */
interface RegisteredTimeSpecifiedEndMilestone extends TimeSpecifiedEndMilestone {
    readonly sessionToken: RecordingSessionToken;
}

/**
 * 予約の追加・更新・削除が録画候補（`RecordingCandidate`）へ反映されたことを外部へ通知するevent。
 * `previous*`系のfieldは反映前の状態（無ければ新規）。`isSuppressLog`は呼び出し元がログ出力を
 * 抑制したいかどうかをそのまま伝える。
 */
export interface RecordingScheduleMutationDispatch {
    readonly action: 'insert' | 'update' | 'remove';
    readonly reservationId: number;
    readonly reservation: Readonly<Reserve>;
    readonly candidate?: RecordingCandidate;
    readonly generation: RecordingGeneration;
    readonly sessionToken?: RecordingSessionToken;
    readonly phase?: RecordingPhase;
    readonly previousGeneration?: RecordingGeneration;
    readonly previousSessionToken?: RecordingSessionToken;
    readonly previousPhase?: RecordingPhase;
    readonly isSuppressLog: boolean;
}

/** `requestReset()`が要求する全件再構築が実際に処理されたことを表す内部dispatch。 */
interface RecordingScheduleResetDispatch {
    readonly action: 'reset';
    readonly reservationId: -1;
}

/** 受理した予約変更の形式が不正だった等、dispatch対象を特定できないerrorを報告する際のcontext。 */
interface InvalidRecordingScheduleMutation {
    readonly action: 'invalid';
    readonly reservationId: -1;
}

/** `reportDispatchError`へ渡す、error発生時の文脈情報の判別共用体。 */
type RecordingScheduleDispatchContext =
    | RecordingCandidate
    | RegisteredTimeSpecifiedEndMilestone
    | RecordingScheduleMutationDispatch
    | RecordingScheduleResetDispatch
    | InvalidRecordingScheduleMutation;

/**
 * 時刻指定予約の終了milestoneを有効とみなすphaseの集合。これ以外のphase（`Waiting`や`Completed`等）に
 * 遷移した候補の登録済みmilestoneは、次回評価時に無効として取り除かれる。
 */
const ACTIVE_TIME_SPECIFIED_END_PHASES: ReadonlySet<RecordingPhase> = new Set([
    'Recording',
    'PathSelectionOverdue',
    'AwaitingFirstData',
    'Registering',
    'RegistrationOverdue',
]);

/** `RecordingScheduleController`が動作に必要とする外部依存とcallback群。 */
interface RecordingScheduleControllerDependencies {
    readonly candidateRegistry: RecordingCandidateRegistry;
    readonly clock: RecordingScheduleClock;
    readonly scheduler: RecordingScheduleScheduler;
    readonly dispatchMutation?: (mutation: RecordingScheduleMutationDispatch) => void | Promise<void>;
    readonly dispatchPreparation: (
        candidate: RecordingCandidate,
        expectedGeneration: RecordingGeneration,
        expectedSessionToken: RecordingSessionToken,
    ) => void | Promise<void>;
    readonly dispatchReset?: () => void | Promise<void>;
    readonly dispatchTimeSpecifiedEnd: (milestone: RegisteredTimeSpecifiedEndMilestone) => void | Promise<void>;
    readonly reportDispatchError: (error: unknown, context: RecordingScheduleDispatchContext) => void;
}

/**
 * 次に評価を起こすべきまでの待機時間を、既知のdeadline群から算出する。
 * @param now 現在時刻。
 * @param schedulerOwnedDeadlines 現時点で把握している全deadline（候補の`prepareAt`、
 *                                 時刻指定終了の`dueAt`）の一覧。
 * @returns 最も近いdeadlineまでの時間。ただし`SCAN_INTERVAL_MS`を上限とし、deadlineが1つも
 *          無い場合は`SCAN_INTERVAL_MS`そのものを返す（安全網としての定期再評価）。
 */
export const computeNextDelay = (now: number, schedulerOwnedDeadlines: readonly number[]): number => {
    const earliestAt = schedulerOwnedDeadlines.reduce(
        (earliest, dueAt) => Math.min(earliest, dueAt),
        Number.POSITIVE_INFINITY,
    );
    const untilEarliest = Number.isFinite(earliestAt) ? Math.max(0, earliestAt - now) : SCAN_INTERVAL_MS;
    return Math.min(SCAN_INTERVAL_MS, untilEarliest);
};

/**
 * 予約（`Reserve`）の変更を受け取り、`RecordingCandidateRegistry`上の録画候補へ反映しつつ、
 * 「準備開始時刻（`prepareAt`）が来た候補の準備開始」と「時刻指定予約の終了時刻が来た終了処理」を
 * 適切なタイミングで呼び出す、単一timerのスケジューラ。
 *
 * 全体の流れ:
 * 1. `acceptMutation`で受け取った予約差分はいったんqueueに溜め、microtaskへ合流させてから
 *    `evaluate()`で一括反映する（同期的に複数回呼ばれても1回の評価にまとめるため）。
 * 2. `evaluate()`は「queueの反映」→「準備開始が必要な候補のdispatch」→「終了時刻が来たmilestoneの
 *    dispatch」の順に処理し、途中で新たな作業が積まれたら`started`である限りloopし直す。
 * 3. 評価が落ち着いたら、次に何かが起きるはずの最短時刻に合わせてtimerを1本だけ張り直す
 *    （`armSingleWake`）。
 * `RecordingGeneration`と`RecordingSessionToken`により、非同期dispatchの実行時点で予約が
 * 既に別内容へ置き換わっていないかを都度確認し、古い世代に基づく操作が状態を壊さないようにしている。
 */
class RecordingScheduleController {
    /** 予約から導出した録画候補の集合を保持する registry。候補のCRUDと世代管理はここに委譲する。 */
    private readonly candidateRegistry: RecordingCandidateRegistry;
    /** 現在時刻の取得口。 */
    private readonly clock: RecordingScheduleClock;
    /** timer/microtaskの発行口。 */
    private readonly scheduler: RecordingScheduleScheduler;
    /** 候補の追加・更新・削除が確定した際に呼ぶcallback（未指定時は何もしない関数で埋める）。 */
    private readonly dispatchMutation: NonNullable<RecordingScheduleControllerDependencies['dispatchMutation']>;
    /** 候補の準備開始時刻が来た際に呼ぶcallback。 */
    private readonly dispatchPreparation: RecordingScheduleControllerDependencies['dispatchPreparation'];
    /** `requestReset()`による全件再構築が確定した際に呼ぶcallback（未指定時は何もしない関数で埋める）。 */
    private readonly dispatchReset: NonNullable<RecordingScheduleControllerDependencies['dispatchReset']>;
    /** 時刻指定予約の終了時刻が来た際に呼ぶcallback。 */
    private readonly dispatchTimeSpecifiedEnd: RecordingScheduleControllerDependencies['dispatchTimeSpecifiedEnd'];
    /** 上記各dispatch callbackが例外・rejectを起こした際に報告する先。 */
    private readonly reportDispatchError: RecordingScheduleControllerDependencies['reportDispatchError'];
    /** 予約IDごとに登録されている、時刻指定予約の終了milestone。 */
    private readonly timeSpecifiedEnds = new Map<number, RegisteredTimeSpecifiedEndMilestone>();
    /** 予約IDごとの現在の録画session snapshot（phase・sessionTokenの現在値）。 */
    private readonly sessions = new Map<number, RecordingSessionSnapshot>();
    /** `acceptMutation`で受け取り、まだ`evaluate()`へ反映されていない予約差分のqueue。 */
    private readonly queuedMutations: IReserveUpdateValues[] = [];
    /** `whenIdle()`の呼び出しで待たされている、idle化を待つ側のresolve関数の一覧。 */
    private readonly idleWaiters: Array<() => void> = [];
    /** 現在張られているtimerのcancel handle（張られていなければ`undefined`）。 */
    private armedWake: RecordingScheduleCancelHandle | undefined;
    /** `ControllerToken`発行用の単調増加counter。 */
    private controllerTokenCounter = 0n;
    /** `RecordingSessionToken`発行用の単調増加counter。 */
    private sessionTokenCounter = 0n;
    /** 直近に発行・採用された`ControllerToken`。timer/microtaskのcallbackはこれと一致する場合のみ有効。 */
    private currentControllerToken = 0n as ControllerToken;
    /** `evaluate()`が現在実行中かどうか（再入防止・`wake()`からの再実行要求判定に使う）。 */
    private evaluationRunning = false;
    /** 合流用のmicrotaskが予約済みかどうか（同一microtaskでの重複予約防止）。 */
    private microtaskScheduled = false;
    /** `evaluate()`実行中に新たな作業が来たため、loopを続けるべきという要求フラグ。 */
    private rerunRequested = false;
    /** `requestReset()`によって全件再構築が要求されているかどうか。 */
    private resetRequested = false;
    /** `start()`が呼ばれ、稼働中かどうか。`stop()`されると各種状態がクリアされ`false`に戻る。 */
    private started = false;

    constructor(dependencies: RecordingScheduleControllerDependencies) {
        this.candidateRegistry = dependencies.candidateRegistry;
        this.clock = dependencies.clock;
        this.scheduler = dependencies.scheduler;
        this.dispatchMutation = dependencies.dispatchMutation ?? (() => undefined);
        this.dispatchPreparation = dependencies.dispatchPreparation;
        this.dispatchReset = dependencies.dispatchReset ?? (() => undefined);
        this.dispatchTimeSpecifiedEnd = dependencies.dispatchTimeSpecifiedEnd;
        this.reportDispatchError = dependencies.reportDispatchError;
    }

    /** スケジューラを稼働状態にし、直ちに1回評価を起こす。既に稼働中なら何もしない。 */
    public async start(): Promise<void> {
        if (this.started) return;
        this.started = true;
        this.wake();
    }

    /** スケジューラを停止し、queueや登録済みsession/milestoneをすべて破棄する。timerも解除する。 */
    public stop(): void {
        this.started = false;
        this.rerunRequested = false;
        this.resetRequested = false;
        this.queuedMutations.splice(0);
        this.timeSpecifiedEnds.clear();
        this.sessions.clear();
        this.invalidateScheduledWake();
        this.resolveIdleWaiters();
    }

    /**
     * 予約の追加・更新・削除差分を受け取り、評価queueへ積む。
     * 受け取った内容は`copyMutation`で検証・複製してから保持する（呼び出し元が後から内容を書き換えても
     * 影響しないようにするため）。形式が不正な場合は評価へは回さず、error報告のみ行う。
     */
    public acceptMutation(mutation: IReserveUpdateValues): void {
        try {
            this.queuedMutations.push(this.copyMutation(mutation));
            this.requestCoalescedEvaluation();
        } catch (error: unknown) {
            this.report(error, { action: 'invalid', reservationId: -1 });
        }
    }

    /** 次回評価時に全件再構築（`dispatchReset`呼び出し）を行うよう要求する。 */
    public requestReset(): void {
        this.resetRequested = true;
        this.requestCoalescedEvaluation();
    }

    /** 現在idle（評価中でも、queueにも何も無い状態）ならすぐ解決し、そうでなければidleになるまで待つ。 */
    public whenIdle(): Promise<void> {
        if (this.isIdle()) return Promise.resolve();
        return new Promise(resolve => {
            this.idleWaiters.push(resolve);
        });
    }

    /**
     * 予約されているtimerを無視して、直ちに評価を行わせる。稼働していなければ何もしない。
     * 既に評価実行中であれば、その評価の完了後にもう一度評価し直すよう要求するだけに留める
     * （評価の再入は行わない）。
     */
    public wake(): void {
        if (!this.started) return;
        if (this.evaluationRunning) {
            this.rerunRequested = true;
            return;
        }

        this.invalidateScheduledWake();
        this.evaluate();
    }

    /** 指定予約の現在のsession snapshotを返す。対応する候補が無ければ`undefined`。 */
    public getSessionSnapshot(reservationId: number): RecordingSessionSnapshot | undefined {
        const candidate = this.candidateRegistry.get(reservationId);
        if (candidate === undefined) return undefined;
        return this.ensureSession(candidate);
    }

    /**
     * 指定した予約のphaseを、期待する世代・sessionToken・現在phaseが一致する場合のみ次のphaseへ進める。
     * 呼び出し時点から状況が変わっていた場合（世代が進んだ、sessionが切り替わった、既に別phaseへ
     * 遷移済み等）は何もせず`false`を返す、楽観的並行制御。
     * @returns 遷移できたかどうか。
     */
    public tryTransitionSession(
        reservationId: number,
        expectedGeneration: RecordingGeneration,
        expectedSessionToken: RecordingSessionToken,
        expectedPhase: RecordingPhase,
        nextPhase: RecordingPhase,
    ): boolean {
        const candidate = this.candidateRegistry.get(reservationId);
        if (candidate === undefined) return false;
        const session = this.ensureSession(candidate);
        if (session.sessionToken !== expectedSessionToken) return false;
        if (!this.candidateRegistry.tryTransitionPhase(reservationId, expectedGeneration, expectedPhase, nextPhase)) {
            return false;
        }

        this.sessions.set(
            reservationId,
            Object.freeze({ ...session, phase: nextPhase }) satisfies RecordingSessionSnapshot,
        );
        if (nextPhase === 'Completed' || nextPhase === 'Cancelled') {
            this.timeSpecifiedEnds.delete(reservationId);
        }
        return true;
    }

    /**
     * 時刻指定予約の終了milestoneを登録する。対応する候補が無い、指定した`sessionToken`が現在の
     * sessionと不一致、または現在のphaseが「終了待ちとして有効な」phase集合の外である場合は登録しない。
     */
    public registerTimeSpecifiedEnd(milestone: TimeSpecifiedEndMilestone): void {
        const candidate = this.candidateRegistry.get(milestone.reservationId);
        if (candidate === undefined) return;
        const session = this.ensureSession(candidate);
        if (milestone.sessionToken !== undefined && milestone.sessionToken !== session.sessionToken) return;

        const registered = Object.freeze({
            ...milestone,
            sessionToken: session.sessionToken,
        }) satisfies RegisteredTimeSpecifiedEndMilestone;
        if (!this.isActiveTimeSpecifiedMilestone(candidate, registered)) return;

        this.timeSpecifiedEnds.set(milestone.reservationId, registered);
        this.wake();
    }

    /**
     * 登録済みの時刻指定終了milestoneを取り除く。`expectedGeneration`/`expectedSessionToken`を
     * 指定した場合、登録されているものと一致しなければ何もしない（既に別のmilestoneへ置き換わっている
     * ケースで誤って取り除かないためのガード）。
     */
    public removeTimeSpecifiedEnd(
        reservationId: number,
        expectedGeneration?: RecordingGeneration,
        expectedSessionToken?: RecordingSessionToken,
    ): void {
        const registered = this.timeSpecifiedEnds.get(reservationId);
        if (registered === undefined) return;
        if (expectedGeneration !== undefined && registered.generation !== expectedGeneration) return;
        if (expectedSessionToken !== undefined && registered.sessionToken !== expectedSessionToken) return;
        this.timeSpecifiedEnds.delete(reservationId);
        this.wake();
    }

    /**
     * 評価本体。queueの反映→準備dispatch→終了milestoneのdispatchの順に行い、途中で新たな作業が
     * 積まれた場合は`started`である限りloopし直す。最後に次回のtimerを1本だけ張り直す。
     */
    private evaluate(): void {
        this.evaluationRunning = true;
        try {
            do {
                this.rerunRequested = false;
                this.applyQueuedWork();
                if (this.hasQueuedWork()) {
                    this.rerunRequested = true;
                    continue;
                }
                this.dispatchDuePreparations();
                if (this.hasQueuedWork()) {
                    this.rerunRequested = true;
                    continue;
                }
                this.dispatchDueTimeSpecifiedEnds();
            } while (this.started && (this.rerunRequested || this.hasQueuedWork()));
        } catch (error: unknown) {
            this.report(error, { action: 'invalid', reservationId: -1 });
        } finally {
            this.evaluationRunning = false;
            if (this.started) this.armSingleWake();
            this.resolveIdleWaiters();
        }
    }

    /** queueに溜まった予約差分（挿入・更新・削除）と、要求されていたresetを候補registryへ反映する。 */
    private applyQueuedWork(): void {
        const mutations = this.queuedMutations.splice(0);
        const shouldReset = this.resetRequested;
        this.resetRequested = false;

        for (const mutation of mutations) {
            for (const reservation of mutation.insert ?? []) {
                this.applyUpsert(reservation, mutation.isSuppressLog, 'insert');
            }
            for (const reservation of mutation.update ?? []) {
                this.applyUpsert(reservation, mutation.isSuppressLog, 'update');
            }
            for (const reservation of mutation.delete ?? []) {
                this.applyRemove(reservation, mutation.isSuppressLog);
            }
        }

        if (shouldReset) {
            const context = { action: 'reset', reservationId: -1 } as const;
            this.launch(() => this.dispatchReset(), context);
        }
    }

    /**
     * 1件の予約の追加・更新をcandidate registryへ反映し、`insert`/`update`/`remove`のいずれかの
     * mutation dispatchを起こす。`update`で既存sessionがある場合はphase・sessionTokenを引き継ぎ
     * （録画進行中の状態を保つ）、`insert`または候補が存在しなくなった場合は新規sessionとして扱う。
     */
    private applyUpsert(reservation: Reserve, isSuppressLog: boolean, source: 'insert' | 'update'): void {
        const previousCandidate = this.candidateRegistry.get(reservation.id);
        const previousSession = previousCandidate === undefined ? undefined : this.ensureSession(previousCandidate);
        const preserveSession = source === 'update' && previousSession !== undefined;
        const phase = preserveSession ? previousSession.phase : 'Waiting';
        const candidate = this.candidateRegistry.upsert(reservation, phase);
        this.timeSpecifiedEnds.delete(reservation.id);

        if (candidate === null) {
            this.sessions.delete(reservation.id);
            if (previousSession !== undefined) {
                this.launchMutation({
                    action: 'remove',
                    reservationId: reservation.id,
                    reservation: Object.freeze({ ...reservation }) as Readonly<Reserve>,
                    generation: this.candidateRegistry.latestGeneration(reservation.id)!,
                    previousGeneration: previousSession.generation,
                    previousSessionToken: previousSession.sessionToken,
                    previousPhase: previousSession.phase,
                    isSuppressLog,
                });
            }
            return;
        }

        const session = Object.freeze({
            reservationId: candidate.reservationId,
            generation: candidate.generation,
            sessionToken: preserveSession ? previousSession.sessionToken : this.issueSessionToken(),
            phase: candidate.phase,
        }) satisfies RecordingSessionSnapshot;
        this.sessions.set(candidate.reservationId, session);
        this.launchMutation({
            action: preserveSession ? 'update' : 'insert',
            reservationId: candidate.reservationId,
            reservation: candidate.reservation,
            candidate,
            generation: candidate.generation,
            sessionToken: session.sessionToken,
            phase: session.phase,
            previousGeneration: previousSession?.generation,
            previousSessionToken: previousSession?.sessionToken,
            previousPhase: previousSession?.phase,
            isSuppressLog,
        });
    }

    /** 1件の予約の削除をcandidate registryへ反映し、`remove` mutation dispatchを起こす。 */
    private applyRemove(reservation: Reserve, isSuppressLog: boolean): void {
        const previousCandidate = this.candidateRegistry.get(reservation.id);
        const previousSession = previousCandidate === undefined ? undefined : this.ensureSession(previousCandidate);
        const generation = this.candidateRegistry.remove(reservation.id);
        this.sessions.delete(reservation.id);
        this.timeSpecifiedEnds.delete(reservation.id);
        this.launchMutation({
            action: 'remove',
            reservationId: reservation.id,
            reservation: Object.freeze({ ...reservation }) as Readonly<Reserve>,
            generation,
            previousGeneration: previousSession?.generation,
            previousSessionToken: previousSession?.sessionToken,
            previousPhase: previousSession?.phase,
            isSuppressLog,
        });
    }

    /** `dispatchMutation`を`launch`経由（fire-and-forget、error捕捉付き）で呼び出す。 */
    private launchMutation(mutation: RecordingScheduleMutationDispatch): void {
        this.launch(() => this.dispatchMutation(mutation), mutation);
    }

    /**
     * `Waiting`phaseの候補を順に見て、終了時刻を過ぎていれば`Completed`へ、準備開始時刻
     * （`prepareAt`）を過ぎていれば`Preparing`へ遷移させ`dispatchPreparation`を呼ぶ。
     * 途中でqueueに新たな作業が積まれたら、残りの候補は次回evaluateへ持ち越すために打ち切る。
     */
    private dispatchDuePreparations(): void {
        for (const current of this.candidateRegistry.list()) {
            if (!this.started || this.hasQueuedWork()) return;

            const now = this.clock.now();
            if (current.phase !== 'Waiting') continue;
            const session = this.ensureSession(current);
            if (current.endAt <= now) {
                this.tryTransitionSession(
                    current.reservationId,
                    current.generation,
                    session.sessionToken,
                    'Waiting',
                    'Completed',
                );
                continue;
            }
            if (current.prepareAt > now) continue;

            if (
                !this.tryTransitionSession(
                    current.reservationId,
                    current.generation,
                    session.sessionToken,
                    'Waiting',
                    'Preparing',
                )
            ) {
                continue;
            }

            const claimed = this.candidateRegistry.get(current.reservationId)!;
            this.launch(() => this.dispatchPreparation(claimed, current.generation, session.sessionToken), claimed);
        }
    }

    /**
     * 登録済みの時刻指定終了milestoneを順に見て、有効でなくなっていれば取り除き、
     * 終了予定時刻（`dueAt`）を過ぎていれば`Finishing`へ遷移させ`dispatchTimeSpecifiedEnd`を呼ぶ。
     * 途中でqueueに新たな作業が積まれたら、残りは次回evaluateへ持ち越すために打ち切る。
     */
    private dispatchDueTimeSpecifiedEnds(): void {
        for (const observed of this.timeSpecifiedEnds.values()) {
            if (!this.started || this.hasQueuedWork()) return;

            const candidate = this.candidateRegistry.get(observed.reservationId);
            if (candidate === undefined) continue;
            const session = this.ensureSession(candidate);
            if (!this.isActiveTimeSpecifiedMilestone(candidate, observed)) {
                this.timeSpecifiedEnds.delete(observed.reservationId);
                continue;
            }

            if (observed.dueAt > this.clock.now()) continue;
            if (
                !this.tryTransitionSession(
                    observed.reservationId,
                    observed.generation,
                    observed.sessionToken,
                    session.phase,
                    'Finishing',
                )
            ) {
                continue;
            }
            this.timeSpecifiedEnds.delete(observed.reservationId);
            this.launch(() => this.dispatchTimeSpecifiedEnd(observed), observed);
        }
    }

    /** dispatch操作を実行し、同期例外・Promise rejectionのいずれも`report`へ回す（呼び出し元へは伝播させない）。 */
    private launch(operation: () => void | Promise<void>, context: RecordingScheduleDispatchContext): void {
        try {
            void Promise.resolve(operation()).catch(error => {
                this.report(error, context);
            });
        } catch (error: unknown) {
            this.report(error, context);
        }
    }

    /** `reportDispatchError`へ委譲する。委譲先自体が例外を投げても評価loopを壊さないよう握りつぶす。 */
    private report(error: unknown, context: RecordingScheduleDispatchContext): void {
        try {
            this.reportDispatchError(error, context);
        } catch {
            // The synchronous acceptance boundary must not leak observer failures.
        }
    }

    /**
     * 次に何か起きるはずの最短時刻に合わせてtimerを1本だけ張る。既に時刻を過ぎているdeadlineがある
     * （`delay === 0`）場合はtimerではなくmicrotaskで即時に再評価する。
     */
    private armSingleWake(): void {
        const now = this.clock.now();
        const delay = computeNextDelay(now, this.schedulerOwnedDeadlines());
        if (delay === 0) {
            this.scheduleMicrotaskWake();
            return;
        }

        const token = this.issueControllerToken();
        this.currentControllerToken = token;
        this.armedWake = this.scheduler.setTimeout(() => {
            if (!this.started || token !== this.currentControllerToken) return;
            this.armedWake = undefined;
            this.evaluate();
        }, delay);
    }

    /**
     * 現時点で把握している全deadlineを集める。`Waiting`phaseの候補の`prepareAt`と、有効な
     * 時刻指定終了milestoneの`dueAt`。走査のついでに、既に無効化された古いmilestoneを取り除く。
     */
    private schedulerOwnedDeadlines(): number[] {
        const deadlines = this.candidateRegistry
            .list()
            .filter(candidate => candidate.phase === 'Waiting')
            .map(candidate => candidate.prepareAt);

        for (const milestone of this.timeSpecifiedEnds.values()) {
            const candidate = this.candidateRegistry.get(milestone.reservationId);
            if (candidate !== undefined && this.isActiveTimeSpecifiedMilestone(candidate, milestone)) {
                deadlines.push(milestone.dueAt);
            } else {
                this.timeSpecifiedEnds.delete(milestone.reservationId);
            }
        }
        return deadlines;
    }

    /** 登録済みmilestoneが、対象候補の現在の世代・種別・phaseと矛盾せず、まだ有効かどうかを判定する。 */
    private isActiveTimeSpecifiedMilestone(
        candidate: RecordingCandidate,
        milestone: RegisteredTimeSpecifiedEndMilestone,
    ): boolean {
        return (
            candidate.generation === milestone.generation &&
            candidate.kind === 'TimeSpecified' &&
            ACTIVE_TIME_SPECIFIED_END_PHASES.has(candidate.phase)
        );
    }

    /**
     * 指定候補に対応するsessionを返す。既存sessionの世代が候補の現在の世代と一致すればそれを返し、
     * 一致しなければ（候補が更新された等）新しいsession tokenで作り直して登録する。
     */
    private ensureSession(candidate: RecordingCandidate): RecordingSessionSnapshot {
        const current = this.sessions.get(candidate.reservationId);
        if (current?.generation === candidate.generation) return current;

        const created = Object.freeze({
            reservationId: candidate.reservationId,
            generation: candidate.generation,
            sessionToken: this.issueSessionToken(),
            phase: candidate.phase,
        }) satisfies RecordingSessionSnapshot;
        this.sessions.set(candidate.reservationId, created);
        return created;
    }

    /**
     * 評価を1回分、microtaskへ合流させる形で要求する。評価実行中なら再実行フラグを立てるだけ、
     * 既にmicrotaskが予約済みなら何もしない（複数回の要求を1回の評価へまとめる）。
     */
    private requestCoalescedEvaluation(): void {
        if (!this.started) return;
        if (this.evaluationRunning) {
            this.rerunRequested = true;
            return;
        }
        if (this.microtaskScheduled) return;

        this.cancelArmedWake();
        this.scheduleMicrotaskWake();
    }

    /** 現在張られているtimerを、microtaskでの評価要求に置き換える。 */
    private scheduleMicrotaskWake(): void {
        if (this.microtaskScheduled) return;
        const token = this.issueControllerToken();
        this.currentControllerToken = token;
        this.microtaskScheduled = true;
        try {
            this.scheduler.queueMicrotask(() => {
                if (!this.started || token !== this.currentControllerToken) return;
                this.microtaskScheduled = false;
                this.evaluate();
            });
        } catch (error: unknown) {
            this.microtaskScheduled = false;
            this.report(error, { action: 'invalid', reservationId: -1 });
            this.resolveIdleWaiters();
        }
    }

    /** 張られているtimerがあれば、その`ControllerToken`を無効化してから明示的にキャンセルする。 */
    private cancelArmedWake(): void {
        if (this.armedWake === undefined) return;
        this.currentControllerToken = this.issueControllerToken();
        this.armedWake.cancel();
        this.armedWake = undefined;
    }

    /** 予約済みのtimer・microtaskをすべて無効化する（`ControllerToken`の差し替えとcancel呼び出し）。 */
    private invalidateScheduledWake(): void {
        this.currentControllerToken = this.issueControllerToken();
        this.armedWake?.cancel();
        this.armedWake = undefined;
        this.microtaskScheduled = false;
    }

    /** まだ反映していない予約差分、または保留中のresetがあるかどうか。 */
    private hasQueuedWork(): boolean {
        return this.queuedMutations.length > 0 || this.resetRequested;
    }

    /** 評価も実行中でなく、予約済みmicrotaskも無く、保留中の作業も無い状態かどうか。 */
    private isIdle(): boolean {
        return !this.evaluationRunning && !this.microtaskScheduled && !this.hasQueuedWork();
    }

    /** 現在idleであれば、`whenIdle()`で待っている全ての呼び出し元を解決する。 */
    private resolveIdleWaiters(): void {
        if (!this.isIdle()) return;
        for (const resolve of this.idleWaiters.splice(0)) resolve();
    }

    /**
     * 受け取った予約差分の形式を検証しつつ複製する。呼び出し元が保持する元のobjectを後から
     * 書き換えても、queueに積んだ内容には影響しないようにするため。形式が不正なら例外を投げる。
     */
    private copyMutation(mutation: IReserveUpdateValues): IReserveUpdateValues {
        if (mutation === null || typeof mutation !== 'object' || typeof mutation.isSuppressLog !== 'boolean') {
            throw new TypeError('InvalidRecordingMutation');
        }
        return {
            insert: this.copyMutationRows(mutation.insert),
            update: this.copyMutationRows(mutation.update),
            delete: this.copyMutationRows(mutation.delete),
            isSuppressLog: mutation.isSuppressLog,
        };
    }

    /** `copyMutation`の行配列版。各行が`Reserve`らしい形（少なくとも`id`がnumber）かを検証しつつ複製する。 */
    private copyMutationRows(rows: Reserve[] | undefined): Reserve[] | undefined {
        if (rows === undefined) return undefined;
        if (!Array.isArray(rows)) throw new TypeError('InvalidRecordingMutationRows');
        return rows.map(row => {
            if (row === null || typeof row !== 'object' || typeof row.id !== 'number') {
                throw new TypeError('InvalidRecordingMutationReservation');
            }
            return { ...row } as Reserve;
        });
    }

    /** 新しい`ControllerToken`を発行する。 */
    private issueControllerToken(): ControllerToken {
        this.controllerTokenCounter += 1n;
        return this.controllerTokenCounter as ControllerToken;
    }

    /** 新しい`RecordingSessionToken`を発行する。 */
    private issueSessionToken(): RecordingSessionToken {
        this.sessionTokenCounter += 1n;
        return this.sessionTokenCounter as RecordingSessionToken;
    }
}

export default RecordingScheduleController;
declare const __EPGSTATION_COVERAGE_EXCLUSION_RECORDING_SCHEDULE_MICROTASK_GUARD_20260924: unique symbol;
