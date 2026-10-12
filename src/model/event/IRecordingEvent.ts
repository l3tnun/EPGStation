import type * as apid from '../../../api.js';
import Recorded from '../../db/entities/Recorded.js';
import Reserve from '../../db/entities/Reserve.js';

/**
 * 録画失敗イベント（`emitRecordingFailed`）が、どの録画試行（世代）に対する失敗かを
 * 特定するための識別情報。録画はキャンセル・再スケジュールで世代が切り替わることが
 * あるため、`generation`/`sessionToken` を突き合わせて「今の試行に対する失敗か、
 * 既に置き換わった古い試行の失敗か」を購読側（`RecordingManageModel`）が判定できるようにする。
 */
export interface RecordingFailureSessionIdentity {
    readonly reservationId: number;
    readonly reservation: Readonly<Reserve>;
    readonly generation: bigint;
    readonly sessionToken: bigint;
}

/**
 * 録画処理の進行状況を、発生元（録画実行）から他の module へ通知するための event の契約。
 * `emitXxx` は発生元が呼び出してイベントを発行し、`setXxx` は購読側がコールバックを登録する。
 * 実装は `RecordingEvent`。
 */
export default interface IRecordingEvent {
    /**
     * 録画準備（チューナー確保等）を開始したことを通知する。
     * @param reserve 対象の予約
     */
    emitStartPrepRecording(reserve: Reserve): void;
    /**
     * 録画準備を中止したことを通知する。
     * @param reserve 対象の予約
     */
    emitCancelPrepRecording(reserve: Reserve): void;
    /**
     * 録画準備に失敗したことを通知する。
     * @param reserve 対象の予約
     */
    emitPrepRecordingFailed(reserve: Reserve): void;
    /**
     * 録画を開始したことを通知する。
     * @param reserve 対象の予約
     * @param recorded 開始に伴って作成された録画情報
     */
    emitStartRecording(reserve: Reserve, recorded: Recorded): void;
    /**
     * 録画が失敗したことを通知する。
     * @param reserve 対象の予約
     * @param recorded 失敗時点で存在した録画情報。作成前に失敗した場合は `null`
     * @param failureSession この失敗がどの録画試行（世代）のものかを示す識別情報。
     * 省略された場合、購読側は現在進行中の試行に対する失敗として扱う
     */
    emitRecordingFailed(
        reserve: Reserve,
        recorded: Recorded | null,
        failureSession?: RecordingFailureSessionIdentity,
    ): void;
    /**
     * 録画のリトライ回数上限を超えたことを通知する。
     * @param reserve 対象の予約
     */
    emitRecordingRetryOver(reserve: Reserve): void;
    /**
     * 録画が正常に終了したことを通知する。
     * @param reserve 対象の予約
     * @param recorded 完了した録画情報
     * @param isNeedDeleteReservation 完了に伴い予約情報を削除する必要がある場合 `true`
     */
    emitFinishRecording(reserve: Reserve, recorded: Recorded, isNeedDeleteReservation: boolean): void;
    /**
     * リレー予約（親予約から派生した番組群）の情報を通知する。
     * @param programs 対象の番組 id と、その親となる予約の組の一覧
     */
    emitEventRelay(programs: { programId: apid.ProgramId; parentReserve: Reserve }[]): void;
    /**
     * `emitStartPrepRecording` を購読する。
     * @param callback 対象の予約を受け取るコールバック
     */
    setStartPrepRecording(callback: (reserve: Reserve) => void): void;
    /**
     * `emitCancelPrepRecording` を購読する。
     * @param callback 対象の予約を受け取るコールバック
     */
    setCancelPrepRecording(callback: (reserve: Reserve) => void): void;
    /**
     * `emitPrepRecordingFailed` を購読する。
     * @param callback 対象の予約を受け取るコールバック
     */
    setPrepRecordingFailed(callback: (reserve: Reserve) => void): void;
    /**
     * `emitStartRecording` を購読する。
     * @param callback 対象の予約と作成された録画情報を受け取るコールバック
     */
    setStartRecording(callback: (reserve: Reserve, recorded: Recorded) => void): void;
    /**
     * `emitRecordingFailed` を購読する。
     * @param callback 対象の予約・録画情報・失敗の世代識別情報を受け取るコールバック
     */
    setRecordingFailed(
        callback: (
            reserve: Reserve,
            recorded: Recorded | null,
            failureSession?: RecordingFailureSessionIdentity,
        ) => void,
    ): void;
    /**
     * `emitRecordingRetryOver` を購読する。
     * @param callback 対象の予約を受け取るコールバック
     */
    setRecordingRetryOver(callback: (reserve: Reserve) => void): void;
    /**
     * `emitFinishRecording` を購読する。
     * @param callback 対象の予約・録画情報・予約削除要否を受け取るコールバック
     */
    setFinishRecording(
        callback: (reserve: Reserve, recorded: Recorded, isNeedDeleteReservation: boolean) => void,
    ): void;
    /**
     * `emitEventRelay` を購読する。
     * @param callback リレー予約の番組 id と親予約の組の一覧を受け取るコールバック
     */
    setEventRelay(callback: (programs: { programId: apid.ProgramId; parentReserve: Reserve }[]) => void): void;
}
