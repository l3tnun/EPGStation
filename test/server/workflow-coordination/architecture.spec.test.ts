import { describe, expect, it } from 'vitest';

import { flushImmediate, makeReserve, makeSetter } from '../event-and-hook-delivery/_harness';

describe('workflow handoff architecture contract', () => {
    it('[PRIMARY WC-6.7][WC-6.7] isolates a rejected UI handoff from the independently selected semantic Hook without retrying either', async () => {
        const uiFailure = new Error('synthetic preparation UI rejection');
        const unhandled: unknown[] = [];
        const recordUnhandled = (reason: unknown) => unhandled.push(reason);
        const reserve = makeReserve({ id: 71 });
        const harness = makeSetter();
        harness.ipc.notifyClient.mockImplementation(() => Promise.reject(uiFailure));
        harness.setter.set();
        process.prependListener('unhandledRejection', recordUnhandled);

        try {
            expect(harness.callbacks.recording.setStartPrepRecording(reserve)).toBeUndefined();
            await flushImmediate();

            expect(harness.ipc.notifyClient.mock.calls).toEqual([[]]);
            expect(harness.externalCommandManage.addRecordingPrepStartCmd.mock.calls).toEqual([[reserve]]);
            expect(harness.logger.system.error.mock.calls).toEqual([[uiFailure]]);
            expect(unhandled).toEqual([]);
        } finally {
            process.removeListener('unhandledRejection', recordUnhandled);
        }
    });
});
