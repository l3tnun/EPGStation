/** 録画済みファイルの利用目的。encode処理用に読んでいるか、視聴/配信用に読んでいるかを区別する。 */
export type RecordedResourceUseKind = 'encoding' | 'delivery';

/**
 * 利用権（lease）取得要求の結果。
 * - `granted`: 取得できた。
 * - `blocked`: 当該録画が削除処理の対象として既に押さえられているため取得できない。
 * - `unknown`: 要求内容が不正、または要求元が現在の接続child processと一致しないため判定できなかった。
 */
export type RecordedUseAcquireStatus = 'granted' | 'blocked' | 'unknown';

/**
 * 利用権解放要求の結果。
 * - `released`: 解放できた。
 * - `already-released`: 直前に同じrequestIdで解放済みだった（再送に対する冪等応答）。
 * - `unknown`: 対応する利用権が見つからない、または要求元が不正。
 */
export type RecordedUseReleaseStatus = 'released' | 'already-released' | 'unknown';

/**
 * child process（encode/operator process）側で、録画ファイルを読む前に親process上の
 * `ParentRecordedResourceUseRegistry`へ利用権を要求するための窓口。IPC往復をPromiseで隠蔽する。
 */
export interface RecordedResourceUseClient {
    /**
     * 録画ファイルの利用権取得を要求する。
     * @param recordedId 対象の録画ID。
     * @param kind 利用目的（encoding/delivery）。
     * @returns 取得できた場合のみ解決する。`token`は`release`に渡して解放するための不透明な値。
     *          取得できなかった場合（blocked/unknown）は例外を投げる想定で、成功時のみ戻り値を返す。
     */
    acquire(recordedId: number, kind: RecordedResourceUseKind): Promise<{ readonly token: object }>;
    /**
     * `acquire`で得た利用権を解放する。
     * @param token `acquire`が返した不透明な識別子。
     */
    release(token: object): Promise<void>;
}

/**
 * 親process側で実際に利用権の貸し出しを判定・記録する registry の契約。
 * 実装は`ServiceChildRecordedUseRegistry`（現在接続中のchild processのみを対象とし、
 * child切断時はその利用権を「不明」として扱い、削除処理を安全側でブロックする）。
 */
export interface ParentRecordedResourceUseRegistry {
    /**
     * 録画ファイルの利用権取得を試みる。
     * @param input 要求元peer、要求ID（同一peer内で解放時に対応付けるための識別子）、対象録画ID、利用目的。
     * @returns 判定結果のみを返す（例外は投げない）。
     */
    acquire(input: {
        readonly senderPeer: object;
        readonly requestId: number;
        readonly recordedId: number;
        readonly kind: RecordedResourceUseKind;
    }): { readonly status: RecordedUseAcquireStatus };
    /**
     * 取得済みの利用権を解放する。
     * @param input 要求元peerと、`acquire`時に使った要求ID。
     * @returns 判定結果のみを返す（例外は投げない）。
     */
    release(input: { readonly senderPeer: object; readonly acquisitionRequestId: number }): RecordedUseReleaseStatus;
}

/**
 * 実際の`ParentRecordedResourceUseRegistry`実装を、IPCServer側の呼び出し口へ後から差し込むための登録口。
 * IPCServerが具象クラスへ直接依存しないようにするためのDI境界。
 */
export interface ParentRecordedResourceUseRegistryRegistrationPort {
    /** 利用する registry 実装を登録する。 */
    register(registry: ParentRecordedResourceUseRegistry): void;
}

/**
 * 「現在利用中の録画IDの一覧」のスナップショット。
 * `known`はchild process側が把握している利用中の録画ID一覧を返せた場合、
 * `unknown`はchild processが未接続などの理由で応答できなかった場合。
 */
export type RecordedUseSnapshotPayload =
    { readonly status: 'known'; readonly recordedIds: readonly number[] } | { readonly status: 'unknown' };

/**
 * 親process側で、現在接続中のchild processへ利用中録画IDのスナップショットを問い合わせるための窓口。
 * ストレージの削除候補判定など、削除前に「今使われていないか」を確認する用途で使われる。
 */
export interface RecordedUseSnapshotClient {
    /** child processへスナップショットを要求し、応答を待つ。 */
    requestSnapshot(): Promise<RecordedUseSnapshotPayload>;
}

/** child process側で、現在保持している利用中録画IDのスナップショットを即時に返す契約。 */
export interface ChildRecordedUseSnapshotHandler {
    /** 現時点のスナップショットを同期的に返す。 */
    getSnapshot(): RecordedUseSnapshotPayload;
}

/**
 * 実際の`ChildRecordedUseSnapshotHandler`実装を、IPCClient側の呼び出し口へ後から差し込むための登録口。
 * `ParentRecordedResourceUseRegistryRegistrationPort`と対になるchild側のDI境界。
 */
export interface ChildRecordedUseSnapshotHandlerRegistrationPort {
    /** 利用するhandler実装を登録する。 */
    register(handler: ChildRecordedUseSnapshotHandler): void;
}
