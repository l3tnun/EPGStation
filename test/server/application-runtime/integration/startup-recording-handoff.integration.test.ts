import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('Server test runner did not provide its compiled snapshot');

const temporaryDirectories = new Set<string>();

type StartupOutcome = 'deferred-reject' | 'reject' | 'resolve';

/** The directory holding the shared child-side loader hooks. */
const harnessDirectory = (): string => fileURLToPath(new URL('../../harness/', import.meta.url));

const entrypointPreload = (cleanup: StartupOutcome, rebuild: StartupOutcome): string => `
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const compiledRoot = path.dirname(process.argv[1]);
const StartupContinuationCoordinator = (await import(pathToFileURL(path.join(compiledRoot, 'model', 'workflow', 'StartupContinuationCoordinator.js')).href)).default;
const calls = [];
const record = name => calls.push(name);
const logger = {
    system: {
        debug: () => undefined,
        error: () => undefined,
        fatal: (...args) =>
            record(\`fatal:\${args.map(arg => (arg instanceof Error ? arg.message : String(arg))).join(' | ')}\`),
        info: () => undefined,
        warn: () => undefined,
    },
    stream: { debug: () => undefined, error: () => undefined, fatal: () => undefined, info: () => undefined, warn: () => undefined },
};
const child = new EventEmitter();
child.pid = 721;
child.stderr = null;
child.stdout = null;
const recording = {
    cleanup: async () => {
        record('recording.cleanup');
        ${
            cleanup === 'resolve'
                ? ''
                : cleanup === 'reject'
                  ? "throw new Error('synthetic recording cleanup failure');"
                  : "await Promise.resolve(); throw new Error('synthetic recording cleanup failure');"
        }
    },
    rebuildCandidatesAndStart: async () => {
        record('recording.rebuild');
        ${
            rebuild === 'resolve'
                ? ''
                : rebuild === 'reject'
                  ? "throw new Error('synthetic recording rebuild failure');"
                  : "await Promise.resolve(); throw new Error('synthetic recording rebuild failure');"
        }
    },
    setTuner: () => record('recording.setTuner'),
};
const services = {
    IConnectionCheckModel: { checkDB: async () => record('connection.checkDB'), checkMirakurun: async () => record('connection.checkMirakurun') },
    IConfiguration: { getConfig: () => ({}) },
    IEPGUpdateExecutorManageModel: { execute: () => record('epg.execute') },
    IEventSetter: { set: () => record('events.set') },
    IIPCServer: { initialize: async () => record('ipc.initialize'), register: () => record('ipc.register') },
    ILoggerModel: { getLogger: () => logger, initialize: () => record('logger.initialize') },
    IRecordingManageModel: recording,
    IReservationManageModel: { cleanup: async () => record('reservation.cleanup'), setTuners: () => record('reservation.setTuners') },
    IRuntimeStartupWorkflowPort: new StartupContinuationCoordinator(),
    IStorageManageModel: { start: () => record('storage.start') },
    TunerServerAccess: { getTuners: async () => (record('tuner.getTuners'), []) },
};
const container = { get: key => services[key] };
// 置き換えは entrypoint 自身の module graph の中で評価されるため、ここから渡したいものは
// globalThis を経由する。
globalThis.__epgstationChildOverrides = {
    container,
    onContainerSet: () => record('container.set'),
    spawnService: () => (record('service.spawn'), child),
};
const spawnSource = 'export const spawn = (...a) => globalThis.__epgstationChildOverrides.spawnService(...a); export default { spawn };';
const sourceMapSupportSource = 'export const install = () => undefined; export default { install };';
const setterSource = 'export const set = () => globalThis.__epgstationChildOverrides.onContainerSet();';
const { registerOverrides } = await import(pathToFileURL(process.env.EPGSTATION_TEST_HARNESS_DIR + '/child-module-overrides.mjs').href);
registerOverrides([
    { specifier: 'node:child_process', source: spawnSource },
    { specifier: 'child_process', source: spawnSource },
    { specifier: 'reflect-metadata', source: 'export default {};' },
    { specifier: 'source-map-support', source: sourceMapSupportSource },
    { specifier: './model/ModelContainer.js', source: 'export default globalThis.__epgstationChildOverrides.container;' },
    { specifier: './model/ModelContainerSetter.js', source: setterSource },
]);
process.once('unhandledRejection', () => record('runtime.failure'));
const originalExit = process.exit.bind(process);
process.exit = code => {
    record('process.exit');
    return originalExit(code);
};
process.once('beforeExit', () => process.stdout.write(JSON.stringify({ calls }) + '\\n'));
`;

const runCompiledEntrypoint = async ({
    cleanup = 'resolve',
    rebuild = 'resolve',
}: {
    cleanup?: StartupOutcome;
    rebuild?: StartupOutcome;
} = {}): Promise<string[]> => {
    const directory = await mkdtemp(join(tmpdir(), 'epgstation-startup-handoff-'));
    temporaryDirectories.add(directory);
    const preload = join(directory, 'entrypoint-preload.mjs');
    await writeFile(preload, entrypointPreload(cleanup, rebuild), 'utf8');

    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, join(compiledSnapshot, 'index.js')], {
            env: { ...process.env, EPGSTATION_TEST_HARNESS_DIR: harnessDirectory() },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        let stdout = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => (stdout += chunk));
        child.stderr.on('data', (chunk: string) => (stderr += chunk));
        child.once('error', reject);
        child.once('close', code => {
            try {
                resolve((JSON.parse(stdout) as { calls: string[] }).calls);
            } catch (error) {
                reject(new Error(`Compiled startup handoff exited with ${code}: ${stderr}`, { cause: error }));
            }
        });
    });
};

afterEach(async () => {
    await Promise.all([...temporaryDirectories].map(directory => rm(directory, { force: true, recursive: true })));
    temporaryDirectories.clear();
});

describe('startup recording handoff', () => {
    it('[Task 7.3] awaits one candidate rebuild after recording cleanup and before reservation cleanup', async () => {
        const calls = await runCompiledEntrypoint();

        expect(calls.indexOf('recording.cleanup')).toBeLessThan(calls.indexOf('recording.rebuild'));
        expect(calls.indexOf('recording.rebuild')).toBeLessThan(calls.indexOf('reservation.cleanup'));
        expect(calls.filter(call => call === 'recording.rebuild')).toHaveLength(1);
        expect(calls).toContain('epg.execute');
    });

    it.each(['reject', 'deferred-reject'] as const)(
        '[Task 7.3] leaves reservation cleanup and EPG at zero when candidate rebuild %s',
        async rebuild => {
            const calls = await runCompiledEntrypoint({ rebuild });

            expect(calls.filter(call => call === 'recording.cleanup')).toHaveLength(1);
            expect(calls.filter(call => call === 'recording.rebuild')).toHaveLength(1);
            expect(calls).not.toContain('reservation.cleanup');
            expect(calls).not.toContain('epg.execute');

            // The typed `Failed` outcome fulfils (never rejects), so Runtime must record it
            // through the existing fatal path itself instead of relying on an unhandledRejection.
            const fatalRecords = calls.filter(call => call.startsWith('fatal:'));
            expect(fatalRecords).toHaveLength(1);
            expect(fatalRecords[0]).toContain('recording-candidates-and-start');
            expect(fatalRecords[0]).toContain('synthetic recording rebuild failure');

            // server-workflow-coordination Requirement 7.11: the Workflow-owned continuation records
            // this failure locally rather than leaking it as a process-wide unhandled rejection.
            expect(calls.filter(call => call === 'runtime.failure')).toHaveLength(0);
            // Requirement 2.7 / 6.7: the record alone must not exit, restart, or retry.
            expect(calls.filter(call => call === 'process.exit')).toHaveLength(0);
            expect(calls.filter(call => call === 'service.spawn')).toHaveLength(1);
        },
    );
});
