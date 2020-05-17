import { injectable } from 'inversify';

@injectable()
export default class PromiseQueue {
    private queue: Promise<any> = Promise.resolve(true);

    /**
     * add job
     * @param job: Promise
     * @return Promise<T>
     */
    public add<T>(job: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve: (result: T) => void, reject: (error: Error) => void) => {
            this.queue = this.queue
                .then(job)
                .then((result: T) => {
                    resolve(result);
                })
                .catch(err => {
                    reject(err);
                });
        });
    }
}
