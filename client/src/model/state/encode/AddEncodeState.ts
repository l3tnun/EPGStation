import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IEncodeApiModel from '../../api/encode/IEncodeApiModel';
import IServerConfigModel from '../../serverConfig/IServerConfigModel';
import { IAddEncodeSettingStorageModel } from '../../storage/encode/IAddEncodeSettingStorageModel';
import IAddEncodeState from './IAddEncodeState';

@injectable()
export default class AddEncodeState implements IAddEncodeState {
    public videoFileId: apid.VideoFileId | null = null;
    public encodeMode: string | null = null;
    public parentDirectory: string | null = null;
    public directory: string | null = null;

    private serverConfig: IServerConfigModel;
    private encodeApiModel: IEncodeApiModel;
    private setting: IAddEncodeSettingStorageModel;

    private videoFiles: apid.VideoFile[] = [];
    private recordedId: apid.RecordedId | null = null;

    constructor(
        @inject('IServerConfigModel') serverConfig: IServerConfigModel,
        @inject('IEncodeApiModel') encodeApiModel: IEncodeApiModel,
        @inject('IAddEncodeSettingStorageModel') setting: IAddEncodeSettingStorageModel,
    ) {
        this.serverConfig = serverConfig;
        this.encodeApiModel = encodeApiModel;
        this.setting = setting;
    }

    /**
     * init
     * @param recordedId: apid.RecordedId
     * @param videoFiles: apid.VideoFile[]
     * @param encodeMode: string | null エンコードモード名
     * @param parentDirectory: string | null 親ディレクトリ名
     */
    public init(recordedId: apid.RecordedId, videoFiles: apid.VideoFile[], encodeMode: string | null, parentDirectory: string | null): void {
        this.recordedId = recordedId;
        this.videoFileId = null;
        this.directory = null;

        this.videoFiles = videoFiles;

        if (this.videoFiles.length > 0) {
            this.videoFileId = this.videoFiles[0].id;
        }

        const encodeList = this.getEncodeList();
        if (encodeList.length > 0) {
            this.encodeMode = null;
            for (const e of encodeList) {
                if (e === encodeMode) {
                    this.encodeMode = e;
                    break;
                }
            }
            if (this.encodeMode === null) {
                this.encodeMode = encodeList[0];
            }
        }

        const parendDirList = this.getParentDirectoryList();
        if (parendDirList.length > 0) {
            this.parentDirectory = null;
            for (const d of parendDirList) {
                if (d === parentDirectory) {
                    this.parentDirectory = d;
                    break;
                }
            }
            if (this.parentDirectory === null) {
                this.parentDirectory = parendDirList[0];
            }
        }
    }

    /**
     * ビデオファイルリストを返す
     * @return {
     *     text: string;
     *     value: apid.VideoFileId;
     * }[]
     */
    public getVideoFiles(): {
        text: string;
        value: apid.VideoFileId;
    }[] {
        return this.videoFiles.map(v => {
            return {
                text: v.name,
                value: v.id,
            };
        });
    }

    /**
     * エンコードリストを返す
     * @return string[]
     */
    public getEncodeList(): string[] {
        const config = this.serverConfig.getConfig();

        return config === null ? [] : config.encode;
    }

    /**
     * 親ディレクトリの一覧を返す
     * @return string[]
     */
    public getParentDirectoryList(): string[] {
        const config = this.serverConfig.getConfig();

        return config === null ? [] : config.recorded;
    }

    /**
     * エンコード追加
     */
    public async addEncode(): Promise<void> {
        if (this.recordedId === null || this.videoFileId === null || this.encodeMode === null) {
            throw new Error('OptionError');
        }

        const option: apid.AddManualEncodeProgramOption = {
            recordedId: this.recordedId,
            sourceVideoFileId: this.videoFileId,
            mode: this.encodeMode,
            removeOriginal: this.setting.tmp.removeOriginal,
        };

        if (this.setting.tmp.isSaveSameDirectory === true) {
            option.isSaveSameDirectory = true;
        } else {
            if (this.parentDirectory === null) {
                throw new Error('ParentDirectoryIsNull');
            }
            option.parentDir = this.parentDirectory;

            if (this.directory !== null) {
                option.directory = this.directory;
            }
        }

        await this.encodeApiModel.addEncode(option);
    }
}
