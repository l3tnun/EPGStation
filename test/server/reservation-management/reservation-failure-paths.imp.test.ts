import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeModel, makeReserve } from './_harness';

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * R8 failure-path characterization against approved Requirements 5 / 8.
 * Oracle: operation result + zero DB mutation/event + exact one unlock of the acquired execution ID.
 * No new HTTP status or public contract is asserted.
 */
describe('ReservationManageModel failure-path characterization (unittest/imp)', () => {
    describe('missing target', () => {
        it.each([
            ['cancel', (model: { cancel: (id: number) => Promise<void> }) => model.cancel(999)],
            ['removeSkip', (model: { removeSkip: (id: number) => Promise<void> }) => model.removeSkip(999)],
            ['removeOverlap', (model: { removeOverlap: (id: number) => Promise<void> }) => model.removeOverlap(999)],
        ] as const)(
            '[R2-R8] %s rejects missing ReserveId with no mutation/event and exact unlock',
            async (_name, invoke) => {
                const harness = makeModel();
                harness.reserveDB.findId.mockResolvedValue(null);

                await expect(invoke(harness.model)).rejects.toMatchObject({
                    message: 'ReservationIsNotFound',
                });

                expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
                expect(harness.reserveDB.updateOnce).not.toHaveBeenCalled();
                expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
                expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
                expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
                expect(harness.ledger).toEqual(['lock', 'unlock']);
            },
        );
    });

    describe('missing target, lookup rejection', () => {
        it.each([
            ['cancel', (model: { cancel: (id: number) => Promise<void> }) => model.cancel(999)],
            ['removeSkip', (model: { removeSkip: (id: number) => Promise<void> }) => model.removeSkip(999)],
            ['removeOverlap', (model: { removeOverlap: (id: number) => Promise<void> }) => model.removeOverlap(999)],
        ] as const)(
            '[R2-R8] %s rejects a reservation lookup failure (not just a missing row) with no mutation/event and exact unlock',
            async (_name, invoke) => {
                const harness = makeModel();
                const failure = new Error('synthetic reservation lookup failure');
                harness.reserveDB.findId.mockRejectedValue(failure);

                await expect(invoke(harness.model)).rejects.toBe(failure);

                expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
                expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
                expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
                expect(harness.ledger).toEqual(['lock', 'unlock']);
            },
        );
    });

    describe('removeSkip same-program lookup', () => {
        it('[R2-R8][RM-5.3] removeSkip rejects when the same-program reservation lookup fails with no mutation/event and exact unlock', async () => {
            const harness = makeModel();
            const failure = new Error('synthetic same-program lookup failure');
            harness.reserveDB.findId.mockResolvedValue(
                makeReserve({ id: 15, ruleId: 5, programId: 205, isEventRelay: false, isSkip: true }),
            );
            harness.reserveDB.findProgramId.mockRejectedValue(failure);

            await expect(harness.model.removeSkip(15)).rejects.toBe(failure);

            expect(harness.reserveDB.findProgramId).toHaveBeenCalledExactlyOnceWith(205);
            expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
            expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
            expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
            expect(harness.ledger).toEqual(['lock', 'unlock']);
        });

        it('[RM-5.3] removeSkip on a time-specified rule reservation releases only that reservation without a same-program lookup', async () => {
            const harness = makeModel();
            harness.reserveDB.findId.mockResolvedValue(
                makeReserve({
                    id: 16,
                    ruleId: 6,
                    programId: null,
                    isTimeSpecified: true,
                    isEventRelay: false,
                    isSkip: true,
                }),
            );

            await expect(harness.model.removeSkip(16)).resolves.toBeUndefined();

            expect(harness.reserveDB.findProgramId).not.toHaveBeenCalled();
            expect(harness.reserveDB.updateMany).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({
                    update: [expect.objectContaining({ id: 16, isSkip: false })],
                    insert: [],
                    delete: [],
                }),
            );
            expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
        });
    });

    describe('invalid removeSkip / removeOverlap early returns', () => {
        it('[R2-R8] removeSkip on non-rule reservation returns without mutation/event and exact unlock', async () => {
            const harness = makeModel();
            harness.reserveDB.findId.mockResolvedValue(
                makeReserve({ id: 11, ruleId: null, isEventRelay: false, isSkip: true }),
            );

            await expect(harness.model.removeSkip(11)).resolves.toBeUndefined();

            expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
            expect(harness.reserveDB.updateOnce).not.toHaveBeenCalled();
            expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
            expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
            expect(harness.ledger).toEqual(['lock', 'unlock']);
        });

        it('[R2-R8] removeSkip when not skipped returns without mutation/event and exact unlock', async () => {
            const harness = makeModel();
            harness.reserveDB.findId.mockResolvedValue(
                makeReserve({ id: 12, ruleId: 3, isEventRelay: false, isSkip: false }),
            );

            await expect(harness.model.removeSkip(12)).resolves.toBeUndefined();

            expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
            expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
            expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
            expect(harness.ledger).toEqual(['lock', 'unlock']);
        });

        it('[R2-R8] removeOverlap on non-rule reservation returns without mutation/event and exact unlock', async () => {
            const harness = makeModel();
            harness.reserveDB.findId.mockResolvedValue(
                makeReserve({ id: 13, ruleId: null, isEventRelay: false, isOverlap: true }),
            );

            await expect(harness.model.removeOverlap(13)).resolves.toBeUndefined();

            expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
            expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
            expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
            expect(harness.ledger).toEqual(['lock', 'unlock']);
        });

        it('[R2-R8] removeOverlap when already removed returns without mutation/event and exact unlock', async () => {
            const harness = makeModel();
            harness.reserveDB.findId.mockResolvedValue(
                makeReserve({
                    id: 14,
                    ruleId: 4,
                    isEventRelay: false,
                    isIgnoreOverlap: true,
                    isOverlap: false,
                }),
            );

            await expect(harness.model.removeOverlap(14)).resolves.toBeUndefined();

            expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
            expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
            expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
            expect(harness.ledger).toEqual(['lock', 'unlock']);
        });
    });

    describe('update read / DB rejection', () => {
        it('[R2-R8] update rejects missing reserve with no mutation/event and exact unlock', async () => {
            const harness = makeModel();
            harness.reserveDB.findId.mockResolvedValue(null);

            await expect(harness.model.update(31)).rejects.toMatchObject({
                message: 'ReservationIsNotFound',
            });

            expect(harness.programDB.findId).not.toHaveBeenCalled();
            expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
            expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
            expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
            expect(harness.ledger).toEqual(['lock', 'unlock']);
        });

        it('[R2-R8] update rejects reserve read failure with no mutation/event and exact unlock', async () => {
            const harness = makeModel();
            const failure = new Error('ReserveReadFailed');
            harness.reserveDB.findId.mockRejectedValue(failure);

            await expect(harness.model.update(32)).rejects.toBe(failure);

            expect(harness.programDB.findId).not.toHaveBeenCalled();
            expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
            expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
            expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
            expect(harness.ledger).toEqual(['lock', 'unlock']);
        });

        it('[R2-R8] update rejects program read failure with no mutation/event and exact unlock', async () => {
            const harness = makeModel({
                programDB: {
                    findId: vi.fn(async () => {
                        throw new Error('ProgramReadFailed');
                    }),
                    findRule: vi.fn(async () => []),
                },
            });
            harness.reserveDB.findId.mockResolvedValue(makeReserve({ id: 33, programId: 201 }));

            await expect(harness.model.update(33)).rejects.toMatchObject({
                message: 'ProgramReadFailed',
            });

            expect(harness.programDB.findId).toHaveBeenCalledExactlyOnceWith(201);
            expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
            expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
            expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
            expect(harness.ledger).toEqual(['lock', 'unlock']);
        });

        it('[R2-R8] update rejects when reserveDB.updateMany fails after program-shaped createDiff with exact unlock and no event', async () => {
            // Program-shaped fixture with changed updateTime so production update reaches createDiff → updateMany.
            const makeProgram = (overrides: Record<string, unknown> = {}) =>
                ({
                    id: 203,
                    updateTime: 9,
                    channelId: 10,
                    channel: 'synthetic-channel',
                    channelType: 'GR',
                    startAt: 1_100,
                    endAt: 2_100,
                    name: 'synthetic-updated-program',
                    shortName: null,
                    halfWidthName: 'synthetic-updated-program',
                    description: null,
                    halfWidthDescription: null,
                    extended: null,
                    halfWidthExtended: null,
                    rawExtended: null,
                    rawHalfWidthExtended: null,
                    genre1: null,
                    subGenre1: null,
                    genre2: null,
                    subGenre2: null,
                    genre3: null,
                    subGenre3: null,
                    videoType: null,
                    videoResolution: null,
                    videoComponentType: null,
                    videoStreamContent: null,
                    audioSamplingRate: null,
                    audioComponentType: null,
                    ...overrides,
                }) as Record<string, unknown>;

            const oldReserve = makeReserve({
                id: 34,
                programId: 203,
                programUpdateTime: 1,
                startAt: 1_000,
                endAt: 2_000,
                isConflict: true,
            });
            const harness = makeModel({
                programDB: {
                    findId: vi.fn(async () => makeProgram()),
                    findRule: vi.fn(async () => []),
                },
            });
            harness.reserveDB.findId.mockResolvedValue(oldReserve);
            harness.reserveDB.findTimeRanges.mockResolvedValue([]);
            const failure = new Error('UpdateManyFailed');
            harness.reserveDB.updateMany.mockRejectedValue(failure);

            await expect(harness.model.update(34)).rejects.toBe(failure);

            expect(harness.programDB.findId).toHaveBeenCalledExactlyOnceWith(203);
            expect(harness.reserveDB.updateMany).toHaveBeenCalledOnce();
            expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
            expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
            // updateMany rejects before ledger 'commit'; event is never pushed.
            expect(harness.ledger).toEqual(['lock', 'unlock']);
        });
    });

    describe('add / addEventRelay persistence and pre-insert rejection', () => {
        it('[R2-R8] add rejects when insertOnce fails after successful validation with exact unlock and no event', async () => {
            const program = makeReserve({ id: 500, programId: 500 });
            const harness = makeModel({
                programDB: { findId: vi.fn(async () => program), findRule: vi.fn(async () => []) },
            });
            harness.model.setTuners([{ types: ['GR'] }]);
            const failure = new Error('synthetic insertOnce failure');
            harness.reserveDB.insertOnce.mockRejectedValue(failure);

            await expect(harness.model.add({ programId: 500, allowEndLack: false })).rejects.toThrow(
                'ReservationManageModelAddReserveError',
            );

            expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
            expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
            expect(harness.ledger).toEqual(['lock', 'unlock']);
        });

        it('[R2-R8] addEventRelay rejects when insertOnce fails after successful validation with exact unlock and no event', async () => {
            const program = makeReserve({ id: 501, programId: 501 });
            const harness = makeModel({
                programDB: { findId: vi.fn(async () => program), findRule: vi.fn(async () => []) },
            });
            harness.model.setTuners([{ types: ['GR'] }]);
            const failure = new Error('synthetic relay insertOnce failure');
            harness.reserveDB.insertOnce.mockRejectedValue(failure);

            await expect(harness.model.addEventRelay(501, makeReserve({ id: 44 }))).rejects.toThrow(
                'ReservationManageModelAddReserveError',
            );

            expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
            expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
            expect(harness.ledger).toEqual(['lock', 'unlock']);
        });

        it('[R2-R8] add rejects when the single-reservation conflict range lookup itself fails', async () => {
            const program = makeReserve({ id: 502, programId: 502 });
            const harness = makeModel({
                programDB: { findId: vi.fn(async () => program), findRule: vi.fn(async () => []) },
            });
            harness.model.setTuners([{ types: ['GR'] }]);
            const failure = new Error('synthetic conflict range lookup failure');
            harness.reserveDB.findTimeRanges.mockRejectedValue(failure);

            await expect(harness.model.add({ programId: 502, allowEndLack: false })).rejects.toBe(failure);

            expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
            expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
            expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
        });

        it('[R2-R8] addEventRelay rejects when the successor program cannot be found', async () => {
            const harness = makeModel({
                programDB: { findId: vi.fn(async () => null), findRule: vi.fn(async () => []) },
            });

            await expect(harness.model.addEventRelay(503, makeReserve({ id: 45 }))).rejects.toThrow(
                'ProgramIsNotFound',
            );

            expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
            expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
            expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
        });
    });

    describe('edit read / DB rejection', () => {
        it('[R2-R8] edit rejects a reservation lookup failure with no mutation/event and exact unlock', async () => {
            const harness = makeModel();
            const failure = new Error('synthetic edit lookup failure');
            harness.reserveDB.findId.mockRejectedValue(failure);

            await expect(harness.model.edit(35, { allowEndLack: true })).rejects.toBe(failure);

            expect(harness.reserveDB.updateOnce).not.toHaveBeenCalled();
            expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
            expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
        });

        it('[R2-R8] edit rejects a missing reservation with no mutation/event and exact unlock', async () => {
            const harness = makeModel();
            harness.reserveDB.findId.mockResolvedValue(null);

            await expect(harness.model.edit(36, { allowEndLack: true })).rejects.toMatchObject({
                message: 'ReservationIsNotFound',
            });

            expect(harness.reserveDB.updateOnce).not.toHaveBeenCalled();
            expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
            expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
        });

        it('[R2-R8] edit rejects when updateOnce fails with exact unlock and no event', async () => {
            const row = makeReserve({ id: 37 });
            const harness = makeModel();
            harness.reserveDB.findId.mockResolvedValue(row);
            const failure = new Error('synthetic updateOnce failure');
            harness.reserveDB.updateOnce.mockRejectedValue(failure);

            await expect(harness.model.edit(37, { allowEndLack: true })).rejects.toBe(failure);

            expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
            expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
        });
    });
});
