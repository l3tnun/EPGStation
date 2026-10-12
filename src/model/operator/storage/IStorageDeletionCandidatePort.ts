import type * as apid from '../../../../api.js';

/** 削除候補検索の条件。 */
export interface StorageDeletionCandidateRequest {
    /** 候補から除外する録画IDの集合。録画中・再生中など、現に使用されている録画（`IStorageRecordedUseSnapshotPort`
     *  で取得したもの）と、同一storage watch内で既に削除を試みて失敗した録画を渡し、無限に同じ候補を
     *  選び直すことを防ぐ。 */
    readonly excludedRecordedIds: ReadonlySet<apid.RecordedId>;
    /** 空き容量を確保したい保存先の名前。この保存先に属する録画のみを検索対象とする。 */
    readonly storageName: string;
}

/**
 * 保存先の空き容量確保のため、削除してよい録画の候補を1件選ぶ契約。実装は`RecordedDB`
 * （`IRecordedDB`が本interfaceを継承）。`StorageManageModel`が空き容量不足を検知したときに呼び出す。
 */
export default interface IStorageDeletionCandidatePort {
    /**
     * 指定した保存先の録画のうち、除外対象を除いて最も古い（最初に削除すべき）録画IDを1件返す。
     * @param request 検索条件（対象保存先、除外する録画ID）。
     * @returns 削除候補の録画ID。該当する録画が無ければ`null`。
     */
    findOldestUnused(request: StorageDeletionCandidateRequest): Promise<apid.RecordedId | null>;
}
