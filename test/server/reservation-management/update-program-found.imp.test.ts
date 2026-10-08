import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeModel, makeReserve } from './_harness';

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Minimal Program-shaped row for setProgramToReserve / programUpdateTime comparison.
 * Not a full TypeORM entity — only fields read by the program-found update path.
 */
const makeProgram = (overrides: Record<string, unknown> = {}) =>
    ({
        id: 101,
        updateTime: 1,
        channelId: 10,
        channel: 'synthetic-channel',
        channelType: 'GR',
        startAt: 1_000,
        endAt: 2_000,
        name: 'synthetic-program',
        shortName: null,
        halfWidthName: 'synthetic-program',
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

describe('ReservationManageModel.update program-found path (unittest/imp)', () => {
    it('[R2-RM-UPDATE-PROGRAM-FOUND-NO-CHANGE] unlocks without createDiff when programUpdateTime is unchanged', async () => {
        const oldReserve = makeReserve({ id: 21, programId: 101, programUpdateTime: 5 });
        const harness = makeModel({
            programDB: {
                findId: vi.fn(async () => makeProgram({ id: 101, updateTime: 5 })),
                findRule: vi.fn(async () => []),
            },
        });
        harness.reserveDB.findId.mockResolvedValue(oldReserve);

        await expect(harness.model.update(21)).resolves.toBeUndefined();

        expect(harness.programDB.findId).toHaveBeenCalledExactlyOnceWith(101);
        expect(harness.log.system.info).toHaveBeenCalledWith('no update reservation: 21');
        expect(harness.reserveDB.findTimeRanges).not.toHaveBeenCalled();
        expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
        expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
        expect(harness.ledger).toEqual(['lock', 'unlock']);
    });

    it('[R2-RM-UPDATE-PROGRAM-FOUND] runs setProgramToReserve and createDiff when programUpdateTime changes, keeping edited recording options', async () => {
        const oldReserve = makeReserve({
            id: 22,
            programId: 102,
            programUpdateTime: 1,
            startAt: 1_000,
            endAt: 2_000,
            // Old row must be conflicted so production `newReserve.isConflict = false` is not a no-op copy.
            isConflict: true,
            isEventRelay: true,
            // Recording options edited on the manual-derived relay row; a program update must keep them (RM-2.6).
            allowEndLack: true,
            tags: '["edited"]',
            parentDirectoryName: 'edited-parent',
            directory: 'edited-directory',
            recordedFormat: 'edited-format',
            encodeMode1: 'edited-mode',
            encodeParentDirectoryName1: 'edited-encode-parent',
            encodeDirectory1: 'edited-encode-directory',
            isDeleteOriginalAfterEncode: true,
        });
        const program = makeProgram({
            id: 102,
            updateTime: 9,
            startAt: 1_100,
            endAt: 2_100,
            name: 'synthetic-updated-program',
            halfWidthName: 'synthetic-updated-program',
        });
        const harness = makeModel({
            programDB: {
                findId: vi.fn(async () => program),
                findRule: vi.fn(async () => []),
            },
        });
        harness.reserveDB.findId.mockResolvedValue(oldReserve);

        const syntheticDiff = Object.freeze({
            delete: [],
            insert: [],
            isSuppressLog: false,
            update: [{ id: 22 }],
        });
        // Keep the private createDiff body out of this residual group; still exercise the real call site.
        const createDiff = vi.fn(async () => syntheticDiff);
        harness.model.createDiff = createDiff;

        await expect(harness.model.update(22)).resolves.toBeUndefined();

        expect(harness.programDB.findId).toHaveBeenCalledExactlyOnceWith(102);
        expect(createDiff).toHaveBeenCalledOnce();
        const [findOption, newReserves, oldReserves, isSuppressLog] = createDiff.mock.calls[0] as [
            {
                excludeReserveId: number;
                hasConflict: boolean;
                hasOverlap: boolean;
                hasSkip: boolean;
                times: Array<{ endAt: number; startAt: number }>;
            },
            Array<Record<string, unknown>>,
            Array<Record<string, unknown>>,
            boolean,
        ];
        expect(findOption).toEqual({
            excludeReserveId: 22,
            hasConflict: true,
            hasOverlap: false,
            hasSkip: false,
            times: [
                { endAt: 2_000, startAt: 1_000 },
                { endAt: 2_100, startAt: 1_100 },
            ],
        });
        expect(isSuppressLog).toBe(false);
        expect(oldReserves).toEqual([oldReserve]);
        expect(oldReserve.isConflict).toBe(true);
        expect(newReserves).toHaveLength(1);
        // Deleting production line `newReserve.isConflict = false` must turn this RED.
        expect(newReserves[0]?.isConflict).toBe(false);
        expect(newReserves[0]).toMatchObject({
            id: 22,
            isConflict: false,
            isEventRelay: true,
            programId: 102,
            programUpdateTime: 9,
            startAt: 1_100,
            endAt: 2_100,
            name: 'synthetic-updated-program',
            updateTime: oldReserve.updateTime,
            allowEndLack: true,
            tags: '["edited"]',
            parentDirectoryName: 'edited-parent',
            directory: 'edited-directory',
            recordedFormat: 'edited-format',
            encodeMode1: 'edited-mode',
            encodeParentDirectoryName1: 'edited-encode-parent',
            encodeDirectory1: 'edited-encode-directory',
            isDeleteOriginalAfterEncode: true,
        });
        expect(harness.log.system.info).toHaveBeenCalledWith('successful update reservation: 22');
        expect(harness.reserveEvent.emitUpdated).toHaveBeenCalledExactlyOnceWith(syntheticDiff);
        expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
        expect(harness.ledger).toEqual(['lock', 'unlock', 'event']);
    });
});
