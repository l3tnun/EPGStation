import { describe, expect, it } from 'vitest';

import { flushImmediate, makeRecorded, makeSetter } from '../event-and-hook-delivery/_harness';

const refreshTriggers = [
    ['thumbnail added', (harness: ReturnType<typeof makeSetter>) => harness.callbacks.thumbnail.setAdded(1, 2)],
    ['thumbnail deleted', (harness: ReturnType<typeof makeSetter>) => harness.callbacks.thumbnail.setDeleted()],
    [
        'recorded created',
        (harness: ReturnType<typeof makeSetter>) => harness.callbacks.recordedEvent.setCreateNewRecorded(3),
    ],
    [
        'video size changed',
        (harness: ReturnType<typeof makeSetter>) => harness.callbacks.recordedEvent.setUpdateVideoFileSize(4),
    ],
    ['video added', (harness: ReturnType<typeof makeSetter>) => harness.callbacks.recordedEvent.setAddVideoFile(5)],
    [
        'video deleted',
        (harness: ReturnType<typeof makeSetter>) => harness.callbacks.recordedEvent.setDeleteVideoFile(6),
    ],
    [
        'drop log changed',
        (harness: ReturnType<typeof makeSetter>) => harness.callbacks.recordedEvent.setDropLogFileChanged(7),
    ],
    [
        'protect changed',
        (harness: ReturnType<typeof makeSetter>) => harness.callbacks.recordedEvent.setChangeProtect(8, true),
    ],
    ['tag created', (harness: ReturnType<typeof makeSetter>) => harness.callbacks.recordedTag.setCreated({ id: 9 })],
    ['tag updated', (harness: ReturnType<typeof makeSetter>) => harness.callbacks.recordedTag.setUpdated(10)],
    ['tag related', (harness: ReturnType<typeof makeSetter>) => harness.callbacks.recordedTag.setRelated(11, 12)],
    ['tag deleted', (harness: ReturnType<typeof makeSetter>) => harness.callbacks.recordedTag.setDeleted(13)],
    [
        'tag relation deleted',
        (harness: ReturnType<typeof makeSetter>) => harness.callbacks.recordedTag.setDeletedRelation(14, 15),
    ],
] as const;

describe('EventSetter recorded change workflow contract', () => {
    it.each(refreshTriggers)('[PRIMARY WC-4.6][WC-4.6] selects one refresh handoff when %s', (_label, emit) => {
        const harness = makeSetter();
        harness.setter.set();

        expect(emit(harness)).toBeUndefined();

        expect(harness.ipc.notifyClient.mock.calls).toEqual([[]]);
        expect(harness.externalCommandManage.addEncodingFinishCmd).not.toHaveBeenCalled();
    });

    it('[PRIMARY WC-4.4][WC-4.4] starts the requested upload thumbnail even when the refresh handoff throws', () => {
        const uiFailure = new Error('synthetic upload UI throw');
        const harness = makeSetter();
        harness.ipc.notifyClient.mockImplementation(() => {
            throw uiFailure;
        });
        harness.setter.set();

        expect(harness.callbacks.recordedEvent.setAddUploadedVideoFile(21, true)).toBeUndefined();

        expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
        expect(harness.thumbnailManage.add.mock.calls).toEqual([[21]]);
        expect(harness.logger.system.error.mock.calls).toEqual([[uiFailure]]);
    });

    it('[WC-4.4] skips thumbnail creation when the upload payload does not request it', () => {
        const harness = makeSetter();
        harness.setter.set();

        expect(harness.callbacks.recordedEvent.setAddUploadedVideoFile(22, false)).toBeUndefined();

        expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
        expect(harness.thumbnailManage.add).not.toHaveBeenCalled();
    });

    it('[PRIMARY WC-4.5][PRIMARY WC-6.5][WC-4.5][WC-6.5] attempts the conditional reservation cancellation after rejected refresh and cancellation handoffs', async () => {
        const uiFailure = new Error('synthetic delete UI rejection');
        const cancelFailure = new Error('synthetic delete cancellation rejection');
        const unhandled: unknown[] = [];
        const recordUnhandled = (reason: unknown) => unhandled.push(reason);
        const recorded = makeRecorded({ isRecording: true, reserveId: 31 });
        const harness = makeSetter();
        harness.ipc.notifyClient.mockImplementation(() => Promise.reject(uiFailure));
        harness.reservationManage.cancel.mockImplementation(() => Promise.reject(cancelFailure));
        harness.setter.set();
        process.prependListener('unhandledRejection', recordUnhandled);

        try {
            expect(harness.callbacks.recordedEvent.setDeleteRecorded(recorded)).toBeUndefined();
            await flushImmediate();

            expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
            expect(harness.reservationManage.cancel.mock.calls).toEqual([[31]]);
            expect(harness.logger.system.error.mock.calls).toContainEqual([uiFailure]);
            expect(harness.logger.system.error.mock.calls).toContainEqual([cancelFailure]);
            expect(harness.logger.system.error).toHaveBeenCalledTimes(2);
            expect(unhandled).toEqual([]);
        } finally {
            process.removeListener('unhandledRejection', recordUnhandled);
        }
    });

    it('[PRIMARY WC-4.7][PRIMARY WC-6.2][PRIMARY WC-6.4][WC-4.7][WC-6.2][WC-6.4] records a rejected encode-completion Hook without selecting a refresh handoff', async () => {
        const failure = new Error('synthetic encode Hook rejection');
        const harness = makeSetter();
        harness.externalCommandManage.addEncodingFinishCmd.mockImplementation(() => Promise.reject(failure));
        harness.setter.set();

        expect(
            harness.callbacks.encode.setFinishEncode({ mode: 'synthetic', recordedId: 41, videoFileId: 42 }),
        ).toBeUndefined();
        await flushImmediate();

        expect(harness.externalCommandManage.addEncodingFinishCmd.mock.calls).toEqual([
            [{ mode: 'synthetic', recordedId: 41, videoFileId: 42 }],
        ]);
        expect(harness.ipc.notifyClient).not.toHaveBeenCalled();
        expect(harness.logger.system.error.mock.calls).toEqual([[failure]]);
    });

    it('[PRIMARY WC-4.8][WC-4.8] delegates encode completion to the configured command without directly changing encode reflection, file deletion, or conversion state', () => {
        const harness = makeSetter();
        harness.setter.set();
        const info = { mode: 'synthetic-conversion-state', recordedId: 51, videoFileId: 52 };

        expect(harness.callbacks.encode.setFinishEncode(info)).toBeUndefined();

        expect(harness.externalCommandManage.addEncodingFinishCmd.mock.calls).toEqual([[info]]);
        expect(harness.recordingManage.acceptMutation).not.toHaveBeenCalled();
        expect(harness.recordingManage.update).not.toHaveBeenCalled();
        expect(harness.recordedManage.historyCleanup).not.toHaveBeenCalled();
        expect(harness.recordedManage.removeRuleId).not.toHaveBeenCalled();
        expect(harness.recordedTagManage.setRelation).not.toHaveBeenCalled();
        expect(harness.thumbnailManage.add).not.toHaveBeenCalled();
        expect(harness.reservationManage.updateAll).not.toHaveBeenCalled();
        expect(harness.reservationManage.updateRule).not.toHaveBeenCalled();
        expect(harness.reservationManage.cancel).not.toHaveBeenCalled();
        expect(harness.reservationManage.addEventRelay).not.toHaveBeenCalled();
        expect(harness.ipc.notifyClient).not.toHaveBeenCalled();
        expect(harness.ipc.setEncode).not.toHaveBeenCalled();
    });
});
