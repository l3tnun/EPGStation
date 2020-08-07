import * as apid from '../../../../../api';

export interface EncodeInfoDisplayItem {
    display: {
        channelName: string;
        name: string;
        time: string;
        duration: number;
        mode: string;
    };
    encodeItem: apid.EncodeProgramItem;
}

export interface EncodeInfoDisplayData {
    runningItems: EncodeInfoDisplayItem[];
    waitItems: EncodeInfoDisplayItem[];
}

export default interface IEncodeState {
    clearData(): void;
    fetchData(isHalfWidth: boolean): Promise<void>;
    getEncodeInfo(): EncodeInfoDisplayData;
    cancel(encodeId: apid.EncodeId): Promise<void>;
}
