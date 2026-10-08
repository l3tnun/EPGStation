import { readFile, readdir } from 'node:fs/promises';
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    connectSocketIo,
    fetchJson,
    healthyTunerHandler,
    reserveUnusedPort,
    respondJson,
    seedChannel,
    serviceAnswers,
    sleep,
    startOperator,
    startTunerStub,
    waitFor,
    withDatabase,
    type OperatorHandle,
    type SocketIoClient,
    type TunerFixture,
    type TunerStub,
    type TunerStubHandler,
} from '../harness/real-operator';

/**
 * Operator composition over the compiled Operator as a real process: a loopback tuner server, the real
 * SQLite file, the real Service child on the real IPC channel, and (for hooks) a real command process.
 * Wall-clock limits only bound a hung run.
 */

const operators: OperatorHandle[] = [];
const stubs: TunerStub[] = [];
const sockets: SocketIoClient[] = [];

afterEach(async () => {
    await Promise.all(sockets.splice(0).map(client => client.close()));
    await Promise.all(operators.splice(0).map(operator => operator.stop()));
    await Promise.all(stubs.splice(0).map(stub => stub.close()));
});

const GR: TunerFixture = { index: 0, name: 'synthetic-tuner-0', types: ['GR'] };
const GR_BS: TunerFixture = { index: 1, name: 'synthetic-tuner-2', types: ['GR', 'BS'] };

const launch = async (
    tuners: readonly TunerFixture[] | TunerStubHandler,
    options: {
        config?: readonly string[];
        prepare?: (root: string) => Promise<void>;
        serviceExecutorSource?: string;
        epgExecutorSource?: string;
    } = {},
): Promise<{ operator: OperatorHandle; stub: TunerStub }> => {
    const stub = await startTunerStub(typeof tuners === 'function' ? tuners : healthyTunerHandler(tuners));
    stubs.push(stub);
    const operator = await startOperator({
        ...options,
        servicePort: await reserveUnusedPort(),
        tunerPort: stub.port,
    });
    operators.push(operator);
    return { operator, stub };
};

const ready = (operator: OperatorHandle): Promise<void> =>
    waitFor(() => serviceAnswers(operator.servicePort), 'the Service API', () => operator.stdout());

const tunerRequests = (stub: TunerStub): number => stub.requests.filter(path => path.startsWith('/api/tuners')).length;

const broadcastOf = async (operator: OperatorHandle): Promise<unknown> =>
    ((await fetchJson(operator.servicePort, '/api/config')).body as { broadcast: unknown }).broadcast;

describe('[AR-4.1] the tuner snapshot is read once after the dependencies answer (real process)', () => {
    it.each([
        { label: 'no tuner', tuners: [], broadcast: { BS: false, BS4K: false, CS: false, GR: false, SKY: false } },
        { label: 'one GR tuner', tuners: [GR], broadcast: { BS: false, BS4K: false, CS: false, GR: true, SKY: false } },
        {
            label: 'GR and GR+BS tuners',
            tuners: [GR, GR_BS],
            broadcast: { BS: true, BS4K: false, CS: false, GR: true, SKY: false },
        },
    ])('requests /api/tuners exactly once and exposes the same availability for $label', async ({ broadcast, tuners }) => {
        const { operator, stub } = await launch(tuners);
        await ready(operator);

        expect(await broadcastOf(operator)).toEqual(broadcast);
        // The Service and the Operator are both up; no later component asks the tuner server again.
        await sleep(1_000);
        expect(tunerRequests(stub)).toBe(1);
        // The snapshot is read after the dependency check, never before it.
        const order = stub.requests.map(path => path.split('?')[0]);
        expect(order.indexOf('/api/status')).toBeLessThan(order.indexOf('/api/tuners'));
    }, 60_000);
});

describe('[AR-4.6] a failed tuner snapshot stops the Operator composition and records a fatal (real process)', () => {
    it.each([
        { label: 'HTTP 500', respond: (response: Parameters<TunerStubHandler>[1]) => respondJson(response, {}, 500) },
        {
            label: 'a broken JSON body',
            respond: (response: Parameters<TunerStubHandler>[1]) => {
                response.setHeader('content-type', 'application/json');
                response.end('{broken');
            },
        },
    ])('keeps the process alive, starts no Service, and records the rejection for $label', async ({ respond }) => {
        const healthy = healthyTunerHandler([GR]);
        const { operator, stub } = await launch((request, response, context) => {
            if (request.url?.startsWith('/api/tuners') === true) {
                respond(response);
                return;
            }
            healthy(request, response, context);
        });

        await waitFor(
            async () => (await operator.readSystemLog()).includes('unhandledRejection'),
            'the recorded unhandledRejection',
            () => operator.stdout(),
        );
        // Nothing downstream may start, however long it is given.
        await sleep(2_000);
        const log = await operator.readSystemLog();
        expect(log.match(/unhandledRejection/gu)).toHaveLength(1);
        expect(operator.isAlive()).toBe(true);
        expect(tunerRequests(stub)).toBe(1);
        expect(operator.servicePids()).toEqual([]);
        expect(operator.count('start service')).toBe(0);
        expect(operator.epgPids()).toEqual([]);
        expect(await serviceAnswers(operator.servicePort)).toBe(false);
        const pid = operator.runSession.child.pid!;
        expect((await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8')).trim()).toBe('');
    }, 60_000);
});

describe('[AR-5.2] the spawned Service child is registered at once as the IPC peer (real process)', () => {
    it('answers a request sent immediately after spawn, with no readiness message ever sent', async () => {
        const { operator } = await launch([GR], {
            // A real child process that only sends one request on the real IPC channel and never announces readiness.
            serviceExecutorSource: `
import { renameSync, writeFileSync } from 'node:fs';
const markerUrl = new URL('../../../ipc-reply.json', import.meta.url);
const pendingUrl = new URL('../../../ipc-reply.json.pending', import.meta.url);
const startedAt = Date.now();
process.on('message', message => {
    // Written aside and renamed, so the marker appears only once its content is complete: the test
    // reads it as soon as the name exists, and could otherwise see it created but still empty.
    writeFileSync(pendingUrl, JSON.stringify({ elapsedMs: Date.now() - startedAt, message }));
    renameSync(pendingUrl, markerUrl);
});
process.send({ id: 7, model: 'reserveation', func: 'getBroadcastStatus' });
setInterval(() => undefined, 1_000_000);
`,
        });
        const marker = join(operator.root, 'ipc-reply.json');
        await waitFor(
            async () => (await readdir(operator.root)).includes('ipc-reply.json'),
            'the IPC reply written by the child',
            () => operator.stdout(),
        );
        const reply = JSON.parse(await readFile(marker, 'utf8')) as { message: unknown };
        expect(reply.message).toEqual({ id: 7, result: { BS: false, BS4K: false, CS: false, GR: true, SKY: false } });
        expect(operator.servicePids()).toHaveLength(1);
    }, 60_000);
});

const futureHour = (offsetMinutes: number): number => Math.ceil(Date.now() / 60_000) * 60_000 + 3_600_000 + offsetMinutes * 60_000;

const postTimeSpecifiedReserve = (
    operator: OperatorHandle,
    channelId: number,
    startAt: number,
    endAt: number,
): Promise<{ body: unknown; status: number }> =>
    fetchJson(operator.servicePort, '/api/reserves', {
        body: JSON.stringify({ allowEndLack: true, timeSpecifiedOption: { channelId, endAt, name: 'synthetic', startAt } }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
    });

const addTimeSpecifiedReserve = async (
    operator: OperatorHandle,
    channelId: number,
    startAt: number,
    endAt: number,
): Promise<number> => {
    const { body, status } = await postTimeSpecifiedReserve(operator, channelId, startAt, endAt);
    expect(status).toBe(201);
    return (body as { reserveId: number }).reserveId;
};

const reserveRow = async (operator: OperatorHandle, reserveId: number): Promise<{ isConflict: boolean }> =>
    (await fetchJson(operator.servicePort, `/api/reserves/${reserveId}?isHalfWidth=false`)).body as { isConflict: boolean };

describe('[AR-4.2] the reservation side receives the same tuner snapshot (real process)', () => {
    // Two services on different physical channels cannot share one tuner.
    const channelId = 1000;
    const otherChannelId = 1001;

    it('refuses the second of two overlapping GR reservations with one GR tuner and stores only the others', async () => {
        const { operator } = await launch([GR]);
        await ready(operator);
        await withDatabase(operator.root, database => {
            seedChannel(database, { channelType: 'GR', id: channelId, name: 'synthetic GR 1' });
            seedChannel(database, { channelType: 'GR', id: otherChannelId, name: 'synthetic GR 2' });
        });

        const first = await addTimeSpecifiedReserve(operator, channelId, futureHour(0), futureHour(30));
        // The only GR tuner is busy with the first reservation, so the Operator judges the second one a conflict.
        const refused = await postTimeSpecifiedReserve(operator, otherChannelId, futureHour(10), futureHour(40));
        const separate = await addTimeSpecifiedReserve(operator, otherChannelId, futureHour(60), futureHour(90));

        expect(refused.status).toBe(500);
        expect(await reserveRow(operator, first)).toMatchObject({ isConflict: false });
        expect(await reserveRow(operator, separate)).toMatchObject({ isConflict: false });
        const stored = await withDatabase(operator.root, database =>
            database.prepare('SELECT id, isConflict FROM reserve ORDER BY id').all(),
        );
        expect(stored).toEqual([
            { id: first, isConflict: 0 },
            { id: separate, isConflict: 0 },
        ]);
    }, 60_000);

    it('accepts the same two overlapping reservations when the snapshot holds two GR tuners', async () => {
        const { operator } = await launch([GR, { index: 1, name: 'synthetic-tuner-1', types: ['GR'] }]);
        await ready(operator);
        await withDatabase(operator.root, database => {
            seedChannel(database, { channelType: 'GR', id: channelId, name: 'synthetic GR 1' });
            seedChannel(database, { channelType: 'GR', id: otherChannelId, name: 'synthetic GR 2' });
        });

        const first = await addTimeSpecifiedReserve(operator, channelId, futureHour(0), futureHour(30));
        const second = await addTimeSpecifiedReserve(operator, otherChannelId, futureHour(10), futureHour(40));

        expect(await reserveRow(operator, first)).toMatchObject({ isConflict: false });
        expect(await reserveRow(operator, second)).toMatchObject({ isConflict: false });
    }, 60_000);
});

const hookScript = (record: string): string => `#!/bin/sh\necho "$RESERVEID" >> '${record}'\n`;

const readLines = async (file: string): Promise<string[]> => {
    try {
        return (await readFile(file, 'utf8')).split('\n').filter(line => line !== '');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
};

describe('[AR-4.3][AR-4.5] the event binding is registered once and links reservation changes (real process)', () => {
    const channelId = 1000;

    it('delivers one notification and one hook run per reservation change, also after three Service restarts', async () => {
        let hookRecord = '';
        const { operator } = await launch([GR], {
            config: ['reserveNewAddtionCommand: __ADDED__', 'reservedeletedCommand: __DELETED__'],
            prepare: async root => {
                hookRecord = join(root, 'hook-added.log');
                const deletedRecord = join(root, 'hook-deleted.log');
                const added = join(root, 'hook-added.sh');
                const deleted = join(root, 'hook-deleted.sh');
                await writeFile(added, hookScript(hookRecord));
                await writeFile(deleted, hookScript(deletedRecord));
                await Promise.all([chmod(added, 0o755), chmod(deleted, 0o755)]);
                const configPath = join(root, 'config', 'config.yml');
                const text = (await readFile(configPath, 'utf8'))
                    .replace('__ADDED__', `'${added}'`)
                    .replace('__DELETED__', `'${deleted}'`);
                await writeFile(configPath, text);
            },
        });
        const addedRecord = join(operator.root, 'hook-added.log');
        const deletedRecord = join(operator.root, 'hook-deleted.log');
        await ready(operator);
        await withDatabase(operator.root, database => seedChannel(database, { channelType: 'GR', id: channelId, name: 'synthetic GR' }));

        const notificationsAfter = async (action: () => Promise<void>): Promise<number> => {
            const client = await connectSocketIo(operator.servicePort);
            sockets.push(client);
            await action();
            // The Service coalesces notifications in 200 ms windows. Wait for the first one, then let any
            // second notification from a duplicated binding arrive before counting.
            await waitFor(() => client.events().includes('updateStatus'), 'an updateStatus notification', () => client.events());
            await sleep(1_000);
            const count = client.events().filter(name => name === 'updateStatus').length;
            await client.close();
            return count;
        };

        // (1) The initial binding: a reservation add reaches the DB, the subscriber and the hook once each.
        let reserveId = 0;
        const firstNotifications = await notificationsAfter(async () => {
            reserveId = await addTimeSpecifiedReserve(operator, channelId, futureHour(0), futureHour(30));
        });
        expect(firstNotifications).toBe(1);
        await waitFor(async () => (await readLines(addedRecord)).length >= 1, 'the added hook', () => operator.stdout());
        await sleep(500);
        expect(await readLines(addedRecord)).toEqual([String(reserveId)]);
        expect(await withDatabase(operator.root, database => database.prepare('SELECT id FROM reserve').all())).toEqual([
            { id: reserveId },
        ]);
        expect(operator.stdout()).toContain('start service pid');

        // (2) The Service child is killed three times; the Operator keeps its single binding.
        for (let restart = 1; restart <= 3; restart += 1) {
            const pids = operator.servicePids();
            process.kill(pids[pids.length - 1], 'SIGKILL');
            await waitFor(() => operator.servicePids().length === restart + 1, `Service restart ${restart}`, () => operator.stdout());
            await waitFor(() => serviceAnswers(operator.servicePort), `the Service after restart ${restart}`, () => operator.stdout());
        }
        const afterRestarts = await notificationsAfter(async () => {
            await addTimeSpecifiedReserve(operator, channelId, futureHour(120), futureHour(150));
        });
        expect(afterRestarts).toBe(1);
        await waitFor(async () => (await readLines(addedRecord)).length >= 2, 'the second added hook', () => operator.stdout());
        await sleep(1_000);
        expect(await readLines(addedRecord)).toHaveLength(2);

        // (3) Cancelling a reservation links to its own hook, once.
        const deletedNotifications = await notificationsAfter(async () => {
            const { status } = await fetchJson(operator.servicePort, `/api/reserves/${reserveId}`, { method: 'DELETE' });
            expect(status).toBe(200);
        });
        expect(deletedNotifications).toBe(1);
        await waitFor(async () => (await readLines(deletedRecord)).length >= 1, 'the deleted hook', () => operator.stdout());
        await sleep(500);
        expect(await readLines(deletedRecord)).toEqual([String(reserveId)]);
    }, 90_000);
});

describe('[AR-4.2] the recording side receives the same tuner snapshot (real process)', () => {
    it('opens both streams of two overlapping reservations on different channels when the snapshot holds two GR tuners', async () => {
        const healthy = healthyTunerHandler([GR, { index: 1, name: 'synthetic-tuner-1', types: ['GR'] }]);
        const { operator, stub } = await launch((request, response, context) => {
            if (request.url?.includes('/stream') === true) {
                response.statusCode = 200;
                response.setHeader('content-type', 'video/MP2T');
                const timer = setInterval(() => response.write(Buffer.alloc(188, 0xff)), 100);
                response.once('close', () => clearInterval(timer));
                return;
            }
            healthy(request, response, context);
        });
        await ready(operator);
        await withDatabase(operator.root, database => {
            seedChannel(database, { channelType: 'GR', id: 1000, name: 'synthetic GR 1' });
            seedChannel(database, { channelType: 'GR', id: 1001, name: 'synthetic GR 2' });
        });

        // The preparation starts 15 seconds before the start time.
        const startAt = Date.now() + 20_000;
        await addTimeSpecifiedReserve(operator, 1000, startAt, startAt + 120_000);
        await addTimeSpecifiedReserve(operator, 1001, startAt + 5_000, startAt + 125_000);

        const streamPaths = (): string[] =>
            stub.requests.filter(path => path.includes('/stream')).map(path => path.split('?')[0]);
        await waitFor(
            () => streamPaths().includes('/api/services/1000/stream') && streamPaths().includes('/api/services/1001/stream'),
            'both stream requests',
            () => ({ paths: streamPaths(), stdout: operator.stdout() }),
            60_000,
        );
        expect(streamPaths().sort()).toEqual(['/api/services/1000/stream', '/api/services/1001/stream']);
    }, 120_000);
});
