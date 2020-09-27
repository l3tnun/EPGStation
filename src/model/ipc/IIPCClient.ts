import * as apid from '../../../api';
import { AddVideoFileOption, UploadedVideoFileOption } from '../operator/recorded/IRecordedManageModel';

export interface IPCReservationManageModel {
    getBroadcastStatus(): Promise<apid.BroadcastStatus>;
    add(option: apid.ManualReserveOption): Promise<apid.ReserveId>;
    update(reserveId: apid.ReserveId): Promise<void>;
    updateRule(ruleId: apid.RuleId): Promise<void>;
    updateAll(isUntilComplete: boolean): Promise<void>;
    cancel(reserveId: apid.ReserveId): Promise<void>;
    removeSkip(reserveId: apid.ReserveId): Promise<void>;
    removeOverlap(reserveId: apid.ReserveId): Promise<void>;
    edit(reserveId: apid.ReserveId, option: apid.EditManualReserveOption): Promise<void>;
    clean(): Promise<void>;
}

export interface IPCRecordedManageModel {
    delete(recordedId: apid.RecordedId): Promise<void>;
    updateVideoFileSize(videoFileId: apid.VideoFileId): Promise<void>;
    addVideoFile(option: AddVideoFileOption): Promise<apid.VideoFileId>;
    addUploadedVideoFile(option: UploadedVideoFileOption): Promise<void>;
    createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId>;
    deleteVideoFile(videoFileId: apid.VideoFileId, isIgnoreProtection?: boolean): Promise<void>;
    changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void>;
    videoFileCleanup(): Promise<void>;
    dropLogFileCleanup(): Promise<void>;
}

export interface IPCRecordedTagManageModel {
    create(name: string, color: string): Promise<apid.RecordedTagId>;
    update(tagId: apid.RecordedTagId, name: string, color: string): Promise<void>;
    setRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
    delete(tagId: apid.RecordedTagId): Promise<void>;
    deleteRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
}

export interface IPCRecordingManageModel {
    resetTimer(): void;
}

export interface IPCRuleManageModel {
    add(rule: apid.AddRuleOption): Promise<apid.RuleId>;
    update(rule: apid.Rule): Promise<void>;
    enable(ruleId: apid.RuleId): Promise<void>;
    disable(ruleId: apid.RuleId): Promise<void>;
    delete(ruleId: apid.RuleId): Promise<void>;
    deletes(ruleIds: apid.RuleId[]): Promise<apid.RuleId[]>;
}

export interface IPCThumbnailManageModel {
    regenerate(): Promise<void>;
    fileCleanup(): Promise<void>;
}

export default interface IIPCClient {
    reserveation: IPCReservationManageModel;
    recorded: IPCRecordedManageModel;
    recordedTag: IPCRecordedTagManageModel;
    recording: IPCRecordingManageModel;
    rule: IPCRuleManageModel;
    thumbnail: IPCThumbnailManageModel;
}
