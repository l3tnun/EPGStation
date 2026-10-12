import { access, chmod } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { spawnCompiledChildScenario, type ChildHarnessCleanupEvidence } from '../harness/child-process.js';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required');
}

const reflectMetadataPath = require.resolve('reflect-metadata');
const loggerModelPath = join(compiledSnapshot, 'model', 'LoggerModel.js');
const epgUpdateExecutorManageModelPath = join(
    compiledSnapshot,
    'model',
    'epgUpdater',
    'EPGUpdateExecutorManageModel.js',
);
const encoderModelPath = join(compiledSnapshot, 'model', 'service', 'encode', 'EncoderModel.js');
const liveStreamModelPath = join(compiledSnapshot, 'model', 'service', 'stream', 'LiveStreamModel.js');
const log4jsPath = require.resolve('log4js');
const businessReachedSentinel = 'BUSINESS_REACHED';
const resultPrefix = 'SCENARIO_RESULT:';
const roles = ['Operator', 'Service', 'EPGUpdater'] as const;
const operatorDefaultScreenMarker = 'OPERATOR_DEFAULT_SCREEN_MARKER';
const fatalRecordPrefix = 'SYSTEM_FATAL_RECORD:';
const controlledObserverMarker = 'CONTROLLED_OBSERVER_CALLBACK';

type Role = (typeof roles)[number];

const observerEntrypoints: Record<Role, string> = {
    Operator: join(compiledSnapshot, 'index.js'),
    Service: join(compiledSnapshot, 'model', 'service', 'ServiceExecutor.js'),
    EPGUpdater: join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdateExecutor.js'),
};

/**
 * These compiled entrypoints (and `EncodeProcessManageModel.js`-style modules elsewhere) are ES
 * modules, so a static `import * as child_process from 'child_process'` or `import container from
 * './model/ModelContainer.js'` resolves its binding once, at that module's own load time. A CJS
 * `Module._load` monkeypatch (the pre-migration approach originally used by every scenario source
 * below) only intercepts `require()` calls; it never sees a static ESM import, including one
 * reached via `require(esm)` interop from this suite's own compiled `.cjs` entrypoint (confirmed,
 * not assumed: with the `Module._load` approach, `EPGUpdateExecutorManageModel`'s real
 * `child_process.spawn` still ran, and `index.js`'s real `ModelContainerSetter`/`ModelContainer`
 * still wired a real `Configuration`, which then failed on the compiled snapshot's absent
 * `config.yml`). A registered loader hook sits below both `require()` and `import()` and lets the
 * specifier itself resolve to a shim regardless of how the importing module is reached, so these
 * scenarios use it instead -- the same hook module already used by
 * `test/server/media-process-management/implementation.test.ts` and
 * `test/server/application-runtime/integration/startup-recording-handoff.integration.test.ts`.
 * `./model/ModelContainer.js` and `./model/ModelContainerSetter.js` are relative specifiers, so the
 * exact string each entrypoint imports depends on that entrypoint's own directory relative to
 * `ModelContainer.js`/`ModelContainerSetter.js` (both live at the compiled snapshot's `model/`
 * root): `index.js` (at the snapshot root) imports `./model/ModelContainer.js`, while
 * `ServiceExecutor.js` and `EPGUpdateExecutor.js` (one directory below `model/`) both import
 * `../ModelContainer.js`.
 */
const childModuleOverridesPath = join(process.cwd(), 'test', 'server', 'harness', 'child-module-overrides.mjs');
const containerSpecifiersByRole: Record<Role, { readonly container: string; readonly setter: string }> = {
    Operator: { container: './model/ModelContainer.js', setter: './model/ModelContainerSetter.js' },
    Service: { container: '../ModelContainer.js', setter: '../ModelContainerSetter.js' },
    EPGUpdater: { container: '../ModelContainer.js', setter: '../ModelContainerSetter.js' },
};

interface FailureScenario {
    readonly expectedStderr?: string;
    readonly name: string;
    readonly operation: string;
}

const failureScenarios: readonly FailureScenario[] = [
    {
        name: 'missing configuration file',
        expectedStderr: 'log file is not found',
        operation: `
const target = join(__dirname, 'missing-log-config.yml');
new LoggerModel().initialize(target);`,
    },
    {
        name: 'configuration path that is a directory',
        operation: `
const target = join(__dirname, 'log-config-directory');
mkdirSync(target);
new LoggerModel().initialize(target);`,
    },
    {
        name: 'invalid YAML configuration',
        expectedStderr: 'log file parse error',
        operation: `
const target = join(__dirname, 'invalid-log-config.yml');
writeFileSync(target, 'categories: [', 'utf8');
new LoggerModel().initialize(target);`,
    },
    {
        name: 'logger access before initialization',
        expectedStderr: 'Logger is not initialized',
        operation: 'new LoggerModel().getLogger();',
    },
];

const childSource = (operation: string): string => `
require(${JSON.stringify(reflectMetadataPath)});
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const LoggerModel = require(${JSON.stringify(loggerModelPath)}).default;
${operation}
process.stdout.write(${JSON.stringify(`${businessReachedSentinel}\n`)});
`;

const childSupportSource = `
require(${JSON.stringify(reflectMetadataPath)});
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const log4js = require(${JSON.stringify(log4jsPath)});
const LoggerModel = require(${JSON.stringify(loggerModelPath)}).default;

const createConfiguration = (filename: string): object => ({
    appenders: {
        role: { type: 'file', filename },
    },
    categories: {
        default: { appenders: ['role'], level: 'info' },
        system: { appenders: ['role'], level: 'info' },
        access: { appenders: ['role'], level: 'info' },
        stream: { appenders: ['role'], level: 'info' },
        encode: { appenders: ['role'], level: 'info' },
    },
});
const writeConfiguration = (configPath: string, filename: string): void => {
    writeFileSync(configPath, JSON.stringify(createConfiguration(filename)), 'utf8');
};
const waitForMarker = async (filename: string, marker: string): Promise<void> => {
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
        if (readFileSync(filename, 'utf8').includes(marker)) {
            return;
        }
        // Poll interval for the real condition (marker written to file) checked above; not a
        // fixed wait-then-assume delay.
        await new Promise<void>(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for marker: ' + marker);
};
const drainStdout = (): Promise<void> =>
    new Promise((resolve, reject) => {
        process.stdout.write('', (error: Error | null | undefined) => {
            if (error === undefined || error === null) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
const shutdownLogging = (): Promise<void> =>
    new Promise((resolve, reject) => {
        log4js.shutdown((error: Error | null | undefined) => {
            if (error === undefined || error === null) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
`;

const roleScenarioSource = (role: Role): string => `
${childSupportSource}
const main = async (): Promise<void> => {
    const roles = ${JSON.stringify(roles)};
    const selectedRole: string = ${JSON.stringify(role)};
    const logPaths = Object.fromEntries(
        roles.map((candidate: string) => [candidate, join(__dirname, candidate + '.log')]),
    ) as Record<string, string>;
    for (const filename of Object.values(logPaths)) {
        writeFileSync(filename, '', 'utf8');
    }
    const configPath = join(__dirname, selectedRole + '.yml');
    writeConfiguration(configPath, logPaths[selectedRole]);
    const model = new LoggerModel();
    if (selectedRole === 'Operator') {
        model.initialize();
        model.getLogger().system.info(${JSON.stringify(operatorDefaultScreenMarker)});
        await drainStdout();
    }
    model.initialize(configPath);
    const roleMarker = selectedRole + '_ROLE_MARKER';
    model.getLogger().system.info(roleMarker);
    await waitForMarker(logPaths[selectedRole], roleMarker);
    await shutdownLogging();
    const contents = Object.fromEntries(
        roles.map((candidate: string) => [candidate, readFileSync(logPaths[candidate], 'utf8')]),
    );
    process.stdout.write(${JSON.stringify(resultPrefix)} + JSON.stringify({ contents, roleMarker }) + '\\n');
};
void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
`;

const entrypointInitializationScenarioSource = (role: Role): string => `
require(${JSON.stringify(reflectMetadataPath)});
import { EventEmitter } from 'node:events';
const originalExit = process.exit.bind(process);
const initializationPaths: Array<string | null> = [];
const loggerModel = {
    initialize: (filePath?: string): void => { initializationPaths.push(filePath ?? null); },
    getLogger: () => ({ system: {
        error: (): void => undefined,
        fatal: (): void => undefined,
        info: (): void => undefined,
    } }),
};
const pending = new Promise<void>(() => undefined);
const noOperation = (): void => undefined;
const container = { get: (key: string): unknown => {
    switch (key) {
        case 'ILoggerModel': return loggerModel;
        case 'IConfiguration': return { getConfig: () => ({ gid: process.getgid?.(), uid: process.getuid?.() }) };
        case 'IConnectionCheckModel': return { checkMirakurun: async (): Promise<void> => undefined, checkDB: async (): Promise<void> => undefined };
        case 'TunerServerAccess': return { getTuners: async (): Promise<unknown[]> => [] };
        case 'IEventSetter': return { set: noOperation };
        case 'IReservationManageModel': return { cleanup: async (): Promise<void> => undefined, setTuners: noOperation };
        case 'IRecordingManageModel': return { cleanup: async (): Promise<void> => undefined, setTuner: noOperation };
        case 'IStorageManageModel': return { start: noOperation };
        case 'IIPCServer': return { register: noOperation };
        case 'IEPGUpdateExecutorManageModel': return { execute: noOperation };
        case 'IEncodeFinishModel': return { set: noOperation };
        case 'IServiceServer': return { start: noOperation };
        case 'IEPGUpdater': return { start: () => pending };
        default: return {};
    }
} };
(globalThis as any).__epgstationRoleContainer = container;
(globalThis as any).__epgstationRoleSpawn = (): unknown => Object.assign(new EventEmitter(), {
    pid: 49301,
    stderr: null,
    stdout: null,
});
${
    role === 'EPGUpdater'
        ? // EPGUpdateExecutor.js has no 'require.main === module' guard (it compares
          // process.argv[1] against import.meta.url, since ESM has no require.main at all);
          // the older rationale -- that registering ANY loader
          // hook (module.register(), and now module.registerHooks()) disables Node's
          // require(esm) synthetic-CJS-global shim process-wide, breaking that guard -- does not
          // reproduce (re-verified on Node 24 and 26: require()'ing the compiled
          // EPGUpdateExecutor.js succeeds identically with no hook, module.register(), and
          // module.registerHooks() registered). This role still skips registerOverrides() and
          // instead uses runEPGUpdateExecutor's own container-injection seam (see
          // 'test/server/program-guide/epg-update-executor-entry-seam.test.ts', an already-passing
          // sibling use of this same seam) to supply the fake container directly, without ever
          // needing to intercept './model/ModelContainer.js' or './model/ModelContainerSetter.js'.
          ''
        : `const { registerOverrides } = require(${JSON.stringify(childModuleOverridesPath)});
registerOverrides([
    {
        specifier: ${JSON.stringify(containerSpecifiersByRole[role].setter)},
        source: 'export const set = () => undefined;',
    },
    {
        specifier: ${JSON.stringify(containerSpecifiersByRole[role].container)},
        source: 'export default globalThis.__epgstationRoleContainer;',
    },
    {
        parentURL: ${JSON.stringify(pathToFileURL(observerEntrypoints[role]).href)},
        specifier: 'child_process',
        source: [
            "import * as realChildProcess from 'node:child_process';",
            "export * from 'node:child_process';",
            'export const spawn = (...args) => globalThis.__epgstationRoleSpawn(...args);',
            'export default { ...realChildProcess, spawn: (...args) => globalThis.__epgstationRoleSpawn(...args) };',
        ].join('\\n'),
    },
    {
        parentURL: ${JSON.stringify(pathToFileURL(observerEntrypoints[role]).href)},
        specifier: 'node:child_process',
        source: [
            "import * as realChildProcess from 'node:child_process';",
            "export * from 'node:child_process';",
            'export const spawn = (...args) => globalThis.__epgstationRoleSpawn(...args);',
            'export default { ...realChildProcess, spawn: (...args) => globalThis.__epgstationRoleSpawn(...args) };',
        ].join('\\n'),
    },
]);`
}
const main = async (): Promise<void> => {
    // EPGUpdateExecutor is side-effect free on import (its argv/import.meta.url self-run guard).
    // Production starts via node EPGUpdateExecutor.js (main) or the exported runner;
    // a non-main require alone never initializes the logger. Mirror production by calling
    // the exported runner with an explicit fake container (see the registerOverrides()-skip
    // note above).
    const entry = require(${JSON.stringify(observerEntrypoints[role])});
    ${role === 'EPGUpdater' ? 'entry.runEPGUpdateExecutor({ container });' : ''}
    const expectedCount = ${role === 'Operator' ? 2 : 1};
    for (let turn = 0; turn < 50 && initializationPaths.length < expectedCount; turn += 1) {
        await new Promise<void>(resolve => setImmediate(resolve));
    }
    if (initializationPaths.length !== expectedCount) {
        throw new Error('Unexpected initialization count: ' + initializationPaths.length);
    }
    process.stdout.write(
        ${JSON.stringify(resultPrefix)} + JSON.stringify({ initializationPaths, role: ${JSON.stringify(role)} }) + '\\n',
        () => originalExit(0),
    );
};
void main().catch((error: unknown) => { console.error(error); originalExit(2); });
`;

const reinitializationScenarioSource = `
${childSupportSource}
const main = async (): Promise<void> => {
    const initialPath = join(__dirname, 'initial-role.log');
    const nextPath = join(__dirname, 'next-role.log');
    const configPath = join(__dirname, 'role.yml');
    writeFileSync(initialPath, '', 'utf8');
    writeFileSync(nextPath, '', 'utf8');
    writeConfiguration(configPath, initialPath);

    const model = new LoggerModel();
    model.initialize(configPath);
    const beforeEditMarker = 'BEFORE_CONFIG_EDIT_MARKER';
    const afterEditMarker = 'AFTER_CONFIG_EDIT_MARKER';
    const nextInitializeMarker = 'NEXT_INITIALIZE_MARKER';
    model.getLogger().system.info(beforeEditMarker);
    await waitForMarker(initialPath, beforeEditMarker);

    writeConfiguration(configPath, nextPath);
    model.getLogger().system.info(afterEditMarker);
    await waitForMarker(initialPath, afterEditMarker);
    const nextBeforeExplicitInitialize = readFileSync(nextPath, 'utf8');

    model.initialize(configPath);
    model.getLogger().system.info(nextInitializeMarker);
    await waitForMarker(nextPath, nextInitializeMarker);
    await shutdownLogging();
    process.stdout.write(
        ${JSON.stringify(resultPrefix)} +
            JSON.stringify({
                afterEditMarker,
                beforeEditMarker,
                initialContents: readFileSync(initialPath, 'utf8'),
                nextBeforeExplicitInitialize,
                nextContents: readFileSync(nextPath, 'utf8'),
                nextInitializeMarker,
            }) +
            '\\n',
    );
};
void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
`;

const purposeProducerScenarioSource = `
${childSupportSource}
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const EncoderModel = require(${JSON.stringify(encoderModelPath)}).default;
const LiveStreamModel = require(${JSON.stringify(liveStreamModelPath)}).default;
const main = async (): Promise<void> => {
    const systemPath = join(__dirname, 'service-system.log');
    const encodePath = join(__dirname, 'service-encode.log');
    const streamPath = join(__dirname, 'service-stream.log');
    const configPath = join(__dirname, 'service-purpose-loggers.yml');
    for (const filename of [systemPath, encodePath, streamPath]) {
        writeFileSync(filename, '', 'utf8');
    }
    writeFileSync(
        configPath,
        JSON.stringify({
            appenders: {
                systemDestination: { type: 'file', filename: systemPath },
                encodeDestination: { type: 'file', filename: encodePath },
                streamDestination: { type: 'file', filename: streamPath },
            },
            categories: {
                default: { appenders: ['systemDestination'], level: 'info' },
                system: { appenders: ['systemDestination'], level: 'info' },
                access: { appenders: ['systemDestination'], level: 'info' },
                encode: { appenders: ['encodeDestination'], level: 'warn' },
                stream: { appenders: ['streamDestination'], level: 'info' },
            },
        }),
        'utf8',
    );
    const loggerModel = new LoggerModel();
    loggerModel.initialize(configPath);
    const encodeOption = {
        encodeId: 73,
        mode: 'synthetic-mode',
        parentDir: 'recorded',
        recordedId: 2,
        removeOriginal: false,
        sourceVideoFileId: 1,
    };
    const encodeStdout = new PassThrough();
    const encodeChild = Object.assign(new EventEmitter(), {
        exitCode: null,
        kill: (): boolean => true,
        pid: 73,
        signalCode: null,
        stderr: null,
        stdin: null,
        stdout: encodeStdout,
    });
    const encodeHandle = Object.freeze({});
    const encoder = new EncoderModel(
        loggerModel,
        {
            getConfig: () => ({
                encode: [{ cmd: 'synthetic-command', name: 'synthetic-mode', rate: 1 }],
                ffmpeg: 'synthetic-ffmpeg',
                ffprobe: 'synthetic-ffprobe',
            }),
        },
        {
            create: async (): Promise<unknown> => encodeChild,
            createManaged: async (): Promise<unknown> => ({ child: encodeChild, handle: encodeHandle }),
            requestStop: async (): Promise<unknown> => ({ status: 'requested', sentSignals: ['SIGINT'] }),
        },
        {},
        { findId: async (): Promise<object> => ({ id: 1 }) },
        {
            findId: async (): Promise<object> => ({
                channelId: 5,
                duration: 3_600_000,
                endAt: 3_600_000,
                halfWidthName: 'synthetic-program',
                id: 2,
                name: 'synthetic-program',
                startAt: 0,
            }),
        },
        {
            findId: async (): Promise<object> => ({
                halfWidthName: 'synthetic-channel',
                name: 'synthetic-channel',
            }),
        },
        {
            getFullFilePathFromId: async (): Promise<string> => ${JSON.stringify(loggerModelPath)},
            getInfo: async (): Promise<object> => ({}),
            getParentDirPath: (): null => null,
        },
        { emitUpdateEncodeProgress: (): void => undefined },
        {},
    );
    const encodeFinish = new Promise<{ isError: boolean; outputFilePath: string | null }>(resolve => {
        encoder.setOnFinish((isError: boolean, outputFilePath: string | null): void => {
            resolve({ isError, outputFilePath });
        });
    });
    encoder.setOption(encodeOption);
    await encoder.start();
    encodeStdout.write(
        JSON.stringify({
            log: 'SERVICE_PROGRESS_FILTERED_MARKER',
            percent: 25,
            type: 'progress',
        }) + '\\n',
    );
    encodeChild.emit('exit', 17, null);
    const encodeFinishOutcome = await encodeFinish;
    encodeStdout.destroy();
    if (encodeFinishOutcome.isError !== true || encodeFinishOutcome.outputFilePath !== null) {
        throw new Error('The encode producer changed the nonzero-exit finish outcome');
    }

    const acquisitionFailure = new Error('synthetic service-stream acquisition failure');
    const tunerServerAccess = {
        openServiceStream: async (): Promise<never> => {
            throw acquisitionFailure;
        },
    };
    const liveStream = new LiveStreamModel(
        {
            getConfig: () => ({
                ffmpeg: 'synthetic-ffmpeg',
                streamFilePath: 'synthetic-stream-files',
                streamingPriority: 7,
            }),
        },
        loggerModel,
        {},
        {},
        tunerServerAccess,
        {},
    );
    liveStream.setOption({ channelId: 123 }, 0);
    let receivedFailure: unknown;
    try {
        await liveStream.start(4);
    } catch (error: unknown) {
        receivedFailure = error;
    }
    if (receivedFailure !== acquisitionFailure) {
        throw new Error('The delivery producer changed the rejection identity');
    }

    await waitForMarker(encodePath, 'encode failed: 73 null');
    await waitForMarker(streamPath, 'get mirakurun service stream failed: 123');
    await shutdownLogging();
    process.stdout.write(
        ${JSON.stringify(resultPrefix)} +
            JSON.stringify({
                encodeContents: readFileSync(encodePath, 'utf8'),
                streamContents: readFileSync(streamPath, 'utf8'),
                systemContents: readFileSync(systemPath, 'utf8'),
            }) +
            '\\n',
    );
};
void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
`;

const permissionDeniedConfigurationSource = `
require(${JSON.stringify(reflectMetadataPath)});
const { chmodSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const LoggerModel = require(${JSON.stringify(loggerModelPath)}).default;
const blockedDirectory = join(__dirname, 'read-only-log-directory');
const blockedLogPath = join(blockedDirectory, 'blocked.log');
const configPath = join(__dirname, 'permission-denied.yml');
mkdirSync(blockedDirectory);
writeFileSync(
    configPath,
    JSON.stringify({
        appenders: {
            blocked: { type: 'file', filename: blockedLogPath },
        },
        categories: {
            default: { appenders: ['blocked'], level: 'info' },
            system: { appenders: ['blocked'], level: 'info' },
        },
    }),
    'utf8',
);
chmodSync(configPath, 0o644);
chmodSync(blockedDirectory, 0o555);
if (
    typeof process.getuid === 'function' &&
    typeof process.setgid === 'function' &&
    typeof process.setuid === 'function' &&
    process.getuid() === 0
) {
    chmodSync(__dirname, 0o755);
    process.setgid(65534);
    process.setuid(65534);
}
new LoggerModel().initialize(configPath);
process.stdout.write(${JSON.stringify(`${businessReachedSentinel}\n`)});
`;

const processObserverScenarioSource = (role: Role): string => `
require(${JSON.stringify(reflectMetadataPath)});
const originalExit = process.exit.bind(process);
const mutableProcess = process as any;
const effects = {
    cleanup: 0,
    exitCodes: [] as Array<number | string | null | undefined>,
    intakeStop: 0,
    restart: 0,
    signals: 0,
};
const fatalRecords: Array<{ category: string; level: string; value: string }> = [];
const renderFatal = (value: unknown): string => value instanceof Error ? value.toString() : String(value);
const loggerModel = {
    initialize: (): void => undefined,
    getLogger: () => ({
        system: {
            fatal: (value: unknown): void => {
                const record = { category: 'system', level: 'fatal', value: renderFatal(value) };
                fatalRecords.push(record);
                process.stdout.write(${JSON.stringify(fatalRecordPrefix)} + JSON.stringify(record) + '\\n');
            },
            info: (): void => undefined,
        },
    }),
};
const pending = new Promise<void>(() => undefined);
const container = {
    get: (key: string): unknown => {
        switch (key) {
            case 'ILoggerModel':
                return loggerModel;
            case 'IConfiguration':
                return {
                    getConfig: () => ({
                        gid: typeof process.getgid === 'function' ? process.getgid() : undefined,
                        uid: typeof process.getuid === 'function' ? process.getuid() : undefined,
                    }),
                };
            case 'IConnectionCheckModel':
                return { checkMirakurun: () => pending, checkDB: () => pending };
            case 'IEncodeFinishModel':
                return { set: (): void => undefined };
            case 'IServiceServer':
                return {
                    start: (): void => undefined,
                    stop: (): void => { effects.intakeStop += 1; },
                };
            case 'IEPGUpdater':
                return { start: () => pending };
            case 'IReservationManageModel':
            case 'IRecordingManageModel':
                return { cleanup: (): void => { effects.cleanup += 1; } };
            case 'IEPGUpdateExecutorManageModel':
                return { execute: (): void => { effects.restart += 1; } };
            default:
                return {};
        }
    },
};
mutableProcess.exit = (code?: number | string | null): void => {
    effects.exitCodes.push(code);
};
mutableProcess.kill = (): boolean => {
    effects.signals += 1;
    return true;
};
(globalThis as any).__epgstationObserverContainer = container;
(globalThis as any).__epgstationObserverSpawn = (): never => {
    effects.restart += 1;
    throw new Error('Synthetic observer scenario forbids child spawn');
};
${
    role === 'EPGUpdater'
        ? // See entrypointInitializationScenarioSource's identical note: EPGUpdateExecutor.js no
          // longer has a require.main-based guard, so this role still skips registerOverrides()
          // and instead passes the fake container straight into runEPGUpdateExecutor() below.
          ''
        : `const { registerOverrides } = require(${JSON.stringify(childModuleOverridesPath)});
registerOverrides([
    {
        specifier: ${JSON.stringify(containerSpecifiersByRole[role].setter)},
        source: 'export const set = () => undefined;',
    },
    {
        specifier: ${JSON.stringify(containerSpecifiersByRole[role].container)},
        source: 'export default globalThis.__epgstationObserverContainer;',
    },
    {
        parentURL: ${JSON.stringify(pathToFileURL(observerEntrypoints[role]).href)},
        specifier: 'child_process',
        source: [
            "import * as realChildProcess from 'node:child_process';",
            "export * from 'node:child_process';",
            'export const spawn = (...args) => globalThis.__epgstationObserverSpawn(...args);',
            'export default { ...realChildProcess, spawn: (...args) => globalThis.__epgstationObserverSpawn(...args) };',
        ].join('\\n'),
    },
    {
        parentURL: ${JSON.stringify(pathToFileURL(observerEntrypoints[role]).href)},
        specifier: 'node:child_process',
        source: [
            "import * as realChildProcess from 'node:child_process';",
            "export * from 'node:child_process';",
            'export const spawn = (...args) => globalThis.__epgstationObserverSpawn(...args);',
            'export default { ...realChildProcess, spawn: (...args) => globalThis.__epgstationObserverSpawn(...args) };',
        ].join('\\n'),
    },
]);`
}

const waitForFatalRecords = async (expected: number): Promise<void> => {
    const deadline = Date.now() + 1_000;
    while (fatalRecords.length < expected && Date.now() < deadline) {
        // Poll interval for the real condition (fatalRecords.length) checked above; not a
        // fixed wait-then-assume delay.
        await new Promise<void>(resolve => setTimeout(resolve, 10));
    }
    if (fatalRecords.length !== expected) {
        throw new Error('Unexpected fatal record count: ' + fatalRecords.length);
    }
};
const main = async (): Promise<void> => {
    // EPGUpdateExecutor registers fatal observers only inside runEPGUpdateExecutor().
    // A plain require() alone never invokes it (its argv/import.meta.url guard only runs
    // it when launched as the entry script), so call the exported runner for the EPGUpdater
    // role with an explicit fake container (see the registerOverrides()-skip note above).
    const entry = require(${JSON.stringify(observerEntrypoints[role])});
    ${role === 'EPGUpdater' ? 'entry.runEPGUpdateExecutor({ container });' : ''}
    const markers = {
        uncaughtException: 'UNCAUGHT_EXCEPTION_${role}',
        unhandledRejection: 'UNHANDLED_REJECTION_${role}',
    };
    setImmediate(() => { throw new Error(markers.uncaughtException); });
    void Promise.reject(new Error(markers.unhandledRejection));
    await waitForFatalRecords(${role === 'Operator' ? 4 : 2});
    await new Promise<void>(resolve => setImmediate(resolve));
    const observerExitCode = process.exitCode ?? null;
    process.exitCode = 0;
    process.stdout.write(
        ${JSON.stringify(resultPrefix)} +
            JSON.stringify({
                controlledCallbacks: 1,
                effects: { ...effects, exitCode: observerExitCode },
                fatalRecords,
                markers,
                role: ${JSON.stringify(role)},
            }) +
            '\\n' +
            ${JSON.stringify(`${controlledObserverMarker}\n`)},
        () => originalExit(0),
    );
};
void main().catch((error: unknown) => {
    console.error(error);
    originalExit(2);
});
`;

const webSupervisorScenarioSource = (terminalEvent: 'error' | 'exit'): string => `
require(${JSON.stringify(reflectMetadataPath)});
import { EventEmitter } from 'node:events';
const originalExit = process.exit.bind(process);
let loggerCallActive = false;
const loggerOwnedEffects = { cleanup: 0, restart: 0, signal: 0, stop: 0, wait: 0 };
const records: Array<{ category: string; level: string; value: string }> = [];
const countIfLogging = (effect: keyof typeof loggerOwnedEffects): void => {
    if (loggerCallActive) loggerOwnedEffects[effect] += 1;
};
const record = (level: string, value: unknown): void => {
    loggerCallActive = true;
    records.push({ category: 'system', level, value: value instanceof Error ? value.toString() : String(value) });
    loggerCallActive = false;
};
const children: Array<InstanceType<typeof EventEmitter> & Record<string, unknown>> = [];
// The trailing 'as unknown as' cast below is required by the compileScenario harness's own
// TypeScript program (Node10 moduleResolution, strict) checking this source independently of the
// outer test file: Object.assign(new EventEmitter(), {...})'s inferred type is an intersection
// with a class instance, not a fresh object literal, so it never gets the implicit index
// signature that assignability to this function's declared InstanceType<typeof EventEmitter> &
// Record<string, unknown> return type needs. A direct 'as' cast is itself rejected (TS2352: the
// two types do not sufficiently overlap), hence the detour through 'unknown' the diagnostic
// itself names. The cast asserts the same type the function already declares; it changes no
// runtime behavior.
const createChild = (): InstanceType<typeof EventEmitter> & Record<string, unknown> => Object.assign(new EventEmitter(), {
    pid: 49001 + children.length,
    stderr: null,
    stdout: null,
    kill: (): boolean => { countIfLogging('signal'); return true; },
}) as unknown as InstanceType<typeof EventEmitter> & Record<string, unknown>;
const loggerModel = {
    initialize: (): void => undefined,
    getLogger: () => ({
        system: {
            error: (value: unknown): void => record('error', value),
            fatal: (value: unknown): void => record('fatal', value),
            info: (): void => undefined,
        },
    }),
};
const container = {
    get: (key: string): unknown => {
        switch (key) {
            case 'ILoggerModel': return loggerModel;
            case 'IConfiguration': return { getConfig: () => ({ gid: process.getgid?.(), uid: process.getuid?.() }) };
            case 'IConnectionCheckModel': return { checkMirakurun: async (): Promise<void> => undefined, checkDB: async (): Promise<void> => undefined };
            case 'TunerServerAccess': return { getTuners: async (): Promise<unknown[]> => [] };
            case 'IEventSetter': return { set: (): void => undefined };
            case 'IReservationManageModel': return {
                cleanup: async (): Promise<void> => { countIfLogging('cleanup'); },
                setTuners: (): void => undefined,
            };
            case 'IRecordingManageModel': return {
                cleanup: async (): Promise<void> => { countIfLogging('cleanup'); },
                setTuner: (): void => undefined,
            };
            case 'IStorageManageModel': return { start: (): void => undefined };
            // IIPCServer.initialize() is part of the port contract (IIPCServer.ts:5) and is
            // awaited by initializeIPC() before the Web supervisor spawns. A stub without it
            // rejects the startup IIFE, which the unhandledRejection handler installed in
            // init() swallows, so the supervisor never reaches its first spawn.
            case 'IIPCServer':
                return { initialize: async (): Promise<void> => undefined, register: (): void => undefined };
            // The startup workflow runs once the Service supervision is accepted, i.e. after the
            // Web spawn this scenario characterizes. Its outcome is reported through the same
            // fatal path, so an absent stub adds records the terminal classification does not own.
            case 'IRuntimeStartupWorkflowPort':
                return {
                    runAfterServiceSupervisionAccepted: async (): Promise<unknown> => ({
                        kind: 'Succeeded',
                        stage: 'epg-supervisor-start',
                    }),
                };
            case 'IEPGUpdateExecutorManageModel': return { execute: (): void => undefined };
            default: return {};
        }
    },
};
(globalThis as any).__epgstationWebContainer = container;
(globalThis as any).__epgstationWebSpawn = (): unknown => {
    countIfLogging('restart');
    const child = createChild();
    children.push(child);
    return child;
};
const { registerOverrides } = require(${JSON.stringify(childModuleOverridesPath)});
registerOverrides([
    {
        specifier: ${JSON.stringify(containerSpecifiersByRole.Operator.setter)},
        source: 'export const set = () => undefined;',
    },
    {
        specifier: ${JSON.stringify(containerSpecifiersByRole.Operator.container)},
        source: 'export default globalThis.__epgstationWebContainer;',
    },
    {
        parentURL: ${JSON.stringify(pathToFileURL(observerEntrypoints.Operator).href)},
        specifier: 'child_process',
        source: [
            "import * as realChildProcess from 'node:child_process';",
            "export * from 'node:child_process';",
            'export const spawn = (...args) => globalThis.__epgstationWebSpawn(...args);',
            'export default { ...realChildProcess, spawn: (...args) => globalThis.__epgstationWebSpawn(...args) };',
        ].join('\\n'),
    },
    {
        parentURL: ${JSON.stringify(pathToFileURL(observerEntrypoints.Operator).href)},
        specifier: 'node:child_process',
        source: [
            "import * as realChildProcess from 'node:child_process';",
            "export * from 'node:child_process';",
            'export const spawn = (...args) => globalThis.__epgstationWebSpawn(...args);',
            'export default { ...realChildProcess, spawn: (...args) => globalThis.__epgstationWebSpawn(...args) };',
        ].join('\\n'),
    },
]);
const waitForFirstChild = async (): Promise<void> => {
    for (let turn = 0; turn < 20 && children.length === 0; turn += 1) {
        await new Promise<void>(resolve => setImmediate(resolve));
    }
    if (children.length === 0) throw new Error('Web supervisor did not spawn its first child');
};
const main = async (): Promise<void> => {
    require(${JSON.stringify(observerEntrypoints.Operator)});
    await waitForFirstChild();
    const child = children[0];
    if (child === undefined) throw new Error('Missing first Web child');
    child.emit(
        ${JSON.stringify(terminalEvent)},
        ${terminalEvent === 'error' ? "new Error('SYNTHETIC_WEB_POST_SPAWN_ERROR')" : '0'},
        null,
    );
    process.stdout.write(
        ${JSON.stringify(resultPrefix)} + JSON.stringify({ loggerOwnedEffects, records }) + '\\n',
        () => originalExit(0),
    );
};
void main().catch((error: unknown) => {
    console.error(error);
    originalExit(2);
});
`;

type EpgTerminalEvent = 'close' | 'disconnect' | 'error' | 'exit';
const epgSupervisorScenarioSource = (terminalEvent: EpgTerminalEvent): string => `
require(${JSON.stringify(reflectMetadataPath)});
import { EventEmitter } from 'node:events';
const originalExit = process.exit.bind(process);
let loggerCallActive = false;
const loggerOwnedEffects = { cleanup: 0, restart: 0, signal: 0, stop: 0, wait: 0 };
const records: Array<{ category: string; level: string; value: string }> = [];
const countIfLogging = (effect: keyof typeof loggerOwnedEffects): void => {
    if (loggerCallActive) loggerOwnedEffects[effect] += 1;
};
const record = (level: string, value: unknown): void => {
    loggerCallActive = true;
    records.push({ category: 'system', level, value: value instanceof Error ? value.toString() : String(value) });
    loggerCallActive = false;
};
const children: Array<InstanceType<typeof EventEmitter> & Record<string, unknown>> = [];
// The trailing 'as unknown as' cast below is required by the compileScenario harness's own
// TypeScript program (Node10 moduleResolution, strict) checking this source independently of the
// outer test file: Object.assign(new EventEmitter(), {...})'s inferred type is an intersection
// with a class instance, not a fresh object literal, so it never gets the implicit index
// signature that assignability to this function's declared InstanceType<typeof EventEmitter> &
// Record<string, unknown> return type needs. A direct 'as' cast is itself rejected (TS2352: the
// two types do not sufficiently overlap), hence the detour through 'unknown' the diagnostic
// itself names. The cast asserts the same type the function already declares; it changes no
// runtime behavior.
const createChild = (): InstanceType<typeof EventEmitter> & Record<string, unknown> => Object.assign(new EventEmitter(), {
    pid: 49101 + children.length,
    stderr: null,
    stdout: null,
    kill: (): boolean => { countIfLogging('signal'); return true; },
}) as unknown as InstanceType<typeof EventEmitter> & Record<string, unknown>;
(globalThis as any).__epgstationEpgSpawn = (): unknown => {
    countIfLogging('restart');
    const child = createChild();
    children.push(child);
    return child;
};
const { registerOverrides } = require(${JSON.stringify(childModuleOverridesPath)});
registerOverrides([
    {
        parentURL: ${JSON.stringify(pathToFileURL(epgUpdateExecutorManageModelPath).href)},
        specifier: 'child_process',
        source: [
            "import * as realChildProcess from 'node:child_process';",
            "export * from 'node:child_process';",
            'export const spawn = (...args) => globalThis.__epgstationEpgSpawn(...args);',
            'export default { ...realChildProcess, spawn: (...args) => globalThis.__epgstationEpgSpawn(...args) };',
        ].join('\\n'),
    },
    {
        parentURL: ${JSON.stringify(pathToFileURL(epgUpdateExecutorManageModelPath).href)},
        specifier: 'node:child_process',
        source: [
            "import * as realChildProcess from 'node:child_process';",
            "export * from 'node:child_process';",
            'export const spawn = (...args) => globalThis.__epgstationEpgSpawn(...args);',
            'export default { ...realChildProcess, spawn: (...args) => globalThis.__epgstationEpgSpawn(...args) };',
        ].join('\\n'),
    },
]);
const loggerModel = {
    getLogger: () => ({
        system: {
            error: (value: unknown): void => record('error', value),
            fatal: (value: unknown): void => record('fatal', value),
            info: (): void => undefined,
        },
    }),
};
const main = async (): Promise<void> => {
    const Constructor = require(${JSON.stringify(epgUpdateExecutorManageModelPath)}).default;
    const manager = new Constructor(loggerModel, { emitUpdated: (): void => undefined });
    await manager.execute();
    const child = children[0];
    if (child === undefined) throw new Error('EPG supervisor did not spawn its first child');
    child.emit(
        ${JSON.stringify(terminalEvent)},
        ${terminalEvent === 'error' ? "new Error('SYNTHETIC_EPG_POST_SPAWN_ERROR')" : '0'},
        null,
    );
    process.stdout.write(
        ${JSON.stringify(resultPrefix)} + JSON.stringify({ loggerOwnedEffects, records }) + '\\n',
        () => originalExit(0),
    );
};
void main().catch((error: unknown) => {
    console.error(error);
    originalExit(2);
});
`;

const cleanupSession = async (
    session: Awaited<ReturnType<typeof spawnCompiledChildScenario>>,
): Promise<ChildHarnessCleanupEvidence> => {
    const evidence = await session.cleanup();
    await expect(access(session.tempDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(session.compiledEntrypoint)).rejects.toMatchObject({ code: 'ENOENT' });
    return evidence;
};

const parseScenarioResult = (stdout: string): Record<string, unknown> => {
    const resultLine = stdout.split('\n').find(line => line.startsWith(resultPrefix));
    if (resultLine === undefined) {
        throw new Error('The child did not report a scenario result');
    }
    return JSON.parse(resultLine.slice(resultPrefix.length)) as Record<string, unknown>;
};

const expectCleanedSession = (evidence: ChildHarnessCleanupEvidence | undefined): void => {
    expect(evidence).toEqual({
        remainingChildProcesses: 0,
        remainingListeners: 0,
        remainingTimers: 0,
        remainingTempResources: 0,
    });
};

describe('operational logging initialization process failures', () => {
    it.each(failureScenarios)('exits before business work for $name', async ({ expectedStderr, name, operation }) => {
        const session = await spawnCompiledChildScenario({
            name,
            source: childSource(operation),
        });

        let cleanupEvidence: ChildHarnessCleanupEvidence | undefined;
        try {
            await session.waitForClose();
        } finally {
            cleanupEvidence = await cleanupSession(session);
        }

        expect(session.events).toContainEqual(expect.objectContaining({ type: 'exit', code: 1, signal: null }));
        if (expectedStderr === undefined) {
            expect(session.stderr.trim()).not.toBe('');
        } else {
            expect(session.stderr).toContain(expectedStderr);
        }
        expect(session.stdout.split(businessReachedSentinel).length - 1).toBe(0);
        expectCleanedSession(cleanupEvidence);
    });
});

describe('operational logging role process configuration', () => {
    it.each(roles)('[OL-PROC-ROLE-ENTRYPOINT] loads real %s entrypoint path selection', async role => {
        const session = await spawnCompiledChildScenario({
            name: `${role}-compiled-entrypoint-log-selection`,
            source: entrypointInitializationScenarioSource(role),
        });
        let cleanupEvidence: ChildHarnessCleanupEvidence | undefined;
        try {
            await session.waitForClose();
        } finally {
            cleanupEvidence = await cleanupSession(session);
        }

        expect(session.events).toContainEqual(expect.objectContaining({ type: 'exit', code: 0, signal: null }));
        expect(session.stderr).toBe('');
        const result = parseScenarioResult(session.stdout) as {
            readonly initializationPaths: readonly (string | null)[];
            readonly role: Role;
        };
        const expectedConfiguredPath = join(
            compiledSnapshot,
            '..',
            'config',
            role === 'Operator'
                ? 'operatorLogConfig.yml'
                : role === 'Service'
                  ? 'serviceLogConfig.yml'
                  : 'epgUpdaterLogConfig.yml',
        );
        expect(result.role).toBe(role);
        expect(result.initializationPaths).toEqual(
            role === 'Operator' ? [null, expectedConfiguredPath] : [expectedConfiguredPath],
        );
        expectCleanedSession(cleanupEvidence);
    });

    it.each(roles)('keeps %s output isolated from the other role destinations', async role => {
        const session = await spawnCompiledChildScenario({
            name: `${role}-role-configuration`,
            source: roleScenarioSource(role),
        });

        let cleanupEvidence: ChildHarnessCleanupEvidence | undefined;
        try {
            await session.waitForClose();
        } finally {
            cleanupEvidence = await cleanupSession(session);
        }

        expect(session.events).toContainEqual(expect.objectContaining({ type: 'exit', code: 0, signal: null }));
        expect(session.stderr).toBe('');
        const result = parseScenarioResult(session.stdout) as {
            readonly contents: Record<Role, string>;
            readonly roleMarker: string;
        };
        expect(result.contents[role]).toContain(result.roleMarker);
        for (const otherRole of roles.filter(candidate => candidate !== role)) {
            expect(result.contents[otherRole]).toBe('');
        }
        if (role === 'Operator') {
            expect(session.stdout).toContain(operatorDefaultScreenMarker);
        } else {
            expect(session.stdout).not.toContain(operatorDefaultScreenMarker);
        }
        expectCleanedSession(cleanupEvidence);
    });

    it('[OL-PROC-REINITIALIZATION] keeps configuration until explicit initialization', async () => {
        const session = await spawnCompiledChildScenario({
            name: 'role-configuration-reinitialization',
            source: reinitializationScenarioSource,
        });

        let cleanupEvidence: ChildHarnessCleanupEvidence | undefined;
        try {
            await session.waitForClose();
        } finally {
            cleanupEvidence = await cleanupSession(session);
        }

        expect(session.events).toContainEqual(expect.objectContaining({ type: 'exit', code: 0, signal: null }));
        expect(session.stderr).toBe('');
        const result = parseScenarioResult(session.stdout) as {
            readonly afterEditMarker: string;
            readonly beforeEditMarker: string;
            readonly initialContents: string;
            readonly nextBeforeExplicitInitialize: string;
            readonly nextContents: string;
            readonly nextInitializeMarker: string;
        };
        expect(result.initialContents).toContain(result.beforeEditMarker);
        expect(result.initialContents).toContain(result.afterEditMarker);
        expect(result.initialContents).not.toContain(result.nextInitializeMarker);
        expect(result.nextBeforeExplicitInitialize).toBe('');
        expect(result.nextContents).toContain(result.nextInitializeMarker);
        expect(result.nextContents).not.toContain(result.beforeEditMarker);
        expect(result.nextContents).not.toContain(result.afterEditMarker);
        expectCleanedSession(cleanupEvidence);
    });
});

describe('operational logging purpose producer integration', () => {
    it('[OL-PROC-PURPOSE] routes Service encode and stream producers by category and level', async () => {
        const session = await spawnCompiledChildScenario({
            name: 'service-purpose-producers',
            source: purposeProducerScenarioSource,
        });

        let cleanupEvidence: ChildHarnessCleanupEvidence | undefined;
        try {
            await session.waitForClose();
        } finally {
            cleanupEvidence = await cleanupSession(session);
        }

        expect(session.events).toContainEqual(expect.objectContaining({ type: 'exit', code: 0, signal: null }));
        expect(session.stderr).toBe('');
        const result = parseScenarioResult(session.stdout) as {
            readonly encodeContents: string;
            readonly streamContents: string;
            readonly systemContents: string;
        };
        expect(result.encodeContents).toContain('encode failed: 73 null');
        expect(result.encodeContents).not.toContain('encode start. mode: synthetic-mode');
        expect(result.encodeContents).not.toContain('SERVICE_PROGRESS_FILTERED_MARKER');
        expect(result.encodeContents).not.toContain('exit code: 17, signal: null');
        expect(result.streamContents).toContain('get mirakurun service stream: 123');
        expect(result.streamContents).toContain('get mirakurun service stream failed: 123');
        expect(result.systemContents).not.toContain('encode failed: 73 null');
        expect(result.systemContents).not.toContain('get mirakurun service stream');
        expectCleanedSession(cleanupEvidence);
    });
});

describe('operational logging configuration failure delivery', () => {
    it('reports an owner message and stops before business work when the appender path is not writable', async () => {
        const session = await spawnCompiledChildScenario({
            name: 'permission-denied-log-appender',
            source: permissionDeniedConfigurationSource,
        });
        const blockedDirectory = join(session.tempDirectory, 'read-only-log-directory');
        const blockedLogPath = join(blockedDirectory, 'blocked.log');

        let cleanupEvidence: ChildHarnessCleanupEvidence | undefined;
        try {
            await session.waitForClose();
            await expect(access(blockedLogPath)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await chmod(blockedDirectory, 0o700).catch(error => {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    throw error;
                }
            });
            cleanupEvidence = await cleanupSession(session);
        }

        expect(session.events).toContainEqual(expect.objectContaining({ type: 'exit', code: 1, signal: null }));
        expect(session.stderr).toContain('log file parse error');
        expect(session.stdout.split(businessReachedSentinel).length - 1).toBe(0);
        expectCleanedSession(cleanupEvidence);
    });
});

describe('operational logging supervisor terminal classification', () => {
    it.each([
        {
            event: 'exit' as const,
            expectedRecords: [
                { category: 'system', level: 'fatal', value: 'service process is down' },
                { category: 'system', level: 'fatal', value: 'restart service' },
            ],
        },
        {
            // 'exit' and 'error' share one terminal settlement, so a fresh Web 'error' reports
            // the same pair. See .kiro/specs/server-application-runtime/design.md: exit/error 共通 terminal settlement.
            event: 'error' as const,
            expectedRecords: [
                { category: 'system', level: 'fatal', value: 'service process is down' },
                { category: 'system', level: 'fatal', value: 'restart service' },
            ],
        },
    ])('[OL-PROC-SUPERVISOR-TERMINALS] characterizes fresh Web $event', async ({ event, expectedRecords }) => {
        const session = await spawnCompiledChildScenario({
            name: `web-supervisor-${event}`,
            source: webSupervisorScenarioSource(event),
        });

        let cleanupEvidence: ChildHarnessCleanupEvidence | undefined;
        try {
            await session.waitForClose();
        } finally {
            cleanupEvidence = await cleanupSession(session);
        }

        expect(session.events).toContainEqual(expect.objectContaining({ type: 'exit', code: 0, signal: null }));
        expect(session.stderr).toBe('');
        const result = parseScenarioResult(session.stdout) as {
            readonly loggerOwnedEffects: Record<'cleanup' | 'restart' | 'signal' | 'stop' | 'wait', number>;
            readonly records: readonly { readonly category: string; readonly level: string; readonly value: string }[];
        };
        expect(result.records).toEqual(expectedRecords);
        expect(result.loggerOwnedEffects).toEqual({ cleanup: 0, restart: 0, signal: 0, stop: 0, wait: 0 });
        expectCleanedSession(cleanupEvidence);
    });

    it.each([
        {
            event: 'exit' as const,
            expectedRecords: [{ category: 'system', level: 'fatal', value: 'epg updater is abort' }],
        },
        {
            event: 'close' as const,
            expectedRecords: [{ category: 'system', level: 'fatal', value: 'epg update is closed' }],
        },
        {
            event: 'disconnect' as const,
            expectedRecords: [{ category: 'system', level: 'fatal', value: 'epg updater is disconnected' }],
        },
        {
            event: 'error' as const,
            expectedRecords: [
                { category: 'system', level: 'fatal', value: 'epg updater is error' },
                { category: 'system', level: 'error', value: 'Error: SYNTHETIC_EPG_POST_SPAWN_ERROR' },
            ],
        },
    ])('[OL-PROC-SUPERVISOR-TERMINALS] characterizes fresh EPG $event', async ({ event, expectedRecords }) => {
        const session = await spawnCompiledChildScenario({
            name: `epg-supervisor-${event}`,
            source: epgSupervisorScenarioSource(event),
        });

        let cleanupEvidence: ChildHarnessCleanupEvidence | undefined;
        try {
            await session.waitForClose();
        } finally {
            cleanupEvidence = await cleanupSession(session);
        }

        expect(session.events).toContainEqual(expect.objectContaining({ type: 'exit', code: 0, signal: null }));
        expect(session.stderr).toBe('');
        const result = parseScenarioResult(session.stdout) as {
            readonly loggerOwnedEffects: Record<'cleanup' | 'restart' | 'signal' | 'stop' | 'wait', number>;
            readonly records: readonly { readonly category: string; readonly level: string; readonly value: string }[];
        };
        expect(result.records).toEqual(expectedRecords);
        expect(result.loggerOwnedEffects).toEqual({ cleanup: 0, restart: 0, signal: 0, stop: 0, wait: 0 });
        expectCleanedSession(cleanupEvidence);
    });
});

describe('operational logging fatal process observers', () => {
    it.each(roles)('[OL-PROC-FATAL-OBSERVERS] keeps %s fatal notifications independently visible', async role => {
        const session = await spawnCompiledChildScenario({
            name: `${role}-mixed-process-observers`,
            source: processObserverScenarioSource(role),
        });

        let cleanupEvidence: ChildHarnessCleanupEvidence | undefined;
        try {
            await session.waitForClose();
        } finally {
            cleanupEvidence = await cleanupSession(session);
        }

        expect(session.events).toContainEqual(expect.objectContaining({ type: 'exit', code: 0, signal: null }));
        expect(session.stderr).toBe('');
        expect(session.stdout).toContain(controlledObserverMarker);
        const result = parseScenarioResult(session.stdout) as {
            readonly controlledCallbacks: number;
            readonly effects: {
                readonly cleanup: number;
                readonly exitCode: number | string | null;
                readonly exitCodes: readonly unknown[];
                readonly intakeStop: number;
                readonly restart: number;
                readonly signals: number;
            };
            readonly fatalRecords: readonly {
                readonly category: string;
                readonly level: string;
                readonly value: string;
            }[];
            readonly markers: {
                readonly uncaughtException: string;
                readonly unhandledRejection: string;
            };
        };
        expect(result.controlledCallbacks).toBe(1);
        expect(result.effects).toMatchObject({
            cleanup: 0,
            intakeStop: 0,
            restart: 0,
            signals: 0,
        });
        expect(result.effects.exitCodes).toEqual([]);
        expect([null, 0]).toContain(result.effects.exitCode);
        expect(result.fatalRecords).toHaveLength(role === 'Operator' ? 4 : 2);
        for (const record of result.fatalRecords) {
            expect(record).toMatchObject({ category: 'system', level: 'fatal' });
            expect(
                record.value.includes(result.markers.uncaughtException) &&
                    record.value.includes(result.markers.unhandledRejection),
            ).toBe(false);
        }
        const uncaughtRecords = result.fatalRecords.filter(record =>
            record.value.includes(result.markers.uncaughtException),
        );
        const rejectionRecords = result.fatalRecords.filter(record =>
            record.value.includes(result.markers.unhandledRejection),
        );
        if (role === 'Operator') {
            expect(uncaughtRecords).toHaveLength(2);
            expect(rejectionRecords).toHaveLength(1);
            expect(result.fatalRecords.filter(record => record.value === 'unhandledRejection')).toHaveLength(1);
        } else {
            expect(uncaughtRecords).toHaveLength(1);
            expect(rejectionRecords).toHaveLength(1);
        }
        expect(result.fatalRecords.indexOf(uncaughtRecords[0])).not.toBe(
            result.fatalRecords.indexOf(rejectionRecords[0]),
        );
        expect(session.stdout.split(fatalRecordPrefix).length - 1).toBe(result.fatalRecords.length);
        expectCleanedSession(cleanupEvidence);
    });
});
