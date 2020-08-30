import IScheduleApiModel from '@/model/api/schedule/IScheduleApiModel';
import { inject, injectable } from 'inversify';
import * as apid from '../../../../../../api';
import GenreUtil from '../../../..//util/GenreUtil';
import { AudioComponentType, AudioSamplingRate, VideoComponentType } from '../../../../lib/event';
import DateUtil from '../../../../util/DateUtil';
import IChannelModel from '../../../channels/IChannelModel';
import IManualReserveState, { ProgramStateData } from './IManualReserveState';

@injectable()
export default class ManualReserveState implements IManualReserveState {
    public isTimeSpecification: boolean = false;

    private scheduleApiModel: IScheduleApiModel;
    private channelModel: IChannelModel;
    private programInfo: ProgramStateData | null = null;

    constructor(
        @inject('IScheduleApiModel') scheduleApiModel: IScheduleApiModel,
        @inject('IChannelModel') channelModel: IChannelModel,
    ) {
        this.scheduleApiModel = scheduleApiModel;
        this.channelModel = channelModel;
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
     * apid.ScheduleProgramItem を ProgramStateData に変換する
     * @param program: apid.ScheduleProgramItem
     * @param isHalfWidth: boolean
     * @return ProgramStateData
     */
    private convertScheduleProgramItemToStateData(
        program: apid.ScheduleProgramItem,
        isHalfWidth: boolean,
    ): ProgramStateData {
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
        const str = (<any>VideoComponentType)[videoComponentType];

        return typeof str === 'undefined' ? null : str;
    }

    /**
     * 音声情報を取得
     * @param audioComponentType: number
     * @return audio type | null
     */
    private getAudioMode(audioComponentType: number): string | null {
        const str = (<any>AudioComponentType)[audioComponentType];

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
     * 取得した番組情報を返す
     * @return ProgramStateData
     */
    public getProgramInfo(): ProgramStateData | null {
        return this.programInfo;
    }
}
