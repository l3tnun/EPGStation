import { Connection } from 'typeorm';

export default interface IDBOperator {
    getConnection(): Promise<Connection>;
    checkConnection(): Promise<void>;
    closeConnection(): Promise<void>;
    isEnabledRegexp(): boolean;
    convertBoolean(value: boolean): boolean | number;
    isEnableCS(): boolean;
    getRegexpStr(cs: boolean): string;
    getLikeStr(cs: boolean): string;
}
