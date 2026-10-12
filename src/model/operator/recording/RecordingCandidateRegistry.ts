import Reserve from '../../../db/entities/Reserve.js';

/** 録画開始予定時刻（`startAt`）より、どれだけ前に「準備開始（`prepareAt`）」を迎えるべきかの猶予。
 *  tuner共有の隣接予約の切り替え等、実際の録画開始までに必要な準備時間を見込んでいる。 */
export const PREPARATION_LEAD_MS = 15_000;

declare const recordingGenerationBrand: unique symbol;

/**
 * 予約1件に対する変更の「世代」。`upsert`/`remove`/`rebuild`のたびに単調増加する値が発行され、
 * `RecordingScheduleController`側の非同期dispatchが実行される時点で、対象の予約が
 * 発行時点から既に別内容へ置き換わっていないか（世代が一致するか）を確認するために使う。
 */
export type RecordingGeneration = bigint & {
    readonly [recordingGenerationBrand]: 'RecordingGeneration';
};

/**
 * 録画候補が辿る状態。`Waiting`（準備待ち）から`Completed`/`Cancelled`（終端）までの一方向遷移を
 * 想定しており、遷移の妥当性チェック自体は`tryTransitionPhase`の呼び出し側（`RecordingScheduleController`）
 * が担う（このtype自体は取りうる値の列挙のみ）。
 */
export type RecordingPhase =
    | 'Waiting'
    | 'Preparing'
    | 'RetryWaiting'
    | 'Recording'
    | 'AwaitingFirstData'
    | 'Registering'
    | 'PathSelectionOverdue'
    | 'RegistrationOverdue'
    | 'StoppingForDeletion'
    | 'Finishing'
    | 'Completed'
    | 'Cancelled';

/**
 * 予約（`Reserve`）から導出した、1件の録画候補のimmutableなsnapshot。
 * `reservation`は`upsert`時点での予約内容の複製（以後の`Reserve`側の変更を追わない）で、
 * `state`は`upsert`時点での競合状態（`isConflict`）をそのまま反映した固定値。
 */
export interface RecordingCandidate {
    readonly reservationId: number;
    readonly reservation: Readonly<Reserve>;
    readonly startAt: number;
    readonly endAt: number;
    readonly prepareAt: number;
    readonly kind: 'Program' | 'TimeSpecified';
    readonly state: 'Normal' | 'Conflict';
    readonly generation: RecordingGeneration;
    readonly phase: RecordingPhase;
}

/**
 * 予約（`Reserve`）から導出した録画候補（`RecordingCandidate`）の集合を、予約IDをkeyに保持する
 * registry。候補のCRUDのたびに`RecordingGeneration`を発行し、`RecordingScheduleController`側の
 * 非同期dispatchが「発行時点から候補が変わっていないか」を`isCurrent`/`tryTransitionPhase`/
 * `removeIfCurrent`で確認できるようにする（世代不一致なら操作を無視させる、楽観的並行制御）。
 */
class RecordingCandidateRegistry {
    /** 現在有効な録画候補。予約が`isSkip`/`isOverlap`になった、または`remove`された場合は登録から外れる。 */
    private readonly candidates = new Map<number, RecordingCandidate>();
    /** 予約IDごとの最新`RecordingGeneration`。`candidates`から外れた（`remove`された）予約IDについても、
     *  「削除されたという事実」自体の世代を保持し続けるためcandidatesとは別Mapで管理する。 */
    private readonly generations = new Map<number, RecordingGeneration>();
    /** `RecordingGeneration`発行用の単調増加counter。 */
    private generationCounter = 0n;

    /**
     * 予約の内容を反映して候補を追加・更新する。新しい世代を発行してから反映する。
     * @param reservation 反映対象の予約。
     * @param phase 設定する`RecordingPhase`（省略時は`Waiting`）。
     * @returns 反映後の候補。予約が`isSkip`または`isOverlap`の場合は候補から除外し`null`を返す。
     */
    public upsert(reservation: Reserve, phase: RecordingPhase = 'Waiting'): RecordingCandidate | null {
        const generation = this.issueGeneration();
        this.generations.set(reservation.id, generation);

        if (reservation.isSkip || reservation.isOverlap) {
            this.candidates.delete(reservation.id);
            return null;
        }

        const reservationSnapshot = Object.freeze({ ...reservation }) as Readonly<Reserve>;
        const candidate = Object.freeze({
            reservationId: reservation.id,
            reservation: reservationSnapshot,
            startAt: reservation.startAt,
            endAt: reservation.endAt,
            prepareAt: reservation.startAt - PREPARATION_LEAD_MS,
            kind: reservation.isTimeSpecified ? 'TimeSpecified' : 'Program',
            state: reservation.isConflict ? 'Conflict' : 'Normal',
            generation,
            phase,
        }) satisfies RecordingCandidate;
        this.candidates.set(reservation.id, candidate);
        return candidate;
    }

    /**
     * 指定予約の候補を削除する。新しい世代を発行してから削除する。
     * @param reservationId 削除対象の予約ID。
     * @returns 削除に伴い発行された世代（呼び出し側が以後の操作の期待世代として使う）。
     */
    public remove(reservationId: number): RecordingGeneration {
        const generation = this.issueGeneration();
        this.candidates.delete(reservationId);
        this.generations.set(reservationId, generation);
        return generation;
    }

    /**
     * 現在の候補集合を丸ごと入れ替える。既存の全候補を（新規に発行した1つの世代のもとで）
     * 一括削除してから、渡された予約一覧で作り直す。
     * @param reservations 再構築後の候補集合の元になる予約一覧。
     */
    public rebuild(reservations: ReadonlyArray<Reserve>): void {
        const rebuildGeneration = this.issueGeneration();
        for (const reservationId of this.candidates.keys()) {
            this.generations.set(reservationId, rebuildGeneration);
        }
        this.candidates.clear();

        for (const reservation of reservations) {
            this.upsert(reservation);
        }
    }

    /**
     * @param reservationId 対象の予約ID。
     * @returns 現在の候補。存在しない（未登録または削除済み）場合は`undefined`。
     */
    public get(reservationId: number): RecordingCandidate | undefined {
        return this.candidates.get(reservationId);
    }

    /** @returns 現在有効な全候補のsnapshot配列（順序は保証しない）。 */
    public list(): ReadonlyArray<RecordingCandidate> {
        return [...this.candidates.values()];
    }

    /**
     * @param reservationId 対象の予約ID。
     * @returns 直近に発行された世代。一度も操作されていない予約IDの場合は`undefined`。
     */
    public latestGeneration(reservationId: number): RecordingGeneration | undefined {
        return this.generations.get(reservationId);
    }

    /**
     * 指定した世代が、現在その予約に登録されている候補の世代と一致するか（＝古い世代に基づく
     * 操作ではないか）を確認する。
     * @param reservationId 対象の予約ID。
     * @param expectedGeneration 呼び出し側が操作の前提としている世代。
     * @returns 一致していれば`true`（候補が既に削除されている場合は常に`false`）。
     */
    public isCurrent(reservationId: number, expectedGeneration: RecordingGeneration): boolean {
        return this.candidates.get(reservationId)?.generation === expectedGeneration;
    }

    /**
     * 世代と現在のphaseが期待通りである場合に限り、phaseを次の状態へ進める
     * （compare-and-swap相当。世代・phaseのいずれかが食い違えば何もしない）。
     * @param reservationId 対象の予約ID。
     * @param expectedGeneration 呼び出し側が前提としている世代。
     * @param expectedPhase 呼び出し側が前提としている現在のphase。
     * @param nextPhase 遷移先のphase。
     * @returns 遷移できたか。
     */
    public tryTransitionPhase(
        reservationId: number,
        expectedGeneration: RecordingGeneration,
        expectedPhase: RecordingPhase,
        nextPhase: RecordingPhase,
    ): boolean {
        const current = this.candidates.get(reservationId);
        if (current?.generation !== expectedGeneration || current.phase !== expectedPhase) {
            return false;
        }

        this.candidates.set(reservationId, Object.freeze({ ...current, phase: nextPhase }));
        return true;
    }

    /**
     * 世代が期待通りである場合に限り候補を削除する（`isCurrent`と`remove`の合成、CAS相当）。
     * @param reservationId 対象の予約ID。
     * @param expectedGeneration 呼び出し側が前提としている世代。
     * @returns 削除できたか。世代が食い違っていれば`false`で何もしない。
     */
    public removeIfCurrent(reservationId: number, expectedGeneration: RecordingGeneration): boolean {
        if (!this.isCurrent(reservationId, expectedGeneration)) {
            return false;
        }

        this.remove(reservationId);
        return true;
    }

    /** @returns 新規に発行した、これまでで最大の世代。 */
    private issueGeneration(): RecordingGeneration {
        this.generationCounter += 1n;
        return this.generationCounter as RecordingGeneration;
    }
}

export default RecordingCandidateRegistry;
