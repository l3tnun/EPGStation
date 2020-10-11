import { inject, injectable } from 'inversify';
import * as apid from '../../../../../../api';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel';
import IVideoApiModel from '../../../api/video/IVideoApiModel';
import IRecordedStreamingVideoState from './IRecordedStreamingVideoState';

@injectable()
export default class RecordedStreamingVideoState implements IRecordedStreamingVideoState {
    private videoApiModel: IVideoApiModel;
    private recordedApiModel: IRecordedApiModel;
    private recordedItem: apid.RecordedItem | null = null;
    private duration: number = 0;
    private fetchDateTime: number = 0;

    constructor(@inject('IVideoApiModel') videoApiModel: IVideoApiModel, @inject('IRecordedApiModel') recordedApiModel: IRecordedApiModel) {
        this.videoApiModel = videoApiModel;
        this.recordedApiModel = recordedApiModel;
    }

    /**
     * 各種変数初期化
     */
    public clear(): void {
        this.recordedItem = null;
        this.duration = 0;
        this.fetchDateTime = 0;
    }

    /**
     * 番組, ビデオファイル情報取得
     * @param recordedId: apid.RecordedId
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async fetchInfo(recordedId: apid.RecordedId, videoFileId: apid.VideoFileId): Promise<void> {
        this.recordedItem = await this.recordedApiModel.get(recordedId, true);
        this.duration = await this.videoApiModel.getDuration(videoFileId);
        this.fetchDateTime = new Date().getTime();
    }

    /**
     * 録画中か
     * @return boolean true なら録画中
     */
    public isRecording(): boolean {
        return this.recordedItem !== null ? this.recordedItem.isRecording : false;
    }

    /**
     * 動画の長さ(秒)を返す
     * @return number
     */
    public getDuration(): number {
        if (this.recordedItem === null) {
            return 0;
        }

        // 録画中なら推定の動画長を返す
        if (this.recordedItem.isRecording === true) {
            return this.duration + (new Date().getTime() - this.fetchDateTime) / 1000;
        }

        return this.duration;
    }
}
