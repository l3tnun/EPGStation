import { ChildProcess } from 'child_process';
import type * as apid from '../../../api.js';

/**
 * web/service process側で、operator process（子process）とのNode.js IPC通信を担う契約。
 * 実装は`IPCServer`。operator processの起動側（`ServiceExecutor`等）が`register`で子processを
 * 登録し、以後はmanage model側からの通知や、operator process側からの要求への応答を仲介する。
 */
export default interface IIPCServer {
    /** アップロード動画の採用処理など、非同期の初期化が必要な下位コンポーネントの準備を待つ。 */
    initialize(): Promise<void>;
    /**
     * 現在通信対象とするoperator processを登録する。既に別のprocessが登録済みの場合は
     * その登録を解除してから差し替える（同時に有効なpeerは常に1つ）。
     * @param child 新たに接続してきたoperator processのハンドル。
     */
    register(child: ChildProcess): void;
    /** operator process側の状態変化を、socket.io経由でクライアントへ通知するよう依頼する。 */
    notifyClient(): void;
    /**
     * operator processへencode処理を依頼する。
     * @param addOption 依頼するencodeの内容。
     */
    setEncode(addOption: apid.AddEncodeProgramOption): void;
}
