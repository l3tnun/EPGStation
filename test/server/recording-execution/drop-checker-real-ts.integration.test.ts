import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSyntheticMedia } from '../harness/synthetic-media';
import { load, logger, makeDropCheckerWriteTracker } from './_harness';

/*
 * 録画の test の drop checker は、結果が `{}` の偽物か、188 byte の倍数の合成の packet（先頭の byte だけ sync byte）を
 * 受ける本物である。本物の DropCheckerModel に本物の ffmpeg が作った TS を、tuner の socket と同じく 188 byte の倍数で
 * ない大きさの chunk で、また packet の途中から始まる形で流し、数える drop・error・scrambling を確かめる。
 */

const DropCheckerModel = load<new (...args: any[]) => any>('model', 'operator', 'recording', 'DropCheckerModel.js');

let root: string;
let ts: Buffer;

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'epgstation-dropcheck-real-ts-'));
    ts = await readFile(await createSyntheticMedia(root, 'synthetic-source.ts', 'mpegts', 4));
}, 120_000);

afterAll(async () => {
    await rm(root, { force: true, recursive: true });
});

const check = async (name: string, data: Buffer, chunkSize: number) => {
    const writes = makeDropCheckerWriteTracker();
    const checker = writes.track(new DropCheckerModel({ getLogger: () => logger }));
    const source = join(root, `${name}.ts`);
    const stream = new PassThrough();
    try {
        await checker.prepare(root, source);
        checker.attach(source, stream);
        for (let offset = 0; offset < data.length; offset += chunkSize) {
            stream.write(data.subarray(offset, offset + chunkSize));
            await new Promise(resolve => setImmediate(resolve));
        }
        stream.end();
        const result = (await checker.getResult()) as Record<
            string,
            { drop: number; error: number; scrambling: number }
        >;
        // 結果の通知の後も PID ごとのログ追記が続くため、実際の書込み完了を待つ。
        await writes.settle();
        const log = await readFile(checker.getFilePath(), 'utf8');
        const pids = Object.keys(result).length;
        expect(log.split('\n').filter(line => line.startsWith('pid: '))).toHaveLength(pids);
        const totals = { drop: 0, error: 0, scrambling: 0 };
        for (const counts of Object.values(result)) {
            totals.drop += counts.drop;
            totals.error += counts.error;
            totals.scrambling += counts.scrambling;
        }
        return { totals, pids, log };
    } finally {
        stream.destroy();
        try {
            await checker.stop();
        } finally {
            await writes.settle();
        }
    }
};

describe('drop checker against real TS data and socket-like chunk boundaries', () => {
    it('[RE-DOUBLE-PARITY-DROPCHECK] counts no drop, error, or scrambling for a real TS in packet-aligned and in 1000-byte chunks', async () => {
        const aligned = await check('aligned', ts, 188 * 7);
        const unaligned = await check('unaligned-chunks', ts, 1_000);

        expect(aligned.totals).toEqual({ drop: 0, error: 0, scrambling: 0 });
        expect(aligned.pids).toBeGreaterThan(0);
        expect(unaligned).toEqual(aligned);
    }, 60_000);

    it('[RE-DOUBLE-PARITY-DROPCHECK] counts no error when the received stream starts in the middle of a packet', async () => {
        const fromMiddle = await check('from-middle', ts.subarray(1_000), 1_000);

        expect(fromMiddle.totals).toEqual({ drop: 0, error: 0, scrambling: 0 });
    }, 60_000);
});
