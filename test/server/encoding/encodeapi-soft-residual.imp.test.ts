import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const EncodeApiModel = (
    require(join(snapshot, 'model', 'api', 'encode', 'EncodeApiModel.js')) as {
        default: new (...args: unknown[]) => {
            getAll(isHalfWidth: boolean): Promise<{ runningItems: unknown[]; waitItems: unknown[] }>;
            add(option: Record<string, unknown>): Promise<number>;
        };
    }
).default;

/**
 * residual-4214 G1: EncodeApiModel soft residual.
 * - getAll: runningQueue recordedId missing from recordedIndex → continue L71–73
 * - add: isSaveSameDirectory + basename-only filePath → directory=null L131–133
 * Real EncodeApiModel; DB/manage seams stubbed only.
 */
afterEach(() => {
    vi.restoreAllMocks();
});

describe('EncodeApiModel soft residual (unittest/imp)', () => {
    it('[R2-ENCODEAPI-SOFT-RESIDUAL] skips missing recorded and omits directory for basename-only paths', async () => {
        const convertRecordedToRecordedItem = vi.fn((recorded: { id: number }) => recorded);
        const getAllApi = new EncodeApiModel(
            {
                getEncodeInfo: () => ({
                    runningQueue: [{ id: 7, mode: 'running', recordedId: 9001 }],
                    waitQueue: [],
                }),
            },
            {},
            { findIds: vi.fn(async () => []) },
            { convertRecordedToRecordedItem },
        );

        await expect(getAllApi.getAll(false)).resolves.toEqual({
            runningItems: [],
            waitItems: [],
        });
        expect(convertRecordedToRecordedItem).not.toHaveBeenCalled();

        const push = vi.fn(async () => 55);
        const findId = vi.fn(async () => ({
            filePath: 'video.ts',
            parentDirectoryName: 'synthetic-parent',
        }));
        const addApi = new EncodeApiModel({ push }, { findId }, {}, {});

        await expect(
            addApi.add({
                mode: 'synthetic-mode',
                recordedId: 101,
                removeOriginal: false,
                sourceVideoFileId: 202,
                isSaveSameDirectory: true,
            }),
        ).resolves.toBe(55);

        expect(push).toHaveBeenCalledExactlyOnceWith({
            mode: 'synthetic-mode',
            parentDir: 'synthetic-parent',
            recordedId: 101,
            removeOriginal: false,
            sourceVideoFileId: 202,
        });
    });
});
