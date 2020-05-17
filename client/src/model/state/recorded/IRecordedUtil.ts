import * as apid from '../../../../../api';

export interface RecordedDisplayData {
    display: {
        channelName: string;
        name: string;
        time: string;
        duration: number;
        description?: string;
        extended?: string;
        genre?: string;
        topThumbnailPath: string;
        thumbnails?: apid.ThumbnailId[];
        videoFiles?: apid.VideoFile[];
        dropCnt?: string;
    };
    recordedItem: apid.RecordedItem;
}

export default interface IRecordedUtil {
    convertRecordedItemToDisplayData(item: apid.RecordedItem, isHalfWidth: boolean): RecordedDisplayData;
}
