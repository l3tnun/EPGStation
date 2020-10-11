import { inject, injectable } from 'inversify';
import * as apid from '../../../../../../api';
import GenreUtil from '../../../..//util/GenreUtil';
import { AudioComponentType, AudioSamplingRate, VideoComponentType } from '../../../../lib/event';
import DateUtil from '../../../../util/DateUtil';
import IReservesApiModel from '../../../api/reserves/IReservesApiModel';
import IScheduleApiModel from '../../../api/schedule/IScheduleApiModel';
import IChannelModel from '../../../channels/IChannelModel';
import IServerConfigModel from '../../../serverConfig/IServerConfigModel';
import { ISettingStorageModel } from '../../../storage/setting/ISettingStorageModel';
import IManualReserveState, { EncodedOption, ManualReserveOption, ManualSaveOption, ProgramStateData, SelectorItem, TimeSpecifiedOption } from './IManualReserveState';

@injectable()
export default class ManualReserveState implements IManualReserveState {
    public isTimeSpecification: boolean = false;
    public timeSpecifiedOption: TimeSpecifiedOption = {
        name: null,
        channelId: null,
        startAt: null,
        endAt: null,
    };
    public reserveOption: ManualReserveOption = {
        allowEndLack: true,
    };
    public saveOption: ManualSaveOption = {
        parentDirectoryName: null,
        directory: null,
        recordedFormat: null,
    };
    public encodeOption: EncodedOption = {
        mode1: null,
        encodeParentDirectoryName1: null,
        directory1: null,
        mode2: null,
        encodeParentDirectoryName2: null,
        directory2: null,
        mode3: null,
        encodeParentDirectoryName3: null,
        directory3: null,
        isDeleteOriginalAfterEncode: false,
    };

    // ルールオプションのアコーディオンの開閉を行う
    public optionPanel: number[] = [];

    private scheduleApiModel: IScheduleApiModel;
    private reservesApiModel: IReservesApiModel;
    private channelModel: IChannelModel;
    private serverConfig: IServerConfigModel;
    private settingModel: ISettingStorageModel;
    private programInfo: ProgramStateData | null = null;

    constructor(
        @inject('IScheduleApiModel') scheduleApiModel: IScheduleApiModel,
        @inject('IReservesApiModel') reservesApiModel: IReservesApiModel,
        @inject('IChannelModel') channelModel: IChannelModel,
        @inject('IServerConfigModel') serverConfig: IServerConfigModel,
        @inject('ISettingStorageModel') settingModel: ISettingStorageModel,
    ) {
        this.scheduleApiModel = scheduleApiModel;
        this.reservesApiModel = reservesApiModel;
        this.channelModel = channelModel;
        this.serverConfig = serverConfig;
        this.settingModel = settingModel;
    }

    /**
     * 各種オプションの初期化
     */
    public init(): void {
        this.isTimeSpecification = false;

        this.timeSpecifiedOption = {
            name: null,
            channelId: null,
            startAt: null,
            endAt: null,
        };

        this.reserveOption = {
            allowEndLack: true,
        };

        this.saveOption = {
            parentDirectoryName: null,
            directory: null,
            recordedFormat: null,
        };

        this.encodeOption = {
            mode1: null,
            encodeParentDirectoryName1: null,
            directory1: null,
            mode2: null,
            encodeParentDirectoryName2: null,
            directory2: null,
            mode3: null,
            encodeParentDirectoryName3: null,
            directory3: null,
            isDeleteOriginalAfterEncode: false,
        };

        this.optionPanel = [0, 1, 2, 3, 6];
    }

    /**
     * programInfo から手動時刻オプションを設定する
     * programInfo が null の場合はエラーとなる
     */
    public setTimeSpecifiedOption(): void {
        if (this.programInfo === null) {
            throw new Error('ProgramInfoIsNull');
        }

        this.timeSpecifiedOption.name = this.programInfo.programItem.name;
        this.timeSpecifiedOption.channelId = this.programInfo.programItem.channelId;
        this.timeSpecifiedOption.startAt = new Date(this.programInfo.programItem.startAt);
        this.timeSpecifiedOption.endAt = new Date(this.programInfo.programItem.endAt);
    }

    /**
     * apid.ReserveItem の内容を反映させる
     * @param reserveItem: apid.ReserveItem
     */
    public setOptions(reserveItem: apid.ReserveItem): void {
        this.isTimeSpecification = reserveItem.isTimeSpecified;

        if (reserveItem.isTimeSpecified === true) {
            this.timeSpecifiedOption = {
                name: reserveItem.name,
                channelId: reserveItem.channelId,
                startAt: new Date(reserveItem.startAt),
                endAt: new Date(reserveItem.endAt),
            };
        }

        this.reserveOption.allowEndLack = reserveItem.allowEndLack;
        if (typeof reserveItem.parentDirectoryName !== 'undefined') {
            this.saveOption.parentDirectoryName = reserveItem.parentDirectoryName;
        }
        if (typeof reserveItem.directory !== 'undefined') {
            this.saveOption.directory = reserveItem.directory;
        }
        if (typeof reserveItem.recordedFormat !== 'undefined') {
            this.saveOption.recordedFormat = reserveItem.recordedFormat;
        }

        if (typeof reserveItem.encodeMode1 !== 'undefined') {
            this.encodeOption.mode1 = reserveItem.encodeMode1;
        }
        if (typeof reserveItem.encodeParentDirectoryName1 !== 'undefined') {
            this.encodeOption.encodeParentDirectoryName1 = reserveItem.encodeParentDirectoryName1;
        }
        if (typeof reserveItem.encodeDirectory1 !== 'undefined') {
            this.encodeOption.directory1 = reserveItem.encodeDirectory1;
        }

        if (typeof reserveItem.encodeMode2 !== 'undefined') {
            this.encodeOption.mode2 = reserveItem.encodeMode2;
            this.optionPanel.push(4);
        }
        if (typeof reserveItem.encodeParentDirectoryName2 !== 'undefined') {
            this.encodeOption.encodeParentDirectoryName2 = reserveItem.encodeParentDirectoryName2;
        }
        if (typeof reserveItem.encodeDirectory2 !== 'undefined') {
            this.encodeOption.directory2 = reserveItem.encodeDirectory2;
        }

        if (typeof reserveItem.encodeMode3 !== 'undefined') {
            this.encodeOption.mode3 = reserveItem.encodeMode3;
            this.optionPanel.push(5);
        }
        if (typeof reserveItem.encodeParentDirectoryName3 !== 'undefined') {
            this.encodeOption.encodeParentDirectoryName3 = reserveItem.encodeParentDirectoryName3;
        }
        if (typeof reserveItem.encodeDirectory3 !== 'undefined') {
            this.encodeOption.directory3 = reserveItem.encodeDirectory3;
        }
        if (typeof reserveItem.encodeMode1 !== 'undefined') {
            this.encodeOption.mode1 = reserveItem.encodeMode1;
        }
        if (typeof reserveItem.encodeParentDirectoryName1 !== 'undefined') {
            this.encodeOption.encodeParentDirectoryName1 = reserveItem.encodeParentDirectoryName1;
        }

        this.encodeOption.isDeleteOriginalAfterEncode = reserveItem.isDeleteOriginalAfterEncode;
    }

    /**
     * 番組情報を取得する
     * @param programId: apid.ProgramId
     * @param isHalfWidth: boolean 半角で取得するか
     * @return Promise<void>
     */
    public async fetchProgramInfo(programId: apid.ProgramId, isHalfWidth: boolean): Promise<void> {
        const program = await this.scheduleApiModel.getSchedule(programId, isHalfWidth);

        this.programInfo = this.convertScheduleProgramItemToStateData(program, isHalfWidth);
    }

    /**
     * 予約情報の取得
     * @param reserveId: apid.ReserveId
     * @param isHalfWidth: boolean 半角で取得するか
     * @return Promise<apid.ReserveItem>
     */
    public async getReserveItem(reserveId: apid.ReserveId, isHalfWidth: boolean): Promise<apid.ReserveItem> {
        return await this.reservesApiModel.get(reserveId, isHalfWidth);
    }

    /**
     * apid.ScheduleProgramItem を ProgramStateData に変換する
     * @param program: apid.ScheduleProgramItem
     * @param isHalfWidth: boolean
     * @return ProgramStateData
     */
    private convertScheduleProgramItemToStateData(program: apid.ScheduleProgramItem, isHalfWidth: boolean): ProgramStateData {
        const startAt = DateUtil.getJaDate(new Date(program.startAt));
        const endAt = DateUtil.getJaDate(new Date(program.endAt));
        const channel = this.channelModel.findChannel(program.channelId, isHalfWidth);

        const result: ProgramStateData = {
            display: {
                channelName: channel === null ? program.channelId.toString(10) : channel.name,
                name: program.name,
                day: DateUtil.format(startAt, 'MM/dd'),
                dow: DateUtil.format(startAt, 'w'),
                startTime: DateUtil.format(startAt, 'hh:mm'),
                endTime: DateUtil.format(endAt, 'hh:mm'),
                duration: Math.floor((program.endAt - program.startAt) / 1000 / 60),
                genres: this.createGenres(program),
                description: program.description,
                extended: program.extended,
                isFree: program.isFree,
            },
            programItem: program,
        };

        if (typeof program.videoComponentType !== 'undefined') {
            const videoType = this.getVideoType(program.videoComponentType);
            if (videoType !== null) {
                result.display.videoType = videoType;
            }
        }

        // audioType
        if (typeof program.audioComponentType !== 'undefined') {
            const audioType = this.getAudioMode(program.audioComponentType);
            if (audioType !== null) {
                result.display.audioType = audioType;
            }
        }

        // audioSamplingRate
        if (typeof program.audioSamplingRate !== 'undefined') {
            const audioSamplingRate = this.getAudioSamplingRate(program.audioSamplingRate);
            if (audioSamplingRate !== null) {
                result.display.audioSamplingRate = audioSamplingRate;
            }
        }

        return result;
    }

    /**
     * ジャンル情報
     * @param program: apid.ScheduleProgramItem
     * @return string[]
     */
    private createGenres(program: apid.ScheduleProgramItem): string[] {
        const genres: string[] = [];

        if (typeof program.genre1 !== 'undefined') {
            const genre = GenreUtil.getGenres(program.genre1, program.subGenre1);
            if (genre !== null) {
                genres.push(genre);
            }
        }
        if (typeof program.genre2 !== 'undefined') {
            const genre = GenreUtil.getGenres(program.genre2, program.subGenre2);
            if (genre !== null) {
                genres.push(genre);
            }
        }
        if (typeof program.genre3 !== 'undefined') {
            const genre = GenreUtil.getGenres(program.genre3, program.subGenre3);
            if (genre !== null) {
                genres.push(genre);
            }
        }

        return genres;
    }

    /**
     * video 情報を取得
     * @param videoComponentType: number
     * @return videoComponentType | null
     */
    private getVideoType(videoComponentType: number): string | null {
        const str = (VideoComponentType as any)[videoComponentType];

        return typeof str === 'undefined' ? null : str;
    }

    /**
     * 音声情報を取得
     * @param audioComponentType: number
     * @return audio type | null
     */
    private getAudioMode(audioComponentType: number): string | null {
        const str = (AudioComponentType as any)[audioComponentType];

        return typeof str === 'undefined' ? null : str;
    }

    /**
     * 音声サンプリングレートを返す
     * @return audio sampling rate | null
     */
    private getAudioSamplingRate(audioSamplingRate: apid.ProgramAudioSamplingRate): string | null {
        const str = AudioSamplingRate[audioSamplingRate];

        return typeof str === 'undefined' ? null : str;
    }

    /**
     * 放送局 item を返す
     * @return SelectorItem[]
     */
    public getChannelItems(): SelectorItem[] {
        return this.channelModel.getChannels(this.settingModel.getSavedValue().isHalfWidthDisplayed).map(c => {
            return {
                text: c.name,
                value: c.id,
            };
        });
    }

    /**
     * 取得した番組情報を返す
     * @return ProgramStateData
     */
    public getProgramInfo(): ProgramStateData | null {
        return this.programInfo;
    }

    /**
     * 録画先ディレクトリの一覧を返す
     * @return string[]
     */
    public getPrentDirectoryItems(): string[] {
        const config = this.serverConfig.getConfig();

        return config === null ? [] : config.recorded;
    }

    /**
     * エンコードモード一覧を返す
     * @return string
     */
    public getEncodeModeItems(): string[] {
        const config = this.serverConfig.getConfig();

        return config === null ? [] : config.encode;
    }

    /**
     * エンコードに対応しているか
     */
    public isEnableEncodeMode(): boolean {
        return this.getEncodeModeItems().length > 0;
    }

    /**
     * 予約追加
     */
    public async addReserve(): Promise<void> {
        // 予約オプション組み立て
        const option = this.createManualReserveOption();

        await this.reservesApiModel.add(option);
    }

    /**
     * 予約更新
     * @param reserveId: apid.ReserveId
     */
    public async updateReserve(reserveId: apid.ReserveId): Promise<void> {
        const option = this.createEditManualReserveOption();

        await this.reservesApiModel.edit(reserveId, option);
    }

    /**
     * 予約設定を組み立てる
     * @return apid.ManualReserveOption
     */
    private createManualReserveOption(): apid.ManualReserveOption {
        const result: apid.ManualReserveOption = {
            allowEndLack: this.reserveOption.allowEndLack,
        };
        if (this.isTimeSpecification === true) {
            // 時刻予約
            if (this.timeSpecifiedOption.name === null || this.timeSpecifiedOption.name.length === 0) {
                throw new Error('TimeSpecifiedOptionNameError');
            }
            if (this.timeSpecifiedOption.channelId === null) {
                throw new Error('TimeSpecifiedOptionChannelIdError');
            }
            if (this.timeSpecifiedOption.startAt === null || this.timeSpecifiedOption.endAt === null) {
                throw new Error('TimeSpecifiedOptionTimeError');
            }

            result.timeSpecifiedOption = {
                name: this.timeSpecifiedOption.name,
                channelId: this.timeSpecifiedOption.channelId,
                startAt: this.timeSpecifiedOption.startAt.getTime(),
                endAt: this.timeSpecifiedOption.endAt.getTime(),
            };
        } else {
            if (this.programInfo === null) {
                throw new Error('ProgramIdIsNull');
            }
            // program id 予約
            result.programId = this.programInfo.programItem.id;
        }

        // 保存オプション
        const saveOption = this.getSaveOption();
        if (saveOption !== null) {
            result.saveOption = saveOption;
        }

        // エンコードオプション
        const encodeOption = this.getEncodeOption();
        if (encodeOption !== null) {
            result.encodeOption = encodeOption;
        }

        // TODO tag

        return result;
    }

    /**
     * 予約編集オプションを組み立てる
     * @return apid.EditManualReserveOption
     */
    private createEditManualReserveOption(): apid.EditManualReserveOption {
        const result: apid.EditManualReserveOption = {
            allowEndLack: this.reserveOption.allowEndLack,
        };

        // 保存オプション
        const saveOption = this.getSaveOption();
        if (saveOption !== null) {
            result.saveOption = saveOption;
        }

        // エンコードオプション
        const encodeOption = this.getEncodeOption();
        if (encodeOption !== null) {
            result.encodeOption = encodeOption;
        }

        // TODO tag

        return result;
    }

    /**
     * apid.ReserveSaveOption を生成する
     * @return apid.ReserveSaveOption | null
     */
    private getSaveOption(): apid.ReserveSaveOption | null {
        const saveOption: apid.ReserveSaveOption = {};
        if (this.saveOption.parentDirectoryName !== null) {
            saveOption.parentDirectoryName = this.saveOption.parentDirectoryName;
        }
        if (this.saveOption.directory !== null) {
            saveOption.directory = this.saveOption.directory;
        }
        if (this.saveOption.recordedFormat !== null) {
            saveOption.recordedFormat = this.saveOption.recordedFormat;
        }

        return Object.keys(saveOption).length > 0 ? saveOption : null;
    }

    /**
     * apid.ReserveEncodedOption を生成する
     * @return apid.ReserveEncodedOption | null
     */
    private getEncodeOption(): apid.ReserveEncodedOption | null {
        const encodeOption: apid.ReserveEncodedOption = {
            isDeleteOriginalAfterEncode: this.encodeOption.isDeleteOriginalAfterEncode,
        };
        if (this.encodeOption.mode1 !== null) {
            encodeOption.mode1 = this.encodeOption.mode1;
            if (this.encodeOption.encodeParentDirectoryName1 !== null) {
                encodeOption.encodeParentDirectoryName1 = this.encodeOption.encodeParentDirectoryName1;
            }
            if (this.encodeOption.directory1 !== null) {
                encodeOption.directory1 = this.encodeOption.directory1;
            }
        }
        if (this.encodeOption.mode2 !== null) {
            encodeOption.mode2 = this.encodeOption.mode2;
            if (this.encodeOption.encodeParentDirectoryName2 !== null) {
                encodeOption.encodeParentDirectoryName2 = this.encodeOption.encodeParentDirectoryName2;
            }
            if (this.encodeOption.directory2 !== null) {
                encodeOption.directory2 = this.encodeOption.directory2;
            }
        }
        if (this.encodeOption.mode3 !== null) {
            encodeOption.mode3 = this.encodeOption.mode3;
            if (this.encodeOption.encodeParentDirectoryName3 !== null) {
                encodeOption.encodeParentDirectoryName3 = this.encodeOption.encodeParentDirectoryName3;
            }
            if (this.encodeOption.directory3 !== null) {
                encodeOption.directory3 = this.encodeOption.directory3;
            }
        }

        return Object.keys(encodeOption).length > 1 ? encodeOption : null;
    }
}
