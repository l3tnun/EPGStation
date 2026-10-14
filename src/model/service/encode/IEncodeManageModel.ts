import type * as apid from '../../../../api.js';
import IEncodingRecordedUseSnapshotProvider from './IEncodingRecordedUseSnapshotProvider.js';

/** 録画ID→その録画に対して現在queueに積まれているencode（実行中・待機中の両方）の索引。
 *  1つの録画に対して複数modeのencodeが同時に積まれることがあるため、値は配列。 */
export interface EncodeRecordedIdIndex {
    [recordedId: number]: {
        encodeId: apid.EncodeId;
        name: string;
    }[];
}

/** 現在queueに積まれているencode一覧（実行中/待機中で分けたもの）。 */
export interface EncodeQueueInfo {
    runningQueue: EncodeInfoItem[];
    waitQueue: EncodeInfoItem[];
}

/** encode1件分の状態。`percent`/`log`は実行中（`runningQueue`）のencodeにのみ設定され、
 *  待機中のencodeでは省略される。 */
export interface EncodeInfoItem {
    id: apid.EncodeId;
    mode: string;
    recordedId: apid.RecordedId;
    percent?: number;
    log?: string;
}

/**
 * encodeの受付・queue管理・キャンセルを行う契約。実装は`EncodeManageModel`で、同時実行数
 * （`concurrentEncodeNum`）とqueue上限（`encodeQueueLimit`）の範囲でencodeを直列/並列に処理する。
 * `IEncodingRecordedUseSnapshotProvider`を継承し、現在queue中の録画ID一覧も提供する
 * （保存先の空き容量確保のための削除候補から除外する用途）。
 */
export default interface IEncodeManageModel extends IEncodingRecordedUseSnapshotProvider {
    /**
     * encodeをqueueへ追加する。
     * @param addOption 追加するencodeの内容（対象録画、encode設定等）。
     * @returns 発行されたencodeID。
     */
    push(addOption: apid.AddEncodeProgramOption): Promise<apid.EncodeId>;
    /**
     * 管理側が記録済みの依頼（録画完了による依頼）を、記録の識別番号のまま受け付ける。同じ識別番号の依頼が
     * 待機列または実行中一覧にあれば何もしない。受付で拒否した場合は記録を削除する。
     * @param encodeId 記録の識別番号。
     * @param addOption 依頼の内容。
     */
    pushPersisted(encodeId: apid.EncodeId, addOption: apid.AddEncodeProgramOption): Promise<void>;
    /**
     * 起動時に一度だけ、記録された依頼を受け付け順に待機列へ戻す。戻し終えるまで新しい受付を待たせる。
     * 失敗はログへ記録して終える（reject しない）。
     */
    restore(): Promise<void>;
    /**
     * 指定したencodeを取り消す。実行中なら該当encoderへ中断を指示し、待機中ならqueueから
     * 取り除く。
     * @param encodeId 取り消し対象のencodeID。
     */
    cancel(encodeId: apid.EncodeId): Promise<void>;
    /** 現在queueに積まれている（実行中・待機中を問わない）encodeの、録画ID索引を返す。 */
    getRecordedIndex(): EncodeRecordedIdIndex;
    /**
     * 指定した録画に紐づく全てのencode（実行中・待機中を問わない）を取り消す。
     * @param recordedId 対象の録画ID。
     * @throws 1件でも取り消しに失敗した場合、全件試行した後に`Error`を投げる。
     */
    cancelEncodeByRecordedId(recordedId: apid.RecordedId): Promise<void>;
    /** 現在queueに積まれているencodeの一覧（進捗情報を含む）を返す。 */
    getEncodeInfo(): EncodeQueueInfo;
}
