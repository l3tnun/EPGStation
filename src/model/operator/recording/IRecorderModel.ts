import Reserve from '../../../db/entities/Reserve.js';
import type { RecordingGeneration, RecordingPhase } from './RecordingCandidateRegistry.js';
import type { RecordingSessionToken } from './RecordingScheduleController.js';

/**
 * `IRecorderModel` の実装インスタンスを取得するための factory。予約 1 件につき
 * 1 インスタンスを都度生成する（DI コンテナから transient に解決する）ために使う。
 */
export type RecorderModelProvider = () => Promise<IRecorderModel>;

/**
 * `RecordingManageModel`（スケジュール側）が `RecorderModel`（実行側）へ渡す、
 * 現在の録画セッションとやり取りするための窓口。`RecordingScheduleController` の
 * 状態を直接参照させる代わりにこの binding 越しにやり取りさせることで、`RecorderModel`
 * は schedule 側の内部実装を知らずに済む。各操作は `generation`/`sessionToken` により、
 * 呼び出し時点でもこの binding が最新の録画試行を指しているかどうかを検証する
 * （再スケジュールで置き換えられた古い binding からの操作は無視・失敗させる）。
 */
export interface RecordingScheduleSessionBinding {
    readonly reservationId: number;
    readonly reservation: Readonly<Reserve>;
    readonly generation: RecordingGeneration;
    readonly sessionToken: RecordingSessionToken;
    readonly phase: RecordingPhase;
    /**
     * この binding が指す録画試行が、まだ schedule 側で最新（generation・sessionToken が
     * 一致し、かつ想定した phase のまま）かどうかを確認する。
     * @param expectedPhase この binding 発行時に想定していた phase
     * @returns 最新であれば `true`
     */
    isCurrent?(expectedPhase: RecordingPhase): boolean;
    /**
     * 再スケジュールのために、現在 `Cancelled` になっているこのセッションを
     * 再度 `Waiting` へ戻す。
     * @returns 遷移に成功した場合 `true`
     */
    requeueAfterReschedule?(): boolean;
    /**
     * schedule 側のセッション状態を、想定した phase から次の phase へ遷移させる。
     * `generation`/`sessionToken` が一致しない場合は失敗する。
     * @param expectedPhase 遷移前に想定する phase
     * @param nextPhase 遷移後の phase
     * @returns 遷移に成功した場合 `true`
     */
    tryTransition(expectedPhase: RecordingPhase, nextPhase: RecordingPhase): boolean;
    /**
     * 時刻指定終了（録画時間固定の予約）の締切を schedule 側に登録する。
     * @param dueAt 締切時刻（unix time ms）
     */
    registerTimeSpecifiedEnd(dueAt: number): void;
    /** 登録済みの時刻指定終了の締切を取り消す。 */
    removeTimeSpecifiedEnd(): void;
}

/**
 * 1 件の予約に対する、実際の録画処理（チューナーからのストリーム受信・ファイル書き出し・
 * 状態遷移）を担う契約。`RecordingManageModel` が予約 1 件ごとにインスタンスを生成し、
 * `RecordingScheduleSessionBinding` を通じてスケジュール側と同期しながら制御する。
 * `bindScheduleSession` 以降のメンバは、スケジュール側との連携が必要な実装だけが
 * 持てばよいため任意（optional）になっている。実装は `RecorderModel`。
 */
export default interface IRecorderModel {
    /**
     * 予約に基づいて録画タイマーをセットする。除外（skip）・重複（overlap）扱いの予約には
     * タイマーをセットしない。
     * @param reserve 対象の予約
     * @param isSuppressLog `true` の場合、セット時のログ出力を抑える
     * @returns タイマーのセットに成功した場合 `true`
     */
    setTimer(reserve: Reserve, isSuppressLog: boolean): boolean;
    /**
     * 録画を中止する。
     * @param isPlanToDelete 中止後、録画情報自体を削除する予定である場合 `true`
     * （その場合は削除に向けた終了処理を行う）
     */
    cancel(isPlanToDelete: boolean): Promise<void>;
    /**
     * 予約内容の変更を反映する。変更後に除外・重複扱いになった場合は録画を中止する。
     * @param newReserve 変更後の予約内容
     * @param isSuppressLog `true` の場合、更新時のログ出力を抑える
     */
    update(newReserve: Reserve, isSuppressLog: boolean): Promise<void>;
    /**
     * 録画中の場合、イベントリレー確認用のタイマーを再設定する。
     * @returns 録画中であれば `true`
     */
    resetTimer(): boolean;
    /**
     * スケジュール側との連携窓口を受け取る。再スケジュール等で既存の binding と
     * 異なる binding が渡された場合、古い登録の終了処理を行う。
     * @param binding スケジュール側とやり取りするための binding
     */
    bindScheduleSession?(binding: RecordingScheduleSessionBinding): void;
    /** 録画準備（チューナー確保等）を開始する。 */
    startPreparation?(): void | Promise<void>;
    /** 時刻指定終了の締切に達した際に、録画を終了させる。 */
    finishAtTimeSpecifiedEnd?(): void | Promise<void>;
    /** 削除に向けた録画停止処理が完了するまで待機する。 */
    whenDeletionTerminal?(): Promise<void>;
    /** 通常の録画終了処理が完了するまで待機する。 */
    whenNormalRecordingTerminal?(): Promise<void>;
}
