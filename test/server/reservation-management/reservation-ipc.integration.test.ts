import { spawn, type ChildProcess } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { makeServer } from '../process-messaging/_harness';

interface Observation {
    readonly event: string;
    readonly [key: string]: unknown;
}

interface Waiter<T> {
    readonly predicate: (value: T) => boolean;
    readonly reject: (error: Error) => void;
    readonly resolve: (value: T) => void;
}

const childProgram = String.raw`
const { join } = require('node:path');
require('reflect-metadata');

const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (typeof snapshot !== 'string' || typeof process.send !== 'function') process.exit(90);

let clock = 0;
let timerSerial = 0;
const timers = new Map();
global.setTimeout = (handler, timeout = 0, ...args) => {
    const handle = { id: ++timerSerial };
    timers.set(handle, { at: clock + Number(timeout), handler: () => handler(...args) });
    return handle;
};
global.clearTimeout = handle => timers.delete(handle);

const observe = (event, values = {}) => process.stdout.write(JSON.stringify({ event, ...values }) + '\n');
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

const IPCClient = require(join(snapshot, 'model/ipc/IPCClient.js')).default;
const client = new IPCClient(
    { getLogger: () => ({ system: { error: () => undefined, fatal: () => undefined, info: () => undefined } }) },
    { notifyClient: () => undefined },
    { push: () => undefined },
);

const observeCarrierState = key =>
    observe('state', {
        key,
        messageListeners: process.listenerCount('message'),
        pending: client.pending.size,
        retired: client.retired.size,
        timers: timers.size,
    });

process.on('message', message => {
    if (!message || message.testControl !== 'command') return;
    if (message.kind === 'invoke') {
        observe('invoked', { key: message.key });
        client.reserveation[message.operation](...message.args).then(
            result => observe('settled', { key: message.key, result, status: 'resolved' }),
            error => observe('settled', { error: error.message, key: message.key, status: 'rejected' }),
        );
        return;
    }
    if (message.kind === 'tick') {
        tick(message.milliseconds);
        observe('ticked', { milliseconds: message.milliseconds });
        return;
    }
    if (message.kind === 'state') {
        observeCarrierState(message.key);
        return;
    }
    if (message.kind === 'shutdown') process.exit(0);
});

process.on('message', message => {
    if (!message || message.testControl === 'command' || typeof message.id !== 'number') return;
    observe('reply', {
        error: message.error,
        hasResult: Object.hasOwn(message, 'result'),
        id: message.id,
        keys: Object.keys(message).sort(),
        result: message.result,
    });
});

observe('ready');
`;

const asRecord = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

class CompiledReservationClient {
    public readonly child: ChildProcess;
    public readonly observations: Observation[] = [];
    public readonly requests: unknown[] = [];
    private readonly observationWaiters: Waiter<Observation>[] = [];
    private readonly requestWaiters: Waiter<unknown>[] = [];
    private stdout = '';

    public constructor() {
        this.child = spawn(process.execPath, ['-e', childProgram], {
            env: {
                ...process.env,
                EPGSTATION_SERVER_COMPILED_SNAPSHOT: process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT ?? '',
                PATH: process.env.PATH ?? '',
            },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });
        this.child.on('message', this.recordRequest);
        this.child.stdout?.setEncoding('utf8');
        this.child.stdout?.on('data', this.recordOutput);
    }

    public async command(command: Record<string, unknown>): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            if (this.child.connected !== true) {
                reject(new Error('compiled reservation IPC child is disconnected'));

                return;
            }
            this.child.send({ testControl: 'command', ...command }, error => {
                if (error === null || typeof error === 'undefined') resolve();
                else reject(error);
            });
        });
    }

    public waitForObservation(
        event: string,
        predicate: (observation: Observation) => boolean = () => true,
    ): Promise<Observation> {
        return this.waitFor(
            this.observations,
            this.observationWaiters,
            observation => observation.event === event && predicate(observation),
        );
    }

    public waitForRequest(predicate: (request: unknown) => boolean): Promise<unknown> {
        return this.waitFor(this.requests, this.requestWaiters, predicate);
    }

    public async stop(): Promise<void> {
        if (this.child.exitCode === null && this.child.signalCode === null) {
            const exited = new Promise<void>(resolve => this.child.once('exit', () => resolve()));
            if (this.child.connected === true) await this.command({ kind: 'shutdown' });
            else this.child.kill('SIGTERM');
            await exited;
        }
        this.child.removeListener('message', this.recordRequest);
        this.child.stdout?.removeListener('data', this.recordOutput);
        this.child.stdout?.destroy();
        this.child.stderr?.destroy();
    }

    private readonly recordOutput = (chunk: Buffer | string): void => {
        this.stdout += chunk.toString();
        const lines = this.stdout.split('\n');
        this.stdout = lines.pop() ?? '';
        for (const line of lines) {
            const observation = JSON.parse(line) as Observation;
            this.observations.push(observation);
            this.resolveWaiters(this.observations, this.observationWaiters);
        }
    };

    private readonly recordRequest = (request: unknown): void => {
        this.requests.push(request);
        this.resolveWaiters(this.requests, this.requestWaiters);
    };

    private waitFor<T>(values: readonly T[], waiters: Waiter<T>[], predicate: (value: T) => boolean): Promise<T> {
        const existing = values.find(predicate);
        if (typeof existing !== 'undefined') return Promise.resolve(existing);
        return new Promise<T>((resolve, reject) => waiters.push({ predicate, reject, resolve }));
    }

    private resolveWaiters<T>(values: readonly T[], waiters: Waiter<T>[]): void {
        for (let index = waiters.length - 1; index >= 0; index -= 1) {
            const waiter = waiters[index];
            const match = values.find(waiter.predicate);
            if (typeof match === 'undefined') continue;
            waiters.splice(index, 1);
            waiter.resolve(match);
        }
    }
}

const deferred = <T = void>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

let activeChild: CompiledReservationClient | undefined;

afterEach(async () => {
    await activeChild?.stop();
    activeChild = undefined;
});

describe('reservation IPC command/query carrier', () => {
    it.each([
        { args: [], name: 'getBroadcastStatus', result: { isBroadcasting: false } },
        { args: [{ programId: 101 }], name: 'add', result: 401 },
        { args: [11], name: 'update', result: undefined },
        { args: [12], name: 'updateRule', result: undefined },
        { args: [13], name: 'cancel', result: undefined },
        { args: [14], name: 'removeSkip', result: undefined },
        { args: [15], name: 'removeOverlap', result: undefined },
        { args: [16, { tags: [1] }], name: 'edit', result: undefined },
    ])('preserves $name input and domain result', async operation => {
        const serverHarness = makeServer();
        activeChild = new CompiledReservationClient();
        await activeChild.waitForObservation('ready');
        serverHarness.server.register(activeChild.child);
        serverHarness.domains.reservation[operation.name].mockResolvedValue(operation.result);

        await activeChild.command({
            args: operation.args,
            key: operation.name,
            kind: 'invoke',
            operation: operation.name,
        });
        const request = await activeChild.waitForRequest(candidate => asRecord(candidate).model === 'reserveation');
        const envelope = asRecord(request);
        expect(envelope).toEqual({
            args: operation.name === 'getBroadcastStatus' ? undefined : expect.any(Object),
            func: operation.name,
            id: expect.any(Number),
            model: 'reserveation',
        });
        expect(serverHarness.domains.reservation[operation.name]).toHaveBeenCalledExactlyOnceWith(...operation.args);

        const reply = await activeChild.waitForObservation('reply', observation => observation.id === envelope.id);
        expect(reply.keys).toEqual(typeof operation.result === 'undefined' ? ['id'] : ['id', 'result']);
        const settlement = await activeChild.waitForObservation(
            'settled',
            observation => observation.key === operation.name,
        );
        expect(settlement).toMatchObject(
            typeof operation.result === 'undefined'
                ? { key: operation.name, status: 'resolved' }
                : { key: operation.name, result: operation.result, status: 'resolved' },
        );
    });

    it('[RM-T17] waits for updateAll(true) to settle its domain batch', async () => {
        const domain = deferred<void>();
        const serverHarness = makeServer();
        activeChild = new CompiledReservationClient();
        await activeChild.waitForObservation('ready');
        serverHarness.server.register(activeChild.child);
        serverHarness.domains.reservation.updateAll.mockReturnValue(domain.promise);

        await activeChild.command({ args: [true], key: 'wait', kind: 'invoke', operation: 'updateAll' });
        await activeChild.waitForRequest(candidate => asRecord(candidate).func === 'updateAll');
        expect(serverHarness.domains.reservation.updateAll).toHaveBeenCalledExactlyOnceWith();
        expect(activeChild.observations.filter(observation => observation.event === 'settled')).toEqual([]);

        domain.resolve();
        await expect(
            activeChild.waitForObservation('settled', observation => observation.key === 'wait'),
        ).resolves.toMatchObject({
            status: 'resolved',
        });
    });

    it('[RM-T17] projects a waiting updateAll domain failure through the existing error carrier', async () => {
        const domainFailure = new Error('synthetic reservation batch failure');
        const serverHarness = makeServer();
        activeChild = new CompiledReservationClient();
        await activeChild.waitForObservation('ready');
        serverHarness.server.register(activeChild.child);
        serverHarness.domains.reservation.updateAll.mockRejectedValue(domainFailure);

        await activeChild.command({ args: [true], key: 'failure', kind: 'invoke', operation: 'updateAll' });
        const request = await activeChild.waitForRequest(candidate => asRecord(candidate).func === 'updateAll');
        const envelope = asRecord(request);
        expect(serverHarness.domains.reservation.updateAll).toHaveBeenCalledExactlyOnceWith();

        await expect(
            activeChild.waitForObservation('reply', observation => observation.id === envelope.id),
        ).resolves.toMatchObject({
            error: domainFailure.message,
            id: envelope.id,
            keys: ['error', 'id'],
        });
        await expect(
            activeChild.waitForObservation('settled', observation => observation.key === 'failure'),
        ).resolves.toMatchObject({
            error: domainFailure.message,
            status: 'rejected',
        });
    });

    it('[RM-T17] accepts updateAll(false) before its domain batch settles', async () => {
        const domain = deferred<void>();
        const serverHarness = makeServer();
        activeChild = new CompiledReservationClient();
        await activeChild.waitForObservation('ready');
        serverHarness.server.register(activeChild.child);
        serverHarness.domains.reservation.updateAll.mockReturnValue(domain.promise);

        await activeChild.command({ args: [false], key: 'nonwait', kind: 'invoke', operation: 'updateAll' });
        await activeChild.waitForRequest(candidate => asRecord(candidate).func === 'updateAll');
        expect(serverHarness.domains.reservation.updateAll).toHaveBeenCalledExactlyOnceWith();
        await expect(
            activeChild.waitForObservation('settled', observation => observation.key === 'nonwait'),
        ).resolves.toMatchObject({
            status: 'resolved',
        });

        domain.resolve();
        await Promise.resolve();
        expect(activeChild.observations.filter(observation => observation.event === 'reply')).toHaveLength(1);
    });

    it('[RM-T9.6] #existing-handlers-wait-and-detached-update-all keeps the accepted domain operation running after the five-second carrier timeout and releases carrier resources after its late reply', async () => {
        const domain = deferred<void>();
        const serverHarness = makeServer();
        activeChild = new CompiledReservationClient();
        await activeChild.waitForObservation('ready');
        serverHarness.server.register(activeChild.child);
        serverHarness.domains.reservation.updateAll.mockReturnValue(domain.promise);

        await activeChild.command({ args: [true], key: 'late-domain', kind: 'invoke', operation: 'updateAll' });
        const request = await activeChild.waitForRequest(candidate => asRecord(candidate).func === 'updateAll');
        const envelope = asRecord(request);
        expect(serverHarness.domains.reservation.updateAll).toHaveBeenCalledExactlyOnceWith();

        await activeChild.command({ key: 'before-timeout', kind: 'state' });
        await activeChild.command({ kind: 'tick', milliseconds: 4_999 });
        await activeChild.waitForObservation('ticked', observation => observation.milliseconds === 4_999);
        const beforeTimeout = activeChild.observations.find(
            observation => observation.event === 'state' && observation.key === 'before-timeout',
        );
        expect(beforeTimeout).toBeDefined();
        expect(beforeTimeout).toMatchObject({ pending: 1, retired: 0, timers: 1 });
        const baselineMessageListeners = beforeTimeout?.messageListeners;
        expect(typeof baselineMessageListeners).toBe('number');
        expect(activeChild.observations.filter(observation => observation.event === 'settled')).toEqual([]);

        await activeChild.command({ kind: 'tick', milliseconds: 1 });
        await activeChild.waitForObservation('ticked', observation => observation.milliseconds === 1);
        await expect(
            activeChild.waitForObservation('settled', observation => observation.key === 'late-domain'),
        ).resolves.toMatchObject({ error: 'IPCTimeout', status: 'rejected' });
        expect(serverHarness.domains.reservation.updateAll).toHaveBeenCalledExactlyOnceWith();

        await activeChild.command({ key: 'after-timeout', kind: 'state' });
        await activeChild.command({ kind: 'tick', milliseconds: 0 });
        await activeChild.waitForObservation('ticked', observation => observation.milliseconds === 0);
        const afterTimeout = activeChild.observations.find(
            observation => observation.event === 'state' && observation.key === 'after-timeout',
        );
        expect(afterTimeout).toMatchObject({
            messageListeners: baselineMessageListeners,
            pending: 0,
            retired: 1,
            timers: 0,
        });

        domain.resolve();
        await expect(
            activeChild.waitForObservation('reply', observation => observation.id === envelope.id),
        ).resolves.toMatchObject({
            hasResult: false,
            id: envelope.id,
            keys: ['id'],
        });
        expect(activeChild.observations.filter(observation => observation.event === 'settled')).toHaveLength(1);

        await activeChild.command({ key: 'after-late-reply', kind: 'state' });
        await activeChild.command({ kind: 'tick', milliseconds: 2 });
        await activeChild.waitForObservation('ticked', observation => observation.milliseconds === 2);
        const afterLateReply = activeChild.observations.find(
            observation => observation.event === 'state' && observation.key === 'after-late-reply',
        );
        expect(afterLateReply).toMatchObject({
            messageListeners: baselineMessageListeners,
            pending: 0,
            retired: 0,
            timers: 0,
        });

        const child = activeChild.child;
        await activeChild.stop();
        activeChild = undefined;
        expect(serverHarness.server.child).toBeNull();
        expect(serverHarness.server.currentPeer).toBeNull();
        expect(child.listenerCount('message')).toBe(0);
        for (const event of ['exit', 'error', 'disconnect', 'close']) expect(child.listenerCount(event)).toBe(0);
    });
});
