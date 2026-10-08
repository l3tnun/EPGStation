import type * as apid from '../../../../../api.js';

/**
 * どの streamId の HLS artifact（`stream<ID>.m3u8` 等）を、どのディレクトリ配下で
 * 削除・走査するかを指定する。
 */
export interface HLSFileDeleterOption {
    streamId: apid.StreamId;
    streamFilePath: string;
}

/**
 * `deleteAllFiles` の削除試行結果。ファイル削除は他プロセスとの競合等で必ず成功するとは
 * 限らないため、削除できたかを呼び出し元が判断できる形で返す。
 */
export interface HlsArtifactCleanupResult {
    /** 実際に試みた削除パス（再走査込み）の回数。 */
    readonly passes: number;
    /** 最終走査時点で残っていたファイル名の一覧。 */
    readonly remainingFiles: readonly string[];
    /** `cleared`: 残存なしで完了。`remaining`: 試行し尽くしたが残存あり。`unknown`: 走査自体が失敗し残存の有無を確認できなかった。 */
    readonly status: 'cleared' | 'remaining' | 'unknown';
}

/**
 * ディスク上の HLS artifact（セグメント・プレイリストファイル）の削除・走査を担う。
 * `StreamBaseModel` から stream 停止時の後始末として使われるほか、`IStreamIdAllocator`
 * 実装（`HlsStreamIdAllocator`）が streamId の衝突検査のために走査系 method を利用する。
 */
export default interface IHLSFileDeleterModel {
    /**
     * 以降の `deleteAllFiles()`（引数省略時）が対象とする option を設定する。
     */
    setOption(option: HLSFileDeleterOption): void;
    /**
     * 指定（または直近に `setOption` した）streamId の artifact をすべて削除する。
     * @param option 省略時は直前の `setOption` の値を使う。
     */
    deleteAllFiles(option?: HLSFileDeleterOption): Promise<HlsArtifactCleanupResult>;
}
