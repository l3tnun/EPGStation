import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface EntryGuardObservation {
    readonly code: number | null;
    readonly operations: readonly string[];
    readonly stderr: string;
}

const temporaryDirectories = new Set<string>();

// This preload binds a counting `IRuntimeStartupWorkflowPort` stub into the compiled Runtime
// entrypoint (`index.js`) and drives three service-child generations by emitting `exit` on each
// fake child in turn, mirroring how `src/index.ts`'s `onTerminal` restarts the Service child. The
// production one-entry guard (`startupWorkflowStarted` in `src/index.ts`) must keep the Workflow
// entry point (`runAfterServiceSupervisionAccepted`) at exactly one invocation across all three
// registrations. This is a Workflow-port contract, not the Service child IPC-registry mechanics
// that `test/server/application-runtime/integration/runtime-boundaries.integration.test.ts`
// already covers for Runtime task 8.2 — this test does not spawn a real IPC peer or assert
// current-peer replacement, only the bound port's call count.
/** The directory holding the shared child-side loader hooks. */
const harnessDirectory = (): string => fileURLToPath(new URL('../harness/', import.meta.url));

const entryGuardPreload = String.raw`
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
const operations = [];
const spawnedChildren = [];
let published = false;
const record = operation => operations.push(operation);
const originalExit = process.exit.bind(process);
const publish = code => {
    if (published) return;
    published = true;
    process.stdout.write(JSON.stringify({ operations }) + '\n', () => originalExit(code ?? 0));
};
const observationWindow = setTimeout(() => publish(process.exitCode ?? 0), 2000);
const logger = {
    initialize() {},
    getLogger() {
        return {
            system: {
                debug() {},
                error() {},
                fatal() {},
                info() {},
                warn() {},
            },
        };
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
        register: () => record('ipc.register'),
    },
    ILoggerModel: logger,
    IRecordingManageModel: {
        cleanup: async () => {},
        rebuildCandidatesAndStart: async () => {},
        setTuner: () => {},
    },
    IReservationManageModel: {
        cleanup: async () => {},
        setTuners: () => {},
    },
    IRuntimeStartupWorkflowPort: {
        async runAfterServiceSupervisionAccepted() {
            record('port-invoke');
            return { kind: 'Succeeded', stage: 'epg-supervisor-start' };
        },
    },
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
// 置き換えは entrypoint 自身の module graph の中で評価されるため、ここから渡したいものは
// globalThis を経由する。
globalThis.__epgstationChildOverrides = {
    container,
    spawnService: () => {
                const child = new EventEmitter();
                child.pid = 7300 + spawnedChildren.length;
                child.stdout = null;
                child.stderr = null;
                spawnedChildren.push(child);
                record('child-spawn');
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
process.once('unhandledRejection', error => {
    clearTimeout(observationWindow);
    record('runtime.failure:' + (error instanceof Error ? error.message : String(error)));
    queueMicrotask(() => publish(process.exitCode ?? 0));
});


const waitForChildren = async count => {
    while (spawnedChildren.length < count) {
        await new Promise(resolve => setImmediate(resolve));
    }
};

(async () => {
    // Generation 1: the entrypoint's own startup path spawns the first Service child and starts
    // the Workflow entry point through it.
    await waitForChildren(1);
    // Simulate a Service child crash: 'exit' drives src/index.ts's onTerminal -> runService(),
    // which re-registers a fresh child and re-invokes the (already-started) Workflow entry point.
    spawnedChildren[0].emit('exit', 1, null);

    // Generation 2: re-entry after the first restart.
    await waitForChildren(2);
    spawnedChildren[1].emit('exit', 1, null);

    // Generation 3: re-entry after a second restart, to show the guard holds across repeated
    // re-entry, not just a single retry.
    await waitForChildren(3);

    clearTimeout(observationWindow);
    publish(0);
})();
`;

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

const observeEntryGuard = async (): Promise<EntryGuardObservation> => {
    const directory = await mkdtemp(join(tmpdir(), 'epgstation-startup-entry-guard-'));
    temporaryDirectories.add(directory);
    const preloadPath = join(directory, 'startup-entry-guard-preload.mjs');
    await writeFile(preloadPath, entryGuardPreload, 'utf8');
    const entrypoint = compiledEntrypoint();
    let child: ChildProcess | undefined;
    let deadline: NodeJS.Timeout | undefined;

    try {
        child = spawn(process.execPath, ['--import', pathToFileURL(preloadPath).href, entrypoint], {
            cwd: dirname(entrypoint),
            env: { ...process.env, EPGSTATION_TEST_HARNESS_DIR: harnessDirectory() },
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
            deadline = setTimeout(() => reject(new Error('Compiled Runtime entry-guard scenario did not exit')), 3_000);
        });
        const [code] = await Promise.race([close, timeout]);
        const records = stdout.trim().split('\n');

        expect(records).toHaveLength(1);
        if (records[0] === '') {
            throw new Error(`Compiled Runtime entry-guard scenario emitted no observation (code ${code}): ${stderr}`);
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

describe('compiled Runtime startup Workflow entry-point one-entry guard', () => {
    it('invokes the bound IRuntimeStartupWorkflowPort exactly once across three Service child registrations', async () => {
        const observation = await observeEntryGuard();

        expect(observation.code).toBe(0);
        expect(observation.stderr).toBe('');
        expect(observation.operations.filter(operation => operation === 'child-spawn')).toHaveLength(3);
        expect(observation.operations.filter(operation => operation === 'ipc.register')).toHaveLength(3);
        expect(observation.operations.filter(operation => operation === 'port-invoke')).toHaveLength(1);
        expect(observation.operations.filter(operation => operation.startsWith('runtime.failure'))).toEqual([]);
    });
});
