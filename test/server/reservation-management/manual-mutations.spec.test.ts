import { describe, expect, it, vi } from 'vitest';
import { makeModel, makeReserve, ReserveEvent } from './_harness';

// 先頭が区切りの指定は、保存先の絶対 path と見分けが付かないよう値を組み立てて渡す
const rooted = (relative: string): string => `/${relative}`;

describe('manual reservation mutation characterization', () => {
    it('[RM-2.2] adds a valid time manual and commits before unlock and event', async () => {
        const channel = { id: 10, channel: 'synthetic-channel', channelType: 'GR' };
        const harness = makeModel({ channelDB: { findId: vi.fn(async () => channel) } });
        harness.model.setTuners([{ types: ['GR'] }]);
        const id = await harness.model.add({
            allowEndLack: true,
            tags: ['synthetic'],
            timeSpecifiedOption: {
                channelId: 10,
                startAt: Date.now() + 60_000,
                endAt: Date.now() + 120_000,
                name: 'synthetic-time-manual',
            },
        });
        expect(id).toBe(41);
        expect(harness.ledger).toEqual(['lock', 'commit', 'unlock', 'event']);
        expect(harness.reserveEvent.emitUpdated.mock.calls[0][0].insert[0]).toMatchObject({
            isTimeSpecified: true,
            isEventRelay: true,
            allowEndLack: true,
            tags: '["synthetic"]',
        });
    });

    it('[RM-2.3] rejects every invalid time-manual endpoint before persistence', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        try {
            for (const [_case, startAt, endAt] of [
                ['equal endpoints', 1_002_000, 1_002_000],
                ['inverted endpoints', 1_003_000, 1_002_000],
                ['an end at now', 999_000, 1_000_000],
                ['a past end', 998_000, 999_999],
            ] as const) {
                const channelDB = {
                    findId: vi.fn(async () => ({ id: 10, channel: 'synthetic-channel', channelType: 'GR' })),
                };
                const harness = makeModel({ channelDB });
                await expect(
                    harness.model.add({
                        allowEndLack: false,
                        timeSpecifiedOption: { channelId: 10, startAt, endAt, name: 'invalid-time-manual' },
                    }),
                ).rejects.toThrow('TimeSpecifiedOptionError');
                expect(harness.reserveDB.findTimeSpecification).not.toHaveBeenCalled();
                expect(channelDB.findId).not.toHaveBeenCalled();
                expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
                expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
                expect(harness.ledger).toEqual(['lock', 'unlock']);
            }
        } finally {
            vi.useRealTimers();
        }
    });

    it('rejects a time manual with an omitted name before any lookup', async () => {
        const channelDB = { findId: vi.fn(async () => ({ id: 10, channel: 'synthetic-channel', channelType: 'GR' })) };
        const harness = makeModel({ channelDB });

        await expect(
            harness.model.add({
                allowEndLack: false,
                timeSpecifiedOption: {
                    channelId: 10,
                    startAt: Date.now() + 60_000,
                    endAt: Date.now() + 120_000,
                },
            }),
        ).rejects.toThrow('NameIsUndefinedError');
        expect(harness.reserveDB.findTimeSpecification).not.toHaveBeenCalled();
        expect(channelDB.findId).not.toHaveBeenCalled();
        expect(harness.ledger).toEqual(['lock', 'unlock']);
    });

    it('rejects a time manual when the prior-reservation lookup itself fails', async () => {
        const harness = makeModel();
        const failure = new Error('synthetic findTimeSpecification failure');
        harness.reserveDB.findTimeSpecification.mockRejectedValue(failure);

        await expect(
            harness.model.add({
                allowEndLack: false,
                timeSpecifiedOption: {
                    channelId: 10,
                    startAt: Date.now() + 60_000,
                    endAt: Date.now() + 120_000,
                    name: 'lookup-failure-time-manual',
                },
            }),
        ).rejects.toBe(failure);
        expect(harness.channelDB.findId).not.toHaveBeenCalled();
        expect(harness.ledger).toEqual(['lock', 'unlock']);
    });

    it('rejects a time manual already reserved under the same condition', async () => {
        const harness = makeModel();
        harness.reserveDB.findTimeSpecification.mockResolvedValue(makeReserve({ id: 60, isTimeSpecified: true }));

        await expect(
            harness.model.add({
                allowEndLack: false,
                timeSpecifiedOption: {
                    channelId: 10,
                    startAt: Date.now() + 60_000,
                    endAt: Date.now() + 120_000,
                    name: 'duplicate-time-manual',
                },
            }),
        ).rejects.toThrow('AddReservationConflictError');
        expect(harness.channelDB.findId).not.toHaveBeenCalled();
        expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.ledger).toEqual(['lock', 'unlock']);
    });

    it('rejects a time manual when the channel lookup itself fails', async () => {
        const failure = new Error('synthetic channel lookup failure');
        const harness = makeModel({
            channelDB: {
                findId: vi.fn(async () => {
                    throw failure;
                }),
            },
        });

        await expect(
            harness.model.add({
                allowEndLack: false,
                timeSpecifiedOption: {
                    channelId: 10,
                    startAt: Date.now() + 60_000,
                    endAt: Date.now() + 120_000,
                    name: 'channel-lookup-failure-time-manual',
                },
            }),
        ).rejects.toThrow('ReservationManageModelFindChannelError');
        expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.ledger).toEqual(['lock', 'unlock']);
    });

    it('rejects a time manual whose channel cannot be found', async () => {
        const harness = makeModel({ channelDB: { findId: vi.fn(async () => null) } });

        await expect(
            harness.model.add({
                allowEndLack: false,
                timeSpecifiedOption: {
                    channelId: 999,
                    startAt: Date.now() + 60_000,
                    endAt: Date.now() + 120_000,
                    name: 'unknown-channel-time-manual',
                },
            }),
        ).rejects.toThrow('eservationManageModelFindChannelIsNotFound');
        expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.ledger).toEqual(['lock', 'unlock']);
    });

    it('accepts a time manual that has started while its end remains in the future', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const harness = makeModel({
            channelDB: {
                findId: vi.fn(async () => ({ id: 10, channel: 'synthetic-channel', channelType: 'GR' })),
            },
        });
        harness.model.setTuners([{ types: ['GR'] }]);
        try {
            await expect(
                harness.model.add({
                    allowEndLack: false,
                    timeSpecifiedOption: {
                        channelId: 10,
                        startAt: 999_000,
                        endAt: 1_001_000,
                        name: 'in-progress-time-manual',
                    },
                }),
            ).resolves.toBe(41);
            expect(harness.reserveDB.insertOnce).toHaveBeenCalledOnce();
            expect(harness.ledger).toEqual(['lock', 'commit', 'unlock', 'event']);
        } finally {
            vi.useRealTimers();
        }
    });

    it.each(['manual', 'relay'] as const)('includes existing conflict rows when planning a %s addition', async kind => {
        // 保存済みの競合予約でも、優先順が上の手動予約はチューナーを使うものとして数える
        const existingConflict = makeReserve({
            id: 70,
            ruleId: null,
            programId: 70,
            channelId: 70,
            channel: 'synthetic-existing',
            isConflict: true,
            updateTime: 1,
        });
        const program = makeReserve({
            id: 71,
            programId: 71,
            channelId: 71,
            channel: 'synthetic-new',
        });
        const harness = makeModel({
            programDB: { findId: vi.fn(async () => program), findRule: vi.fn(async () => []) },
        });
        harness.reserveDB.findTimeRanges.mockImplementation(async (option: any) =>
            option.hasConflict === true ? [existingConflict] : [],
        );
        harness.model.setTuners([{ types: ['GR'] }]);

        const addition =
            kind === 'manual'
                ? harness.model.add({ programId: 71, allowEndLack: false })
                : harness.model.addEventRelay(71, makeReserve({ id: 69, ruleId: 4 }));
        await expect(addition).rejects.toThrow('ReservationManageModelAddReserveConflict');
        expect(harness.reserveDB.findTimeRanges).toHaveBeenCalledWith(
            expect.objectContaining({ hasConflict: true, hasSkip: false, hasOverlap: false }),
        );
        expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
        expect(harness.ledger).toEqual(['lock', 'unlock']);
    });

    it('edits supplied fields and refreshes updateTime without conflict planning', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(456_000);
        const row = makeReserve({
            name: 'unchanged-name',
            tags: '["old"]',
            directory: 'old-dir',
            encodeMode1: 'old-mode',
            updateTime: 99,
        });
        const harness = makeModel();
        harness.reserveDB.findId.mockResolvedValue(row);
        try {
            await harness.model.edit(1, { allowEndLack: true, tags: ['new'] });
            expect(row).toMatchObject({
                name: 'unchanged-name',
                allowEndLack: true,
                tags: '["new"]',
                directory: null,
                encodeMode1: null,
                updateTime: 456_000,
            });
            expect(harness.reserveDB.findTimeRanges).not.toHaveBeenCalled();
            expect(harness.ledger).toEqual(['lock', 'commit', 'unlock', 'event']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('[RM-2.6] updates allowEndLack and only supplied tags before delivering the committed edit', async () => {
        for (const [id, option, expectedTags] of [
            [1, { allowEndLack: true, tags: ['new'] }, '["new"]'],
            [2, { allowEndLack: true }, '["old"]'],
        ] as const) {
            const ledger: string[] = [];
            const event = new ReserveEvent({ getLogger: () => ({ system: { error: vi.fn() } }) });
            const delivered = vi.fn(() => ledger.push('event'));
            event.setUpdated(delivered);
            const row = makeReserve({ id, tags: '["old"]', allowEndLack: false });
            const harness = makeModel({ ledger, reserveEvent: event });
            harness.reserveDB.findId.mockResolvedValue(row);

            await harness.model.edit(id, option);

            expect(row).toMatchObject({ allowEndLack: true, tags: expectedTags });
            expect(harness.reserveDB.updateOnce).toHaveBeenCalledExactlyOnceWith(row);
            expect(ledger).toEqual(['lock', 'commit', 'unlock', 'event']);
            expect(delivered).toHaveBeenCalledExactlyOnceWith({ update: [row], isSuppressLog: false });
        }
    });

    it('[RM-2.7] clears omitted save-option fields in a supplied group before delivering the committed edit', async () => {
        const ledger: string[] = [];
        const event = new ReserveEvent({ getLogger: () => ({ system: { error: vi.fn() } }) });
        const delivered = vi.fn(() => ledger.push('event'));
        event.setUpdated(delivered);
        const row = makeReserve({
            parentDirectoryName: 'old-parent',
            directory: 'old-directory',
            recordedFormat: 'old-format',
        });
        const harness = makeModel({ ledger, reserveEvent: event });
        harness.reserveDB.findId.mockResolvedValue(row);

        await harness.model.edit(1, { allowEndLack: true, saveOption: { directory: 'new-directory' } });

        expect(row).toMatchObject({
            parentDirectoryName: null,
            directory: 'new-directory',
            recordedFormat: null,
        });
        expect(harness.reserveDB.updateOnce).toHaveBeenCalledExactlyOnceWith(row);
        expect(ledger).toEqual(['lock', 'commit', 'unlock', 'event']);
        expect(delivered).toHaveBeenCalledExactlyOnceWith({ update: [row], isSuppressLog: false });
    });

    it('[RM-2.6] applies the exact edit predicate to every manual reservation kind', async () => {
        for (const [_kind, overrides, accepted] of [
            ['program manual', {}, true],
            ['time manual', { programId: null, isTimeSpecified: true, isEventRelay: true }, true],
            ['program rule', { ruleId: 4 }, false],
            ['time rule', { ruleId: 4, programId: null, isTimeSpecified: true }, false],
            ['manual-derived relay', { isEventRelay: true }, true],
            ['rule-derived relay', { ruleId: 4, isEventRelay: true }, false],
        ] as const) {
            const row = makeReserve(overrides);
            const harness = makeModel();
            harness.reserveDB.findId.mockResolvedValue(row);

            if (accepted) {
                await expect(harness.model.edit(1, { allowEndLack: true })).resolves.toBeUndefined();
                expect(harness.reserveDB.updateOnce).toHaveBeenCalledWith(row);
                expect(harness.ledger).toEqual(['lock', 'commit', 'unlock', 'event']);
            } else {
                await expect(harness.model.edit(1, { allowEndLack: true })).rejects.toThrow('ReservationIsNotEditable');
                expect(row.allowEndLack).toBe(false);
                expect(harness.reserveDB.updateOnce).not.toHaveBeenCalled();
                expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
                expect(harness.ledger).toEqual(['lock', 'unlock']);
                expect(harness.log.system.error).toHaveBeenCalledWith(
                    'reservation is not editable manual reservation: 1',
                );
            }
            expect(harness.reserveDB.findTimeRanges).not.toHaveBeenCalled();
        }
    });

    it.each([
        ['program manual with a rule', { ruleId: 4 }],
        ['program manual without a program', { programId: null }],
        ['program manual marked time-specified', { isTimeSpecified: true }],
        ['time manual with a rule', { ruleId: 4, programId: null, isTimeSpecified: true, isEventRelay: true }],
        ['time manual without its time flag', { programId: null, isTimeSpecified: false, isEventRelay: true }],
        ['time manual without its relay flag', { programId: null, isTimeSpecified: true, isEventRelay: false }],
        ['time manual with a program', { programId: 101, isTimeSpecified: true, isEventRelay: true }],
    ] as const)('rejects the one-conjunct near miss for a %s', async (_kind, overrides) => {
        const row = makeReserve(overrides);
        const harness = makeModel();
        harness.reserveDB.findId.mockResolvedValue(row);

        await expect(harness.model.edit(1, { allowEndLack: true })).rejects.toThrow('ReservationIsNotEditable');

        expect(row.allowEndLack).toBe(false);
        expect(harness.reserveDB.updateOnce).not.toHaveBeenCalled();
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
        expect(harness.ledger).toEqual(['lock', 'unlock']);
        expect(harness.log.system.error).toHaveBeenCalledWith('reservation is not editable manual reservation: 1');
    });

    it('[RM-2.12] deletes manual rows but keeps rule rows as skip', async () => {
        for (const [row, expected] of [
            [makeReserve({ ruleId: null }), { delete: [1] }],
            [makeReserve({ ruleId: 4 }), { update: [{ id: 1, isSkip: true }] }],
        ] as const) {
            const base = makeModel();
            base.reserveDB.findId.mockResolvedValue(row);
            await base.model.cancel(1);
            const diff = base.reserveDB.updateMany.mock.calls[0][0];
            expect(diff.delete?.map((item: any) => item.id) ?? []).toEqual(expected.delete ?? []);
            expect(diff.update?.map((item: any) => ({ id: item.id, isSkip: item.isSkip })) ?? []).toEqual(
                expected.update ?? [],
            );
        }
    });

    it('marks an overlapping rule reservation as overlap (not skip) with no conflict when cancelled', async () => {
        const row = makeReserve({ id: 2, ruleId: 4, isOverlap: true, isIgnoreOverlap: true, isConflict: true });
        const harness = makeModel();
        harness.reserveDB.findId.mockResolvedValue(row);

        await harness.model.cancel(2);

        const diff = harness.reserveDB.updateMany.mock.calls[0][0];
        expect(diff.update).toEqual([
            expect.objectContaining({
                id: 2,
                isOverlap: true,
                isIgnoreOverlap: false,
                isSkip: false,
                isConflict: false,
            }),
        ]);
    });

    it('[RM-2.1] adds a valid program manual through the public mutation', async () => {
        const program = makeReserve({ id: 80, programId: 80 });
        const harness = makeModel({ programDB: { findId: vi.fn(async () => program), findRule: vi.fn() } });
        harness.model.setTuners([{ types: ['GR'] }]);

        await expect(harness.model.add({ programId: 80, allowEndLack: false })).resolves.toBe(41);
        expect(harness.reserveEvent.emitUpdated.mock.calls[0][0].insert[0]).toMatchObject({
            programId: 80,
            ruleId: null,
            isTimeSpecified: false,
        });
    });

    it('[RM-2.4] rejects a program manual already present without inserting a second row', async () => {
        const harness = makeModel();
        harness.reserveDB.findProgramId.mockResolvedValue([makeReserve({ programId: 81 })]);

        await expect(harness.model.add({ programId: 81, allowEndLack: false })).rejects.toThrow(
            'ReservationManageModelCheckReservedProgramError',
        );
        expect(harness.execution.getExecution).toHaveBeenCalledOnce();
        expect(harness.execution.unLockExecution).toHaveBeenCalledOnce();
        expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
    });

    it('[RM-2.5] rejects a manual addition when planning would conflict with an existing reservation', async () => {
        const existingConflict = makeReserve({ id: 82, isConflict: true });
        const program = makeReserve({ id: 83, programId: 83, channel: 'synthetic-new-channel' });
        const harness = makeModel({ programDB: { findId: vi.fn(async () => program), findRule: vi.fn() } });
        harness.reserveDB.findTimeRanges.mockResolvedValue([existingConflict]);
        harness.model.setTuners([{ types: ['GR'] }]);

        await expect(harness.model.add({ programId: 83, allowEndLack: false })).rejects.toThrow(
            'ReservationManageModelAddReserveConflict',
        );
        expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
    });

    it('[RM-2.5] adds a manual reservation while an existing conflict on another broadcast type stays a conflict', async () => {
        const bsNormal = makeReserve({
            id: 84,
            programId: 84,
            ruleId: 1,
            channelType: 'BS',
            channel: 'synthetic-bs-1',
        });
        const bsConflict = makeReserve({
            id: 85,
            programId: 85,
            ruleId: 2,
            channelType: 'BS',
            channel: 'synthetic-bs-2',
            isConflict: true,
        });
        const program = makeReserve({ id: 86, programId: 86, channel: 'synthetic-gr' });
        const harness = makeModel({ programDB: { findId: vi.fn(async () => program), findRule: vi.fn() } });
        harness.reserveDB.findTimeRanges.mockResolvedValue([bsNormal, bsConflict]);
        harness.model.setTuners([{ types: ['GR'] }, { types: ['BS'] }]);

        await expect(harness.model.add({ programId: 86, allowEndLack: false })).resolves.toBe(41);
        expect(harness.reserveDB.insertOnce).toHaveBeenCalledOnce();
        expect(harness.reserveDB.insertOnce.mock.calls[0][0]).toMatchObject({ programId: 86, isConflict: false });
    });

    it('[RM-2.5] adds a manual reservation that starts exactly when an existing conflict ends', async () => {
        const endingNormal = makeReserve({ id: 87, programId: 87, ruleId: 1, startAt: 0, endAt: 1_000 });
        const endingConflict = makeReserve({
            id: 88,
            programId: 88,
            ruleId: 2,
            channel: 'synthetic-other',
            startAt: 0,
            endAt: 1_000,
            isConflict: true,
        });
        const program = makeReserve({ id: 89, programId: 89, startAt: 1_000, endAt: 2_000 });
        const harness = makeModel({ programDB: { findId: vi.fn(async () => program), findRule: vi.fn() } });
        harness.reserveDB.findTimeRanges.mockResolvedValue([endingNormal, endingConflict]);
        harness.model.setTuners([{ types: ['GR'] }]);

        await expect(harness.model.add({ programId: 89, allowEndLack: false })).resolves.toBe(41);
        expect(harness.reserveDB.insertOnce).toHaveBeenCalledOnce();
    });

    it('[RM-2.5] rejects a manual addition that would turn an existing normal rule reservation into a conflict', async () => {
        const ruleNormal = makeReserve({ id: 90, programId: 90, ruleId: 1, channel: 'synthetic-rule' });
        const program = makeReserve({ id: 91, programId: 91, channel: 'synthetic-new-channel' });
        const harness = makeModel({ programDB: { findId: vi.fn(async () => program), findRule: vi.fn() } });
        harness.reserveDB.findTimeRanges.mockResolvedValue([ruleNormal]);
        harness.model.setTuners([{ types: ['GR'] }]);

        await expect(harness.model.add({ programId: 91, allowEndLack: false })).rejects.toThrow(
            'ReservationManageModelAddReserveConflict',
        );
        expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
    });

    it('rejects add() before acquiring the mutation lock when neither program nor time option is supplied', async () => {
        const harness = makeModel();

        await expect(harness.model.add({ allowEndLack: false })).rejects.toThrow('AddReservationOptionError');

        expect(harness.execution.getExecution).not.toHaveBeenCalled();
        expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
        expect(harness.ledger).toEqual([]);
    });

    it.each([
        ['a program manual reservation', { programId: 85, allowEndLack: false }],
        [
            'a time-specified manual reservation',
            {
                allowEndLack: false,
                timeSpecifiedOption: { channelId: 1, startAt: 1, endAt: 2 },
            },
        ],
    ])(
        '[RM-2.13] rejects add() of %s whose encodeOption the shared checker rejects, before acquiring the lock',
        async (_label, option) => {
            const checkEncodeOption = vi.fn(() => false);
            const harness = makeModel({ optionChecker: { checkEncodeOption } });
            const encodeOption = { mode1: 'synthetic-unknown' };

            await expect(harness.model.add({ ...option, encodeOption } as any)).rejects.toThrow(
                'AddReservationOptionError',
            );

            expect(checkEncodeOption).toHaveBeenCalledOnce();
            expect(checkEncodeOption).toHaveBeenCalledWith(encodeOption);
            expect(harness.execution.getExecution).not.toHaveBeenCalled();
            expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
            expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
            expect(harness.ledger).toEqual([]);
        },
    );

    it('[RM-2.13] adds a program manual whose encodeOption the shared checker accepts', async () => {
        const checkEncodeOption = vi.fn(() => true);
        const program = makeReserve({ id: 86, programId: 86, channel: 'synthetic-new-channel' });
        const harness = makeModel({
            optionChecker: { checkEncodeOption },
            programDB: { findId: vi.fn(async () => program), findRule: vi.fn() },
        });
        harness.model.setTuners([{ types: ['GR'] }]);
        const encodeOption = { mode1: 'synthetic-known' };

        await expect(harness.model.add({ programId: 86, allowEndLack: false, encodeOption } as any)).resolves.toBe(41);

        expect(checkEncodeOption).toHaveBeenCalledOnce();
        expect(checkEncodeOption).toHaveBeenCalledWith(encodeOption);
        expect(harness.reserveDB.insertOnce).toHaveBeenCalledOnce();
    });

    it.each([
        ['saveOption.directory', { saveOption: { directory: '../outside' } }],
        ['saveOption.directory with a leading separator', { saveOption: { directory: rooted('../outside') } }],
        ['saveOption.directory that leaves after descending', { saveOption: { directory: 'a/../../outside' } }],
        ['saveOption.directory with a NUL character', { saveOption: { directory: 'synthetic\0directory' } }],
        ['encodeOption.directory1', { encodeOption: { mode1: 'synthetic-known', directory1: '../outside' } }],
        ['encodeOption.directory2', { encodeOption: { mode2: 'synthetic-known', directory2: '/../outside' } }],
        ['encodeOption.directory3', { encodeOption: { mode3: 'synthetic-known', directory3: 'a/../../outside' } }],
    ])(
        '[RM-2.13] rejects add() and edit() whose %s leaves the recording directory, before acquiring the lock',
        async (_label, options) => {
            const program = makeReserve({ id: 86, programId: 86, channel: 'synthetic-new-channel' });
            const harness = makeModel({ programDB: { findId: vi.fn(async () => program), findRule: vi.fn() } });
            harness.model.setTuners([{ types: ['GR'] }]);

            await expect(harness.model.add({ programId: 86, allowEndLack: false, ...options } as any)).rejects.toThrow(
                'InvalidSubDirectory',
            );
            await expect(
                harness.model.add({
                    allowEndLack: false,
                    timeSpecifiedOption: { channelId: 10, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000 },
                    ...options,
                } as any),
            ).rejects.toThrow('InvalidSubDirectory');
            await expect(harness.model.edit(1, { allowEndLack: true, ...options } as any)).rejects.toThrow(
                'InvalidSubDirectory',
            );

            expect(harness.execution.getExecution).not.toHaveBeenCalled();
            expect(harness.reserveDB.findId).not.toHaveBeenCalled();
            expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
            expect(harness.reserveDB.updateOnce).not.toHaveBeenCalled();
            expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
            expect(harness.ledger).toEqual([]);
        },
    );

    it.each([
        ['saveOption.directory a/../b', { saveOption: { directory: 'a/../b' } }, { directory: 'a/../b' }],
        ['saveOption.directory /anime', { saveOption: { directory: rooted('anime') } }, { directory: rooted('anime') }],
        [
            'encodeOption.directory1 /anime',
            { encodeOption: { mode1: 'synthetic-known', directory1: '/anime' } },
            { encodeDirectory1: '/anime' },
        ],
    ])('[RM-2.13] keeps accepting %s, which stays inside the recording directory', async (_label, options, saved) => {
        const program = makeReserve({ id: 86, programId: 86, channel: 'synthetic-new-channel' });
        const harness = makeModel({ programDB: { findId: vi.fn(async () => program), findRule: vi.fn() } });
        harness.model.setTuners([{ types: ['GR'] }]);
        const row = makeReserve();
        harness.reserveDB.findId.mockResolvedValue(row);

        await expect(harness.model.add({ programId: 86, allowEndLack: false, ...options } as any)).resolves.toBe(41);
        await expect(harness.model.edit(1, { allowEndLack: true, ...options } as any)).resolves.toBeUndefined();

        expect(harness.reserveDB.insertOnce.mock.calls[0][0]).toMatchObject(saved);
        expect(row).toMatchObject(saved);
    });

    it('rejects add() when the program-manual duplicate check itself fails', async () => {
        const harness = makeModel();
        const failure = new Error('synthetic findProgramId failure');
        harness.reserveDB.findProgramId.mockRejectedValue(failure);

        await expect(harness.model.add({ programId: 84, allowEndLack: false })).rejects.toMatchObject({
            message: 'ReservationManageModelCheckReservedProgramError',
            cause: failure,
        });
        expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.ledger).toEqual(['lock', 'unlock']);
    });

    it('rejects add() when the program lookup itself fails, without wrapping the original error', async () => {
        const failure = new Error('synthetic program lookup failure');
        const harness = makeModel({
            programDB: {
                findId: vi.fn(async () => {
                    throw failure;
                }),
                findRule: vi.fn(),
            },
        });

        await expect(harness.model.add({ programId: 85, allowEndLack: false })).rejects.toBe(failure);
        expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.ledger).toEqual(['lock', 'unlock']);
    });

    it('rejects add() when the specified program cannot be found', async () => {
        const harness = makeModel({ programDB: { findId: vi.fn(async () => null), findRule: vi.fn() } });

        await expect(harness.model.add({ programId: 86, allowEndLack: false })).rejects.toThrow('ProgramIsNotFound');
        expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.ledger).toEqual(['lock', 'unlock']);
    });

    it('projects both save and encode option groups when a program manual supplies them', async () => {
        const program = makeReserve({ id: 87, programId: 87 });
        const harness = makeModel({ programDB: { findId: vi.fn(async () => program), findRule: vi.fn() } });
        harness.model.setTuners([{ types: ['GR'] }]);

        await harness.model.add({
            programId: 87,
            allowEndLack: false,
            saveOption: { parentDirectoryName: 'p', directory: 'd', recordedFormat: 'f' },
            encodeOption: { mode1: 'm1', isDeleteOriginalAfterEncode: true },
        });

        expect(harness.reserveEvent.emitUpdated.mock.calls[0][0].insert[0]).toMatchObject({
            parentDirectoryName: 'p',
            directory: 'd',
            recordedFormat: 'f',
            encodeMode1: 'm1',
            isDeleteOriginalAfterEncode: true,
        });
    });

    it('[RM-2.8] clears all save-option fields when the save-option group is omitted', async () => {
        const row = makeReserve({ parentDirectoryName: 'parent', directory: 'directory', recordedFormat: 'format' });
        const harness = makeModel();
        harness.reserveDB.findId.mockResolvedValue(row);

        await harness.model.edit(1, { allowEndLack: true });
        expect(row).toMatchObject({ parentDirectoryName: null, directory: null, recordedFormat: null });
    });

    it('[RM-2.9] clears omitted encode fields inside a supplied encode-option group', async () => {
        const row = makeReserve({ encodeMode1: 'old-1', encodeMode2: 'old-2', encodeDirectory2: 'old-dir' });
        const harness = makeModel();
        harness.reserveDB.findId.mockResolvedValue(row);

        await harness.model.edit(1, { allowEndLack: true, encodeOption: { mode1: 'new-1' } });
        expect(row).toMatchObject({ encodeMode1: 'new-1', encodeMode2: null, encodeDirectory2: null });
    });

    it('nulls a save-option directory omitted from a supplied group', async () => {
        const row = makeReserve({ directory: 'old-directory', parentDirectoryName: 'old-parent' });
        const harness = makeModel();
        harness.reserveDB.findId.mockResolvedValue(row);

        await harness.model.edit(1, { allowEndLack: true, saveOption: { parentDirectoryName: 'kept-parent' } });
        expect(row).toMatchObject({ parentDirectoryName: 'kept-parent', directory: null });
    });

    it('nulls an encode-option mode1 omitted from a supplied group', async () => {
        const row = makeReserve({ encodeMode1: 'old-1', encodeMode2: 'old-2' });
        const harness = makeModel();
        harness.reserveDB.findId.mockResolvedValue(row);

        await harness.model.edit(1, { allowEndLack: true, encodeOption: { mode2: 'kept-2' } });
        expect(row).toMatchObject({ encodeMode1: null, encodeMode2: 'kept-2' });
    });

    it('[RM-2.10] clears every encode condition and disables original deletion when no encode option is supplied', async () => {
        const row = makeReserve({ encodeMode1: 'old-1', encodeMode2: 'old-2', isDeleteOriginalAfterEncode: true });
        const harness = makeModel();
        harness.reserveDB.findId.mockResolvedValue(row);

        await harness.model.edit(1, { allowEndLack: true });
        expect(row).toMatchObject({ encodeMode1: null, encodeMode2: null, isDeleteOriginalAfterEncode: false });
    });

    it('[RM-2.11] preserves the stored time-manual name during an edit', async () => {
        const row = makeReserve({ programId: null, isTimeSpecified: true, isEventRelay: true, name: 'stored-name' });
        const harness = makeModel();
        harness.reserveDB.findId.mockResolvedValue(row);

        await harness.model.edit(1, { allowEndLack: true });
        expect(row.name).toBe('stored-name');
    });
});
