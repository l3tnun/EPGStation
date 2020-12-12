import * as apid from '../../../../../api';

export interface EncodeInfoDisplayItem {
    display: {
        channelName: string;
        name: string;
        time: string;
        duration: number;
        topThumbnailPath: string;
        mode: string;
        percent?: number;
        encodeInfo?: string;
    };
    encodeItem: apid.EncodeProgramItem;
    isSelected: boolean;
}

export interface EncodeInfoDisplayData {
    runningItems: EncodeInfoDisplayItem[];
    waitItems: EncodeInfoDisplayItem[];
}

export default interface IEncodeState {
    clearData(): void;
    fetchData(isHalfWidth: boolean): Promise<void>;
    getEncodeInfo(): EncodeInfoDisplayData;
    getSelectedCnt(): number;
    select(encodeId: apid.EncodeId): void;
    selectAll(): void;
    clearSelect(): void;
    multiplueDeletion(): Promise<void>;
}
