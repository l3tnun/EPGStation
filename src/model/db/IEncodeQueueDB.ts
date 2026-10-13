/**
 * エンコードの依頼の記録（table `encode_queue`）の一行。`option` は依頼内容の JSON 文字列のまま扱い、
 * 解釈と検証は利用側（依頼記録窓口 `EncodeQueueStore`）が行う。
 */
export interface EncodeQueueRow {
    /** 呼出し元が割り当てた識別番号（1〜`Number.MAX_SAFE_INTEGER`）。DB では自動採番しない。 */
    id: number;
    /** 依頼内容（`AddEncodeProgramOption`）の JSON 文字列 */
    option: string;
    /** 変換を開始したときの出力ファイルの full path。開始前と出力なしは `null` */
    outputPath: string | null;
    /** 記録した時刻（UNIX ミリ秒） */
    createdAt: number;
}

/**
 * エンコードの依頼の記録の DB 層の契約。実装は `EncodeQueueDB`。
 * 書き込みは管理側（親 process）の依頼記録窓口だけが行う。
 */
export default interface IEncodeQueueDB {
    /**
     * 依頼の記録を 1 件挿入する。
     * @param row 挿入する記録（識別番号を含む）
     */
    insertOnce(row: EncodeQueueRow): Promise<void>;
    /**
     * 記録の出力先を更新する。
     * @param id 対象の識別番号
     * @param outputPath 出力ファイルの full path
     * @returns 実際に更新された行が存在した場合 `true`
     */
    updateOutputPath(id: number, outputPath: string): Promise<boolean>;
    /**
     * 依頼の記録を 1 件削除する。
     * @param id 削除対象の識別番号
     * @returns 実際に削除された行が存在した場合 `true`
     */
    deleteOnce(id: number): Promise<boolean>;
    /**
     * 依頼の記録をすべて削除する（管理情報の復元で使う）。
     */
    deleteAll(): Promise<void>;
    /**
     * 依頼の記録を識別番号の昇順ですべて取得する。
     * @returns 記録の一覧
     */
    findAll(): Promise<EncodeQueueRow[]>;
}
