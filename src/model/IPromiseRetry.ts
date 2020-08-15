export interface RetryOption {
    cnt?: number; // 実行回数 default 5
    waitTime?: number; // retry 時の待機時間(ms) default 1000
}

export default interface IPromiseRetry {
    run<T>(job: () => Promise<T>, option?: RetryOption): Promise<T>;
}
