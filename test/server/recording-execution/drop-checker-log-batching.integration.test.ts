import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { load, logger } from './_harness';

const DropCheckerModel = load<new (...args: any[]) => any>('model', 'operator', 'recording', 'DropCheckerModel.js');

const packet = (pid: number, cc: number, scrambled = false, error = false): Buffer => {
    const data = Buffer.alloc(188);
    data[0] = 0x47;
    data[1] = ((pid >> 8) & 0x1f) | (error ? 0x80 : 0);
    data[2] = pid & 0xff;
    data[3] = 0x10 | (cc & 15) | (scrambled ? 0x80 : 0);
    return data;
};

describe('DropChecker batching across real TS and log file boundaries', () => {
    it('retains per-PID scrambling counts without writing per-packet details', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-synthetic-scrambling-'));
        const checker = new DropCheckerModel({ getLogger: () => logger });
        const source = new PassThrough();
        try {
            await checker.prepare(root, 'synthetic-scrambled.ts');
            checker.attach('synthetic-scrambled.ts', source);
            const packets = Array.from({ length: 5000 }, (_, i) => packet(0x0100, i, true));
            source.end(Buffer.concat(packets));
            const result = await checker.getResult();
            await checker.stop();
            expect(result[0x0100]).toEqual({ packet: 5000, drop: 0, error: 0, scrambling: 5000 });
            const log = await readFile(checker.getFilePath(), 'utf8');
            expect(log).toBe('\npid: 0x0100, error: 0, drop: 0, scrambling: 5000, packet: 5000, name: -\n');
            await checker.stop();
            expect(await readFile(checker.getFilePath(), 'utf8')).toBe(log);
        } finally {
            await checker.stop();
            source.destroy();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('writes ordered details before summaries and flushes a partial batch on stop', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-synthetic-details-'));
        const checker = new DropCheckerModel({ getLogger: () => logger });
        const source = new PassThrough();
        try {
            await checker.prepare(root, 'synthetic-details.ts');
            checker.attach('synthetic-details.ts', source);
            source.write(Buffer.concat([packet(0x0100, 0), packet(0x0100, 2), packet(0x0101, 0, false, true)]));
            await checker.stop();
            const result = await checker.getResult();
            expect(result[0x0100]).toMatchObject({ packet: 2, drop: 1 });
            expect(result[0x0101]).toMatchObject({ packet: 1, error: 1 });
            const log = await readFile(checker.getFilePath(), 'utf8');
            expect(log).toBe(
                'drop (pid: 0x0100, counter: 2, expected: 1, time: -)\n' +
                    'error: (pid: 0x0101, counter: -, expected: -, time: -)\n' +
                    '\npid: 0x0100, error: 0, drop: 1, scrambling: 0, packet: 2, name: -\n' +
                    'pid: 0x0101, error: 1, drop: 0, scrambling: 0, packet: 1, name: -\n',
            );
        } finally {
            await checker.stop();
            source.destroy();
            await rm(root, { recursive: true, force: true });
        }
    });
});
