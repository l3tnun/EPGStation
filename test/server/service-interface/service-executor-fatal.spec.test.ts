import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

interface ServiceExecutorLedgerEntry {
    readonly detail?: unknown;
    readonly operation: string;
}

interface ServiceExecutorObservation {
    readonly code: number | null;
    readonly ledger: ServiceExecutorLedgerEntry[];
    readonly stderr: string;
}

/** The directory holding the shared child-side loader hooks. */
const harnessDirectory = (): string => fileURLToPath(new URL('../harness/', import.meta.url));

const serviceExecutorPrelude = String.raw`
import { pathToFileURL } from 'node:url';
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
const logger = {
    initialize() {},
    getLogger() {
        return {
            system: {
                fatal: value => record('fatal-log', value instanceof Error ? value.message : String(value)),
            },
        };
    },
};
const container = {
    get(identifier) {
        if (identifier === 'ILoggerModel') return logger;
        if (identifier === 'IEncodeFinishModel') return { set: () => record('encode-finish-set') };
        if (identifier === 'IServiceServer') {
            return {
                start: () => {
                    record('service-server-start');
                    throw new Error('synthetic ServiceServer start failure');
                },
            };
        }
        throw new Error('Unexpected runtime dependency: ' + identifier);
    },
};
// 置き換えは entrypoint 自身の module graph の中で評価されるため、ここから渡したいものは
// globalThis を経由する。
globalThis.__epgstationChildOverrides = {
    container,
};
const sourceMapSupportSource = 'export const install = () => undefined; export default { install };';
const { registerOverrides } = await import(pathToFileURL(process.env.EPGSTATION_TEST_HARNESS_DIR + '/child-module-overrides.mjs').href);
registerOverrides([
    { specifier: 'reflect-metadata', source: 'export default {};' },
    { specifier: 'source-map-support', source: sourceMapSupportSource },
    { specifier: '../ModelContainer.js', source: 'export default globalThis.__epgstationChildOverrides.container;' },
    { specifier: '../ModelContainerSetter.js', source: 'export const set = () => undefined;' },
]);
`;

const compiledSnapshotRoot = (): string => {
    const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
    if (compiledSnapshot === undefined || !isAbsolute(compiledSnapshot)) {
        throw new Error('Server test runner did not provide an absolute compiled snapshot');
    }
    return compiledSnapshot;
};

const compiledEntrypoint = (): string => join(compiledSnapshotRoot(), 'model', 'service', 'ServiceExecutor.js');

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

const observeServiceExecutorFatalPath = async (): Promise<ServiceExecutorObservation> => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'epgstation-service-executor-fatal-'));
    const preludePath = join(temporaryDirectory, 'service-executor-fatal-prelude.mjs');
    let child: ChildProcess | undefined;
    let deadline: NodeJS.Timeout | undefined;

    try {
        await writeFile(preludePath, serviceExecutorPrelude, 'utf8');
        const entrypoint = compiledEntrypoint();
        child = spawn(process.execPath, ['--import', pathToFileURL(preludePath).href, entrypoint], {
            cwd: dirname(entrypoint),
            env: { ...process.env, EPGSTATION_TEST_HARNESS_DIR: harnessDirectory() },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const close = waitForClose(child);
        const timeout = new Promise<never>((_, reject) => {
            deadline = setTimeout(() => reject(new Error('ServiceExecutor fatal-path child did not exit')), 2_000);
        });
        const observation = await Promise.race([close, timeout]);
        const records = observation.stdout.trim().split('\n');

        expect(records).toHaveLength(1);
        return {
            code: observation.code,
            ledger: (JSON.parse(records[0]) as { ledger: ServiceExecutorLedgerEntry[] }).ledger,
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

const entriesFor = (ledger: readonly ServiceExecutorLedgerEntry[], operation: string): ServiceExecutorLedgerEntry[] =>
    ledger.filter(entry => entry.operation === operation);

describe('service executor fatal path', () => {
    it('[SI-EXEC-1] records exactly one fatal log entry when IServiceServer.start throws synchronously', async () => {
        const observation = await observeServiceExecutorFatalPath();

        expect(entriesFor(observation.ledger, 'service-server-start')).toHaveLength(1);
        expect(entriesFor(observation.ledger, 'fatal-log')).toHaveLength(1);
    });

    it('[SI-EXEC-2] exits the real child process with code 1 on the fatal path', async () => {
        const observation = await observeServiceExecutorFatalPath();

        expect(observation.code).toBe(1);
        expect(entriesFor(observation.ledger, 'process.exit')).toEqual([{ detail: 1, operation: 'process.exit' }]);
    });
});
