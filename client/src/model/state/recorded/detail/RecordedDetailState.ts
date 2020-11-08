import { inject, injectable } from 'inversify';
import * as apid from '../../../../../../api';
import UaUtil from '../../../../util/UaUtil';
import Util from '../../../../util/Util';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel';
import IServerConfigModel from '../../../serverConfig/IServerConfigModel';
import { ISettingStorageModel } from '../../../storage/setting/ISettingStorageModel';
import IRecordedUtil, { RecordedDisplayData } from '../IRecordedUtil';
import IRecordedDetailState, { URLInfo } from './IRecordedDetailState';

@injectable()
export default class RecordedDetailState implements IRecordedDetailState {
    private recordedApiModel: IRecordedApiModel;
    private recordedUtil: IRecordedUtil;
    private config: apid.Config | null;
    private settingModel: ISettingStorageModel;

    private recordedItem: apid.RecordedItem | null = null;
    private displayData: RecordedDisplayData | null = null;

    constructor(
        @inject('IRecordedApiModel') recordedApiModel: IRecordedApiModel,
        @inject('IRecordedUtil') recordedUtil: IRecordedUtil,
        @inject('IServerConfigModel') serverConfigModel: IServerConfigModel,
        @inject('ISettingStorageModel') settingModel: ISettingStorageModel,
    ) {
        this.recordedApiModel = recordedApiModel;
        this.recordedUtil = recordedUtil;
        this.config = serverConfigModel.getConfig();
        this.settingModel = settingModel;
    }

    /**
     * 取得した録画情報をクリア
     */
    public clearData(): void {
        this.recordedItem = null;
        this.displayData = null;
    }

    public async fetchData(recordedId: apid.RecordedId, isHalfWidth: boolean): Promise<void> {
        this.recordedItem = await this.recordedApiModel.get(recordedId, isHalfWidth);
        this.displayData = this.recordedUtil.convertRecordedItemToDisplayData(this.recordedItem, isHalfWidth);
    }

    /**
     * 取得した録画情報を返す
     * @return RecordedDisplayData | null
     */
    public getRecorded(): RecordedDisplayData | null {
        return this.displayData;
    }

    /**
     * 指定した video の再生 URL を返す
     * @param video: apid.VideoFile
     * @return string
     */
    public getVideoURL(video: apid.VideoFile): string | null {
        let urlScheme: string | null = null;
        if (this.settingModel.getSavedValue().shouldUseRecordedViewURLScheme === true) {
            const settingURLScheme = this.settingModel.getSavedValue().recordedViewURLScheme;
            if (settingURLScheme !== null && settingURLScheme.length > 0) {
                urlScheme = settingURLScheme;
            } else if (this.config !== null) {
                if (UaUtil.isiOS() === true && typeof this.config.urlscheme.video.ios !== 'undefined') {
                    urlScheme = this.config.urlscheme.video.ios;
                } else if (UaUtil.isAndroid() === true && typeof this.config.urlscheme.video.android !== 'undefined') {
                    urlScheme = this.config.urlscheme.video.android;
                } else if (UaUtil.isMac() === true && typeof this.config.urlscheme.video.mac !== 'undefined') {
                    urlScheme = this.config.urlscheme.video.mac;
                } else if (UaUtil.isWindows() === true && typeof this.config.urlscheme.video.win !== 'undefined') {
                    urlScheme = this.config.urlscheme.video.win;
                }
            }
        }

        if (urlScheme === null) {
            // URL Schema 設定が見つからないので通常の URL を返す
            return null;
        }

        // URL Schemeの準備
        let fullVideoURL = location.host + this.getVideoRawURL(video);
        if (urlScheme.match(/vlc-x-callback/)) {
            fullVideoURL = encodeURIComponent(fullVideoURL);
        }

        return urlScheme
            .replace(/PROTOCOL/g, location.protocol.replace(':', ''))
            .replace(/ADDRESS/g, fullVideoURL)
            .replace(/FILENAME/g, video.name);
    }

    /**
     * get cideo url
     * @param video: apid.VideoFile
     * @return string
     */
    public getVideoRawURL(video: apid.VideoFile): string {
        return Util.getSubDirectory() + `/api/videos/${video.id}`;
    }

    /**
     * 指定した video のダウンロード URL を返す
     * @param video: apid.VideoFile
     * @return string
     */
    public getVideoDownloadURL(video: apid.VideoFile): string | null {
        let urlScheme: string | null = null;
        if (this.settingModel.getSavedValue().shouldUseRecordedDownloadURLScheme === true) {
            const settingURLScheme = this.settingModel.getSavedValue().recordedDownloadURLScheme;
            if (settingURLScheme !== null && settingURLScheme.length > 0) {
                urlScheme = settingURLScheme;
            } else if (this.config !== null) {
                if (UaUtil.isiOS() === true && typeof this.config.urlscheme.download.ios !== 'undefined') {
                    urlScheme = this.config.urlscheme.download.ios;
                } else if (UaUtil.isAndroid() === true && typeof this.config.urlscheme.download.android !== 'undefined') {
                    urlScheme = this.config.urlscheme.download.android;
                } else if (UaUtil.isMac() === true && typeof this.config.urlscheme.download.mac !== 'undefined') {
                    urlScheme = this.config.urlscheme.download.mac;
                } else if (UaUtil.isWindows() === true && typeof this.config.urlscheme.download.win !== 'undefined') {
                    urlScheme = this.config.urlscheme.download.win;
                }
            }
        }

        if (urlScheme === null) {
            // URL Schema 設定が見つからないので通常の URL を返す
            return null;
        }

        // URL Schemeの準備
        let fullVideoURL = location.host + this.getVideoDownloadRawURL(video);
        if (urlScheme.match(/vlc-x-callback/)) {
            fullVideoURL = encodeURIComponent(fullVideoURL);
        }

        return urlScheme
            .replace(/PROTOCOL/g, location.protocol.replace(':', ''))
            .replace(/ADDRESS/g, fullVideoURL)
            .replace(/FILENAME/g, video.name);
    }

    /**
     * get video download url
     * @param video: apid.VideoFile
     * @return sting
     */
    public getVideoDownloadRawURL(video: apid.VideoFile): string {
        return this.getVideoRawURL(video) + '?isDownload=true';
    }

    /**
     * 指定した video のプレイリスト URL を返す
     * @param video: apid.VideoFile
     * @return string
     */
    public getVideoPlayListURL(video: apid.VideoFile): string {
        return this.getVideoRawURL(video) + '/playlist';
    }

    /**
     * エンコードを停止
     */
    public async stopEncode(): Promise<void> {
        if (this.recordedItem === null) {
            throw new Error('RecordedItemIsNull');
        }

        await this.recordedApiModel.stopEncode(this.recordedItem.id);
    }
}
