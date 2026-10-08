import internal from 'stream';
import type * as apid from '../../../../../api.js';

/**
 * ストリーム情報ベース
 */
export interface BaseStreamInfo {
    type: apid.StreamType;
    mode: number;
    isEnable: boolean;
}

/**
 * ライブストリーム情報
 */
export interface LiveStreamInfo extends BaseStreamInfo {
    type: 'LiveStream' | 'LiveHLS';
    channelId: apid.ChannelId;
}

/**
 * 録画ファイルストリーム情報
 */
export interface RecordedStreamInfo extends BaseStreamInfo {
    type: 'RecordedStream' | 'RecordedHLS';
    videoFileId: apid.VideoFileId;
}

/**
 * ライブ配信・録画済み配信・HLS・非HLS を問わず、`StreamManageModel` が
 * 個々の配信の実体（stream）を操作するために依存する共通契約。
 *
 * `StreamManageModel` はこの interface が持つ method・真偽値だけを見て振る舞いを決め、
 * 具体的な配信方式（HLS かどうか等）を判定するための型・文字列判定には依存しない
 * （`ownsDiskArtifacts()` / `finalizeStop()` はそのために存在する、後述）。
 */
export default interface IStreamBaseModel<T> {
    /**
     * stream 生成に必要な option を設定する。start() を呼ぶ前に呼んでおく必要がある。
     */
    setOption(option: T, mode: number): void;
    /**
     * streamId を確定させ、実際の配信（放送波受信・エンコードプロセス起動等）を開始する。
     */
    start(streamId: apid.StreamId): Promise<void>;
    /**
     * 配信を停止し、保持している資源（プロセス・ハンドル等）を解放する。
     */
    stop(): Promise<void>;
    /**
     * 配信内容を読み出すための Readable を返す。start() の解決後にのみ有効。
     */
    getStream(): internal.Readable;
    /**
     * 現在の配信種別・状態を表す情報を返す。
     */
    getInfo(): LiveStreamInfo | RecordedStreamInfo;
    /**
     * この stream が終了した際に一度だけ呼ばれる callback を登録する。
     */
    setExitStream(callback: () => void): void;
    /**
     * 一定時間内に呼ばれないと自動停止するタイマーを、呼ばれた時点から再セットする
     * （配信を継続させたい側が定期的に呼ぶことを想定）。
     */
    keep(): void;
    /**
     * この stream が、streamId を鍵にした成果物をディスク上の共有ディレクトリへ
     * 書き出す種別かどうかを返す。
     *
     * true を返す種別では、呼び出し側（StreamManageModel）は
     * ディスク上の既存成果物と衝突しない streamId を選ぶ採番戦略を使い、
     * start() が解決した後もこの stream 自身の readiness 通知を待ってから
     * 稼働中として扱う。false を返す種別では、単純な採番と、start() 解決と
     * 同時の readiness 確定でよい。
     *
     * 何が「成果物」であるか（HLS のセグメントファイル等）は実装側だけが知っていればよく、
     * 呼び出し側はこの真偽値だけを見て振る舞いを決める。
     */
    ownsDiskArtifacts(): boolean;
    /**
     * stream が管理側（StreamManageModel）のレジストリから除去された直後に
     * 一度だけ呼ばれる、後始末完了の通知フック。
     *
     * ディスク上に成果物を持たない種別（ownsDiskArtifacts() が false を返す種別）では
     * no-op でよい。
     */
    finalizeStop(): void;
}
