import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
    deferred,
    flushImmediate,
    makeRecorded,
    makeReserve,
    makeSetter,
} from '../../event-and-hook-delivery/_harness';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const RecordedApiModel = (
    require(join(snapshot, 'model/api/recorded/RecordedApiModel.js')) as {
        default: { prototype: Record<string, unknown> };
    }
).default;
const ParentUserDeletionCoordinator = (
    require(join(snapshot, 'model/workflow/ParentUserDeletionCoordinator.js')) as {
        default: new (
            deletion: {
                prepareUserDeletion(recordedId: number): Promise<unknown>;
                deletePrepared(token: object): Promise<void>;
            },
            recording: {
                hasReservation(reserveId: number): boolean;
                requestCancellationForDeletion(reserveId: number): Promise<void>;
            },
        ) => { deleteFromRequest(recordedId: number): Promise<void> };
    }
).default;
const ParentVideoFileDeletionCoordinator = (
    require(join(snapshot, 'model/workflow/ParentVideoFileDeletionCoordinator.js')) as {
        default: new (
            videoDeletion: {
                prepareVideoFileDeletion(videoFileId: number): Promise<unknown>;
                deletePreparedVideoFile(token: object): Promise<unknown>;
            },
            recordedDeletion: {
                prepareUserDeletion(recordedId: number): Promise<unknown>;
                deletePrepared(token: object): Promise<void>;
            },
            recording: {
                hasReservation(reserveId: number): boolean;
                requestCancellationForDeletion(reserveId: number): Promise<void>;
            },
        ) => { deleteVideoFileFromRequest(videoFileId: number): Promise<void> };
    }
).default;
const ServiceChildUserDeletionCoordinator = (
    require(join(snapshot, 'model/workflow/ServiceChildUserDeletionCoordinator.js')) as {
        default: new (
            encoding: { cancelEncodeByRecordedId(recordedId: number): Promise<void> },
            request: { requestUserDeletion(recordedId: number): Promise<void> },
        ) => { deleteByUser(recordedId: number): Promise<void> };
    }
).default;

describe('EventSetter workflow characteristics', () => {
    it('[WC-2.1][WC-2.4] does not enter the legacy update wait path before starting the reservation Hook', () => {
        const legacyUpdate = vi.fn(() => new Promise<void>(() => undefined));
        const harness = makeSetter();
        harness.recordingManage.update.mockImplementation(legacyUpdate);
        harness.setter.set();

        expect(
            harness.callbacks.reserve.setUpdated({
                insert: [makeReserve({ id: 251 })],
                isSuppressLog: false,
            }),
        ).toBeUndefined();

        expect(harness.recordingManage.acceptMutation).toHaveBeenCalledOnce();
        expect(legacyUpdate).not.toHaveBeenCalled();
        expect(harness.externalCommandManage.addUpdateReseves).toHaveBeenCalledOnce();
    });

    it('[PRIMARY WC-1.1][WC-1.1] does not begin reservation refresh before history cleanup settles', async () => {
        const history = deferred<void>();
        const harness = makeSetter();
        harness.recordedManage.historyCleanup.mockImplementation(() => history.promise);
        harness.setter.set();

        const callback = harness.callbacks.epg.setUpdated();
        expect(harness.reservationManage.updateAll).not.toHaveBeenCalled();

        history.resolve();
        await callback;

        expect(harness.reservationManage.updateAll.mock.calls).toEqual([[true]]);
    });

    it('[WC-1.6] starts a Rule refresh while a prior refresh handoff remains pending', async () => {
        const notification = deferred<void>();
        const update = deferred<void>();
        const harness = makeSetter();
        harness.ipc.notifyClient.mockImplementation(() => notification.promise);
        harness.reservationManage.updateRule.mockImplementation(() => update.promise);
        harness.setter.set();

        expect(harness.callbacks.rule.setAdded(81)).toBeUndefined();
        expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
        expect(harness.reservationManage.updateRule.mock.calls).toEqual([[81]]);

        notification.resolve();
        update.resolve();
        await flushImmediate();
        expect(harness.logger.system.error).not.toHaveBeenCalled();
    });

    it('[WC-4.4] starts an upload thumbnail while refresh remains pending', async () => {
        const notification = deferred<void>();
        const harness = makeSetter();
        harness.ipc.notifyClient.mockImplementation(() => notification.promise);
        harness.setter.set();

        expect(harness.callbacks.recordedEvent.setAddUploadedVideoFile(91, true)).toBeUndefined();
        expect(harness.thumbnailManage.add.mock.calls).toEqual([[91]]);

        notification.resolve();
        await flushImmediate();
        expect(harness.logger.system.error).not.toHaveBeenCalled();
    });

    it('[PRIMARY WC-4.1][WC-4.1] waits for each relay candidate settlement before starting the next candidate', async () => {
        const first = deferred<number | null>();
        const second = deferred<number | null>();
        const candidates = [
            { parentReserve: makeReserve({ id: 101 }), programId: 101 },
            { parentReserve: makeReserve({ id: 102 }), programId: 102 },
        ];
        const results = [first.promise, second.promise];
        const harness = makeSetter();
        harness.reservationManage.addEventRelay.mockImplementation(() => results.shift());
        harness.setter.set();

        const settled = harness.callbacks.recording.setEventRelay(candidates);
        expect(harness.reservationManage.addEventRelay.mock.calls).toEqual([[101, candidates[0].parentReserve]]);

        first.resolve(201);
        await flushImmediate();
        expect(harness.reservationManage.addEventRelay.mock.calls).toEqual([
            [101, candidates[0].parentReserve],
            [102, candidates[1].parentReserve],
        ]);

        second.resolve(202);
        await expect(settled).resolves.toBeUndefined();
        expect(harness.logger.system.error).not.toHaveBeenCalled();
    });

    it('[PRIMARY WC-2.13][WC-2.13] leaves lifecycle state and retry decisions with the recording owner', async () => {
        const recordingManage = {
            acceptMutation: vi.fn(),
            evaluate: vi.fn(),
            retry: vi.fn(),
            transition: vi.fn(),
            update: vi.fn(),
        };
        const reserve = makeReserve({ id: 287, tags: '[]' });
        const recorded = makeRecorded({ id: 288 });
        const harness = makeSetter({ recordingManage });
        harness.recordedTagManage.setRelation.mockResolvedValue(undefined);
        harness.setter.set();

        expect(harness.callbacks.recording.setStartPrepRecording(reserve)).toBeUndefined();
        expect(harness.callbacks.recording.setCancelPrepRecording(reserve)).toBeUndefined();
        expect(harness.callbacks.recording.setPrepRecordingFailed(reserve)).toBeUndefined();
        await expect(harness.callbacks.recording.setStartRecording(reserve, recorded)).resolves.toBeUndefined();
        expect(harness.callbacks.recording.setRecordingFailed(reserve, recorded)).toBeUndefined();
        expect(harness.callbacks.recording.setRecordingRetryOver(reserve)).toBeUndefined();

        expect(recordingManage.acceptMutation).not.toHaveBeenCalled();
        expect(recordingManage.evaluate).not.toHaveBeenCalled();
        expect(recordingManage.retry).not.toHaveBeenCalled();
        expect(recordingManage.transition).not.toHaveBeenCalled();
        expect(recordingManage.update).not.toHaveBeenCalled();
    });

    it('[WC-3.6][WC-7.7] completes finish Tag and delivery without awaiting detached reservation cleanup or entering recording lifecycle control', async () => {
        const cancellation = deferred<void>();
        const ledger: string[] = [];
        const recordingManage = {
            acceptMutation: vi.fn(),
            evaluate: vi.fn(),
            queue: vi.fn(),
            retry: vi.fn(),
            rollback: vi.fn(),
            transition: vi.fn(),
            update: vi.fn(),
        };
        const reserve = makeReserve({ id: 313, tags: '[]' });
        const recorded = makeRecorded({ id: 314, videoFiles: [] });
        const harness = makeSetter({ recordingManage });
        harness.reservationManage.cancel.mockImplementation(() => {
            ledger.push('cancel');
            return cancellation.promise;
        });
        harness.externalCommandManage.addRecordingFinishCmd.mockImplementation(() => ledger.push('hook'));
        harness.ipc.notifyClient.mockImplementation(() => ledger.push('ui'));
        harness.setter.set();

        await expect(harness.callbacks.recording.setFinishRecording(reserve, recorded, true)).resolves.toBeUndefined();

        expect(ledger).toEqual(['cancel', 'hook', 'ui']);
        expect(recordingManage.acceptMutation).not.toHaveBeenCalled();
        expect(recordingManage.evaluate).not.toHaveBeenCalled();
        expect(recordingManage.queue).not.toHaveBeenCalled();
        expect(recordingManage.retry).not.toHaveBeenCalled();
        expect(recordingManage.rollback).not.toHaveBeenCalled();
        expect(recordingManage.transition).not.toHaveBeenCalled();
        expect(recordingManage.update).not.toHaveBeenCalled();

        cancellation.resolve();
        await flushImmediate();
        expect(harness.logger.system.error).not.toHaveBeenCalled();
    });
});

describe('RecordedApiModel user deletion composition', () => {
    it('[WC-5.1][WC-5.2] keeps the unchanged recorded.delete adapter idle until Encode cancellation settles', async () => {
        const cancellation = deferred<void>();
        const target: any = Object.create(RecordedApiModel.prototype);
        target.encodeManage = { cancelEncodeByRecordedId: vi.fn(() => cancellation.promise) };
        target.ipc = { recorded: { delete: vi.fn(async () => undefined) } };

        const operation = target.delete(621);
        expect(target.encodeManage.cancelEncodeByRecordedId).toHaveBeenCalledExactlyOnceWith(621);
        expect(target.ipc.recorded.delete).not.toHaveBeenCalled();

        cancellation.resolve();
        await operation;

        expect(target.ipc.recorded.delete).toHaveBeenCalledExactlyOnceWith(621);
    });

    it('[WC-7.3] does not invoke the existing recorded.delete adapter after cancellation rejects', async () => {
        const cancellationFailure = new Error('synthetic aggregate Encode cancellation failure');
        const target: any = Object.create(RecordedApiModel.prototype);
        target.encodeManage = { cancelEncodeByRecordedId: vi.fn(async () => Promise.reject(cancellationFailure)) };
        target.ipc = { recorded: { delete: vi.fn(async () => undefined) } };

        await expect(target.delete(622)).rejects.toBe(cancellationFailure);

        expect(target.encodeManage.cancelEncodeByRecordedId).toHaveBeenCalledExactlyOnceWith(622);
        expect(target.ipc.recorded.delete).not.toHaveBeenCalled();
    });

    it('[PRIMARY WC-5.7][WC-5.2][WC-5.7][WC-7.6] propagates one rejected recorded.delete adapter request without retrying', async () => {
        const adapterFailure = new Error('synthetic recorded.delete adapter failure');
        const target: any = Object.create(RecordedApiModel.prototype);
        target.encodeManage = { cancelEncodeByRecordedId: vi.fn(async () => undefined) };
        target.ipc = { recorded: { delete: vi.fn(async () => Promise.reject(adapterFailure)) } };

        await expect(target.delete(623)).rejects.toBe(adapterFailure);

        expect(target.encodeManage.cancelEncodeByRecordedId).toHaveBeenCalledExactlyOnceWith(623);
        expect(target.ipc.recorded.delete).toHaveBeenCalledExactlyOnceWith(623);
    });
});

describe('deletion path negative characteristics', () => {
    it('[WC-5.10] starts one Encode cancellation only for a user-whole deletion request', async () => {
        const encoding = { cancelEncodeByRecordedId: vi.fn(async () => undefined) };
        const request = { requestUserDeletion: vi.fn(async () => undefined) };
        const coordinator = new ServiceChildUserDeletionCoordinator(encoding, request);

        await coordinator.deleteByUser(624);

        expect(encoding.cancelEncodeByRecordedId).toHaveBeenCalledExactlyOnceWith(624);
        expect(request.requestUserDeletion).toHaveBeenCalledExactlyOnceWith(624);
    });
});

describe('ParentUserDeletionCoordinator recording decision characteristics', () => {
    it.each([
        ['a non-recording preparation', false, 625, true, false],
        ['a preparation without a reserve ID', true, null, true, false],
        ['a preparation whose reserve is no longer held', true, 627, false, true],
    ] as const)(
        '[PRIMARY WC-5.5][WC-5.4][WC-5.5][WC-5.12] passes the same opaque token to final deletion for %s',
        async (_, isRecording, reserveId, hasReservation, checksReservation) => {
            const token = Object.freeze(Object.create(null));
            const deletion = {
                prepareUserDeletion: vi.fn(async () => ({
                    isRecording,
                    reserveId,
                    status: 'prepared' as const,
                    token,
                })),
                deletePrepared: vi.fn(async () => undefined),
            };
            const recording = {
                hasReservation: vi.fn(() => hasReservation),
                requestCancellationForDeletion: vi.fn(async () => undefined),
            };
            const coordinator = new ParentUserDeletionCoordinator(deletion, recording);

            await coordinator.deleteFromRequest(624);

            if (checksReservation) expect(recording.hasReservation).toHaveBeenCalledExactlyOnceWith(reserveId);
            else expect(recording.hasReservation).not.toHaveBeenCalled();
            expect(recording.requestCancellationForDeletion).not.toHaveBeenCalled();
            expect(deletion.deletePrepared).toHaveBeenCalledExactlyOnceWith(token);
            expect(deletion.deletePrepared.mock.calls[0][0]).toBe(token);
        },
    );
});

describe('ParentVideoFileDeletionCoordinator direct-deletion characteristics', () => {
    it('[WC-5.3][WC-5.10] passes the opaque individual token to direct deletion without beginning whole deletion or recording cancellation', async () => {
        const videoToken = Object.freeze(Object.create(null));
        const videoDeletion = {
            prepareVideoFileDeletion: vi.fn(async () => ({ status: 'prepared' as const, token: videoToken })),
            deletePreparedVideoFile: vi.fn(async () => ({ status: 'video-file-deleted' as const })),
        };
        const recordedDeletion = {
            prepareUserDeletion: vi.fn(async () => ({ status: 'prepared' as const })),
            deletePrepared: vi.fn(async () => undefined),
        };
        const recording = {
            hasReservation: vi.fn(() => true),
            requestCancellationForDeletion: vi.fn(async () => undefined),
        };
        const coordinator = new ParentVideoFileDeletionCoordinator(videoDeletion, recordedDeletion, recording);

        await coordinator.deleteVideoFileFromRequest(711);

        expect(videoDeletion.prepareVideoFileDeletion).toHaveBeenCalledExactlyOnceWith(711);
        expect(videoDeletion.deletePreparedVideoFile).toHaveBeenCalledExactlyOnceWith(videoToken);
        expect(videoDeletion.deletePreparedVideoFile.mock.calls[0][0]).toBe(videoToken);
        expect(recordedDeletion.prepareUserDeletion).not.toHaveBeenCalled();
        expect(recordedDeletion.deletePrepared).not.toHaveBeenCalled();
        expect(recording.hasReservation).not.toHaveBeenCalled();
        expect(recording.requestCancellationForDeletion).not.toHaveBeenCalled();
    });

    it('[WC-5.4][WC-5.12] turns an initial whole-recorded decision into one fresh whole preparation and opaque whole deletion', async () => {
        const wholeToken = Object.freeze(Object.create(null));
        const videoDeletion = {
            prepareVideoFileDeletion: vi.fn(async () => ({
                recordedId: 713,
                status: 'whole-recorded-deletion-required' as const,
            })),
            deletePreparedVideoFile: vi.fn(async () => ({ status: 'video-file-deleted' as const })),
        };
        const recordedDeletion = {
            prepareUserDeletion: vi.fn(async () => ({
                isRecording: false,
                reserveId: null,
                status: 'prepared' as const,
                token: wholeToken,
            })),
            deletePrepared: vi.fn(async () => undefined),
        };
        const recording = {
            hasReservation: vi.fn(() => true),
            requestCancellationForDeletion: vi.fn(async () => undefined),
        };
        const coordinator = new ParentVideoFileDeletionCoordinator(videoDeletion, recordedDeletion, recording);

        await coordinator.deleteVideoFileFromRequest(712);

        expect(videoDeletion.prepareVideoFileDeletion).toHaveBeenCalledExactlyOnceWith(712);
        expect(videoDeletion.deletePreparedVideoFile).not.toHaveBeenCalled();
        expect(recordedDeletion.prepareUserDeletion).toHaveBeenCalledExactlyOnceWith(713);
        expect(recordedDeletion.deletePrepared).toHaveBeenCalledExactlyOnceWith(wholeToken);
        expect(recordedDeletion.deletePrepared.mock.calls[0][0]).toBe(wholeToken);
        expect(recording.hasReservation).not.toHaveBeenCalled();
        expect(recording.requestCancellationForDeletion).not.toHaveBeenCalled();
    });

    it('[WC-5.4][WC-5.12] turns a final individual reread whole decision into one fresh whole preparation without reusing the individual token', async () => {
        const videoToken = Object.freeze(Object.create(null));
        const wholeToken = Object.freeze(Object.create(null));
        const videoDeletion = {
            prepareVideoFileDeletion: vi.fn(async () => ({ status: 'prepared' as const, token: videoToken })),
            deletePreparedVideoFile: vi.fn(async () => ({
                recordedId: 716,
                status: 'whole-recorded-deletion-required' as const,
            })),
        };
        const recordedDeletion = {
            prepareUserDeletion: vi.fn(async () => ({
                isRecording: false,
                reserveId: null,
                status: 'prepared' as const,
                token: wholeToken,
            })),
            deletePrepared: vi.fn(async () => undefined),
        };
        const recording = {
            hasReservation: vi.fn(() => true),
            requestCancellationForDeletion: vi.fn(async () => undefined),
        };
        const coordinator = new ParentVideoFileDeletionCoordinator(videoDeletion, recordedDeletion, recording);

        await coordinator.deleteVideoFileFromRequest(715);

        expect(videoDeletion.prepareVideoFileDeletion).toHaveBeenCalledExactlyOnceWith(715);
        expect(videoDeletion.deletePreparedVideoFile).toHaveBeenCalledExactlyOnceWith(videoToken);
        expect(recordedDeletion.prepareUserDeletion).toHaveBeenCalledExactlyOnceWith(716);
        expect(recordedDeletion.deletePrepared).toHaveBeenCalledExactlyOnceWith(wholeToken);
        expect(recordedDeletion.deletePrepared.mock.calls[0][0]).toBe(wholeToken);
        expect(recordedDeletion.deletePrepared.mock.calls[0][0]).not.toBe(videoToken);
        expect(recording.hasReservation).not.toHaveBeenCalled();
        expect(recording.requestCancellationForDeletion).not.toHaveBeenCalled();
    });
});

// Value-range and branch characterization for EventSetter.
describe('EventSetter value/branch matrix (Layer 2)', () => {
    describe('event category dispatch (event 全種)', () => {
        const singleNotifyDestinations = [
            ['thumbnail.setAdded', 'thumbnail', 'setAdded', [901, 902]],
            ['thumbnail.setDeleted', 'thumbnail', 'setDeleted', []],
            ['recordedEvent.setUpdateVideoFileSize', 'recordedEvent', 'setUpdateVideoFileSize', [903]],
            ['recordedEvent.setAddVideoFile', 'recordedEvent', 'setAddVideoFile', [904]],
            ['recordedEvent.setCreateNewRecorded', 'recordedEvent', 'setCreateNewRecorded', [905]],
            ['recordedEvent.setDeleteVideoFile', 'recordedEvent', 'setDeleteVideoFile', [906]],
            ['recordedEvent.setDropLogFileChanged', 'recordedEvent', 'setDropLogFileChanged', [907]],
            ['recordedEvent.setChangeProtect', 'recordedEvent', 'setChangeProtect', [908, true]],
            ['recordedTag.setCreated', 'recordedTag', 'setCreated', [{ id: 909 }]],
            ['recordedTag.setUpdated', 'recordedTag', 'setUpdated', [910]],
            ['recordedTag.setRelated', 'recordedTag', 'setRelated', [911, 912]],
            ['recordedTag.setDeleted', 'recordedTag', 'setDeleted', [913]],
            ['recordedTag.setDeletedRelation', 'recordedTag', 'setDeletedRelation', [914, 915]],
        ] as const;

        it.each(singleNotifyDestinations)(
            '[VB:event-notify-only] dispatches only a single UI notification for %s',
            (_label, category, method, args) => {
                const harness = makeSetter();
                harness.setter.set();
                const callbacks = harness.callbacks as Record<string, Record<string, (...callArgs: any[]) => unknown>>;

                expect(callbacks[category][method](...(args as unknown[]))).toBeUndefined();

                expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
                expect(harness.recordingManage.acceptMutation).not.toHaveBeenCalled();
                expect(harness.reservationManage.cancel).not.toHaveBeenCalled();
            },
        );

        it.each(['setUpdated', 'setEnabled', 'setDisabled'] as const)(
            '[VB:event-rule-two-call] notifies and requests a Rule refresh once each for rule.%s',
            method => {
                const ledger: string[] = [];
                const harness = makeSetter();
                harness.ipc.notifyClient.mockImplementation(() => ledger.push('ui'));
                harness.reservationManage.updateRule.mockImplementation(() => ledger.push('rule'));
                harness.setter.set();

                expect(harness.callbacks.rule[method](451)).toBeUndefined();

                expect(ledger).toEqual(['ui', 'rule']);
                expect(harness.reservationManage.updateRule).toHaveBeenCalledExactlyOnceWith(451);
            },
        );

        it('[VB:event-rule-deleted] notifies, removes the ruleId reference, and requests a Rule refresh once each', () => {
            const ledger: string[] = [];
            const harness = makeSetter();
            harness.ipc.notifyClient.mockImplementation(() => ledger.push('ui'));
            harness.recordedManage.removeRuleId.mockImplementation(() => ledger.push('remove'));
            harness.reservationManage.updateRule.mockImplementation(() => ledger.push('rule'));
            harness.setter.set();

            expect(harness.callbacks.rule.setDeleted(461)).toBeUndefined();

            expect(ledger).toEqual(['ui', 'remove', 'rule']);
            expect(harness.recordedManage.removeRuleId).toHaveBeenCalledExactlyOnceWith(461);
            expect(harness.reservationManage.updateRule).toHaveBeenCalledExactlyOnceWith(461);
        });

        it('[VB:event-finish-encode] forwards the finished-encode info to the external command Hook exactly once', () => {
            const harness = makeSetter();
            harness.setter.set();
            const info = { mode: 'synthetic-mode', recordedId: 71, videoFileId: 711 };

            expect(harness.callbacks.encode.setFinishEncode(info)).toBeUndefined();

            expect(harness.externalCommandManage.addEncodingFinishCmd).toHaveBeenCalledExactlyOnceWith(info);
        });
    });

    // The recording-lifecycle events below need Layer 2 evidence of their *own* destinations, which
    // WC-2.13's existence-only assertion (that `recordingManage` is never called) does not give.
    // These tests assert the real UI
    // notification, external command Hook, and reservation-cancellation destinations directly, so
    // deleting one of them from `EventSetter.ts` fails here, not only in a Layer 1 spec test.
    describe('recording lifecycle destination dispatch (retargets review I4 away from existence-only evidence)', () => {
        it.each([
            ['a started preparation', 'setStartPrepRecording', 'addRecordingPrepStartCmd', false],
            ['a cancelled preparation', 'setCancelPrepRecording', 'addRecordingPrepRecFailedCmd', false],
            ['a failed preparation', 'setPrepRecordingFailed', 'addRecordingPrepRecFailedCmd', true],
        ] as const)(
            '[VB:event-recording-prep-lifecycle] notifies and dispatches the destination Hook exactly once each for %s',
            (_label, eventName, hookName, cancelsReservation) => {
                const reserve = makeReserve({ id: 961 });
                const harness = makeSetter();
                harness.setter.set();
                const recordingCallbacks = harness.callbacks.recording as Record<string, (...args: any[]) => unknown>;
                const hooks = harness.externalCommandManage as Record<string, ReturnType<typeof vi.fn>>;

                expect(recordingCallbacks[eventName](reserve)).toBeUndefined();

                expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
                expect(hooks[hookName]).toHaveBeenCalledExactlyOnceWith(reserve);
                if (cancelsReservation) {
                    expect(harness.reservationManage.cancel).toHaveBeenCalledExactlyOnceWith(reserve.id);
                } else {
                    expect(harness.reservationManage.cancel).not.toHaveBeenCalled();
                }
            },
        );

        it('[VB:event-recording-retry-over] cancels the reservation exactly once and dispatches no UI notification or external command Hook', () => {
            const reserve = makeReserve({ id: 962 });
            const harness = makeSetter();
            harness.setter.set();

            expect(harness.callbacks.recording.setRecordingRetryOver(reserve)).toBeUndefined();

            expect(harness.reservationManage.cancel).toHaveBeenCalledExactlyOnceWith(reserve.id);
            expect(harness.ipc.notifyClient).not.toHaveBeenCalled();
            expect(harness.externalCommandManage.addRecordingPrepStartCmd).not.toHaveBeenCalled();
            expect(harness.externalCommandManage.addRecordingPrepRecFailedCmd).not.toHaveBeenCalled();
        });
    });

    describe('予約・録画状態 (reservation and recording state) branches', () => {
        it.each([
            ['a non-recording deletion', false, 501, false],
            ['a recording deletion without a reserve id', true, null, false],
            ['a recording deletion with a reserve id', true, 502, true],
        ] as const)(
            '[VB:state-delete-recorded] notifies always and cancels the reservation only for %s',
            (_label, isRecording, reserveId, cancels) => {
                const recorded = makeRecorded({ id: 41, isRecording, reserveId });
                const harness = makeSetter();
                harness.setter.set();

                expect(harness.callbacks.recordedEvent.setDeleteRecorded(recorded)).toBeUndefined();

                expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
                if (cancels) expect(harness.reservationManage.cancel).toHaveBeenCalledExactlyOnceWith(reserveId);
                else expect(harness.reservationManage.cancel).not.toHaveBeenCalled();
            },
        );

        it.each([
            ['a null recorded row', null, false],
            ['a non-null recorded row', makeRecorded({ id: 81 }), true],
        ] as const)(
            '[VB:state-recording-failed] notifies always and attempts the failure Hook only for %s',
            async (_label, recorded, attemptsHook) => {
                const reserve = makeReserve({ id: 82 });
                const harness = makeSetter();
                harness.setter.set();

                expect(harness.callbacks.recording.setRecordingFailed(reserve, recorded)).toBeUndefined();
                await flushImmediate();

                expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
                if (attemptsHook) {
                    expect(harness.externalCommandManage.addRecordingFailedCmd).toHaveBeenCalledExactlyOnceWith(
                        recorded,
                    );
                } else {
                    expect(harness.externalCommandManage.addRecordingFailedCmd).not.toHaveBeenCalled();
                }
            },
        );

        it.each([
            ['a rule-based event-relay reservation', 601, true, 'cancel'],
            ['a normal rule reservation', 602, false, 'updateRule'],
        ] as const)(
            '[VB:state-finish-reservation] chooses reservation cancellation vs. Rule refresh for %s',
            async (_label, ruleId, isEventRelay, expectedAction) => {
                const reserve = makeReserve({ id: 611, isEventRelay, ruleId, tags: null });
                const recorded = makeRecorded({ id: 612, videoFiles: [] });
                const harness = makeSetter();
                harness.setter.set();

                await harness.callbacks.recording.setFinishRecording(reserve, recorded, true);

                if (expectedAction === 'cancel') {
                    expect(harness.reservationManage.cancel).toHaveBeenCalledExactlyOnceWith(reserve.id);
                    expect(harness.reservationManage.updateRule).not.toHaveBeenCalled();
                } else {
                    expect(harness.reservationManage.updateRule).toHaveBeenCalledExactlyOnceWith(ruleId);
                    expect(harness.reservationManage.cancel).not.toHaveBeenCalled();
                }
            },
        );
    });

    describe('Tag branches (未設定 / 空 / aggregate parse failure / 個別 failure)', () => {
        it.each([
            ['no tags on the reservation (null)', null, false],
            ['an empty tag array', '[]', false],
            ['a non-array Tag aggregate', '{}', true],
            ['an invalid JSON Tag aggregate', 'not-json', true],
        ] as const)('[VB:tag-null-empty-parse] relates zero tags for %s', async (_label, tagsValue, isParseFailure) => {
            const reserve = makeReserve({ id: 701, tags: tagsValue });
            const recorded = makeRecorded({ id: 702 });
            const harness = makeSetter();
            harness.setter.set();

            await harness.callbacks.recording.setStartRecording(reserve, recorded);

            expect(harness.recordedTagManage.setRelation).not.toHaveBeenCalled();
            if (isParseFailure) expect(harness.logger.system.error).toHaveBeenCalled();
            else expect(harness.logger.system.error).not.toHaveBeenCalled();
            expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
            expect(harness.externalCommandManage.addRecordingStartCmd).toHaveBeenCalledExactlyOnceWith(recorded);
        });

        it('[VB:tag-individual-failure] relates each tag id in input order and continues past one rejected relation before starting delivery', async () => {
            const relationFailure = new Error('synthetic individual tag relation failure');
            const reserve = makeReserve({ id: 711, tags: '[801,802,803]' });
            const recorded = makeRecorded({ id: 712 });
            const harness = makeSetter();
            harness.recordedTagManage.setRelation.mockImplementation((tagId: number) =>
                tagId === 802 ? Promise.reject(relationFailure) : Promise.resolve(undefined),
            );
            harness.setter.set();

            await harness.callbacks.recording.setStartRecording(reserve, recorded);

            expect(harness.recordedTagManage.setRelation.mock.calls).toEqual([
                [801, 712],
                [802, 712],
                [803, 712],
            ]);
            expect(harness.logger.system.error).toHaveBeenCalledWith(relationFailure);
            expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
            expect(harness.externalCommandManage.addRecordingStartCmd).toHaveBeenCalledExactlyOnceWith(recorded);
        });
    });

    describe('Encode branches (0 / 1 / 3 real slots; 4 is not a reachable branch)', () => {
        it.each([
            ['zero encode slots configured', null, null, null, [] as const],
            ['one encode slot configured', 'h264', null, null, ['h264'] as const],
            ['three encode slots configured', 'h264', 'h265', 'av1', ['h264', 'h265', 'av1'] as const],
        ] as const)(
            '[VB:encode-count] starts Thumbnail once and dispatches exactly the configured Encode slots for %s',
            async (_label, mode1, mode2, mode3, expectedModes) => {
                const reserve = makeReserve({
                    encodeMode1: mode1,
                    encodeMode2: mode2,
                    encodeMode3: mode3,
                    id: 721,
                    tags: null,
                });
                const recorded = makeRecorded({ id: 722, videoFiles: [{ id: 9001 }] });
                const harness = makeSetter();
                harness.setter.set();

                await harness.callbacks.recording.setFinishRecording(reserve, recorded, false);

                expect(harness.thumbnailManage.add).toHaveBeenCalledExactlyOnceWith(9001);
                expect(harness.ipc.setEncode.mock.calls.map((call: any) => call[0].mode)).toEqual(expectedModes);
            },
        );
    });

    describe('同期 throw / 非同期 reject: an unguarded Encode dispatch halts the rest of finish delivery', () => {
        it('[VB:throw-reject-encode-halt] halts the remaining Encode slots, Tag relations, Hook, and UI after one synchronous Encode dispatch throw, and rejects the finish handoff without leaving an unhandled rejection', async () => {
            const dispatchFailure = new Error('synthetic synchronous Encode dispatch failure');
            const reserve = makeReserve({
                encodeMode1: 'h264',
                encodeMode2: 'h265',
                encodeMode3: 'av1',
                id: 731,
                tags: '[901]',
            });
            const recorded = makeRecorded({ id: 732, videoFiles: [{ id: 9002 }] });
            const harness = makeSetter();
            harness.ipc.setEncode.mockImplementationOnce(() => {
                throw dispatchFailure;
            });
            harness.setter.set();

            const unhandled: unknown[] = [];
            const recordUnhandled = (reason: unknown): void => {
                unhandled.push(reason);
            };
            process.prependListener('unhandledRejection', recordUnhandled);
            try {
                await expect(harness.callbacks.recording.setFinishRecording(reserve, recorded, false)).rejects.toBe(
                    dispatchFailure,
                );
                await flushImmediate();
                expect(unhandled).toEqual([]);
            } finally {
                process.removeListener('unhandledRejection', recordUnhandled);
            }

            expect(harness.thumbnailManage.add).toHaveBeenCalledExactlyOnceWith(9002);
            expect(harness.ipc.setEncode).toHaveBeenCalledOnce();
            expect(harness.recordedTagManage.setRelation).not.toHaveBeenCalled();
            expect(harness.externalCommandManage.addRecordingFinishCmd).not.toHaveBeenCalled();
            expect(harness.ipc.notifyClient).not.toHaveBeenCalled();
        });
    });
});
