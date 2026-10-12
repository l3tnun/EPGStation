import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeServer } from '../_harness';

const terminalEvents = ['exit', 'error', 'disconnect', 'close'] as const;
const activeChildren = new Set<CompiledChild>();

interface Observation {
    readonly testControl: 'observation';
    readonly event: string;
    readonly [key: string]: unknown;
}

interface Waiter<T> {
    readonly after: number;
    readonly predicate: (value: T) => boolean;
    readonly reject: (error: Error) => void;
    readonly resolve: (value: T) => void;
}

const asRecord = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const deferred = <T>() => {
    let reject!: (error: Error) => void;
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
};

const flushTurn = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

const childProgram = String.raw`
const { join } = require('node:path');
require('reflect-metadata');

const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (typeof snapshot !== 'string' || typeof process.send !== 'function') process.exit(90);

let clock = 0;
let timerSerial = 0;
const timers = new Map();
const originalSend = process.send.bind(process);
let holdSnapshotReplies = false;
const heldSnapshotReplies = [];

global.setTimeout = (handler, timeout = 0, ...args) => {
    const handle = { id: ++timerSerial };
    timers.set(handle, { at: clock + Number(timeout), handler: () => handler(...args) });
    return handle;
};
global.clearTimeout = handle => timers.delete(handle);

const observe = (event, values = {}) => process.stdout.write(JSON.stringify({ testControl: 'observation', event, ...values }) + '\n');
process.send = (message, ...args) => {
    if (holdSnapshotReplies && message && message.type === 'recordedUseSnapshotReply') {
        heldSnapshotReplies.push(message);
        const callback = args.find(value => typeof value === 'function');
        if (callback) process.nextTick(() => callback(null));
        observe('snapshotHeld', { id: message.id });
        return true;
    }
    return originalSend(message, ...args);
};

const IPCClient = require(join(snapshot, 'model/ipc/IPCClient.js')).default;
const tokens = new Map();
const logger = {
    system: {
        error: value => observe('log', { value: String(value) }),
        fatal: value => observe('fatal', { value: String(value) }),
        info: () => undefined,
    },
};
const client = new IPCClient(
    { getLogger: () => logger },
    { notifyClient: () => observe('notification', { kind: 'notifyClient' }) },
    { push: value => observe('notification', { kind: 'pushEncode', value }) },
);

const observeState = () =>
    observe('state', {
        leased: client.leased.size,
        messageListeners: process.listenerCount('message'),
        pending: client.pending.size,
        retired: client.retired.size,
        timers: timers.size,
        waiters: client.allocationWaiters.length,
    });

const tick = milliseconds => {
    clock += milliseconds;
    for (;;) {
        const due = [...timers.entries()]
            .filter(([, timer]) => timer.at <= clock)
            .sort(([, left], [, right]) => left.at - right.at);
        if (due.length === 0) return;
        for (const [handle, timer] of due) {
            timers.delete(handle);
            timer.handler();
        }
    }
};

process.on('message', message => {
    if (!message || message.testControl !== 'command') return;
    switch (message.kind) {
        case 'request':
            observe('requestStarted', { key: message.key });
            client.recorded.addVideoFile({ marker: message.marker }).then(
                value => observe('settled', { key: message.key, status: 'resolved', value }),
                error => observe('settled', { error: error.message, key: message.key, status: 'rejected' }),
            );
            return;
        case 'cleanup':
            observe('requestStarted', { key: message.key });
            client.recorded.videoFileCleanup().then(
                value => observe('settled', { key: message.key, status: 'resolved', value }),
                error => observe('settled', { error: error.message, key: message.key, status: 'rejected' }),
            );
            return;
        case 'upload': {
            const attempt = client.uploadedVideoRegistrationPort.dispatch({ filePath: message.filePath });
            attempt.disposition.then(
                disposition => {
                    if (disposition.kind === 'adopted') {
                        observe('uploadAdopted', { key: message.key });
                        disposition.completion.then(
                            () => observe('uploadCompleted', { key: message.key }),
                            error => observe('uploadCompletionRejected', { error: error.message, key: message.key }),
                        );
                        return;
                    }
                    observe('uploadConfirmedNotSent', { error: disposition.error.message, key: message.key });
                },
                error => observe('uploadRejected', { error: error.message, key: message.key }),
            );
            return;
        }
        case 'acquire':
            client.recordedResourceUseClient.acquire(message.recordedId, message.resourceKind).then(
                result => {
                    tokens.set(message.key, result.token);
                    observe('lease', { key: message.key, status: 'granted' });
                },
                error => observe('lease', { error: error.message, key: message.key, status: 'rejected' }),
            );
            return;
        case 'release': {
            const token = tokens.get(message.key);
            client.recordedResourceUseClient.release(token).then(
                () => observe('leaseRelease', { key: message.key, status: 'resolved' }),
                error => observe('leaseRelease', { error: error.message, key: message.key, status: 'rejected' }),
            );
            return;
        }
        case 'snapshot':
            client.recordedUseSnapshotHandlerRegistrationPort.register({ getSnapshot: () => message.snapshot });
            observe('snapshotConfigured', { key: message.key });
            return;
        case 'holdSnapshotReplies':
            holdSnapshotReplies = message.value === true;
            observe('snapshotHolding', { value: holdSnapshotReplies });
            return;
        case 'releaseHeldSnapshot':
            for (const reply of heldSnapshotReplies.splice(0)) originalSend(reply);
            observe('snapshotReleased');
            return;
        case 'tick':
            tick(message.milliseconds);
            observe('ticked', { milliseconds: message.milliseconds });
            return;
        case 'checkpoint':
            observe('checkpoint');
            return;
        case 'state':
            observeState();
            return;
        case 'disconnect':
            observeState();
            process.disconnect();
            return;
        case 'disconnectAndTick':
            process.disconnect();
            tick(message.milliseconds);
            observeState();
            observe('disconnectedAndTicked', { milliseconds: message.milliseconds });
            return;
        case 'shutdown':
            process.exit(0);
    }
});

process.on('message', message => {
    if (!message || message.testControl === 'command') return;
    if (typeof message.id === 'number' || message.type === 'uploadedVideoAdopted') {
        observe('incoming', { id: message.id, type: message.type });
    }
});

observe('ready');
`;

class CompiledChild {
    public readonly child: ChildProcess;
    public readonly observations: Observation[] = [];
    public readonly rawMessages: unknown[] = [];
    private readonly observationWaiters: Waiter<Observation>[] = [];
    private readonly rawWaiters: Waiter<unknown>[] = [];
    private stdout = '';
    private readonly onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        const error = new Error(`compiled child exited before observation: ${code}/${signal}`);
        for (const waiter of this.observationWaiters.splice(0)) waiter.reject(error);
        for (const waiter of this.rawWaiters.splice(0)) waiter.reject(error);
    };
    private readonly onMessage = (message: unknown): void => {
        this.rawMessages.push(message);
        this.resolveWaiters(this.rawMessages, this.rawWaiters);
    };
    private readonly onStdout = (chunk: Buffer | string): void => {
        this.stdout += chunk.toString();
        const lines = this.stdout.split('\n');
        this.stdout = lines.pop() ?? '';
        for (const line of lines) this.recordObservation(JSON.parse(line));
    };
    private recordObservation(message: unknown): void {
        const record = asRecord(message);
        if (record.testControl !== 'observation' || typeof record.event !== 'string') return;
        const observation = record as Observation;
        this.observations.push(observation);
        this.resolveWaiters(this.observations, this.observationWaiters);
    }

    public constructor(child: ChildProcess) {
        this.child = child;
        this.child.on('message', this.onMessage);
        this.child.once('exit', this.onExit);
        this.child.stdout?.setEncoding('utf8');
        this.child.stdout?.on('data', this.onStdout);
    }

    public async command(command: Record<string, unknown>): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            if (this.child.connected !== true) {
                reject(new Error('compiled child is disconnected'));

                return;
            }
            this.child.send({ testControl: 'command', ...command }, error => {
                if (error === null || typeof error === 'undefined') resolve();
                else reject(error);
            });
        });
    }

    public commandNow(command: Record<string, unknown>): void {
        if (this.child.connected !== true) throw new Error('compiled child is disconnected');
        this.child.send({ testControl: 'command', ...command });
    }

    public holdParentMessages(predicate: (message: unknown) => boolean): {
        readonly count: () => number;
        readonly release: () => void;
    } {
        const originalSend = this.child.send.bind(this.child) as (...args: any[]) => boolean;
        const held: Array<readonly [unknown, readonly unknown[]]> = [];
        const heldSend = ((message: unknown, ...args: unknown[]): boolean => {
            if (!predicate(message)) return originalSend(message, ...args);
            held.push([message, args]);
            const callback = args.find(value => typeof value === 'function');
            if (typeof callback === 'function') process.nextTick(() => callback(null));
            return true;
        }) as unknown as ChildProcess['send'];
        this.child.send = heldSend;

        return {
            count: () => held.length,
            release: () => {
                if (this.child.send === heldSend) this.child.send = originalSend as unknown as ChildProcess['send'];
                for (const [message, args] of held.splice(0)) originalSend(message, ...args);
            },
        };
    }

    public waitForObservation(
        event: string,
        predicate: (observation: Observation) => boolean = () => true,
        after = 0,
    ): Promise<Observation> {
        return this.waitFor(
            this.observations,
            this.observationWaiters,
            observation => observation.event === event && predicate(observation),
            after,
        );
    }

    public waitForRaw(predicate: (message: unknown) => boolean, after = 0): Promise<unknown> {
        return this.waitFor(this.rawMessages, this.rawWaiters, predicate, after);
    }

    public async checkpoint(): Promise<void> {
        const after = this.observations.length;
        await this.command({ kind: 'checkpoint' });
        await this.waitForObservation('checkpoint', () => true, after);
    }

    public async state(): Promise<Observation> {
        const after = this.observations.length;
        await this.command({ kind: 'state' });
        return this.waitForObservation('state', () => true, after);
    }

    public async disconnect(): Promise<void> {
        const disconnected = new Promise<void>(resolve => this.child.once('disconnect', () => resolve()));
        this.child.send({ kind: 'disconnect', testControl: 'command' });
        await disconnected;
    }

    public async disconnectAndTick(milliseconds: number): Promise<void> {
        const disconnected = new Promise<void>(resolve => this.child.once('disconnect', () => resolve()));
        this.commandNow({ kind: 'disconnectAndTick', milliseconds });
        await disconnected;
    }

    public async stop(): Promise<void> {
        const disconnected =
            this.child.connected === true
                ? new Promise<void>(resolve => this.child.once('disconnect', () => resolve()))
                : Promise.resolve();
        if (this.child.exitCode === null && this.child.signalCode === null) {
            const exited = new Promise<void>(resolve => this.child.once('exit', () => resolve()));
            if (this.child.connected === true) this.child.send({ kind: 'shutdown', testControl: 'command' });
            else this.child.kill('SIGTERM');
            await exited;
        }
        await disconnected;
        this.child.removeListener('message', this.onMessage);
        this.child.removeListener('exit', this.onExit);
        this.child.stdout?.removeListener('data', this.onStdout);
        this.child.stdout?.destroy();
        this.child.stderr?.destroy();
        activeChildren.delete(this);
    }

    private waitFor<T>(
        values: readonly T[],
        waiters: Waiter<T>[],
        predicate: (value: T) => boolean,
        after: number,
    ): Promise<T> {
        const existing = values.slice(after).find(predicate);
        if (typeof existing !== 'undefined') return Promise.resolve(existing);
        return new Promise<T>((resolve, reject) => waiters.push({ after, predicate, reject, resolve }));
    }

    private resolveWaiters<T>(values: readonly T[], waiters: Waiter<T>[]): void {
        for (let index = waiters.length - 1; index >= 0; index -= 1) {
            const waiter = waiters[index];
            const match = values.slice(waiter.after).find(waiter.predicate);
            if (typeof match === 'undefined') continue;
            waiters.splice(index, 1);
            waiter.resolve(match);
        }
    }
}

const createCompiledChildHarness = async (): Promise<CompiledChild> => {
    const child = spawn(process.execPath, ['-e', childProgram], {
        env: {
            ...process.env,
            EPGSTATION_SERVER_COMPILED_SNAPSHOT: process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT ?? '',
            PATH: process.env.PATH ?? '',
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const harness = new CompiledChild(child);
    activeChildren.add(harness);
    await harness.waitForObservation('ready');
    return harness;
};

const isRecordedRequest =
    (marker: string) =>
    (message: unknown): boolean => {
        const request = asRecord(message);
        const args = asRecord(request.args);
        const option = asRecord(args.option);
        return request.model === 'recorded' && request.func === 'addVideoFile' && option.marker === marker;
    };

const requestId = (message: unknown): number => {
    const id = asRecord(message).id;
    if (typeof id !== 'number') throw new Error('child request did not carry a numeric id');
    return id;
};

afterEach(async () => {
    const children = [...activeChildren];
    await Promise.all(children.map(child => child.stop()));
    for (const child of children) {
        expect(child.child.connected).toBe(false);
        expect(child.child.channel).toBeNull();
        expect(child.child.listenerCount('message')).toBe(0);
        for (const event of terminalEvents) expect(child.child.listenerCount(event)).toBe(0);
        expect(child.child.stdout?.destroyed).toBe(true);
        expect(child.child.stderr?.destroyed).toBe(true);
    }
});

class DisconnectLagChild extends EventEmitter {
    public exitCode: number | null = null;
    public signalCode: NodeJS.Signals | null = null;
    public connected = true;
    public channel: Record<string, unknown> | null = {};
    public readonly stdout = null;
    public readonly stderr = null;

    private scheduleTeardown(): void {
        process.nextTick(() => {
            this.exitCode = 0;
            this.emit('exit', 0, null);
            setImmediate(() => {
                this.connected = false;
                this.channel = null;
                this.emit('disconnect');
            });
        });
    }

    public send(): boolean {
        this.scheduleTeardown();

        return true;
    }

    public kill(): boolean {
        this.scheduleTeardown();

        return true;
    }
}

describe('CompiledChild.stop() teardown race (negative control)', () => {
    it('does not resolve while the IPC channel is still connected, even though exit already fired', async () => {
        const fakeChild = new DisconnectLagChild();
        const harness = new CompiledChild(fakeChild as unknown as ChildProcess);

        await harness.stop();

        expect(fakeChild.connected).toBe(false);
        expect(fakeChild.channel).toBeNull();
    });
});

describe('compiled process-messaging child IPC boundary: out of order, disconnect, replace, restart', () => {
    it('[Task 5.1] correlates out-of-order success and error replies through a real child IPC channel', async () => {
        const first = deferred<string>();
        const second = deferred<string>();
        const { domains, server } = makeServer();
        domains.recorded.addVideoFile.mockImplementation((option: { marker: string }) => {
            if (option.marker === 'first') return first.promise;
            if (option.marker === 'second') return second.promise;
            throw new Error('owner-rejected');
        });
        const child = await createCompiledChildHarness();
        server.register(child.child);

        await child.command({ key: 'first', kind: 'request', marker: 'first' });
        await child.command({ key: 'second', kind: 'request', marker: 'second' });
        await child.waitForRaw(isRecordedRequest('first'));
        await child.waitForRaw(isRecordedRequest('second'));

        second.resolve('second-result');
        await expect(
            child.waitForObservation('settled', observation => observation.key === 'second'),
        ).resolves.toMatchObject({
            key: 'second',
            status: 'resolved',
            value: 'second-result',
        });
        first.resolve('first-result');
        await expect(
            child.waitForObservation('settled', observation => observation.key === 'first'),
        ).resolves.toMatchObject({
            key: 'first',
            status: 'resolved',
            value: 'first-result',
        });

        await child.command({ key: 'error', kind: 'request', marker: 'error' });
        await child.waitForRaw(isRecordedRequest('error'));
        await expect(
            child.waitForObservation('settled', observation => observation.key === 'error'),
        ).resolves.toMatchObject({
            error: 'owner-rejected',
            key: 'error',
            status: 'rejected',
        });
        expect(await child.state()).toMatchObject({ leased: 0, pending: 0, retired: 0, timers: 0, waiters: 0 });
    });

    it('[Task 5.1] keeps the 5-second and 10-minute boundaries terminal across late replies', async () => {
        const normal = deferred<string>();
        const adoption = deferred<string>();
        const { domains, server } = makeServer({
            recordedUploadAdoption: { adopt: () => adoption.promise },
        });
        domains.recorded.addVideoFile.mockReturnValue(normal.promise);
        domains.recorded.addUploadedVideoFile.mockResolvedValue(undefined);
        const child = await createCompiledChildHarness();
        server.register(child.child);

        await child.command({ key: 'normal', kind: 'request', marker: 'normal' });
        const normalRequest = await child.waitForRaw(isRecordedRequest('normal'));
        const normalId = requestId(normalRequest);
        const beforeNormalTimeout = child.observations.length;
        await child.command({ kind: 'tick', milliseconds: 4_999 });
        await child.checkpoint();
        expect(child.observations.slice(beforeNormalTimeout)).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ key: 'normal', event: 'settled' })]),
        );
        await child.command({ kind: 'tick', milliseconds: 1 });
        await expect(
            child.waitForObservation('settled', observation => observation.key === 'normal'),
        ).resolves.toMatchObject({
            error: 'IPCTimeout',
            status: 'rejected',
        });
        expect(
            child.observations.filter(observation => observation.event === 'settled' && observation.key === 'normal'),
        ).toHaveLength(1);
        await child.command({ kind: 'tick', milliseconds: 1 });
        await child.checkpoint();
        expect(
            child.observations.filter(observation => observation.event === 'settled' && observation.key === 'normal'),
        ).toHaveLength(1);
        const afterNormalTimeout = child.observations.length;
        normal.resolve('late-normal-result');
        await child.waitForObservation('incoming', observation => observation.id === normalId, afterNormalTimeout);
        await child.checkpoint();
        expect(child.observations.slice(afterNormalTimeout)).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ key: 'normal', event: 'settled' })]),
        );

        await child.command({ filePath: 'late-upload', key: 'upload', kind: 'upload' });
        const uploadRequest = await child.waitForRaw(message => {
            const request = asRecord(message);
            const option = asRecord(asRecord(request.args).option);
            return (
                request.model === 'recorded' &&
                request.func === 'addUploadedVideoFile' &&
                option.filePath === 'late-upload'
            );
        });
        const uploadId = requestId(uploadRequest);
        const beforeUploadTimeout = child.observations.length;
        await child.command({ kind: 'tick', milliseconds: 599_999 });
        await child.checkpoint();
        expect(child.observations.slice(beforeUploadTimeout)).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ key: 'upload', event: 'uploadRejected' })]),
        );
        await child.command({ kind: 'tick', milliseconds: 1 });
        await expect(
            child.waitForObservation('uploadRejected', observation => observation.key === 'upload'),
        ).resolves.toMatchObject({
            error: 'IPCTimeout',
        });
        expect(
            child.observations.filter(
                observation => observation.event === 'uploadRejected' && observation.key === 'upload',
            ),
        ).toHaveLength(1);
        await child.command({ kind: 'tick', milliseconds: 1 });
        await child.checkpoint();
        expect(
            child.observations.filter(
                observation => observation.event === 'uploadRejected' && observation.key === 'upload',
            ),
        ).toHaveLength(1);
        const afterUploadTimeout = child.observations.length;
        adoption.resolve('adopted-late-upload');
        const acknowledged = await child.waitForObservation(
            'incoming',
            observation => observation.id === uploadId && observation.type === 'uploadedVideoAdopted',
            afterUploadTimeout,
        );
        await child.waitForObservation(
            'incoming',
            observation => observation.id === uploadId && typeof observation.type === 'undefined',
            child.observations.indexOf(acknowledged) + 1,
        );
        await child.checkpoint();
        expect(child.observations.slice(afterUploadTimeout)).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ key: 'upload', event: 'uploadAdopted' })]),
        );
        expect(await child.state()).toMatchObject({ leased: 0, pending: 0, retired: 0, timers: 0, waiters: 0 });
    });

    it.each([
        ['5-second', 5_000, 'request'],
        ['10-minute', 600_000, 'cleanup'],
    ])(
        '[Task 5.1] preserves the %s reply-first and timeout-first terminal result when both IPC messages share a turn',
        async (_deadlineName, deadline, operation) => {
            const replyFirst = deferred<void>();
            const timeoutFirst = deferred<void>();
            const { domains, server } = makeServer();
            if (operation === 'request') {
                domains.recorded.addVideoFile.mockImplementation((option: { marker: string }) => {
                    if (option.marker === 'reply-first') return replyFirst.promise;
                    if (option.marker === 'timeout-first') return timeoutFirst.promise;
                    throw new Error(`unexpected marker: ${option.marker}`);
                });
            } else {
                domains.recorded.videoFileCleanup
                    .mockReturnValueOnce(replyFirst.promise)
                    .mockReturnValueOnce(timeoutFirst.promise);
            }
            const child = await createCompiledChildHarness();
            server.register(child.child);

            const start = async (key: string): Promise<void> => {
                if (operation === 'request') {
                    await child.command({ key, kind: 'request', marker: key });
                    await child.waitForRaw(isRecordedRequest(key));
                    return;
                }
                const after = child.rawMessages.length;
                await child.command({ key, kind: 'cleanup' });
                await child.waitForRaw(message => {
                    const request = asRecord(message);
                    return request.model === 'recorded' && request.func === 'videoFileCleanup';
                }, after);
            };

            const replyFirstHeld = child.holdParentMessages(message => {
                const reply = asRecord(message);
                return reply.id === 1;
            });
            await start('reply-first');
            replyFirst.resolve();
            await flushTurn();
            expect(replyFirstHeld.count()).toBe(1);
            const replyFirstAfter = child.observations.length;
            replyFirstHeld.release();
            child.commandNow({ kind: 'tick', milliseconds: deadline });
            await expect(
                child.waitForObservation('settled', observation => observation.key === 'reply-first', replyFirstAfter),
            ).resolves.toMatchObject({
                key: 'reply-first',
                status: 'resolved',
            });
            expect(
                child.observations.filter(
                    observation => observation.event === 'settled' && observation.key === 'reply-first',
                ),
            ).toHaveLength(1);

            const timeoutFirstHeld = child.holdParentMessages(message => {
                const reply = asRecord(message);
                return reply.id === 2;
            });
            await start('timeout-first');
            timeoutFirst.resolve();
            await flushTurn();
            expect(timeoutFirstHeld.count()).toBe(1);
            const timeoutFirstAfter = child.observations.length;
            child.commandNow({ kind: 'tick', milliseconds: deadline });
            timeoutFirstHeld.release();
            await expect(
                child.waitForObservation(
                    'settled',
                    observation => observation.key === 'timeout-first',
                    timeoutFirstAfter,
                ),
            ).resolves.toMatchObject({
                error: 'IPCTimeout',
                key: 'timeout-first',
                status: 'rejected',
            });
            await child.waitForObservation(
                'incoming',
                observation => observation.id === 2 && typeof observation.type === 'undefined',
            );
            expect(
                child.observations.filter(
                    observation => observation.event === 'settled' && observation.key === 'timeout-first',
                ),
            ).toHaveLength(1);
            expect(await child.state()).toMatchObject({ leased: 0, pending: 0, retired: 0, timers: 0, waiters: 0 });
        },
    );

    it.each(terminalEvents)(
        '[Task 5.1] keeps the new live child current after stale %s while two requesters use id 1 and complete in reverse',
        async terminalEvent => {
            const oldRequest = deferred<string>();
            const newRequest = deferred<string>();
            const { domains, server } = makeServer();
            domains.recorded.addVideoFile.mockImplementation((option: { marker: string }) => {
                if (option.marker === 'old') return oldRequest.promise;
                if (option.marker === 'new') return newRequest.promise;
                throw new Error(`unexpected marker: ${option.marker}`);
            });
            const oldChild = await createCompiledChildHarness();
            server.register(oldChild.child);
            await oldChild.command({ key: 'old', kind: 'request', marker: 'old' });
            const oldMessage = await oldChild.waitForRaw(isRecordedRequest('old'));

            const replacement = await createCompiledChildHarness();
            server.register(replacement.child);
            await replacement.command({ key: 'new', kind: 'request', marker: 'new' });
            const newMessage = await replacement.waitForRaw(isRecordedRequest('new'));
            expect(requestId(oldMessage)).toBe(1);
            expect(requestId(newMessage)).toBe(1);
            expect(oldChild.child.connected).toBe(true);
            expect(replacement.child.connected).toBe(true);

            newRequest.resolve('new-result');
            await expect(
                replacement.waitForObservation('settled', observation => observation.key === 'new'),
            ).resolves.toMatchObject({ key: 'new', status: 'resolved', value: 'new-result' });
            oldRequest.resolve('old-result');
            await expect(
                oldChild.waitForObservation('settled', observation => observation.key === 'old'),
            ).resolves.toMatchObject({ key: 'old', status: 'resolved', value: 'old-result' });

            if (terminalEvent === 'error') {
                const ignoredError = (): void => undefined;
                oldChild.child.once('error', ignoredError);
                oldChild.child.emit('error', new Error('stale child terminal'));
            } else if (terminalEvent === 'exit' || terminalEvent === 'close') {
                oldChild.child.emit(terminalEvent, 0, null);
            } else {
                oldChild.child.emit(terminalEvent);
            }

            const notificationAfter = replacement.observations.length;
            server.notifyClient();
            await expect(
                replacement.waitForObservation(
                    'notification',
                    observation => observation.kind === 'notifyClient',
                    notificationAfter,
                ),
            ).resolves.toMatchObject({ kind: 'notifyClient' });
            expect(oldChild.child.connected).toBe(true);
            expect(replacement.child.connected).toBe(true);
            expect(oldChild.child.listenerCount('message')).toBe(1);
        },
    );

    it.each(terminalEvents)(
        '[Task 5.1] releases the current %s peer before a notification can be sent and removes every peer listener',
        async terminalEvent => {
            const { logError, server } = makeServer();
            const child = await createCompiledChildHarness();
            const baselineListeners = {
                close: child.child.listenerCount('close'),
                disconnect: child.child.listenerCount('disconnect'),
                error: child.child.listenerCount('error'),
                exit: child.child.listenerCount('exit'),
                message: child.child.listenerCount('message'),
            };
            server.register(child.child);
            expect(child.child.connected).toBe(true);
            expect(child.child.listenerCount('message')).toBe(baselineListeners.message + 1);
            for (const event of terminalEvents) {
                expect(child.child.listenerCount(event)).toBe(baselineListeners[event] + 1);
            }

            if (terminalEvent === 'error') {
                child.child.emit('error', new Error('current child terminal'));
            } else if (terminalEvent === 'exit' || terminalEvent === 'close') {
                child.child.emit(terminalEvent, 0, null);
            } else {
                child.child.emit(terminalEvent);
            }

            expect(server.child).toBeNull();
            expect(server.currentPeer).toBeNull();
            expect(child.child.listenerCount('message')).toBe(baselineListeners.message);
            for (const event of terminalEvents) {
                const expectedListeners = event === 'exit' && terminalEvent === 'exit' ? 0 : baselineListeners[event];
                expect(child.child.listenerCount(event)).toBe(expectedListeners);
            }
            const notificationAfter = child.observations.length;
            server.notifyClient();
            await flushTurn();
            expect(logError).toHaveBeenLastCalledWith(
                'IPC notification discarded: notification recipient is unavailable',
            );
            expect(child.observations.slice(notificationAfter)).not.toEqual(
                expect.arrayContaining([expect.objectContaining({ event: 'notification' })]),
            );
        },
    );

    it('[Task 5.1] lets a disconnected child reach one timeout terminal and release its timer before the harness stops it', async () => {
        const deferredRequest = deferred<string>();
        const { domains, logError, server } = makeServer();
        domains.recorded.addVideoFile.mockReturnValue(deferredRequest.promise);
        const child = await createCompiledChildHarness();
        server.register(child.child);
        const baselineState = await child.state();

        await child.command({ key: 'disconnect-timeout', kind: 'request', marker: 'disconnect-timeout' });
        await child.waitForRaw(isRecordedRequest('disconnect-timeout'));
        const afterDisconnect = child.observations.length;
        await child.disconnectAndTick(5_000);
        await expect(
            child.waitForObservation(
                'settled',
                observation => observation.key === 'disconnect-timeout',
                afterDisconnect,
            ),
        ).resolves.toMatchObject({
            error: 'IPCTimeout',
            key: 'disconnect-timeout',
            status: 'rejected',
        });
        await expect(
            child.waitForObservation('state', observation => observation.timers === 0, afterDisconnect),
        ).resolves.toMatchObject({
            leased: 0,
            messageListeners: baselineState.messageListeners,
            pending: 0,
            retired: 1,
            timers: 0,
            waiters: 0,
        });
        expect(
            child.observations.filter(
                observation => observation.event === 'settled' && observation.key === 'disconnect-timeout',
            ),
        ).toHaveLength(1);
        expect(child.child.listenerCount('message')).toBe(1);
        expect(child.child.listenerCount('disconnect')).toBe(0);
        expect(child.child.listenerCount('error')).toBe(0);
        expect(child.child.listenerCount('close')).toBe(0);

        deferredRequest.resolve('late-disconnected-result');
        await flushTurn();
        expect(logError).toHaveBeenCalledWith('IPC reply discarded: requester is disconnected');
        expect(
            child.observations.filter(
                observation => observation.event === 'settled' && observation.key === 'disconnect-timeout',
            ),
        ).toHaveLength(1);
    });

    it('[Task 5.1] isolates an old requester after disconnect while a restarted peer owns new notifications and fresh ids', async () => {
        const oldRequest = deferred<string>();
        const { domains, logError, server } = makeServer();
        domains.recorded.addVideoFile.mockImplementation((option: { marker: string }) =>
            option.marker === 'old' ? oldRequest.promise : option.marker,
        );
        const oldChild = await createCompiledChildHarness();
        server.register(oldChild.child);
        await oldChild.command({ key: 'old', kind: 'request', marker: 'old' });
        await oldChild.waitForRaw(isRecordedRequest('old'));

        const replacement = await createCompiledChildHarness();
        server.register(replacement.child);
        await oldChild.disconnect();
        server.notifyClient();
        await expect(
            replacement.waitForObservation('notification', observation => observation.kind === 'notifyClient'),
        ).resolves.toMatchObject({
            kind: 'notifyClient',
        });
        server.setEncode({ recordedId: 52 } as never);
        await expect(
            replacement.waitForObservation('notification', observation => observation.kind === 'pushEncode'),
        ).resolves.toMatchObject({
            kind: 'pushEncode',
            value: { recordedId: 52 },
        });

        oldRequest.resolve('must-not-forward');
        await flushTurn();
        expect(logError).toHaveBeenCalledWith('IPC reply discarded: requester is disconnected');
        expect(oldChild.observations).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ key: 'old', event: 'settled' })]),
        );

        await replacement.stop();
        for (const event of terminalEvents) expect(replacement.child.listenerCount(event)).toBe(0);
        expect(replacement.child.listenerCount('message')).toBe(0);

        const restarted = await createCompiledChildHarness();
        server.register(restarted.child);
        await restarted.command({ key: 'restart', kind: 'request', marker: 'restart' });
        const restartedRequest = await restarted.waitForRaw(isRecordedRequest('restart'));
        expect(requestId(restartedRequest)).toBe(1);
        await expect(
            restarted.waitForObservation('settled', observation => observation.key === 'restart'),
        ).resolves.toMatchObject({
            status: 'resolved',
            value: 'restart',
        });
        await restarted.stop();
        server.notifyClient();
        expect(logError).toHaveBeenLastCalledWith('IPC notification discarded: notification recipient is unavailable');
    });

    it('[Task 5.2] keeps lease, snapshot, and upload-adoption ownership generation-scoped over child IPC', async () => {
        const activeLeases = new Map<number, { readonly requestId: number; readonly senderPeer: object }>();
        const acquired: Array<{
            readonly recordedId: number;
            readonly requestId: number;
            readonly senderPeer: object;
        }> = [];
        const released: Array<{ readonly acquisitionRequestId: number; readonly senderPeer: object }> = [];
        const uploadCompletion = deferred<void>();
        const adopt = vi.fn(async (filePath: string) => `adopted:${filePath}`);
        const { domains, server } = makeServer({ recordedUploadAdoption: { adopt } });
        domains.recorded.addUploadedVideoFile.mockReturnValue(uploadCompletion.promise);
        server.recordedResourceUseRegistryRegistrationPort.register({
            acquire: input => {
                acquired.push(input);
                if (activeLeases.has(input.recordedId)) return { status: 'blocked' };
                activeLeases.set(input.recordedId, { requestId: input.requestId, senderPeer: input.senderPeer });
                return { status: 'granted' };
            },
            release: input => {
                released.push(input);
                for (const [recordedId, lease] of activeLeases) {
                    if (lease.requestId !== input.acquisitionRequestId || lease.senderPeer !== input.senderPeer)
                        continue;
                    activeLeases.delete(recordedId);
                    return 'released';
                }
                return 'unknown';
            },
        });
        const oldChild = await createCompiledChildHarness();
        server.register(oldChild.child);

        await oldChild.command({ key: 'releaseable', kind: 'acquire', recordedId: 71, resourceKind: 'encoding' });
        await expect(
            oldChild.waitForObservation('lease', observation => observation.key === 'releaseable'),
        ).resolves.toMatchObject({
            status: 'granted',
        });
        await oldChild.command({ key: 'releaseable', kind: 'release' });
        await expect(
            oldChild.waitForObservation('leaseRelease', observation => observation.key === 'releaseable'),
        ).resolves.toMatchObject({
            status: 'resolved',
        });
        const beforeDuplicateRelease = oldChild.observations.length;
        await oldChild.command({ key: 'releaseable', kind: 'release' });
        await oldChild.waitForObservation(
            'leaseRelease',
            observation => observation.key === 'releaseable',
            beforeDuplicateRelease,
        );
        expect(released).toHaveLength(1);
        expect(activeLeases.size).toBe(0);
        expect(await oldChild.state()).toMatchObject({ leased: 0, pending: 0, retired: 0, timers: 0, waiters: 0 });

        await oldChild.command({ key: 'held', kind: 'acquire', recordedId: 72, resourceKind: 'delivery' });
        await expect(
            oldChild.waitForObservation('lease', observation => observation.key === 'held'),
        ).resolves.toMatchObject({ status: 'granted' });
        await oldChild.command({
            key: 'old-snapshot',
            kind: 'snapshot',
            snapshot: { recordedIds: [7, 8], status: 'known' },
        });
        await oldChild.command({ kind: 'holdSnapshotReplies', value: true });
        const oldSnapshot = server.recordedUseSnapshotClient.requestSnapshot();
        await oldChild.waitForObservation('snapshotHeld');

        const replacement = await createCompiledChildHarness();
        server.register(replacement.child);
        await expect(oldSnapshot).resolves.toEqual({ status: 'unknown' });
        const beforeReleasedSnapshot = oldChild.rawMessages.length;
        await oldChild.command({ kind: 'releaseHeldSnapshot' });
        await oldChild.waitForRaw(
            message => asRecord(message).type === 'recordedUseSnapshotReply',
            beforeReleasedSnapshot,
        );

        await replacement.command({
            key: 'new-snapshot',
            kind: 'snapshot',
            snapshot: { recordedIds: [9], status: 'known' },
        });
        await replacement.command({ key: 'blocked', kind: 'acquire', recordedId: 72, resourceKind: 'delivery' });
        await expect(
            replacement.waitForObservation('lease', observation => observation.key === 'blocked'),
        ).resolves.toMatchObject({
            error: 'RecordedResourceUseBlocked',
            status: 'rejected',
        });
        await expect(server.recordedUseSnapshotClient.requestSnapshot()).resolves.toEqual({
            recordedIds: [9],
            status: 'known',
        });
        expect(acquired).toHaveLength(3);
        expect(activeLeases.get(72)?.senderPeer).toBe(oldChild.child);

        const beforeStaleRelease = oldChild.observations.length;
        await oldChild.command({ key: 'held', kind: 'release' });
        await oldChild.command({ kind: 'tick', milliseconds: 5_000 });
        await expect(
            oldChild.waitForObservation('leaseRelease', observation => observation.key === 'held', beforeStaleRelease),
        ).resolves.toMatchObject({
            error: 'IPCTimeout',
            status: 'rejected',
        });
        expect(released).toHaveLength(1);
        expect(activeLeases.get(72)?.senderPeer).toBe(oldChild.child);

        await replacement.command({ filePath: 'upload-owner', key: 'upload', kind: 'upload' });
        await replacement.waitForRaw(message => {
            const request = asRecord(message);
            return request.model === 'recorded' && request.func === 'addUploadedVideoFile';
        });
        await expect(
            replacement.waitForObservation('uploadAdopted', observation => observation.key === 'upload'),
        ).resolves.toMatchObject({
            key: 'upload',
        });
        expect(adopt).toHaveBeenCalledOnce();
        expect(domains.recorded.addUploadedVideoFile).toHaveBeenCalledWith({ filePath: 'adopted:upload-owner' });
        uploadCompletion.resolve();
        await expect(
            replacement.waitForObservation('uploadCompleted', observation => observation.key === 'upload'),
        ).resolves.toMatchObject({
            key: 'upload',
        });
        expect(
            replacement.observations.filter(
                observation => observation.event === 'uploadAdopted' && observation.key === 'upload',
            ),
        ).toHaveLength(1);
        expect(await oldChild.state()).toMatchObject({ leased: 1, pending: 0, retired: 0, timers: 0, waiters: 0 });
        expect((await replacement.state()).timers).toBe(0);
    });

    it('[Task 5.2] discards deferred carrier results across generations and compensates one late granted lease', async () => {
        const activeLeases = new Map<number, { readonly requestId: number; readonly senderPeer: object }>();
        const released: Array<{ readonly acquisitionRequestId: number; readonly senderPeer: object }> = [];
        const adoption = deferred<string>();
        const adopt = vi.fn(() => adoption.promise);
        const { domains, server } = makeServer({ recordedUploadAdoption: { adopt } });
        domains.recorded.addUploadedVideoFile.mockResolvedValue(undefined);
        server.recordedResourceUseRegistryRegistrationPort.register({
            acquire: input => {
                activeLeases.set(input.recordedId, { requestId: input.requestId, senderPeer: input.senderPeer });
                return { status: 'granted' };
            },
            release: input => {
                released.push(input);
                for (const [recordedId, lease] of activeLeases) {
                    if (lease.requestId !== input.acquisitionRequestId || lease.senderPeer !== input.senderPeer)
                        continue;
                    activeLeases.delete(recordedId);
                    return 'released';
                }
                return 'unknown';
            },
        });
        const oldChild = await createCompiledChildHarness();
        server.register(oldChild.child);

        const heldAcquireReply = oldChild.holdParentMessages(
            message => asRecord(message).type === 'recordedUseAcquireReply',
        );
        await oldChild.command({ key: 'late-acquire', kind: 'acquire', recordedId: 91, resourceKind: 'encoding' });
        const lateAcquire = await oldChild.waitForRaw(message => asRecord(message).type === 'recordedUseAcquire');
        await flushTurn();
        expect(heldAcquireReply.count()).toBe(1);
        const lateAcquireId = requestId(lateAcquire);
        const afterAcquireTimeout = oldChild.observations.length;
        await oldChild.command({ kind: 'tick', milliseconds: 4_999 });
        await oldChild.checkpoint();
        expect(oldChild.observations.slice(afterAcquireTimeout)).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ event: 'lease', key: 'late-acquire' })]),
        );
        expect((await oldChild.state()).timers).toBe(1);
        await oldChild.command({ kind: 'tick', milliseconds: 1 });
        await expect(
            oldChild.waitForObservation(
                'lease',
                observation => observation.key === 'late-acquire',
                afterAcquireTimeout,
            ),
        ).resolves.toMatchObject({
            error: 'IPCTimeout',
            key: 'late-acquire',
            status: 'rejected',
        });
        expect((await oldChild.state()).timers).toBe(0);

        heldAcquireReply.release();
        await oldChild.waitForRaw(message => {
            const release = asRecord(message);
            return release.type === 'recordedUseRelease' && release.acquisitionRequestId === lateAcquireId;
        });
        await flushTurn();
        expect(released).toHaveLength(1);
        expect(activeLeases.size).toBe(0);
        expect(
            oldChild.observations.filter(
                observation => observation.event === 'lease' && observation.key === 'late-acquire',
            ),
        ).toHaveLength(1);
        expect((await oldChild.state()).timers).toBe(0);

        await oldChild.command({
            key: 'old-snapshot',
            kind: 'snapshot',
            snapshot: { recordedIds: [91], status: 'known' },
        });
        await oldChild.command({ kind: 'holdSnapshotReplies', value: true });
        const oldSnapshot = server.recordedUseSnapshotClient.requestSnapshot();
        await oldChild.waitForObservation('snapshotHeld');

        const replacement = await createCompiledChildHarness();
        server.register(replacement.child);
        await expect(oldSnapshot).resolves.toEqual({ status: 'unknown' });
        expect(server.pendingSnapshots.size).toBe(0);
        expect(oldChild.child.listenerCount('message')).toBe(1);
        expect(oldChild.child.listenerCount('disconnect')).toBe(0);
        expect(oldChild.child.listenerCount('error')).toBe(0);
        expect(oldChild.child.listenerCount('close')).toBe(0);

        await replacement.command({
            key: 'replacement-snapshot',
            kind: 'snapshot',
            snapshot: { recordedIds: [92], status: 'known' },
        });
        await replacement.command({ kind: 'holdSnapshotReplies', value: true });
        const replacementSnapshot = server.recordedUseSnapshotClient.requestSnapshot();
        await replacement.waitForObservation('snapshotHeld');
        expect(server.pendingSnapshots.size).toBe(1);
        const oldLateSnapshotAfter = oldChild.rawMessages.length;
        await oldChild.command({ kind: 'releaseHeldSnapshot' });
        await oldChild.waitForRaw(
            message => asRecord(message).type === 'recordedUseSnapshotReply',
            oldLateSnapshotAfter,
        );
        await flushTurn();
        expect(server.pendingSnapshots.size).toBe(1);
        let replacementSnapshotSettled = false;
        void replacementSnapshot.then(() => {
            replacementSnapshotSettled = true;
        });
        await flushTurn();
        expect(replacementSnapshotSettled).toBe(false);
        await replacement.command({ kind: 'releaseHeldSnapshot' });
        await expect(replacementSnapshot).resolves.toEqual({ recordedIds: [92], status: 'known' });
        expect(server.pendingSnapshots.size).toBe(0);

        await replacement.command({ filePath: 'late-upload-ack', key: 'late-upload', kind: 'upload' });
        await replacement.waitForRaw(message => {
            const request = asRecord(message);
            const option = asRecord(asRecord(request.args).option);
            return (
                request.model === 'recorded' &&
                request.func === 'addUploadedVideoFile' &&
                option.filePath === 'late-upload-ack'
            );
        });
        const afterUploadTimeout = replacement.observations.length;
        await replacement.command({ kind: 'tick', milliseconds: 600_000 });
        await expect(
            replacement.waitForObservation(
                'uploadRejected',
                observation => observation.key === 'late-upload',
                afterUploadTimeout,
            ),
        ).resolves.toMatchObject({ error: 'IPCTimeout', key: 'late-upload' });
        adoption.resolve('adopted:late-upload-ack');
        await replacement.waitForObservation(
            'incoming',
            observation => typeof observation.id === 'number' && observation.type === 'uploadedVideoAdopted',
            afterUploadTimeout,
        );
        await replacement.waitForObservation(
            'incoming',
            observation => typeof observation.id === 'number' && typeof observation.type === 'undefined',
            afterUploadTimeout,
        );
        expect(adopt).toHaveBeenCalledOnce();
        expect(domains.recorded.addUploadedVideoFile).toHaveBeenCalledOnce();
        expect(domains.recorded.addUploadedVideoFile).toHaveBeenCalledWith({ filePath: 'adopted:late-upload-ack' });
        expect(
            replacement.observations.filter(
                observation => observation.event === 'uploadAdopted' && observation.key === 'late-upload',
            ),
        ).toHaveLength(0);
        expect(
            replacement.observations.filter(
                observation => observation.event === 'uploadCompleted' && observation.key === 'late-upload',
            ),
        ).toHaveLength(0);
        expect((await oldChild.state()).timers).toBe(0);
        expect((await replacement.state()).timers).toBe(0);
    });

    it('[Task 5.2] keeps a held snapshot pending through 4,999ms, times out at 5,000ms, and ignores its late reply', async () => {
        const { server } = makeServer();
        const child = await createCompiledChildHarness();
        server.register(child.child);
        await child.command({
            key: 'timeout-snapshot',
            kind: 'snapshot',
            snapshot: { recordedIds: [93], status: 'known' },
        });
        await child.command({ kind: 'holdSnapshotReplies', value: true });

        vi.useFakeTimers();
        try {
            let settlementCount = 0;
            const snapshot = server.recordedUseSnapshotClient.requestSnapshot();
            void snapshot.then(() => {
                settlementCount += 1;
            });
            await child.waitForObservation('snapshotHeld');
            expect(server.pendingSnapshots.size).toBe(1);

            await vi.advanceTimersByTimeAsync(4_999);
            expect(settlementCount).toBe(0);
            expect(server.pendingSnapshots.size).toBe(1);
            await vi.advanceTimersByTimeAsync(1);
            await expect(snapshot).resolves.toEqual({ status: 'unknown' });
            expect(settlementCount).toBe(1);
            expect(server.pendingSnapshots.size).toBe(0);

            const lateSnapshotAfter = child.rawMessages.length;
            await child.command({ kind: 'releaseHeldSnapshot' });
            await child.waitForRaw(message => asRecord(message).type === 'recordedUseSnapshotReply', lateSnapshotAfter);
            await Promise.resolve();
            expect(settlementCount).toBe(1);
            expect(server.pendingSnapshots.size).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('[Task 5.2] never forwards late upload adoption acknowledgement or reply from a replaced and disconnected child', async () => {
        const adoption = deferred<string>();
        const adopt = vi.fn(() => adoption.promise);
        const { domains, logError, server } = makeServer({ recordedUploadAdoption: { adopt } });
        domains.recorded.addUploadedVideoFile.mockResolvedValue(undefined);
        const oldChild = await createCompiledChildHarness();
        server.register(oldChild.child);
        await oldChild.command({ filePath: 'old-generation-upload', key: 'old-upload', kind: 'upload' });
        await oldChild.waitForRaw(message => {
            const request = asRecord(message);
            const option = asRecord(asRecord(request.args).option);
            return (
                request.model === 'recorded' &&
                request.func === 'addUploadedVideoFile' &&
                option.filePath === 'old-generation-upload'
            );
        });

        const replacement = await createCompiledChildHarness();
        server.register(replacement.child);
        const replacementAfter = replacement.observations.length;
        const oldDisconnectAfter = oldChild.observations.length;
        await oldChild.disconnectAndTick(600_000);
        await expect(
            oldChild.waitForObservation(
                'uploadRejected',
                observation => observation.key === 'old-upload',
                oldDisconnectAfter,
            ),
        ).resolves.toMatchObject({ error: 'IPCTimeout', key: 'old-upload' });
        await expect(
            oldChild.waitForObservation('state', observation => observation.timers === 0, oldDisconnectAfter),
        ).resolves.toMatchObject({ leased: 0, pending: 0, retired: 1, timers: 0, waiters: 0 });

        adoption.resolve('adopted:old-generation-upload');
        await flushTurn();
        expect(adopt).toHaveBeenCalledOnce();
        expect(domains.recorded.addUploadedVideoFile).toHaveBeenCalledOnce();
        expect(domains.recorded.addUploadedVideoFile).toHaveBeenCalledWith({
            filePath: 'adopted:old-generation-upload',
        });
        expect(logError).toHaveBeenCalledTimes(2);
        expect(logError).toHaveBeenCalledWith('IPC reply discarded: requester is disconnected');
        expect(replacement.observations.slice(replacementAfter)).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ event: 'incoming' }),
                expect.objectContaining({ event: 'uploadAdopted' }),
                expect.objectContaining({ event: 'uploadCompleted' }),
            ]),
        );
        expect((await replacement.state()).timers).toBe(0);
    });
});
