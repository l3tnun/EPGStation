import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeRecorded, makeReserve, makeSetter } from './_harness';

const PAST = Date.now() - 60_000;
const FUTURE = Date.now() + 3_600_000;

const setup = (recordingIds: number[], hasReserve?: (reserveId: number) => boolean) => {
    const ledger: string[] = [];
    const recordingManage = {
        acceptMutation: vi.fn(() => ledger.push('accept')),
        update: vi.fn(),
        hasReserve: vi.fn(hasReserve ?? ((reserveId: number) => recordingIds.includes(reserveId))),
    };
    const harness = makeSetter({ recordingManage });
    harness.externalCommandManage.addUpdateReseves.mockImplementation(diff => {
        for (const reserve of diff.insert ?? []) ledger.push(`add:${reserve.id}`);
        for (const reserve of diff.update ?? []) ledger.push(`update:${reserve.id}`);
        for (const reserve of diff.delete ?? []) ledger.push(`delete:${reserve.id}`);
    });
    harness.externalCommandManage.addRecordingFinishCmd.mockImplementation(recorded =>
        ledger.push(`finish:${recorded.id}`),
    );
    harness.externalCommandManage.addRecordingFailedCmd.mockImplementation(recorded =>
        ledger.push(`failed:${recorded.id}`),
    );
    harness.setter.set();
    return { harness, ledger, recordingManage };
};

afterEach(() => {
    vi.useRealTimers();
});

describe('reserve-deleted command order for recordings past their end time', () => {
    it('[PRIMARY EH-3.3][EH-3.8] queues the deletion of a reservation still recording past its end after its finish command', async () => {
        const { harness, ledger, recordingManage } = setup([401]);
        const ending = makeReserve({ id: 401, ruleId: 901, endAt: PAST });
        const notRecording = makeReserve({ id: 402, ruleId: 901, endAt: PAST });
        const future = makeReserve({ id: 403, ruleId: 901, endAt: FUTURE });

        harness.callbacks.reserve.setUpdated({ delete: [ending, notRecording, future], isSuppressLog: false });

        // 録画中の判定は録画実行へ差分を渡す前に行う
        expect(recordingManage.hasReserve.mock.invocationCallOrder[0]).toBeLessThan(
            recordingManage.acceptMutation.mock.invocationCallOrder[0],
        );
        expect(recordingManage.hasReserve.mock.calls).toEqual([[401], [402]]);
        expect(recordingManage.acceptMutation).toHaveBeenCalledExactlyOnceWith({
            delete: [ending, notRecording, future],
            isSuppressLog: false,
        });
        expect(ledger).toEqual(['accept', 'delete:402', 'delete:403']);

        await harness.callbacks.recording.setFinishRecording(ending, makeRecorded({ id: 501, videoFiles: [] }), false);

        expect(ledger).toEqual(['accept', 'delete:402', 'delete:403', 'finish:501', 'delete:401']);
        expect(harness.externalCommandManage.addUpdateReseves.mock.calls[1]).toEqual([
            { insert: [], update: [], delete: [ending], isSuppressLog: false },
        ]);
    });

    it('[EH-3.3][EH-3.7] releases the held deletion after the recording failed command', () => {
        const { harness, ledger } = setup([411]);
        const ending = makeReserve({ id: 411, endAt: PAST });

        harness.callbacks.reserve.setUpdated({ delete: [ending], isSuppressLog: true });
        expect(ledger).toEqual(['accept']);

        harness.callbacks.recording.setRecordingFailed(ending, makeRecorded({ id: 511 }));
        harness.callbacks.recording.setRecordingFailed(ending, null);

        expect(ledger).toEqual(['accept', 'failed:511', 'delete:411']);
        expect(harness.externalCommandManage.addUpdateReseves.mock.calls).toEqual([
            [{ delete: [], isSuppressLog: true }],
            [{ insert: [], update: [], delete: [ending], isSuppressLog: true }],
        ]);
    });

    it('[EH-3.3] queues a held deletion after 10 minutes when no finish or failure arrives', () => {
        vi.useFakeTimers();
        const { harness, ledger } = setup([421]);
        const ending = makeReserve({ id: 421, endAt: PAST });

        harness.callbacks.reserve.setUpdated({ delete: [ending], isSuppressLog: false });
        vi.advanceTimersByTime(599_999);
        expect(ledger).toEqual(['accept']);
        vi.advanceTimersByTime(1);
        expect(ledger).toEqual(['accept', 'delete:421']);

        harness.callbacks.recording.setRecordingFailed(ending, makeRecorded({ id: 521 }));
        expect(ledger).toEqual(['accept', 'delete:421', 'failed:521']);
    });

    it.each(['setCancelPrepRecording', 'setPrepRecordingFailed'] as const)(
        '[EH-3.3][EH-3.5] releases the held deletion after the prep command from %s',
        callback => {
            const { harness, ledger } = setup([471]);
            const ending = makeReserve({ id: 471, endAt: PAST });
            harness.externalCommandManage.addRecordingPrepRecFailedCmd.mockImplementation(reserve =>
                ledger.push(`prep:${reserve.id}`),
            );

            harness.callbacks.reserve.setUpdated({ delete: [ending], isSuppressLog: false });
            harness.callbacks.recording[callback](ending);

            expect(ledger).toEqual(['accept', 'prep:471', 'delete:471']);
        },
    );

    it('[EH-3.3][EH-3.11] keeps every deletion of the same reservation and releases them in order', () => {
        const { harness, ledger } = setup([431]);
        const first = makeReserve({ id: 431, endAt: PAST });
        const second = makeReserve({ id: 431, endAt: PAST, name: 'second' });

        harness.callbacks.reserve.setUpdated({ delete: [first], isSuppressLog: false });
        harness.callbacks.reserve.setUpdated({ delete: [second], isSuppressLog: false });
        harness.callbacks.recording.setRecordingFailed(first, null);

        expect(ledger).toEqual(['accept', 'accept', 'delete:431', 'delete:431']);
        expect(harness.externalCommandManage.addUpdateReseves.mock.calls.slice(2)).toEqual([
            [{ insert: [], update: [], delete: [first], isSuppressLog: false }],
            [{ insert: [], update: [], delete: [second], isSuppressLog: false }],
        ]);
    });

    it('[EH-1.6][EH-3.3] logs a failed recording lookup and queues that deletion immediately', () => {
        const failure = new Error('lookup failed');
        const { harness, ledger } = setup([], () => {
            throw failure;
        });
        const ending = makeReserve({ id: 441, endAt: PAST });

        harness.callbacks.reserve.setUpdated({ delete: [ending], isSuppressLog: false });

        expect(ledger).toEqual(['accept', 'delete:441']);
        expect(harness.logger.system.error.mock.calls).toEqual([[failure]]);
    });

    it('[EH-3.2][EH-3.3] keeps the startup rebuild exclusion and the other entries while holding a deletion', () => {
        const { harness, ledger } = setup([451]);
        const ending = makeReserve({ id: 451, endAt: PAST });
        const other = makeReserve({ id: 452, endAt: FUTURE });

        harness.callbacks.reserve.setUpdated({
            insert: [makeReserve({ id: 453 })],
            update: [makeReserve({ id: 454 })],
            delete: [ending, other],
            isSuppressLog: false,
            isStartupRebuild: true,
        });

        expect(ledger).toEqual(['accept', 'add:453', 'delete:452']);
    });

    it('[EH-3.3] passes a diff without deletions through unchanged', () => {
        const { harness, recordingManage } = setup([461]);
        const diff = { insert: [makeReserve({ id: 461, endAt: PAST })], isSuppressLog: false };

        harness.callbacks.reserve.setUpdated(diff);

        expect(recordingManage.hasReserve).not.toHaveBeenCalled();
        expect(harness.externalCommandManage.addUpdateReseves).toHaveBeenCalledExactlyOnceWith(diff);
    });
});
