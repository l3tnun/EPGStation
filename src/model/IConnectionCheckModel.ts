export default interface IConnectionCheckModel {
    checkMirakurun(): Promise<void>;
    checkDB(): Promise<void>;
}
