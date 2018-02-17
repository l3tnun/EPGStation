import ApiModel from './ApiModel';
import { ProgramsDBInterface } from '../DB/ProgramsDB';
import { ServicesDBInterface } from '../DB/ServicesDB';
import * as DBSchema from '../DB/DBSchema';
import ApiUtil from './ApiUtil';
import DateUtil from '../../Util/DateUtil';
import * as apid from '../../../../node_modules/mirakurun/api';

interface IPTVModelInterface extends ApiModel {
    getChannelList(host: string, isSecure: boolean, mode: number): Promise<string>;
    getEpg(days: number): Promise<string>;
}

/**
* IPTVModel
* kodi IPTV 用の設定を生成する
*/
class IPTVModel extends ApiModel implements IPTVModelInterface {
    private programsDB: ProgramsDBInterface;
    private servicesDB: ServicesDBInterface;
    private timezone: string;

    constructor(
        programsDB: ProgramsDBInterface,
        servicesDB: ServicesDBInterface,
    ) {
        super();
        this.programsDB = programsDB;
        this.servicesDB = servicesDB;

        this.timezone = new Date().toString().replace(/^.*GMT([+-]\d{4}).*$/,'$1');
    }

    /**
    * channel list を生成
    * @param host: host
    * @param isSecure: https か
    * @param mode: transcode mode
    * @return Promise<string>
    */
    public async getChannelList(host: string, isSecure: boolean, mode: number): Promise<string> {
        let channels = await this.servicesDB.findAll();

        // sort
        channels = ApiUtil.sortItems(channels, this.config.getConfig().serviceOrder || []);

        let channelIndex: { [key: string]: number } = {};

        let str = '#EXTM3U\n';
        for(let channel of channels) {
            if(channel.type !== 1) { continue; }
            if(typeof channelIndex[channel.name] === 'undefined') {
                channelIndex[channel.name] = 0;
            } else {
                channelIndex[channel.name] += 1;
                for(let i = 0; i <= channelIndex[channel.name]; i++) {
                    channel.name += ' ';
                }
            }

            let logo = '';
            if(channel.hasLogoData) { logo = `tvg-logo="${ isSecure ? 'https' : 'http' }://${ host }/api/channels/${ channel.id }/logo"`; }
            str += `#EXTINF:-1 tvg-id="${ channel.id }" ${ logo } group-title="${ channel.channelType }",${ channel.name }　\n`;
            str += `${ isSecure ? 'https' : 'http' }://${ host }/api/streams/live/${ channel.id }/mpegts?mode=${ mode }\n`;
        }

        return str;
    }

    /**
    * 番組情報を生成
    * @return Promise<string>
    */
    public async getEpg(days: number): Promise<string> {
        const now = new Date().getTime();
        const programs = await this.programsDB.findSchedule(now, now + 1000 * 60 * 60 * 24 * days);
        const channels = await this.servicesDB.findAll();

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
    * 時刻文字列を生成する
    * @param time: apid.UnixtimeMS
    @return string
    */
    private getTimeStr(time: apid.UnixtimeMS): string {
        return DateUtil.format(new Date(time), `yyyyMMddhhmmss ${ this.timezone }`);
    }
}

export { IPTVModelInterface, IPTVModel }

