import { describe, expect, it, vi } from 'vitest';
import { EventSetter, makeModel, makeReserve } from './_harness';

describe('event relay characterization', () => {
    it('[RM-4.2] inherits the parent rule and all recording options', async () => {
        const program = makeReserve({ id: 90, programId: 90 });
        const parent = makeReserve({
            ruleId: 7,
            tags: '["relay"]',
            directory: 'relay-dir',
            encodeMode2: 'relay-mode',
            encodeDirectory2: 'relay-encode-dir',
            isDeleteOriginalAfterEncode: true,
        });
        const harness = makeModel({ programDB: { findId: vi.fn(async () => program), findRule: vi.fn() } });
        harness.model.setTuners([{ types: ['GR'] }]);
        await expect(harness.model.addEventRelay(90, parent)).resolves.toBe(41);
        expect(harness.reserveEvent.emitUpdated.mock.calls[0][0].insert[0]).toMatchObject({
            programId: 90,
            ruleId: 7,
            isEventRelay: true,
            tags: '["relay"]',
            directory: 'relay-dir',
            encodeMode2: 'relay-mode',
            encodeDirectory2: 'relay-encode-dir',
            isDeleteOriginalAfterEncode: true,
        });
    });

    it('[RM-4.3] returns null before taking execution rights for an existing successor', async () => {
        const harness = makeModel();
        harness.reserveDB.findProgramId.mockResolvedValue([makeReserve()]);
        await expect(harness.model.addEventRelay(101, makeReserve())).resolves.toBeNull();
        expect(harness.execution.getExecution).not.toHaveBeenCalled();
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
    });

    it('[RM-4.5] rejects a relay that conflicts with an existing conflict reservation without writing a row or event', async () => {
        const existingConflict = makeReserve({ id: 11, programId: 11, ruleId: 2, isConflict: true });
        const successor = makeReserve({ id: 102, programId: 102, ruleId: 3, channel: 'synthetic-other-channel' });
        const harness = makeModel({
            programDB: { findId: vi.fn(async () => successor), findRule: vi.fn() },
        });
        harness.reserveDB.findTimeRanges.mockResolvedValue([existingConflict]);
        harness.model.setTuners([{ types: ['GR'] }]);

        await expect(harness.model.addEventRelay(102, makeReserve({ ruleId: 3 }))).rejects.toThrow(
            'ReservationManageModelAddReserveConflict',
        );

        expect(harness.reserveDB.findTimeRanges).toHaveBeenCalledWith({
            times: [{ startAt: successor.startAt, endAt: successor.endAt }],
            hasSkip: false,
            hasConflict: true,
            hasOverlap: false,
        });
        expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
    });

    it('[RM-4.5] adds a relay while an existing conflict on another broadcast type stays a conflict', async () => {
        const bsNormal = makeReserve({
            id: 12,
            programId: 12,
            ruleId: 1,
            channelType: 'BS',
            channel: 'synthetic-bs-1',
        });
        const bsConflict = makeReserve({
            id: 13,
            programId: 13,
            ruleId: 2,
            channelType: 'BS',
            channel: 'synthetic-bs-2',
            isConflict: true,
        });
        const successor = makeReserve({ id: 103, programId: 103, channel: 'synthetic-gr' });
        const harness = makeModel({
            programDB: { findId: vi.fn(async () => successor), findRule: vi.fn() },
        });
        harness.reserveDB.findTimeRanges.mockResolvedValue([bsNormal, bsConflict]);
        harness.model.setTuners([{ types: ['GR'] }, { types: ['BS'] }]);

        await expect(harness.model.addEventRelay(103, makeReserve({ ruleId: 3 }))).resolves.toBe(41);
        expect(harness.reserveEvent.emitUpdated.mock.calls[0][0].insert[0]).toMatchObject({
            programId: 103,
            isEventRelay: true,
            isConflict: false,
        });
    });

    it('[RM-4.5] adds a relay that starts exactly when an existing conflict ends', async () => {
        const endingNormal = makeReserve({ id: 14, programId: 14, ruleId: 1, startAt: 0, endAt: 1_000 });
        const endingConflict = makeReserve({
            id: 15,
            programId: 15,
            ruleId: 2,
            channel: 'synthetic-other',
            startAt: 0,
            endAt: 1_000,
            isConflict: true,
        });
        const successor = makeReserve({ id: 104, programId: 104, startAt: 1_000, endAt: 2_000 });
        const harness = makeModel({
            programDB: { findId: vi.fn(async () => successor), findRule: vi.fn() },
        });
        harness.reserveDB.findTimeRanges.mockResolvedValue([endingNormal, endingConflict]);
        harness.model.setTuners([{ types: ['GR'] }]);

        await expect(harness.model.addEventRelay(104, makeReserve({ ruleId: 3 }))).resolves.toBe(41);
        expect(harness.reserveDB.insertOnce).toHaveBeenCalledOnce();
    });

    it('[RM-4.5] rejects a relay that would turn an existing normal reservation into a conflict', async () => {
        const lowerRule = makeReserve({ id: 16, programId: 16, ruleId: 5, channel: 'synthetic-lower-rule' });
        const successor = makeReserve({ id: 105, programId: 105, channel: 'synthetic-successor' });
        const harness = makeModel({
            programDB: { findId: vi.fn(async () => successor), findRule: vi.fn() },
        });
        harness.reserveDB.findTimeRanges.mockResolvedValue([lowerRule]);
        harness.model.setTuners([{ types: ['GR'] }]);

        await expect(harness.model.addEventRelay(105, makeReserve({ ruleId: 3 }))).rejects.toThrow(
            'ReservationManageModelAddReserveConflict',
        );
        expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
    });

    it('[RM-C02] allows two concurrent public relay additions after both prechecks observe no row', async () => {
        let releasePrechecks!: () => void;
        const bothPrechecked = new Promise<void>(resolve => {
            releasePrechecks = resolve;
        });
        let checks = 0;
        const program = makeReserve({ id: 303, programId: 303 });
        const harness = makeModel({ programDB: { findId: vi.fn(async () => program), findRule: vi.fn() } });
        harness.reserveDB.findProgramId.mockImplementation(async () => {
            checks++;
            if (checks === 2) releasePrechecks();
            await bothPrechecked;
            return [];
        });
        harness.model.setTuners([{ types: ['GR'] }]);
        await expect(
            Promise.all([
                harness.model.addEventRelay(303, makeReserve({ id: 1 })),
                harness.model.addEventRelay(303, makeReserve({ id: 2 })),
            ]),
        ).resolves.toEqual([41, 41]);
        expect(harness.reserveDB.findProgramId).toHaveBeenCalledTimes(2);
        expect(harness.reserveDB.insertOnce).toHaveBeenCalledTimes(2);
    });

    it('[RM-4.4] awaits relay candidates in input order and continues after a rejection', async () => {
        let relayHandler!: (programs: any[]) => Promise<void>;
        const event = () =>
            new Proxy(
                {},
                {
                    get: (_target, property) =>
                        property === 'setEventRelay'
                            ? (handler: typeof relayHandler) => {
                                  relayHandler = handler;
                              }
                            : vi.fn(),
                },
            );
        const recordingEvent = event();
        const calls: number[] = [];
        const reservation = {
            addEventRelay: vi.fn(async (id: number) => {
                calls.push(id);
                if (id === 1) throw new Error('synthetic relay failure');
                return id;
            }),
        };
        const logger = { system: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() } };
        const dependencies = Array.from({ length: 15 }, event);
        const setter = new EventSetter(
            { getLogger: () => logger },
            dependencies[0],
            dependencies[1],
            dependencies[2],
            dependencies[3],
            recordingEvent,
            dependencies[4],
            dependencies[5],
            dependencies[6],
            reservation,
            dependencies[7],
            dependencies[8],
            dependencies[9],
            dependencies[10],
            dependencies[11],
            dependencies[12],
            { getConfig: () => ({ recorded: [{ name: 'synthetic-recorded' }] }) },
            { setup: vi.fn() },
        );
        setter.set();
        await relayHandler([
            { programId: 1, parentReserve: makeReserve() },
            { programId: 2, parentReserve: makeReserve() },
        ]);
        expect(calls).toEqual([1, 2]);
    });

    it('[RM-4.1] attempts a relay reservation through the public successor entrypoint', async () => {
        const successor = makeReserve({ id: 104, programId: 104 });
        const harness = makeModel({ programDB: { findId: vi.fn(async () => successor), findRule: vi.fn() } });
        harness.model.setTuners([{ types: ['GR'] }]);

        await expect(harness.model.addEventRelay(104, makeReserve({ id: 103 }))).resolves.toBe(41);
        expect(harness.reserveDB.insertOnce).toHaveBeenCalledWith(
            expect.objectContaining({ programId: 104, isEventRelay: true }),
        );
    });
});
