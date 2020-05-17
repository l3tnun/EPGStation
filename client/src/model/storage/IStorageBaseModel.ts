export default interface IStorageBaseModel<T> {
    tmp: T;

    getSavedValue(): T;
    resetTmpValue(): void;
    save(): void;

    /**
     * 各継承クラスで実装する
     */
    getDefaultValue(): T;
    getStorageKey(): string;
}
