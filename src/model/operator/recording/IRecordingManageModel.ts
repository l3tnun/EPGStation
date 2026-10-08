import type * as apid from '../../../../api.js';
import { IReserveUpdateValues } from '../../event/IReserveEvent.js';
import { TunerInfo } from '../../tuner/types.js';

/**
 * 予約（Reserve）情報を元に、実際の録画の開始・停止・スケジューリングを統括する契約。
 * 個々の録画実行は `IRecorderModel` に委譲し、このモデルは予約全体の候補管理と
 * スケジュール制御（`RecordingScheduleController`）を担う。実装は `RecordingManageModel`。
 */
export default interface IRecordingManageModel {
    /**
     * 利用可能な tuner の一覧を反映する。
     * @param tuners 現在利用可能な tuner の情報一覧
     */
    setTuner(tuners: TunerInfo[]): void;
    /**
     * 起動時、前回のプロセス終了で録画中のまま止まってしまった録画情報を「録画済み」へ
     * 移行させる（isRecording を解除し、tmp からの移動やファイルサイズ更新等の後始末を行う）。
     */
    cleanup(): Promise<void>;
    /**
     * DB 上の予約情報から録画候補を再構築し、スケジュール処理を開始する。起動時に 1 度だけ
     * 呼ばれる想定で、2 回目以降の呼び出しは初回の完了 Promise をそのまま返す。
     */
    rebuildCandidatesAndStart(): Promise<void>;
    /**
     * 予約の変更差分を受け付ける。起動処理が完了していない間は変更を保留し、完了後に
     * まとめて反映する。
     * @param diff 変更内容（追加・更新・削除された予約）
     */
    acceptMutation(diff: IReserveUpdateValues): void;
    /**
     * 予約の変更差分を反映し、関連するスケジュール処理が落ち着く（idle になる）まで待機する。
     * @param diff 変更内容（追加・更新・削除された予約）
     */
    update(diff: IReserveUpdateValues): Promise<void>;
    /**
     * 指定した予約が現在録画候補として保持されているかを確認する。
     * @param reserveId 確認対象の予約 id
     * @returns 保持されていれば `true`
     */
    hasReserve(reserveId: apid.ReserveId): boolean;
    /**
     * 指定した予約の録画をキャンセルする。対象が存在しなければ何もしない。
     * @param reserveId 対象の予約 id
     * @param isPlanToDelete キャンセル後、録画情報自体を削除する予定である場合 `true`
     */
    cancel(reserveId: apid.ReserveId, isPlanToDelete: boolean): Promise<void>;
    /**
     * 削除のために録画をキャンセルし、削除に向けた停止処理が完了するまで待機する。
     * @param reserveId 対象の予約 id
     */
    cancelForDeletion(reserveId: apid.ReserveId): Promise<void>;
    /** 起動済みであれば、スケジュール処理のタイマーをリセットして再評価させる。 */
    resetTimer(): void;
}
