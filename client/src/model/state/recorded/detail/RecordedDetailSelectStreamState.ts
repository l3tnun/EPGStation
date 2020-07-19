import { inject, injectable } from 'inversify';
import * as apid from '../../../../../../api';
import IServerConfigModel from '../../../serverConfig/IServerConfigModel';
import IRecordedDetailSelectStreamState, {
    RecordedStreamType,
    StreamConfigItem,
} from './IRecordedDetailSelectStreamState';

@injectable()
export default class RecordedDetailSelectStreamState implements IRecordedDetailSelectStreamState {
    public isOpen: boolean = false;
    public streamTypeItems: RecordedStreamType[] = [];
    public streamModeItems: StreamConfigItem[] = [];
    public selectedStreamType: RecordedStreamType | undefined;
    public title: string | null = null;
    public selectedStreamMode: number | undefined;

    private serverConfig: IServerConfigModel;
    private streamConfig: { [type: string]: string[] } = {};
    private videoFileId: apid.VideoFileId | null = null;

    constructor(@inject('IServerConfigModel') serverConfig: IServerConfigModel) {
        this.serverConfig = serverConfig;
    }

    public open(videoFile: apid.VideoFile): void {
        this.isOpen = true;

        this.title = videoFile.name;
        this.videoFileId = videoFile.id;
        this.streamModeItems = [];
        this.streamConfig = {};
        const config = this.serverConfig.getConfig();

        if (
            config !== null &&
            typeof config.streamConfig !== 'undefined' &&
            typeof config.streamConfig.recorded !== 'undefined'
        ) {
            // set streamTypeItems
            const ts = config.streamConfig.recorded.ts;
            const encoded = config.streamConfig.recorded.encoded;
            if (videoFile.type === 'ts' && config.isEnableTSRecordedStream === true && typeof ts !== 'undefined') {
                // webm
                if (typeof ts.webm !== 'undefined' && ts.webm.length > 0) {
                    this.streamTypeItems.push('WebM');
                    this.streamConfig['WebM'] = ts.webm;
                }

                // mp4
                if (typeof ts.mp4 !== 'undefined' && ts.mp4.length > 0) {
                    this.streamTypeItems.push('MP4');
                    this.streamConfig['MP4'] = ts.mp4;
                }

                // hls
                if (typeof ts.hls !== 'undefined' && ts.hls.length > 0) {
                    this.streamTypeItems.push('HLS');
                    this.streamConfig['HLS'] = ts.hls;
                }
            } else if (
                videoFile.type === 'encoded' &&
                config.isEnableEncodedRecordedStream === true &&
                typeof encoded !== 'undefined'
            ) {
                // webm
                if (typeof encoded.webm !== 'undefined' && encoded.webm.length > 0) {
                    this.streamTypeItems.push('WebM');
                    this.streamConfig['WebM'] = encoded.webm;
                }

                // mp4
                if (typeof encoded.mp4 !== 'undefined' && encoded.mp4.length > 0) {
                    this.streamTypeItems.push('MP4');
                    this.streamConfig['MP4'] = encoded.mp4;
                }

                // hls
                if (typeof encoded.hls !== 'undefined' && encoded.hls.length > 0) {
                    this.streamTypeItems.push('HLS');
                    this.streamConfig['HLS'] = encoded.hls;
                }
            } else {
                // ビデオの形式に適したストリーミングの設定が存在しない
                throw new Error('VideoTypeError');
            }

            if (typeof this.selectedStreamType === 'undefined') {
                // TODO set saved value
                this.selectedStreamType = this.streamTypeItems[0];
            }
        }

        this.updateModeItems();
    }

    /**
     * ダイアログを閉じる
     */
    public close(): void {
        this.isOpen = false;
    }

    /**
     * 視聴設定の更新
     */
    public updateModeItems(): void {
        this.streamModeItems = this.getModeItems().map((text, i) => {
            return {
                text: text,
                value: i,
            };
        });

        // TODO selected saved value

        if (
            typeof this.selectedStreamMode === 'undefined' ||
            typeof this.streamModeItems[this.selectedStreamMode] === 'undefined'
        ) {
            this.selectedStreamMode = 0;
        }
    }

    /**
     * 視聴設定を返す
     * @return string[]
     */
    private getModeItems(): string[] {
        return typeof this.selectedStreamType === 'undefined' ? [] : this.streamConfig[this.selectedStreamType];
    }

    /**
     * VideoFile id を返す
     * @return apid.VideoFileId | null
     */
    public getVideoFileId(): apid.VideoFileId | null {
        return this.videoFileId;
    }
}
