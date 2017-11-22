import DBBase from './DBBase';
import * as DBSchema from './DBSchema';

interface EncodedDBInterface extends DBBase {
    create(): Promise<void>;
    insert(recordedId: number, name: string, path: string): Promise<number>;
    delete(id: number): Promise<void>;
    deleteRecordedId(recordedId: number): Promise<void>;
    findId(id: number): Promise<DBSchema.EncodedSchema | null>;
    findRecordedId(recordedId: number): Promise<DBSchema.EncodedSchema[]>;
}

export { EncodedDBInterface };
