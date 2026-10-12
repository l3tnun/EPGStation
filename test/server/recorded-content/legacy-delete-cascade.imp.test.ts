import 'reflect-metadata';

import { mkdtempSync, rmSync } from 'node:fs';
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
            deleteVideoFile(videoFileId: number, isIgnoreProtection?: boolean): Promise<void>;
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
 * design.md#server-recorded-content の "CURRENT / PLANNED境界" に追記した事実を固定する:
 * `RecordedManageModel.delete()`/`deleteVideoFile()` は死んだcodeではなく、`videoFileCleanup()`
 * (`POST /api/recorded/cleanup` -> `RecordedApiModel.fileCleanup()` -> IPC `videoFileCleanup`) が内部で
 * 依然として呼ぶ。prepared token化された利用者削除・video file単体削除のIPC経路はこの legacy 経路を通らない。
 */
describe('RecordedManageModel legacy delete()/deleteVideoFile() reachability (unittest/imp)', () => {
    it('[design.md#CURRENT/PLANNED境界] videoFileCleanup() deletes the whole recorded row via legacy delete() once its last DB video row is pruned as missing', async () => {
        const root = mktempRoot();
        const systemLog = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
        const emitDeleteRecorded = vi.fn();
        const emitDeleteVideoFile = vi.fn();
        // videoFileDB に1件だけ登録されており、対応する実fileは存在しない (checkFileExistence=false)。
        const videoRows = new Map([[1, { id: 1, filePath: 'missing.ts', parentDirectoryName: 'main', recordedId: 10 }]]);
        const recordedRow = {
            id: 10,
            isProtected: false,
            isRecording: false,
            reserveId: null,
            thumbnails: undefined,
            dropLogFile: undefined,
        };

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
            {
                findId: vi.fn(async (recordedId: number) =>
                    recordedId === 10 ? { ...recordedRow, videoFiles: [...videoRows.values()] } : null,
                ),
                deleteOnce: vi.fn(async () => undefined),
            },
            {
                findAll: vi.fn(async () => [...videoRows.values()]),
                findId: vi.fn(async (videoFileId: number) => videoRows.get(videoFileId) ?? null),
                deleteOnce: vi.fn(async (videoFileId: number) => {
                    videoRows.delete(videoFileId);
                }),
            },
            { deleteOnce: vi.fn() },
            { deleteOnce: vi.fn() },
            { delete: vi.fn() },
            { cancel: vi.fn(), hasReserve: vi.fn(() => false) },
            { emitDeleteRecorded, emitDeleteVideoFile },
            {
                // checkFileExistence()経由の存在確認と、削除の起点となる管理保存先rootの解決に使われる。
                // ここでは実fileが無いことにして、DB行だけの整理を経由させる。
                getFullFilePathFromVideoFile: vi.fn(() => join(root, 'missing.ts')),
                getParentDirPath: vi.fn(() => root),
            },
            { formatFilePathString: vi.fn() },
        );

        await expect(model.videoFileCleanup()).resolves.toBeUndefined();

        // deleteVideoFile()がDB行を削除し、その結果recorded.videoFilesが空になったのでdelete()へ連鎖する。
        expect(videoRows.has(1)).toBe(false);
        expect(emitDeleteVideoFile).not.toHaveBeenCalled();
        expect(emitDeleteRecorded).toHaveBeenCalledWith(expect.objectContaining({ id: 10 }));
    });

    it('[design.md#CURRENT/PLANNED境界] deleteVideoFile() defers straight to legacy delete() while the recorded row is still recording', async () => {
        const root = mktempRoot();
        const systemLog = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
        const emitDeleteRecorded = vi.fn();
        const emitDeleteVideoFile = vi.fn();
        const recordedDeleteOnce = vi.fn(async () => undefined);
        const videoFileDeleteOnce = vi.fn();
        const videoRow = { id: 5, filePath: 'in-progress.ts', parentDirectoryName: 'main', recordedId: 20 };
        const recordedRow = {
            id: 20,
            isProtected: false,
            isRecording: true,
            reserveId: 77,
            videoFiles: [videoRow],
            thumbnails: undefined,
            dropLogFile: undefined,
        };

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
            {
                findId: vi.fn(async (recordedId: number) => (recordedId === 20 ? recordedRow : null)),
                deleteOnce: recordedDeleteOnce,
            },
            {
                findAll: vi.fn(async () => [videoRow]),
                findId: vi.fn(async (videoFileId: number) => (videoFileId === 5 ? videoRow : null)),
                deleteOnce: videoFileDeleteOnce,
                deleteRecordedId: vi.fn(async () => undefined),
            },
            { deleteOnce: vi.fn() },
            { deleteOnce: vi.fn() },
            { delete: vi.fn() },
            // isRecordingがtrueでも、対応するreserveがすでに録画実行機能から見えない(hasReserve=false)ため、
            // delete()はcancel()を呼ばずそのままファイル・DB整理へ進む。
            { cancel: vi.fn(), hasReserve: vi.fn(() => false) },
            { emitDeleteRecorded, emitDeleteVideoFile },
            {
                getFullFilePathFromVideoFile: vi.fn(() => join(root, 'in-progress.ts')),
                getParentDirPath: vi.fn(() => root),
            },
            { formatFilePathString: vi.fn() },
        );

        await expect(model.deleteVideoFile(5)).resolves.toBeUndefined();

        // 録画中はvideo file単体を消さず、whole deleteへ一本化する (videoFileDB.deleteOnceは呼ばれない)。
        expect(videoFileDeleteOnce).not.toHaveBeenCalled();
        expect(recordedDeleteOnce).toHaveBeenCalledWith(20);
        expect(emitDeleteRecorded).toHaveBeenCalledWith(expect.objectContaining({ id: 20 }));
        expect(emitDeleteVideoFile).not.toHaveBeenCalled();
    });
});

function mktempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'epgstation-legacy-delete-cascade-'));
    temporaryRoots.push(root);
    return root;
}
