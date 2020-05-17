export default interface IScrollPositionState {
    isNeedRestoreHistory: boolean;
    saveScrollData(data: any): void;
    getScrollData<T>(): T | null;
    updateHistoryPosition(): void;
    emitDoneGetData(): Promise<void>;
    onDoneGetData(timeout?: number): Promise<void>;
}
