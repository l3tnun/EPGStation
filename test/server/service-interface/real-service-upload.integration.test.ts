import { appendFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    healthyTunerHandler,
    loopbackUrl,
    reserveUnusedPort,
    serviceAnswers,
    startOperator,
    startTunerStub,
    waitFor,
    type OperatorHandle,
    type TunerStub,
} from '../harness/real-operator';

/**
 * Upload admission and receive deadline of the Web/API child, over real components: the compiled Operator
 * runs as a real process with its real Service child, real express/multer, a real file system, and real
 * TCP connections that stall in the middle of a request body. Wall-clock limits only bound a hung run
 * unless a test says it checks a configured deadline.
 */

const operators: OperatorHandle[] = [];
const stubs: TunerStub[] = [];
const sockets = new Set<Socket>();

afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    await Promise.all(operators.splice(0).map(operator => operator.stop()));
    await Promise.all(stubs.splice(0).map(stub => stub.close()));
});

const launch = async (
    config: readonly string[] = [],
    options: { waitUntilReady?: boolean } = {},
): Promise<OperatorHandle> => {
    const stub = await startTunerStub(healthyTunerHandler([{ index: 0, name: 'synthetic-tuner-0', types: ['GR'] }]));
    stubs.push(stub);
    const operator = await startOperator({
        config,
        servicePort: await reserveUnusedPort(),
        tunerPort: stub.port,
    });
    operators.push(operator);
    if (options.waitUntilReady !== false) {
        await waitFor(() => serviceAnswers(operator.servicePort), 'the Service API', () => operator.stdout());
    }
    return operator;
};

const boundary = 'synthetic-boundary';

/** Opens a real TCP connection and sends the start of a multipart upload whose body never completes. */
const openStalledUpload = async (port: number): Promise<{ socket: Socket; response: () => string }> => {
    const socket = connect(port, '127.0.0.1');
    sockets.add(socket);
    let received = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => (received += chunk));
    socket.on('error', () => undefined);
    await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
    });
    socket.write(
        [
            'POST /api/videos/upload HTTP/1.1',
            `Host: 127.0.0.1:${port}`,
            `Content-Type: multipart/form-data; boundary=${boundary}`,
            'Content-Length: 10000000',
            '',
            `--${boundary}`,
            'Content-Disposition: form-data; name="file"; filename="stalled.ts"',
            'Content-Type: video/mp2t',
            '',
            'partial',
        ].join('\r\n'),
    );
    return { response: () => received, socket };
};

const incomingEntries = async (operator: OperatorHandle): Promise<string[]> => {
    try {
        return await readdir(join(operator.root, 'data', 'upload', 'incoming'));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
};

const holdStalledUploads = async (operator: OperatorHandle, count: number): Promise<Socket[]> => {
    const held: Socket[] = [];
    for (let index = 1; index <= count; index += 1) {
        held.push((await openStalledUpload(operator.servicePort)).socket);
        await waitFor(async () => (await incomingEntries(operator)).length === index, `upload ${index} admitted`, () =>
            operator.stdout(),
        );
    }
    return held;
};

/** A complete, well-formed upload request. It is refused outright when no slot is free. */
const tryCompleteUpload = async (operator: OperatorHandle): Promise<{ body: string; status: number }> => {
    const form = new FormData();
    form.set('file', new Blob(['complete']), 'complete.ts');
    const response = await fetch(loopbackUrl(operator.servicePort, '/api/videos/upload'), { body: form, method: 'POST' });
    return { body: await response.text(), status: response.status };
};

const expectRefusedForNoSlot = async (operator: OperatorHandle, admitted: number): Promise<void> => {
    const refused = await tryCompleteUpload(operator);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.body).toContain('Unexpected file field');
    // The refused request never took a slot or a directory.
    expect(await incomingEntries(operator)).toHaveLength(admitted);
};

const killServiceChild = async (operator: OperatorHandle): Promise<void> => {
    const pids = operator.servicePids();
    process.kill(pids[pids.length - 1], 'SIGKILL');
    await waitFor(() => operator.servicePids().length === pids.length + 1, 'the restarted Service child', () =>
        operator.stdout(),
    );
    await waitFor(() => serviceAnswers(operator.servicePort), 'the Service API after the restart', () => operator.stdout());
};

describe('[SI-6.2][SI-6.18] upload slots come from the settings read at child start (real Service, real connections)', () => {
    it('uses 3 slots by default, ignores a later config.yml change, and starts the restarted child with the new setting and no leftovers', async () => {
        const operator = await launch();
        await writeFile(join(operator.root, 'data', 'upload', 'adopted', 'keep.bin'), 'parent-owned');

        // (1) Both settings omitted: three stalled uploads are admitted and the fourth is refused.
        await holdStalledUploads(operator, 3);
        await expectRefusedForNoSlot(operator, 3);

        // (2) The file changes while this child runs; the running child keeps the settings it read at start.
        await appendFile(join(operator.root, 'config', 'config.yml'), 'concurrentUploadNum: 1\n');
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        await waitFor(async () => (await incomingEntries(operator)).length === 0, 'the abandoned uploads cleaned up', () =>
            operator.stdout(),
        );
        await holdStalledUploads(operator, 3);
        await expectRefusedForNoSlot(operator, 3);

        // (3) The child is killed with three uploads in flight and restarted by the Operator.
        const stalledPayloadDirectories = await incomingEntries(operator);
        expect(stalledPayloadDirectories).toHaveLength(3);
        await killServiceChild(operator);
        // Nothing of the old child's slots or half-received payloads survives, and parent-owned files are untouched.
        expect(await incomingEntries(operator)).toEqual([]);
        expect(await readFile(join(operator.root, 'data', 'upload', 'adopted', 'keep.bin'), 'utf8')).toBe('parent-owned');

        // The restarted child counted its slots from the new setting: one slot, taken by the first upload.
        await holdStalledUploads(operator, 1);
        await expectRefusedForNoSlot(operator, 1);
    }, 90_000);
});

describe('[SI-6.2] uploadReceiveTimeoutMs from config.yml bounds the body receive (real Service, real connection)', () => {
    it('ends a stalled upload with an error response and removes its payload once the configured time has passed', async () => {
        const timeoutMs = 1_500;
        const operator = await launch([`uploadReceiveTimeoutMs: ${timeoutMs}`]);

        const startedAt = Date.now();
        const stalled = await openStalledUpload(operator.servicePort);
        await waitFor(async () => (await incomingEntries(operator)).length === 1, 'the stalled upload admitted', () =>
            operator.stdout(),
        );
        await waitFor(() => /^HTTP\/1\.1 [45]\d\d/u.test(stalled.response()), 'the receive-timeout response', () => ({
            response: stalled.response(),
            stdout: operator.stdout(),
        }));

        // The response cannot precede the configured time (the limit is real, not a fake timer); only a lower bound is asserted.
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(timeoutMs - 100);
        await waitFor(async () => (await incomingEntries(operator)).length === 0, 'the payload removed', () => operator.stdout());
    }, 60_000);
});

describe('[SI-6.3] out-of-range upload settings keep the server from starting; boundary values start it (real process)', () => {
    it.each([
        { label: 'concurrentUploadNum: 0', line: 'concurrentUploadNum: 0' },
        { label: 'concurrentUploadNum: -1', line: 'concurrentUploadNum: -1' },
        { label: 'concurrentUploadNum: a string', line: "concurrentUploadNum: '3'" },
        { label: 'uploadReceiveTimeoutMs: 0', line: 'uploadReceiveTimeoutMs: 0' },
        { label: 'uploadReceiveTimeoutMs: 2147483648', line: 'uploadReceiveTimeoutMs: 2147483648' },
    ])('fails to start with $label and never listens', async ({ line }) => {
        const operator = await launch([line], { waitUntilReady: false });

        await waitFor(() => !operator.isAlive(), 'the Operator exiting', () => operator.stdout());

        expect(operator.runSession.child.exitCode).not.toBe(0);
        expect(operator.stdout() + operator.runSession.stderr).toContain('ConfigValueError');
        expect(await serviceAnswers(operator.servicePort)).toBe(false);
        expect(operator.servicePids()).toEqual([]);
    }, 60_000);

    it.each([
        { label: 'both lower boundaries', lines: ['concurrentUploadNum: 1', 'uploadReceiveTimeoutMs: 1'] },
        { label: 'the upper boundary', lines: ['uploadReceiveTimeoutMs: 2147483647'] },
    ])('starts and serves the API with $label', async ({ lines }) => {
        const operator = await launch(lines);

        expect(operator.isAlive()).toBe(true);
        expect(await serviceAnswers(operator.servicePort)).toBe(true);
    }, 60_000);
});

