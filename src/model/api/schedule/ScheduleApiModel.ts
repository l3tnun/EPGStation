import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import Channel from '../../../db/entities/Channel';
import Program from '../../../db/entities/Program';
import IChannelDB from '../../db/IChannelDB';
import IProgramDB, { ProgramWithOverlap } from '../../db/IProgramDB';
import IScheduleApiModel from './IScheduleApiModel';

@injectable()
export default class ScheduleApiModel implements IScheduleApiModel {
    private channelDB: IChannelDB;
    private programDB: IProgramDB;

    constructor(@inject('IChannelDB') channelDB: IChannelDB, @inject('IProgramDB') programDB: IProgramDB) {
        this.channelDB = channelDB;
        this.programDB = programDB;
    }

    /**
     * 指定した program id の番組データを取得
     * @param programId: apid.ProgramId
     * @param isHalfWidth: boolean 半角で取得するか
     * @return Promise<apid.Schedule | null>
     */
    public async getSchedule(
        programId: apid.ProgramId,
        isHalfWidth: boolean,
    ): Promise<apid.ScheduleProgramItem | null> {
        const program = await this.programDB.findId(programId);

        return program === null ? null : this.toScheduleProgramItem(program, isHalfWidth);
    }

    /**
     * 番組表データを取得
     * @param option: apid.ScheduldOption
     * @return Promise<apid.Schedule[]>
     */
    public async getSchedules(option: apid.ScheduleOption): Promise<apid.Schedule[]> {
        const types: apid.ChannelType[] = [];
        if (option.GR === true) {
            types.push('GR');
        }
        if (option.BS === true) {
            types.push('BS');
        }
        if (option.CS === true) {
            types.push('CS');
        }
        if (option.SKY === true) {
            types.push('SKY');
        }

        if (types.length === 0) {
            throw new Error('GetScheduleTypesError');
        }

        const channels = await this.channelDB.findChannleTypes(types, true);
        const programs = await this.programDB.findSchedule({
            startAt: option.startAt,
            endAt: option.endAt,
            isHalfWidth: option.isHalfWidth,
            types: types,
        });

        return this.createSchedule(channels, programs, option.isHalfWidth);
    }

    /**
     * Channel[] と Program[] から apid.Schedule[] を生成する
     * @param channels: Channel[]
     * @param programs: Program[]
     * @return apid.Schedule[]
     */
    private createSchedule(channels: Channel[], programs: Program[], isHalfWidth: boolean): apid.Schedule[] {
        // channelId ごとに programs をまとめる
        const programsIndex: { [key: number]: apid.ScheduleProgramItem[] } = {};
        for (const program of programs) {
            if (typeof programsIndex[program.channelId] === 'undefined') {
                programsIndex[program.channelId] = [];
            }

            programsIndex[program.channelId].push(this.toScheduleProgramItem(program, isHalfWidth));
        }

        // 結果を格納する
        const result: apid.Schedule[] = [];
        for (const channel of channels) {
            if (typeof programsIndex[channel.id] === 'undefined') {
                continue;
            }

            result.push({
                channel: this.toScheduleChannleItem(channel, isHalfWidth),
                programs: programsIndex[channel.id],
            });
        }

        return result;
    }

    /**
     * チャンネル指定時の番組表データ取得
     * @param option: id.ChannelScheduleOption
     * @return Promise<apid.Schedule[]>
     */
    public async getChannelSchedule(option: apid.ChannelScheduleOption): Promise<apid.Schedule[]> {
        const channel = await this.channelDB.findId(option.channelId);
        if (channel === null) {
            throw new Error('ChannelIsNotFound');
        }

        const programs: Program[][] = [];
        let baseTime = option.startAt;
        for (let i = 0; i < option.days; i++) {
            const p = await this.programDB.findSchedule({
                startAt: baseTime,
                endAt: baseTime + 60 * 60 * 24 * 1000,
                isHalfWidth: option.isHalfWidth,
                channelId: option.channelId,
            });
            programs.push(p);
            baseTime += 60 * 60 * 24 * 1000;
        }

        const channelItem = this.toScheduleChannleItem(channel, option.isHalfWidth);
        const result: apid.Schedule[] = [];

        for (const program of programs) {
            result.push({
                channel: channelItem,
                programs: program.map(p => {
                    return this.toScheduleProgramItem(p, option.isHalfWidth);
                }),
            });
        }

        return result;
    }

    /**
     * 放映中の番組情報を取得
     * @param option: apid.BroadcastingScheduleOption
     * @return Promise<apid.Schedule[]>
     */
    public async getBroadcastingSchedule(option: apid.BroadcastingScheduleOption): Promise<apid.Schedule[]> {
        const channels = await this.channelDB.findAll(true);
        const programs = await this.programDB.findBroadcasting(option);

        return this.createSchedule(channels, programs, option.isHalfWidth).map(s => {
            if (s.programs.length > 1) {
                s.programs = [s.programs[0]];
            }

            return s;
        });
    }

    /**
     * 番組検索
     * @param option: RuleSearchOption
     * @param isHalfWidth: boolean true 半角文字で返す, false: オリジナルのまま
     * @param limit?: number 最大取得件数
     * @return Promise<ScheduleProgramItem[]>
     */
    public async search(
        option: apid.RuleSearchOption,
        isHalfWidth: boolean,
        limit?: number,
    ): Promise<apid.ScheduleProgramItem[]> {
        const programs = await this.programDB.findRule({
            searchOption: option,
            limit: limit,
        });

        return programs.map(p => {
            return this.toScheduleProgramItem(p, isHalfWidth);
        });
    }

    /**
     * Program を ScheduleProgramItem に変換する
     * @param program: Program | ProgramWithOverlap
     * @param isHalfWidth: boolean true 半角文字で返す, false: オリジナルのまま
     * @return apid.ScheduleProgramItem
     */
    private toScheduleProgramItem(
        program: Program | ProgramWithOverlap,
        isHalfWidth: boolean,
    ): apid.ScheduleProgramItem {
        const result: apid.ScheduleProgramItem = {
            id: program.id,
            channelId: program.channelId,
            startAt: program.startAt,
            endAt: program.endAt,
            isFree: program.isFree,
            name: isHalfWidth ? program.halfWidthName : program.name,
        };

        if (program.description !== null) {
            if (isHalfWidth === true) {
                if (program.halfWidthDescription !== null) {
                    result.description = program.halfWidthDescription;
                }
            } else {
                result.description = program.description;
            }
        }

        if (program.extended !== null) {
            if (isHalfWidth === true) {
                if (program.halfWidthExtended !== null) {
                    result.extended = program.halfWidthExtended;
                }
            } else {
                result.extended = program.extended;
            }
        }

        if (program.genre1 !== null) {
            result.genre1 = program.genre1;
        }

        if (program.subGenre1 !== null) {
            result.subGenre1 = program.subGenre1;
        }

        if (program.genre2 !== null) {
            result.genre2 = program.genre2;
        }

        if (program.subGenre2 !== null) {
            result.subGenre2 = program.subGenre2;
        }

        if (program.genre3 !== null) {
            result.genre3 = program.genre3;
        }

        if (program.subGenre3 !== null) {
            result.subGenre3 = program.subGenre3;
        }

        if (program.videoType !== null) {
            result.videoType = <any>program.videoType;
        }

        if (program.videoResolution !== null) {
            result.videoResolution = <any>program.videoResolution;
        }

        if (program.videoStreamContent !== null) {
            result.videoStreamContent = program.videoStreamContent;
        }

        if (program.videoComponentType !== null) {
            result.videoComponentType = program.videoComponentType;
        }

        if (program.audioSamplingRate !== null) {
            result.audioSamplingRate = <any>program.audioSamplingRate;
        }

        if (program.audioComponentType !== null) {
            result.audioComponentType = program.audioComponentType;
        }

        return result;
    }

    /**
     * Channel を ScheduleChannleItem に変換する
     * @param channel: Channel
     * @param isHalfWidth: boolean true 半角文字で返す, false: オリジナルのまま
     * @return ScheduleChannleItem
     */
    private toScheduleChannleItem(channel: Channel, isHalfWidth: boolean): apid.ScheduleChannleItem {
        const result: apid.ScheduleChannleItem = {
            id: channel.id,
            serviceId: channel.serviceId,
            networkId: channel.networkId,
            name: isHalfWidth ? channel.halfWidthName : channel.name,
            hasLogoData: channel.hasLogoData,
            channelType: <any>channel.channelType,
        };

        if (channel.remoteControlKeyId !== null) {
            result.remoteControlKeyId = channel.remoteControlKeyId;
        }

        return result;
    }
}
