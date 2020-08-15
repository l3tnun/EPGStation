import * as apid from '../../../../../api';

export interface ReserveStateData {
    display: {
        channelName: string;
        name: string;
        day: string;
        dow: string;
        startTime: string;
        endTime: string;
        duration: number;
        genres: string[];
        description?: string;
        extended?: string;
    };
    reserveItem: apid.ReserveItem;
}

export default interface IReserveStateUtil {
    convertReserveItemsToStateDatas(reserves: apid.ReserveItem[], isHalfWidth: boolean): ReserveStateData[];
}
