import { readFile, writeFile } from 'node:fs/promises';
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
 * [AR-6.7] A startup stage that fails is recorded as a fatal once; nothing after it starts and nothing
 * retries. The compiled Operator runs as a real process on a real SQLite file in which a table is renamed
 * to make the stage's first query fail. Waits below only bound a hung run or give a wrong retry time to
 * show up; they never decide a pass by being short.
 */

const operators: OperatorHandle[] = [];
const stubs: TunerStub[] = [];

afterEach(async () => {
    await Promise.all(operators.splice(0).map(operator => operator.stop()));
    await Promise.all(stubs.splice(0).map(stub => stub.close()));
});

/** Runs the Operator once so that its migrations create the schema, and returns the resulting database file. */
const migratedDatabase = async (): Promise<Buffer> => {
    const stub = await startTunerStub(healthyTunerHandler([{ index: 0, name: 'synthetic-tuner-0', types: ['GR'] }]));
    stubs.push(stub);
    const operator = await startOperator({ servicePort: await reserveUnusedPort(), tunerPort: stub.port });
    operators.push(operator);
    await waitFor(() => operator.epgPids().length === 1, 'the first start finishing the startup stages', () => operator.stdout());
    const database = await readFile(join(operator.root, 'data', 'database.db'));
    await operator.stop();
    operators.splice(operators.indexOf(operator), 1);
    return database;
};

const expiredReserveRow = (database: { exec(sql: string): void }): void => {
    const longAgo = Date.now() - 24 * 3_600_000;
    database.exec(
        `INSERT INTO reserve (updateTime, channelId, channel, channelType, startAt, endAt, name, isTimeSpecified) VALUES (${longAgo}, 1, '1', 'GR', ${longAgo}, ${longAgo + 1_800_000}, 'expired', 1)`,
    );
};

const startWith = async (
    schema: Buffer,
    prepareDatabase: (database: { exec(sql: string): void }) => void,
): Promise<OperatorHandle> => {
    const stub = await startTunerStub(healthyTunerHandler([{ index: 0, name: 'synthetic-tuner-0', types: ['GR'] }]));
    stubs.push(stub);
    const operator = await startOperator({
        prepare: async root => {
            await writeFile(join(root, 'data', 'database.db'), schema);
            await withDatabase(root, prepareDatabase);
        },
        servicePort: await reserveUnusedPort(),
        tunerPort: stub.port,
    });
    operators.push(operator);
    return operator;
};

const reserveCount = (operator: OperatorHandle): Promise<number> =>
    withDatabase(operator.root, database => (database.prepare('SELECT COUNT(*) AS n FROM reserve').all()[0] as { n: number }).n);

describe('[AR-6.7] a failed startup stage stops the later stages and is not retried (real process)', () => {
    it('control: with an intact schema the expired reservation is cleaned up and the EPG child starts', async () => {
        const schema = await migratedDatabase();
        const operator = await startWith(schema, expiredReserveRow);

        await waitFor(() => operator.epgPids().length === 1, 'the EPG child of a healthy start', () => operator.stdout());
        expect(await reserveCount(operator)).toBe(0);
        expect(await operator.readSystemLog()).not.toMatch(/startup workflow failed/u);
    }, 90_000);

    it.each([
        {
            label: 'the recorded table cannot be read (recording reconciliation fails first)',
            prepare: (database: { exec(sql: string): void }) => {
                database.exec('ALTER TABLE recorded RENAME TO recorded_renamed');
                expiredReserveRow(database);
            },
            // The expired reservation sits behind the failed stage, so it must still be there.
            remainingReserves: 1,
            stage: 'recording-reconciliation',
        },
        {
            label: 'the reserve table cannot be read (candidate rebuild fails)',
            prepare: (database: { exec(sql: string): void }) => {
                database.exec('ALTER TABLE reserve RENAME TO reserve_renamed');
            },
            remainingReserves: undefined,
            stage: 'recording-candidates-and-start',
        },
    ])('records one fatal, starts nothing after it, and does not retry when $label', async ({ prepare, remainingReserves, stage }) => {
        const schema = await migratedDatabase();
        const operator = await startWith(schema, prepare);

        await waitFor(
            async () => (await operator.readSystemLog()).includes('startup workflow failed at stage'),
            'the startup failure record',
            () => operator.stdout(),
        );
        // Give a retry (which must not exist) ample time to show itself.
        await sleep(3_000);

        const log = await operator.readSystemLog();
        expect(log.match(/startup workflow failed at stage/gu)).toHaveLength(1);
        expect(log).toContain(`startup workflow failed at stage "${stage}"`);
        expect(operator.isAlive()).toBe(true);
        expect(operator.count('start recordings cleanup')).toBe(1);
        expect(operator.epgPids()).toEqual([]);
        expect(operator.count('start reserves cleanup')).toBe(0);
        // Web and API keep answering.
        expect(await serviceAnswers(operator.servicePort)).toBe(true);
        if (remainingReserves !== undefined) {
            expect(await reserveCount(operator)).toBe(remainingReserves);
        }
    }, 90_000);
});
