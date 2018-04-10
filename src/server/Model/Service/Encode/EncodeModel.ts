import { EncodedDBInterface } from '../../DB/EncodedDB';
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
    private encodedDB: EncodedDBInterface;
    private socket: SocketIoManageModelInterface;
    private ipc: IPCClientInterface;

    constructor(
        encodeManage: EncodeManageModelInterface,
        encodedDB: EncodedDBInterface,
        socket: SocketIoManageModelInterface,
        ipc: IPCClientInterface,
    ) {
        super();
        this.encodeManage = encodeManage;
        this.encodedDB = encodedDB;
        this.socket = socket;
        this.ipc = ipc;

        this.encodeManage.addEncodeDoneListener((recordedId, encodedId, name, output, delTs) => {
            this.encodeFinCallback(recordedId, encodedId, name, output, delTs);
        });
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
    private async encodeFinCallback(recordedId: number, encodedId: number | null, name: string, output: string | null, delTs: boolean): Promise<void> {
        try {
            if (output === null) {
                if (encodedId === null) {
                    this.log.system.info(`update ts file size: ${ recordedId }`);
                    // ts ファイルのファイルサイズ更新
                    await this.ipc.updateTsFileSize(recordedId);
                } else {
                    // encoded ファイルのファイルサイズ更新
                    this.log.system.info(`update encoded file size: ${ encodedId }`);
                    await this.ipc.updateEncodedFileSize(recordedId);
                }

                if (delTs) {
                    const encodedList = await this.encodedDB.findRecordedId(recordedId);
                    if (encodedList.length === 0) {
                        // ts だけなので録画一覧から削除
                        await this.ipc.recordedDelete(recordedId);
                    } else {
                        // encoded が存在するので ts ファイルのみ削除する
                        await this.ipc.recordedDeleteFile(recordedId);
                    }
                }
            } else {
                // エンコード済みファイルを DB へ追加
                await this.ipc.addEncodeFile(recordedId, name, output);

                // ts を削除
                if (delTs) {
                    await this.ipc.recordedDeleteFile(recordedId);
                }
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

