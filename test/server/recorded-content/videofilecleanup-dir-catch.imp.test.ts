import 'reflect-metadata';

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const RecordedManageModel = (
    require(join(snapshot, 'model', 'operator', 'recorded', 'RecordedManageModel.js')) as {
        default: new (...args: unknown[]) => {
            videoFileCleanup(): Promise<void>;
        };
    }
).default;
const FileUtil = (
    require(join(snapshot, 'util', 'FileUtil.js')) as {
        default: {
            isEmptyDirectory(dir: string): Promise<boolean>;
            rmdir(dir: string): Promise<void>;
        };
    }
).default;

const temporaryRoots: string[] = [];

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
        rmSync(root, { force: true, recursive: true });
    }
    vi.restoreAllMocks();
});

/**
 * Real RecordedManageModel.videoFileCleanup public path for orphan managed directories.
 * Object.create is forbidden — use the real constructor.
 */
const makeSubject = (options?: { readonly orphanName?: string }) => {
    const systemLog = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const root = mkdtempSync(join(tmpdir(), 'epgstation-videofilecleanup-'));
    temporaryRoots.push(root);
    const orphanDir = join(root, options?.orphanName ?? 'orphan-empty');
    mkdirSync(orphanDir);
    const rmdirFailure = new Error('SyntheticRmdirFailure');
    const model = new RecordedManageModel(
        { getLogger: () => ({ system: systemLog }) },
        {
            getConfig: () => ({
                dropLog: join(root, 'drop-log'),
                recorded: [{ name: 'main', path: root }],
                recordedHistoryRetentionPeriodDays: 7,
                thumbnail: join(root, 'thumbnail'),
            }),
        },
        { findId: vi.fn(), deleteOnce: vi.fn() },
        {
            findAll: vi.fn(async () => []),
            findId: vi.fn(),
            deleteOnce: vi.fn(),
        },
        { deleteOnce: vi.fn() },
        { deleteOnce: vi.fn() },
        { delete: vi.fn() },
        { cancel: vi.fn(), hasReserve: vi.fn() },
        { emitDeleteRecorded: vi.fn(), emitDeleteVideoFile: vi.fn() },
        {
            getFullFilePathFromId: vi.fn(),
            getFullFilePathFromVideoFile: vi.fn(),
        },
        { formatFilePathString: vi.fn() },
    );
    return { model, orphanDir, rmdirFailure, systemLog };
};

describe('RecordedManageModel.videoFileCleanup directory catch (unittest/imp)', () => {
    it('[R2-RECORDED-VIDEOFILECLEANUP-DIR-CATCH] rmdir reject logs pair and cleanup resolves', async () => {
        const { model, orphanDir, rmdirFailure, systemLog } = makeSubject();
        const rmdir = vi.spyOn(FileUtil, 'rmdir').mockRejectedValue(rmdirFailure);

        await expect(model.videoFileCleanup()).resolves.toBeUndefined();

        expect(rmdir).toHaveBeenCalledWith(orphanDir);
        expect(systemLog.error).toHaveBeenCalledWith(`failed to delete directory: ${orphanDir}`);
        expect(systemLog.error).toHaveBeenCalledWith(rmdirFailure);
        expect(systemLog.info).toHaveBeenCalledWith('start video files cleanup completed');
    });
});

describe('RecordedManageModel.videoFileCleanup not-empty warn (unittest/imp)', () => {
    /**
     * Public videoFileCleanup not-empty warn (L1246–1248).
     * Orphan managed directory reports not empty via FileUtil.isEmptyDirectory false → warn; rmdir skipped.
     * (A real residual file would be unlinked first as an orphan file, so emptiness is controlled at FileUtil.)
     */
    it('[R2-RECORDED-VIDEOFILECLEANUP-NOTEMPTY-WARN] non-empty orphan dir warns and skips rmdir', async () => {
        const { model, orphanDir, systemLog } = makeSubject({ orphanName: 'orphan-nonempty' });
        const isEmptyDirectory = vi.spyOn(FileUtil, 'isEmptyDirectory').mockResolvedValue(false);
        const rmdir = vi.spyOn(FileUtil, 'rmdir').mockResolvedValue(undefined);

        await expect(model.videoFileCleanup()).resolves.toBeUndefined();

        expect(isEmptyDirectory).toHaveBeenCalledWith(orphanDir);
        expect(systemLog.warn).toHaveBeenCalledWith(`directory is not empty: ${orphanDir}`);
        expect(rmdir).not.toHaveBeenCalled();
        expect(systemLog.info).toHaveBeenCalledWith('start video files cleanup completed');
    });
});
