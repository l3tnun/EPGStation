import * as apid from '../../../../../api';

export interface FetchGuideOption {
    type?: apid.ChannelType;
    time?: string; // YYMMddhh
    length: number;
    isHalfWidth: boolean;
}

/**
 * 表示範囲情報
 */
export interface DisplayRange {
    baseWidth: number;
    baseHeight: number;
    maxWidth: number;
    maxHeight: number;
    offsetWidth: number;
    offsetHeight: number;
}

/**
 * 番組 DOM データ
 */
export interface ProgramDomItem {
    element: HTMLElement;
    top: number;
    left: number;
    height: number;
    isVisible: boolean;
}

export default interface IGuideState {
    clearDate(): void;
    setDisplayRange(baseSize: DisplayRange): void;
    fetchGuide(option: FetchGuideOption): Promise<void>;
    createProgramDoms(): void;
    updateVisible(): void;
    updateReserves(): void;
    getChannels(): apid.ScheduleChannleItem[];
    getChannelsLength(): number;
    getTimes(): number[];
    getTimesLength(): number;
    getProgramDoms(): ProgramDomItem[];
    getTitle(type?: string): string;
}
