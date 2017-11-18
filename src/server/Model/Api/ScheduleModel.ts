import ApiModel from './ApiModel';
import { ProgramsDBInterface } from '../DB/ProgramsDB';
import { ServicesDBInterface } from '../DB/ServicesDB';
import * as DBSchema from '../DB/DBSchema';
import ApiUtil from './ApiUtil';
import DateUtil from '../../Util/DateUtil';
import * as apid from '../../../../node_modules/mirakurun/api';
import { SearchInterface } from '../../Operator/RuleInterface';
import CheckRule from '../../Util/CheckRule';
import { IPCClientInterface } from '../IPC/IPCClient';

interface ScheduleModelInterface extends ApiModel {
    getSchedule(time: number, length: number, type: apid.ChannelType): Promise<{}[]>;
    getScheduleId(time: number, channelId: number): Promise<{}>;
    getBroadcasting(addition: number): Promise<{}>;
    searchProgram(searchOption: SearchInterface): Promise<{}[]>;
    updateReserves(): Promise<void>;
}

namespace ScheduleModelInterface {
    export const channelIdIsNotFoundError = 'channelIdIsNotFound';
    export const searchOptionIsIncorrect = 'searchOptionIsIncorrect';
}

class ScheduleModel extends ApiModel implements ScheduleModelInterface {
    private programDB: ProgramsDBInterface;
    private serviceDB: ServicesDBInterface;
    private ipc: IPCClientInterface;

    constructor(
        programDB: ProgramsDBInterface,
        serviceDB: ServicesDBInterface,
        ipc: IPCClientInterface,
    ) {
        super();
        this.programDB = programDB;
        this.serviceDB = serviceDB;
        this.ipc = ipc;
    }

    /**
    * 番組データを取得
    * @param time: YYMMDDHH
    * @param length: 長さ
    * @param type: 放送波
    * @return Promise<{}[]>
    */
    public async getSchedule(time: number, length: number, type: apid.ChannelType): Promise<{}[]> {
        let times = this.getTime(time, length);
        let programs = await this.programDB.findSchedule(times.startAt, times.endAt, type);
        let channels = await this.serviceDB.findChannelType([type]);

        // sort
        channels = ApiUtil.sortItems(channels, this.config.getConfig().serviceOrder || []);

        //channelId ごとに programs をまとめる
        let programsIndex: { [key: number]: any[] } = {};
        for(let program of programs) {
            if(typeof programsIndex[program.channelId] === 'undefined') {
                programsIndex[program.channelId] = [];
            }

            programsIndex[program.channelId].push(ApiUtil.deleteNullinHash(program));
        }

        // 結果を格納する
        let results: any[] = [];
        for(let channel of channels) {
            if(typeof programsIndex[channel.id] === 'undefined') { continue; }
            results.push({
                channel: this.createChannel(channel),
                programs: programsIndex[channel.id],
            });
        }

        return results;
    }

    /**
    * チャンネル別の番組データを取得
    * @param time: YYMMDDHH
    * @param length: 長さ
    * @param channelId: channel id
    * @return Promise<{}>
    */
    public async getScheduleId(time: number, channelId: number): Promise<{}> {
        let times = this.getTime(time, 24);
        let programs: DBSchema.ScheduleProgramItem[][] = [];
        for(let i = 0; i < 7; i++) {
            let addTime = i * 24 * 60 * 60 * 1000;
            programs.push(await this.programDB.findScheduleId(times.startAt + addTime, times.endAt + addTime, channelId));
        }

        let channel = await this.serviceDB.findId(channelId);

        if(channel === null) { throw new Error(ScheduleModelInterface.channelIdIsNotFoundError); }

        return programs.map((program) => {
            return {
                channel: this.createChannel(channel!),
                programs: program,
            }
        });
    }

    /**
    * 放映中の番組データを取得
    * @param addition 加算時間(分)
    * @return Promise<{}>
    */
    public async getBroadcasting(addition: number): Promise<{}> {
        let programs = await this.programDB.findBroadcasting(addition * 1000 * 60);
        let channels = await this.serviceDB.findAll();

        // sort
        channels = ApiUtil.sortItems(channels, this.config.getConfig().serviceOrder || []);

        //channelId ごとに programs をまとめる
        let programsIndex: { [key: number]: any[] } = {};
        for(let program of programs) {
            if(typeof programsIndex[program.channelId] === 'undefined') {
                programsIndex[program.channelId] = [];
            }

            programsIndex[program.channelId].push(ApiUtil.deleteNullinHash(program));
        }

        // 結果を格納する
        let results: any[] = [];
        for(let channel of channels) {
            if(typeof programsIndex[channel.id] === 'undefined') { continue; }
            results.push({
                channel: this.createChannel(channel),
                programs: [ programsIndex[channel.id][0] ],
            });
        }

        return results;
    }

    /**
    * time (YYMMDDHH) から startAt, endAt を取得する
    * @param time: number
    * @return startAt, endAt
    */
    private getTime(time: number, length: number): { startAt: apid.UnixtimeMS, endAt: apid.UnixtimeMS } {
        let timeStr: string;
        if(typeof time === 'undefined') {
            timeStr = DateUtil.format(DateUtil.getJaDate(new Date()), 'YYMMddhh');
        } else {
            timeStr = String(time);
        }

        let startAt = new Date(`20${ timeStr.substr(0, 2) }/${ timeStr.substr(2, 2) }/${ timeStr.substr(4, 2) } ${ timeStr.substr(6, 2) }:00:00 +0900`).getTime();
        let endAt = startAt + (length * 60 * 60 * 1000);

        return {
            startAt: startAt,
            endAt: endAt,
        }
    }

    /**
    * DBSchema.ServiceSchema からデータを生成
    * @param channel: DBSchema.ServiceSchema
    * @return {}
    */
    private createChannel(channel: DBSchema.ServiceSchema): {} {
        let c = {
            id: channel.id,
            serviceId: channel.serviceId,
            networkId: channel.networkId,
            name: channel.name,
            hasLogoData: channel.hasLogoData,
            channelType: channel.channelType,
        }
        if(channel.remoteControlKeyId !== null) { c['remoteControlKeyId'] = channel.remoteControlKeyId; }

        return c;
    }

    /**
    * rule 検索
    * @param searchOption: SearchInterface
    * @return Promise<{}[]>
    */
    public async searchProgram(searchOption: SearchInterface): Promise<{}[]> {
        if(!(new CheckRule().checkRuleSearch(searchOption))) {
            // searchOption が正しく指定されていない
            throw new Error(ScheduleModelInterface.searchOptionIsIncorrect);
        }

        let programs = await this.programDB.findRule(searchOption,
            ProgramsDBInterface.ScheduleProgramItemColumns,
        300);

        return programs.map((program) => {
            return ApiUtil.deleteNullinHash(program);
        })
    }

    /**
    * 予約情報更新
    * @return Promise<void>
    */
    public async updateReserves(): Promise<void> {
        await this.ipc.updateReserves();
    }
}

export { ScheduleModelInterface, ScheduleModel }

