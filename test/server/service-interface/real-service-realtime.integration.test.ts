import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createSyntheticMedia } from '../harness/synthetic-media';

import {
    connectSocketIo,
    fetchJson,
    healthyTunerHandler,
    loopbackUrl,
    reserveUnusedPort,
    seedChannel,
    serviceAnswers,
    sleep,
    startOperator,
    startTunerStub,
    waitFor,
    withDatabase,
    type OperatorHandle,
    type SocketIoClient,
    type TunerStub,
} from '../harness/real-operator';

/**
 * Status and encode-progress notifications of the Web/API child over real components: the compiled
 * Operator runs as a real process with its real Service child and real Socket.IO server, a real SQLite
 * file, and (for encode progress) a real encode child process. Windows are measured on the real clock.
 * Only lower bounds are exact (a window cannot close early); upper bounds are wide enough for a loaded host.
 */

const operators: OperatorHandle[] = [];
const stubs: TunerStub[] = [];
const clients: SocketIoClient[] = [];

afterEach(async () => {
    await Promise.all(clients.splice(0).map(client => client.close()));
    await Promise.all(operators.splice(0).map(operator => operator.stop()));
    await Promise.all(stubs.splice(0).map(stub => stub.close()));
});

const launch = async (
    config: readonly string[] = [],
    prepare?: (root: string) => Promise<void>,
): Promise<OperatorHandle> => {
    const stub = await startTunerStub(
        healthyTunerHandler([
            { index: 0, name: 'synthetic-tuner-0', types: ['GR'] },
            { index: 1, name: 'synthetic-tuner-1', types: ['GR'] },
        ]),
    );
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

const channelId = 1000;
const hour = 3_600_000;

/** Adds one reservation (a state change) in its own window so the ten of them never overlap. */
const addReserve = async (operator: OperatorHandle, index: number): Promise<void> => {
    const startAt = Date.now() + (index + 2) * hour;
    const { status } = await fetchJson(operator.servicePort, '/api/reserves', {
        body: JSON.stringify({
            allowEndLack: true,
            timeSpecifiedOption: { channelId, endAt: startAt + 1_800_000, name: `reserve ${index}`, startAt },
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
    });
    expect(status).toBe(201);
};

/**
 * Waits until `count()` has not changed for `quietMilliseconds` (several coalescing windows), so a notification
 * still in flight on a loaded host is counted before the next step instead of being assumed gone after a fixed time.
 */
const settle = async (count: () => number, quietMilliseconds = 700): Promise<void> => {
    let last = count();
    let changedAt = Date.now();
    await waitFor(() => {
        const current = count();
        if (current !== last) {
            last = current;
            changedAt = Date.now();
        }
        return Date.now() - changedAt >= quietMilliseconds;
    }, 'the notifications to settle');
};

const connectClient = async (operator: OperatorHandle): Promise<SocketIoClient> => {
    const client = await connectSocketIo(operator.servicePort);
    clients.push(client);
    return client;
};

describe('[SI-7.3] status notifications are coalesced into 200 ms windows (real Service, Socket.IO, clock)', () => {
    it('sends far fewer updateStatus events than state changes, each window at least 200 ms after its first change, and starts a new window afterwards', async () => {
        const operator = await launch();
        await withDatabase(operator.root, database =>
            seedChannel(database, { channelType: 'GR', id: channelId, name: 'synthetic GR' }),
        );
        const client = await connectClient(operator);
        // A notification can be in flight from the start of the process or the connection; let it pass first.
        await settle(() => client.timedEvents().length);
        const quietBefore = client.timedEvents().length;

        // Ten state changes, 50 ms apart.
        const firstChangeAt = Date.now();
        for (let index = 0; index < 10; index += 1) {
            await addReserve(operator, index);
            await sleep(50);
        }
        await waitFor(() => client.timedEvents().length - quietBefore >= 2, 'the coalesced notifications', () =>
            client.timedEvents(),
        );
        await settle(() => client.timedEvents().length);

        const burst = client.timedEvents().slice(quietBefore).filter(event => event.name === 'updateStatus');
        expect(burst.length).toBeGreaterThanOrEqual(2);
        // Ten changes, far fewer notifications.
        expect(burst.length).toBeLessThanOrEqual(7);
        // The first window opens at the first change and closes 200 ms later: it cannot be earlier than that.
        expect(burst[0].at - firstChangeAt).toBeGreaterThanOrEqual(190);
        // Windows follow each other; one window never delivers twice.
        for (let index = 1; index < burst.length; index += 1) {
            expect(burst[index].at - burst[index - 1].at).toBeGreaterThanOrEqual(100);
        }

        // After a quiet period a single further change opens one new window and yields exactly one more event.
        const before = client.timedEvents().length;
        const changeAt = Date.now();
        await addReserve(operator, 20);
        await waitFor(() => client.timedEvents().length > before, 'the notification of the new window', () =>
            client.timedEvents(),
        );
        await settle(() => client.timedEvents().length);
        const added = client.timedEvents().slice(before);
        expect(added).toHaveLength(1);
        expect(added[0].name).toBe('updateStatus');
        expect(added[0].at - changeAt).toBeGreaterThanOrEqual(190);
    }, 90_000);

    it('delivers the same payload-free updateStatus over a real WebSocket transport', async () => {
        const operator = await launch();
        await withDatabase(operator.root, database =>
            seedChannel(database, { channelType: 'GR', id: channelId, name: 'synthetic GR' }),
        );
        const messages: string[] = [];
        const socket = new WebSocket(
            `${loopbackUrl(operator.servicePort, '/socket.io/').replace('http:', 'ws:')}?EIO=4&transport=websocket`,
        );
        try {
            socket.addEventListener('message', event => {
                const text = String(event.data);
                messages.push(text);
                if (text.startsWith('0')) socket.send('40');
                if (text === '2') socket.send('3');
            });
            await waitFor(() => messages.some(message => message.startsWith('40')), 'the namespace connect packet', () => messages);
            // A notification can be in flight from the start of the process or the connection; let it pass first.
            await settle(() => messages.length);
            const quiet = messages.filter(message => message.startsWith('42')).length;

            await addReserve(operator, 0);

            await waitFor(() => messages.filter(message => message.startsWith('42')).length > quiet, 'updateStatus over the WebSocket', () => messages);
            await settle(() => messages.length);
            expect(messages.filter(message => message.startsWith('42')).slice(quiet)).toEqual(['42["updateStatus"]']);
        } finally {
            socket.close();
        }
    }, 60_000);
});

const progressEncoder = `
import { writeFileSync } from 'node:fs';
const steps = 30;
let step = 0;
const timer = setInterval(() => {
    step += 1;
    console.log(JSON.stringify({ type: 'progress', percent: step / steps, log: 'step ' + step }));
    if (step === steps) {
        clearInterval(timer);
        writeFileSync(process.env.OUTPUT, 'encoded');
    }
}, 50);
`;

describe('[SI-7.4] encode progress notifications are coalesced into their own 200 ms windows (real Service, encode child, clock)', () => {
    it('sends fewer updateEncode events than progress lines, spaced by their window, independent of updateStatus', async () => {
        const operator = await launch(
            [
                'ffmpeg: ffmpeg',
                'ffprobe: ffprobe',
                'encodeProcessNum: 1',
                'concurrentEncodeNum: 1',
                "encode: [{ name: synthetic, cmd: '%NODE% %ROOT%/progress-encoder.mjs', suffix: .mp4 }]",
            ],
            async root => {
                await writeFile(join(root, 'progress-encoder.mjs'), progressEncoder);
            },
        );
        await withDatabase(operator.root, database => {
            seedChannel(database, { channelType: 'GR', id: 1, name: 'synthetic GR' });
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
        // The encoder reads the real duration of the source with ffprobe before it follows progress lines.
        await createSyntheticMedia(join(operator.root, 'recorded'), 'program.ts', 'mpegts');
        const client = await connectClient(operator);

        const startedAt = Date.now();
        const { status } = await fetchJson(operator.servicePort, '/api/encode', {
            body: JSON.stringify({
                mode: 'synthetic',
                parentDir: 'synthetic',
                recordedId: 1,
                removeOriginal: false,
                sourceVideoFileId: 7,
            }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });
        expect(status).toBe(201);

        await waitFor(
            () => client.events().filter(name => name === 'updateEncode').length >= 2,
            'two updateEncode notifications',
            () => ({ events: client.timedEvents(), stdout: operator.stdout() }),
        );
        // The encode runs for about 1.5 s; wait until its end has surely been notified.
        await waitFor(() => client.events().includes('updateStatus'), 'the status notification of the finished encode', () =>
            client.timedEvents(),
        );
        await settle(() => client.timedEvents().length);

        const progress = client.timedEvents().filter(event => event.name === 'updateEncode');
        // Thirty progress lines, far fewer notifications.
        expect(progress.length).toBeGreaterThanOrEqual(2);
        expect(progress.length).toBeLessThanOrEqual(15);
        expect(progress[0].at - startedAt).toBeGreaterThanOrEqual(190);
        for (let index = 1; index < progress.length; index += 1) {
            expect(progress[index].at - progress[index - 1].at).toBeGreaterThanOrEqual(100);
        }
        // The status window is separate: updateStatus events exist next to the progress ones.
        expect(client.events()).toContain('updateStatus');
    }, 90_000);
});
