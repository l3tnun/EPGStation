export default interface IEPGUpdateEvent {
    emitUpdated(): void;
    setUpdated(callback: () => void): void;
}
