import internal from 'stream';
import type * as apid from '../../../../api.js';
import IPlayList from '../IPlayList.js';

/** 開始したストリームのIDと、client へ送出する読み取りストリーム本体の組。 */
export interface StreamResponse {
    streamId: apid.StreamId;
    stream: internal.Readable;
}

/** ライブ・録画済みストリーミング配信の開始・停止・維持を行うAPI層の契約。実装は`StreamApiModel`（配信本体は`StreamManageModel`に委譲）。 */
export default interface IStreamApiModel {
    /**
     * ライブ視聴用のMPEG2-TSストリーム配信を開始する。
     * @param option 対象チャンネル・出力設定等。
     * @returns ストリームIDと読み取りストリーム。
     */
    startLiveM2TsStream(option: apid.LiveStreamOption): Promise<StreamResponse>;
    /**
     * 低遅延（Low Latency）設定でのMPEG2-TSライブストリーム配信を開始する。
     * @param option 対象チャンネル・出力設定等。
     * @returns ストリームIDと読み取りストリーム。
     */
    startLiveM2TsLLStream(option: apid.LiveStreamOption): Promise<StreamResponse>;
    /**
     * ライブ視聴用のWebMストリーム配信（トランスコード）を開始する。
     * @param option 対象チャンネル・出力設定等。
     * @returns ストリームIDと読み取りストリーム。
     */
    startLiveWebmStream(option: apid.LiveStreamOption): Promise<StreamResponse>;
    /**
     * ライブ視聴用のMP4ストリーム配信（トランスコード）を開始する。
     * @param option 対象チャンネル・出力設定等。
     * @returns ストリームIDと読み取りストリーム。
     */
    startMp4Stream(option: apid.LiveStreamOption): Promise<StreamResponse>;
    /**
     * ライブ視聴用のHLS配信を開始する（HLSはセグメントファイル群として配信されるため、他のstart系と異なり読み取りストリームは返さない）。
     * @param option 対象チャンネル・出力設定等。
     * @returns 開始したストリームのID。
     */
    startLiveHLSStream(option: apid.LiveStreamOption): Promise<apid.StreamId>;
    /**
     * 録画済み番組のWebMストリーム配信（トランスコード）を開始する。
     * @param option 対象録画・再生位置等。
     * @returns ストリームIDと読み取りストリーム。
     */
    startRecordedWebMStream(option: apid.RecordedStreanOption): Promise<StreamResponse>;
    /**
     * 録画済み番組のMP4ストリーム配信（トランスコード）を開始する。
     * @param option 対象録画・再生位置等。
     * @returns ストリームIDと読み取りストリーム。
     */
    startRecordedMp4Stream(option: apid.RecordedStreanOption): Promise<StreamResponse>;
    /**
     * 録画済み番組のHLS配信を開始する。
     * @param option 対象録画・再生位置等。
     * @returns 開始したストリームのID。
     */
    startRecordedHLSStream(option: apid.RecordedStreanOption): Promise<apid.StreamId>;
    /**
     * ライブHLS配信用のm3u8プレイリストを取得する。
     * @param host プレイリスト内のURLに使うhost。
     * @param isSecure プレイリスト内のURLをhttpsにするか。
     * @param option 対象チャンネル等の条件。
     * @returns プレイリスト。対象ストリームが存在しない場合は`null`。
     */
    getLiveM2TsStreamM3u8(host: string, isSecure: boolean, option: apid.LiveStreamOption): Promise<IPlayList | null>;
    /**
     * 配信中のストリームを停止する。
     * @param streamId 対象ストリームのID。
     * @param isForce 停止処理の優先度を上げるか。`true`にすると、チューナー等の共有資源を巡る他の処理より
     *   優先して停止処理を進める。未指定時は`false`（通常優先度）。
     */
    stop(streamId: apid.StreamId, isForce?: boolean): Promise<void>;
    /** 配信中の全ストリームを停止する。 */
    stopAll(): Promise<void>;
    /**
     * 指定ストリームの停止タイマーを延長し、視聴が続いていることを伝える（client からの定期的な呼び出しを想定）。
     * @param streamId 対象ストリームのID。
     */
    keep(streamId: apid.StreamId): void;
    /**
     * 配信中の全ストリームの状況を取得する。
     * @param isHalfWidth 番組名等を半角文字で返すか。
     * @returns ライブ・録画済みそれぞれのストリーム情報一覧。
     */
    getStreamInfos(isHalfWidth: boolean): Promise<apid.StreamInfo>;
}
