import Recorded from '../../../db/entities/Recorded.js';
import Reserve from '../../../db/entities/Reserve.js';
import { OperatorFinishEncodeInfo } from '../../event/IOperatorEncodeEvent.js';
import { IReserveUpdateValues } from '../../event/IReserveEvent.js';

/**
 * 予約・録画・エンコードのライフサイクルに合わせて、config.yml で設定された外部コマンド
 * （hook）を実行する契約。各 `addXxxCmd` は該当イベント発生時に呼ばれ、対応する
 * コマンド設定が config に無ければ何もしない。実行は内部で queue 化され、直列に処理される。
 * 実装は `ExternalCommandManageModel`。
 */
export default interface IExternalCommandManageModel {
    /**
     * 予約の追加・更新・削除に応じたコマンドの実行を queue に積む。
     * @param diff 変更内容（追加・更新・削除された予約）
     */
    addUpdateReseves(diff: IReserveUpdateValues): void;
    /**
     * 録画準備開始時のコマンドの実行を queue に積む。
     * @param reserve 対象の予約
     */
    addRecordingPrepStartCmd(reserve: Reserve): void;
    /**
     * 録画準備失敗時のコマンドの実行を queue に積む。
     * @param reserve 対象の予約
     */
    addRecordingPrepRecFailedCmd(reserve: Reserve): void;
    /**
     * 録画開始時のコマンドの実行を queue に積む。
     * @param recorded 開始に伴って作成された録画情報
     */
    addRecordingStartCmd(recorded: Recorded): void;
    /**
     * 録画終了時のコマンドの実行を queue に積む。
     * @param recorded 完了した録画情報
     */
    addRecordingFinishCmd(recorded: Recorded): void;
    /**
     * 録画失敗時のコマンドの実行を queue に積む。
     * @param recorded 失敗時点の録画情報
     */
    addRecordingFailedCmd(recorded: Recorded): void;
    /**
     * エンコード完了時のコマンドの実行を queue に積む。
     * @param info 完了したエンコードの結果情報
     */
    addEncodingFinishCmd(info: OperatorFinishEncodeInfo): void;
}
