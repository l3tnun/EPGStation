import * as apid from '../../../api';
import Recorded from '../../db/entities/Recorded';

export interface RecordedColumnOption {
    isNeedVideoFiles: boolean;
    isNeedThumbnails: boolean;
    isNeedsDropLog: boolean;
    isNeedTags: boolean;
}

export interface FindAllOption extends apid.GetRecordedOption {
    isRecording?: boolean;
}

export default interface IRecordedDB {
    restore(items: Recorded[]): Promise<void>;
    insertOnce(recorded: Recorded): Promise<apid.RecordedId>;
    updateOnce(recorded: Recorded): Promise<void>;
    removeRecording(recordedId: apid.RecordedId): Promise<void>;
    removeDropLogFileId(dropLogFileId: apid.DropLogFileId): Promise<void>;
    changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void>;
    deleteOnce(recordedId: apid.RecordedId): Promise<void>;
    findId(recordedId: apid.RecordedId): Promise<Recorded | null>;
    findIds(recordedIds: apid.RecordedId[]): Promise<Recorded[]>;
    findAll(option: FindAllOption, columnOption: RecordedColumnOption): Promise<[Recorded[], number]>;
    findChannelList(): Promise<apid.RecordedChannelListItem[]>;
    findGenreList(): Promise<apid.RecordedGenreListItem[]>;
    findOld(): Promise<Recorded | null>;
}
