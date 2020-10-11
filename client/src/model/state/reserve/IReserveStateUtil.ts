import * as apid from '../../../../../api';

export interface SelectedIndex {
    [reserveId: number]: boolean;
}

export interface ReserveStateData {
    display: {
        channelName: string;
        isRule: boolean;
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
    isSelected: boolean;
}

export default interface IReserveStateUtil {
    convertReserveItemsToStateDatas(reserves: apid.ReserveItem[], isHalfWidth: boolean, isSelectedIndex?: SelectedIndex): ReserveStateData[];
}
