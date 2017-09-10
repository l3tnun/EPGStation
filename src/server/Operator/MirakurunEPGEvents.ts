import * as apid from '../../../node_modules/mirakurun/api';

export interface redefineProgram {
    from: apid.ProgramId;
    to: apid.ProgramId;
}

export interface ProgramBaseEvent extends apid.Event {
    resource: 'program';
    data: redefineProgram | apid.Program;
}

export interface CreateEvent extends ProgramBaseEvent {
    type: 'create';
    data: apid.Program;
}

export interface UpdateEvent extends ProgramBaseEvent {
    type: 'update';
    data: apid.Program;
}

export interface ReDefineEvent extends ProgramBaseEvent {
    type: 'redefine';
    data: redefineProgram;
}

export interface ServiceEvents extends apid.Event {
    resource: 'service';
    data: apid.Service;
}

