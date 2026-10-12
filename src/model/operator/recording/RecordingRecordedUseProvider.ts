import { injectable } from 'inversify';

/**
 * 「今どの録画IDが録画処理中として使われているか」のスナップショット。
 * `unknown`は、いずれかの録画sessionがまだ録画IDを特定できていない（`preparing`より後、`active`より前の
 * 一時状態を含む）ため、利用中集合を安全に確定できないことを表す。この場合、呼び出し側は
 * 「何が使われているか分からない＝全て使われているものとして扱う」判断をする前提。
 */
export type RecordedUseSnapshot =
    { readonly status: 'known'; readonly recordedIds: ReadonlySet<number> } | { readonly status: 'unknown' };

/** 現在進行中の録画が使用している録画IDの集合を取得するための照会口。ストレージ削除候補の判定などから呼ばれる。 */
export interface RecordingRecordedUseSnapshotProvider {
    getActiveRecordedIds(): RecordedUseSnapshot;
}

/**
 * 録画済みファイルの削除前に、その録画が録画処理側で使用中でないことを確認・予約するための門番。
 * 実装は同一クラス（`RecordingRecordedUseProvider`）と、IPC越しのchild processを見る
 * `ServiceChildRecordedUseRegistry`の両方にあり、削除処理はその両方を通過しないと進めない。
 */
export interface RecordingRecordedUseGate {
    /**
     * 指定録画IDの削除を試みる。
     * @param recordedId 削除対象の録画ID。
     * @returns 予約できた場合は解放用の`token`。使用中または重複予約中なら`busy`、
     *          利用状況が不明で安全に判定できない場合は`unknown`。
     */
    tryAcquireDeletion(recordedId: number): { readonly token: object } | { readonly status: 'busy' | 'unknown' };
    /**
     * `tryAcquireDeletion`で得た削除予約を解放する。
     * @param token `tryAcquireDeletion`が返した不透明な識別子。対応が取れない場合は何もしない。
     */
    releaseDeletion(token: object): void;
}

/**
 * 1つの録画session（`RecorderModel`インスタンス）が現在どの録画IDを使用しているかの状態。
 * - `preparing`: 録画開始準備中で、まだ録画ID自体が決まっていない（登録上は未使用として扱う）。
 * - `active`: 録画IDが決まり、実際にファイルへ書き込み中。
 * - `unknown`: session識別ができない等の理由で安全側に倒す必要がある状態
 *   （1件でもこれが混じると`getActiveRecordedIds`全体が`unknown`を返す）。
 */
export type RecordingSessionRecordedUse =
    | { readonly status: 'preparing' }
    | { readonly status: 'active'; readonly recordedId: number }
    | { readonly status: 'unknown' };

/** 実際に記録として保持する状態は`preparing`を除いたもの（`preparing`は登録時に即座に削除されるため）。 */
type TrackedRecordingSessionRecordedUse = Exclude<RecordingSessionRecordedUse, { readonly status: 'preparing' }>;

/** session利用状況の登録結果。`blocked`は、対象録画IDが既に削除予約されているため登録できなかったことを表す。 */
export type RecordingSessionUseRegistration = 'registered' | 'blocked';

const UNKNOWN_SNAPSHOT = Object.freeze({ status: 'unknown' as const });
const UNKNOWN_DELETION = Object.freeze({ status: 'unknown' as const });
const BUSY_DELETION = Object.freeze({ status: 'busy' as const });

/**
 * 録画session（`RecorderModel`）ごとの利用中録画IDを追跡し、ストレージ削除処理との排他を取るクラス。
 * `sessionIdentity`にはsessionを一意に表すobject（実際は`RecorderModel`自身）をキーとして使い、
 * 明示的なsession IDを発行せずMapの参照同一性で管理する。
 */
@injectable()
class RecordingRecordedUseProvider implements RecordingRecordedUseSnapshotProvider, RecordingRecordedUseGate {
    /** 現在登録されているsessionごとの利用状態（`preparing`は登録されないため含まれない）。 */
    private readonly sessionUses = new Map<object, TrackedRecordingSessionRecordedUse>();
    /** 削除予約中の録画IDから、その予約を表す不透明tokenへの対応。 */
    private readonly deletionTokens = new Map<number, object>();
    /** 削除予約token（`tryAcquireDeletion`が返したもの）から、対応する録画IDへの逆引き。`releaseDeletion`の検証に使う。 */
    private readonly deletionRecordedIds = new WeakMap<object, number>();

    /**
     * 録画sessionの利用状態を登録・更新する。
     * @param sessionIdentity 対象sessionを一意に表す識別子（`RecorderModel`インスタンス）。
     * @param use 登録したい利用状態。`preparing`を渡すと既存の登録を取り除くだけで終わる。
     * @returns 登録できたか、対象録画IDが削除予約中のため拒否されたか。
     */
    public tryRegisterSessionUse(
        sessionIdentity: object,
        use: RecordingSessionRecordedUse,
    ): RecordingSessionUseRegistration {
        switch (use.status) {
            case 'active':
                if (this.deletionTokens.has(use.recordedId)) return 'blocked';
                this.sessionUses.set(sessionIdentity, use);
                return 'registered';
            case 'unknown':
                if (this.deletionTokens.size !== 0) return 'blocked';
                this.sessionUses.set(sessionIdentity, UNKNOWN_SNAPSHOT);
                return 'registered';
            case 'preparing':
                this.sessionUses.delete(sessionIdentity);
                return 'registered';
        }
    }

    /**
     * 録画sessionの利用状態登録を取り除く。
     * @param sessionIdentity `tryRegisterSessionUse`と同じsession識別子。
     * @param expectedUse 指定した場合、現在登録されている状態がこれと一致するときのみ削除する
     *                     （その間に別の状態へ上書きされていた場合は誤って消さないための楽観的な整合性チェック）。
     */
    public releaseSessionUse(sessionIdentity: object, expectedUse?: TrackedRecordingSessionRecordedUse): void {
        if (expectedUse !== undefined && this.sessionUses.get(sessionIdentity) !== expectedUse) return;
        this.sessionUses.delete(sessionIdentity);
    }

    /**
     * 現在登録されている全sessionの利用状態から、利用中録画IDのスナップショットを合成する。
     * @returns 1件でも`unknown`状態のsessionがあれば`unknown`、無ければ利用中の録画ID集合。
     */
    public getActiveRecordedIds(): RecordedUseSnapshot {
        const recordedIds = new Set<number>();
        for (const use of this.sessionUses.values()) {
            if (use.status === 'unknown') return UNKNOWN_SNAPSHOT;
            recordedIds.add(use.recordedId);
        }
        return Object.freeze({ status: 'known' as const, recordedIds });
    }

    /**
     * 指定録画IDについて、録画処理側で使用中でないことを確認したうえで削除を予約する。
     * @param recordedId 削除対象の録画ID。
     * @returns 予約できれば`token`。利用状況が不明なら`unknown`、使用中または既に予約済みなら`busy`。
     */
    public tryAcquireDeletion(
        recordedId: number,
    ): { readonly token: object } | { readonly status: 'busy' | 'unknown' } {
        const snapshot = this.getActiveRecordedIds();
        if (snapshot.status === 'unknown') return UNKNOWN_DELETION;
        if (snapshot.recordedIds.has(recordedId)) return BUSY_DELETION;
        if (this.deletionTokens.has(recordedId)) return BUSY_DELETION;

        const token = Object.freeze(Object.create(null)) as object;
        this.deletionTokens.set(recordedId, token);
        this.deletionRecordedIds.set(token, recordedId);
        return Object.freeze({ token });
    }

    /**
     * `tryAcquireDeletion`で得た削除予約を解放する。
     * @param token 対応する予約のtoken。既に無効・不一致なら何もしない。
     */
    public releaseDeletion(token: object): void {
        const recordedId = this.deletionRecordedIds.get(token);
        if (this.deletionTokens.get(recordedId as number) !== token) return;
        this.deletionTokens.delete(recordedId as number);
    }
}

export default RecordingRecordedUseProvider;
