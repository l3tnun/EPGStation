import type { MessageId } from './IPCMessageDefine.js';
import type { UploadedVideoFileOption } from '../operator/recorded/IRecordedManageModel.js';

/**
 * アップロード動画fileの登録要求を送った後、中間的に確定する状態。
 * - `confirmed-not-sent`: IPC送信自体が失敗し、要求が親process側へ届かなかった。
 * - `adopted`: 親process側で採用済み通知（`UploadedVideoAdoptedMessage`）を先に受け取った。
 *   `completion`は本登録自体の最終結果（成功/失敗）を表すPromise。
 */
export type UploadedVideoDispatchDisposition =
    | { readonly kind: 'confirmed-not-sent'; readonly error: Error }
    | { readonly kind: 'adopted'; readonly completion: Promise<void> };

/** 登録要求の送信結果。`disposition`は送信直後には解決されず、中間状態が確定した時点で解決される。 */
export interface UploadedVideoDispatchAttempt {
    readonly disposition: Promise<UploadedVideoDispatchDisposition>;
}

/**
 * アップロードされた動画fileの登録要求を送るための窓口。実装は`IPCClient`。
 * `send`の完了（本登録の完了）を待たず、`dispatch`は即座に`UploadedVideoDispatchAttempt`を返す。
 */
export interface UploadedVideoRegistrationPort {
    dispatch(option: UploadedVideoFileOption): UploadedVideoDispatchAttempt;
}

/**
 * Internal parent-to-child observation that the Recorded Content owner has
 * completed upload adoption. It is deliberately distinct from the public
 * recorded.addUploadedVideoFile reply.
 */
export interface UploadedVideoAdoptedMessage {
    readonly id: MessageId;
    readonly type: 'uploadedVideoAdopted';
}
