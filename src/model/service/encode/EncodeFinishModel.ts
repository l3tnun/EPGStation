import { inject, injectable, optional } from 'inversify';
import type * as apid from '../../../../api.js';
import IEncodeEvent, { FinishEncodeInfo } from '../../event/IEncodeEvent.js';
import ILogger from '../../ILogger.js';
import ILoggerModel from '../../ILoggerModel.js';
import IIPCClient from '../../ipc/IIPCClient.js';
import ISocketIOManageModel from '../socketio/ISocketIOManageModel.js';
import IEncodeFinishModel from './IEncodeFinishModel.js';

/**
 * `IEncodeManageModel`実装（`EncodeManageModel`）が公開する、自身を後から登録させるための
 * 最小限の形。`IEncodeManageModel`本体をimportすると循環依存になるため、必要なmethod
 * だけを持つ別途の型として宣言している。
 */
interface EncodeFinishSettlementOwner {
    setEncodeFinishModel(model: IEncodeFinishModel): void;
}

/** `IEncodeFinishModel` の実装。詳細は `IEncodeFinishModel` を参照。 */
@injectable()
export default class EncodeFinishModel implements IEncodeFinishModel {
    private log: ILogger;
    private socket: ISocketIOManageModel;
    private ipc: IIPCClient;
    private encodeEvent: IEncodeEvent;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('ISocketIOManageModel') socket: ISocketIOManageModel,
        @inject('IIPCClient') ipc: IIPCClient,
        @inject('IEncodeEvent') encodeEvent: IEncodeEvent,
        // `IEncodeManageModel`実装への自己登録用（`set()`参照）。DIの解決順序によっては
        // 存在しないことがあるため任意（`@optional`）とし、循環import回避のため
        // 型は`EncodeFinishSettlementOwner`（上記）に絞っている。
        @inject('IEncodeManageModel') @optional() private encodeManageModel?: EncodeFinishSettlementOwner,
    ) {
        this.log = logger.getLogger();
        this.socket = socket;
        this.ipc = ipc;
        this.encodeEvent = encodeEvent;
    }

    public set(): void {
        this.encodeEvent.setAddEncode(this.addEncode.bind(this));
        this.encodeEvent.setCancelEncode(this.cancelEncode.bind(this));
        this.encodeEvent.setErrorEncode(this.errorEncode.bind(this));
        this.encodeEvent.setUpdateEncodeProgress(this.updateEncodeProgress.bind(this));
        this.encodeManageModel?.setEncodeFinishModel(this);
    }

    /**
     * エンコード追加処理
     * @param encodeId
     */
    private addEncode(_encodeId: apid.EncodeId): void {
        this.socket.notifyClient();
    }

    /**
     * エンコードキャンセル処理
     * @param encodeId
     */
    private cancelEncode(_encodeId: apid.EncodeId): void {
        this.socket.notifyClient();
    }

    /**
     * エンコード終了処理
     * @param info: FinishEncodeInfo
     */
    public async finishEncode(info: FinishEncodeInfo): Promise<void> {
        let newVideoFileId: apid.VideoFileId | null = null;
        let resultReflected = false;
        try {
            if (info.fullOutputPath === null || info.filePath === null) {
                // update file size
                await this.ipc.recorded.updateVideoFileSize(info.videoFileId);
            } else {
                // add encode file
                const id = await this.ipc.recorded.addVideoFile({
                    recordedId: info.recordedId,
                    parentDirectoryName: info.parentDirName,
                    filePath: info.filePath,
                    type: 'encoded',
                    name: info.mode,
                });
                newVideoFileId = id;
            }
            resultReflected = true;
        } catch (err: any) {
            this.log.encode.error('finish encode error');
            this.log.encode.error(err);
        }

        if (resultReflected === true && info.removeOriginal === true) {
            // delete source video file
            await this.ipc.recorded.deleteVideoFile(info.videoFileId, true);
        }

        this.socket.notifyClient();

        // Operator にイベントを転送
        await this.ipc.encodeEvent.emitFinishEncode({
            recordedId: info.recordedId,
            videoFileId: newVideoFileId,
            mode: info.mode,
        });
    }

    /**
     * エンコード失敗処理
     */
    private errorEncode(): void {
        this.socket.notifyClient();
    }

    /**
     * エンコード進捗情報更新
     */
    private updateEncodeProgress(): void {
        this.socket.notifyUpdateEncodeProgress();
    }
}
