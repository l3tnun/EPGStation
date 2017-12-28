import Model from '../Model';
import { EncodeManagerInterface, EncodeProgram } from '../../Service/EncodeManager';
import SocketIoServer from '../../Service/SocketIoServer';
import { IPCClientInterface } from '../IPC/IPCClient';

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

    constructor(
        encodeManager: EncodeManagerInterface,
        socket: SocketIoServer,
    ) {
        super();
        this.encodeManager = encodeManager;
        this.socket = socket;

        this.encodeManager.addListener((id, name, filePath, delTs, isTsModify) => { this.encodeFinCallback(id, name, filePath, delTs, isTsModify); });
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
            }

            // socket.io で通知
            this.socket.notifyClient();
        } catch(err) {
            this.log.system.error(err);
        }
    }
}

export { EncodeModelInterface, EncodeModel };

