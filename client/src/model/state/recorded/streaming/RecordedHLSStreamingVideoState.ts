import { inject, injectable } from 'inversify';
import * as apid from '../../../../../../api';
import Util from '../../../../util/Util';
import IStreamApiModel from '../../..//api/streams/IStreamApiModel';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel';
import IVideoApiModel from '../../../api/video/IVideoApiModel';
import IRecordedHLSStreamingVideoState from './IRecordedHLSStreamingVideoState';
import RecordedStreamingVideoState from './RecordedStreamingVideoState';

@injectable()
class RecordedHLSStreamingVideoState extends RecordedStreamingVideoState implements IRecordedHLSStreamingVideoState {
    private streamApiModel: IStreamApiModel;
    private streamId: apid.StreamId | null = null;
    private keepTimerId: number | undefined;

    private isStarting: boolean = false;

    constructor(
        @inject('IStreamApiModel') streamApiModel: IStreamApiModel,
        @inject('IVideoApiModel') videoApiModel: IVideoApiModel,
        @inject('IRecordedApiModel') recordedApiModel: IRecordedApiModel,
    ) {
        super(videoApiModel, recordedApiModel);

        this.streamApiModel = streamApiModel;
    }

    /**
     * ストリーム開始
     * @param videoFileId: apid.VideoFileId
     * @param playPosition: number 再生位置
     * @param mode: number
     * @return Promise<void>
     */
    public async start(videoFileId: apid.VideoFileId, playPosition: number, mode: number): Promise<void> {
        if (this.isStarting === true) {
            return;
        }

        if (this.streamId !== null) {
            await this.stop();
        }

        this.isStarting = true;
        try {
            this.streamId = await this.streamApiModel.startRecordedHLS(videoFileId, playPosition, mode);
            this.isStarting = false;
        } catch (err) {
            this.isStarting = false;
            throw err;
        }

        // ストリームを保持し続ける
        this.keepTimerId = setInterval(async () => {
            if (this.streamId === null) {
                return;
            }

            await this.streamApiModel.keep(this.streamId);
        }, RecordedHLSStreamingVideoState.KEEP_INTERVAL * 1000);

        await Util.sleep(1000);
    }

    /**
     * ストリーム停止
     * @return Promise<void>
     */
    public async stop(): Promise<void> {
        if (typeof this.keepTimerId !== 'undefined') {
            clearInterval(this.keepTimerId);
            this.keepTimerId = undefined;
        }

        if (this.streamId !== null) {
            await this.streamApiModel.stop(this.streamId);
            this.streamId = null;
        }
    }

    /**
     * streamId を返す
     * @return apid.StreamId | null
     */
    public getStreamId(): apid.StreamId | null {
        return this.streamId;
    }

    /**
     * ストリームが有効になったか
     * @return Promise<boolean> true で有効
     */
    public async isEnabled(): Promise<boolean> {
        const info = await this.streamApiModel.getStreamInfo(true);

        for (const item of info.items) {
            if (item.streamId === this.streamId && item.isEnable === true) {
                return true;
            }
        }

        return false;
    }
}

namespace RecordedHLSStreamingVideoState {
    export const KEEP_INTERVAL = 10;
}

export default RecordedHLSStreamingVideoState;
