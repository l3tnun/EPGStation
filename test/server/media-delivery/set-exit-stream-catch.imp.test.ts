import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, logger } from './_media-harness';

const RecordedStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedStreamModel.js').default;

/**
 * Real StreamBaseModel.setExitStream catch path (L318–321).
 * Harnesses often mock setExitStream, leaving the throw→log residual unreached.
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

describe('StreamBaseModel.setExitStream callback catch (unittest/imp)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('[R2-SETEXITSTREAM-CATCH] logs when an exit callback throws', async () => {
        const { log, model } = createSubject();
        const boom = new Error('synthetic-exit-callback-failure');
        model.setExitStream(() => {
            throw boom;
        });

        await expect(model.stop()).resolves.toBeUndefined();
        // once handler is async; flush microtasks so rejection-from-async is not required
        await Promise.resolve();

        expect(log.stream.error.mock.calls).toEqual([
            ['exit stream callback error'],
            [boom],
        ]);
    });
});
