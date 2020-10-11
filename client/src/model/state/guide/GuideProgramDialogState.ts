import { IGuideProgramDialogSettingStorageModel, NONE_ENCODE_OPTION } from '@/model/storage/guide/IGuideProgramDialogSettingStorageModel';
import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import { AudioComponentType, AudioSamplingRate, VideoComponentType } from '../../../lib/event';
import DateUtil from '../../../util/DateUtil';
import GenreUtil from '../../../util/GenreUtil';
import IReservesApiModel from '../../api/reserves/IReservesApiModel';
import IServerConfigModel from '../../serverConfig/IServerConfigModel';
import IGuideProgramDialogState, { DisplayProgramData, ProgramDialogOpenOption, ProgramDialogReseveItem } from './IGuideProgramDialogState';

@injectable()
export default class GuideProgramDialogState implements IGuideProgramDialogState {
    public isOpen: boolean = false;
    public displayData: DisplayProgramData | null = null;
    public reserve: ProgramDialogReseveItem | null = null;

    private reservesApiModel: IReservesApiModel;
    private serverConfig: IServerConfigModel;
    private setting: IGuideProgramDialogSettingStorageModel;
    private programId: apid.ProgramId | null = null;
    private program: apid.ScheduleProgramItem | null = null;

    constructor(
        @inject('IReservesApiModel') reservesApiModel: IReservesApiModel,
        @inject('IServerConfigModel') serverConfig: IServerConfigModel,
        @inject('IGuideProgramDialogSettingStorageModel') setting: IGuideProgramDialogSettingStorageModel,
    ) {
        this.reservesApiModel = reservesApiModel;
        this.serverConfig = serverConfig;
        this.setting = setting;
    }

    /**
     * ダイアログを開く
     * @param option: ProgramDialogOpenOption
     */
    public open(option: ProgramDialogOpenOption): void {
        this.isOpen = true;
        this.program = option.program;
        this.setProgramData(option);
        this.reserve = typeof option.reserve === 'undefined' ? null : option.reserve;
        this.programId = option.program.id;
    }

    /**
     * ダイアログを閉じる
     */
    public close(): void {
        this.isOpen = false;
        this.displayData = null;
        this.reserve = null;
        this.programId = null;
    }

    /**
     * ダイアログに表示するデータをセットする
     */
    private setProgramData(dialogData: ProgramDialogOpenOption): void {
        const startAt = dialogData.program.startAt;
        const endAt = dialogData.program.endAt;
        const duration = Math.floor((endAt - startAt) / 1000 / 60);

        const result: DisplayProgramData = {
            channelName: dialogData.channel === null ? dialogData.program.channelId.toString(10) : dialogData.channel.name,
            programName: dialogData.program.name,
            time:
                DateUtil.format(DateUtil.getJaDate(new Date(startAt)), 'MM/dd hh:mm ~ ') +
                DateUtil.format(DateUtil.getJaDate(new Date(endAt)), ' hh:mm') +
                `(${duration.toString(10)}分)`,
            isFree: dialogData.program.isFree,
        };

        // ジャンル情報
        const genres: string[] = [];
        if (typeof dialogData.program.genre1 !== 'undefined') {
            const genre = this.convertGenreToStr(dialogData.program.genre1, dialogData.program.subGenre1);
            if (genre !== null) {
                genres.push(genre);
            }
        }
        if (typeof dialogData.program.genre2 !== 'undefined') {
            const genre = this.convertGenreToStr(dialogData.program.genre2, dialogData.program.subGenre2);
            if (genre !== null) {
                genres.push(genre);
            }
        }
        if (typeof dialogData.program.genre3 !== 'undefined') {
            const genre = this.convertGenreToStr(dialogData.program.genre3, dialogData.program.subGenre3);
            if (genre !== null) {
                genres.push(genre);
            }
        }
        if (genres.length > 0) {
            result.genres = genres;
        }

        // description
        if (typeof dialogData.program.description !== 'undefined') {
            result.description = dialogData.program.description;
        }

        // extended
        if (typeof dialogData.program.extended !== 'undefined') {
            result.extended = dialogData.program.extended;
        }

        // videoType
        if (typeof dialogData.program.videoComponentType !== 'undefined') {
            const videoType = this.getVideoType(dialogData.program.videoComponentType);
            if (videoType !== null) {
                result.videoType = videoType;
            }
        }

        // audioType
        if (typeof dialogData.program.audioComponentType !== 'undefined') {
            const audioType = this.getAudioMode(dialogData.program.audioComponentType);
            if (audioType !== null) {
                result.audioType = audioType;
            }
        }

        // audioSamplingRate
        if (typeof dialogData.program.audioSamplingRate !== 'undefined') {
            const audioSamplingRate = this.getAudioSamplingRate(dialogData.program.audioSamplingRate);
            if (audioSamplingRate !== null) {
                result.audioSamplingRate = audioSamplingRate;
            }
        }

        this.displayData = result;
    }

    /**
     * ジャンル情報を文字列にして返す
     * @param genre: ProgramGenreLv1
     * @param subGenre: ProgramGenreLv2
     */
    private convertGenreToStr(genre: apid.ProgramGenreLv1, subGenre?: apid.ProgramGenreLv2): string | null {
        return GenreUtil.getGenres(genre, subGenre);
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
     * ダイアログで表示している番組の program id を返す
     * @return ProgramId | null
     */
    public getProgramId(): apid.ProgramId | null {
        return this.programId;
    }

    /**
     * program 情報を返す
     * @return apid.ScheduleProgramItem | null
     */
    public getProgram(): apid.ScheduleProgramItem | null {
        return this.program;
    }

    /**
     * エンコードリストを返す
     * @return string
     */
    public getEncodeList(): string[] {
        const config = this.serverConfig.getConfig();

        if (config === null) {
            return [];
        }

        const list: string[] = [NONE_ENCODE_OPTION];
        for (const e of config.encode) {
            list.push(e);
        }

        return list;
    }

    /**
     * ダイアログで表示している番組の予約情報を更新する
     * @param reserve: ProgramDialogReseveItem | null
     */
    public updateReserve(reserve: ProgramDialogReseveItem | null): void {
        this.reserve = reserve;
    }

    /**
     * 簡易予約追加
     */
    public async addReserve(): Promise<void> {
        if (this.programId === null) {
            throw new Error('ProgramIdIsNull');
        }

        const option: apid.ManualReserveOption = {
            programId: this.programId,
            allowEndLack: true,
        };

        if (this.setting.tmp.encode !== NONE_ENCODE_OPTION) {
            option.encodeOption = {
                mode1: this.setting.tmp.encode,
                isDeleteOriginalAfterEncode: this.setting.tmp.isDeleteOriginalAfterEncode,
            };
        }

        await this.reservesApiModel.add(option);
    }

    /**
     * 予約キャンセル
     */
    public async cancelReserve(): Promise<void> {
        if (this.reserve === null) {
            throw new Error('ReserveIsNull');
        }

        await this.reservesApiModel.cancel(this.reserve.reserveId);
    }

    /**
     * 予約除外状態の解除
     */
    public async removeReserveSkip(): Promise<void> {
        if (this.reserve === null) {
            throw new Error('ReserveIsNull');
        }

        await this.reservesApiModel.removeSkip(this.reserve.reserveId);
    }

    /**
     * 予約の重複状態を解除
     */
    public async removeReserveOverlap(): Promise<void> {
        if (this.reserve === null) {
            throw new Error('ReserveIsNull');
        }

        await this.reservesApiModel.removeOverlap(this.reserve.reserveId);
    }
}
