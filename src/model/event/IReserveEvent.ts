import Reserve from '../../db/entities/Reserve.js';

/**
 * `emitUpdated` で通知する予約の変更差分。挿入・更新・削除された予約をそれぞれ
 * 配列で持つ（変更が無い区分は省略され得る）。
 */
export interface IReserveUpdateValues {
    insert?: Reserve[];
    update?: Reserve[];
    delete?: Reserve[];
    isSuppressLog: boolean;
    /**
     * 起動時の再評価で、保存済みの全予約を `update` に入れて送り直した差分である場合 `true`。
     * 録画側が録画候補と時刻指定予約の timer を組み直すための入力であり、予約の変更ではないため、
     * `update` を外部 command へ渡してはならない。
     */
    isStartupRebuild?: boolean;
}

/**
 * 予約（Reserve）情報の変化を、発生元（予約管理）から他の module へ通知するための
 * event の契約。`emitXxx` は発生元が呼び出してイベントを発行し、`setXxx` は購読側が
 * コールバックを登録する。実装は `ReserveEvent`。
 */
export default interface IReserveEvent {
    /**
     * 予約情報の追加・更新・削除をまとめて通知する。
     * @param diff 変更内容（追加・更新・削除された予約と、ログ抑制指定）
     */
    emitUpdated(diff: IReserveUpdateValues): void;
    /**
     * `emitUpdated` を購読する。
     * @param callback 変更内容を受け取るコールバック
     */
    setUpdated(callback: (diff: IReserveUpdateValues) => void): void;
}
