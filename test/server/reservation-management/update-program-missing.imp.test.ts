import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeModel, makeReserve } from './_harness';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('[RM-9.2] manual reservation update when the program no longer exists', () => {
    it('warns, changes nothing, and releases the execution right when the reserved program row is gone', async () => {
        const harness = makeModel({
            programDB: { findId: vi.fn(async () => null), findRule: vi.fn(async () => []) },
        });
        harness.reserveDB.findId.mockResolvedValue(makeReserve({ id: 23, programId: 103, programUpdateTime: 5 }));

        await expect(harness.model.update(23)).resolves.toBeUndefined();

        expect(harness.programDB.findId).toHaveBeenCalledExactlyOnceWith(103);
        expect(harness.log.system.warn).toHaveBeenCalledWith('program is not found: 23');
        expect(harness.reserveDB.findTimeRanges).not.toHaveBeenCalled();
        expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
        expect(harness.ledger).toEqual(['lock', 'unlock']);
    });
});
