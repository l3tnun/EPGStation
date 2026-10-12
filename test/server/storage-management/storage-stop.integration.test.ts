import { spawn as realSpawn, type ChildProcess } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStorageManager, type StorageManagerRuntime } from './_storage-harness';

/*
 * 監視の停止（SIGTERM などで server が止まるとき StorageManageModel.stop が呼ばれる）を、実時間の timer・実 file・
 * 実 process で確かめる。空き容量の取得は本物の diskusage（実 file system）、限界 command は本物の子 process。
 * 実 file system の空きが閾値以下になる状況は、閾値を実際の空きより大きくして作る。
 */

const alwaysLow = 1_000_000_000_000;
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

let root: string;
let running: StorageManagerRuntime | undefined;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'epgstation-storage-stop-'));
});

afterEach(async () => {
    running?.stop();
    running = undefined;
    await rm(root, { force: true, recursive: true });
});

const markerLines = async (path: string): Promise<number> =>
    (await readFile(path, 'utf8').catch(() => '')).split('\n').filter(line => line !== '').length;

describe('storage monitoring stop with real timers, files, and processes', () => {
    it('[SM-5.1][SM-5.2] runs no capacity check or limit command after stop, past several monitoring intervals', async () => {
        const marker = join(root, 'marker.txt');
        const { logger, manager } = createStorageManager({
            entries: [
                {
                    action: 'none',
                    limitCmd: `%NODE% -e require('fs').appendFileSync(process.argv[1],'x\\n') ${marker}`,
                    limitThreshold: alwaysLow,
                    name: 'real-capacity',
                    path: root,
                },
            ],
            intervalSeconds: 1,
        });
        running = manager;

        manager.start();
        await vi.waitFor(async () => expect(await markerLines(marker)).toBeGreaterThanOrEqual(2), {
            interval: 100,
            timeout: 8_000,
        });
        manager.stop();
        await vi.waitFor(() => expect(manager.isRunning).toBe(false), { timeout: 5_000 });
        await sleep(300);
        const linesAtStop = await markerLines(marker);
        const commandLogsAtStop = logger.system.info.mock.calls.filter(([text]) =>
            String(text).startsWith('run storage limit cmd'),
        ).length;

        await sleep(2_600);

        expect(await markerLines(marker)).toBe(linesAtStop);
        expect(
            logger.system.info.mock.calls.filter(([text]) => String(text).startsWith('run storage limit cmd')).length,
        ).toBe(commandLogsAtStop);
        expect(manager.isRunning).toBe(false);
    }, 20_000);

    it('[SM-5.3] returns from stop without waiting for a deletion in progress, and lets that deletion finish on the real file', async () => {
        const recordedFile = join(root, 'recorded.ts');
        await writeFile(recordedFile, 'recorded');
        let deletionFinishedAt = 0;
        const { deleteRecorded, manager } = createStorageManager({
            deleteRecorded: async () => {
                await sleep(500);
                await unlink(recordedFile);
                deletionFinishedAt = Date.now();
            },
            entries: [{ action: 'remove', limitThreshold: 1, name: 'slow-delete', path: root }],
            findOld: async () => ({ id: 81 }),
            intervalSeconds: 1,
        });
        running = manager;
        const reads = vi
            .fn<(path: string) => Promise<number>>()
            .mockResolvedValueOnce(0)
            .mockResolvedValue(2 * 1024 * 1024);
        manager.getFreeSize = reads;

        manager.start();
        await vi.waitFor(() => expect(deleteRecorded).toHaveBeenCalledWith(81), { interval: 20, timeout: 5_000 });

        const before = Date.now();
        manager.stop();
        await expect(access(recordedFile)).resolves.toBeUndefined();
        expect(deletionFinishedAt).toBe(0);

        await vi.waitFor(() => expect(manager.isRunning).toBe(false), { interval: 20, timeout: 5_000 });
        expect(deletionFinishedAt).toBeGreaterThan(before);
        await expect(access(recordedFile)).rejects.toMatchObject({ code: 'ENOENT' });
        const readsAfterSettle = reads.mock.calls.length;

        await sleep(2_300);

        expect(deleteRecorded).toHaveBeenCalledTimes(1);
        expect(reads.mock.calls.length).toBe(readsAfterSettle);
    }, 20_000);

    it('[SM-5.4] kills a long-running limit command at its deadline even though the periodic monitor was stopped', async () => {
        const children: ChildProcess[] = [];
        const { logger, manager } = createStorageManager({
            entries: [
                {
                    action: 'none',
                    limitCmd: '%NODE% -e setInterval(()=>{},1000)',
                    limitThreshold: alwaysLow,
                    name: 'long-command',
                    path: root,
                },
            ],
            intervalSeconds: 1,
            spawn: (bin, args, options) => {
                const child = realSpawn(bin, [...args], options as never);
                children.push(child);
                return child;
            },
            storageLimitCommandTimeoutMs: 600,
        });
        running = manager;

        manager.start();
        await vi.waitFor(() => expect(children).toHaveLength(1), { interval: 20, timeout: 5_000 });
        const child = children[0];
        const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve =>
            child.once('close', (code, signal) => resolve({ code, signal })),
        );
        await vi.waitFor(() => expect(child.pid).toBeGreaterThan(0));

        manager.stop();
        expect(child.exitCode).toBeNull();
        expect(child.signalCode).toBeNull();

        await expect(closed).resolves.toEqual({ code: null, signal: 'SIGKILL' });
        expect(logger.system.error).toHaveBeenCalledWith(expect.stringContaining('limit cmd timeout'));
        await vi.waitFor(() => expect(manager.isRunning).toBe(false), { timeout: 5_000 });

        await sleep(2_300);

        expect(children).toHaveLength(1);
        expect(() => process.kill(child.pid as number, 0)).toThrow(/ESRCH/u);
    }, 20_000);
});
