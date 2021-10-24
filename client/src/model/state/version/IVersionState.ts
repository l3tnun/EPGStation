export interface VersionInfo {
    version: string;
}

export default interface IStorageState {
    clearData(): void;
    fetchData(): Promise<void>;
    getInfo(): VersionInfo | null;
    getVersionString(): string;
}
