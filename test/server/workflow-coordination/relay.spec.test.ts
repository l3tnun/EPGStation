import { describe, expect, it, vi } from 'vitest';

import { deferred, flushImmediate, makeReserve, makeSetter } from '../event-and-hook-delivery/_harness';

const candidate = (programId: number) => ({ parentReserve: makeReserve({ id: programId + 1_000 }), programId });

describe('EventSetter relay workflow contract', () => {
    it('[PRIMARY WC-4.2][PRIMARY WC-4.3][WC-4.2][WC-4.3] records duplicate and rejected candidates once, then starts each later candidate in input order', async () => {
        const first = deferred<number | null>();
        const duplicate = deferred<number | null>();
        const rejected = deferred<number | null>();
        const failure = new Error('synthetic relay rejection');
        const unhandled: unknown[] = [];
        const recordUnhandled = (reason: unknown) => unhandled.push(reason);
        const harness = makeSetter();
        const candidates = [candidate(101), candidate(102), candidate(103)];
        const ledger: string[] = [];
        const results = [first.promise, duplicate.promise, rejected.promise];
        harness.reservationManage.addEventRelay.mockImplementation((programId: number) => {
            ledger.push(`start:${programId}`);
            return results.shift();
        });
        harness.setter.set();
        process.prependListener('unhandledRejection', recordUnhandled);

        try {
            const settled = harness.callbacks.recording.setEventRelay(candidates);
            expect(ledger).toEqual(['start:101']);

            first.resolve(201);
            await flushImmediate();
            expect(ledger).toEqual(['start:101', 'start:102']);

            duplicate.resolve(null);
            await flushImmediate();
            expect(ledger).toEqual(['start:101', 'start:102', 'start:103']);

            rejected.reject(failure);
            await expect(settled).resolves.toBeUndefined();
            await flushImmediate();

            expect(harness.reservationManage.addEventRelay.mock.calls).toEqual([
                [101, candidates[0].parentReserve],
                [102, candidates[1].parentReserve],
                [103, candidates[2].parentReserve],
            ]);
            expect(harness.logger.system.error.mock.calls).toEqual([
                [expect.objectContaining({ message: 'event relay duplicate: 102' })],
                [expect.objectContaining({ cause: failure, message: 'event relay failed: 103' })],
            ]);
            expect(unhandled).toEqual([]);
        } finally {
            process.removeListener('unhandledRejection', recordUnhandled);
        }
    });

    it('[WC-4.3] records a synchronous candidate failure and continues with the next candidate', async () => {
        const failure = new Error('synthetic relay synchronous failure');
        const harness = makeSetter();
        const candidates = [candidate(201), candidate(202)];
        harness.reservationManage.addEventRelay.mockImplementation((programId: number) => {
            if (programId === 201) throw failure;
            return 301;
        });
        harness.setter.set();

        await expect(harness.callbacks.recording.setEventRelay(candidates)).resolves.toBeUndefined();

        expect(harness.reservationManage.addEventRelay.mock.calls).toEqual([
            [201, candidates[0].parentReserve],
            [202, candidates[1].parentReserve],
        ]);
        expect(harness.logger.system.error.mock.calls).toEqual([
            [expect.objectContaining({ cause: failure, message: 'event relay failed: 201' })],
        ]);
    });
});
