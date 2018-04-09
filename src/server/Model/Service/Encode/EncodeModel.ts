import { IPCClientInterface } from '../../IPC/IPCClient';
import Model from '../../Model';
import { SocketIoManageModelInterface } from '../SocketIoManageModel';
import { EncodeManageModelInterface, EncodeProgram } from './EncodeManageModel';

interface EncodeModelInterface extends Model {
    push(program: EncodeProgram): void;
}

/**
 * EncodeModel
 * エンコードのセットを行う
 */
class EncodeModel extends Model implements EncodeModelInterface {
    private encodeManage: EncodeManageModelInterface;
    private socket: SocketIoManageModelInterface;
    private ipc: IPCClientInterface;

    constructor(
        encodeManage: EncodeManageModelInterface,
        socket: SocketIoManageModelInterface,
        ipc: IPCClientInterface,
    ) {
        super();
        this.encodeManage = encodeManage;
        this.socket = socket;
        this.ipc = ipc;

        this.encodeManage.addEncodeDoneListener((id, name, output, delTs, isTsModify) => { this.encodeFinCallback(id, name, output, delTs, isTsModify); });
        this.encodeManage.addEncodeErrorListener(() => { this.encodeErrorCallback(); });
    }

    /**
     * エンコードの依頼を受ける
     * @param program: EncodeProgram
     */
    public push(program: EncodeProgram): void {
        this.encodeManage.push(program);
    }

    /**
     * エンコード完了時の callback
     */
    private async encodeFinCallback(recordedId: number, name: string, output: string | null, delTs: boolean, isTsModify: boolean): Promise<void> {
        try {
            if (output === null) {
                if (isTsModify) {
                    // ts ファイルのファイルサイズ更新
                    await this.ipc.updateTsFileSize(recordedId);
                } else if (delTs) {
                    // tsModify でなく ts 削除が有効な場合は録画一覧から削除
                    await this.ipc.recordedDelete(recordedId);
                }
            } else {
                // エンコード済みファイルを DB へ追加
                await this.ipc.addEncodeFile(recordedId, name, output, delTs);
            }
        } catch (err) {
            this.log.system.error(err);
        }

        // socket.io で通知
        this.socket.notifyClient();
    }

    /**
     * エンコード失敗時の callback
     */
    private encodeErrorCallback(): void {
        // socket.io で通知
        this.socket.notifyClient();
    }
}

export { EncodeModelInterface, EncodeModel };

