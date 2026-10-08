import { describe, expect, it, vi } from 'vitest';

import { deferred, flushImmediate, makeRecorded, makeReserve, makeSetter } from '../event-and-hook-delivery/_harness';

const reservationDiff = (kind: 'delete' | 'insert' | 'update') => ({
    [kind]: [makeReserve({ id: 241 })],
    isSuppressLog: false,
});

describe('EventSetter reservation recording contract', () => {
    it.each(['insert', 'update', 'delete'] as const)(
        '[PRIMARY WC-2.1][PRIMARY WC-2.2][PRIMARY WC-2.3][PRIMARY WC-2.4][WC-2.1][WC-2.2][WC-2.3][WC-2.4] starts UI, recording acceptance, and the reservation Hook in order for %s',
        kind => {
            const calls: string[] = [];
            const harness = makeSetter();
            harness.ipc.notifyClient.mockImplementation(() => calls.push('ui'));
            harness.recordingManage.acceptMutation.mockImplementation(() => calls.push('accept'));
            harness.externalCommandManage.addUpdateReseves.mockImplementation(() => calls.push('hook'));
            harness.setter.set();

            expect(harness.callbacks.reserve.setUpdated(reservationDiff(kind))).toBeUndefined();

            expect(calls).toEqual(['ui', 'accept', 'hook']);
            expect(harness.recordingManage.update).not.toHaveBeenCalled();
        },
    );

    it('[WC-2.4][WC-7.3] records one synchronous recording-acceptance failure and still starts the Hook once', () => {
        const acceptanceFailure = new Error('synthetic reservation acceptance failure');
        const retry = vi.fn();
        const rollback = vi.fn();
        const queue = vi.fn();
        const harness = makeSetter({
            recordingManage: {
                acceptMutation: vi.fn(() => {
                    throw acceptanceFailure;
                }),
                queue,
                retry,
                rollback,
                update: vi.fn(),
            },
        });
        harness.setter.set();

        expect(harness.callbacks.reserve.setUpdated(reservationDiff('update'))).toBeUndefined();

        expect(harness.recordingManage.acceptMutation).toHaveBeenCalledOnce();
        expect(harness.externalCommandManage.addUpdateReseves).toHaveBeenCalledOnce();
        expect(harness.logger.system.error.mock.calls).toEqual([[acceptanceFailure]]);
        expect(harness.recordingManage.update).not.toHaveBeenCalled();
        expect(retry).not.toHaveBeenCalled();
        expect(rollback).not.toHaveBeenCalled();
        expect(queue).not.toHaveBeenCalled();
    });

    it.each([
        ['preparation started', 'setStartPrepRecording', 'addRecordingPrepStartCmd', false],
        ['preparation cancelled', 'setCancelPrepRecording', 'addRecordingPrepRecFailedCmd', false],
        ['preparation failed', 'setPrepRecordingFailed', 'addRecordingPrepRecFailedCmd', true],
    ] as const)(
        '[PRIMARY WC-2.5][WC-2.5][WC-2.6] starts the selected lifecycle actions in order for %s',
        (label, eventName, hookName, cancelsReservation) => {
            const ledger: string[] = [];
            const reserve = makeReserve({ id: 271 });
            const harness = makeSetter();
            harness.ipc.notifyClient.mockImplementation(() => ledger.push('ui'));
            harness.reservationManage.cancel.mockImplementation(() => {
                ledger.push('cancel');
                return Promise.resolve();
            });
            harness.externalCommandManage[hookName].mockImplementation(() => ledger.push('hook'));
            harness.setter.set();

            expect(harness.callbacks.recording[eventName](reserve)).toBeUndefined();

            expect(ledger).toEqual(cancelsReservation ? ['ui', 'cancel', 'hook'] : ['ui', 'hook']);
            if (cancelsReservation)
                expect(harness.reservationManage.cancel).toHaveBeenCalledExactlyOnceWith(reserve.id);
            else expect(harness.reservationManage.cancel).not.toHaveBeenCalled();
        },
    );

    it('[WC-2.5][WC-2.6][WC-7.3] absorbs rejected preparation cancellation and still starts the selected Hook', async () => {
        const uiFailure = new Error('synthetic preparation UI rejection');
        const cancelFailure = new Error('synthetic preparation cancellation rejection');
        const hookFailure = new Error('synthetic preparation Hook rejection');
        const unhandled: unknown[] = [];
        const recordUnhandled = (reason: unknown): void => unhandled.push(reason);
        const reserve = makeReserve({ id: 272 });
        const harness = makeSetter();
        harness.ipc.notifyClient.mockImplementation(() => Promise.reject(uiFailure));
        harness.reservationManage.cancel.mockImplementation(() => Promise.reject(cancelFailure));
        harness.externalCommandManage.addRecordingPrepRecFailedCmd.mockImplementation(() =>
            Promise.reject(hookFailure),
        );
        harness.setter.set();
        process.prependListener('unhandledRejection', recordUnhandled);

        try {
            expect(harness.callbacks.recording.setPrepRecordingFailed(reserve)).toBeUndefined();
            await flushImmediate();

            expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
            expect(harness.reservationManage.cancel).toHaveBeenCalledExactlyOnceWith(reserve.id);
            expect(harness.externalCommandManage.addRecordingPrepRecFailedCmd).toHaveBeenCalledExactlyOnceWith(reserve);
            expect(harness.logger.system.error.mock.calls).toEqual([[uiFailure], [cancelFailure], [hookFailure]]);
            expect(unhandled).toEqual([]);
        } finally {
            process.removeListener('unhandledRejection', recordUnhandled);
        }
    });

    it('[PRIMARY WC-2.6][WC-2.6][WC-7.3] absorbs a rejected retry-over cancellation without selecting delivery actions', async () => {
        const cancelFailure = new Error('synthetic retry-over cancellation rejection');
        const unhandled: unknown[] = [];
        const recordUnhandled = (reason: unknown): void => unhandled.push(reason);
        const reserve = makeReserve({ id: 273 });
        const harness = makeSetter();
        harness.reservationManage.cancel.mockImplementation(() => Promise.reject(cancelFailure));
        harness.setter.set();
        process.prependListener('unhandledRejection', recordUnhandled);

        try {
            expect(harness.callbacks.recording.setRecordingRetryOver(reserve)).toBeUndefined();
            await flushImmediate();

            expect(harness.reservationManage.cancel).toHaveBeenCalledExactlyOnceWith(reserve.id);
            expect(harness.ipc.notifyClient).not.toHaveBeenCalled();
            expect(harness.externalCommandManage.addRecordingFailedCmd).not.toHaveBeenCalled();
            expect(harness.logger.system.error.mock.calls).toEqual([[cancelFailure]]);
            expect(unhandled).toEqual([]);
        } finally {
            process.removeListener('unhandledRejection', recordUnhandled);
        }
    });

    it.each([
        ['a recorded program', makeRecorded({ id: 281 }), 1],
        ['no recorded program', null, 0],
    ] as const)(
        '[PRIMARY WC-2.10][PRIMARY WC-2.11][PRIMARY WC-2.12][WC-2.10][WC-2.11][WC-2.12] selects refresh and the expected failure Hook count for %s',
        async (_label, recorded, expectedHooks) => {
            const ledger: string[] = [];
            const reserve = makeReserve({ id: 274 });
            const harness = makeSetter();
            harness.ipc.notifyClient.mockImplementation(() => ledger.push('ui'));
            harness.externalCommandManage.addRecordingFailedCmd.mockImplementation(() => ledger.push('hook'));
            harness.setter.set();

            expect(harness.callbacks.recording.setRecordingFailed(reserve, recorded)).toBeUndefined();

            expect(ledger).toEqual(expectedHooks === 1 ? ['ui', 'hook'] : ['ui']);
            expect(harness.externalCommandManage.addRecordingFailedCmd).toHaveBeenCalledTimes(expectedHooks);
        },
    );

    it('[WC-2.9][WC-7.3] attempts a failure Hook after rejected failure refresh', async () => {
        const uiFailure = new Error('synthetic failure UI rejection');
        const hookFailure = new Error('synthetic failure Hook rejection');
        const unhandled: unknown[] = [];
        const recordUnhandled = (reason: unknown): void => unhandled.push(reason);
        const reserve = makeReserve({ id: 275 });
        const recorded = makeRecorded({ id: 282 });
        const harness = makeSetter();
        harness.ipc.notifyClient.mockImplementation(() => Promise.reject(uiFailure));
        harness.externalCommandManage.addRecordingFailedCmd.mockImplementation(() => Promise.reject(hookFailure));
        harness.setter.set();
        process.prependListener('unhandledRejection', recordUnhandled);

        try {
            expect(harness.callbacks.recording.setRecordingFailed(reserve, recorded)).toBeUndefined();
            await flushImmediate();

            expect(harness.externalCommandManage.addRecordingFailedCmd).toHaveBeenCalledExactlyOnceWith(recorded);
            expect(harness.logger.system.error.mock.calls).toEqual([[uiFailure], [hookFailure]]);
            expect(unhandled).toEqual([]);
        } finally {
            process.removeListener('unhandledRejection', recordUnhandled);
        }
    });

    it.each([
        ['a null tag value', null, []],
        ['an empty tag array', '[]', []],
        [
            'an ordered tag array',
            '[291,292]',
            [
                [291, 283],
                [292, 283],
            ],
        ],
        ['malformed tag JSON', '[', []],
    ] as const)('[PRIMARY WC-2.7][PRIMARY WC-2.9][WC-2.7][WC-2.9] completes start delivery after %s', async (_label, tags, expectedRelations) => {
        const ledger: string[] = [];
        const reserve = makeReserve({ id: 276, tags });
        const recorded = makeRecorded({ id: 283 });
        const harness = makeSetter();
        harness.recordedTagManage.setRelation.mockImplementation((tagId: number, recordedId: number) => {
            ledger.push(`tag:${tagId}`);
            return Promise.resolve(undefined);
        });
        harness.ipc.notifyClient.mockImplementation(() => ledger.push('ui'));
        harness.externalCommandManage.addRecordingStartCmd.mockImplementation(() => ledger.push('hook'));
        harness.setter.set();

        await expect(harness.callbacks.recording.setStartRecording(reserve, recorded)).resolves.toBeUndefined();

        expect(harness.recordedTagManage.setRelation.mock.calls).toEqual(expectedRelations);
        expect(ledger).toEqual([...expectedRelations.map(([tagId]) => `tag:${tagId}`), 'ui', 'hook']);
    });

    it('[WC-2.7][WC-2.9] records a non-array Tag aggregate as one parse failure before start delivery', async () => {
        const reserve = makeReserve({ id: 277, tags: 'null' });
        const recorded = makeRecorded({ id: 284 });
        const harness = makeSetter();
        harness.ipc.notifyClient.mockResolvedValue(undefined);
        harness.externalCommandManage.addRecordingStartCmd.mockResolvedValue(undefined);
        harness.setter.set();

        await expect(harness.callbacks.recording.setStartRecording(reserve, recorded)).resolves.toBeUndefined();

        expect(harness.recordedTagManage.setRelation).not.toHaveBeenCalled();
        expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
        expect(harness.externalCommandManage.addRecordingStartCmd).toHaveBeenCalledExactlyOnceWith(recorded);
        expect(harness.logger.system.error.mock.calls).toEqual([
            ['reserve tags parese error: null'],
            [expect.objectContaining({ message: 'reserve tags must be an array' })],
        ]);
        expect(harness.logger.system.fatal).not.toHaveBeenCalled();
    });

    it('[PRIMARY WC-2.8][WC-2.8][WC-2.9] records one rejected Tag relation, continues the remaining input order, then starts delivery', async () => {
        const relationFailure = new Error('synthetic Tag relation rejection');
        const ledger: string[] = [];
        const reserve = makeReserve({ id: 278, tags: '[293,294]' });
        const recorded = makeRecorded({ id: 285 });
        const harness = makeSetter();
        harness.recordedTagManage.setRelation.mockImplementation((tagId: number) => {
            ledger.push(`tag:${tagId}`);
            return tagId === 293 ? Promise.reject(relationFailure) : Promise.resolve(undefined);
        });
        harness.ipc.notifyClient.mockImplementation(() => ledger.push('ui'));
        harness.externalCommandManage.addRecordingStartCmd.mockImplementation(() => ledger.push('hook'));
        harness.setter.set();

        await expect(harness.callbacks.recording.setStartRecording(reserve, recorded)).resolves.toBeUndefined();

        expect(harness.recordedTagManage.setRelation.mock.calls).toEqual([
            [293, 285],
            [294, 285],
        ]);
        expect(ledger).toEqual(['tag:293', 'tag:294', 'ui', 'hook']);
        expect(harness.logger.system.error.mock.calls).toEqual([[relationFailure]]);
    });

    it.each(['throws synchronously', 'rejects asynchronously'] as const)(
        '[WC-2.9][WC-7.3] starts the recording-start Hook after start refresh %s',
        async mode => {
            const uiFailure = new Error(`synthetic recording-start UI ${mode}`);
            const unhandled: unknown[] = [];
            const recordUnhandled = (reason: unknown): void => unhandled.push(reason);
            const reserve = makeReserve({ id: 280, tags: '[]' });
            const recorded = makeRecorded({ id: 287 });
            const harness = makeSetter();
            harness.ipc.notifyClient.mockImplementation(() => {
                if (mode === 'throws synchronously') throw uiFailure;
                return Promise.reject(uiFailure);
            });
            harness.setter.set();
            process.prependListener('unhandledRejection', recordUnhandled);

            try {
                await expect(harness.callbacks.recording.setStartRecording(reserve, recorded)).resolves.toBeUndefined();
                await flushImmediate();

                expect(harness.externalCommandManage.addRecordingStartCmd).toHaveBeenCalledExactlyOnceWith(recorded);
                expect(harness.logger.system.error.mock.calls).toEqual([[uiFailure]]);
                expect(unhandled).toEqual([]);
            } finally {
                process.removeListener('unhandledRejection', recordUnhandled);
            }
        },
    );

    it('[WC-2.10][WC-2.11] lets a failure refresh and Hook overtake finish delivery while Tag relation is deferred', async () => {
        const relation = deferred<void>();
        const ledger: string[] = [];
        const reserve = makeReserve({ id: 279, tags: '[295]' });
        const recorded = makeRecorded({ id: 286 });
        const harness = makeSetter();
        harness.recordedTagManage.setRelation.mockImplementation(() => {
            ledger.push('tag');
            return relation.promise;
        });
        harness.ipc.notifyClient.mockImplementation(() => ledger.push('ui'));
        harness.externalCommandManage.addRecordingFailedCmd.mockImplementation(() => ledger.push('failure-hook'));
        harness.externalCommandManage.addRecordingFinishCmd.mockImplementation(() => ledger.push('finish-hook'));
        harness.setter.set();

        const finish = harness.callbacks.recording.setFinishRecording(reserve, recorded, false);
        expect(ledger).toEqual(['tag']);

        expect(harness.callbacks.recording.setRecordingFailed(reserve, recorded)).toBeUndefined();
        expect(ledger).toEqual(['tag', 'ui', 'failure-hook']);

        relation.resolve();
        await expect(finish).resolves.toBeUndefined();

        expect(ledger).toEqual(['tag', 'ui', 'failure-hook', 'finish-hook', 'ui']);
        expect(harness.reservationManage.cancel).not.toHaveBeenCalled();
        expect(harness.reservationManage.updateRule).not.toHaveBeenCalled();
    });
});
