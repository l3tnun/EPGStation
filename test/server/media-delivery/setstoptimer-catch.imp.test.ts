import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, logger } from './_media-harness';

const RecordedStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedStreamModel.js').default;

/**
 * Real StreamBaseModel.setStopTimer stop catch path (L500–503).
 * 15s idle timer awaits stop(); reject → log pair 'stop stream error' + err.
 * Use public keep() to arm the protected timer; mock stop to reject.
 */
const createSubject = () => {
    const log = logger();
    const model = new RecordedStreamModel(
        { getConfig: () => baseConfig() },
        { getLogger: () => log },
        {
            createHlsWriter: vi.fn(),
            createManaged: vi.fn(),
            requestStop: vi.fn(),
            stopHls: vi.fn(),
        },
        { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
        { notifyClient: vi.fn() },
        { findId: vi.fn(async () => null) },
        { findId: vi.fn(async () => null) },
        { getFullFilePathFromId: vi.fn(async () => null) },
    );
    return { log, model };
};

describe('StreamBaseModel.setStopTimer stop catch (unittest/imp)', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('[R2-SETSTOPTIMER-CATCH] logs when keep timer stop rejects', async () => {
        vi.useFakeTimers();
        const { log, model } = createSubject();
        const boom = new Error('synthetic-stop-timer-failure');
        model.stop = vi.fn(async () => {
            throw boom;
        });

        model.keep();
        await vi.advanceTimersByTimeAsync(15_000);
        await Promise.resolve();

        expect(log.stream.error.mock.calls).toEqual([['stop stream error'], [boom]]);
        expect(model.stop).toHaveBeenCalledOnce();
    });
});
