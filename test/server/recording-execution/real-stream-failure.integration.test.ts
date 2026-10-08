import 'reflect-metadata';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { CHUNK_SIZE, chunk, createRealTuner, insertReserve, withSqlite, wireRecording } from './_real-tuner-wiring';

/*
 * 録画の途中で tuner server が接続を切ったときの録画を、実 HTTP の tuner server・実 SQLite・実 file system の
 * 上で確かめる。録画失敗と録画終了の通知、DB の録画の状態、切れる前に届いた data が file に残ることを見る。
 */

describe('a tuner server that drops the connection while a recording is running', () => {
    it('[RE-REAL-STREAM-CUT] reports the recording failure and the recording end, keeps the data received before the cut, and marks the recording finished', async () => {
        await withSqlite(async (source, root) => {
            const tuner = await createRealTuner();
            const wired = wireRecording(source, root, tuner);
            try {
                await insertReserve(source, { id: 1, programId: 11 });
                const recorder = (await wired.startAll([1])).get(1);
                const preparation = recorder.startPreparation();
                const response = await tuner.server.response(11);
                const sender = await tuner.sender(11);
                await sender.write(chunk(0));
                await preparation;
                await vi.waitFor(() => expect(wired.started).toHaveBeenCalledOnce());
                for (let index = 1; index < 5; index++) await sender.write(chunk(index));

                response.socket?.destroy();

                await vi.waitFor(() => expect(wired.failed).toHaveBeenCalledOnce());
                await vi.waitFor(() => expect(wired.finished).toHaveBeenCalledOnce());
                expect(wired.prepFailed).not.toHaveBeenCalled();
                const [recorded] = await wired.recordedDB.findReserveId(1);
                expect(recorded.isRecording).toBe(false);
                const [videoFile] = await wired.videoFileDB.findAll();
                const file = await readFile(join(root, videoFile.filePath));
                expect(file.length).toBe(5 * CHUNK_SIZE);
                expect(file.equals(Buffer.concat([0, 1, 2, 3, 4].map(chunk)))).toBe(true);
            } finally {
                await wired.shutdown();
                await tuner.close();
            }
        });
    }, 30_000);
});
