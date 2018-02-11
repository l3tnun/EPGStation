import Model from '../Model';
import { EncodeManagerInterface, EncodeProgram } from '../../Service/EncodeManager';
import SocketIoServer from '../../Service/SocketIoServer';
import { IPCClientInterface } from '../IPC/IPCClient';
import { RecordedDBInterface } from '../DB/RecordedDB';

interface EncodeModelInterface extends Model {
    setIPC(ipc: IPCClientInterface): void;
    push(program: EncodeProgram): void;
}

/**
* EncodeModel
* エンコードのセットを行う
*/
class EncodeModel extends Model implements EncodeModelInterface {
    private encodeManager: EncodeManagerInterface;
    private socket: SocketIoServer;
    private ipc: IPCClientInterface;
    private recordedDB: RecordedDBInterface;

    constructor(
        encodeManager: EncodeManagerInterface,
        socket: SocketIoServer,
        recordedDB: RecordedDBInterface,
    ) {
        super();
        this.encodeManager = encodeManager;
        this.socket = socket;
        this.recordedDB = recordedDB;

        this.encodeManager.addEncodeDoneListener((id, name, filePath, delTs, isTsModify) => { this.encodeFinCallback(id, name, filePath, delTs, isTsModify); });
        this.encodeManager.addEncodeErrorListener(() => { this.encodeErrorCallback(); });
    }

    /**
    * IPCClient をセット
    */
    public setIPC(ipc: IPCClientInterface): void {
        this.ipc = ipc;
    }

    /**
    * エンコードの依頼を受ける
    * @param program: EncodeProgram
    */
    public push(program: EncodeProgram): void {
        this.encodeManager.push(program);
    }

    /**
    * エンコード完了時の callback
    * @param recordedId: recorded id
    * @param filePath: encode file path
    */
    private async encodeFinCallback(recordedId: number, name: string, filePath: string, delTs: boolean, isTsModify: boolean): Promise<void> {
        try {
            if(!isTsModify) {
                // エンコード済みファイルを DB へ追加
                await this.ipc.addEncodeFile(recordedId, name, filePath, delTs);
            } else {
                // ts ファイルのファイルサイズ更新
                await this.recordedDB.updateFileSize(recordedId);
            }
        } catch(err) {
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

