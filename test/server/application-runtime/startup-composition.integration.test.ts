import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

type CleanupOutcome = 'no-result' | 'ordinary-result' | 'reject';
type EpgStartScenario = 'failed' | 'pending' | 'succeeded';

interface StartupCompositionObservation {
    readonly code: number | null;
    readonly operations: string[];
    readonly stderr: string;
}

interface EpgStartObservation {
    readonly code: number | null;
    readonly operations: readonly string[];
    readonly stderr: string;
}

const temporaryDirectories = new Set<string>();

const startupCompositionPreload = String.raw`
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
const fixture = JSON.parse(process.env.EPGSTATION_STARTUP_COMPOSITION_FIXTURE);
const operations = [];
let published = false;
const record = operation => operations.push(operation);
const originalExit = process.exit.bind(process);
const publish = code => {
    if (published) return;
    published = true;
    process.stdout.write(JSON.stringify({ operations }) + '\n', () => originalExit(code));
};
const observationWindow = setTimeout(() => publish(process.exitCode ?? 0), 50);
const ordinaryRecordingEvent = {
    emitFinishRecording: () => record('recording-event.emitFinishRecording'),
};
const recordingTarget = {
    cleanup: async () => {
        record('recording.cleanup');
        if (fixture.outcome === 'reject') {
            throw new Error('synthetic startup cleanup failure');
        }
        if (fixture.outcome === 'ordinary-result') {
            ordinaryRecordingEvent.emitFinishRecording();
        }
    },
    rebuildCandidatesAndStart: async () => {},
    setTuner: () => {},
};
const recording = new Proxy(recordingTarget, {
    get(target, property, receiver) {
        if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
        if (typeof property === 'string') {
            return () => record('startup-only:' + property);
        }
        return undefined;
    },
});
const logger = {
    initialize() {},
    getLogger() {
        return {
            system: {
                fatal: value => record('fatal-log:' + (value instanceof Error ? value.message : String(value))),
                info() {},
            },
        };
    },
};
const serviceChild = new EventEmitter();
serviceChild.pid = 721;
serviceChild.stderr = null;
serviceChild.stdout = null;
const startupWorkflow = {
    async runAfterServiceSupervisionAccepted(input) {
        try {
            await input.runRecordingReconciliation();
            return { kind: 'Succeeded', stage: 'epg-supervisor-start' };
        } catch (cause) {
            return { cause, kind: 'Failed', stage: 'recording-reconciliation' };
        }
    },
};
const services = {
    IConfiguration: { getConfig: () => ({}) },
    IConnectionCheckModel: {
        checkDB: async () => {},
        checkMirakurun: async () => {},
    },
    IEPGUpdateExecutorManageModel: { execute: () => {} },
    IEventSetter: { set: () => {} },
    IIPCServer: {
        initialize: async () => {},
        register: () => {},
    },
    ILoggerModel: logger,
    IRecordingManageModel: recording,
    IReservationManageModel: {
        cleanup: async () => {},
        setTuners: () => {},
    },
    IRuntimeStartupWorkflowPort: startupWorkflow,
    IStorageManageModel: { start: () => {} },
    TunerServerAccess: { getTuners: async () => [] },
};
const container = {
    get(identifier) {
        if (!Object.hasOwn(services, identifier)) {
            throw new Error('Unexpected runtime dependency: ' + identifier);
        }
        return services[identifier];
    },
};
Object.defineProperty(process, 'getuid', { configurable: true, value: () => 1000 });
process.once('unhandledRejection', error => {
    clearTimeout(observationWindow);
    record('runtime.failure:' + (error instanceof Error ? error.message : String(error)));
    queueMicrotask(() => publish(process.exitCode ?? 0));
});
// 置き換えは entrypoint 自身の module graph の中で評価されるため、ここから渡したいものは
// globalThis を経由する。
globalThis.__epgstationChildOverrides = {
    container,
    spawnService: () => serviceChild,
};
const spawnSource = 'export const spawn = (...a) => globalThis.__epgstationChildOverrides.spawnService(...a); export default { spawn };';
const sourceMapSupportSource = 'export const install = () => undefined; export default { install };';
const { registerOverrides } = await import(pathToFileURL(process.env.EPGSTATION_TEST_HARNESS_DIR + '/child-module-overrides.mjs').href);
registerOverrides([
    { specifier: 'node:child_process', source: spawnSource },
    { specifier: 'child_process', source: spawnSource },
    { specifier: 'reflect-metadata', source: 'export default {};' },
    { specifier: 'source-map-support', source: sourceMapSupportSource },
    { specifier: './model/ModelContainer.js', source: 'export default globalThis.__epgstationChildOverrides.container;' },
    { specifier: './model/ModelContainerSetter.js', source: 'export const set = () => undefined;' },
]);
`;

/** The directory holding the shared child-side loader hooks. */
const harnessDirectory = (): string => fileURLToPath(new URL('../harness/', import.meta.url));

const compiledEntrypoint = (): string => {
    const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
    if (compiledSnapshot === undefined || !isAbsolute(compiledSnapshot)) {
        throw new Error('Server test runner did not provide an absolute compiled snapshot');
    }
    return join(compiledSnapshot, 'index.js');
};

const stopChild = async (child: ChildProcess): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) {
        return;
    }
    const closed = once(child, 'close');
    child.kill('SIGKILL');
    await closed;
};

const observeStartupComposition = async (outcome: CleanupOutcome): Promise<StartupCompositionObservation> => {
    const directory = await mkdtemp(join(tmpdir(), 'epgstation-startup-composition-'));
    temporaryDirectories.add(directory);
    const preloadPath = join(directory, 'startup-composition-preload.mjs');
    await writeFile(preloadPath, startupCompositionPreload, 'utf8');
    const entrypoint = compiledEntrypoint();
    let child: ChildProcess | undefined;
    let deadline: NodeJS.Timeout | undefined;

    try {
        child = spawn(process.execPath, ['--import', pathToFileURL(preloadPath).href, entrypoint], {
            cwd: dirname(entrypoint),
            env: {
                ...process.env,
                EPGSTATION_TEST_HARNESS_DIR: harnessDirectory(),
                EPGSTATION_STARTUP_COMPOSITION_FIXTURE: JSON.stringify({ outcome }),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', chunk => {
            stdout += chunk;
        });
        child.stderr?.on('data', chunk => {
            stderr += chunk;
        });
        const close = once(child, 'close') as Promise<[number | null, NodeJS.Signals | null]>;
        const timeout = new Promise<never>((_, reject) => {
            deadline = setTimeout(() => reject(new Error('Startup composition child did not exit')), 2_000);
        });
        const [code] = await Promise.race([close, timeout]);
        const records = stdout.trim().split('\n');

        expect(records).toHaveLength(1);
        return {
            code,
            operations: (JSON.parse(records[0]) as { operations: string[] }).operations,
            stderr,
        };
    } finally {
        if (deadline !== undefined) {
            clearTimeout(deadline);
        }
        if (child !== undefined) {
            await stopChild(child);
        }
    }
};

const operationsFor = (operations: readonly string[], prefix: string): string[] =>
    operations.filter(operation => operation === prefix || operation.startsWith(`${prefix}:`));

const epgStartPrelude = String.raw`
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const fixture = JSON.parse(process.env.EPGSTATION_EPG_START_FIXTURE);
const operations = [];
let published = false;
const record = operation => operations.push(operation);
const originalExit = process.exit.bind(process);
const publish = code => {
    if (published) return;
    published = true;
    process.stdout.write(JSON.stringify({ operations }) + '\n', () => originalExit(code));
};
const observationWindow = setTimeout(() => publish(process.exitCode ?? 0), 50);
const logger = {
    initialize() {},
    getLogger() {
        return {
            system: {
                error: value => record('logger.error:' + String(value)),
                fatal: value => record('logger.fatal:' + String(value)),
                info: () => {},
            },
        };
    },
};
const serviceChild = Object.assign(new EventEmitter(), { pid: 721, stderr: null, stdout: null });
const epgChild = Object.assign(new EventEmitter(), { pid: 722, stderr: null, stdout: null });
const compiledRoot = path.dirname(process.argv[1]);
// 置き換えは entrypoint 自身の module graph の中で評価されるため、ここから渡したいものは
// globalThis を経由する。
// hook は対象 module を読む前に登録する必要があるが、container はこの後で組み立てられる。
// 置き換えは呼ばれた時点で globalThis を見るので、値の受け渡しだけを後段へ回す。
globalThis.__epgstationChildOverrides = {
    get container() {
        return globalThis.__epgstationEpgStartContainer;
    },
    spawnService: (_executable, arguments_) => {
        const entrypoint = String(arguments_[0]);
        if (entrypoint.endsWith('ServiceExecutor.js')) {
            record('service.spawn');
            return serviceChild;
        }
        if (entrypoint.endsWith('EPGUpdateExecutor.js')) {
            record('epg.spawn');
            if (fixture.scenario === 'succeeded') {
                queueMicrotask(() => epgChild.emit('message', { msg: 'updated' }));
            }
            return epgChild;
        }
        throw new Error('Unexpected child entrypoint: ' + entrypoint);
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
await import(pathToFileURL(path.join(compiledRoot, '..', 'node_modules', 'reflect-metadata', 'Reflect.js')).href).catch(() => undefined);
const EPGUpdateEvent = (await import(pathToFileURL(path.join(compiledRoot, 'model', 'event', 'EPGUpdateEvent.js')).href)).default;
const EPGUpdateExecutorManageModel = (await import(pathToFileURL(path.join(compiledRoot, 'model', 'epgUpdater', 'EPGUpdateExecutorManageModel.js')).href)).default;
const StartupContinuationCoordinator = (await import(pathToFileURL(path.join(compiledRoot, 'model', 'workflow', 'StartupContinuationCoordinator.js')).href)).default;
const epgUpdateEvent = new EPGUpdateEvent(logger);
const epgExecutor = new EPGUpdateExecutorManageModel(logger, epgUpdateEvent);
const eventSetter = {
    set() {
        record('event-owner.set');
        epgUpdateEvent.setUpdated(() => record('event-owner.updated'));
    },
};
const recording = {
    cleanup: async () => {
        record('recording.reconciliation');
        if (fixture.scenario === 'failed') throw new Error('synthetic reconciliation failure');
        if (fixture.scenario === 'pending') await new Promise(() => {});
    },
    rebuildCandidatesAndStart: async () => record('recording.candidates-and-start'),
    setTuner: () => record('recording.set-tuners'),
};
const reservation = {
    cleanup: async () => record('reservation.expired-cleanup'),
    setTuners: () => record('reservation.set-tuners'),
};
const services = {
    IConfiguration: { getConfig: () => ({}) },
    IConnectionCheckModel: { checkDB: async () => record('connection.database'), checkMirakurun: async () => record('connection.tuner') },
    IEPGUpdateExecutorManageModel: epgExecutor,
    IEventSetter: eventSetter,
    IIPCServer: { initialize: async () => record('ipc.initialize'), register: () => record('ipc.register') },
    ILoggerModel: logger,
    IRecordingManageModel: recording,
    IReservationManageModel: reservation,
    IRuntimeStartupWorkflowPort: new StartupContinuationCoordinator(),
    IStorageManageModel: { start: () => record('storage.start') },
    TunerServerAccess: { getTuners: async () => (record('tuner.snapshot'), []) },
};
const container = {
    get(identifier) {
        if (!Object.hasOwn(services, identifier)) throw new Error('Unexpected runtime dependency: ' + identifier);
        return services[identifier];
    },
};
globalThis.__epgstationEpgStartContainer = container;
Object.defineProperty(process, 'getuid', { configurable: true, value: () => 1000 });
process.once('unhandledRejection', error => {
    clearTimeout(observationWindow);
    record('runtime.unhandled:' + String(error));
    publish(process.exitCode ?? 0);
});
`;

const observeEpgStart = async (scenario: EpgStartScenario): Promise<EpgStartObservation> => {
    const directory = await mkdtemp(join(tmpdir(), 'epgstation-epg-start-'));
    temporaryDirectories.add(directory);
    const preload = join(directory, 'epg-start-preload.mjs');
    let child: ChildProcess | undefined;
    let deadline: NodeJS.Timeout | undefined;

    try {
        await writeFile(preload, epgStartPrelude, 'utf8');
        const entrypoint = compiledEntrypoint();
        child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, entrypoint], {
            cwd: dirname(entrypoint),
            env: {
                ...process.env,
                EPGSTATION_TEST_HARNESS_DIR: harnessDirectory(),
                EPGSTATION_EPG_START_FIXTURE: JSON.stringify({ scenario }),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        let stdout = '';
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', chunk => {
            stdout += chunk;
        });
        child.stderr?.on('data', chunk => {
            stderr += chunk;
        });
        const close = once(child, 'close') as Promise<[number | null, NodeJS.Signals | null]>;
        const timeout = new Promise<never>((_, reject) => {
            deadline = setTimeout(() => reject(new Error('Compiled Runtime EPG start scenario did not exit')), 2_000);
        });
        const [code] = await Promise.race([close, timeout]);
        const records = stdout.trim().split('\n');

        expect(records).toHaveLength(1);
        if (records[0] === '') {
            throw new Error(`Compiled Runtime EPG start emitted no observation (code ${code}): ${stderr}`);
        }
        return { code, operations: (JSON.parse(records[0]) as { operations: string[] }).operations, stderr };
    } finally {
        if (deadline !== undefined) clearTimeout(deadline);
        if (child !== undefined) await stopChild(child);
    }
};

afterEach(async () => {
    await Promise.all([...temporaryDirectories].map(directory => rm(directory, { force: true, recursive: true })));
    temporaryDirectories.clear();
});

describe('startup cleanup provider integration', () => {
    it.each([
        { expectedOrdinaryEvents: 1, label: 'an ordinary completion result', outcome: 'ordinary-result' },
        { expectedOrdinaryEvents: 0, label: 'no composable result', outcome: 'no-result' },
    ] as const)(
        '[AR-6.2][AR-6.3][AR-6.5] observes $label through the owner provider only',
        async ({ expectedOrdinaryEvents, outcome }) => {
            const observation = await observeStartupComposition(outcome);

            expect(observation.code).toBe(0);
            expect(operationsFor(observation.operations, 'recording.cleanup')).toHaveLength(1);
            expect(operationsFor(observation.operations, 'recording-event.emitFinishRecording')).toHaveLength(
                expectedOrdinaryEvents,
            );
            expect(operationsFor(observation.operations, 'startup-only')).toEqual([]);
            expect(observation.stderr).toBe('');
        },
    );

    it('[AR-6.5] surfaces owner rejection without an ordinary or startup-only signal', async () => {
        const observation = await observeStartupComposition('reject');

        expect(observation.code).toBe(0);
        expect(operationsFor(observation.operations, 'recording.cleanup')).toHaveLength(1);
        expect(operationsFor(observation.operations, 'recording-event.emitFinishRecording')).toEqual([]);
        expect(operationsFor(observation.operations, 'startup-only')).toEqual([]);
        expect(operationsFor(observation.operations, 'runtime.failure')).toEqual([]);
        expect(observation.stderr).toBe('');
    });
});

describe('compiled Runtime EPG start barrier', () => {
    it('[AR-6.1][AR-7.1][AR-7.2][AR-7.4] case-7-10 starts one EPG child only after Workflow success and routes updated through the existing event owner', async () => {
        const observation = await observeEpgStart('succeeded');

        expect(observation.code).toBe(0);
        expect(observation.stderr).toBe('');
        expect(observation.operations).toEqual([
            'connection.tuner',
            'connection.database',
            'ipc.initialize',
            'event-owner.set',
            'tuner.snapshot',
            'reservation.set-tuners',
            'recording.set-tuners',
            'storage.start',
            'service.spawn',
            'ipc.register',
            'recording.reconciliation',
            'recording.candidates-and-start',
            'reservation.expired-cleanup',
            'epg.spawn',
            'event-owner.updated',
        ]);
        expect(observation.operations.filter(operation => operation === 'epg.spawn')).toHaveLength(1);
        expect(observation.operations.filter(operation => operation === 'event-owner.updated')).toHaveLength(1);
        expect(observation.operations.filter(operation => /ready|checkpoint|\.send$/u.test(operation))).toEqual([]);
    });

    it('[AR-7.1] keeps EPG child spawn at zero while Workflow is pending before its EPG callback', async () => {
        const observation = await observeEpgStart('pending');

        expect(observation.code).toBe(0);
        expect(observation.stderr).toBe('');
        expect(observation.operations).toContain('ipc.register');
        expect(observation.operations).toContain('recording.reconciliation');
        expect(observation.operations).not.toContain('epg.spawn');
        expect(observation.operations).not.toContain('event-owner.updated');
    });

    it('[AR-6.7][AR-7.1] failure-stop keeps every subsequent startup stage and EPG start at zero after a failed reconciliation, without an automatic retry of the failed stage', async () => {
        const observation = await observeEpgStart('failed');

        expect(observation.code).toBe(0);
        expect(observation.stderr).toBe('');
        expect(observation.operations).toContain('ipc.register');
        expect(observation.operations.filter(operation => operation === 'recording.reconciliation')).toHaveLength(1);
        expect(observation.operations).not.toContain('recording.candidates-and-start');
        expect(observation.operations).not.toContain('reservation.expired-cleanup');
        expect(observation.operations).not.toContain('epg.spawn');
        expect(observation.operations).not.toContain('event-owner.updated');
    });
});
