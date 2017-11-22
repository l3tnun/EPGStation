import * as apid from '../../../../node_modules/mirakurun/api';
import DBBase from './DBBase';
import * as DBSchema from './DBSchema';
import { SearchInterface } from '../../Operator/RuleInterface';

/**
* 放送波索引
*/
interface ChannelTypeHash {
    [key: number]: { // NetworkId
        [key:number]: { //ServiceId
            type: apid.ChannelType;
            channel: string;
        }
    }
}

interface ProgramsDBInterface extends DBBase {
    create(): Promise<void>;
    insert(channelTypes: ChannelTypeHash, programs: apid.Program[], isDelete?: boolean): Promise<void>;
    delete(programId: number): Promise<void>;
    deleteOldPrograms(): Promise<void>;
    findSchedule(startAt: apid.UnixtimeMS, endAt: apid.UnixtimeMS, type: apid.ChannelType): Promise<DBSchema.ScheduleProgramItem[]>;
    findScheduleId(startAt: apid.UnixtimeMS, endAt: apid.UnixtimeMS, channelId: apid.ServiceItemId): Promise<DBSchema.ScheduleProgramItem[]>;
    findBroadcasting(addition?: apid.UnixtimeMS): Promise<DBSchema.ScheduleProgramItem[]>;
    findBroadcastingChanel(channelId: apid.ServiceItemId, addition?: apid.UnixtimeMS): Promise<DBSchema.ScheduleProgramItem[]>;
    findId(id: number, isNow?: boolean): Promise<DBSchema.ProgramSchema | null>;
    findRule(option: SearchInterface, fields?: string | null, limit?: number | null): Promise<DBSchema.ProgramSchema[]>;
}

namespace ProgramsDBInterface {
    export const ScheduleProgramItemColumns = 'id, channelId, startAt, endAt, isFree, name, description, extended, genre1, genre2, channelType, videoType, videoResolution, videoStreamContent, videoComponentType, audioSamplingRate, audioComponentType';
}


export { ChannelTypeHash, ProgramsDBInterface }
