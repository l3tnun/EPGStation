import { EncodedDBInterface } from '../../DB/EncodedDB';
import { IPCClientInterface } from '../../IPC/IPCClient';
import Model from '../../Model';
import { SocketIoManageModelInterface } from '../SocketIoManageModel';
import { RecordedStreamStatusInfo, StreamManageModelInterface } from '../Stream/StreamManageModel';
import { EncodeManageModelInterface } from './EncodeManageModel';

interface EncodeFinModelInterface extends Model {
    set(): void;
}

/**
 * EncodeFinModel
 * エンコード終了後の処理を行う
 */
class EncodeFinModel extends Model implements EncodeFinModelInterface {
    private encodeManage: EncodeManageModelInterface;
    private streamManage: StreamManageModelInterface;
    private encodedDB: EncodedDBInterface;
    private socket: SocketIoManageModelInterface;
    private ipc: IPCClientInterface;

    constructor(
        encodeManage: EncodeManageModelInterface,
        streamManage: StreamManageModelInterface,
        encodedDB: EncodedDBInterface,
        socket: SocketIoManageModelInterface,
        ipc: IPCClientInterface,
    ) {
        super();
        this.encodeManage = encodeManage;
        this.streamManage = streamManage;
        this.encodedDB = encodedDB;
        this.socket = socket;
        this.ipc = ipc;

        this.encodeManage.addEncodeErrorListener(() => { this.encodeErrorCallback(); });
    }

    /**
     * callback のセット
     */
    public set(): void {
        this.encodeManage.addEncodeDoneListener((recordedId, encodedId, name, output, delTs) => {
            this.encodeFinCallback(recordedId, encodedId, name, output, delTs);
        });
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
                        await this.deleteTsFile(recordedId);
                    }
                }
            } else {
                // エンコード済みファイルを DB へ追加
                await this.ipc.addEncodeFile(recordedId, name, output);

                // ts を削除
                if (delTs) {
                    await this.deleteTsFile(recordedId);
                }
            }
        } catch (err) {
            this.log.system.error(err);
        }

        // socket.io で通知
        this.socket.notifyClient();
    }

    /**
     * delete ts
     * @param recordedId: recorded id
     */
    private async deleteTsFile(recordedId: number): Promise<void> {
        // 配信中かチェック
        const infos = this.streamManage.getStreamInfos();
        for (const info of infos) {
            if (
                (<RecordedStreamStatusInfo> info).recordedId === recordedId
                && typeof (<RecordedStreamStatusInfo> info).encodedId === 'undefined'
            ) {
                // ts ファイル配信中
                return;
            }
        }

        await this.ipc.recordedDeleteFile(recordedId);
    }

    /**
     * エンコード失敗時の callback
     */
    private encodeErrorCallback(): void {
        // socket.io で通知
        this.socket.notifyClient();
    }
}

export { EncodeFinModelInterface, EncodeFinModel };

