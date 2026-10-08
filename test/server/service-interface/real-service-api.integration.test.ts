import { statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    fetchJson,
    healthyTunerHandler,
    loopbackUrl,
    reserveUnusedPort,
    serviceAnswers,
    startOperator,
    startTunerStub,
    waitFor,
    withDatabase,
    type OperatorHandle,
    type TunerStub,
} from '../harness/real-operator';

/**
 * Public API contract of the Web/API child over real components: the compiled Operator runs as a real
 * process with its real Service child (real express, OpenAPI layer, and HTTP), a real SQLite file, real
 * recorded files, and a real disk. Wall-clock limits only bound a hung run.
 */

const operators: OperatorHandle[] = [];
const stubs: TunerStub[] = [];

afterEach(async () => {
    await Promise.all(operators.splice(0).map(operator => operator.stop()));
    await Promise.all(stubs.splice(0).map(stub => stub.close()));
});

const launch = async (
    config: readonly string[] = [],
    prepare?: (root: string) => Promise<void>,
): Promise<OperatorHandle> => {
    const stub = await startTunerStub(healthyTunerHandler([{ index: 0, name: 'synthetic-tuner-0', types: ['GR'] }]));
    stubs.push(stub);
    const operator = await startOperator({
        config,
        prepare,
        servicePort: await reserveUnusedPort(),
        tunerPort: stub.port,
    });
    operators.push(operator);
    await waitFor(() => serviceAnswers(operator.servicePort), 'the Service API', () => operator.stdout());
    return operator;
};

interface StorageItem {
    readonly available: number;
    readonly name: string;
    readonly total: number;
    readonly used: number;
}

describe('[SI-2.7] GET /api/storages reports the capacity of each recording storage (real Service and disk)', () => {
    it('returns the configured storages in order with the real capacity of their file system', async () => {
        const operator = await launch([
            "recorded: [{ name: 'first', path: '%ROOT%/recorded' }, { name: 'second', path: '%ROOT%/thumbnail' }]",
        ]);

        const { body, status } = await fetchJson(operator.servicePort, '/api/storages');

        expect(status).toBe(200);
        const items = (body as { items: StorageItem[] }).items;
        expect(items.map(item => item.name)).toEqual(['first', 'second']);
        const real = await statfs(join(operator.root, 'recorded'));
        const realTotal = real.blocks * real.bsize;
        const realAvailable = real.bavail * real.bsize;
        for (const item of items) {
            expect(Object.keys(item).sort()).toEqual(['available', 'name', 'total', 'used']);
            expect(item.total).toBe(realTotal);
            // Other processes may write between the two readings; the difference stays far below a gigabyte.
            expect(Math.abs(item.available - realAvailable)).toBeLessThan(1024 * 1024 * 1024);
            expect(item.used).toBeGreaterThan(0);
            expect(item.used + item.available).toBeLessThanOrEqual(item.total);
        }
    }, 60_000);

    it('answers 500 with the error shape when a configured storage path does not exist', async () => {
        const operator = await launch([
            "recorded: [{ name: 'first', path: '%ROOT%/recorded' }, { name: 'missing', path: '%ROOT%/does-not-exist' }]",
        ]);

        const { body, status } = await fetchJson(operator.servicePort, '/api/storages');

        expect(status).toBe(500);
        expect(body).toMatchObject({ code: 500 });
        expect(typeof (body as { message: unknown }).message).toBe('string');
    }, 60_000);
});

const hour = 3_600_000;

const insertReserve = (
    database: { prepare(sql: string): { run(...parameters: unknown[]): unknown } },
    reserve: { readonly flags: Partial<Record<'isConflict' | 'isOverlap' | 'isSkip', number>>; readonly id: number },
): void => {
    const startAt = Date.now() + (reserve.id + 1) * hour;
    database
        .prepare(
            'INSERT INTO reserve (id, updateTime, isSkip, isConflict, isOverlap, isTimeSpecified, channelId, channel, channelType, startAt, endAt, name) VALUES (?, ?, ?, ?, ?, 1, 1000, ?, ?, ?, ?, ?)',
        )
        .run(
            reserve.id,
            Date.now(),
            reserve.flags.isSkip ?? 0,
            reserve.flags.isConflict ?? 0,
            reserve.flags.isOverlap ?? 0,
            '1000',
            'GR',
            startAt,
            startAt + 1_800_000,
            `reserve ${reserve.id}`,
        );
};

describe('[SI-3.3] GET /api/reserves/lists always returns four arrays (real Service, SQLite)', () => {
    const query = (): string => `/api/reserves/lists?startAt=${Date.now()}&endAt=${Date.now() + 10 * hour}`;

    it('returns four empty arrays when there is no reservation', async () => {
        const operator = await launch();

        const { body, status } = await fetchJson(operator.servicePort, query());

        expect(status).toBe(200);
        expect(body).toEqual({ conflicts: [], normal: [], overlaps: [], skips: [] });
    }, 60_000);

    it('classifies one normal, one conflict, one skip and one overlap reservation into their own arrays', async () => {
        const operator = await launch();
        await withDatabase(operator.root, database => {
            insertReserve(database, { flags: {}, id: 1 });
            insertReserve(database, { flags: { isConflict: 1 }, id: 2 });
            insertReserve(database, { flags: { isSkip: 1 }, id: 3 });
            insertReserve(database, { flags: { isOverlap: 1 }, id: 4 });
        });

        const { body, status } = await fetchJson(operator.servicePort, query());

        expect(status).toBe(200);
        const lists = body as Record<'conflicts' | 'normal' | 'overlaps' | 'skips', { reserveId: number }[]>;
        expect(Object.keys(lists).sort()).toEqual(['conflicts', 'normal', 'overlaps', 'skips']);
        expect(lists.normal.map(item => item.reserveId)).toEqual([1]);
        expect(lists.conflicts.map(item => item.reserveId)).toEqual([2]);
        expect(lists.skips.map(item => item.reserveId)).toEqual([3]);
        expect(lists.overlaps.map(item => item.reserveId)).toEqual([4]);
    }, 60_000);
});

describe('[SI-3.4] both Rule creation routes accept the same body and answer 201 with ruleId (real Service, Operator, SQLite)', () => {
    it('adds one rule row through POST /api/rules and one through POST /api/rules/keyword', async () => {
        const operator = await launch();
        const body = {
            isTimeSpecification: false,
            reserveOption: { allowEndLack: false, avoidDuplicate: false, enable: true },
            searchOption: { keyword: 'synthetic-rule', name: true },
        };
        const post = (path: string) =>
            fetchJson(operator.servicePort, path, {
                body: JSON.stringify(body),
                headers: { 'content-type': 'application/json' },
                method: 'POST',
            });

        const first = await post('/api/rules');
        const second = await post('/api/rules/keyword');

        expect(first).toMatchObject({ status: 201 });
        expect(second).toMatchObject({ status: 201 });
        const ids = [first, second].map(response => (response.body as { ruleId: number }).ruleId);
        expect(Object.keys(first.body as object)).toEqual(['ruleId']);
        expect(Object.keys(second.body as object)).toEqual(['ruleId']);
        expect(new Set(ids).size).toBe(2);
        const rows = await withDatabase(operator.root, database => database.prepare('SELECT id FROM rule ORDER BY id').all());
        expect(rows).toEqual(ids.map(id => ({ id })));
    }, 60_000);
});

describe('[SI-3.5] POST /api/recording/resettimer needs no body and answers 200 { code: 200 } (real Service and Operator)', () => {
    it('accepts a request with neither body nor content type', async () => {
        const operator = await launch();

        const response = await fetch(loopbackUrl(operator.servicePort, '/api/recording/resettimer'), { method: 'POST' });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(await response.json()).toEqual({ code: 200 });
    }, 60_000);
});

describe('[SI-3.2] GET /api/streams keeps the viodeFileId spelling for a recorded stream (real Service, SQLite, process)', () => {
    it('lists a started recorded stream with viodeFileId and without videoFileId', async () => {
        const streamCommand = `
import { writeFileSync } from 'node:fs';
process.stdin.resume();
setInterval(() => process.stdout.write(Buffer.alloc(188, 0x47)), 100);
`;
        const operator = await launch(
            ["stream: { recorded: { ts: { webm: [{ name: synthetic, cmd: '%NODE% %ROOT%/stream-command.mjs' }] } } }"],
            async root => {
                await writeFile(join(root, 'stream-command.mjs'), streamCommand);
            },
        );
        await withDatabase(operator.root, database => {
            database
                .prepare(
                    'INSERT INTO recorded (id, channelId, startAt, endAt, duration, name, halfWidthName, isRecording) VALUES (1, 1, ?, ?, 1800000, ?, ?, 0)',
                )
                .run(Date.now() - hour, Date.now() - hour + 1_800_000, 'program', 'program');
            database
                .prepare(
                    'INSERT INTO video_file (id, parentDirectoryName, filePath, type, name, size, recordedId) VALUES (7, ?, ?, ?, ?, 4, 1)',
                )
                .run('synthetic', 'program.ts', 'ts', 'program.ts');
        });
        await writeFile(join(operator.root, 'recorded', 'program.ts'), Buffer.alloc(188 * 100, 0x47));

        const controller = new AbortController();
        const streaming = fetch(loopbackUrl(operator.servicePort, '/api/streams/recorded/7/webm?ss=0&mode=0'), {
            signal: controller.signal,
        }).catch(() => undefined);
        try {
            let items: Record<string, unknown>[] = [];
            await waitFor(
                async () => {
                    const { body } = await fetchJson(operator.servicePort, '/api/streams?isHalfWidth=false');
                    items = (body as { items: Record<string, unknown>[] }).items ?? [];
                    return items.length > 0;
                },
                'the started recorded stream in the stream list',
                () => operator.stdout(),
            );
            expect(items).toHaveLength(1);
            expect(Object.keys(items[0])).toContain('viodeFileId');
            expect(items[0].viodeFileId).toBe(7);
            expect(Object.keys(items[0])).not.toContain('videoFileId');
        } finally {
            controller.abort();
            await streaming;
        }
    }, 60_000);
});

