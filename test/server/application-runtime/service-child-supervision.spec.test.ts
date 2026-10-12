import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
    captureRuntimeListeners,
    compiledSnapshotRoot,
    evaluateCompiledRuntime,
    loadDefault,
    removeListenersAddedSince,
} from './_runtime-harness';

/** The directory holding the shared child-side loader hooks. */
const harnessDirectory = (): string => fileURLToPath(new URL('../harness/', import.meta.url));

const loadStartupContinuationCoordinator = (): (new () => unknown) =>
    loadDefault<new () => unknown>('model/workflow/StartupContinuationCoordinator.js');

interface ServiceLedgerEntry {
    readonly detail?: unknown;
    readonly operation: string;
}

interface ServiceObservation {
    readonly code: number | null;
    readonly ledger: ServiceLedgerEntry[];
    readonly stderr: string;
}

type DirectServiceChild = EventEmitter & {
    readonly pid: number;
    readonly stderr: PassThrough | null;
    readonly stdout: PassThrough | null;
};

type DirectTerminalEvent = 'close' | 'error' | 'exit';

const settleDirectRuntime = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

const exerciseDirectServiceTerminalRace = async (
    firstTerminalEvent: DirectTerminalEvent,
    withPipes = true,
    reenterOnExitRemoval = false,
): Promise<void> => {
    const restoreListeners = captureRuntimeListeners();
    const children: DirectServiceChild[] = [];
    const registeredPeers: DirectServiceChild[] = [];
    const createChild = (): DirectServiceChild => {
        const child = Object.assign(new EventEmitter(), {
            pid: 900 + children.length,
            stderr: withPipes ? new PassThrough() : null,
            stdout: withPipes ? new PassThrough() : null,
        }) as DirectServiceChild;
        children.push(child);
        return child;
    };
    const StartupContinuationCoordinator = loadStartupContinuationCoordinator();
    const services: Record<string, unknown> = {
        IConfiguration: { getConfig: () => ({}) },
        IConnectionCheckModel: { checkDB: async () => undefined, checkMirakurun: async () => undefined },
        IEPGUpdateExecutorManageModel: { execute: vi.fn() },
        IEventSetter: { set: vi.fn() },
        IIPCServer: {
            initialize: async () => undefined,
            register: (peer: DirectServiceChild) => registeredPeers.push(peer),
        },
        ILoggerModel: { initialize() {}, getLogger: () => ({ system: { fatal() {}, info() {} } }) },
        IRecordingManageModel: {
            cleanup: async () => undefined,
            rebuildCandidatesAndStart: async () => undefined,
            setTuner: vi.fn(),
        },
        IReservationManageModel: { cleanup: async () => undefined, setTuners: vi.fn() },
        IRuntimeStartupWorkflowPort: new StartupContinuationCoordinator(),
        IStorageManageModel: { start: vi.fn() },
        TunerServerAccess: { getTuners: async () => [] },
    };
    const container = { get: (identifier: string): unknown => services[identifier] };
    const spawnServiceChild = vi.fn((..._arguments: unknown[]) => createChild());

    try {
        await evaluateCompiledRuntime(container, spawnServiceChild);
        await vi.waitFor(() => expect(spawnServiceChild).toHaveBeenCalledTimes(1));
        await settleDirectRuntime();

        const [first] = children;
        expect(first).toBeDefined();
        if (first === undefined) throw new Error('Runtime did not retain its initial Service child');
        expect(spawnServiceChild).toHaveBeenCalledWith(
            process.argv[0],
            [join(compiledSnapshotRoot(), 'model', 'service', 'ServiceExecutor.js')],
            { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
        );
        expect(registeredPeers).toEqual([first]);
        if (firstTerminalEvent === 'close') {
            first.emit('close', 0, null);

            expect(children).toHaveLength(1);
            expect(registeredPeers).toEqual([first]);
            expect(first.listenerCount('exit')).toBe(0);
            expect(first.listenerCount('close')).toBe(0);
            expect(first.listenerCount('error')).toBe(0);
            expect(first.stdout?.listenerCount('data') ?? null).toBe(withPipes ? 0 : null);
            expect(first.stderr?.listenerCount('data') ?? null).toBe(withPipes ? 0 : null);
            return;
        }
        const [terminalCallback] = first.listeners('exit');
        expect(terminalCallback).toBeDefined();
        let removalReentryCount = 0;
        const onListenerRemoved = (eventName: string | symbol, listener: (...args: unknown[]) => void): void => {
            if (
                !reenterOnExitRemoval ||
                removalReentryCount !== 0 ||
                eventName !== 'exit' ||
                listener !== terminalCallback
            ) {
                return;
            }
            removalReentryCount += 1;
            listener.call(first, 1, null);
        };
        first.on('removeListener', onListenerRemoved);
        expect(first.stdout?.listenerCount('data') ?? null).toBe(withPipes ? 1 : null);
        expect(first.stderr?.listenerCount('data') ?? null).toBe(withPipes ? 1 : null);
        first.stdout?.write('stdout');
        first.stderr?.write('stderr');
        expect(first.stdout?.readableLength ?? null).toBe(withPipes ? 0 : null);
        expect(first.stderr?.readableLength ?? null).toBe(withPipes ? 0 : null);
        if (firstTerminalEvent === 'exit') {
            first.emit('exit', 1, null);
        } else {
            first.emit('error', new Error('synthetic terminal'));
        }

        expect(removalReentryCount).toBe(reenterOnExitRemoval ? 1 : 0);
        expect(children).toHaveLength(2);
        expect(registeredPeers).toEqual(children);
        expect(first.listenerCount('exit')).toBe(0);
        expect(first.listenerCount('close')).toBe(1);
        expect(first.listenerCount('error')).toBe(1);
        expect(first.stdout?.listenerCount('data') ?? null).toBe(withPipes ? 0 : null);
        expect(first.stderr?.listenerCount('data') ?? null).toBe(withPipes ? 0 : null);

        if (firstTerminalEvent === 'exit') {
            first.emit('error', new Error('same-turn terminal'));
        } else {
            first.emit('exit', 1, null);
        }

        terminalCallback?.call(first, 1, null);
        expect(children).toHaveLength(2);
        expect(registeredPeers).toEqual(children);

        first.emit('close', 1, null);
        first.removeListener('removeListener', onListenerRemoved);
        expect(first.listenerCount('exit')).toBe(0);
        expect(first.listenerCount('close')).toBe(0);
        expect(first.listenerCount('error')).toBe(0);
        expect(first.listenerCount('removeListener')).toBe(0);
        expect(first.stdout?.listenerCount('data') ?? null).toBe(withPipes ? 0 : null);
        expect(first.stderr?.listenerCount('data') ?? null).toBe(withPipes ? 0 : null);
    } finally {
        removeListenersAddedSince(restoreListeners);
    }
};

const serviceTerminalPrelude = String.raw`
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { PassThrough } from 'node:stream';
const compiledRoot = path.dirname(process.argv[1]);
const StartupContinuationCoordinator = (
    await import(pathToFileURL(path.join(compiledRoot, 'model', 'workflow', 'StartupContinuationCoordinator.js')).href)
).default;
const ledger = [];
const children = [];
let published = false;
const record = (operation, detail) => {
    const entry = { operation };
    if (detail !== undefined) entry.detail = detail;
    ledger.push(entry);
};
const publish = () => {
    if (published) return;
    published = true;
    process.stdout.write(JSON.stringify({ ledger }) + '\n');
};
const withoutPipes = process.env.EPGSTATION_SERVICE_TERMINAL_WITHOUT_PIPES === '1';
const logger = {
    initialize() {},
    getLogger() {
        return {
            system: {
                fatal: value => record('system-fatal', String(value)),
                info() {},
            },
        };
    },
};
const stream = name => {
    if (withoutPipes) return null;
    const value = new PassThrough();
    const emit = value.emit.bind(value);
    value.emit = (event, ...arguments_) => {
        if (event === 'data') record('pipe-data', name);
        return emit(event, ...arguments_);
    };
    return value;
};
const listenerState = child => ({
    close: child.listenerCount('close'),
    error: child.listenerCount('error'),
    exit: child.listenerCount('exit'),
    stderr: child.stderr === null ? null : child.stderr.listenerCount('data'),
    stdout: child.stdout === null ? null : child.stdout.listenerCount('data'),
});
const createServiceChild = () => {
    const child = new EventEmitter();
    child.pid = 800 + children.length;
    child.stderr = stream('stderr');
    child.stdout = stream('stdout');
    children.push(child);
    return child;
};
const scheduleTerminalRace = child => {
    queueMicrotask(() => {
        record('before-terminal', listenerState(child));
        child.stdout?.write('stdout');
        child.stderr?.write('stderr');
        record('emit-exit');
        child.emit('exit', 1, null);
        record('emit-error');
        child.emit('error', new Error('same-turn terminal'));
        record('after-terminal', listenerState(child));
        child.emit('close', 1, null);
        record('after-close', listenerState(child));
    });
};
const services = {
    IConfiguration: { getConfig: () => ({}) },
    IConnectionCheckModel: { checkDB: async () => {}, checkMirakurun: async () => {} },
    IEPGUpdateExecutorManageModel: { execute: () => {} },
    IEventSetter: { set: () => {} },
    IIPCServer: {
        initialize: async () => {},
        register: child => record('ipc-register', children.indexOf(child) + 1),
    },
    ILoggerModel: logger,
    IRecordingManageModel: {
        cleanup: async () => {},
        rebuildCandidatesAndStart: async () => {},
        setTuner: () => {},
    },
    IReservationManageModel: { cleanup: async () => {}, setTuners: () => {} },
    IRuntimeStartupWorkflowPort: new StartupContinuationCoordinator(),
    IStorageManageModel: { start: () => {} },
    TunerServerAccess: { getTuners: async () => [] },
};
const container = { get: identifier => services[identifier] };
Object.defineProperty(process, 'getuid', { configurable: true, value: () => 1000 });
process.prependListener('uncaughtException', error => record('uncaught-effect', error.message));
// 置き換えは entrypoint 自身の module graph の中で評価されるため、ここから渡したいものは
// globalThis を経由する。
globalThis.__epgstationChildOverrides = {
    container,
    spawnService: () => {
                const child = createServiceChild();
                record('service-spawn', children.length);
                if (children.length === 1) scheduleTerminalRace(child);
                return child;
            },
};
const spawnSource = 'export const spawn = (...a) => globalThis.__epgstationChildOverrides.spawnService(...a); export default { spawn };';
const sourceMapSupportSource = 'export const install = () => undefined; export default { install };';
const setterSource = 'export const set = () => undefined;';
const { registerOverrides } = await import(pathToFileURL(process.env.EPGSTATION_TEST_HARNESS_DIR + '/child-module-overrides.mjs').href);
registerOverrides([
    { specifier: 'node:child_process', source: spawnSource },
    { specifier: 'child_process', source: spawnSource },
    { specifier: 'reflect-metadata', source: 'export default {};' },
    { specifier: 'source-map-support', source: sourceMapSupportSource },
    { specifier: './model/ModelContainer.js', source: 'export default globalThis.__epgstationChildOverrides.container;' },
    { specifier: './model/ModelContainerSetter.js', source: setterSource },
]);
process.once('beforeExit', publish);
`;

const serviceChildPrelude = String.raw`
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const compiledRoot = path.dirname(process.argv[1]);
const StartupContinuationCoordinator = (
    await import(pathToFileURL(path.join(compiledRoot, 'model', 'workflow', 'StartupContinuationCoordinator.js')).href)
).default;
const fixture = JSON.parse(process.env.EPGSTATION_SERVICE_CHILD_SUPERVISION_FIXTURE || '{}');
const ledger = [];
let published = false;
const record = (operation, detail) => {
    const entry = { operation };
    if (detail !== undefined) entry.detail = detail;
    ledger.push(entry);
};
const publish = code => {
    if (published) return;
    published = true;
    process.stdout.write(JSON.stringify({ ledger }) + '\n', () => process.exit(code));
};
const serviceChild = new EventEmitter();
serviceChild.pid = 721;
serviceChild.stderr = null;
serviceChild.stdout = null;
const originalOn = serviceChild.on.bind(serviceChild);
serviceChild.on = (event, listener) => {
    if (event === 'message') record('ready-listener');
    return originalOn(event, listener);
};
const originalOnce = serviceChild.once.bind(serviceChild);
serviceChild.once = (event, listener) => {
    if (event === 'message') record('ready-listener');
    return originalOnce(event, listener);
};
const logger = {
    initialize() {},
    getLogger() {
        return { system: { fatal() {}, info() {} } };
    },
};
const services = {
    IConfiguration: { getConfig: () => ({}) },
    IConnectionCheckModel: {
        checkDB: async () => record('database-availability'),
        checkMirakurun: async () => record('tuner-availability'),
    },
    IEPGUpdateExecutorManageModel: { execute: () => record('epg-start') },
    IEventSetter: { set: () => record('event-binding') },
    IIPCServer: {
        initialize: async () => record('ipc-initialize'),
        register: peer => record('ipc-register', { currentPeer: peer === serviceChild }),
    },
    ILoggerModel: logger,
    IRecordingManageModel: {
        cleanup: async () => record('startup-cleanup'),
        rebuildCandidatesAndStart: async () => record('recording-rebuild'),
        setTuner: () => record('recording-set-tuner'),
    },
    IReservationManageModel: {
        cleanup: async () => record('reservation-cleanup'),
        setTuners: () => record('reservation-set-tuners'),
    },
    IRuntimeStartupWorkflowPort: new StartupContinuationCoordinator(),
    IStorageManageModel: { start: () => record('storage-start') },
    TunerServerAccess: { getTuners: async () => (record('tuner-snapshot'), []) },
};
const container = { get: identifier => services[identifier] };
Object.defineProperty(process, 'getuid', { configurable: true, value: () => 1000 });
// 置き換えは entrypoint 自身の module graph の中で評価されるため、ここから渡したいものは
// globalThis を経由する。
globalThis.__epgstationChildOverrides = {
    container,
    spawnService: (executable, args, options) => {
                record('service-spawn', { args, executable, stdio: options.stdio });
                return serviceChild;
            },
};
const spawnSource = 'export const spawn = (...a) => globalThis.__epgstationChildOverrides.spawnService(...a); export default { spawn };';
const sourceMapSupportSource = 'export const install = () => undefined; export default { install };';
const setterSource = 'export const set = () => undefined;';
const { registerOverrides } = await import(pathToFileURL(process.env.EPGSTATION_TEST_HARNESS_DIR + '/child-module-overrides.mjs').href);
registerOverrides([
    { specifier: 'node:child_process', source: spawnSource },
    { specifier: 'child_process', source: spawnSource },
    { specifier: 'reflect-metadata', source: 'export default {};' },
    { specifier: 'source-map-support', source: sourceMapSupportSource },
    { specifier: './model/ModelContainer.js', source: 'export default globalThis.__epgstationChildOverrides.container;' },
    { specifier: './model/ModelContainerSetter.js', source: setterSource },
]);
process.once('beforeExit', () => {
    if (fixture.readySubscriptionProbe === 'on') serviceChild.on('message', () => {});
    publish(0);
});
`;

const compiledEntrypoint = (): string => {
    const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
    if (compiledSnapshot === undefined || !isAbsolute(compiledSnapshot)) {
        throw new Error('Server test runner did not provide an absolute compiled snapshot');
    }
    return join(compiledSnapshot, 'index.js');
};

const waitForClose = async (child: ChildProcess): Promise<{ code: number | null; stderr: string; stdout: string }> => {
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => (stdout += chunk));
    child.stderr?.on('data', chunk => (stderr += chunk));
    const [code] = (await once(child, 'close')) as [number | null, NodeJS.Signals | null];
    return { code, stderr, stdout };
};

const observeServiceStartup = async (
    fixture: { readonly readySubscriptionProbe?: 'on' } = {},
): Promise<ServiceObservation> => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'epgstation-service-child-supervision-'));
    const preludePath = join(temporaryDirectory, 'service-child-prelude.mjs');
    let child: ChildProcess | undefined;
    let deadline: NodeJS.Timeout | undefined;

    try {
        await writeFile(preludePath, serviceChildPrelude, 'utf8');
        const entrypoint = compiledEntrypoint();
        child = spawn(process.execPath, ['--import', pathToFileURL(preludePath).href, entrypoint], {
            cwd: dirname(entrypoint),
            env: {
                ...process.env,
                EPGSTATION_TEST_HARNESS_DIR: harnessDirectory(),
                EPGSTATION_SERVICE_CHILD_SUPERVISION_FIXTURE: JSON.stringify(fixture),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const close = waitForClose(child);
        const timeout = new Promise<never>((_, reject) => {
            deadline = setTimeout(() => reject(new Error('Service supervision child did not exit')), 2_000);
        });
        const observation = await Promise.race([close, timeout]);
        const records = observation.stdout.trim().split('\n');

        expect(records).toHaveLength(1);
        try {
            return {
                code: observation.code,
                ledger: (JSON.parse(records[0]) as { ledger: ServiceLedgerEntry[] }).ledger,
                stderr: observation.stderr,
            };
        } catch (error) {
            throw new Error(`Service supervision fixture emitted invalid JSON: ${observation.stdout}`, {
                cause: error,
            });
        }
    } finally {
        if (deadline !== undefined) clearTimeout(deadline);
        if (child !== undefined && child.exitCode === null && child.signalCode === null) {
            const closed = once(child, 'close');
            child.kill('SIGKILL');
            await closed;
        }
        await rm(temporaryDirectory, { force: true, recursive: true });
    }
};

const observeServiceTerminalRace = async (withoutPipes = false): Promise<ServiceObservation> => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'epgstation-service-terminal-race-'));
    const preludePath = join(temporaryDirectory, 'service-terminal-prelude.mjs');
    let child: ChildProcess | undefined;
    let deadline: NodeJS.Timeout | undefined;

    try {
        await writeFile(preludePath, serviceTerminalPrelude, 'utf8');
        const entrypoint = compiledEntrypoint();
        child = spawn(process.execPath, ['--import', pathToFileURL(preludePath).href, entrypoint], {
            cwd: dirname(entrypoint),
            env: {
                ...process.env,
                EPGSTATION_TEST_HARNESS_DIR: harnessDirectory(),
                EPGSTATION_SERVICE_TERMINAL_WITHOUT_PIPES: withoutPipes ? '1' : '0',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const close = waitForClose(child);
        const timeout = new Promise<never>((_, reject) => {
            deadline = setTimeout(() => reject(new Error('Service terminal race fixture did not exit')), 2_000);
        });
        const observation = await Promise.race([close, timeout]);
        const records = observation.stdout.trim().split('\n');

        expect(records).toHaveLength(1);
        return {
            code: observation.code,
            ledger: (JSON.parse(records[0]) as { ledger: ServiceLedgerEntry[] }).ledger,
            stderr: observation.stderr,
        };
    } finally {
        if (deadline !== undefined) clearTimeout(deadline);
        if (child !== undefined && child.exitCode === null && child.signalCode === null) {
            const closed = once(child, 'close');
            child.kill('SIGKILL');
            await closed;
        }
        await rm(temporaryDirectory, { force: true, recursive: true });
    }
};

const entriesFor = (ledger: readonly ServiceLedgerEntry[], operation: string): ServiceLedgerEntry[] =>
    ledger.filter(entry => entry.operation === operation);

const firstIndexOf = (ledger: readonly ServiceLedgerEntry[], operation: string): number => {
    const index = ledger.findIndex(entry => entry.operation === operation);
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
};

describe('service child supervision', () => {
    it('[AR-5.2][AR-5.3][AR-5.4][AR-8.3] executes the current runtime module across both same-turn terminal event orders', async () => {
        await exerciseDirectServiceTerminalRace('exit');
        await exerciseDirectServiceTerminalRace('error', true, true);
        await exerciseDirectServiceTerminalRace('exit', false);
        await exerciseDirectServiceTerminalRace('close');
    });

    it('[AR-5.1] fixture detects a controlled ready-message subscription installed with on', async () => {
        const observation = await observeServiceStartup({ readySubscriptionProbe: 'on' });

        expect(entriesFor(observation.ledger, 'ready-listener')).toEqual([{ operation: 'ready-listener' }]);
    });

    it('[AR-5.1][AR-8.1] spawns the IPC-only ServiceExecutor, immediately registers its current peer, then starts cleanup', async () => {
        const observation = await observeServiceStartup();
        const entrypoint = compiledEntrypoint();
        const spawnAt = firstIndexOf(observation.ledger, 'service-spawn');
        const registerAt = firstIndexOf(observation.ledger, 'ipc-register');
        const cleanupAt = firstIndexOf(observation.ledger, 'startup-cleanup');

        expect(observation.code).toBe(0);
        expect(observation.stderr).toBe('');
        expect(entriesFor(observation.ledger, 'service-spawn')).toEqual([
            {
                detail: {
                    args: [join(dirname(entrypoint), 'model', 'service', 'ServiceExecutor.js')],
                    executable: process.execPath,
                    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
                },
                operation: 'service-spawn',
            },
        ]);
        expect(entriesFor(observation.ledger, 'ipc-register')).toEqual([
            { detail: { currentPeer: true }, operation: 'ipc-register' },
        ]);
        expect(entriesFor(observation.ledger, 'ready-listener')).toEqual([]);
        expect(firstIndexOf(observation.ledger, 'storage-start')).toBeLessThan(spawnAt);
        expect(spawnAt).toBeLessThan(registerAt);
        expect(registerAt).toBeLessThan(cleanupAt);
    });

    it('[AR-5.2][AR-5.3][AR-5.4][AR-8.2][AR-8.3] settles a same-turn exit/error race once while preserving a fresh service identity for the replacement child', async () => {
        const observation = await observeServiceTerminalRace();

        expect(observation.code).toBe(0);
        expect(observation.stderr).toBe('');
        expect(entriesFor(observation.ledger, 'service-spawn')).toEqual([
            { detail: 1, operation: 'service-spawn' },
            { detail: 2, operation: 'service-spawn' },
        ]);
        expect(entriesFor(observation.ledger, 'ipc-register')).toEqual([
            { detail: 1, operation: 'ipc-register' },
            { detail: 2, operation: 'ipc-register' },
        ]);
        expect(entriesFor(observation.ledger, 'system-fatal')).toEqual([
            { detail: 'service process is down', operation: 'system-fatal' },
            { detail: 'restart service', operation: 'system-fatal' },
        ]);
        expect(entriesFor(observation.ledger, 'pipe-data')).toEqual([
            { detail: 'stdout', operation: 'pipe-data' },
            { detail: 'stderr', operation: 'pipe-data' },
        ]);
        expect(entriesFor(observation.ledger, 'before-terminal')).toEqual([
            {
                detail: { close: 1, error: 1, exit: 1, stderr: 1, stdout: 1 },
                operation: 'before-terminal',
            },
        ]);
        expect(entriesFor(observation.ledger, 'after-terminal')).toEqual([
            {
                detail: { close: 1, error: 1, exit: 0, stderr: 0, stdout: 0 },
                operation: 'after-terminal',
            },
        ]);
        expect(entriesFor(observation.ledger, 'after-close')).toEqual([
            {
                detail: { close: 0, error: 0, exit: 0, stderr: 0, stdout: 0 },
                operation: 'after-close',
            },
        ]);
        expect(entriesFor(observation.ledger, 'uncaught-effect')).toEqual([]);
    });

    it('[AR-5.2] settles the terminal race without creating absent stdout or stderr streams', async () => {
        const observation = await observeServiceTerminalRace(true);

        expect(observation.code).toBe(0);
        expect(observation.stderr).toBe('');
        expect(entriesFor(observation.ledger, 'service-spawn')).toEqual([
            { detail: 1, operation: 'service-spawn' },
            { detail: 2, operation: 'service-spawn' },
        ]);
        expect(entriesFor(observation.ledger, 'ipc-register')).toEqual([
            { detail: 1, operation: 'ipc-register' },
            { detail: 2, operation: 'ipc-register' },
        ]);
        expect(entriesFor(observation.ledger, 'pipe-data')).toEqual([]);
        expect(entriesFor(observation.ledger, 'before-terminal')).toEqual([
            {
                detail: { close: 1, error: 1, exit: 1, stderr: null, stdout: null },
                operation: 'before-terminal',
            },
        ]);
        expect(entriesFor(observation.ledger, 'after-close')).toEqual([
            {
                detail: { close: 0, error: 0, exit: 0, stderr: null, stdout: null },
                operation: 'after-close',
            },
        ]);
        expect(entriesFor(observation.ledger, 'uncaught-effect')).toEqual([]);
    });
});
