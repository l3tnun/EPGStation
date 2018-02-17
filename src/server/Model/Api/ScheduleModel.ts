import ApiModel from './ApiModel';
import { ProgramsDBInterface } from '../DB/ProgramsDB';
import { ServicesDBInterface } from '../DB/ServicesDB';
import * as DBSchema from '../DB/DBSchema';
import ApiUtil from './ApiUtil';
import DateUtil from '../../Util/DateUtil';
import * as apid from '../../../../node_modules/mirakurun/api';
import { SearchInterface } from '../Operator/RuleInterface';
import CheckRule from '../../Util/CheckRule';
import { IPCClientInterface } from '../IPC/IPCClient';

interface ScheduleModelInterface extends ApiModel {
    getSchedule(time: number, length: number, type: apid.ChannelType): Promise<{}[]>;
    getScheduleId(time: number, channelId: number): Promise<{}>;
    getBroadcasting(addition: number): Promise<{}>;
    getIPTVepg(days: number): Promise<string>;
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
    * Kodi IPTV 番組情報を生成
    * @return Promise<string>
    */
    public async getIPTVepg(days: number): Promise<string> {
        const now = new Date().getTime();
        const programs = await this.programDB.findSchedule(now, now + 1000 * 60 * 60 * 24 * days);
        const channels = await this.serviceDB.findAll();

        // channelId ごとに programs をまとめる
        let programsIndex: { [key: number]: DBSchema.ScheduleProgramItem[] } = {};
        for(let program of programs) {
            if(typeof programsIndex[program.channelId] === 'undefined') {
                programsIndex[program.channelId] = [];
            }

            program.name = this.replaceStr(program.name);
            if(program.description !== null) {
                program.description = this.replaceStr(program.description);
                if(program.extended !== null) {
                    program.description += this.replaceStr(program.extended);
                }
            }
            programsIndex[program.channelId].push(program);
        }


        let str = '<?xml version="1.0" encoding="UTF-8"?>'
            + '<!DOCTYPE tv SYSTEM "xmltv.dtd">'
            + '<tv generator-info-name="EPGStation">'
        for(let channel of channels) {
            if(typeof programsIndex[channel.id] === 'undefined') { continue; }
            str += `<channel id="${ channel.id }" tp="${ channel.channel }">`;
            str += `<display-name lang="ja_JP">${ channel.name }</display-name>`;
            str += `<service_id>${  channel.serviceId }</service_id>`;
            str += '</channel>\n';

            for(let program of programsIndex[channel.id]) {
                str += `<programme start="${ this.getTimeStr(program.startAt) }" stop="${ this.getTimeStr(program.endAt) }" channel="${ program.channelId }">`;
                str += `<title lang="ja_JP">${ program.name }</title>`;
                if(program.description !== null) { str += `    <desc lang="ja_JP">${ program.description }</desc>`; }
                str += '</programme>';
            }
        }
        str += '</tv>';

        return str;
    }

    /**
    * xml での禁止文字列を置き換える
    * @param str: string
    * @return string
    */
    private replaceStr(str: string): string {
        return str.replace(/</g,'＜').replace(/>/g,'＞').replace(/&/g, '＆').replace(/"/g, '”').replace(/'/g, '’');
    }

    /**
    * iptv 用の時刻文字列を生成する
    * @param time: apid.UnixtimeMS
    @return string
    */
    private getTimeStr(time: apid.UnixtimeMS): string {
        return DateUtil.format(new Date(time), 'yyyyMMddhhmmss +0900');
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

        let programs = await this.programDB.findRule(searchOption, true, 300);

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

