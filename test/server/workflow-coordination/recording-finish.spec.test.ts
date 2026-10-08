import { describe, expect, it, vi } from 'vitest';

import {
    deferred,
    flushImmediate,
    makeLogger,
    makeRecorded,
    makeReserve,
    makeSetter,
    RecordingEvent,
} from '../event-and-hook-delivery/_harness';

describe('EventSetter recording completion contract', () => {
    it.each([
        ['does not need cleanup', makeReserve({ id: 301, ruleId: 801 }), false, [], []],
        ['is a manual reservation', makeReserve({ id: 302, ruleId: null }), true, [302], []],
        ['is an event relay reservation', makeReserve({ id: 303, ruleId: 803, isEventRelay: true }), true, [303], []],
        ['is a normal Rule reservation', makeReserve({ id: 304, ruleId: 804 }), true, [], [804]],
    ] as const)(
        '[PRIMARY WC-3.1][PRIMARY WC-3.2][WC-3.1][WC-3.2][WC-3.8] selects only the required reservation cleanup when %s',
        async (_label, reserve, needsDeleteReservation, cancelledReservationIds, updatedRuleIds) => {
            const ledger: string[] = [];
            const recorded = makeRecorded({ id: 305, videoFiles: [] });
            const harness = makeSetter();
            harness.reservationManage.cancel.mockImplementation(reservationId => {
                ledger.push(`cancel:${reservationId}`);
                return Promise.resolve();
            });
            harness.reservationManage.updateRule.mockImplementation(ruleId => {
                ledger.push(`rule:${ruleId}`);
                return Promise.resolve();
            });
            harness.externalCommandManage.addRecordingFinishCmd.mockImplementation(() => ledger.push('hook'));
            harness.ipc.notifyClient.mockImplementation(() => ledger.push('ui'));
            harness.setter.set();

            await expect(
                harness.callbacks.recording.setFinishRecording(reserve, recorded, needsDeleteReservation),
            ).resolves.toBeUndefined();

            expect(harness.reservationManage.cancel.mock.calls).toEqual(
                cancelledReservationIds.map(reservationId => [reservationId]),
            );
            expect(harness.reservationManage.updateRule.mock.calls).toEqual(updatedRuleIds.map(ruleId => [ruleId]));
            expect(harness.thumbnailManage.add).not.toHaveBeenCalled();
            expect(harness.ipc.setEncode).not.toHaveBeenCalled();
            expect(ledger).toEqual([
                ...cancelledReservationIds.map(reservationId => `cancel:${reservationId}`),
                ...updatedRuleIds.map(ruleId => `rule:${ruleId}`),
                'hook',
                'ui',
            ]);
        },
    );

    it.each([
        ['no source video', [], ['0', '1', '3'], []],
        ['one source video with no Encode mode', [{ id: 501 }], [null, null, null], []],
        ['one source video with mode value 0', [{ id: 501 }], ['0', null, null], ['0']],
        ['one source video with mode value 1', [{ id: 501 }], ['1', null, null], ['1']],
        ['one source video with mode value 3', [{ id: 501 }], ['3', null, null], ['3']],
        ['one source video with mode value 4', [{ id: 501 }], ['4', null, null], ['4']],
        [
            'multiple source videos with all existing slots',
            [{ id: 501 }, { id: 502 }],
            ['0', '1', '4'],
            ['0', '1', '4'],
        ],
    ] as const)(
        '[PRIMARY WC-3.3][PRIMARY WC-3.4][WC-3.3][WC-3.4][WC-3.8] starts Thumbnail and at most the three existing Encode slots for %s',
        async (_label, videoFiles, modes, expectedModes) => {
            const ledger: string[] = [];
            const reserve = makeReserve({
                encodeMode1: modes[0],
                encodeMode2: modes[1],
                encodeMode3: modes[2],
                id: 306,
            });
            const recorded = makeRecorded({ id: 307, videoFiles });
            const harness = makeSetter();
            harness.thumbnailManage.add.mockImplementation(videoFileId => ledger.push(`thumbnail:${videoFileId}`));
            harness.ipc.setEncode.mockImplementation(option => ledger.push(`encode:${option.mode}`));
            harness.externalCommandManage.addRecordingFinishCmd.mockImplementation(() => ledger.push('hook'));
            harness.ipc.notifyClient.mockImplementation(() => ledger.push('ui'));
            harness.setter.set();

            await expect(
                harness.callbacks.recording.setFinishRecording(reserve, recorded, false),
            ).resolves.toBeUndefined();

            expect(harness.thumbnailManage.add.mock.calls).toEqual(videoFiles.length === 0 ? [] : [[501]]);
            expect(harness.ipc.setEncode.mock.calls).toEqual(
                expectedModes.map(mode => [
                    {
                        directory: undefined,
                        mode,
                        parentDir: 'synthetic-root',
                        recordedId: 307,
                        removeOriginal: false,
                        sourceVideoFileId: 501,
                    },
                ]),
            );
            expect(ledger).toEqual([
                ...(videoFiles.length === 0 ? [] : ['thumbnail:501']),
                ...expectedModes.map(mode => `encode:${mode}`),
                'hook',
                'ui',
            ]);
        },
    );

    it('[PRIMARY WC-3.5][PRIMARY WC-3.6][PRIMARY WC-3.8][WC-3.5][WC-3.6][WC-3.8] starts detached completion actions before sequentially awaiting Tags and final delivery', async () => {
        const cancellation = deferred<void>();
        const firstRelation = deferred<void>();
        const secondRelation = deferred<void>();
        const ledger: string[] = [];
        const reserve = makeReserve({
            id: 308,
            encodeMode1: '0',
            encodeMode2: '1',
            encodeMode3: '4',
            tags: '[701,702]',
        });
        const recorded = makeRecorded({ id: 309, videoFiles: [{ id: 503 }, { id: 504 }] });
        const harness = makeSetter();
        harness.reservationManage.cancel.mockImplementation(() => {
            ledger.push('cancel');
            return cancellation.promise;
        });
        harness.thumbnailManage.add.mockImplementation(videoFileId => ledger.push(`thumbnail:${videoFileId}`));
        harness.ipc.setEncode.mockImplementation(option => ledger.push(`encode:${option.mode}`));
        harness.recordedTagManage.setRelation.mockImplementation(tagId => {
            ledger.push(`tag:${tagId}`);
            return tagId === 701 ? firstRelation.promise : secondRelation.promise;
        });
        harness.externalCommandManage.addRecordingFinishCmd.mockImplementation(() => ledger.push('hook'));
        harness.ipc.notifyClient.mockImplementation(() => ledger.push('ui'));
        harness.setter.set();

        const completion = harness.callbacks.recording.setFinishRecording(reserve, recorded, true);

        expect(ledger).toEqual(['cancel', 'thumbnail:503', 'encode:0', 'encode:1', 'encode:4', 'tag:701']);
        expect(harness.externalCommandManage.addRecordingFinishCmd).not.toHaveBeenCalled();
        expect(harness.ipc.notifyClient).not.toHaveBeenCalled();

        firstRelation.resolve();
        await flushImmediate();
        expect(ledger).toEqual(['cancel', 'thumbnail:503', 'encode:0', 'encode:1', 'encode:4', 'tag:701', 'tag:702']);

        secondRelation.resolve();
        await expect(completion).resolves.toBeUndefined();
        expect(ledger).toEqual([
            'cancel',
            'thumbnail:503',
            'encode:0',
            'encode:1',
            'encode:4',
            'tag:701',
            'tag:702',
            'hook',
            'ui',
        ]);

        cancellation.resolve();
        await flushImmediate();
        expect(harness.logger.system.error).not.toHaveBeenCalled();
    });

    it('[WC-3.7][WC-3.8] records one aggregate Tag parse failure without relations, then continues to final delivery', async () => {
        const ledger: string[] = [];
        const reserve = makeReserve({ id: 310, tags: '[' });
        const recorded = makeRecorded({ id: 311, videoFiles: [] });
        const harness = makeSetter();
        harness.externalCommandManage.addRecordingFinishCmd.mockImplementation(() => ledger.push('hook'));
        harness.ipc.notifyClient.mockImplementation(() => ledger.push('ui'));
        harness.setter.set();

        await expect(harness.callbacks.recording.setFinishRecording(reserve, recorded, false)).resolves.toBeUndefined();

        expect(harness.recordedTagManage.setRelation).not.toHaveBeenCalled();
        expect(ledger).toEqual(['hook', 'ui']);
        expect(harness.logger.system.error.mock.calls).toEqual([
            ['reserve tags parese error: ['],
            [expect.any(SyntaxError)],
        ]);
    });

    it('[PRIMARY WC-3.7][PRIMARY WC-7.11][WC-3.7][WC-3.8][WC-7.3][WC-7.11] records a rejected Tag relation, continues its sequence, and still attempts Hook then UI', async () => {
        const relationFailure = new Error('synthetic finish Tag relation rejection');
        const hookFailure = new Error('synthetic finish Hook rejection');
        const unhandled: unknown[] = [];
        const recordUnhandled = (reason: unknown): void => unhandled.push(reason);
        const ledger: string[] = [];
        const reserve = makeReserve({ id: 312, tags: '[703,704]' });
        const recorded = makeRecorded({ id: 313, videoFiles: [] });
        const harness = makeSetter();
        harness.recordedTagManage.setRelation.mockImplementation(tagId => {
            ledger.push(`tag:${tagId}`);
            return tagId === 703 ? Promise.reject(relationFailure) : Promise.resolve();
        });
        harness.externalCommandManage.addRecordingFinishCmd.mockImplementation(() => Promise.reject(hookFailure));
        harness.ipc.notifyClient.mockImplementation(() => ledger.push('ui'));
        harness.setter.set();
        process.prependListener('unhandledRejection', recordUnhandled);

        try {
            await expect(
                harness.callbacks.recording.setFinishRecording(reserve, recorded, false),
            ).resolves.toBeUndefined();
            await flushImmediate();

            expect(harness.recordedTagManage.setRelation.mock.calls).toEqual([
                [703, 313],
                [704, 313],
            ]);
            expect(ledger).toEqual(['tag:703', 'tag:704', 'ui']);
            expect(harness.externalCommandManage.addRecordingFinishCmd).toHaveBeenCalledExactlyOnceWith(recorded);
            expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
            expect(harness.logger.system.error.mock.calls).toEqual([[relationFailure], [hookFailure]]);
            expect(unhandled).toEqual([]);
        } finally {
            process.removeListener('unhandledRejection', recordUnhandled);
        }
    });

    it.each([
        ['manual cancellation', 'manual', 'throws synchronously'],
        ['event relay cancellation', 'relay', 'throws synchronously'],
        ['Rule recalculation', 'rule', 'throws synchronously'],
        ['manual cancellation', 'manual', 'rejects asynchronously'],
        ['event relay cancellation', 'relay', 'rejects asynchronously'],
        ['Rule recalculation', 'rule', 'rejects asynchronously'],
    ] as const)(
        '[WC-3.1][WC-3.2][WC-3.6][WC-3.8][WC-7.3][WC-7.7][WC-7.11] isolates a %s cleanup that %s',
        async (_label, reservationKind, failureMode) => {
            const failure = new Error(`synthetic ${reservationKind} completion cleanup ${failureMode}`);
            const unhandled: unknown[] = [];
            const recordUnhandled = (reason: unknown): void => unhandled.push(reason);
            const ledger: string[] = [];
            const retry = vi.fn();
            const rollback = vi.fn();
            const queue = vi.fn();
            const recordingManage = { acceptMutation: vi.fn(), queue, retry, rollback, update: vi.fn() };
            const reserve =
                reservationKind === 'manual'
                    ? makeReserve({ id: 314, ruleId: null, tags: '[705]' })
                    : reservationKind === 'relay'
                      ? makeReserve({ id: 315, isEventRelay: true, ruleId: 815, tags: '[705]' })
                      : makeReserve({ id: 316, ruleId: 816, tags: '[705]' });
            const recorded = makeRecorded({ id: 317, videoFiles: [] });
            const harness = makeSetter({ recordingManage });
            const failCleanup = (label: string) => {
                ledger.push(label);
                if (failureMode === 'throws synchronously') throw failure;
                return Promise.reject(failure);
            };
            if (reservationKind === 'rule') {
                harness.reservationManage.updateRule.mockImplementation(() => failCleanup('rule'));
            } else {
                harness.reservationManage.cancel.mockImplementation(() => failCleanup('cancel'));
            }
            harness.recordedTagManage.setRelation.mockImplementation(tagId => {
                ledger.push(`tag:${tagId}`);
                return Promise.resolve();
            });
            harness.externalCommandManage.addRecordingFinishCmd.mockImplementation(() => ledger.push('hook'));
            harness.ipc.notifyClient.mockImplementation(() => ledger.push('ui'));
            harness.setter.set();
            process.prependListener('unhandledRejection', recordUnhandled);

            try {
                await expect(
                    harness.callbacks.recording.setFinishRecording(reserve, recorded, true),
                ).resolves.toBeUndefined();
                await flushImmediate();

                if (reservationKind === 'rule') {
                    expect(harness.reservationManage.updateRule).toHaveBeenCalledExactlyOnceWith(816);
                    expect(harness.reservationManage.cancel).not.toHaveBeenCalled();
                } else {
                    expect(harness.reservationManage.cancel).toHaveBeenCalledExactlyOnceWith(reserve.id);
                    expect(harness.reservationManage.updateRule).not.toHaveBeenCalled();
                }
                expect(ledger).toEqual([reservationKind === 'rule' ? 'rule' : 'cancel', 'tag:705', 'hook', 'ui']);
                expect(harness.logger.system.error.mock.calls).toEqual([[failure]]);
                expect(retry).not.toHaveBeenCalled();
                expect(rollback).not.toHaveBeenCalled();
                expect(queue).not.toHaveBeenCalled();
                expect(unhandled).toEqual([]);
            } finally {
                process.removeListener('unhandledRejection', recordUnhandled);
            }
        },
    );

    it.each([
        ['Thumbnail', undefined, ['cancel', 'thumbnail']],
        ['Encode mode 1', 'mode-one', ['cancel', 'thumbnail', 'encode:mode-one']],
        ['Encode mode 2', 'mode-two', ['cancel', 'thumbnail', 'encode:mode-one', 'encode:mode-two']],
        [
            'Encode mode 3',
            'mode-three',
            ['cancel', 'thumbnail', 'encode:mode-one', 'encode:mode-two', 'encode:mode-three'],
        ],
    ] as const)(
        '[PRIMARY WC-3.9][PRIMARY WC-3.10][PRIMARY WC-7.7][WC-3.9][WC-3.10][WC-7.3][WC-7.7][WC-7.11] records a synchronous %s failure without rolling back its prior completion prefix',
        async (failurePosition, throwingEncodeMode, expectedPrefix) => {
            const failure = new Error(`synthetic ${failurePosition} synchronous failure`);
            const unhandled: unknown[] = [];
            const recordUnhandled = (reason: unknown): void => unhandled.push(reason);
            const logger = makeLogger();
            const recordingEvent = new RecordingEvent({ getLogger: () => logger });
            const ledger: string[] = [];
            const rollback = vi.fn();
            const retry = vi.fn();
            const queue = vi.fn();
            const recordingManage = { acceptMutation: vi.fn(), queue, retry, rollback, update: vi.fn() };
            const reserve = makeReserve({
                id: 318,
                encodeMode1: 'mode-one',
                encodeMode2: 'mode-two',
                encodeMode3: 'mode-three',
                tags: '[706]',
            });
            const recorded = makeRecorded({ id: 319, videoFiles: [{ id: 505 }] });
            const harness = makeSetter({ logger, recordingEvent, recordingManage });
            harness.reservationManage.cancel.mockImplementation(() => {
                ledger.push('cancel');
                return Promise.resolve();
            });
            harness.thumbnailManage.add.mockImplementation(() => {
                ledger.push('thumbnail');
                if (failurePosition === 'Thumbnail') throw failure;
            });
            harness.ipc.setEncode.mockImplementation(option => {
                ledger.push(`encode:${option.mode}`);
                if (option.mode === throwingEncodeMode) throw failure;
            });
            harness.recordedTagManage.setRelation.mockImplementation(() => ledger.push('tag'));
            harness.externalCommandManage.addRecordingFinishCmd.mockImplementation(() => ledger.push('hook'));
            harness.ipc.notifyClient.mockImplementation(() => ledger.push('ui'));
            harness.setter.set();
            process.prependListener('unhandledRejection', recordUnhandled);

            try {
                expect(recordingEvent.emitFinishRecording(reserve, recorded, true)).toBeUndefined();
                await flushImmediate();

                expect(ledger).toEqual(expectedPrefix);
                expect(harness.reservationManage.cancel).toHaveBeenCalledExactlyOnceWith(318);
                expect(harness.recordedTagManage.setRelation).not.toHaveBeenCalled();
                expect(harness.externalCommandManage.addRecordingFinishCmd).not.toHaveBeenCalled();
                expect(harness.ipc.notifyClient).not.toHaveBeenCalled();
                expect(logger.system.error.mock.calls).toEqual([[failure]]);
                expect(rollback).not.toHaveBeenCalled();
                expect(retry).not.toHaveBeenCalled();
                expect(queue).not.toHaveBeenCalled();
                expect(unhandled).toEqual([]);
            } finally {
                process.removeListener('unhandledRejection', recordUnhandled);
            }
        },
    );
});
