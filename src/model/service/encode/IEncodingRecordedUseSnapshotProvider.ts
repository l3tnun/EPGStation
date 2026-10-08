import type * as apid from '../../../../api.js';

/**
 * 待機中・実行中のencode処理が使用している録画IDのsnapshot。`unknown`は、現時点の
 * 待機/実行中encodeの一覧を安全に確定できないことを表し、ストレージ削除判定側は
 * この場合「全て使用中」として扱う（空集合とは区別する）。
 */
export type EncodingRecordedUseSnapshot =
    | {
          status: 'known';
          recordedIds: ReadonlySet<apid.RecordedId>;
      }
    | {
          status: 'unknown';
      };

/** 読み取り専用の、待機中・実行中エンコードの録画 ID スナップショット。 */
export default interface IEncodingRecordedUseSnapshotProvider {
    getQueuedAndRunningRecordedIds(): EncodingRecordedUseSnapshot;
}
