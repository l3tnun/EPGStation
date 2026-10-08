// Must stay the very first import in this file: it registers a Node loader hook that has to be in
// place before `require(join(compiledSnapshot, 'model', 'Configuration.js'))` below can trigger
// `ConfigurationFileAccess.js` being loaded for the first time. See the comment in that file for why.
import { configFsOverrides, resetConfigFsOverrides } from './fs-override-hook';

import 'reflect-metadata';

import * as childProcess from 'child_process';
import * as nodeChildProcess from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { dump as yamlDump } from 'js-yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';

const processExecutionStubs = vi.hoisted(() => ({
    spawn: vi.fn(() => {
        throw new Error('Unexpected process execution through spawn');
    }),
    exec: vi.fn(() => {
        throw new Error('Unexpected process execution through exec');
    }),
    execFile: vi.fn(() => {
        throw new Error('Unexpected process execution through execFile');
    }),
}));

vi.mock('child_process', () => processExecutionStubs);
vi.mock('node:child_process', () => processExecutionStubs);

interface ConfigurationRuntime {
    config: Record<string, unknown>;
    directoryFormatting(directory: string): string;
    formatConfig(config: Record<string, unknown>): Record<string, unknown>;
    getConfig(): Record<string, unknown>;
    log: { system: { fatal: ReturnType<typeof vi.fn> } };
    templateConfig: Record<string, unknown> | null;
}

interface ConfigurationConstructor {
    new (loggerModel: { getLogger(): ConfigurationLogger }): ConfigurationRuntime;
    readonly DEFAULT_VALUE: Record<string, unknown>;
    readonly PENDING_QUEUE_SAFETY_LIMIT: number;
    readonly ROOT_PATH: string;
    readonly SETTIMEOUT_DELAY_MAX_MS: number;
    readonly prototype: object;
}

interface ConfigurationLogger {
    readonly stream: { warn: ReturnType<typeof vi.fn> };
    readonly system: {
        error: ReturnType<typeof vi.fn>;
        fatal: ReturnType<typeof vi.fn>;
        info: ReturnType<typeof vi.fn>;
        warn: ReturnType<typeof vi.fn>;
    };
}

interface ProcessUtilRuntime {
    readonly ROOT_PATH: string;
    parseCmdStr(command: string): { bin: string; args: string[] };
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required');
}

const Configuration = (
    require(join(compiledSnapshot, 'model', 'Configuration.js')) as { default: ConfigurationConstructor }
).default;
const ProcessUtil = (require(join(compiledSnapshot, 'util', 'ProcessUtil.js')) as { default: ProcessUtilRuntime })
    .default;

const processExecutionEntrances = [
    ['spawn', childProcess.spawn, nodeChildProcess.spawn, processExecutionStubs.spawn],
    ['exec', childProcess.exec, nodeChildProcess.exec, processExecutionStubs.exec],
    ['execFile', childProcess.execFile, nodeChildProcess.execFile, processExecutionStubs.execFile],
] as const;

const clearProcessExecutionLedger = (): void => {
    processExecutionStubs.spawn.mockClear();
    processExecutionStubs.exec.mockClear();
    processExecutionStubs.execFile.mockClear();
};

const expectNoProcessExecution = (): void => {
    for (const [_name, childProcessEntrance, nodeChildProcessEntrance, stub] of processExecutionEntrances) {
        expect(childProcessEntrance).toBe(stub);
        expect(nodeChildProcessEntrance).toBe(stub);
        expect(stub).not.toHaveBeenCalled();
    }
};

const createConfiguration = (): ConfigurationRuntime => {
    const configuration = Object.create(Configuration.prototype) as ConfigurationRuntime;
    configuration.log = { system: { fatal: vi.fn() } };
    configuration.templateConfig = null;
    return configuration;
};

const createLogger = (): ConfigurationLogger => ({
    stream: { warn: vi.fn() },
    system: { error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
});

const unnormalizedSubDirectory = 'synthetic//nested/';

const loopbackApiServer = (port: number): string => ['http:', '', `localhost:${port}`].join('/');
const rooted = (value: string): string => ['', value].join('/');

type ProviderNumericField =
    | 'encodeQueueLimit'
    | 'concurrentUploadNum'
    | 'uploadReceiveTimeoutMs'
    | 'thumbnailMaxPending'
    | 'hookCommandMaxPending'
    | 'hookCommandTimeoutMs';

interface ProviderNumericPolicy {
    readonly field: ProviderNumericField;
    readonly defaultValue: number;
    readonly maximum: number;
}

const providerNumericPolicies: readonly ProviderNumericPolicy[] = [
    { field: 'encodeQueueLimit', defaultValue: 1024, maximum: Number.MAX_SAFE_INTEGER },
    { field: 'concurrentUploadNum', defaultValue: 3, maximum: Number.MAX_SAFE_INTEGER },
    { field: 'uploadReceiveTimeoutMs', defaultValue: 300_000, maximum: 2_147_483_647 },
    { field: 'thumbnailMaxPending', defaultValue: 32, maximum: 10_000 },
    { field: 'hookCommandMaxPending', defaultValue: 64, maximum: 10_000 },
    { field: 'hookCommandTimeoutMs', defaultValue: 300_000, maximum: 2_147_483_647 },
];

const acceptedProviderNumericValues: Array<[label: string, field: ProviderNumericField, value: number]> =
    providerNumericPolicies.flatMap(({ field, maximum }) => [
        ['minimum', field, 1],
        ['maximum', field, maximum],
    ]);

const rejectedProviderNumericValues: Array<[label: string, field: ProviderNumericField, value: unknown]> =
    providerNumericPolicies.flatMap(({ field, maximum }) => [
        ['zero', field, 0],
        ['negative', field, -1],
        ['fraction', field, 1.5],
        ['numeric string', field, '1'],
        ['NaN', field, Number.NaN],
        ['positive infinity', field, Number.POSITIVE_INFINITY],
        ['negative infinity', field, Number.NEGATIVE_INFINITY],
        ['over maximum', field, maximum + 1],
    ]);

const cloneCandidate = (): Record<string, any> => ({
    port: 48100,
    apiServers: [],
    recorded: [
        { name: 'tmp', path: `%ROOT%${sep}temporary${sep}` },
        { name: 'archive', path: `%ROOT%${sep}archive${sep}` },
        { name: 'tmp-by-path-only', path: `%ROOT%${sep}tmp${sep}` },
    ],
    recordedTmp: `%ROOT%${sep}buffer${sep}`,
    thumbnail: `%ROOT%${sep}thumbnail${sep}`,
    streamFilePath: `%ROOT%${sep}streams${sep}`,
    subDirectory: unnormalizedSubDirectory,
    encode: [{ name: 'encode-a', cmd: 'command-a' }],
    stream: { live: { ts: { m2ts: [{ name: 'live-a' }] } } },
    urlscheme: { m2ts: {}, video: {}, download: {} },
});

const reloadCandidate = (port: number, recordedName: string): string =>
    yamlDump({
        ...cloneCandidate(),
        port,
        apiServers: [],
        recorded: [{ name: recordedName, path: `%ROOT%${sep}${recordedName}${sep}` }],
        subDirectory: `/${recordedName}/`,
    });

const installReloadDouble = (initialYaml: string): { readonly watchFile: ReturnType<typeof vi.fn> } => {
    configFsOverrides.readFileSync = vi.fn(() => initialYaml);
    const watchFile = vi.fn();
    configFsOverrides.watchFile = watchFile;
    return { watchFile };
};

afterEach(() => {
    resetConfigFsOverrides();
    vi.restoreAllMocks();
});

describe('server configuration implementation characterization', () => {
    it('[CFG-4.1-DEFAULTS] installs the six numeric defaults without converting them', () => {
        const configuration = createConfiguration();
        configuration.config = configuration.formatConfig(cloneCandidate());
        const snapshot = configuration.getConfig();

        for (const { field, defaultValue } of providerNumericPolicies) {
            expect(Configuration.DEFAULT_VALUE[field]).toBe(defaultValue);
            expect(snapshot[field]).toBe(defaultValue);
            expect(typeof snapshot[field]).toBe('number');
        }
    });

    it('[CFG-4.1-LIMIT-CONSTANTS] pins the named limit constants formatConfig validates uploadReceiveTimeoutMs/hookCommandTimeoutMs and thumbnailMaxPending/hookCommandMaxPending against', () => {
        expect(Configuration.SETTIMEOUT_DELAY_MAX_MS).toBe(2_147_483_647);
        expect(Configuration.PENDING_QUEUE_SAFETY_LIMIT).toBe(10_000);
    });

    it.each(acceptedProviderNumericValues)(
        '[CFG-4.1-BOUNDARY] preserves the accepted %s for %s exactly',
        (_label, field, value) => {
            const configuration = createConfiguration();

            const formatted = configuration.formatConfig({ ...cloneCandidate(), [field]: value });

            expect(formatted[field]).toBe(value);
        },
    );

    it.each(rejectedProviderNumericValues)(
        '[CFG-4.1-INVALID] rejects %s for %s without rounding or conversion',
        (_label, field, value) => {
            const configuration = createConfiguration();

            expect(() => configuration.formatConfig({ ...cloneCandidate(), [field]: value })).toThrow(
                `ConfigValueError:${field}`,
            );
        },
    );

    it('[CFG-2.1-DEFERRED-ATOMIC-RELOAD] exposes only the old clone while reading and replaces the complete internal reference once', async () => {
        const { watchFile } = installReloadDouble(reloadCandidate(48100, 'old-generation'));
        const logger = createLogger();
        const configuration = new Configuration({ getLogger: () => logger });
        const oldInternalReference = configuration.config;
        const acquiredBeforeReload = configuration.getConfig();
        let resolveRead!: (source: string) => void;
        configFsOverrides.readFile = vi.fn(
            () =>
                new Promise<string>(resolve => {
                    resolveRead = resolve;
                }),
        );
        const changeListener = watchFile.mock.calls[0][1] as () => Promise<void>;

        const pendingReload = changeListener();
        const acquiredWhileReading = configuration.getConfig();

        expect(acquiredWhileReading).toEqual(acquiredBeforeReload);
        expect(acquiredWhileReading).not.toBe(acquiredBeforeReload);
        expect(configuration.config).toBe(oldInternalReference);

        resolveRead(reloadCandidate(48200, 'new-generation'));
        await pendingReload;

        expect(configuration.config).not.toBe(oldInternalReference);
        expect(configuration.getConfig()).toMatchObject({
            port: 48200,
            apiServers: [loopbackApiServer(48200)],
            recorded: [{ name: 'new-generation', path: `${Configuration.ROOT_PATH}${sep}new-generation` }],
            subDirectory: rooted('new-generation'),
        });
        expect(acquiredBeforeReload).toMatchObject({
            port: 48100,
            recorded: [{ name: 'old-generation' }],
        });
    });

    it('[CFG-6.2-RELOAD-COMPLETION-ORDER] records duplicate notifications and late settlement without defining a winner policy', async () => {
        const { watchFile } = installReloadDouble(reloadCandidate(48100, 'old-generation'));
        const configuration = new Configuration({ getLogger: () => createLogger() });
        const resolvers: Array<(source: string) => void> = [];
        configFsOverrides.readFile = vi.fn(
            () =>
                new Promise<string>(resolve => {
                    resolvers.push(resolve);
                }),
        );
        const changeListener = watchFile.mock.calls[0][1] as () => Promise<void>;

        const firstNotification = changeListener();
        const duplicateNotification = changeListener();
        expect(configFsOverrides.readFile).toHaveBeenCalledTimes(2);
        expect(configuration.getConfig()).toMatchObject({ port: 48100 });

        resolvers[1](reloadCandidate(48300, 'second-completion-first'));
        await duplicateNotification;
        expect(configuration.getConfig()).toMatchObject({ port: 48300 });

        resolvers[0](reloadCandidate(48200, 'first-completion-late'));
        await firstNotification;
        expect(configuration.getConfig()).toMatchObject({ port: 48200 });
    });

    it('[CFG-2.2-FAILED-CANDIDATES] discards read, YAML, and format failures, logs them, and keeps watching', async () => {
        const { watchFile } = installReloadDouble(reloadCandidate(48100, 'stable-generation'));
        const logger = createLogger();
        const configuration = new Configuration({ getLogger: () => logger });
        const stableInternalReference = configuration.config;
        const stableSnapshot = configuration.getConfig();
        const snapshotConsumer = {
            snapshot: stableSnapshot,
            stop: vi.fn(),
            restart: vi.fn(),
            updateNotification: vi.fn(),
        };
        expect(Object.values(configuration)).not.toContain(snapshotConsumer);
        expect(Object.getOwnPropertyNames(Configuration.prototype).sort()).toEqual([
            'assertIntegerInRange',
            'assertPositiveSafeInteger',
            'constructor',
            'directoryFormatting',
            'formatConfig',
            'getConfig',
            'readConfig',
            'setTemplateValues',
        ]);
        const invalidMinimum = yamlDump({ ...cloneCandidate(), port: undefined, https: undefined });
        const readFile = vi
            .fn()
            .mockRejectedValueOnce(new Error('synthetic read failure'))
            .mockResolvedValueOnce('port: [')
            .mockResolvedValueOnce(invalidMinimum)
            .mockResolvedValueOnce(reloadCandidate(48200, 'recovered-generation'));
        configFsOverrides.readFile = readFile;
        const changeListener = watchFile.mock.calls[0][1] as () => Promise<void>;

        for (let failureIndex = 1; failureIndex <= 3; failureIndex += 1) {
            await changeListener();
            expect(configuration.config).toBe(stableInternalReference);
            expect(configuration.getConfig()).toEqual(stableSnapshot);
            expect(logger.system.error).toHaveBeenCalledTimes(failureIndex * 2);
            expect(snapshotConsumer.snapshot).toEqual(stableSnapshot);
            expect(snapshotConsumer.stop).not.toHaveBeenCalled();
            expect(snapshotConsumer.restart).not.toHaveBeenCalled();
            expect(snapshotConsumer.updateNotification).not.toHaveBeenCalled();
        }

        await changeListener();
        expect(configuration.config).not.toBe(stableInternalReference);
        expect(configuration.getConfig()).toMatchObject({
            port: 48200,
            recorded: [{ name: 'recovered-generation' }],
        });
        expect(stableSnapshot).toMatchObject({
            port: 48100,
            recorded: [{ name: 'stable-generation' }],
        });
        expect(snapshotConsumer.snapshot).toBe(stableSnapshot);
        expect(snapshotConsumer.stop).not.toHaveBeenCalled();
        expect(snapshotConsumer.restart).not.toHaveBeenCalled();
        expect(snapshotConsumer.updateNotification).not.toHaveBeenCalled();
        expect(readFile).toHaveBeenCalledTimes(4);
        expect(watchFile).toHaveBeenCalledTimes(1);
    });

    it('[CFG-1.1-PATH-NORMALIZATION] replaces the first root marker and removes one trailing separator', () => {
        const configuration = createConfiguration();
        const input = `%ROOT%${sep}archive%ROOT%${sep}${sep}`;

        const formatted = configuration.directoryFormatting(input);

        expect(formatted).toBe(`${Configuration.ROOT_PATH}${sep}archive%ROOT%${sep}`);
        expect(formatted.split('%ROOT%')).toHaveLength(2);
    });

    it('[CFG-1.1-SUBDIRECTORY-NORMALIZATION] adds the leading slash and removes exactly one trailing slash', () => {
        const configuration = createConfiguration();
        const formatted = configuration.formatConfig(cloneCandidate());

        expect(formatted.subDirectory).toBe(rooted('synthetic//nested'));
        expect(formatted.subDirectory).toBe(`/${unnormalizedSubDirectory.slice(0, -1)}`);
        expect((formatted.recorded as Array<Record<string, string>>).map(entry => entry.name)).toEqual([
            'archive',
            'tmp-by-path-only',
        ]);
        expect((formatted.recorded as Array<Record<string, string>>)[0].path).toBe(
            `${Configuration.ROOT_PATH}${sep}archive`,
        );
        expect(formatted.recordedTmp).toBe(`${Configuration.ROOT_PATH}${sep}buffer`);
        expect(formatted.thumbnail).toBe(`${Configuration.ROOT_PATH}${sep}thumbnail`);
        expect(formatted.streamFilePath).toBe(`${Configuration.ROOT_PATH}${sep}streams`);
    });

    it('[CFG-1.2-DEEP-CLONE] shares no nested array or object references across snapshots or internal state', () => {
        const configuration = createConfiguration();
        configuration.config = configuration.formatConfig(cloneCandidate());

        const first = configuration.getConfig() as Record<string, any>;
        const second = configuration.getConfig() as Record<string, any>;
        first.recorded[0].path = 'mutated-path';
        first.encode.push({ name: 'mutated-encode', cmd: 'mutated-command' });
        first.stream.live.ts.m2ts[0].name = 'mutated-stream';
        first.urlscheme.m2ts.ios = 'mutated-url';

        expect(second.recorded[0].path).toBe(`${Configuration.ROOT_PATH}${sep}archive`);
        expect(second.encode).toEqual([{ name: 'encode-a', cmd: 'command-a' }]);
        expect(second.stream.live.ts.m2ts).toEqual([{ name: 'live-a' }]);
        expect(second.urlscheme.m2ts).toEqual({});
        expect(configuration.getConfig()).toEqual(second);
    });

    it('[CFG-3.2-LITERAL-SPACES] preserves tabs and shell metacharacters as literal path and arguments', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'epgstation-config-command-'));
        const executable = join(temporaryDirectory, 'synthetic\texecutable');
        await writeFile(executable, 'synthetic executable fixture', { mode: 0o700 });
        clearProcessExecutionLedger();

        try {
            expect(ProcessUtil.parseCmdStr(`${executable}   first\tsecond  ;  $(synthetic-command)  *`)).toEqual({
                bin: executable,
                args: ['first\tsecond', ';', '$(synthetic-command)', '*'],
            });
            expectNoProcessExecution();
        } finally {
            await rm(temporaryDirectory, { force: true, recursive: true });
        }
    });

    it('[CFG-3.2-TOKENS] replaces NODE in bin and ROOT and SPACE in ordered arguments', () => {
        const parsed = ProcessUtil.parseCmdStr('%NODE% --root=%ROOT% hello%SPACE%synthetic');

        expect(parsed).toEqual({
            bin: process.argv[0],
            args: [`--root=${ProcessUtil.ROOT_PATH}`, 'hello synthetic'],
        });
        expect(isAbsolute(parsed.bin)).toBe(true);
        expect(relative(ProcessUtil.ROOT_PATH, parsed.args[0].slice('--root='.length))).toBe('');
    });

    it('[CFG-3.2-MISSING-BIN] rejects a missing executable before returning arguments or spawning', () => {
        const missingExecutable = join(tmpdir(), `epgstation-config-command-missing-${process.pid}-${Date.now()}`);
        clearProcessExecutionLedger();

        expect(() => ProcessUtil.parseCmdStr(`${missingExecutable} ignored-argument`)).toThrow('CmdBinIsNotFound');
        expectNoProcessExecution();
    });
});
