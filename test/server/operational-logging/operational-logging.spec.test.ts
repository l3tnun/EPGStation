import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Configuration as Log4jsConfiguration, Logger } from 'log4js';

import { spawnCompiledChildScenario, type ChildHarnessCleanupEvidence } from '../harness/child-process.js';

interface OperationalLoggers {
    readonly access: Logger;
    readonly encode: Logger;
    readonly stream: Logger;
    readonly system: Logger;
}

interface LoggerModel {
    getLogger(): OperationalLoggers;
    initialize(filePath?: string): void;
}

interface LoggerModelConstructor {
    new (): LoggerModel;
}

interface LiveStreamRuntime {
    getStream(): unknown;
    setOption(option: { channelId: number; cmd?: string }, mode: number): void;
    start(streamId: number): Promise<void>;
}

interface LiveStreamConstructor {
    new (...args: unknown[]): LiveStreamRuntime;
}

interface EncoderRuntime {
    cancel(): Promise<void>;
    getProgressInfo(): { log: string; percent: number } | null;
    setOnFinish(callback: (isError: boolean, outputFilePath: string | null) => void): void;
    setOption(option: Record<string, unknown>): void;
    start(): Promise<void>;
}

interface EncoderConstructor {
    new (...args: unknown[]): EncoderRuntime;
}

interface SyntheticEncoderChild extends EventEmitter {
    readonly exitCode: null;
    readonly kill: ReturnType<typeof vi.fn>;
    readonly pid: number;
    readonly signalCode: null;
    readonly stderr: null;
    readonly stdin: null;
    readonly stdout: PassThrough | null;
}

interface StreamManageRuntime {
    keep(streamId: number): void;
    start(stream: unknown): Promise<number>;
    stop(streamId: number): Promise<void>;
}

interface StreamManageConstructor {
    new (...args: unknown[]): StreamManageRuntime;
}

interface CategoryLogProbe {
    readonly debug: ReturnType<typeof vi.fn>;
    readonly error: ReturnType<typeof vi.fn>;
    readonly fatal: ReturnType<typeof vi.fn>;
    readonly info: ReturnType<typeof vi.fn>;
    readonly logger: Logger;
    readonly trace: ReturnType<typeof vi.fn>;
    readonly warn: ReturnType<typeof vi.fn>;
}

interface SyntheticRequest {
    _logging?: boolean;
    readonly headers: Record<string, string>;
    readonly httpVersionMajor: number;
    readonly httpVersionMinor: number;
    readonly method: string;
    readonly originalUrl: string;
    readonly socket: { readonly remoteAddress: string };
}

interface SyntheticResponse extends EventEmitter {
    getHeader(name: string): number | string | undefined;
    statusCode: number;
    writeHead(code: number, headers?: Record<string, string>): void;
}

type AccessMiddleware = (request: SyntheticRequest, response: SyntheticResponse, next: () => void) => void;

const inventoryFixture = 'test/server/fixtures/logging/role-routing.synthetic.yml';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required');
}

const LoggerModel = (
    require(join(compiledSnapshot, 'model', 'LoggerModel.js')) as {
        default: LoggerModelConstructor;
    }
).default;
const Configuration = (
    require(join(compiledSnapshot, 'model', 'Configuration.js')) as {
        default: { readonly prototype: object };
    }
).default;
const ServiceServer = (
    require(join(compiledSnapshot, 'model', 'service', 'ServiceServer.js')) as {
        default: { readonly prototype: object };
    }
).default;
const EncoderModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncoderModel.js')) as {
        default: EncoderConstructor;
    }
).default;
const LiveStreamModel = (
    require(join(compiledSnapshot, 'model', 'service', 'stream', 'LiveStreamModel.js')) as {
        default: LiveStreamConstructor;
    }
).default;
const StreamManageModel = (
    require(join(compiledSnapshot, 'model', 'service', 'stream', 'manager', 'StreamManageModel.js')) as {
        default: StreamManageConstructor;
    }
).default;
const log4js = require('log4js') as typeof import('log4js');
const reflectMetadataPath = require.resolve('reflect-metadata');
const loggerModelPath = join(compiledSnapshot, 'model', 'LoggerModel.js');
const serviceExecutorPath = join(compiledSnapshot, 'model', 'service', 'ServiceExecutor.js');
const epgUpdateExecutorManageModelPath = join(
    compiledSnapshot,
    'model',
    'epgUpdater',
    'EPGUpdateExecutorManageModel.js',
);
const log4jsPath = require.resolve('log4js');
/*
 * server は ESM へ移行済みで、ServiceExecutor.js / EPGUpdateExecutorManageModel.js の
 * `import ... from '../ModelContainer.js'` や `import * as child_process from 'child_process'` は
 * 静的に解決される。子 process 内で `Module._load` を書き換える差し替えは
 * CommonJS の require() だけを経由する呼び出しにしか効かず、compile 済み ESM 自身の import は
 * 素通りする (in-process/子 process の差し替えが効かない)。そこで共通の loader hook
 * (`test/server/harness/child-module-overrides.mjs`) の `registerOverrides` を呼んでから対象を
 * require し直す。子 process 自体は CommonJS へ compile されるが、この hook module 自身は同期的な
 * 純粋 ESM (トップレベル await なし) なので、`require()` の require(esm) 相互運用で同期的に読み込め、
 * `registerHooks()` が登録する loader hook は登録元が CommonJS でも以降の ESM import 解決に適用され
 * るため、`--import` prelude を使わずに同じ hook を再利用できる。
 */
const childModuleOverridesPath = fileURLToPath(new URL('../harness/child-module-overrides.mjs', import.meta.url));
const businessReachedSentinel = 'BUSINESS_REACHED';
const infoMarkers = ['SYSTEM_INFO_MARKER', 'ACCESS_INFO_MARKER', 'STREAM_INFO_MARKER', 'ENCODE_INFO_MARKER'] as const;
const filteredMarkers = ['SYSTEM_DEBUG_MARKER', 'ENCODE_TRACE_MARKER'] as const;

const createCategoryLogProbe = (): CategoryLogProbe => {
    const debug = vi.fn();
    const error = vi.fn();
    const fatal = vi.fn();
    const info = vi.fn();
    const trace = vi.fn();
    const warn = vi.fn();

    return {
        debug,
        error,
        fatal,
        info,
        logger: { debug, error, fatal, info, trace, warn } as unknown as Logger,
        trace,
        warn,
    };
};

const createOperationalLoggerProbe = (): {
    readonly loggers: OperationalLoggers;
    readonly probes: Record<keyof OperationalLoggers, CategoryLogProbe>;
} => {
    const probes = {
        access: createCategoryLogProbe(),
        encode: createCategoryLogProbe(),
        stream: createCategoryLogProbe(),
        system: createCategoryLogProbe(),
    };

    return {
        loggers: {
            access: probes.access.logger,
            encode: probes.encode.logger,
            stream: probes.stream.logger,
            system: probes.system.logger,
        },
        probes,
    };
};

const createSyntheticEncoderChild = (stdout: PassThrough | null, pid: number): SyntheticEncoderChild =>
    Object.assign(new EventEmitter(), {
        exitCode: null,
        kill: vi.fn(() => true),
        pid,
        signalCode: null,
        stderr: null,
        stdin: null,
        stdout,
    });

const createEncoderHarness = (
    loggers: OperationalLoggers,
    child: SyntheticEncoderChild,
    encodeId: number,
): {
    readonly encodeEvent: { readonly emitUpdateEncodeProgress: ReturnType<typeof vi.fn> };
    readonly encoder: EncoderRuntime;
    readonly getVideoInfo: ReturnType<typeof vi.fn>;
    readonly handle: object;
    readonly requestStop: ReturnType<typeof vi.fn>;
} => {
    const configure = {
        getConfig: () => ({
            encode: [
                {
                    cmd: 'synthetic-command',
                    name: 'synthetic-mode',
                    rate: 1,
                },
            ],
            ffmpeg: 'synthetic-ffmpeg',
            ffprobe: 'synthetic-ffprobe',
        }),
    };
    const fileManager = {} as {
        getFilePath: ReturnType<typeof vi.fn>;
        release: ReturnType<typeof vi.fn>;
    };
    Object.assign(fileManager, { getFilePath: vi.fn(), release: vi.fn() });
    const getVideoInfo = vi.fn().mockResolvedValue({});
    const encodeEvent = { emitUpdateEncodeProgress: vi.fn() };
    const handle = Object.freeze({});
    const requestStop = vi.fn().mockResolvedValue({ status: 'requested', sentSignals: ['SIGINT'] });
    const encoder = new EncoderModel(
        { getLogger: () => loggers },
        configure,
        {
            create: vi.fn().mockResolvedValue(child),
            createManaged: vi.fn().mockResolvedValue({ child, handle }),
            requestStop,
        },
        fileManager,
        { findId: vi.fn().mockResolvedValue({ id: 1 }) },
        {
            findId: vi.fn().mockResolvedValue({
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
            findId: vi.fn().mockResolvedValue({
                halfWidthName: 'synthetic-channel',
                name: 'synthetic-channel',
            }),
        },
        {
            getFullFilePathFromId: vi.fn().mockResolvedValue(loggerModelPath),
            getInfo: getVideoInfo,
            getParentDirPath: vi.fn(),
        },
        encodeEvent,
        {},
    );
    encoder.setOption({
        encodeId,
        mode: 'synthetic-mode',
        parentDir: 'recorded',
        recordedId: 2,
        removeOriginal: false,
        sourceVideoFileId: 1,
    });

    return { encodeEvent, encoder, getVideoInfo, handle, requestStop };
};

const expectNoNonEncodeRecords = (probes: Record<keyof OperationalLoggers, CategoryLogProbe>): void => {
    for (const category of [probes.system, probes.access, probes.stream]) {
        expect(category.debug).not.toHaveBeenCalled();
        expect(category.error).not.toHaveBeenCalled();
        expect(category.fatal).not.toHaveBeenCalled();
        expect(category.info).not.toHaveBeenCalled();
        expect(category.trace).not.toHaveBeenCalled();
        expect(category.warn).not.toHaveBeenCalled();
    }
};

const createAccessMiddleware = (): {
    readonly log: ReturnType<typeof vi.fn>;
    readonly middleware: AccessMiddleware;
} => {
    const log = vi.fn();
    const accessLogger = {
        isLevelEnabled: () => true,
        log,
    } as unknown as Logger;
    const use = vi.fn();
    const service = Object.create(ServiceServer.prototype) as {
        app: { use(middleware: AccessMiddleware): void };
        log: { access: Logger };
        setLog(): void;
    };
    service.app = { use };
    service.log = { access: accessLogger };

    service.setLog();

    expect(use).toHaveBeenCalledOnce();
    return {
        log,
        middleware: use.mock.calls[0][0] as AccessMiddleware,
    };
};

const createSyntheticExchange = (): {
    readonly request: SyntheticRequest;
    readonly response: SyntheticResponse;
} => {
    const request: SyntheticRequest = {
        headers: {
            referer: 'https://synthetic.invalid/guide',
            'user-agent': 'SyntheticAgent/1.0',
        },
        httpVersionMajor: 1,
        httpVersionMinor: 1,
        method: 'PATCH',
        originalUrl: '/synthetic/access?mode=full',
        socket: { remoteAddress: 'synthetic-remote-address-9' },
    };
    const response = Object.assign(new EventEmitter(), {
        getHeader: (name: string): number | string | undefined =>
            name.toLowerCase() === 'content-length' ? 17 : undefined,
        statusCode: 207,
        writeHead(code: number): void {
            this.statusCode = code;
        },
    }) as SyntheticResponse;
    return { request, response };
};

interface InitializationFailureContract {
    readonly expectedStderr?: string;
    readonly name: string;
    readonly operation: string;
}

const initializationFailureContracts: readonly InitializationFailureContract[] = [
    {
        name: 'does not continue when the configured log file is absent',
        expectedStderr: 'log file is not found',
        operation: `
const target = join(__dirname, 'missing-log-config.yml');
new LoggerModel().initialize(target);`,
    },
    {
        name: 'does not continue when the configured log path cannot be read as a file',
        operation: `
const target = join(__dirname, 'log-config-directory');
mkdirSync(target);
new LoggerModel().initialize(target);`,
    },
    {
        name: 'does not continue when the configured log file is invalid YAML',
        expectedStderr: 'log file parse error',
        operation: `
const target = join(__dirname, 'invalid-log-config.yml');
writeFileSync(target, 'categories: [', 'utf8');
new LoggerModel().initialize(target);`,
    },
    {
        name: 'does not continue when a logger is requested before initialization',
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

const defaultOutputChildSource = `
require(${JSON.stringify(reflectMetadataPath)});
const log4js = require(${JSON.stringify(log4jsPath)});
const LoggerModel = require(${JSON.stringify(loggerModelPath)}).default;
const model = new LoggerModel();
model.initialize();
const loggers = model.getLogger();
loggers.system.info(${JSON.stringify(infoMarkers[0])});
loggers.access.info(${JSON.stringify(infoMarkers[1])});
loggers.stream.info(${JSON.stringify(infoMarkers[2])});
loggers.encode.info(${JSON.stringify(infoMarkers[3])});
loggers.system.debug(${JSON.stringify(filteredMarkers[0])});
loggers.encode.trace(${JSON.stringify(filteredMarkers[1])});
log4js.shutdown((error: Error | undefined) => {
    if (error !== undefined) {
        console.error(error);
        process.exitCode = 1;
    }
});
`;

const acceptanceResultPrefix = 'ACCEPTANCE_RESULT:';
const roleAcceptanceChildSource = `
require(${JSON.stringify(reflectMetadataPath)});
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const log4js = require(${JSON.stringify(log4jsPath)});
const LoggerModel = require(${JSON.stringify(loggerModelPath)}).default;
const writeConfiguration = (configPath: string, filename: string): void => {
    writeFileSync(configPath, JSON.stringify({
        appenders: { selected: { type: 'file', filename } },
        categories: {
            default: { appenders: ['selected'], level: 'info' },
            system: { appenders: ['selected'], level: 'info' },
            access: { appenders: ['selected'], level: 'info' },
            stream: { appenders: ['selected'], level: 'info' },
            encode: { appenders: ['selected'], level: 'info' },
        },
    }), 'utf8');
};
const waitForMarker = async (filename: string, marker: string): Promise<void> => {
    const deadline = Date.now() + 2_000;
    do {
        if (readFileSync(filename, 'utf8').includes(marker)) return;
        // Poll interval for the real condition (marker written to file) checked above; not a
        // fixed wait-then-assume delay.
        await new Promise<void>(resolve => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    throw new Error('Marker was not written: ' + marker);
};
const shutdown = (): Promise<void> => new Promise((resolve, reject) => {
    log4js.shutdown((error: Error | null | undefined) => error === undefined || error === null ? resolve() : reject(error));
});
const main = async (): Promise<void> => {
    const roles = ['Operator', 'Service', 'EPGUpdater'];
    const outputs = Object.fromEntries(roles.map(role => [role, join(__dirname, role + '.log')])) as Record<string, string>;
    const model = new LoggerModel();
    for (const role of roles) {
        writeFileSync(outputs[role], '', 'utf8');
        const configPath = join(__dirname, role + '.yml');
        writeConfiguration(configPath, outputs[role]);
        model.initialize(configPath);
        model.getLogger().system.info('ROLE_ACCEPTANCE_MARKER_' + role);
        await waitForMarker(outputs[role], 'ROLE_ACCEPTANCE_MARKER_' + role);
    }

    const oldPath = join(__dirname, 'active-old.log');
    const nextPath = join(__dirname, 'active-next.log');
    const activeConfigPath = join(__dirname, 'active.yml');
    writeFileSync(oldPath, '', 'utf8');
    writeFileSync(nextPath, '', 'utf8');
    writeConfiguration(activeConfigPath, oldPath);
    model.initialize(activeConfigPath);
    model.getLogger().system.info('ACTIVE_BEFORE_EDIT');
    await waitForMarker(oldPath, 'ACTIVE_BEFORE_EDIT');
    writeConfiguration(activeConfigPath, nextPath);
    model.getLogger().system.info('ACTIVE_AFTER_EDIT');
    await waitForMarker(oldPath, 'ACTIVE_AFTER_EDIT');
    const nextBeforeReinitialize = readFileSync(nextPath, 'utf8');
    model.initialize(activeConfigPath);
    model.getLogger().system.info('ACTIVE_AFTER_REINITIALIZE');
    await waitForMarker(nextPath, 'ACTIVE_AFTER_REINITIALIZE');
    await shutdown();
    process.stdout.write(
        ${JSON.stringify(acceptanceResultPrefix)} + JSON.stringify({
            nextBeforeReinitialize,
            nextContents: readFileSync(nextPath, 'utf8'),
            oldContents: readFileSync(oldPath, 'utf8'),
            roleContents: Object.fromEntries(roles.map(role => [role, readFileSync(outputs[role], 'utf8')])),
        }) + '\\n',
    );
};
void main().catch((error: unknown) => { console.error(error); process.exitCode = 2; });
`;

const fatalObserverAcceptanceChildSource = `
require(${JSON.stringify(reflectMetadataPath)});
const originalExit = process.exit.bind(process);
const records: Array<{ category: string; level: string; value: string }> = [];
const initialUncaught = new Set(process.listeners('uncaughtException'));
const initialRejected = new Set(process.listeners('unhandledRejection'));
const loggerModel = {
    initialize: (): void => undefined,
    getLogger: () => ({ system: {
        fatal: (value: unknown): void => { records.push({ category: 'system', level: 'fatal', value: String(value) }); },
    } }),
};
const container = { get: (key: string): unknown => {
    if (key === 'ILoggerModel') return loggerModel;
    if (key === 'IEncodeFinishModel') return { set: (): void => undefined };
    if (key === 'IServiceServer') return { start: (): void => undefined };
    return {};
} };
(globalThis as Record<string, unknown>).__epgstationFatalObserverAcceptanceContainer = container;
const { registerOverrides } = require(${JSON.stringify(childModuleOverridesPath)});
registerOverrides([
    {
        specifier: '../ModelContainer.js',
        source: 'export default globalThis.__epgstationFatalObserverAcceptanceContainer;',
    },
    { specifier: '../ModelContainerSetter.js', source: 'export const set = () => undefined;' },
]);
require(${JSON.stringify(serviceExecutorPath)});
process.emit('uncaughtException', new Error('SYNTHETIC_UNCAUGHT_ACCEPTANCE'));
process.emit('unhandledRejection', new Error('SYNTHETIC_REJECTION_ACCEPTANCE'), Promise.resolve());
for (const listener of process.listeners('uncaughtException')) {
    if (!initialUncaught.has(listener)) process.off('uncaughtException', listener);
}
for (const listener of process.listeners('unhandledRejection')) {
    if (!initialRejected.has(listener)) process.off('unhandledRejection', listener);
}
process.stdout.write(
    ${JSON.stringify(acceptanceResultPrefix)} + JSON.stringify({
        records,
        residualListeners:
            process.listeners('uncaughtException').filter(listener => !initialUncaught.has(listener)).length +
            process.listeners('unhandledRejection').filter(listener => !initialRejected.has(listener)).length,
    }) + '\\n',
    () => originalExit(0),
);
`;

const supervisorAcceptanceChildSource = `
require(${JSON.stringify(reflectMetadataPath)});
import { EventEmitter } from 'node:events';
const originalExit = process.exit.bind(process);
const records: Array<{ category: string; level: string; value: string }> = [];
const children: InstanceType<typeof EventEmitter>[] = [];
(globalThis as Record<string, unknown>).__epgstationSupervisorAcceptanceSpawn = (): unknown => {
    const child = Object.assign(new EventEmitter(), { pid: 49201 + children.length, stderr: null, stdout: null, kill: (): boolean => true });
    children.push(child);
    return child;
};
const { registerOverrides } = require(${JSON.stringify(childModuleOverridesPath)});
registerOverrides([
    {
        specifier: 'child_process',
        source: 'export const spawn = (...args) => globalThis.__epgstationSupervisorAcceptanceSpawn(...args);',
    },
]);
const loggerModel = { getLogger: () => ({ system: {
    error: (value: unknown): void => { records.push({ category: 'system', level: 'error', value: String(value) }); },
    fatal: (value: unknown): void => { records.push({ category: 'system', level: 'fatal', value: String(value) }); },
    info: (): void => undefined,
} }) };
const main = async (): Promise<void> => {
    const Constructor = require(${JSON.stringify(epgUpdateExecutorManageModelPath)}).default;
    const manager = new Constructor(loggerModel, { emitUpdated: (): void => undefined });
    await manager.execute();
    const child = children[0];
    if (child === undefined) throw new Error('Missing EPG acceptance child');
    child.emit('error', new Error('SYNTHETIC_EPG_ACCEPTANCE_ERROR'));
    process.stdout.write(${JSON.stringify(acceptanceResultPrefix)} + JSON.stringify({ records }) + '\\n', () => originalExit(0));
};
void main().catch((error: unknown) => { console.error(error); originalExit(2); });
`;

const realLoggerEffectChildSource = `
require(${JSON.stringify(reflectMetadataPath)});
const childProcess = require('node:child_process');
const log4js = require(${JSON.stringify(log4jsPath)});
const LoggerModel = require(${JSON.stringify(loggerModelPath)}).default;
const originalExit = process.exit.bind(process);
const originalKill = process.kill.bind(process);
const originalSpawn = childProcess.spawn;
const originalFork = childProcess.fork;
const originalSetTimeout = globalThis.setTimeout;
const originalSetInterval = globalThis.setInterval;
let loggingCallActive = false;
const effects = { exit: 0, fork: 0, signal: 0, spawn: 0, wait: 0 };
process.exit = ((..._args: unknown[]): never => { if (loggingCallActive) effects.exit += 1; throw new Error('Unexpected logger exit'); }) as typeof process.exit;
process.kill = ((...args: Parameters<typeof process.kill>): boolean => {
    if (loggingCallActive) effects.signal += 1;
    return originalKill(...args);
}) as typeof process.kill;
childProcess.spawn = ((...args: Parameters<typeof originalSpawn>): ReturnType<typeof originalSpawn> => {
    if (loggingCallActive) effects.spawn += 1;
    return originalSpawn(...args);
}) as typeof originalSpawn;
childProcess.fork = ((...args: Parameters<typeof originalFork>): ReturnType<typeof originalFork> => {
    if (loggingCallActive) effects.fork += 1;
    return originalFork(...args);
}) as typeof originalFork;
globalThis.setTimeout = ((...args: Parameters<typeof originalSetTimeout>): ReturnType<typeof originalSetTimeout> => {
    if (loggingCallActive) effects.wait += 1;
    return originalSetTimeout(...args);
}) as typeof originalSetTimeout;
globalThis.setInterval = ((...args: Parameters<typeof originalSetInterval>): ReturnType<typeof originalSetInterval> => {
    if (loggingCallActive) effects.wait += 1;
    return originalSetInterval(...args);
}) as typeof originalSetInterval;
const model = new LoggerModel();
model.initialize();
const logger = model.getLogger().system;
loggingCallActive = true;
logger.fatal('REAL_LOGGER_FATAL_ACCEPTANCE');
logger.error(new Error('REAL_LOGGER_ERROR_ACCEPTANCE'));
loggingCallActive = false;
log4js.shutdown((error: Error | undefined) => {
    if (error !== undefined) { console.error(error); originalExit(2); return; }
    process.stdout.write(${JSON.stringify(acceptanceResultPrefix)} + JSON.stringify({ effects }) + '\\n', () => originalExit(0));
});
`;

const parseAcceptanceResult = (stdout: string): Record<string, unknown> => {
    const line = stdout.split('\n').find(candidate => candidate.startsWith(acceptanceResultPrefix));
    if (line === undefined) throw new Error('Missing acceptance result');
    return JSON.parse(line.slice(acceptanceResultPrefix.length)) as Record<string, unknown>;
};

const cleanupSession = async (
    session: Awaited<ReturnType<typeof spawnCompiledChildScenario>>,
): Promise<ChildHarnessCleanupEvidence> => {
    const evidence = await session.cleanup();
    await expect(access(session.tempDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    return evidence;
};

const shutdownLogging = (): Promise<void> =>
    new Promise((resolve, reject) => {
        log4js.shutdown(error => {
            if (error === undefined) {
                resolve();
            } else {
                reject(error);
            }
        });
    });

afterEach(async () => {
    await shutdownLogging();
    vi.restoreAllMocks();
});

describe('operational logging default initialization', () => {
    it('[OL-SPEC-DEFAULT-LOGGERS] provides the four operational loggers after initialization', () => {
        const model = new LoggerModel();

        model.initialize();
        const loggers = model.getLogger();

        expect(Object.keys(loggers).sort()).toEqual(['access', 'encode', 'stream', 'system']);
        expect(loggers.system.category).toBe('system');
        expect(loggers.access.category).toBe('access');
        expect(loggers.stream.category).toBe('stream');
        expect(loggers.encode.category).toBe('encode');
        for (const logger of Object.values(loggers)) {
            expect(logger.info).toBeTypeOf('function');
        }
    });

    it('[OL-SPEC-LEVEL] enables info and filters lower levels for every default operational logger', () => {
        const model = new LoggerModel();

        model.initialize();

        for (const logger of Object.values(model.getLogger())) {
            expect(logger.isInfoEnabled()).toBe(true);
            expect(logger.isDebugEnabled()).toBe(false);
            expect(logger.isTraceEnabled()).toBe(false);
        }
    });

    it('[OL-SPEC-LOGGER-IDENTITY] returns the same aggregate logger identity throughout the initialized process', () => {
        const model = new LoggerModel();

        model.initialize();
        const first = model.getLogger();

        expect(model.getLogger()).toBe(first);
    });

    it('[OL-SPEC-DEFAULT-SCREEN] writes four purposes while filtering lower levels', async () => {
        const session = await spawnCompiledChildScenario({
            name: 'default-screen-output',
            source: defaultOutputChildSource,
        });

        let cleanupEvidence: ChildHarnessCleanupEvidence | undefined;
        try {
            await session.waitForClose();
        } finally {
            cleanupEvidence = await cleanupSession(session);
        }

        expect(session.events).toContainEqual(expect.objectContaining({ type: 'exit', code: 0, signal: null }));
        for (const marker of infoMarkers) {
            expect(session.stdout).toContain(marker);
        }
        for (const marker of filteredMarkers) {
            expect(session.stdout).not.toContain(marker);
        }
        expect(session.stderr).toBe('');
        expect(cleanupEvidence).toEqual({
            remainingChildProcesses: 0,
            remainingListeners: 0,
            remainingTimers: 0,
            remainingTempResources: 0,
        });
    });
});

describe('operational logging initialization failure contracts', () => {
    const assertFailureContract = async (contract: InitializationFailureContract): Promise<void> => {
        const session = await spawnCompiledChildScenario({
            name: contract.name,
            source: childSource(contract.operation),
        });
        let cleanupEvidence: ChildHarnessCleanupEvidence | undefined;
        try {
            await session.waitForClose();
        } finally {
            cleanupEvidence = await cleanupSession(session);
        }
        expect(session.events).toContainEqual(expect.objectContaining({ type: 'exit', code: 1, signal: null }));
        if (contract.expectedStderr === undefined) {
            expect(session.stderr.trim()).not.toBe('');
        } else {
            expect(session.stderr).toContain(contract.expectedStderr);
        }
        expect(session.stdout.split(businessReachedSentinel).length - 1).toBe(0);
        expect(cleanupEvidence).toEqual({
            remainingChildProcesses: 0,
            remainingListeners: 0,
            remainingTimers: 0,
            remainingTempResources: 0,
        });
    };

    // Budget declared from measured durations of this exact case under full-coverage load:
    // a direct-node coverage run took 4586ms; npm runs took 3268ms and 4498ms, and one exceeded
    // a 5303ms budget, so the budget is sized for the load class rather than the unloaded run.
    it('[OL-SPEC-INIT-FAIL] stops for missing, unreadable, and invalid configuration', async () => {
        for (const contract of initializationFailureContracts.slice(0, 3)) {
            await assertFailureContract(contract);
        }
    }, 30_000);

    it('[OL-SPEC-PREINIT] stops when getLogger precedes initialize', async () => {
        const contract = initializationFailureContracts[3];
        if (contract === undefined) throw new Error('Missing pre-initialization failure contract');
        await assertFailureContract(contract);
    });
});

describe('HTTP access logging contract', () => {
    it('[OL-SPEC-HTTP] tracks one request without changing the business response', () => {
        const { log, middleware } = createAccessMiddleware();
        const { request, response } = createSyntheticExchange();
        const next = vi.fn();

        middleware(request, response, next);

        expect(next).toHaveBeenCalledOnce();
        expect(request._logging).toBe(true);
        expect(log).not.toHaveBeenCalled();

        response.emit('finish');
        response.emit('close');
        response.emit('end');
        response.emit('error', new Error('duplicate terminal notification'));

        expect(log).toHaveBeenCalledOnce();
        expect(String(log.mock.calls[0][0])).toBe('INFO');
        const record = String(log.mock.calls[0][1]);
        expect(record).toContain('synthetic-remote-address-9');
        expect(record).toContain('"PATCH /synthetic/access?mode=full HTTP/1.1"');
        expect(record).toContain('207');
        expect(record).toContain('17');
        expect(record).toContain('"https://synthetic.invalid/guide"');
        expect(record).toContain('"SyntheticAgent/1.0"');
        expect(request.method).toBe('PATCH');
        expect(request.originalUrl).toBe('/synthetic/access?mode=full');
        expect(response.statusCode).toBe(207);
    });
});

describe('system producer logging contract', () => {
    it('[OL-SPEC-SYSTEM] keeps startup, configuration, internal, and error records in system', async () => {
        const { loggers, probes } = createOperationalLoggerProbe();
        const tempDirectory = await mkdtemp(join(tmpdir(), 'epgstation-system-producer-'));
        const uploadDirectory = join(tempDirectory, 'upload');
        const fakeServer = {};
        const socketIoManageModel = { initialize: vi.fn() };
        const service = Object.create(ServiceServer.prototype) as {
            app: {
                listen(port: number, callback: () => void): unknown;
            };
            config: {
                port: number;
                socketioPort: number;
                uploadTempDir: string;
            };
            createUploadDir(): void;
            log: OperationalLoggers;
            socketIoManageModel: { initialize(servers: readonly unknown[]): void };
            start(): void;
        };
        service.app = {
            listen: vi.fn((_port: number, callback: () => void) => {
                callback();
                return fakeServer;
            }),
        };
        service.config = {
            port: 48123,
            socketioPort: 48123,
            uploadTempDir: uploadDirectory,
        };
        service.log = loggers;
        service.socketIoManageModel = socketIoManageModel;
        const configuration = Object.create(Configuration.prototype) as {
            formatConfig(config: Record<string, unknown>): unknown;
            log: OperationalLoggers;
            templateConfig: null;
        };
        configuration.log = loggers;
        configuration.templateConfig = null;

        try {
            service.createUploadDir();
            service.start();
            expect(() => configuration.formatConfig({})).toThrow('PortSettingError');

            await expect(access(uploadDirectory)).resolves.toBeUndefined();
            expect(probes.system.info).toHaveBeenCalledWith(`mkdirp: ${uploadDirectory}`);
            expect(probes.system.info).toHaveBeenCalledWith('http server listening on 48123');
            expect(probes.system.fatal).toHaveBeenCalledWith('port setting error');
            expect(service.app.listen).toHaveBeenCalledWith(48123, expect.any(Function));
            expect(socketIoManageModel.initialize).toHaveBeenCalledWith([fakeServer]);
            for (const category of [probes.access, probes.encode, probes.stream]) {
                expect(category.info).not.toHaveBeenCalled();
                expect(category.error).not.toHaveBeenCalled();
                expect(category.fatal).not.toHaveBeenCalled();
            }
        } finally {
            await rm(tempDirectory, { force: true, recursive: true });
        }
    });
});

describe('encode producer logging contract', () => {
    it('[OL-SPEC-ENCODE] records start, progress, and successful finish through encode levels', async () => {
        vi.useFakeTimers();
        const { loggers, probes } = createOperationalLoggerProbe();
        const stdout = new PassThrough();
        const child = createSyntheticEncoderChild(stdout, 48124);
        const { encodeEvent, encoder, getVideoInfo } = createEncoderHarness(loggers, child, 42);
        const finish = vi.fn();
        encoder.setOnFinish(finish);

        try {
            await encoder.start();
            expect(getVideoInfo).toHaveBeenCalledWith(loggerModelPath);
            expect(stdout.listenerCount('data')).toBe(1);
            stdout.write(
                `${JSON.stringify({
                    log: 'synthetic progress',
                    percent: 25,
                    type: 'progress',
                })}\n`,
            );
            child.emit('exit', 0, null);

            expect(probes.encode.info).toHaveBeenCalledWith(
                expect.stringContaining('encode start. mode: synthetic-mode'),
            );
            expect(probes.encode.debug).toHaveBeenCalledWith({
                log: 'synthetic progress',
                percent: 25,
                type: 'progress',
            });
            expect(probes.encode.info).toHaveBeenCalledWith('exit code: 0, signal: null');
            expect(probes.encode.info).toHaveBeenCalledWith('Successfully encod: 42 null');
            expect(encoder.getProgressInfo()).toEqual({
                log: 'synthetic progress',
                percent: 25,
            });
            expect(encodeEvent.emitUpdateEncodeProgress).toHaveBeenCalledOnce();
            expect(finish).toHaveBeenCalledWith(false, null);
            expect(child.kill).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
            expectNoNonEncodeRecords(probes);
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
            stdout.destroy();
            child.removeAllListeners();
        }
    });

    it('[OL-SPEC-ENCODE-FAILURE] records a nonzero process exit as an encode failure and preserves the error finish outcome', async () => {
        vi.useFakeTimers();
        const { loggers, probes } = createOperationalLoggerProbe();
        const child = createSyntheticEncoderChild(null, 48125);
        const { encoder, getVideoInfo } = createEncoderHarness(loggers, child, 43);
        const finish = vi.fn();
        encoder.setOnFinish(finish);

        try {
            await encoder.start();
            child.emit('exit', 17, null);

            expect(getVideoInfo).not.toHaveBeenCalled();
            expect(probes.encode.info).toHaveBeenCalledWith(
                expect.stringContaining('encode start. mode: synthetic-mode'),
            );
            expect(probes.encode.info).toHaveBeenCalledWith('exit code: 17, signal: null');
            expect(probes.encode.error).toHaveBeenCalledWith('encode failed: 43 null');
            expect(finish).toHaveBeenCalledWith(true, null);
            expect(child.kill).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
            expectNoNonEncodeRecords(probes);
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
            child.removeAllListeners();
        }
    });

    it('[OL-SPEC-ENCODE-CANCEL] records cancellation only after a started child reaches its terminal event', async () => {
        vi.useFakeTimers();
        const { loggers, probes } = createOperationalLoggerProbe();
        const stdout = new PassThrough();
        const child = createSyntheticEncoderChild(stdout, 48126);
        const { encoder, getVideoInfo, handle, requestStop } = createEncoderHarness(loggers, child, 44);
        const finish = vi.fn();
        encoder.setOnFinish(finish);

        try {
            await encoder.start();
            const cancellation = encoder.cancel();
            await cancellation;

            expect(requestStop).toHaveBeenCalledOnce();
            expect(requestStop).toHaveBeenCalledWith(handle);
            expect(child.kill).not.toHaveBeenCalled();
            expect(stdout.destroyed).toBe(false);
            expect(finish).not.toHaveBeenCalled();
            expect(probes.encode.info).toHaveBeenCalledWith('cancel encode: 44');
            expect(probes.encode.info).not.toHaveBeenCalledWith('canceld encode: 44');

            child.emit('exit', null, 'SIGINT');
            await Promise.resolve();

            expect(getVideoInfo).toHaveBeenCalledWith(loggerModelPath);
            expect(probes.encode.info).toHaveBeenCalledWith('exit code: null, signal: SIGINT');
            expect(probes.encode.info).toHaveBeenCalledWith('canceld encode: 44');
            expect(finish).toHaveBeenCalledWith(true, null);
            expect(requestStop).toHaveBeenCalledOnce();
            expect(vi.getTimerCount()).toBe(0);
            expectNoNonEncodeRecords(probes);
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
            stdout.destroy();
            child.removeAllListeners();
        }
    });
});

describe('stream producer logging contract', () => {
    it('[OL-SPEC-STREAM-ACQUISITION-FAILURE] reports a Mirakurun service-stream acquisition failure only through the stream logger', async () => {
        const acquisitionFailure = new Error('synthetic service-stream acquisition failure');
        const { loggers, probes } = createOperationalLoggerProbe();
        const tunerServerAccess = {
            openServiceStream: vi.fn().mockRejectedValue(acquisitionFailure),
        };
        const liveStream = new LiveStreamModel(
            {
                getConfig: () => ({
                    ffmpeg: 'synthetic-ffmpeg',
                    streamFilePath: 'synthetic-stream-files',
                    streamingPriority: 7,
                }),
            },
            { getLogger: () => loggers },
            {},
            {},
            tunerServerAccess,
            {},
        );
        liveStream.setOption({ channelId: 123 }, 0);

        await expect(liveStream.start(4)).rejects.toBe(acquisitionFailure);

        expect(tunerServerAccess.openServiceStream).toHaveBeenCalledWith({ serviceId: 123, priority: 7 });
        expect(probes.stream.info).toHaveBeenCalledWith('get mirakurun service stream: 123');
        expect(probes.stream.error).toHaveBeenCalledWith('get mirakurun service stream failed: 123');
        expect(probes.system.error).not.toHaveBeenCalled();
        expect(probes.access.error).not.toHaveBeenCalled();
        expect(probes.encode.error).not.toHaveBeenCalled();
        expect(() => liveStream.getStream()).toThrow('StreamIsNull');
    });

    it('[OL-SPEC-STREAM] records live and recorded lifecycle through the stream logger', async () => {
        const deliveryFailure = new Error('synthetic recorded-stream start failure');
        const continuationFailure = new Error('synthetic stream continuation failure');
        const { loggers, probes } = createOperationalLoggerProbe();
        let executionId = 0;
        const executionManager = {
            getExecution: vi.fn(async () => {
                executionId += 1;
                return executionId;
            }),
            unLockExecution: vi.fn(),
        };
        const socket = { notifyClient: vi.fn() };
        const manager = new StreamManageModel({ getLogger: () => loggers }, executionManager, socket);
        const createDelivery = (type: 'LiveStream' | 'RecordedStream', start: () => Promise<void>) => ({
            finalizeStop: vi.fn(),
            getInfo: () => ({ type }),
            getStream: vi.fn(),
            keep: vi.fn(),
            ownsDiskArtifacts: () => false,
            setExitStream: vi.fn(),
            setOption: vi.fn(),
            start: vi.fn(start),
            stop: vi.fn().mockResolvedValue(undefined),
        });
        const live = createDelivery('LiveStream', async () => undefined);
        const recorded = createDelivery('RecordedStream', async () => undefined);
        const failedContinuation = createDelivery('LiveStream', async () => undefined);
        failedContinuation.keep.mockImplementation(() => {
            throw continuationFailure;
        });
        const failedRecorded = createDelivery('RecordedStream', async () => {
            throw deliveryFailure;
        });

        const liveId = await manager.start(live);
        expect(socket.notifyClient).toHaveBeenCalledTimes(2);
        const recordedId = await manager.start(recorded);
        expect(socket.notifyClient).toHaveBeenCalledTimes(4);
        const failedContinuationId = await manager.start(failedContinuation);
        expect(socket.notifyClient).toHaveBeenCalledTimes(6);
        manager.keep(liveId);
        manager.keep(recordedId);
        let receivedContinuationFailure: unknown;
        try {
            manager.keep(failedContinuationId);
        } catch (error: unknown) {
            receivedContinuationFailure = error;
        }
        await manager.stop(liveId);
        expect(socket.notifyClient).toHaveBeenCalledTimes(8);
        await manager.stop(recordedId);
        expect(socket.notifyClient).toHaveBeenCalledTimes(10);
        await manager.stop(failedContinuationId);
        expect(socket.notifyClient).toHaveBeenCalledTimes(12);
        await expect(manager.start(failedRecorded)).rejects.toBe(deliveryFailure);
        await vi.waitFor(() => expect(socket.notifyClient).toHaveBeenCalledTimes(15));

        expect(liveId).toBe(0);
        expect(recordedId).toBe(1);
        expect(failedContinuationId).toBe(2);
        expect(receivedContinuationFailure).toBe(continuationFailure);
        expect(live.start).toHaveBeenCalledWith(liveId);
        expect(recorded.start).toHaveBeenCalledWith(recordedId);
        expect(live.keep).toHaveBeenCalledOnce();
        expect(recorded.keep).toHaveBeenCalledOnce();
        expect(live.stop).toHaveBeenCalledOnce();
        expect(recorded.stop).toHaveBeenCalledOnce();
        expect(probes.stream.info).toHaveBeenCalledWith('start stream: 0');
        expect(probes.stream.info).toHaveBeenCalledWith('start stream: 1');
        expect(probes.stream.debug).toHaveBeenCalledWith('keep stream 0');
        expect(probes.stream.debug).toHaveBeenCalledWith('keep stream 1');
        expect(probes.stream.debug).not.toHaveBeenCalledWith('keep stream 2');
        expect(probes.stream.info).toHaveBeenCalledWith('stop stream 0');
        expect(probes.stream.info).toHaveBeenCalledWith('stop stream 1');
        expect(probes.stream.error).toHaveBeenCalledWith('start stream error');
        expect(probes.stream.error).toHaveBeenCalledWith(deliveryFailure);
        for (const category of [probes.system, probes.access, probes.encode]) {
            expect(category.debug).not.toHaveBeenCalled();
            expect(category.error).not.toHaveBeenCalled();
            expect(category.info).not.toHaveBeenCalled();
        }
        expect(executionManager.getExecution).toHaveBeenCalledTimes(8);
        expect(executionManager.unLockExecution).toHaveBeenCalledTimes(8);
        expect(socket.notifyClient).toHaveBeenCalledTimes(15);
    });
});

describe('operational logging role and filesystem acceptance contracts', () => {
    it('[OL-SPEC-ROLE-CONFIG] applies three role configurations and only reconfigures explicitly', async () => {
        const session = await spawnCompiledChildScenario(
            {
                name: 'acceptance-role-configurations',
                source: roleAcceptanceChildSource,
            },
            {
                observationDeadlineMilliseconds: 20_000,
            },
        );
        let cleanupEvidence: ChildHarnessCleanupEvidence | undefined;
        try {
            await session.waitForClose();
        } finally {
            cleanupEvidence = await cleanupSession(session);
        }

        expect(session.events).toContainEqual(expect.objectContaining({ type: 'exit', code: 0, signal: null }));
        expect(session.stderr).toBe('');
        const result = parseAcceptanceResult(session.stdout) as {
            readonly nextBeforeReinitialize: string;
            readonly nextContents: string;
            readonly oldContents: string;
            readonly roleContents: Record<string, string>;
        };
        for (const role of ['Operator', 'Service', 'EPGUpdater']) {
            expect(result.roleContents[role]).toContain(`ROLE_ACCEPTANCE_MARKER_${role}`);
            for (const otherRole of ['Operator', 'Service', 'EPGUpdater'].filter(candidate => candidate !== role)) {
                expect(result.roleContents[role]).not.toContain(`ROLE_ACCEPTANCE_MARKER_${otherRole}`);
            }
        }
        expect(result.oldContents).toContain('ACTIVE_BEFORE_EDIT');
        expect(result.oldContents).toContain('ACTIVE_AFTER_EDIT');
        expect(result.oldContents).not.toContain('ACTIVE_AFTER_REINITIALIZE');
        expect(result.nextBeforeReinitialize).toBe('');
        expect(result.nextContents).toContain('ACTIVE_AFTER_REINITIALIZE');
        expect(cleanupEvidence).toEqual({
            remainingChildProcesses: 0,
            remainingListeners: 0,
            remainingTimers: 0,
            remainingTempResources: 0,
        });
    }, 45_000);

    it('[OL-SPEC-ROTATION-CONFIG] passes capacity and retention from the synthetic YAML', () => {
        let captured: Log4jsConfiguration | undefined;
        vi.spyOn(log4js, 'configure').mockImplementation(configuration => {
            captured = configuration;
            return log4js;
        });
        vi.spyOn(log4js, 'getLogger').mockImplementation(category => ({ category }) as Logger);

        new LoggerModel().initialize(resolve(inventoryFixture));

        const appender = (captured as { readonly appenders: Record<string, Record<string, unknown>> } | undefined)
            ?.appenders.system;
        expect(appender).toMatchObject({ backups: 2, maxLogSize: 1_024, pattern: '-yyyy-MM-dd', type: 'file' });
        expect(String(appender?.filename)).toContain(join('logs', 'Service', 'system.log'));
    });
});

describe('operational logging fatal and supervisor acceptance contracts', () => {
    it('[OL-SPEC-FATAL-OBSERVERS] keeps uncaught and rejected events in separate fatal records', async () => {
        const session = await spawnCompiledChildScenario({
            name: 'acceptance-fatal-observers',
            source: fatalObserverAcceptanceChildSource,
        });
        let cleanupEvidence: ChildHarnessCleanupEvidence | undefined;
        try {
            await session.waitForClose();
        } finally {
            cleanupEvidence = await cleanupSession(session);
        }
        expect(session.events).toContainEqual(expect.objectContaining({ type: 'exit', code: 0, signal: null }));
        expect(session.stderr).toBe('');
        const result = parseAcceptanceResult(session.stdout) as {
            readonly records: readonly { readonly category: string; readonly level: string; readonly value: string }[];
            readonly residualListeners: number;
        };
        expect(result.records).toEqual([
            {
                category: 'system',
                level: 'fatal',
                value: 'uncaughtException: Error: SYNTHETIC_UNCAUGHT_ACCEPTANCE',
            },
            {
                category: 'system',
                level: 'fatal',
                value: 'unhandledRejection: Error: SYNTHETIC_REJECTION_ACCEPTANCE',
            },
        ]);
        expect(result.residualListeners).toBe(0);
        expect(cleanupEvidence).toEqual({
            remainingChildProcesses: 0,
            remainingListeners: 0,
            remainingTimers: 0,
            remainingTempResources: 0,
        });
    });

    it('[OL-SPEC-SUPERVISOR] records the compiled EPG terminal classification and error detail', async () => {
        const session = await spawnCompiledChildScenario({
            name: 'acceptance-supervisor-terminal',
            source: supervisorAcceptanceChildSource,
        });
        let cleanupEvidence: ChildHarnessCleanupEvidence | undefined;
        try {
            await session.waitForClose();
        } finally {
            cleanupEvidence = await cleanupSession(session);
        }
        expect(session.events).toContainEqual(expect.objectContaining({ type: 'exit', code: 0, signal: null }));
        expect(session.stderr).toBe('');
        const result = parseAcceptanceResult(session.stdout) as {
            readonly records: readonly { readonly category: string; readonly level: string; readonly value: string }[];
        };
        expect(result.records).toEqual([
            { category: 'system', level: 'fatal', value: 'epg updater is error' },
            { category: 'system', level: 'error', value: 'Error: SYNTHETIC_EPG_ACCEPTANCE_ERROR' },
        ]);
        expect(cleanupEvidence).toEqual({
            remainingChildProcesses: 0,
            remainingListeners: 0,
            remainingTimers: 0,
            remainingTempResources: 0,
        });
    });

    it('[OL-SPEC-LOGGER-EFFECTS] records through real LoggerModel without logger-owned lifecycle effects', async () => {
        const session = await spawnCompiledChildScenario({
            name: 'acceptance-real-logger-effects',
            source: realLoggerEffectChildSource,
        });
        let cleanupEvidence: ChildHarnessCleanupEvidence | undefined;
        try {
            await session.waitForClose();
        } finally {
            cleanupEvidence = await cleanupSession(session);
        }
        expect(session.events).toContainEqual(expect.objectContaining({ type: 'exit', code: 0, signal: null }));
        expect(session.stdout).toContain('REAL_LOGGER_FATAL_ACCEPTANCE');
        expect(session.stdout).toContain('REAL_LOGGER_ERROR_ACCEPTANCE');
        const result = parseAcceptanceResult(session.stdout) as {
            readonly effects: {
                readonly exit: number;
                readonly fork: number;
                readonly signal: number;
                readonly spawn: number;
                readonly wait: number;
            };
        };
        expect(result.effects).toEqual({ exit: 0, fork: 0, signal: 0, spawn: 0, wait: 0 });
        expect(cleanupEvidence).toEqual({
            remainingChildProcesses: 0,
            remainingListeners: 0,
            remainingTimers: 0,
            remainingTempResources: 0,
        });
    });
});
