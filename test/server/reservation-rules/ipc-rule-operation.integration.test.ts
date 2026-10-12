import { spawn, type ChildProcess } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { makeServer } from '../process-messaging/_harness';

interface Observation {
    readonly event: string;
    readonly [key: string]: unknown;
}

interface RuleOperationCase {
    readonly args: Record<string, unknown>;
    readonly domainArgs: readonly unknown[];
    readonly domainResult: unknown;
    readonly func: string;
    readonly name: string;
    readonly replyResult: unknown;
    readonly value: unknown;
}

interface Waiter<T> {
    readonly predicate: (value: T) => boolean;
    readonly reject: (error: Error) => void;
    readonly resolve: (value: T) => void;
}

let activeChild: CompiledRuleClient | undefined;

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

process.on('message', message => {
    if (!message || message.testControl !== 'command') return;
    if (message.kind === 'invoke') {
        observe('invoked', { key: message.key });
        client.rule[message.operation](message.value).then(
            value => observe('settled', { key: message.key, result: value, status: 'resolved' }),
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
        observe('state', {
            pending: client.pending.size,
            retired: client.retired.size,
            timers: timers.size,
        });
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

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

const asRecord = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

class CompiledRuleClient {
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
                reject(new Error('compiled Rule IPC child is disconnected'));

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

const operationCases: readonly RuleOperationCase[] = [
    {
        args: { rule: { keyword: 'synthetic-add' } },
        domainArgs: [{ keyword: 'synthetic-add' }],
        domainResult: 51,
        func: 'add',
        name: 'add',
        replyResult: 51,
        value: { keyword: 'synthetic-add' },
    },
    {
        args: { rule: { id: 51, keyword: 'synthetic-update' } },
        domainArgs: [{ id: 51, keyword: 'synthetic-update' }],
        domainResult: undefined,
        func: 'update',
        name: 'update',
        replyResult: undefined,
        value: { id: 51, keyword: 'synthetic-update' },
    },
    {
        args: { ruleId: 51 },
        domainArgs: [51],
        domainResult: undefined,
        func: 'enable',
        name: 'enable',
        replyResult: undefined,
        value: 51,
    },
    {
        args: { ruleId: 51 },
        domainArgs: [51],
        domainResult: undefined,
        func: 'disable',
        name: 'disable',
        replyResult: undefined,
        value: 51,
    },
    {
        args: { ruleId: 51 },
        domainArgs: [51],
        domainResult: undefined,
        func: 'delete',
        name: 'delete',
        replyResult: undefined,
        value: 51,
    },
];

afterEach(async () => {
    await activeChild?.stop();
    activeChild = undefined;
});

describe('reservation rule IPC operation carrier', () => {
    it.each(operationCases)('keeps the $name envelope and reply projection', async operation => {
        const serverHarness = makeServer();
        activeChild = new CompiledRuleClient();
        await activeChild.waitForObservation('ready');
        serverHarness.server.register(activeChild.child);
        serverHarness.domains.rule[operation.func].mockResolvedValue(operation.domainResult);

        await activeChild.command({
            key: operation.name,
            kind: 'invoke',
            operation: operation.name,
            value: operation.value,
        });
        const request = await activeChild.waitForRequest(candidate => asRecord(candidate).model === 'rule');
        const envelope = asRecord(request);
        expect(envelope).toEqual({
            args: operation.args,
            func: operation.func,
            id: expect.any(Number),
            model: 'rule',
        });
        expect(serverHarness.domains.rule[operation.func]).toHaveBeenCalledExactlyOnceWith(...operation.domainArgs);

        const reply = await activeChild.waitForObservation('reply', observation => observation.id === envelope.id);
        const expectedReplyKeys = typeof operation.replyResult === 'undefined' ? ['id'] : ['id', 'result'];
        expect(reply.keys).toEqual(expectedReplyKeys);
        expect(reply.hasResult).toBe(typeof operation.replyResult !== 'undefined');
        const settlement = await activeChild.waitForObservation(
            'settled',
            observation => observation.key === operation.name,
        );
        expect(settlement).toMatchObject({ key: operation.name, status: 'resolved' });
        expect(settlement.result).toEqual(operation.replyResult);
    });

    it('keeps the existing domain failure reply envelope', async () => {
        const serverHarness = makeServer();
        activeChild = new CompiledRuleClient();
        await activeChild.waitForObservation('ready');
        serverHarness.server.register(activeChild.child);
        serverHarness.domains.rule.delete.mockRejectedValue(new Error('synthetic-rule-domain-failure'));

        await activeChild.command({ key: 'failure', kind: 'invoke', operation: 'delete', value: 61 });
        const request = await activeChild.waitForRequest(candidate => asRecord(candidate).model === 'rule');
        const envelope = asRecord(request);
        const reply = await activeChild.waitForObservation('reply', observation => observation.id === envelope.id);

        expect(reply).toMatchObject({ error: 'synthetic-rule-domain-failure', id: envelope.id, keys: ['error', 'id'] });
        const settlement = await activeChild.waitForObservation(
            'settled',
            observation => observation.key === 'failure',
        );
        expect(settlement).toMatchObject({ error: 'synthetic-rule-domain-failure', status: 'rejected' });
    });

    it('times out the caller without cancelling a Rule domain operation that settles later', async () => {
        const domain = deferred<number>();
        const serverHarness = makeServer();
        activeChild = new CompiledRuleClient();
        await activeChild.waitForObservation('ready');
        serverHarness.server.register(activeChild.child);
        serverHarness.domains.rule.add.mockReturnValue(domain.promise);

        await activeChild.command({
            key: 'late-domain',
            kind: 'invoke',
            operation: 'add',
            value: { keyword: 'synthetic-late-domain' },
        });
        const request = await activeChild.waitForRequest(candidate => asRecord(candidate).model === 'rule');
        const envelope = asRecord(request);
        expect(serverHarness.domains.rule.add).toHaveBeenCalledExactlyOnceWith({ keyword: 'synthetic-late-domain' });

        await activeChild.command({ kind: 'tick', milliseconds: 5_000 });
        const timeout = await activeChild.waitForObservation(
            'settled',
            observation => observation.key === 'late-domain',
        );
        expect(timeout).toMatchObject({ error: 'IPCTimeout', status: 'rejected' });
        await activeChild.command({ kind: 'state' });
        await expect(
            activeChild.waitForObservation('state', observation => observation.retired === 1),
        ).resolves.toMatchObject({ pending: 0, retired: 1, timers: 0 });
        expect(activeChild.requests.filter(candidate => asRecord(candidate).model === 'rule')).toHaveLength(1);

        domain.resolve(62);
        const reply = await activeChild.waitForObservation('reply', observation => observation.id === envelope.id);
        expect(reply).toMatchObject({ hasResult: true, id: envelope.id, keys: ['id', 'result'], result: 62 });
        await activeChild.command({ kind: 'state' });
        await expect(
            activeChild.waitForObservation('state', observation => observation.retired === 0),
        ).resolves.toMatchObject({ pending: 0, retired: 0, timers: 0 });
        expect(serverHarness.domains.rule.add).toHaveBeenCalledExactlyOnceWith({ keyword: 'synthetic-late-domain' });
        expect(
            activeChild.observations.filter(
                observation => observation.event === 'settled' && observation.key === 'late-domain',
            ),
        ).toEqual([timeout]);
    });
});
