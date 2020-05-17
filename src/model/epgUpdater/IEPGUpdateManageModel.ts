import * as mapid from '../../../node_modules/mirakurun/api';

export interface RedefineProgram {
    from: mapid.ProgramId;
    to: mapid.ProgramId;
}

export interface ProgramBaseEvent extends mapid.Event {
    resource: 'program';
    data: RedefineProgram | mapid.Program;
}

export interface CreateEvent extends ProgramBaseEvent {
    type: 'create';
    data: mapid.Program;
}

export interface UpdateEvent extends ProgramBaseEvent {
    type: 'update';
    data: mapid.Program;
}

export interface RedefineEvent extends ProgramBaseEvent {
    type: 'redefine';
    data: RedefineProgram;
}

export interface ServiceEvent extends mapid.Event {
    resource: 'service';
    data: mapid.Service;
}

export default interface IEPGUpdateManageModel {
    updateAll(): Promise<void>;
    updateChannels(): Promise<void>;
    start(): Promise<void>;
    getProgramQueueSize(): number;
    getServiceQueueSize(): number;
    saveProgram(): Promise<void>;
    deleteOldPrograms(): Promise<void>;
    saveSevice(): Promise<void>;
}
