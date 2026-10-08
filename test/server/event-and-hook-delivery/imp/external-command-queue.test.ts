import { describe, expect, it } from 'vitest';
import { deferred, flushImmediate, PromiseQueue } from '../_harness';

describe('shared hook queue implementation characteristics', () => {
    it('runs one job at a time and continues the same chain after a rejection', async () => {
        const queue = new PromiseQueue();
        const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
        const ledger: string[] = [];
        const attempts = [0, 0, 0];
        let active = 0;
        let maximumActive = 0;
        const jobs = gates.map((gate, index) =>
            queue.add(async () => {
                attempts[index] += 1;
                active += 1;
                maximumActive = Math.max(maximumActive, active);
                ledger.push(`start:${index}`);
                try {
                    await gate.promise;
                    ledger.push(`resolve:${index}`);
                } finally {
                    active -= 1;
                }
            }),
        );
        const observedRejection = jobs[1].then(
            () => undefined,
            error => error,
        );

        await flushImmediate();
        expect(ledger).toEqual(['start:0']);
        gates[0].resolve();
        await flushImmediate();
        expect(ledger).toEqual(['start:0', 'resolve:0', 'start:1']);

        const failure = new Error('synthetic queue rejection');
        gates[1].reject(failure);
        await flushImmediate();
        expect(await observedRejection).toBe(failure);
        expect(ledger).toEqual(['start:0', 'resolve:0', 'start:1', 'start:2']);

        gates[2].resolve();
        await expect(jobs[0]).resolves.toBeUndefined();
        await expect(jobs[2]).resolves.toBeUndefined();
        expect(ledger).toEqual(['start:0', 'resolve:0', 'start:1', 'start:2', 'resolve:2']);
        expect({ active, attempts, maximumActive }).toEqual({ active: 0, attempts: [1, 1, 1], maximumActive: 1 });
    });
});
