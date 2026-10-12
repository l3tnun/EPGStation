import type * as apid from '../../../../api.js';
import VideoFile from '../../../db/entities/VideoFile.js';
/** `ffprobe`で調べた動画の実測情報。 */
export interface VideoInfo {
    duration: number; // sec
    size: number; // byte
    bitRate: number; // bps
}

/** ビデオファイルの実体パス解決・`ffprobe`による実測情報取得を行う契約。実装は`VideoUtil`。 */
export default interface IVideoUtil {
    /**
     * ビデオファイルIDから、実体ファイルの絶対パスを解決する。
     * @param videoFileId 対象ビデオファイルのID。
     * @returns 絶対パス。DBに該当レコードが無い、または保存先ディレクトリ名が設定に見つからない場合は`null`。
     */
    getFullFilePathFromId(videoFileId: apid.VideoFileId): Promise<string | null>;
    /**
     * 取得済みの`VideoFile`エンティティから、実体ファイルの絶対パスを解決する。
     * @param videoFile 変換元のDBエンティティ。
     * @returns 絶対パス。保存先ディレクトリ名が設定に見つからない場合は`null`。
     */
    getFullFilePathFromVideoFile(videoFile: VideoFile): string | null;
    /**
     * 保存先ディレクトリ名から、設定済みの実ディレクトリパスを解決する。
     * @param name 保存先ディレクトリ名（`recorded`設定の`name`。特別扱いとして`'tmp'`は`recordedTmp`設定を指す）。
     * @returns 実ディレクトリの絶対パス。設定に該当する名前が見つからなければ`null`。
     */
    getParentDirPath(name: string): string | null;
    /**
     * `ffprobe`でファイルを解析し、再生時間・サイズ・ビットレートを取得する。
     * 一定時間（30秒）応答が無い場合はプロセスを`SIGKILL`で強制終了し、タイムアウトエラーを返す。
     * @param filePath 解析対象ファイルの絶対パス。
     * @returns 実測した動画情報。
     */
    getInfo(filePath: string): Promise<VideoInfo>;
}
