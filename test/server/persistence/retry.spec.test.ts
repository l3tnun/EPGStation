import { createRequire } from 'node:module';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { compiledSnapshot } from './harness';

const require = createRequire(join(process.cwd(), 'package.json'));
const PromiseRetry = (
    require(join(compiledSnapshot, 'model', 'PromiseRetry.js')) as {
        default: new () => { run<T>(job: () => Promise<T>, option?: object): Promise<T> };
    }
).default;

afterEach(() => vi.useRealTimers());

// Default cnt=5 / waitTime=1000ms come from src/model/PromiseRetry.ts:15,25, which is
// byte-identical (aside from the .js import extension) to
// v2 5cf2ea383 src/model/PromiseRetry.ts:15,25.
describe('PromiseRetry current retry contract', () => {
    it.each([1, 2, 3, 4, 5])(
        '[PERSIST-3.4-SUCCESS-%i] returns at the selected attempt after one wait per failure',
        async attempt => {
            vi.useFakeTimers();
            let calls = 0;
            const job = vi.fn(async () => {
                calls += 1;
                if (calls < attempt) throw new Error(`synthetic-${calls}`);
                return `success-${calls}`;
            });
            const operation = new PromiseRetry().run(job);

            await Promise.resolve();
            expect(job).toHaveBeenCalledTimes(1);
            for (let failedAttempt = 1; failedAttempt < attempt; failedAttempt++) {
                await vi.advanceTimersByTimeAsync(999);
                expect(job).toHaveBeenCalledTimes(failedAttempt);
                await vi.advanceTimersByTimeAsync(1);
                expect(job).toHaveBeenCalledTimes(failedAttempt + 1);
            }
            await expect(operation).resolves.toBe(`success-${attempt}`);
            expect(job).toHaveBeenCalledTimes(attempt);
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it('[PERSIST-3.4-EXHAUSTED] waits after all five failures and preserves the final error identity', async () => {
        vi.useFakeTimers();
        const failures = Array.from({ length: 5 }, (_, index) => new Error(`synthetic-${index + 1}`));
        const job = vi.fn(async () => {
            throw failures[job.mock.calls.length - 1];
        });
        const operation = new PromiseRetry().run(job);
        const settlements: unknown[] = [];
        void operation.then(
            () => settlements.push('resolved'),
            error => settlements.push(error),
        );
        const rejection = expect(operation).rejects.toBe(failures[4]);

        await Promise.resolve();
        expect(job).toHaveBeenCalledTimes(1);
        for (let wait = 1; wait <= 5; wait++) {
            await vi.advanceTimersByTimeAsync(999);
            expect(job).toHaveBeenCalledTimes(Math.min(wait, 5));
            if (wait === 5) {
                expect(settlements).toEqual([]);
                expect(vi.getTimerCount()).toBe(1);
            }
            await vi.advanceTimersByTimeAsync(1);
            expect(job).toHaveBeenCalledTimes(Math.min(wait + 1, 5));
        }
        await rejection;
        expect(settlements).toEqual([failures[4]]);
        expect(job).toHaveBeenCalledTimes(5);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[PERSIST-3.4-EMPTY-OPTION] keeps the existing defaults when an empty option object is supplied', async () => {
        vi.useFakeTimers();
        const job = vi.fn().mockRejectedValueOnce(new Error('synthetic-first')).mockResolvedValueOnce('success');
        const operation = new PromiseRetry().run(job, {});

        await vi.advanceTimersByTimeAsync(999);
        expect(job).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        await expect(operation).resolves.toBe('success');
        expect(job).toHaveBeenCalledTimes(2);
    });

    it('[PERSIST-3.4-ZERO-OPTION] rejects without calling job when cnt is zero', async () => {
        const job = vi.fn(async () => 'unused');
        const operation = new PromiseRetry().run(job, { cnt: 0 });

        await expect(operation).rejects.toThrow('ExecutePromiseRetryError');
        expect(job).not.toHaveBeenCalled();
    });

    it('[PERSIST-3.4-POSITIVE-OPTION] preserves existing positive count and wait overrides', async () => {
        vi.useFakeTimers();
        const failures = [new Error('synthetic-first'), new Error('synthetic-last')];
        const job = vi.fn(async () => {
            throw failures[job.mock.calls.length - 1];
        });
        const operation = new PromiseRetry().run(job, { cnt: 2, waitTime: 7 });
        const rejection = expect(operation).rejects.toBe(failures[1]);

        await vi.advanceTimersByTimeAsync(6);
        expect(job).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(job).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(7);
        await rejection;
        expect(job).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });
});
