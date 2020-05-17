export default interface IStorageOperationModel {
    set(key: string, value: any): void;
    get(key: string): any | null;
    remove(key: string): void;
}
