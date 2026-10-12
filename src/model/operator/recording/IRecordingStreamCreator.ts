import * as http from 'http';
import Reserve from '../../../db/entities/Reserve.js';
import { TunerInfo } from '../../tuner/types.js';

/**
 * `create` でストリームを取得する際の追加指定。
 */
export interface RecordingStreamCreationOptions {
    /** この予約の終了時刻が、外部（時刻指定予約の変更等）によって既にスケジュール済みである場合 `true`。 */
    readonly isTimeSpecifiedEndExternallyScheduled?: boolean;
}

/**
 * tuner から録画対象の予約に対応する放送ストリームを取得する契約。同じ tuner を
 * 複数の予約で共有する場合の空き状況判定や、時刻指定予約の終了時刻に応じた
 * ストリーム破棄タイマーの管理も担う。実装は `RecordingStreamCreator`。
 */
interface IRecordingStreamCreator {
    /**
     * 利用可能な tuner の一覧をセットする。2 回目以降の呼び出しは無視される
     * （プロセス起動時に 1 度だけ設定される想定）。
     * @param tuners 現在利用可能な tuner の情報一覧
     */
    setTuner(tuners: TunerInfo[]): void;
    /**
     * 予約に対応する放送ストリームを取得する。競合状態（`isConflict`）の予約は
     * tuner を割り当てず、空きストリームの取得のみを試みる。
     * @param reserve 対象の予約
     * @param abortSignal 呼び出し元がストリーム取得を中断するための signal
     * @param options ストリーム取得に関する追加指定
     * @returns 取得した放送ストリーム
     */
    create(
        reserve: Reserve,
        abortSignal?: AbortSignal,
        options?: RecordingStreamCreationOptions,
    ): Promise<http.IncomingMessage>;
    /**
     * 時刻指定予約の終了時刻（endAt）変更を反映し、ストリーム破棄タイマーを
     * 新しい終了時刻に合わせて再設定する。時刻指定予約以外（`programId` が設定されている
     * 予約）に対して呼ぶと例外を投げる。
     * @param reserve 変更後の終了時刻を持つ予約
     */
    changeEndAt(reserve: Reserve): void;
    /**
     * 時刻指定予約に対して設定されているストリーム破棄タイマーを解除する。
     * @param reserveId 対象の予約 id
     */
    releaseTimeSpecifiedEnd?(reserveId: number): void;
}

namespace IRecordingStreamCreator {
    // tuner を共有する隣接予約の終了間際かどうかを判定する猶予（ミリ秒）。
    // この時間内に終了する予約とは、末尾が多少削れても共有継続を許容する。
    export const PREP_TIME = 15 * 1000;
}

/** `IRecordingStreamCreator`（interfaceと`PREP_TIME`を持つnamespaceのマージ）を公開する。 */
export default IRecordingStreamCreator;
