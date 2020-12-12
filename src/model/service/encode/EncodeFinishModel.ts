import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IEncodeEvent, { FinishEncodeInfo } from '../../event/IEncodeEvent';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IIPCClient from '../../ipc/IIPCClient';
import ISocketIOManageModel from '../socketio/ISocketIOManageModel';
import IEncodeFinishModel from './IEncodeFinishModel';

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
    ) {
        this.log = logger.getLogger();
        this.socket = socket;
        this.ipc = ipc;
        this.encodeEvent = encodeEvent;
    }

    public set(): void {
        this.encodeEvent.setAddEncode(this.addEncode.bind(this));
        this.encodeEvent.setCancelEncode(this.cancelEncode.bind(this));
        this.encodeEvent.setFinishEncode(this.finishEncode.bind(this));
        this.encodeEvent.setErrorEncode(this.errorEncode.bind(this));
        this.encodeEvent.setUpdateEncodeProgress(this.updateEncodeProgress.bind(this));
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
    private async finishEncode(info: FinishEncodeInfo): Promise<void> {
        try {
            if (info.fullOutputPath === null || info.filePath === null) {
                // update file size
                await this.ipc.recorded.updateVideoFileSize(info.videoFileId);
            } else {
                // add encode file
                await this.ipc.recorded.addVideoFile({
                    recordedId: info.recordedId,
                    parentDirectoryName: info.parentDirName,
                    filePath: info.filePath,
                    type: 'encoded',
                    name: info.mode,
                });
            }
        } catch (err) {
            this.log.system.error('finish encode error');
            this.log.system.error(err);
        }

        if (info.removeOriginal === true) {
            // delete source video file
            await this.ipc.recorded.deleteVideoFile(info.videoFileId, true);
        }

        this.socket.notifyClient();
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
