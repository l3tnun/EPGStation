import { injectable } from 'inversify';
import Util from '../util/Util';
import IPromiseRetry, { RetryOption } from './IPromiseRetry';

@injectable()
export default class PromiseRetry implements IPromiseRetry {
    /**
     * Promise を指定回数 retry する
     * @param job retry したい Promise<T> を返す関数
     * @param option: RetryOption
     */
    public async run<T>(job: () => Promise<T>, option: RetryOption): Promise<T> {
        let error: Error | null = null;

        const cnt = typeof option === 'undefined' || typeof option.cnt === 'undefined' ? 5 : option.cnt;
        for (let i = 0; i < cnt; i++) {
            try {
                const result: T = await job();

                return result;
            } catch (err) {
                error = err;

                await Util.sleep(
                    typeof option === 'undefined' || typeof option.waitTime === 'undefined' ? 1000 : option.waitTime,
                );

                continue;
            }
        }

        if (error === null) {
            throw new Error('ExecutePromiseRetryError');
        }

        throw error;
    }
}
