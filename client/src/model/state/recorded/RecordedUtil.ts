import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import DateUtil from '../../../util/DateUtil';
import GenreUtil from '../../../util/GenreUtil';
import IChannelModel from '../../channels/IChannelModel';
import IServerConfigModel from '../../serverConfig/IServerConfigModel';
import IRecordedUtil, { RecordedDisplayData } from './IRecordedUtil';

@injectable()
export default class RecordedUtil implements IRecordedUtil {
    private serverConfigModel: IServerConfigModel;
    private channelModel: IChannelModel;

    constructor(@inject('IServerConfigModel') serverConfigModel: IServerConfigModel, @inject('IChannelModel') channelModel: IChannelModel) {
        this.serverConfigModel = serverConfigModel;
        this.channelModel = channelModel;
    }

    public convertRecordedItemToDisplayData(item: apid.RecordedItem, isHalfWidth: boolean): RecordedDisplayData {
        const startAt = DateUtil.getJaDate(new Date(item.startAt));
        const endAt = DateUtil.getJaDate(new Date(item.endAt));
        const channel = this.channelModel.findChannel(item.channelId, isHalfWidth);

        const result: RecordedDisplayData = {
            display: {
                channelName: channel === null ? item.channelId.toString(10) : channel.name,
                name: item.name,
                time: DateUtil.format(startAt, 'MM/dd(w) hh:mm ~ ') + DateUtil.format(endAt, 'hh:mm'),
                shortTime: DateUtil.format(startAt, 'MM/dd(w) hh:mm'),
                duration: Math.floor((item.endAt - item.startAt) / 1000 / 60),
                description: item.description,
                extended: item.extended,
                topThumbnailPath: typeof item.thumbnails === 'undefined' || item.thumbnails.length === 0 ? './img/noimg.png' : `./api/thumbnails/${item.thumbnails[0]}`,
                thumbnails: item.thumbnails,
                videoFiles: item.videoFiles,
                hasDrop: false,
            },
            recordedItem: item,
            isSelected: false,
        };

        // ストリーミング可能な videoFile を列挙する
        const config = this.serverConfigModel.getConfig();
        if (typeof result.display.videoFiles !== 'undefined' && config !== null) {
            result.display.canStremingVideoFiles = result.display.videoFiles.filter(v => {
                return (v.type === 'ts' && config.isEnableTSRecordedStream === true) || (v.type === 'encoded' && config.isEnableEncodedRecordedStream === true);
            });

            if (result.display.canStremingVideoFiles.length === 0) {
                delete result.display.canStremingVideoFiles;
            }
        }

        let genres: string | null = null;
        if (typeof item.genre1 !== 'undefined') {
            genres = GenreUtil.getGenres(item.genre1, item.subGenre1);
        } else if (typeof item.genre2 !== 'undefined') {
            genres = GenreUtil.getGenres(item.genre2, item.subGenre2);
        } else if (typeof item.genre3 !== 'undefined') {
            genres = GenreUtil.getGenres(item.genre3, item.subGenre3);
        }
        if (genres !== null) {
            result.display.genre = genres;
        }

        if (item.isRecording !== true && typeof item.dropLogFile !== 'undefined') {
            result.display.drop = `drop: ${item.dropLogFile.dropCnt}, error: ${item.dropLogFile.errorCnt}, scrambling: ${item.dropLogFile.scramblingCnt}`;

            result.display.hasDrop = item.dropLogFile.dropCnt > 0 || item.dropLogFile.errorCnt > 0 || item.dropLogFile.scramblingCnt > 0;
        }

        return result;
    }
}
