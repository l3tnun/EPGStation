import * as apid from '../../../../../api';
import IStreamBaseModel from './IStreamBaseModel';

export type RecordedStreamModelProvider = () => Promise<IRecordedStreamBaseModel>;
export type RecordedHLSStreamModelProvider = () => Promise<IRecordedStreamBaseModel>;

export interface RecordedStreamOption {
    videoFileId: apid.VideoFileId;
    playPosition: number; // 再生位置(秒)
    cmd: string;
}

export interface VideoFileInfo {
    duration: number;
    size: number;
    bitRate: number;
}

export default interface IRecordedStreamBaseModel extends IStreamBaseModel<RecordedStreamOption> {
    setOption(option: RecordedStreamOption, mode: number): void;
}
