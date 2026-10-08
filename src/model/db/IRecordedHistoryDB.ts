import type * as apid from '../../../api.js';
import RecordedHistory from '../../db/entities/RecordedHistory.js';

/**
 * 録画履歴（実際に録画されたファイルとは別に、過去の録画実績として残す記録）の
 * 永続化を担う DB 層の契約。実装は `RecordedHistoryDB`。
 */
export default interface IRecordedHistoryDB {
    /**
     * バックアップされた録画履歴一覧で DB を全件洗い替えする。
     * @param items 復元する録画履歴の一覧
     */
    restore(items: RecordedHistory[]): Promise<void>;
    /**
     * 録画履歴を 1 件挿入する。
     * @param program 挿入する録画履歴
     * @returns 挿入された行の id
     */
    insertOnce(program: RecordedHistory): Promise<apid.RecordedHistoryId>;
    /**
     * 指定した時刻より終了時刻が古い録画履歴をまとめて削除する。保持期間を超えた
     * 履歴を掃除するために使う。
     * @param time この時刻より古い（`endAt` がこれ未満の）履歴を削除する
     */
    delete(time: apid.UnixtimeMS): Promise<void>;
    /**
     * 登録済みの録画履歴を全件取得する。
     * @returns 録画履歴の一覧
     */
    findAll(): Promise<RecordedHistory[]>;
}
