import { describe, expect, it, vi } from 'vitest';
import { makeModel, makeReserve } from './_harness';

describe('pre-fix-relay-race-lock-leaks-timeout-waiter-and-wire-gaps', () => {
    it('[RM-C06/RM-2.3] refreshes updateTime when a manual reservation is edited', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(456_000);
        const row = makeReserve({ updateTime: 123 });
        const harness = makeModel();
        harness.reserveDB.findId.mockResolvedValue(row);
        try {
            await harness.model.edit(1, { allowEndLack: true });
            expect(row.updateTime).toBe(456_000);
        } finally {
            vi.useRealTimers();
        }
    });

    it('[RM-C07/RM-2.3] rejects a future inverted interval through public add()', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const harness = makeModel({
            channelDB: { findId: vi.fn(async () => ({ id: 1, channel: 'synthetic-new', channelType: 'GR' })) },
        });
        harness.model.setTuners([{ types: ['GR'] }]);
        try {
            await expect(
                harness.model.add({
                    allowEndLack: false,
                    timeSpecifiedOption: {
                        channelId: 1,
                        startAt: 1_003_000,
                        endAt: 1_002_000,
                        name: 'synthetic-inverted',
                    },
                }),
            ).rejects.toThrow('TimeSpecifiedOptionError');
            expect(harness.reserveDB.findTimeSpecification).not.toHaveBeenCalled();
            expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('[RM-C11/RM-2.3] rejects a rule row at the edit boundary before changing fields', async () => {
        const row = makeReserve({ ruleId: 12 });
        const harness = makeModel();
        harness.reserveDB.findId.mockResolvedValue(row);
        await expect(harness.model.edit(1, { allowEndLack: true })).rejects.toThrow('ReservationIsNotEditable');
        expect(row.allowEndLack).toBe(false);
        expect(harness.reserveDB.updateOnce).not.toHaveBeenCalled();
        expect(harness.ledger).toEqual(['lock', 'unlock']);
    });

    it.each(['isConflict', 'isSkip', 'isOverlap'] as const)(
        '[RM-C16/RM-2.3] applies the approved existing %s row filter through public add()',
        async state => {
            const existingExcluded = makeReserve({
                id: 70,
                programId: 70,
                channelId: 70,
                channel: 'synthetic-existing',
                [state]: true,
            });
            const program = makeReserve({ id: 71, programId: 71, channelId: 71, channel: 'synthetic-new' });
            const harness = makeModel({
                programDB: { findId: vi.fn(async () => program), findRule: vi.fn() },
            });
            harness.reserveDB.findTimeRanges.mockImplementation(async (option: any) => {
                const excluded =
                    (state === 'isSkip' && option.hasSkip === false) ||
                    (state === 'isOverlap' && option.hasOverlap === false) ||
                    (state === 'isConflict' && option.hasConflict === false);
                return excluded ? [] : [existingExcluded];
            });
            harness.model.setTuners([{ types: ['GR'] }]);
            const addition = harness.model.add({ programId: 71, allowEndLack: false });
            if (state === 'isConflict') {
                await expect(addition).rejects.toThrow('ReservationManageModelAddReserveConflict');
            } else {
                await expect(addition).resolves.toBe(41);
            }
            expect(harness.reserveDB.findTimeRanges).toHaveBeenCalledWith(
                expect.objectContaining({ hasConflict: true, hasSkip: false, hasOverlap: false }),
            );
            expect(harness.reserveDB.insertOnce).toHaveBeenCalledTimes(state === 'isConflict' ? 0 : 1);
        },
    );
});
