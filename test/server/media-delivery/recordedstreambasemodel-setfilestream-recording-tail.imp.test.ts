import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiledSnapshot, fakeChild, logger } from './_media-harness';

const tailStreamPath = join(compiledSnapshot, 'lib', 'TailStream.js');
const recordedStreamModelPath = join(compiledSnapshot, 'model', 'service', 'stream', 'RecordedStreamModel.js');

/**
 * Real RecordedStreamBaseModel.setFileStream in-progress-recording branch (L398–402).
 * Existing tests either mock setFileStream entirely or exercise only the not-recording
 * (`fs.createReadStream`) path; a `.ts` source still being recorded must read through
 * TailStream's `createReadStream` instead so a concurrent writer does not truncate the read.
 *
 * `import * as fst from '.../TailStream.js'` resolves through Node's ESM loader for the
 * compiled dist (the same dual-module-graph hazard `_media-harness.ts` documents for
 * `child_process`/`axios`), so `vi.spyOn` on the object `compiled('lib', 'TailStream.js')`
 * returns cannot reach RecordedStreamModel's own binding, and the frozen module namespace also
 * rejects `spyOn` outright. `vi.doMock` + `vi.resetModules()` + a dynamic `import()` of the
 * compiled model is what actually substitutes it (mirrors `prepareApiUtil` in the harness).
 */
describe('RecordedStreamBaseModel.setFileStream in-progress recording (unittest/imp)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.doUnmock(tailStreamPath);
    });

    it('[R2-RECORDED-SETFILESTREAM-TAIL] reads a still-recording ts source through TailStream.createReadStream', async () => {
        const tailReadStream = new PassThrough();
        const createReadStream = vi.fn(() => tailReadStream);
        vi.doMock(tailStreamPath, () => ({ createReadStream }));
        vi.resetModules();
        const RecordedStreamModel = ((await import(recordedStreamModelPath)) as { default: new (...args: any[]) => any })
            .default;

        const log = logger();
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'recorded-tail-stream-handle' });
        const createManaged = vi.fn(async () => ({ child, handle }));
        const videoFileDB = { findId: vi.fn(async () => ({ id: 1, recordedId: 2, type: 'ts' })) };
        const recordedDB = { findId: vi.fn(async () => ({ isRecording: true })) };
        const videoUtil = {
            getFullFilePathFromId: vi.fn(async () => 'synthetic-recording.ts'),
            getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 480 })),
        };
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: () => log },
            { createHlsWriter: vi.fn(), createManaged, requestStop: vi.fn(), stopHls: vi.fn() },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            videoFileDB,
            recordedDB,
            videoUtil,
        );
        model.setOption({ cmd: '%NODE% synthetic-recorded-tail', playPosition: 4, videoFileId: 1 }, 0);

        await expect(model.start(0)).resolves.toBeUndefined();

        // bitRate(8)/8 * playPosition(4) == 4
        expect(createReadStream).toHaveBeenCalledExactlyOnceWith('synthetic-recording.ts', { start: 4 });
        expect(model.fileStream).toBe(tailReadStream);
        await model.stop();
    });
});
