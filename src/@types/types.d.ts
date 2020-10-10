/**
 * 超手抜き aribts 定義
 */
declare module 'aribts' {
    import { EventEmitter } from 'eventemitter3';
    import * as stream from 'stream';

    export interface Result {
        [pid: number]: ResultItem;
    }

    export interface ResultItem {
        packet: number;
        error: number;
        drop: number;
        scrambling: number;
    }

    export class TsSectionProgramMap {
        public decode(): ProgramMap;
    }

    export interface ProgramMap {
        program_number: number;
        PCR_PID: number;
        program_info_length: number;
        program_info: any;
        streams: Stream[];
    }

    export interface Stream {
        stream_type: number;
        elementary_PID: number;
        ES_info_length: number;
        ES_info: any;
    }

    export class TsBase extends EventEmitter {
        public pipe: (pipe: TsBase) => boolean;
    }
    export class TsReadableConnector extends stream.Writable {}
    export class TsPacketParser extends TsBase {}
    export class TsPacketAnalyzer extends TsBase {
        public getResult(): Result;
    }
    export class TsSectionParser extends TsBase {}
    export class TsSectionAnalyzer extends TsBase {}
    export class TsSectionUpdater extends TsBase {}
    export class TsPacketSelector extends TsBase {
        // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
        constructor(option: any);
        public onPmt(tsSection: TsSectionProgramMap): void;
    }
}
