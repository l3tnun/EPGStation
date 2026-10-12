import { afterEach, describe, expect, it, vi } from 'vitest';

import { compiled, logger } from './_media-harness';

const HLSFileDeleterModel = compiled<any>('model', 'service', 'stream', 'util', 'HLSFileDeleterModel.js').default;

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Real HLSFileDeleterModel.deleteAllFiles option-null throw (L45–47).
 * Without setOption and without explicit option, public deleteAllFiles rejects HLSFileDeleterOptionIsNull.
 * Scan/list success paths are out of scope.
 */
describe('HLSFileDeleterModel.deleteAllFiles option null (unittest/imp)', () => {
    it('[R2-HLSFILEDELETER-OPTION-NULL] deleteAllFiles rejects when option is unset', async () => {
        const log = logger();
        const model = new HLSFileDeleterModel({ getLogger: () => log });

        await expect(model.deleteAllFiles()).rejects.toThrow('HLSFileDeleterOptionIsNull');
    });
});
