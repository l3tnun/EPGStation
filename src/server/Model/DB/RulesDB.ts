import DBBase from './DBBase';
import * as DBSchema from './DBSchema';

interface RulesDBInterface extends DBBase {
    create(): Promise<void>;
    insert(rule: DBSchema.RulesSchema): Promise<number>;
    update(id: number, rule: DBSchema.RulesSchema): Promise<void>;
    delete(id: number): Promise<void>;
    enable(id: number): Promise<void>;
    disable(id: number): Promise<void>;
    findId(id: number): Promise<DBSchema.RulesSchema | null>;
    findAllId(): Promise<{ id: number }[]>;
    findAllIdAndKeyword(): Promise<{ id: number, keyword: string }[]>;
    findAll(limit?: number, offset?: number): Promise<DBSchema.RulesSchema[]>;
    getTotal(): Promise<number>;
}

export { RulesDBInterface }

