import 'reflect-metadata';

import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { logger, makeReserve } from './_harness';
import {
    chunk,
    createRealTuner,
    ExecutionManagementModel,
    insertReserve,
    withSqlite,
    wireRecording,
} from './_real-tuner-wiring';

/*
 * 録画先（保存先・file 名）の選択を、本物の実行権（`ExecutionManagementModel`）・実 file system・実 SQLite・
 * 実 HTTP の tuner server の上で確かめる。録画先の選択は実行権を優先度 1・最大 5 秒の待機で取り、
 * 選択が終わったら（成功しても失敗しても）解放する。時計は実時計。
 */

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const createExecution = () => new ExecutionManagementModel({ getLogger: () => logger });
const files = async (root: string) => (await readdir(root)).filter(name => name.endsWith('.ts')).sort();

describe('recordings that start together and choose their recording files through the real execution right', () => {
    it('[RE-REAL-PATH-SERIAL] gives eight recordings with the same file name eight distinct files, one exclusively created file each', async () => {
        await withSqlite(async (source, root) => {
            const tuner = await createRealTuner();
            const wired = wireRecording(source, root, tuner, {
                config: { recordedFormat: '%TITLE%' },
                execution: createExecution(),
                tuners: Array.from({ length: 8 }, () => ({ types: ['GR'] })),
            });
            try {
                const ids = Array.from({ length: 8 }, (_unused, index) => 1 + index);
                for (const id of ids) {
                    await insertReserve(source, { id, programId: 100 + id, channelId: id, channel: `ch-${id}` });
                }
                const recorders = await wired.startAll(ids);
                const preparations = ids.map(id => recorders.get(id).startPreparation());
                for (const id of ids) {
                    const sender = await tuner.sender(100 + id);
                    await sender.write(chunk(id));
                }
                await Promise.all(preparations);
                await vi.waitFor(() => expect(wired.started).toHaveBeenCalledTimes(8));

                expect(await files(root)).toEqual([
                    'synthetic-program(1).ts',
                    'synthetic-program(2).ts',
                    'synthetic-program(3).ts',
                    'synthetic-program(4).ts',
                    'synthetic-program(5).ts',
                    'synthetic-program(6).ts',
                    'synthetic-program(7).ts',
                    'synthetic-program.ts',
                ]);
                const registered = (await wired.videoFileDB.findAll()).map(
                    (videoFile: { filePath: string }) => videoFile.filePath,
                );
                expect(new Set(registered).size).toBe(8);
            } finally {
                await wired.shutdown();
                await tuner.close();
            }
        });
    }, 60_000);
});

const withSelection = async (
    operation: (context: { execution: any; root: string; wired: any }) => Promise<void>,
): Promise<void> =>
    withSqlite(async (source, root) => {
        const tuner = await createRealTuner();
        const execution = createExecution();
        // 2 つ目の保存先は directory ではなく通常の file を指すので、そこでの選択は失敗する。
        const notDirectory = join(root, 'not-a-directory');
        await writeFile(notDirectory, 'file');
        const wired = wireRecording(source, root, tuner, {
            config: {
                recordedFormat: '%TITLE%',
                recorded: [
                    { name: 'good', path: root },
                    { name: 'broken', path: notDirectory },
                ],
            },
            execution,
        });
        try {
            await operation({ execution, root, wired });
        } finally {
            await wired.shutdown();
            await tuner.close();
        }
    });

describe('the execution right that a recording file selection waits for and releases', () => {
    it('[RE-REAL-PATH-EXECUTION-RIGHT] makes a path selection wait while another holder has the execution right, and selects the file after the right is released', async () => {
        await withSelection(async ({ execution, root, wired }) => {
            const holderId = await execution.getExecution(1);
            const reserve = makeReserve({ id: 1, programId: 11, name: 'waiting' });
            let settled = false;
            const pending = wired.recordingUtil.getRecPath(reserve, false, true).finally(() => (settled = true));

            await delay(700);
            expect(settled).toBe(false);
            expect(await files(root)).toEqual([]);

            execution.unLockExecution(holderId);
            const selected = await pending;
            await selected.fileHandle.close();
            expect(await files(root)).toEqual(['waiting.ts']);
        });
    }, 30_000);

    it('[RE-REAL-PATH-EXECUTION-TIMEOUT] fails the path selection about five seconds after it started waiting for the execution right, without creating any file', async () => {
        await withSelection(async ({ execution, root, wired }) => {
            await execution.getExecution(1);
            const reserve = makeReserve({ id: 2, programId: 12, name: 'late' });
            const startedAt = Date.now();

            await expect(wired.recordingUtil.getRecPath(reserve, false, true)).rejects.toBeInstanceOf(Error);
            const waited = Date.now() - startedAt;
            expect(waited).toBeGreaterThanOrEqual(4_900);
            expect(waited).toBeLessThan(9_000);
            expect(await files(root)).toEqual([]);
        });
    }, 30_000);

    it('[RE-REAL-PATH-EXECUTION-RELEASE] releases the execution right after a selection fails and after one succeeds, so the next selection starts at once', async () => {
        await withSelection(async ({ execution, root, wired }) => {
            const broken = makeReserve({ id: 3, programId: 13, name: 'broken', parentDirectoryName: 'broken' });
            await expect(wired.recordingUtil.getRecPath(broken, false, true)).rejects.toBeInstanceOf(Error);

            const startedAt = Date.now();
            const next = await wired.recordingUtil.getRecPath(
                makeReserve({ id: 4, programId: 14, name: 'next' }),
                false,
                true,
            );
            await next.fileHandle.close();
            expect(Date.now() - startedAt).toBeLessThan(4_000);
            // 成功した後も、実行権はすぐ取れる。
            execution.unLockExecution(await execution.getExecution(1, 500));
            expect(await files(root)).toEqual(['next.ts']);
        });
    }, 30_000);
});
