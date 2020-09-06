export interface StorageInfo {
    name: string;
    available: string;
    used: string;
    total: string;
    useRate: number;
}

export default interface IStorageState {
    clearData(): void;
    fetchData(): Promise<void>;
    getInfos(): StorageInfo[];
}
