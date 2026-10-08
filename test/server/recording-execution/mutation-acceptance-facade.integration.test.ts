import { describe, expect, it } from 'vitest';
import { makeManager, makeReserve } from './_harness';

describe('recording mutation acceptance facade integration', () => {
    it('exposes a synchronously accepted started mutation through reservation presence', async () => {
        const harness = makeManager();
        const reserve = makeReserve({ id: 166, startAt: Date.now(), endAt: Date.now() + 60_000 });

        expect(harness.model.acceptMutation({ insert: [reserve], isSuppressLog: true })).toBeUndefined();
        for (let index = 0; index < 12; index += 1) await Promise.resolve();

        expect(harness.model.hasReserve(reserve.id)).toBe(true);
        harness.model.scheduleController.stop();
    });
});
