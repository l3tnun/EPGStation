import 'reflect-metadata';

import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, isAbsolute, join } from 'node:path';
import { Container } from 'inversify';
import { describe, expect, it } from 'vitest';

type OperatorCompositionScenario = 'service-restart' | 'success' | 'tuner-snapshot-failure';

interface OperatorCompositionLedgerEntry {
    readonly detail?: unknown;
    readonly operation: string;
}

interface OperatorCompositionObservation {
    readonly code: number | null;
    readonly ledger: OperatorCompositionLedgerEntry[];
    readonly stderr: string;
}

const operatorCompositionPrelude = String.raw`
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
const fixture = JSON.parse(process.env.EPGSTATION_OPERATOR_COMPOSITION_FIXTURE);
const ledger = [];
let published = false;
const record = (operation, detail) => {
    const entry = { operation };
    if (detail !== undefined) entry.detail = detail;
    ledger.push(entry);
};
const originalExit = process.exit.bind(process);
const publish = code => {
    if (published) return;
    published = true;
    process.stdout.write(JSON.stringify({ ledger }) + '\n', () => originalExit(code));
};
process.exit = code => {
    record('process.exit', code);
    publish(code === undefined ? (process.exitCode ?? 0) : code);
};
const scheduleTimeout = setTimeout;
const scheduleInterval = setInterval;
const scheduleImmediate = setImmediate;
const observationWindow = scheduleTimeout(() => publish(process.exitCode ?? 0), 50);
global.setTimeout = function(...arguments_) {
    record('delayed-action-scheduled', 'timeout');
    return scheduleTimeout(...arguments_);
};
global.setInterval = function(...arguments_) {
    record('delayed-action-scheduled', 'interval');
    return scheduleInterval(...arguments_);
};
global.setImmediate = function(...arguments_) {
    record('delayed-action-scheduled', 'immediate');
    return scheduleImmediate(...arguments_);
};
const tunerSnapshot = Object.freeze(
    Array.from({ length: fixture.tunerCount }, (_, tunerIndex) => Object.freeze({ id: 'synthetic-tuner-' + tunerIndex })),
);
const logger = {
    initialize() {},
    getLogger() {
        return {
            system: {
                fatal: value => record('fatal-log', value instanceof Error ? value.message : String(value)),
                info() {},
            },
        };
    },
};
const serviceChild = new EventEmitter();
serviceChild.pid = 721;
serviceChild.stderr = null;
serviceChild.stdout = null;
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
        register: () => record('ipc-register'),
    },
    ILoggerModel: logger,
    IRecordingManageModel: {
        cleanup: async () => record('recording-cleanup'),
        rebuildCandidatesAndStart: async () => record('recording-rebuild'),
        setTuner: tuners => record('recording-set-tuner', { sameSnapshot: tuners === tunerSnapshot, tunerCount: tuners.length }),
    },
    IReservationManageModel: {
        cleanup: async () => record('reservation-cleanup'),
        setTuners: tuners => record('reservation-set-tuners', { sameSnapshot: tuners === tunerSnapshot, tunerCount: tuners.length }),
    },
    IRuntimeStartupWorkflowPort: {
        runAfterServiceSupervisionAccepted: async () => {
            record('workflow-port-invoked');
            return { kind: 'Succeeded', stage: 'epg-supervisor-start' };
        },
    },
    IStorageManageModel: { start: () => record('storage-start') },
    TunerServerAccess: {
        getTuners: async () => {
            record('tuner-snapshot');
            if (fixture.scenario === 'tuner-snapshot-failure') {
                throw new Error('synthetic tuner snapshot failure');
            }
            return tunerSnapshot;
        },
    },
};
const restartedServiceChildren = [];
const container = {
    get(identifier) {
        if (!Object.hasOwn(services, identifier)) throw new Error('Unexpected runtime dependency: ' + identifier);
        return services[identifier];
    },
};
Object.defineProperty(process, 'getuid', { configurable: true, value: () => 1000 });
// 置き換えは entrypoint 自身の module graph の中で評価されるため、ここから渡したいものは
// globalThis を経由する。
globalThis.__epgstationOperatorComposition = {
    container,
    spawnService: () => {
        record('service-spawn');
        if (fixture.scenario !== 'service-restart') return serviceChild;
        // 最初の二世代は終了と起動エラーで続けて置き換えさせ、三世代目で止める。
        const child = new EventEmitter();
        child.pid = 730 + restartedServiceChildren.length;
        child.stderr = null;
        child.stdout = null;
        restartedServiceChildren.push(child);
        const generation = restartedServiceChildren.length;
        if (generation === 1) scheduleImmediate(() => child.emit('exit', 1, null));
        if (generation === 2) scheduleImmediate(() => child.emit('error', new Error('synthetic service error')));
        return child;
    },
};
const spawnSource = 'export const spawn = (...a) => globalThis.__epgstationOperatorComposition.spawnService(...a);\nexport default { spawn };';
const { registerOverrides } = await import(pathToFileURL(process.env.EPGSTATION_TEST_HARNESS_DIR + '/child-module-overrides.mjs').href);
registerOverrides([
    { specifier: 'node:child_process', source: spawnSource },
    { specifier: 'child_process', source: spawnSource },
    { specifier: 'reflect-metadata', source: 'export default {};' },
    { specifier: 'source-map-support', source: 'export const install = () => undefined;\nexport default { install };' },
    {
        specifier: './model/ModelContainer.js',
        source: 'export default globalThis.__epgstationOperatorComposition.container;',
    },
    { specifier: './model/ModelContainerSetter.js', source: 'export const set = () => undefined;' },
]);
`;

/** The directory holding the shared child-side loader hooks. */
const harnessDirectory = (): string => fileURLToPath(new URL('../harness/', import.meta.url));

const compiledSnapshotRoot = (): string => {
    const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
    if (compiledSnapshot === undefined || !isAbsolute(compiledSnapshot)) {
        throw new Error('Server test runner did not provide an absolute compiled snapshot');
    }
    return compiledSnapshot;
};

const compiledEntrypoint = (): string => join(compiledSnapshotRoot(), 'index.js');

const packageRequire = createRequire(join(process.cwd(), 'package.json'));

const waitForClose = async (child: ChildProcess): Promise<{ code: number | null; stderr: string; stdout: string }> => {
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
    const [code] = (await once(child, 'close')) as [number | null, NodeJS.Signals | null];
    return { code, stderr, stdout };
};

const stopChild = async (child: ChildProcess): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) {
        return;
    }
    const closed = once(child, 'close');
    child.kill('SIGKILL');
    await closed;
};

const observeOperatorComposition = async (
    scenario: OperatorCompositionScenario,
    tunerCount = 1,
): Promise<OperatorCompositionObservation> => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'epgstation-operator-composition-'));
    const preludePath = join(temporaryDirectory, 'operator-composition-prelude.mjs');
    let child: ChildProcess | undefined;
    let deadline: NodeJS.Timeout | undefined;

    try {
        await writeFile(preludePath, operatorCompositionPrelude, 'utf8');
        const entrypoint = compiledEntrypoint();
        child = spawn(process.execPath, ['--import', pathToFileURL(preludePath).href, entrypoint], {
            cwd: dirname(entrypoint),
            env: {
                ...process.env,
                EPGSTATION_OPERATOR_COMPOSITION_FIXTURE: JSON.stringify({ scenario, tunerCount }),
                EPGSTATION_TEST_HARNESS_DIR: harnessDirectory(),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const close = waitForClose(child);
        const timeout = new Promise<never>((_, reject) => {
            deadline = setTimeout(() => reject(new Error('Operator composition child did not exit')), 2_000);
        });
        const observation = await Promise.race([close, timeout]);
        const records = observation.stdout.trim().split('\n');

        expect(records).toHaveLength(1);
        return {
            code: observation.code,
            ledger: (JSON.parse(records[0]) as { ledger: OperatorCompositionLedgerEntry[] }).ledger,
            stderr: observation.stderr,
        };
    } finally {
        if (deadline !== undefined) {
            clearTimeout(deadline);
        }
        if (child !== undefined) {
            await stopChild(child);
        }
        await rm(temporaryDirectory, { force: true, recursive: true });
    }
};

const entriesFor = (
    ledger: readonly OperatorCompositionLedgerEntry[],
    operation: string,
): OperatorCompositionLedgerEntry[] => ledger.filter(entry => entry.operation === operation);

const firstIndexOf = (ledger: readonly OperatorCompositionLedgerEntry[], operation: string): number => {
    const index = ledger.findIndex(entry => entry.operation === operation);
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
};

describe('runtime operator composition', () => {
    it.each([
        { label: 'an empty snapshot', tunerCount: 0 },
        { label: 'a one-tuner snapshot', tunerCount: 1 },
        { label: 'a multi-tuner maximum representative snapshot', tunerCount: 3 },
    ])(
        '[AR-4.1][AR-4.2][AR-4.3][AR-4.4] binds events once, distributes $label, then starts storage',
        async ({ tunerCount }) => {
            const observation = await observeOperatorComposition('success', tunerCount);
            const eventBinding = firstIndexOf(observation.ledger, 'event-binding');
            const tunerSnapshot = firstIndexOf(observation.ledger, 'tuner-snapshot');
            const reservationTuners = firstIndexOf(observation.ledger, 'reservation-set-tuners');
            const recordingTuner = firstIndexOf(observation.ledger, 'recording-set-tuner');
            const storageStart = firstIndexOf(observation.ledger, 'storage-start');

            expect(observation.code).toBe(0);
            expect(observation.stderr).toBe('');
            expect(entriesFor(observation.ledger, 'event-binding')).toHaveLength(1);
            expect(entriesFor(observation.ledger, 'tuner-snapshot')).toHaveLength(1);
            expect(entriesFor(observation.ledger, 'reservation-set-tuners')).toEqual([
                { detail: { sameSnapshot: true, tunerCount }, operation: 'reservation-set-tuners' },
            ]);
            expect(entriesFor(observation.ledger, 'recording-set-tuner')).toEqual([
                { detail: { sameSnapshot: true, tunerCount }, operation: 'recording-set-tuner' },
            ]);
            expect(firstIndexOf(observation.ledger, 'tuner-availability')).toBeLessThan(eventBinding);
            expect(firstIndexOf(observation.ledger, 'database-availability')).toBeLessThan(eventBinding);
            expect(eventBinding).toBeLessThan(tunerSnapshot);
            expect(tunerSnapshot).toBeLessThan(reservationTuners);
            expect(reservationTuners).toBeLessThan(recordingTuner);
            expect(recordingTuner).toBeLessThan(storageStart);
            expect(entriesFor(observation.ledger, 'service-spawn')).toHaveLength(1);
            expect(firstIndexOf(observation.ledger, 'service-spawn')).toBeGreaterThan(storageStart);
            expect(entriesFor(observation.ledger, 'process.exit')).toEqual([]);
        },
    );

    it('[AR-4.5] binds the Workflow event entry and the startup Workflow port once each across Service child re-entry', async () => {
        const observation = await observeOperatorComposition('service-restart');
        const eventBinding = firstIndexOf(observation.ledger, 'event-binding');
        const firstSpawn = firstIndexOf(observation.ledger, 'service-spawn');
        const workflowPort = firstIndexOf(observation.ledger, 'workflow-port-invoked');

        expect(observation.code).toBe(0);
        expect(observation.stderr).toBe('');
        // 世代を二度置き換えても、Service child の起動と IPC 登録だけが世代ごとに繰り返される。
        expect(entriesFor(observation.ledger, 'service-spawn')).toHaveLength(3);
        expect(entriesFor(observation.ledger, 'ipc-register')).toHaveLength(3);
        expect(entriesFor(observation.ledger, 'event-binding')).toHaveLength(1);
        expect(entriesFor(observation.ledger, 'workflow-port-invoked')).toHaveLength(1);
        expect(entriesFor(observation.ledger, 'tuner-snapshot')).toHaveLength(1);
        expect(entriesFor(observation.ledger, 'storage-start')).toHaveLength(1);
        expect(eventBinding).toBeLessThan(firstSpawn);
        expect(firstSpawn).toBeLessThan(workflowPort);
        expect(entriesFor(observation.ledger, 'process.exit')).toEqual([]);
    });

    it('[AR-4.1][AR-4.6] logs a failed tuner snapshot without rebinding, downstream starts, parent exit, or restart', async () => {
        const observation = await observeOperatorComposition('tuner-snapshot-failure');

        expect(observation.code).toBe(0);
        expect(observation.stderr).toBe('');
        expect(entriesFor(observation.ledger, 'event-binding')).toHaveLength(1);
        expect(entriesFor(observation.ledger, 'tuner-snapshot')).toHaveLength(1);
        expect(entriesFor(observation.ledger, 'reservation-set-tuners')).toEqual([]);
        expect(entriesFor(observation.ledger, 'recording-set-tuner')).toEqual([]);
        expect(entriesFor(observation.ledger, 'storage-start')).toEqual([]);
        expect(entriesFor(observation.ledger, 'service-spawn')).toEqual([]);
        expect(entriesFor(observation.ledger, 'ipc-register')).toEqual([]);
        expect(entriesFor(observation.ledger, 'delayed-action-scheduled')).toEqual([]);
        expect(entriesFor(observation.ledger, 'fatal-log')).toEqual([
            { detail: 'unhandledRejection', operation: 'fatal-log' },
            { detail: 'synthetic tuner snapshot failure', operation: 'fatal-log' },
        ]);
        expect(entriesFor(observation.ledger, 'process.exit')).toEqual([]);
    });

    it('[AR-4.2] resolves Runtime-owned storage ports that expose the current child snapshot and prepared deletion result', async () => {
        const compiledSnapshot = compiledSnapshotRoot();
        const { set } = packageRequire(join(compiledSnapshot, 'model/ModelContainerSetter.js')) as {
            set(container: Container): void;
        };
        const IPCServer = (packageRequire(join(compiledSnapshot, 'model/ipc/IPCServer.js')) as { default: any })
            .default;
        const childSnapshot = async (): Promise<{
            readonly status: 'known';
            readonly recordedIds: readonly number[];
        }> => ({
            status: 'known',
            recordedIds: [91],
        });
        const calls: string[] = [];
        const preparedToken = Object.freeze({ prepared: 41 });
        const container = new Container();
        set(container);
        container.rebind(IPCServer).toConstantValue({ recordedUseSnapshotClient: { requestSnapshot: childSnapshot } });
        container.rebind('IRecordedManageModel').toConstantValue({
            deletePreparedForStorage: async (token: object): Promise<'deleted'> => {
                expect(token).toBe(preparedToken);
                calls.push('final-delete');
                return 'deleted';
            },
            prepareStorageDeletion: async (recordedId: number, storageName: string) => {
                calls.push(`prepare:${recordedId}:${storageName}`);
                return { status: 'prepared' as const, token: preparedToken };
            },
        });

        const snapshot = container.get<{
            getSnapshot(): Promise<
                { readonly status: 'known'; readonly recordedIds: ReadonlySet<number> } | { readonly status: 'unknown' }
            >;
        }>('IStorageRecordedUseSnapshotPort');
        const deletion = container.get<{
            deleteForStoragePressure(recordedId: number, storageName: string): Promise<'deleted' | 'not-deleted'>;
        }>('IRecordedStorageDeletionPort');
        const serviceRegistry = container.get<{ registerPeer(peer: object): void }>('ServiceChildRecordedUseRegistry');
        serviceRegistry.registerPeer(Object.freeze({ generation: 'current' }));

        await expect(snapshot.getSnapshot()).resolves.toEqual({ status: 'known', recordedIds: new Set([91]) });
        await expect(deletion.deleteForStoragePressure(41, 'archive')).resolves.toBe('deleted');
        expect(calls).toEqual(['prepare:41:archive', 'final-delete']);
    });

    it('[AR-4.2] reports the staged delivery recorded-use snapshot as unknown before ServiceChildRecordedUseComposition ever binds it', async () => {
        // `ServiceChildRecordedUseComposition.bind` (invoked only when `IEncodeFinishModel` is first
        // resolved) is what wires this provider to the real `DeliveryRecordedUseSnapshotProvider`.
        // Resolving the provider directly, without ever resolving `IEncodeFinishModel`, exercises the
        // provider's own "not bound yet" guard exactly as it defends the composition it belongs to.
        const compiledSnapshot = compiledSnapshotRoot();
        const { set } = packageRequire(join(compiledSnapshot, 'model/ModelContainerSetter.js')) as {
            set(container: Container): void;
        };
        const container = new Container();
        set(container);

        const provider = container.get<{ getActiveRecordedFileDeliveryIds(): unknown }>(
            'StagedDeliveryRecordedUseSnapshotProvider',
        );

        expect(provider.getActiveRecordedFileDeliveryIds()).toEqual({ status: 'unknown' });
    });
});
