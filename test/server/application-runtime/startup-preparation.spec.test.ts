import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

type IdentityValue = number | string;

interface StartupFixture {
    readonly gid?: IdentityValue | null;
    readonly root: boolean;
    readonly uid?: IdentityValue;
}

interface StartupLedgerEntry {
    readonly argument?: IdentityValue | string | null;
    readonly operation: string;
}

interface StartupObservation {
    readonly code: number | null;
    readonly stderr: string;
    readonly stdout: string;
}

interface StartupLedger {
    readonly ledger: StartupLedgerEntry[];
}

type StartupPreparationFailure = 'operational-log' | 'configuration-snapshot' | 'operator-log' | 'setgid' | 'setuid';

type StartupFailureScenario = StartupPreparationFailure | 'global-failures';

interface StartupFailureObservation extends StartupObservation {
    readonly ledger: StartupLedgerEntry[];
}

const startupPrelude = String.raw`
import { pathToFileURL } from 'node:url';
const fixture = JSON.parse(process.env.EPGSTATION_STARTUP_PREPARATION_FIXTURE);
const ledger = [];
const record = (operation, argument) => {
    const entry = { operation };
    if (argument !== undefined) entry.argument = argument;
    ledger.push(entry);
};
const publishAndExit = () => {
    process.stdout.write(JSON.stringify({ ledger }) + '\n', () => process.exit(0));
};
const logger = {
    initialize(filePath) {
        if (filePath === undefined) {
            record('operational-log');
            return;
        }
        record('operator-log', filePath);
        publishAndExit();
    },
    getLogger() {
        return { system: { fatal() {} } };
    },
};
const configuration = {
    getConfig() {
        record('configuration-snapshot');
        return fixture.config;
    },
};
const container = {
    get(identifier) {
        if (identifier === 'ILoggerModel') return logger;
        if (identifier === 'IConfiguration') return configuration;
        // identity の変更までを観測する test なので、その直後に来る接続確認は素通しにする。
        // CommonJS では観測窓を閉じる process.exit がここへ到達する前に働いていた。
        if (identifier === 'IConnectionCheckModel') {
            return { checkMirakurun: async () => undefined, checkDB: async () => undefined };
        }
        throw new Error('Unexpected startup dependency: ' + identifier);
    },
};
Object.defineProperty(process, 'getuid', { configurable: true, value: () => fixture.root ? 0 : 1000 });
Object.defineProperty(process, 'setgid', {
    configurable: true,
    value: value => record('setgid', value),
});
Object.defineProperty(process, 'setuid', {
    configurable: true,
    value: value => record('setuid', value),
});
// 置き換えは entrypoint 自身の module graph の中で評価されるため、ここから渡したいものは
// globalThis を経由する。
globalThis.__epgstationChildOverrides = {
    container,
};
const setterSource = 'export const set = () => undefined;';
const { registerOverrides } = await import(pathToFileURL(process.env.EPGSTATION_TEST_HARNESS_DIR + '/child-module-overrides.mjs').href);
registerOverrides([
    { specifier: './model/ModelContainer.js', source: 'export default globalThis.__epgstationChildOverrides.container;' },
    { specifier: './model/ModelContainerSetter.js', source: setterSource },
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

const waitForClose = async (child: ChildProcess): Promise<StartupObservation> => {
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

const observeStartup = async (fixture: StartupFixture): Promise<StartupLedgerEntry[]> => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'epgstation-startup-preparation-'));
    const preludePath = join(temporaryDirectory, 'startup-prelude.mjs');
    let child: ChildProcess | undefined;
    let deadline: NodeJS.Timeout | undefined;

    try {
        await writeFile(preludePath, startupPrelude, 'utf8');
        const entrypoint = compiledEntrypoint();
        child = spawn(process.execPath, ['--import', pathToFileURL(preludePath).href, entrypoint], {
            cwd: dirname(entrypoint),
            env: {
                ...process.env,
                EPGSTATION_TEST_HARNESS_DIR: harnessDirectory(),
                EPGSTATION_STARTUP_PREPARATION_FIXTURE: JSON.stringify({
                    config: { gid: fixture.gid, uid: fixture.uid },
                    root: fixture.root,
                }),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const close = waitForClose(child);
        const timeout = new Promise<never>((_, reject) => {
            deadline = setTimeout(() => reject(new Error('Startup preparation child did not exit')), 2_000);
        });
        const observation = await Promise.race([close, timeout]);

        expect(observation.code).toBe(0);
        expect(observation.stderr).toBe('');
        const records = observation.stdout.trim().split('\n');
        expect(records).toHaveLength(1);
        return (JSON.parse(records[0]) as StartupLedger).ledger;
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

const preparationOperations = (ledger: readonly StartupLedgerEntry[]): StartupLedgerEntry[] =>
    ledger
        .filter(entry =>
            ['operational-log', 'configuration-snapshot', 'setgid', 'setuid', 'operator-log'].includes(entry.operation),
        )
        .map(entry => (entry.operation === 'operator-log' ? { operation: entry.operation } : entry));

const expectOperatorLogConfiguration = (ledger: readonly StartupLedgerEntry[]): void => {
    expect(ledger.filter(entry => entry.operation === 'operator-log')).toEqual([
        {
            argument: expect.stringMatching(/[/\\]config[/\\]operatorLogConfig\.yml$/u),
            operation: 'operator-log',
        },
    ]);
};

const startupFailurePrelude = String.raw`
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
const fixture = JSON.parse(process.env.EPGSTATION_STARTUP_FAILURE_FIXTURE);
const ledger = [];
let published = false;
const record = (operation, argument) => {
    const entry = { operation };
    if (argument !== undefined) entry.argument = argument;
    ledger.push(entry);
};
const originalExit = process.exit.bind(process);
const publish = code => {
    if (published) return;
    published = true;
    process.stdout.write(JSON.stringify({ ledger }) + '\n', () => originalExit(code));
};
const failAt = operation => {
    if (fixture.failure === operation) throw new Error('synthetic startup failure: ' + operation);
};
process.exit = code => {
    record('process.exit', code);
    publish(code);
};
process.once('beforeExit', () => publish(0));
const logger = {
    initialize(filePath) {
        const operation = filePath === undefined ? 'operational-log' : 'operator-log';
        record(operation);
        failAt(operation);
    },
    getLogger() {
        return {
            system: {
                fatal: value => record('fatal-log', value instanceof Error ? value.message : String(value)),
                info: () => record('info-log'),
            },
        };
    },
};
const child = new EventEmitter();
child.pid = 721;
child.stderr = null;
child.stdout = null;
child.kill = () => (record('child-kill'), true);
const services = {
    IConnectionCheckModel: {
        checkDB: async () => record('dependency-wait'),
        checkMirakurun: async () => record('dependency-wait'),
    },
    IConfiguration: {
        getConfig: () => {
            record('configuration-snapshot');
            failAt('configuration-snapshot');
            return { gid: 'recording-group', uid: 'recording-user' };
        },
    },
    IEPGUpdateExecutorManageModel: { execute: () => record('operator') },
    IEventSetter: { set: () => record('operator') },
    IIPCServer: {
        initialize: async () => record('operator'),
        register: () => record('operator'),
    },
    ILoggerModel: logger,
    IRecordingManageModel: {
        cleanup: async () => record('operator'),
        setTuner: () => record('operator'),
    },
    IReservationManageModel: {
        cleanup: async () => record('operator'),
        setTuners: () => record('operator'),
    },
    IRuntimeStartupWorkflowPort: {
        runAfterServiceSupervisionAccepted: async () => ({ kind: 'Succeeded', stage: 'epg-supervisor-start' }),
    },
    IStorageManageModel: { start: () => record('operator') },
    TunerServerAccess: { getTuners: async () => (record('operator'), []) },
};
const container = { get: identifier => services[identifier] };
Object.defineProperty(process, 'getuid', { configurable: true, value: () => 0 });
Object.defineProperty(process, 'setgid', {
    configurable: true,
    value: value => {
        record('setgid', value);
        failAt('setgid');
    },
});
Object.defineProperty(process, 'setuid', {
    configurable: true,
    value: value => {
        record('setuid', value);
        failAt('setuid');
    },
});
// 置き換えは entrypoint 自身の module graph の中で評価されるため、ここから渡したいものは
// globalThis を経由する。
globalThis.__epgstationChildOverrides = {
    container,
    spawnService: () => {
        record('child-spawn');
        if (fixture.failure === 'global-failures') {
            // 起動が済んだ後に、捕捉されなかった例外と未処理の非同期失敗を一回ずつ検知させる。
            setImmediate(() => {
                record('global-failures-begin');
                process.emit('uncaughtException', new Error('synthetic uncaught'), 'uncaughtException');
                process.emit('unhandledRejection', new Error('synthetic rejection'), Promise.resolve());
                record('global-failures-end');
            });
        }
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
`;

const observeStartupFailure = async (failure: StartupFailureScenario): Promise<StartupFailureObservation> => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'epgstation-startup-failure-'));
    const preludePath = join(temporaryDirectory, 'startup-failure-prelude.mjs');
    let child: ChildProcess | undefined;
    let deadline: NodeJS.Timeout | undefined;

    try {
        await writeFile(preludePath, startupFailurePrelude, 'utf8');
        const entrypoint = compiledEntrypoint();
        child = spawn(process.execPath, ['--import', pathToFileURL(preludePath).href, entrypoint], {
            cwd: dirname(entrypoint),
            env: {
                ...process.env,
                EPGSTATION_TEST_HARNESS_DIR: harnessDirectory(),
                EPGSTATION_STARTUP_FAILURE_FIXTURE: JSON.stringify({ failure }),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const close = waitForClose(child);
        const timeout = new Promise<never>((_, reject) => {
            deadline = setTimeout(() => reject(new Error('Startup failure child did not exit')), 2_000);
        });
        const observation = await Promise.race([close, timeout]);
        const records = observation.stdout.trim().split('\n');

        expect(records).toHaveLength(1);
        return { ...observation, ledger: (JSON.parse(records[0]) as StartupLedger).ledger };
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

describe('startup preparation', () => {
    it.each([
        {
            expected: [
                { operation: 'operational-log' },
                { operation: 'configuration-snapshot' },
                { operation: 'operator-log' },
            ],
            fixture: { root: false, gid: 'ignored-group', uid: 'ignored-user' },
            label: '[AR-2.1][AR-2.5] initializes the log and reads the configuration before the operator log, without an identity change, when the process is non-root',
        },
        {
            expected: [
                { operation: 'operational-log' },
                { operation: 'configuration-snapshot' },
                { operation: 'setgid', argument: 'recording-group' },
                { operation: 'operator-log' },
            ],
            fixture: { root: true, gid: 'recording-group' },
            label: '[AR-2.2] uses a configured string group for a root process',
        },
        {
            expected: [
                { operation: 'operational-log' },
                { operation: 'configuration-snapshot' },
                { operation: 'setgid', argument: 41 },
                { operation: 'operator-log' },
            ],
            fixture: { root: true, gid: 41 },
            label: '[AR-2.2] uses a configured numeric group for a root process',
        },
        {
            expected: [
                { operation: 'operational-log' },
                { operation: 'configuration-snapshot' },
                { operation: 'setgid', argument: 'video' },
                { operation: 'operator-log' },
            ],
            fixture: { root: true },
            label: '[AR-2.3][AR-2.4] uses the video group and no user change when a root process has no configured group or user',
        },
        {
            expected: [
                { operation: 'operational-log' },
                { operation: 'configuration-snapshot' },
                { operation: 'setgid', argument: 'video' },
                { operation: 'operator-log' },
            ],
            fixture: { root: true, gid: null },
            label: '[AR-2.3] uses the video group when a root process has a null group',
        },
        {
            expected: [
                { operation: 'operational-log' },
                { operation: 'configuration-snapshot' },
                { operation: 'setgid', argument: 'video' },
                { operation: 'setuid', argument: 'recording-user' },
                { operation: 'operator-log' },
            ],
            fixture: { root: true, uid: 'recording-user' },
            label: '[AR-2.4][AR-2.5] changes to a configured string user after the default group, then reads the operator log',
        },
        {
            expected: [
                { operation: 'operational-log' },
                { operation: 'configuration-snapshot' },
                { operation: 'setgid', argument: 41 },
                { operation: 'setuid', argument: 42 },
                { operation: 'operator-log' },
            ],
            fixture: { root: true, gid: 41, uid: 42 },
            label: '[AR-2.4][AR-2.5] changes to a configured numeric user after its configured group, then reads the operator log',
        },
    ] satisfies Array<{
        readonly expected: readonly StartupLedgerEntry[];
        readonly fixture: StartupFixture;
        readonly label: string;
    }>)('$label', async ({ fixture, expected }) => {
        const ledger = await observeStartup(fixture);

        expect(preparationOperations(ledger)).toEqual(expected);
        expectOperatorLogConfiguration(ledger);
    });

    it('[AR-2.3] passes a configured empty string group through unchanged for a root process', async () => {
        const ledger = await observeStartup({ root: true, gid: '' });

        expect(preparationOperations(ledger)).toEqual([
            { operation: 'operational-log' },
            { operation: 'configuration-snapshot' },
            { operation: 'setgid', argument: '' },
            { operation: 'operator-log' },
        ]);
        expectOperatorLogConfiguration(ledger);
    });

    it.each([
        {
            failure: 'operational-log',
            expectedPreparation: [{ operation: 'operational-log' }],
        },
        {
            failure: 'configuration-snapshot',
            expectedPreparation: [{ operation: 'operational-log' }, { operation: 'configuration-snapshot' }],
        },
        {
            failure: 'setgid',
            expectedPreparation: [
                { operation: 'operational-log' },
                { operation: 'configuration-snapshot' },
                { operation: 'setgid', argument: 'recording-group' },
            ],
        },
        {
            failure: 'setuid',
            expectedPreparation: [
                { operation: 'operational-log' },
                { operation: 'configuration-snapshot' },
                { operation: 'setgid', argument: 'recording-group' },
                { operation: 'setuid', argument: 'recording-user' },
            ],
        },
        {
            failure: 'operator-log',
            expectedPreparation: [
                { operation: 'operational-log' },
                { operation: 'configuration-snapshot' },
                { operation: 'setgid', argument: 'recording-group' },
                { operation: 'setuid', argument: 'recording-user' },
                { operation: 'operator-log' },
            ],
        },
    ] satisfies Array<{
        readonly expectedPreparation: readonly StartupLedgerEntry[];
        readonly failure: StartupPreparationFailure;
    }>)(
        '[AR-2.6] exits nonzero without later startup work when $failure preparation fails',
        async ({ expectedPreparation, failure }) => {
            const observation = await observeStartupFailure(failure);

            expect(observation.code).toBe(1);
            expect(observation.ledger.filter(entry => entry.operation !== 'process.exit')).toEqual(expectedPreparation);
            expect(observation.ledger.filter(entry => entry.operation === 'process.exit')).toEqual([
                { operation: 'process.exit', argument: 1 },
            ]);
            expect(
                observation.ledger.filter(entry =>
                    ['dependency-wait', 'operator', 'child-spawn'].includes(entry.operation),
                ),
            ).toEqual([]);
        },
    );

    it('[AR-2.7] records an uncaught exception and an unhandled rejection as fatal without exit, child collection, or new startup work', async () => {
        const observation = await observeStartupFailure('global-failures');
        const begin = observation.ledger.findIndex(entry => entry.operation === 'global-failures-begin');
        const end = observation.ledger.findIndex(entry => entry.operation === 'global-failures-end');

        expect(observation.code).toBe(0);
        expect(observation.stderr).toBe('');
        expect(begin).toBeGreaterThanOrEqual(0);
        expect(observation.ledger.filter(entry => entry.operation === 'child-spawn')).toHaveLength(1);
        // 検知から記録までの間に起きた操作は、重大な異常の記録だけである。
        expect(observation.ledger.slice(begin + 1, end)).toEqual([
            { operation: 'fatal-log', argument: 'uncaughtException: synthetic uncaught' },
            { operation: 'fatal-log', argument: 'synthetic uncaught' },
            { operation: 'fatal-log', argument: 'unhandledRejection' },
            { operation: 'fatal-log', argument: 'synthetic rejection' },
        ]);
        expect(observation.ledger.slice(end + 1)).toEqual([]);
        expect(observation.ledger.filter(entry => entry.operation === 'process.exit')).toEqual([]);
        expect(observation.ledger.filter(entry => entry.operation === 'child-kill')).toEqual([]);
    });
});
