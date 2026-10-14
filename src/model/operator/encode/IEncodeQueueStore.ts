import type * as apid from '../../../../api.js';

/**
 * 依頼記録窓口が返すエンコードの依頼の記録。
 */
export interface EncodeQueueRecord {
    /** 識別番号（1〜`Number.MAX_SAFE_INTEGER`） */
    id: apid.EncodeId;
    /** 依頼内容 */
    option: apid.AddEncodeProgramOption;
    /** 変換を開始したときの出力ファイルの full path。開始前と出力なしは `null` */
    outputPath: string | null;
    /** 記録した時刻（UNIX ミリ秒） */
    createdAt: number;
}

/**
 * 録画完了の依頼を記録した後で、Web・API 側処理へ識別番号付きで渡す送信処理。
 * 渡せたら `true`、渡す先が無い・送れなかった場合は `false` を返す（失敗は送信処理の側で記録する）。
 * 想定外の同期の throw は、依頼記録窓口がログへ記録する。
 */
export type EncodeQueuePushSender = (encodeId: apid.EncodeId, option: apid.AddEncodeProgramOption) => boolean;

/**
 * 管理側（親 process）に置くエンコードの依頼記録窓口。識別番号の割当てと、記録の保存・更新・削除・一覧を
 * 一本の直列の処理で行う。実装は `EncodeQueueStore`。
 */
export default interface IEncodeQueueStore {
    /**
     * 識別番号を割り当てて依頼を記録する。
     * @param option 依頼内容
     * @param requestToken 要求ごとに呼出し元が作る値。応答を受け取れなかった呼出し元が `abandon` で記録を取り消すために使う
     * @returns 割り当てた識別番号
     */
    add(option: apid.AddEncodeProgramOption, requestToken?: string): Promise<apid.EncodeId>;
    /**
     * `add` の応答を受け取れなかった呼出し元が、その要求で作られた記録を取り消す。記録が無ければ何もしない。
     * @param requestToken `add` に渡した値
     */
    abandon(requestToken: string): Promise<void>;
    /**
     * 記録へ出力先を加える。
     * @param encodeId 対象の識別番号
     * @param outputPath 出力ファイルの full path
     */
    updateOutputPath(encodeId: apid.EncodeId, outputPath: string): Promise<void>;
    /**
     * 記録を削除する。
     * @param encodeId 対象の識別番号
     */
    remove(encodeId: apid.EncodeId): Promise<void>;
    /**
     * 記録を受け付け順に並べて返す。
     * @returns 記録の一覧
     */
    list(): Promise<EncodeQueueRecord[]>;
    /**
     * 録画完了による依頼を記録し、記録できたら `send` で Web・API 側処理へ渡す。呼出し元へは同期で戻り、
     * 記録・送信の失敗はログへ記録する。
     * @param option 依頼内容
     * @param send 識別番号付きの送信処理
     */
    enqueueFromRecording(option: apid.AddEncodeProgramOption, send: EncodeQueuePushSender): void;
}
