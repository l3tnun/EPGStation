/* eslint-disable no-control-regex */
/* eslint-disable no-irregular-whitespace */
import { inject, injectable } from 'inversify';
import type * as apid from '../../../../api.js';
import Program from '../../../db/entities/Program.js';
import DateUtil from '../../../util/DateUtil.js';
import IChannelDB from '../../db/IChannelDB.js';
import IProgramDB from '../../db/IProgramDB.js';
import IIPTVApiModel, { IptvChannelListInput, IptvRequestContext } from './IIPTVApiModel.js';
import ChannelUtil from '../../../util/ChannelUtil.js';

/** `IIPTVApiModel`の実装。チャンネル一覧をm3u8、番組表をXMLTV形式へ変換して返す。 */
@injectable()
class IPTVApiModel implements IIPTVApiModel {
    private channelDB: IChannelDB;
    private programDB: IProgramDB;

    constructor(@inject('IChannelDB') channelDB: IChannelDB, @inject('IProgramDB') programDB: IProgramDB) {
        this.channelDB = channelDB;
        this.programDB = programDB;
    }

    /**
     * channel list を生成
     * @param input: channel list input
     * @return Promise<string>
     */
    public async getChannelList({ isHalfWidth, mode, publicUrls }: IptvChannelListInput): Promise<string> {
        const channels = await this.channelDB.findAll(true);

        const channelIndexes = new Map<string, number>();

        let str = '#EXTM3U\n';
        for (const channel of channels) {
            if (!ChannelUtil.isMediaService(channel.type)) {
                continue;
            }

            const sourceName = isHalfWidth === true ? channel.halfWidthName : channel.name;
            const occurrenceIndex = channelIndexes.get(sourceName) ?? 0;
            channelIndexes.set(sourceName, occurrenceIndex + 1);
            const channelName = sourceName + (occurrenceIndex === 0 ? '' : ' '.repeat(occurrenceIndex + 1));

            let logo = '';
            if (channel.hasLogoData) {
                logo = `tvg-logo="${publicUrls.channelLogoUrl(channel.id)}"`;
            }
            str += `#KODIPROP:mimetype=video/mp2t\n`;
            str += `#EXTINF:-1 tvg-id="${channel.id}" ${logo} group-title="${channel.channelType}",${channelName}　\n`;
            str += `${publicUrls.liveM2tsUrl(channel.id, mode)}\n`;
        }

        return str;
    }

    /**
     * 番組情報を生成
     * @param days: 取得する日数
     * @param isHalfWidth: 半角で取得するか
     * @return Promise<string>
     */
    public getEpg(days: number, isHalfWidth: boolean): Promise<string> {
        return this.generateEpg(days, isHalfWidth);
    }

    public getEpgForRequest(days: number, isHalfWidth: boolean, requestContext: IptvRequestContext): Promise<string> {
        return this.generateEpg(days, isHalfWidth, requestContext);
    }

    private async generateEpg(
        days: number,
        isHalfWidth: boolean,
        requestContext?: IptvRequestContext,
    ): Promise<string> {
        const now = new Date().getTime();
        const programs = await this.programDB.findSchedule({
            startAt: now,
            endAt: now + 1000 * 60 * 60 * 24 * days,
            isHalfWidth: isHalfWidth,
            types: ['GR', 'BS', 'CS', 'SKY', 'BS4K'],
        });
        requestContext?.ensureActive();
        const channels = await this.channelDB.findAll();
        requestContext?.ensureActive();

        // channelId ごとに programs をまとめる
        const programsIndex: { [key: number]: ProgramProjection[] } = {};
        for (const program of programs) {
            if (typeof programsIndex[program.channelId] === 'undefined') {
                programsIndex[program.channelId] = [];
            }

            const description = isHalfWidth ? program.halfWidthDescription : program.description;
            const extended = isHalfWidth ? program.halfWidthExtended : program.extended;
            programsIndex[program.channelId].push({
                channelId: program.channelId,
                startAt: program.startAt,
                endAt: program.endAt,
                name: this.replaceStr(isHalfWidth ? program.halfWidthName : program.name),
                description:
                    description === null
                        ? null
                        : this.replaceStr(description) + (extended === null ? '' : this.replaceStr(extended)),
            });
        }

        let str =
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<!DOCTYPE tv SYSTEM "xmltv.dtd">' +
            '<tv generator-info-name="EPGStation">';
        for (const channel of channels) {
            if (typeof programsIndex[channel.id] === 'undefined') {
                continue;
            }
            str += `<channel id="${channel.id}" tp="${channel.channel}">`;
            str += `<display-name lang="ja_JP">${
                isHalfWidth === true ? channel.halfWidthName : channel.name
            }</display-name>`;
            str += `<service_id>${channel.serviceId}</service_id>`;
            str += '</channel>\n';
            for (const program of programsIndex[channel.id]) {
                str += `<programme start="${this.getTimeStr(program.startAt)}" stop="${this.getTimeStr(
                    program.endAt,
                )}" channel="${program.channelId}">`;
                str += `<title lang="ja_JP">${program.name}</title>`;
                if (program.description !== null) {
                    str += `    <desc lang="ja_JP">${program.description}</desc>`;
                }
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
        return str
            .replace(/</g, '＜')
            .replace(/>/g, '＞')
            .replace(/&/g, '＆')
            .replace(/"/g, '”')
            .replace(/'/g, '’')
            .replace(/\x1a/g, '');
    }

    /**
     * 時刻文字列を生成する
     * @param time: apid.UnixtimeMS
     * @return string
     */
    private getTimeStr(time: apid.UnixtimeMS): string {
        return DateUtil.format(new Date(time), `yyyyMMddhhmmss ${IPTVApiModel.TIMEZONE}`);
    }
}

type ProgramProjection = Pick<Program, 'channelId' | 'startAt' | 'endAt' | 'name' | 'description'>;

namespace IPTVApiModel {
    export const TIMEZONE = new Date().toString().replace(/^.*GMT([+-]\d{4}).*$/, '$1');
}

/** `IIPTVApiModel`実装の`IPTVApiModel`クラス（タイムゾーン用の`namespace`宣言とマージ済み）を公開する。 */
export default IPTVApiModel;
