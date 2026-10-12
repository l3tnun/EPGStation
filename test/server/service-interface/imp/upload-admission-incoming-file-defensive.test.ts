import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { compiled } from '../_harness';

/**
 * `IncomingUploadFile.removeExact` (UploadAdmissionController.ts:129-140) has two defensive arms
 * that its only two real callers (`unlink`/`rmdir` from `node:fs/promises`, wired in
 * `cleanupOwnedPaths`) never exercise, because Node's `fs/promises` rejections are always `Error`
 * instances:
 *   - the ternary's non-Error fallback (`String(error)`), reached only when the rejection is not
 *     an `Error`;
 *   - the inner `try { this.logger.error(...) } catch {}` around the cleanup log itself.
 * Both are reachable through error injection: replacing the `node:fs/promises` binding the module
 * imports (an ESM static binding, so `vi.doMock` + `vi.resetModules` + a fresh dynamic `import()`
 * is required -- mirrors `recorded-content/_probe-harness.ts`) for the first, and a logger stub
 * that throws for the second. This file loads its own isolated copy of
 * `UploadAdmissionController.js` so it does not disturb `upload-lifecycle.test.ts`'s shared,
 * already-mocked module graph.
 */
const uploadAdmissionControllerPath = compiled('model', 'service', 'upload', 'UploadAdmissionController.js');

const loadIncomingUploadFile = async (fsPromisesOverrides?: {
    rmdir?: (path: string) => Promise<void>;
    unlink?: (path: string) => Promise<void>;
}): Promise<any> => {
    if (fsPromisesOverrides !== undefined) {
        const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
        const mocked = {
            ...actual,
            rmdir: fsPromisesOverrides.rmdir ?? actual.rmdir,
            unlink: fsPromisesOverrides.unlink ?? actual.unlink,
        };
        vi.doMock('node:fs/promises', () => mocked);
    }
    try {
        vi.resetModules();
        const imported = (await import(uploadAdmissionControllerPath)) as { IncomingUploadFile: any };
        return imported.IncomingUploadFile;
    } finally {
        vi.doUnmock('node:fs/promises');
    }
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('IncomingUploadFile.removeExact defensive arms (unittest/imp)', () => {
    it('falls back to String(error) when the underlying fs rejection is not an Error', async () => {
        const IncomingUploadFile = await loadIncomingUploadFile({
            unlink: async () => {
                throw 'synthetic-non-error-rejection';
            },
            rmdir: async () => undefined,
        });
        const logger = { error: vi.fn() };

        await new IncomingUploadFile(
            join('synthetic-root', 'token'),
            join('synthetic-root', 'payload'),
            logger,
        ).cleanupOnce();

        expect(logger.error).toHaveBeenCalledExactlyOnceWith(
            expect.stringContaining('synthetic-non-error-rejection'),
        );
    });

    it('absorbs a logger failure while reporting the cleanup error without rejecting', async () => {
        const IncomingUploadFile = await loadIncomingUploadFile({
            unlink: async () => {
                throw new Error('synthetic unlink failure');
            },
            rmdir: async () => undefined,
        });
        const loggingFailure = new Error('synthetic logger failure');
        const logger = {
            error: vi.fn(() => {
                throw loggingFailure;
            }),
        };

        await expect(
            new IncomingUploadFile(
                join('synthetic-root', 'token'),
                join('synthetic-root', 'payload'),
                logger,
            ).cleanupOnce(),
        ).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalledOnce();
    });
});
