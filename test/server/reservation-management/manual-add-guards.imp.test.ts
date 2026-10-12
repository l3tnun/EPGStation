import { describe, expect, it, vi } from 'vitest';
import { makeModel, makeReserve } from './_harness';

describe('manual reservation add guards', () => {
    it('[RM-4.2] publishes the event relay insertion with log output not suppressed', async () => {
        const program = makeReserve({ id: 90, programId: 90 });
        const harness = makeModel({ programDB: { findId: vi.fn(async () => program), findRule: vi.fn() } });
        harness.model.setTuners([{ types: ['GR'] }]);

        await harness.model.addEventRelay(90, makeReserve({ ruleId: 7 }));

        expect(harness.reserveEvent.emitUpdated).toHaveBeenCalledOnce();
        expect(harness.reserveEvent.emitUpdated.mock.calls[0][0].isSuppressLog).toBe(false);
    });

    it('[RM-2.1] keeps the reserved-program error as the cause of the check failure', async () => {
        const harness = makeModel();
        harness.reserveDB.findProgramId.mockResolvedValue([makeReserve()]);

        const error = await harness.model.createManualReserveWithProgramId({ programId: 101 }).catch((e: Error) => e);

        expect(error.message).toBe('ReservationManageModelCheckReservedProgramError');
        expect((error.cause as Error).message).toBe('ReservationManageModelReservedError');
    });

    it('[RM-2.3] refuses to build a time-specified reservation when a program id is given', async () => {
        const harness = makeModel({
            channelDB: { findId: vi.fn(async () => ({ id: 10, channel: 'synthetic-channel', channelType: 'GR' })) },
        });

        await expect(
            harness.model.createManualReserveWithSpecifiedTime({
                allowEndLack: false,
                programId: 5,
                timeSpecifiedOption: {
                    channelId: 10,
                    startAt: Date.now() + 60_000,
                    endAt: Date.now() + 120_000,
                    name: 'synthetic-time-manual',
                },
            }),
        ).rejects.toThrow('TimeSpecifiedOptionIsUndefined');
        expect(harness.reserveDB.findTimeSpecification).not.toHaveBeenCalled();
    });

    it('[RM-2.3] refuses to build a time-specified reservation without the time option', async () => {
        const harness = makeModel();

        await expect(harness.model.createManualReserveWithSpecifiedTime({ allowEndLack: false })).rejects.toThrow(
            'TimeSpecifiedOptionIsUndefined',
        );
        expect(harness.reserveDB.findTimeSpecification).not.toHaveBeenCalled();
    });
});
