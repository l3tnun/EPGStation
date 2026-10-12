import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { compiled, logger } from './_media-harness';

/*
 * `fs` を差し替えた media-delivery の test は、書き込み途中の録画 file を再生する TailStream を偽物で置く。
 * ここでは本物の file に別の timer で追記しながら、本物の TailStream が追記分をすべて順に返し、
 * 追記が止まった後に終端することを確かめる。
 */

const tail = compiled<any>('lib', 'TailStream.js');
const container = compiled<any>('model', 'ModelContainer.js').default;
const directories: string[] = [];

beforeAll(() => {
    if (!container.isBound('ILoggerModel')) {
        container.bind('ILoggerModel').toConstantValue({ getLogger: logger });
    }
});

afterAll(() => {
    if (container.isBound('ILoggerModel')) {
        container.unbind('ILoggerModel');
    }
});

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

const collect = (stream: Readable): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
        stream.once('end', () => resolve(Buffer.concat(chunks)));
        stream.once('error', reject);
    });

const makeRecording = (initial: string): string => {
    const directory = mkdtempSync(join(tmpdir(), 'epg-tailstream-'));
    directories.push(directory);
    const path = join(directory, 'recording.ts');
    writeFileSync(path, initial);
    return path;
};

describe('TailStream on a file that is still being appended', () => {
    it('[MD-DOUBLE-PARITY-TAIL] returns every appended chunk in order and ends after the writer stops', async () => {
        const path = makeRecording('chunk-0;');
        const stream = tail.createReadStream(path, { start: 0 }) as Readable;
        const received = collect(stream);

        let appended = 0;
        const writer = setInterval(() => {
            appended += 1;
            appendFileSync(path, `chunk-${appended};`);
            if (appended === 5) clearInterval(writer);
        }, 150);

        try {
            const data = await received;
            expect(data.toString('utf8')).toBe('chunk-0;chunk-1;chunk-2;chunk-3;chunk-4;chunk-5;');
            expect(appended).toBe(5);
            expect(stream.readableEnded).toBe(true);
            expect(stream.destroyed).toBe(true);
        } finally {
            clearInterval(writer);
            stream.destroy();
        }
    }, 20_000);

    it('[MD-DOUBLE-PARITY-TAIL] starts from the requested byte offset of the growing file', async () => {
        const path = makeRecording('0123456789');
        const stream = tail.createReadStream(path, { start: 4 }) as Readable;
        const received = collect(stream);
        const writer = setTimeout(() => appendFileSync(path, 'abcdef'), 300);

        try {
            await expect(received).resolves.toEqual(Buffer.from('456789abcdef'));
        } finally {
            clearTimeout(writer);
            stream.destroy();
        }
    }, 20_000);

    it('[MD-DOUBLE-PARITY-TAIL] waits for a file that does not exist yet and returns it once created', async () => {
        const path = makeRecording('placeholder');
        rmSync(path);
        const stream = tail.createReadStream(path, { start: 0 }) as Readable;
        const received = collect(stream);
        const writer = setTimeout(() => writeFileSync(path, 'late-file'), 400);

        try {
            await expect(received).resolves.toEqual(Buffer.from('late-file'));
        } finally {
            clearTimeout(writer);
            stream.destroy();
        }
    }, 20_000);
});
