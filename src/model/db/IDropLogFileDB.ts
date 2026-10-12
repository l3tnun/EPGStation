import type * as apid from '../../../api.js';
import DropLogFile from '../../db/entities/DropLogFile.js';

/**
 * `updateCnt` で更新するドロップログの集計値。録画中に一定間隔で加算されていく
 * カウンタを、対象の drop log file id と合わせて渡す。
 */
export interface UpdateCntOption {
    id: apid.DropLogFileId;
    errorCnt: number;
    dropCnt: number;
    scramblingCnt: number;
}

/**
 * 録画時のドロップ・エラー・スクランブル状況を記録する drop log file 情報の DB 層の契約。
 * 実装は `DropLogFileDB`。
 */
export default interface IDropLogFileDB {
    /**
     * バックアップされた drop log file 一覧で DB を全件洗い替えする。
     * @param items 復元する drop log file の一覧
     */
    restore(items: DropLogFile[]): Promise<void>;
    /**
     * drop log file 情報を 1 件挿入する。
     * @param dropLogFile 挿入する drop log file
     * @returns 挿入された行の id
     */
    insertOnce(dropLogFile: DropLogFile): Promise<apid.DropLogFileId>;
    /**
     * ドロップ・エラー・スクランブルの累積カウントを更新する。
     * @param updateOption 更新対象の id と更新後のカウント値
     */
    updateCnt(updateOption: UpdateCntOption): Promise<void>;
    /**
     * drop log file 情報を 1 件削除する。
     * @param dropLogFileId 削除対象の id
     * @returns 実際に削除された行が存在した場合 `true`
     */
    deleteOnce(dropLogFileId: apid.DropLogFileId): Promise<boolean>;
    /**
     * id を指定して drop log file 情報を取得する。
     * @param dropLogFileId 検索対象の id
     * @returns 該当する drop log file。存在しない場合は `null`
     */
    findId(dropLogFileId: apid.DropLogFileId): Promise<DropLogFile | null>;
    /**
     * 登録済みの drop log file を全件取得する。
     * @returns drop log file の一覧
     */
    findAll(): Promise<DropLogFile[]>;
}
