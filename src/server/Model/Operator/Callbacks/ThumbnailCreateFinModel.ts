import Model from '../../Model';
import { RecordingManageModelInterface } from '../../Operator/Recording/RecordingManageModel';
import { ThumbnailManageModelInterface } from '../../Operator/Thumbnail/ThumbnailManageModel';
import { IPCServerInterface } from '../../IPC/IPCServer';

interface ThumbnailCreateFinModelInterface extends Model {
    set(): void;
}

class ThumbnailCreateFinModel extends Model implements ThumbnailCreateFinModelInterface {
    private recordingManage: RecordingManageModelInterface;
    private thumbnailManage: ThumbnailManageModelInterface;
    private ipc: IPCServerInterface;

    constructor(
        recordingManage: RecordingManageModelInterface,
        thumbnailManage: ThumbnailManageModelInterface,
        ipc: IPCServerInterface,
    ) {
        super();

        this.recordingManage = recordingManage;
        this.thumbnailManage = thumbnailManage;
        this.ipc = ipc;
    }

    public set(): void {
        this.thumbnailManage.addListener((id, thumbnailPath) => { this.callback(id, thumbnailPath); });
    }

    /**
    * @param recordedId: recorded id
    * @param thumbnailPath: thumbnail file path
    */
    private async callback(recordedId: number, thumbnailPath: string): Promise<void> {
        try {
            await this.recordingManage.addThumbnail(recordedId, thumbnailPath);

            // socket.io で通知
            this.ipc.notifIo();
        } catch(err) {
            this.log.system.error(err);
        }
    }
}

export { ThumbnailCreateFinModelInterface, ThumbnailCreateFinModel }

