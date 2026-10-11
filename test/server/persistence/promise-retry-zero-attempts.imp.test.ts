import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

interface RetryRuntime {
    run<T>(job: () => Promise<T>, option: { cnt?: number; waitTime?: number }): Promise<T>;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');
const PromiseRetry = (require(join(snapshot, 'model', 'PromiseRetry.js')) as { default: new () => RetryRuntime })
    .default;

describe('promise retry with no attempts', () => {
    it('[PERSIST-5.1] fails with a retry error and never runs the job when zero attempts are allowed', async () => {
        const job = vi.fn(async () => 1);

        const rejection = await new PromiseRetry().run(job, { cnt: 0, waitTime: 0 }).then(
            () => null,
            (error: unknown) => error,
        );

        expect(rejection).toBeInstanceOf(Error);
        expect((rejection as Error).message).toBe('ExecutePromiseRetryError');
        expect(job).not.toHaveBeenCalled();
    });

    it('[PERSIST-5.1] rethrows the last failure once every allowed attempt has failed', async () => {
        const failure = new Error('synthetic-last-failure');
        const job = vi.fn(async () => {
            throw failure;
        });

        await expect(new PromiseRetry().run(job, { cnt: 2, waitTime: 0 })).rejects.toBe(failure);
        expect(job).toHaveBeenCalledTimes(2);
    });
});
