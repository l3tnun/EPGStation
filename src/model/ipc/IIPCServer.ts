import { ChildProcess } from 'child_process';
import type * as apid from '../../../api.js';

/**
 * 管理側（operator process。親process）で、Web・API側処理（service process。子process）とのNode.js IPC通信を
 * 担う契約。実装は`IPCServer`。子processの起動側（`ServiceExecutor`等）が`register`で子processを登録し、以後は
 * 子processからの操作依頼を管理側の各manage modelへ振り分けて応答し、管理側からの通知を子processへ送る。
 */
export default interface IIPCServer {
    /** アップロード動画の採用処理など、非同期の初期化が必要な下位コンポーネントの準備を待つ。 */
    initialize(): Promise<void>;
    /**
     * 現在の通知先とするWeb・API側処理（子process）を登録する。既に別のprocessが登録済みの場合は
     * その登録を解除してから差し替える（同時に有効なpeerは常に1つ）。
     * @param child 新たに起動したWeb・API側処理のハンドル。
     */
    register(child: ChildProcess): void;
    /** 管理情報の状態変化を、socket.io経由で画面へ知らせるよう子processへ通知する。 */
    notifyClient(): void;
    /**
     * 録画完了後などのエンコード依頼を、録画ファイル変換機能の依頼記録窓口へ渡して同期で戻る。
     * 窓口は依頼を記録した後、`pushEncode`で識別番号付きの依頼を子processへ送る。
     * 依頼記録窓口が組み立てられていない場合は`EncodeQueueStoreNotRegistered`を同期でthrowする。
     * @param addOption 依頼するencodeの内容。
     */
    setEncode(addOption: apid.AddEncodeProgramOption): void;
    /**
     * 識別番号付きのエンコード依頼を現在の通知先へ一方向に送る。通知先が無い場合と送信呼出しの同期失敗は
     * 運用ログへ記録して`false`を返し、送信callbackの非同期失敗は記録して破棄する（保存・再送はしない）。
     * @param encodeId 依頼の記録の識別番号。
     * @param option 依頼の内容。
     * @returns 送信を呼び出せたら`true`、通知先が無いか同期で失敗したら`false`。
     */
    pushEncode(encodeId: apid.EncodeId, option: apid.AddEncodeProgramOption): boolean;
}
