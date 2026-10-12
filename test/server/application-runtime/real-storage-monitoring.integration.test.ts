import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    healthyTunerHandler,
    reserveUnusedPort,
    serviceAnswers,
    sleep,
    startOperator,
    startTunerStub,
    waitFor,
    withDatabase,
    type OperatorHandle,
    type TunerStub,
} from '../harness/real-operator';

/**
 * [AR-4.4] The Operator starts watching the free space of the recording storage when it composes itself.
 * The compiled Operator runs as a real process with its real Service child, a real SQLite file, and real
 * recorded files; free space is read from the real file system. The temporary file system the
 * condition mentions is not available without privileges, so the threshold is moved instead of the free
 * space: a threshold far above any free space keeps the storage "full", a threshold of 1 MB keeps it "not full".
 */

const operators: OperatorHandle[] = [];
const stubs: TunerStub[] = [];

afterEach(async () => {
    await Promise.all(operators.splice(0).map(operator => operator.stop()));
    await Promise.all(stubs.splice(0).map(stub => stub.close()));
});

const startWithThreshold = async (limitThreshold: number): Promise<OperatorHandle> => {
    const stub = await startTunerStub(healthyTunerHandler([{ index: 0, name: 'synthetic-tuner-0', types: ['GR'] }]));
    stubs.push(stub);
    const operator = await startOperator({
        config: [
            `recorded: [{ name: 'synthetic', path: '%ROOT%/recorded', limitThreshold: ${limitThreshold}, action: remove }]`,
            'storageLimitCheckIntervalTime: 1',
        ],
        servicePort: await reserveUnusedPort(),
        tunerPort: stub.port,
    });
    operators.push(operator);
    await waitFor(() => serviceAnswers(operator.servicePort), 'the Service API', () => operator.stdout());
    return operator;
};

const hour = 3_600_000;

/** Seeds three recorded programs whose ids run opposite to their start times, each with a real file. */
const seedRecordings = async (operator: OperatorHandle): Promise<void> => {
    const base = Date.now() - 48 * hour;
    // id 1 is the newest and id 3 the oldest, so deleting by id order would be told apart from oldest-first.
    const startTimes = [base + 2 * hour, base + hour, base];
    await withDatabase(operator.root, database => {
        startTimes.forEach((startAt, index) => {
            const id = index + 1;
            database
                .prepare(
                    'INSERT INTO recorded (id, channelId, startAt, endAt, duration, name, halfWidthName, isRecording) VALUES (?, 1, ?, ?, 1800000, ?, ?, 0)',
                )
                .run(id, startAt, startAt + 1_800_000, `program ${id}`, `program ${id}`);
            database
                .prepare(
                    'INSERT INTO video_file (parentDirectoryName, filePath, type, name, size, recordedId) VALUES (?, ?, ?, ?, 4, ?)',
                )
                .run('synthetic', `program-${id}.ts`, 'ts', `program-${id}.ts`, id);
        });
    });
    await Promise.all(startTimes.map((_, index) => writeFile(join(operator.root, 'recorded', `program-${index + 1}.ts`), 'data')));
};

const recordedIds = (operator: OperatorHandle): Promise<number[]> =>
    withDatabase(operator.root, database =>
        (database.prepare('SELECT id FROM recorded ORDER BY id').all() as { id: number }[]).map(row => row.id),
    );

describe('[AR-4.4] the Operator monitors the free space of the recording storage (real process)', () => {
    it('removes recorded programs and their files oldest first while free space is below the threshold', async () => {
        // No real disk has this much free space (in MB), so every check finds the storage over its limit.
        const operator = await startWithThreshold(1_000_000_000_000);
        await seedRecordings(operator);

        await waitFor(async () => (await recordedIds(operator)).length === 0, 'all recorded rows removed', async () => ({
            ids: await recordedIds(operator),
            log: await operator.readSystemLog(),
        }));
        await waitFor(async () => (await readdir(join(operator.root, 'recorded'))).length === 0, 'all recorded files removed');

        const log = await operator.readSystemLog();
        const removed = [...log.matchAll(/storage limit remove recorded: (\d+)/gu)].map(match => Number(match[1]));
        // Oldest start time first: id 3, then 2, then 1.
        expect(removed.slice(0, 3)).toEqual([3, 2, 1]);
    }, 90_000);

    it('removes nothing while the real free space stays above the threshold', async () => {
        const operator = await startWithThreshold(1);
        await seedRecordings(operator);

        // Several check intervals (one second each) pass without any removal.
        await sleep(4_000);
        expect(await recordedIds(operator)).toEqual([1, 2, 3]);
        expect(await readdir(join(operator.root, 'recorded'))).toHaveLength(3);
        expect(await operator.readSystemLog()).not.toContain('storage limit remove recorded');
    }, 60_000);
});
