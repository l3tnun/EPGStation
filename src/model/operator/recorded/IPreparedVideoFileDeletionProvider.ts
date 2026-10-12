import type * as apid from '../../../../api.js';
declare const preparedVideoFileDeletionTokenBrand: unique symbol;
/**
 * `prepareVideoFileDeletion` が発行し `deletePreparedVideoFile` に渡すことで、実際の削除を
 * 許可する印。中身を持たない brand 型で、prepare を経由せず直接値を作ることはできない。
 */
export type PreparedVideoFileDeletionToken = {
    readonly [preparedVideoFileDeletionTokenBrand]: never;
};

/**
 * ビデオファイル単体では削除できず、録画情報ごと削除する必要がある状態
 * （録画中である、もしくは対象が最後の 1 本のビデオファイルである場合）を表す。
 */
export interface WholeRecordedDeletionRequired {
    readonly status: 'whole-recorded-deletion-required';
    readonly recordedId: apid.RecordedId;
}

/**
 * `prepareVideoFileDeletion` の結果。
 */
export type VideoFileDeletionPreparation =
    | { readonly status: 'not-found' }
    | { readonly status: 'protected' }
    | { readonly status: 'prepared'; readonly token: PreparedVideoFileDeletionToken }
    | WholeRecordedDeletionRequired;

/**
 * `deletePreparedVideoFile` の結果。
 */
export type VideoFileDeletionResult =
    | { readonly status: 'video-file-deleted' }
    | { readonly status: 'not-found' }
    | { readonly status: 'protected' }
    | WholeRecordedDeletionRequired;

/**
 * 録画情報全体ではなく、その録画が持つビデオファイルの一部（エンコード済みファイル等）だけを
 * 削除する操作を、確認（prepare）と実行（commit）の 2 段階に分ける契約。
 * 対象が最後の 1 本や録画中のファイルだった場合は単体削除を拒否し、呼び出し側に
 * 録画情報ごとの削除（`IPreparedRecordedDeletionProvider`）へ切り替えるよう促す。
 * 実装は `RecordedManageModel`。
 */
export default interface IPreparedVideoFileDeletionProvider {
    /**
     * ビデオファイルが単体削除可能かを検証し、可能であれば削除用の token を発行する。
     * @param videoFileId 削除対象のビデオファイル id
     * @returns 検証結果。可能なら token を含む `prepared`
     */
    prepareVideoFileDeletion(videoFileId: apid.VideoFileId): Promise<VideoFileDeletionPreparation>;
    /**
     * `prepareVideoFileDeletion` で発行された token を使って、実際にビデオファイルを削除する。
     * @param token `prepareVideoFileDeletion` が返した token
     */
    deletePreparedVideoFile(token: PreparedVideoFileDeletionToken): Promise<VideoFileDeletionResult>;
}
