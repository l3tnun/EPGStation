import type * as apid from '../../../api.js';
import Recorded from '../../db/entities/Recorded.js';
import IStorageDeletionCandidatePort from '../operator/storage/IStorageDeletionCandidatePort.js';

/**
 * `findAll`/`findIds` で録画済み番組を取得する際に、関連 entity（ビデオファイル・
 * サムネイル・ドロップログ・タグ）を一緒に取得するかどうかを指定するオプション。
 * 一覧表示など関連 entity が不要な場面で無駄な JOIN を避けるために使う。
 */
export interface RecordedColumnOption {
    isNeedVideoFiles: boolean;
    isNeedThumbnails: boolean;
    isNeedsDropLog: boolean;
    isNeedTags: boolean;
}

/**
 * `findAll` の検索条件。API の `GetRecordedOption` に加えて、録画中のものだけに
 * 絞り込む `isRecording` を持つ（DB 層固有の絞り込みのため API の型には含まれない）。
 */
export interface FindAllOption extends apid.GetRecordedOption {
    isRecording?: boolean;
}

/**
 * 録画済み番組（Recorded）情報の永続化を担う DB 層の契約。
 * `IStorageDeletionCandidatePort` を継承し、保存先の空き容量確保のための削除候補検索も提供する。
 * 実装は `RecordedDB`。
 */
export default interface IRecordedDB extends IStorageDeletionCandidatePort {
    /**
     * バックアップされた録画情報一覧で DB を全件洗い替えする。関連するサムネイル・
     * ビデオファイルも合わせて削除してから挿入し直す。
     * @param items 復元する録画情報の一覧
     */
    restore(items: Recorded[]): Promise<void>;
    /**
     * 録画情報を 1 件挿入する。
     * @param recorded 挿入する録画情報
     * @returns 挿入された行の id
     */
    insertOnce(recorded: Recorded): Promise<apid.RecordedId>;
    /**
     * 録画情報を 1 件更新する。
     * @param recorded 更新後の内容を持つ録画情報（id で対象行を特定する）
     */
    updateOnce(recorded: Recorded): Promise<void>;
    /**
     * 録画中フラグ（`isRecording`）を `false` に落とす。録画終了時に呼ばれる想定。
     * @param recordedId 対象の録画情報 id
     */
    removeRecording(recordedId: apid.RecordedId): Promise<void>;
    /**
     * 指定した drop log file id への参照を持つ録画情報から、その参照を外す
     * （drop log file 側が削除された際の整合性維持のため）。
     * @param dropLogFileId 参照を外す対象の drop log file id
     * @returns 実際に更新された行が存在した場合 `true`
     */
    removeDropLogFileId(dropLogFileId: apid.DropLogFileId): Promise<boolean>;
    /**
     * 指定した rule id への参照を持つ録画情報から、その参照を外す
     * （rule 側が削除された際の整合性維持のため）。
     * @param ruleId 参照を外す対象の rule id
     */
    removeRuleId(ruleId: apid.RuleId): Promise<void>;
    /**
     * 録画の保護状態（削除対象から除外するかどうか）を変更する。既に同じ状態であれば何もしない。
     * @param recordedId 対象の録画情報 id
     * @param isProtect 変更後の保護状態
     */
    changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void>;
    /**
     * 録画情報を 1 件削除する。
     * @param recordedId 削除対象の id
     */
    deleteOnce(recordedId: apid.RecordedId): Promise<void>;
    /**
     * id を指定して録画情報を取得する。
     * @param recordedId 検索対象の id
     * @returns 該当する録画情報。存在しない場合は `null`
     */
    findId(recordedId: apid.RecordedId): Promise<Recorded | null>;
    /**
     * 複数の id を指定して録画情報をまとめて取得する。
     * @param recordedIds 検索対象の id の一覧
     * @returns 該当する録画情報の一覧（`recordedIds` が空の場合は空配列）
     */
    findIds(recordedIds: apid.RecordedId[]): Promise<Recorded[]>;
    /**
     * 条件を指定して録画情報を検索する。
     * @param option 絞り込み・並び替え・ページングの条件
     * @param columnOption 関連 entity を合わせて取得するかどうかの指定
     * @returns 該当する録画情報の一覧と、絞り込み条件に一致する総件数の組
     */
    findAll(option: FindAllOption, columnOption: RecordedColumnOption): Promise<[Recorded[], number]>;
    /**
     * 録画済み番組が存在する channel の一覧を、件数付きで取得する。
     * @returns channel ごとの件数を持つ一覧
     */
    findChannelList(): Promise<apid.RecordedChannelListItem[]>;
    /**
     * 録画済み番組が存在するジャンルの一覧を、件数付きで取得する。
     * @returns ジャンルごとの件数を持つ一覧
     */
    findGenreList(): Promise<apid.RecordedGenreListItem[]>;
    /**
     * 保護されていない録画のうち、最も古いものを 1 件取得する。ストレージ容量確保のための
     * 削除候補選定で使う。
     * @returns 最も古い未保護の録画情報。存在しない場合は `null`
     */
    findOld(): Promise<Recorded | null>;
    /**
     * 指定した予約（reserve）id に紐づく録画情報を取得する。
     * @param reserveId 検索対象の予約 id
     * @returns 該当する録画情報の一覧
     */
    findReserveId(reserveId: apid.ReserveId): Promise<Recorded[]>;
}
