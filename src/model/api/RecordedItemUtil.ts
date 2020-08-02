import { injectable } from 'inversify';
import * as apid from '../../../api';
import Recorded from '../../db/entities/Recorded';
import { EncodeRecordedIdIndex } from '../service/encode/IEncodeManageModel';
import IRecordedItemUtil from './IRecordedItemUtil';

@injectable()
export default class RecordedItemUtil implements IRecordedItemUtil {
    /**
     * Recorded を RecordedItem に変換する
     * @param recorded: Recorded
     * @param isHalfWidth isHalfWidth
     */
    public convertRecordedToRecordedItem(
        recorded: Recorded,
        isHalfWidth: boolean,
        encodeIndex: EncodeRecordedIdIndex = {},
    ): apid.RecordedItem {
        const item: apid.RecordedItem = {
            id: recorded.id,
            channelId: recorded.channelId,
            startAt: recorded.startAt,
            endAt: recorded.endAt,
            name: isHalfWidth === true ? recorded.halfWidthName : recorded.name,
            isRecording: recorded.isRecording,
            isEncoding: typeof encodeIndex[recorded.id] !== 'undefined',
        };

        if (recorded.ruleId !== null) {
            item.ruleId = recorded.ruleId;
        }

        if (recorded.programId !== null) {
            item.programId = recorded.programId;
        }

        if (recorded.description !== null) {
            item.description = isHalfWidth === true ? recorded.halfWidthDescription! : recorded.description;
        }

        if (recorded.extended !== null) {
            item.extended = isHalfWidth === true ? recorded.halfWidthExtended! : recorded.extended;
        }

        if (recorded.genre1 !== null) {
            item.genre1 = recorded.genre1;
        }

        if (recorded.subGenre1 !== null) {
            item.subGenre1 = recorded.subGenre1;
        }

        if (recorded.genre2 !== null) {
            item.genre2 = recorded.genre2;
        }

        if (recorded.subGenre2 !== null) {
            item.subGenre2 = recorded.subGenre2;
        }

        if (recorded.genre3 !== null) {
            item.genre3 = recorded.genre3;
        }

        if (recorded.subGenre3 !== null) {
            item.subGenre3 = recorded.subGenre3;
        }

        if (recorded.videoType !== null) {
            item.videoType = <any>recorded.videoType;
        }

        if (recorded.videoResolution !== null) {
            item.videoResolution = <any>recorded.videoResolution;
        }

        if (recorded.videoStreamContent !== null) {
            item.videoStreamContent = recorded.videoStreamContent;
        }

        if (recorded.videoComponentType !== null) {
            item.videoComponentType = recorded.videoComponentType;
        }

        if (recorded.audioSamplingRate !== null) {
            item.audioSamplingRate = <any>recorded.audioSamplingRate;
        }

        if (recorded.audioComponentType !== null) {
            item.audioComponentType = recorded.audioComponentType;
        }

        if (typeof recorded.thumbnails !== 'undefined') {
            item.thumbnails = recorded.thumbnails.map(t => {
                return t.id;
            });
        }

        if (typeof recorded.videoFiles !== 'undefined') {
            item.videoFiles = recorded.videoFiles.map(v => {
                return {
                    id: v.id,
                    name: v.name,
                    type: v.type as apid.VideoFileType,
                    size: v.size,
                };
            });
        }

        if (typeof recorded.tags !== 'undefined') {
            item.tags = recorded.tags.map(t => {
                return {
                    id: t.id,
                    name: t.name,
                };
            });
        }

        return item;
    }
}
