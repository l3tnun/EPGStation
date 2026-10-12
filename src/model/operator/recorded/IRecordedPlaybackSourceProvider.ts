import { VideoInfo } from '../../api/video/IVideoUtil.js';

/**
 * `open()`で解決された、録画ファイルの再生元の判別共用体。
 * - `encoded-direct`: encode済みファイル。ファイル全体が確定しているため、`reader`を介さず
 *   `inputPath`を直接配信できる。
 * - `recording-tail-reader`: 録画継続中（`recorded.isRecording`）のファイル。末尾がまだ伸び続けるため、
 *   `reader`はファイル終端に達しても終わらせず、書き足しを待って読み進める。
 * - `completed-file-reader`: 録画が完了済みのraw（未エンコード）ファイル。通常の読み切りで終わる`reader`。
 * `playPosition`は再生開始位置（秒）で、`reader`使用時はこれをbit rateから概算したbyte offsetへ
 * 変換した位置から読み出す。
 */
export type RecordedPlaybackSource =
    | {
          readonly kind: 'encoded-direct';
          readonly recordedId: number;
          readonly videoFileId: number;
          readonly playPosition: number;
          readonly inputPath: string;
          readonly videoInfo: VideoInfo;
      }
    | {
          readonly kind: 'recording-tail-reader' | 'completed-file-reader';
          readonly recordedId: number;
          readonly videoFileId: number;
          readonly playPosition: number;
          readonly inputPath: string;
          readonly videoInfo: VideoInfo;
          readonly reader: RecordedPlaybackReader;
      };

/** 録画ファイルを読み出すstreamと、その解放操作をまとめたもの。 */
export interface RecordedPlaybackReader {
    readonly readable: NodeJS.ReadableStream;
    /** streamを閉じ、下位のfile handle等を解放する。 */
    close(): Promise<void>;
}

/**
 * `RecordedPlaybackReader`の生成方法を差し替え可能にするための工場。
 * 既定実装（`NodeRecordedPlaybackReaderFactory`）はNode.jsの`fs/promises`を直接使う。
 */
export interface RecordedPlaybackReaderFactory {
    /**
     * 録画継続中のファイルを、末尾への書き足しを待ちながら読み進めるreaderを開く。
     * @param inputPath 対象ファイルの絶対path。
     * @param start 読み出し開始byte位置。
     */
    openRecordingTail(inputPath: string, start: number): Promise<RecordedPlaybackReader>;
    /**
     * 録画完了済みファイルを、通常の読み切りで終わるreaderで開く。
     * @param inputPath 対象ファイルの絶対path。
     * @param start 読み出し開始byte位置。
     */
    openCompletedFile(inputPath: string, start: number): Promise<RecordedPlaybackReader>;
}

/**
 * `OpenedRecordedPlaybackSource.adopt()`の結果。
 * `stale`は、既に`adopt`済みまたは`disposeBeforeAdoption`済みで、二重に採用できなかったことを表す。
 */
export type RecordedPlaybackSourceAdoption =
    { readonly status: 'adopted'; readonly source: RecordedPlaybackSource } | { readonly status: 'stale' };

/**
 * `open()`が返す、まだ使用権が確定していない再生元のhandle。呼び出し側は`adopt()`で実際に使用を開始するか、
 * 使わないと決めた場合は`disposeBeforeAdoption()`で解放しなければならない（例: 配信開始前にrequestが
 * 中断された場合、開いたfile handleを溜めないため）。
 */
export interface OpenedRecordedPlaybackSource {
    /** `pending`（未確定）→`adopted`（採用済み、以後の解放は呼び出し側の責務）または`disposed`（未採用のまま解放済み）。 */
    readonly state: 'pending' | 'adopted' | 'disposed';
    /**
     * 再生元を採用する。既に`adopt`または`disposeBeforeAdoption`が呼ばれていた場合は`stale`を返す
     * （二重採用・採用後の誤った解放を防ぐガード）。
     */
    adopt(): RecordedPlaybackSourceAdoption;
    /**
     * 採用されないまま不要になった再生元を解放する。既に`adopted`の場合は何もしない
     * （解放責務は既に呼び出し側へ移っているため）。`encoded-direct`はfile handleを保持しないため実質no-op。
     */
    disposeBeforeAdoption(): Promise<void>;
}

/**
 * 録画ファイル（`VideoFile`）から、実際に配信可能な再生元を解決する契約。実装は`RecordedPlaybackSourceProvider`。
 */
export default interface IRecordedPlaybackSourceProvider {
    /**
     * 録画ファイルIDから、それが属する録画情報のIDを引く。
     * @param videoFileId 対象の録画ファイルID。存在しなければ例外を投げる。
     * @returns 対応する録画ID。
     */
    resolveRecordedId(videoFileId: number): Promise<number>;
    /**
     * 再生元を開く。
     * @param videoFileId 対象の録画ファイルID。
     * @param expectedRecordedId 呼び出し側が事前に確認した想定録画ID。`resolveRecordedId`呼び出しと
     *                            この呼び出しの間に録画ファイルの所属が変わっていないかを検証するために使う
     *                            （一致しなければ例外を投げる）。
     * @param playPosition 再生開始位置（秒）。
     * @param option `allowMissingVideoInfo`が`true`のとき、動画情報の取得に失敗しても失敗とせず、動画情報を`NaN`にして返す
     *               （動画情報を使わない直接配信用）。省略時は取得の失敗をそのまま失敗として返す。
     * @returns まだ採用されていない再生元のhandle。呼び出し側は`adopt()`または`disposeBeforeAdoption()`を
     *          必ず呼ぶこと。
     */
    open(
        videoFileId: number,
        expectedRecordedId: number,
        playPosition: number,
        option?: RecordedPlaybackOpenOption,
    ): Promise<OpenedRecordedPlaybackSource>;
}

/** `open()`の任意指定。 */
export interface RecordedPlaybackOpenOption {
    /** 動画情報（ffprobe）の取得失敗を許し、`NaN`の動画情報で続けるか。 */
    readonly allowMissingVideoInfo?: boolean;
}
