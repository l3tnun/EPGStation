export interface IPromiseQueue {
    add<T>(job: () => Promise<T>): Promise<T>;
}
