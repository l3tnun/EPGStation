import type * as apid from '../../../../api.js';
import type { FileHandle } from 'fs/promises';
import Reserve from '../../../db/entities/Reserve.js';
import Recorded from '../../../db/entities/Recorded.js';
import { RecordedDirInfo } from '../../IConfigFile.js';

/**
 * `getRecPath` が算出した、録画ファイルの保存先情報。
 */
export interface RecFilePathInfo {
    parendDir: RecordedDirInfo; // 親ディレクトリ情報
    subDir: string; // サブディレクトリ
    fileName: string; // ファイル名 (拡張子付き)
    fullPath: string;
    fileHandle?: FileHandle;
}

/**
 * 録画に関する、複数の module から共通で使われる補助処理（保存先パスの算出、
 * tmp 保存からの本保存先への移動、ファイルサイズの反映、ファイル名フォーマットの展開）を
 * まとめた契約。実装は `RecordingUtilModel`。
 */
export default interface IRecordingUtilModel {
    /**
     * 予約に対する録画ファイルの保存先パスを決定する。決定処理は排他制御（優先度付き
     * 実行権）の下で行われ、同名ファイルとの衝突を避けてファイルを確保する。
     * @param reserve 対象の予約
     * @param isEnableTmp `true` の場合、config.yml の recordedTmp（一時保存先）が
     * 設定されていればそちらを優先して使う
     * @param isReserveFile 予約変更前後で保存先パスを算出し直す場合など、既に
     * 予約されているファイルの本来の保存先を求める場合は `true`
     * @returns 決定した保存先の情報
     */
    getRecPath(reserve: Reserve, isEnableTmp: boolean, isReserveFile?: boolean): Promise<RecFilePathInfo>;
    /**
     * tmp 保存先にあるビデオファイルを、本来の保存先（recordedTmp 以外の config.yml の
     * 保存先設定）へ移動する。
     * @param reserve 移動先パスの算出に使う予約情報
     * @param videoFileId 移動対象のビデオファイル id
     * @returns 移動後のファイルパス
     */
    movingFromTmp(reserve: Reserve, videoFileId: apid.VideoFileId): Promise<string>;
    /**
     * 実ファイルのサイズを調べ、DB 上のビデオファイル情報へ反映する。
     * @param videoFileId 対象のビデオファイル id
     */
    updateVideoFileSize(videoFileId: apid.VideoFileId): Promise<void>;
    /**
     * ファイル名フォーマット文字列（config.yml の recordedFormat 等）に含まれる
     * プレースホルダーを、番組・チャンネル情報で置き換えて展開する。
     * @param format プレースホルダーを含むフォーマット文字列
     * @param src 展開に使う録画情報または予約情報
     * @returns 展開後の文字列
     */
    formatFilePathString(format: string, src: Recorded | Reserve): Promise<string>;
}
