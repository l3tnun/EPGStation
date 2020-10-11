import { IRecordedSelectStreamSettingStorageModel } from '@/model/storage/recorded/IRecordedSelectStreamSettingStorageModel';
import { inject, injectable } from 'inversify';
import * as apid from '../../../../../../api';
import IServerConfigModel from '../../../serverConfig/IServerConfigModel';
import IRecordedDetailSelectStreamState, { RecordedStreamType, StreamConfigItem } from './IRecordedDetailSelectStreamState';

@injectable()
export default class RecordedDetailSelectStreamState implements IRecordedDetailSelectStreamState {
    public isOpen: boolean = false;
    public streamTypeItems: RecordedStreamType[] = [];
    public streamModeItems: StreamConfigItem[] = [];
    public selectedStreamType: RecordedStreamType | undefined;
    public title: string | null = null;
    public selectedStreamMode: number | undefined;

    private serverConfig: IServerConfigModel;
    private streamSelectSetting: IRecordedSelectStreamSettingStorageModel;
    private streamConfig: { [type: string]: string[] } = {};
    private videoFileId: apid.VideoFileId | null = null;
    private recordedId: apid.RecordedId | null = null;

    constructor(
        @inject('IServerConfigModel') serverConfig: IServerConfigModel,
        @inject('IRecordedSelectStreamSettingStorageModel')
        streamSelectSetting: IRecordedSelectStreamSettingStorageModel,
    ) {
        this.serverConfig = serverConfig;
        this.streamSelectSetting = streamSelectSetting;
    }

    public open(videoFile: apid.VideoFile, recordedId: apid.RecordedId): void {
        this.isOpen = true;

        this.title = videoFile.name;
        this.videoFileId = videoFile.id;
        this.recordedId = recordedId;
        this.streamModeItems = [];
        this.streamConfig = {};
        const config = this.serverConfig.getConfig();

        if (config !== null && typeof config.streamConfig !== 'undefined' && typeof config.streamConfig.recorded !== 'undefined') {
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
            } else if (videoFile.type === 'encoded' && config.isEnableEncodedRecordedStream === true && typeof encoded !== 'undefined') {
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
                const savedType = this.streamSelectSetting.getSavedValue().type;
                const newSelectedStreamType = this.streamTypeItems.find(type => {
                    return type === savedType;
                });
                this.selectedStreamType = typeof newSelectedStreamType === 'undefined' ? this.streamTypeItems[0] : newSelectedStreamType;
            }
        }

        this.updateModeItems(true);
    }

    /**
     * ダイアログを閉じる
     */
    public close(): void {
        this.isOpen = false;

        // ストリームの選択情報を保存
        this.streamSelectSetting.tmp.type = this.selectedStreamType as string;
        this.streamSelectSetting.tmp.mode = typeof this.selectedStreamMode === 'undefined' ? 0 : this.selectedStreamMode;
        this.streamSelectSetting.save();
    }

    /**
     * 視聴設定の更新
     */
    public updateModeItems(isInit: boolean = false): void {
        this.streamModeItems = this.getModeItems().map((text, i) => {
            return {
                text: text,
                value: i,
            };
        });

        if (isInit === true) {
            this.selectedStreamMode = this.streamSelectSetting.getSavedValue().mode;
        }

        if (typeof this.selectedStreamMode === 'undefined' || typeof this.streamModeItems[this.selectedStreamMode] === 'undefined') {
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

    /**
     * Recorded id を返す
     * @return apid.RecordedId | null
     */
    public getRecordedId(): apid.RecordedId | null {
        return this.recordedId;
    }
}
