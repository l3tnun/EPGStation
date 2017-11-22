import DBBase from './DBBase';
import * as DBSchema from './DBSchema';

interface findQuery {
    ruleId?: number | null,
    genre1?: number,
    channelId?: number,
    keyword?: string,
}

interface RecordedDBInterface extends DBBase {
    create(): Promise<void>;
    insert(program: DBSchema.RecordedSchema): Promise<number>;
    replace(program: DBSchema.RecordedSchema): Promise<void>;
    delete(id: number): Promise<void>;
    deleteRecPath(id: number): Promise<void>;
    deleteRuleId(ruleId: number): Promise<void>;
    addThumbnail(id: number, filePath: string): Promise<void>;
    removeRecording(id: number): Promise<void>;
    removeAllRecording(): Promise<void>;
    findId(id: number): Promise<DBSchema.RecordedSchema | null>;
    findOld():  Promise<DBSchema.RecordedSchema | null>;
    findAll(limit: number, offset: number, option?: findQuery): Promise<DBSchema.RecordedSchema[]>;
    getTotal(option?: findQuery): Promise<number>;
    getRuleTag(): Promise<DBSchema.RuleTag[]>;
    getChannelTag(): Promise<DBSchema.ChannelTag[]>;
    getGenreTag(): Promise<DBSchema.GenreTag[]>;
}

export { findQuery, RecordedDBInterface };

