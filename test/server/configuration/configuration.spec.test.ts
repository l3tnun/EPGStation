import 'reflect-metadata';

import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { dump as yamlDump, load as yamlLoad } from 'js-yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface ConfigurationRuntime {
    config: Record<string, unknown>;
    formatConfig(config: Record<string, unknown>): Record<string, unknown>;
    getConfig(): Record<string, unknown>;
    log: { system: { fatal: ReturnType<typeof vi.fn> } };
    templateConfig: Record<string, unknown> | null;
}

interface ConfigurationConstructor {
    new (loggerModel: { getLogger(): ConfigurationLogger }): ConfigurationRuntime;
    readonly CONFIG_YAML_OPTIONS: Parameters<typeof yamlDump>[1];
    readonly DEFAULT_VALUE: Record<string, unknown>;
    readonly ROOT_PATH: string;
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

interface MutableFileSystem {
    promises: { readFile: (...args: unknown[]) => Promise<unknown> };
    readFileSync: (...args: unknown[]) => unknown;
    watchFile: (...args: unknown[]) => unknown;
}

interface PublicConfigModel {
    getConfig(isSecure: boolean): Promise<Record<string, unknown>>;
}

interface PublicConfigModelConstructor {
    new (
        configuration: { getConfig(): Record<string, unknown> },
        ipc: { reserveation: { getBroadcastStatus(): Promise<Record<string, boolean>> } },
    ): PublicConfigModel;
}

interface ProcessUtilRuntime {
    parseCmdStr(command: string): { bin: string; args: string[] };
}

const require = createRequire(join(process.cwd(), 'package.json'));
const mutableFileSystem = require('node:fs') as MutableFileSystem;
const originalReadFile = mutableFileSystem.promises.readFile;
const originalReadFileSync = mutableFileSystem.readFileSync;
const originalWatchFile = mutableFileSystem.watchFile;
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required');
}

/*
 * server は ESM へ移行済みで、Configuration.js の `import * as fs from 'fs'` は静的に解決されるため、
 * `require('node:fs')` で得た名前空間を後から書き換えても Configuration.js 側には届かない
 * (in-process の名前空間差し替えが効かない)。`vi.doMock('node:fs', ...)` で Configuration.js が
 * import する 'fs' 自体を、常に `mutableFileSystem` の現在値へ委譲するラッパーに差し替えたうえで
 * `vi.resetModules()` してから動的 `import()` で読み直す。一度この束縛を確立すれば、以降の
 * `mutableFileSystem.readFileSync = vi.fn(...)` のような各 test の差し替えは委譲先の値を書き換える
 * だけで Configuration.js 実行時にも反映される。
 */
const loadConfiguration = async (): Promise<ConfigurationConstructor> => {
    vi.doMock('node:fs', () => ({
        readFileSync: (...arguments_: unknown[]) => (mutableFileSystem.readFileSync as any)(...arguments_),
        watchFile: (...arguments_: unknown[]) => (mutableFileSystem.watchFile as any)(...arguments_),
        unwatchFile: (...arguments_: unknown[]) => (mutableFileSystem as any).unwatchFile?.(...arguments_),
        promises: {
            readFile: (...arguments_: unknown[]) => mutableFileSystem.promises.readFile(...arguments_),
        },
    }));
    try {
        vi.resetModules();
        const imported = (await import(join(compiledSnapshot, 'model', 'Configuration.js'))) as {
            default: ConfigurationConstructor;
        };
        return imported.default;
    } finally {
        vi.doUnmock('node:fs');
    }
};

const Configuration = await loadConfiguration();
const ConfigApiModel = (
    require(join(compiledSnapshot, 'model', 'api', 'config', 'ConfigApiModel.js')) as {
        default: PublicConfigModelConstructor;
    }
).default;
const ProcessUtil = (require(join(compiledSnapshot, 'util', 'ProcessUtil.js')) as { default: ProcessUtilRuntime })
    .default;

const fixturePath = join(process.cwd(), 'test/server/fixtures/configuration/characterization.synthetic.yml');

const providerNumericDefaults = {
    encodeQueueLimit: 1024,
    concurrentUploadNum: 3,
    uploadReceiveTimeoutMs: 300_000,
    thumbnailMaxPending: 32,
    hookCommandMaxPending: 64,
    hookCommandTimeoutMs: 300_000,
} as const;

const providerNumericFields = Object.keys(providerNumericDefaults) as Array<keyof typeof providerNumericDefaults>;

const loopbackApiServer = (port: number): string => ['http:', '', `localhost:${port}`].join('/');
const rooted = (value: string): string => ['', value].join('/');

const readCandidate = (): Record<string, unknown> =>
    yamlLoad(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;

const createLogger = (): ConfigurationLogger => ({
    stream: { warn: vi.fn() },
    system: { error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
});

const yamlCandidate = (variant: 'both' | 'http' | 'https' | 'invalid-minimum'): string => {
    const candidate = readCandidate();
    if (variant === 'https' || variant === 'invalid-minimum') {
        delete candidate.port;
    }
    if (variant === 'https' || variant === 'both') {
        candidate.https = {
            port: 48443,
            key: 'synthetic-key.pem',
            cert: 'synthetic-cert.pem',
        };
    }
    return yamlDump(candidate);
};

const reloadCandidate = (port: number, recordedName: string, overrides: Record<string, unknown> = {}): string => {
    const candidate = readCandidate();
    candidate.port = port;
    candidate.recorded = [{ name: recordedName, path: `%ROOT%/${recordedName}/` }];
    candidate.subDirectory = `/${recordedName}/`;
    Object.assign(candidate, overrides);
    return yamlDump(candidate);
};

const incompleteHttpsCandidate = (https: Record<string, unknown>): string => {
    const candidate = readCandidate();
    delete candidate.port;
    candidate.https = https;
    return yamlDump(candidate);
};

const installInitialReadDouble = (configRead: () => string): ReturnType<typeof vi.fn> => {
    mutableFileSystem.readFileSync = vi.fn((path: unknown) => {
        if (String(path).endsWith('config.yml.template')) {
            return yamlCandidate('http');
        }
        return configRead();
    });
    const watchFile = vi.fn();
    mutableFileSystem.watchFile = watchFile;
    return watchFile;
};

afterEach(() => {
    mutableFileSystem.promises.readFile = originalReadFile;
    mutableFileSystem.readFileSync = originalReadFileSync;
    mutableFileSystem.watchFile = originalWatchFile;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

const withEnvEntries = (entries: string[]): string => `${yamlCandidate('http')}${entries.join('\n')}\n`;

const createConfiguration = (templateConfig: Record<string, unknown> | null): ConfigurationRuntime => {
    const configuration = Object.create(Configuration.prototype) as ConfigurationRuntime;
    configuration.log = { system: { fatal: vi.fn() } };
    configuration.templateConfig = templateConfig;
    return configuration;
};

const streamTemplate = (): Record<string, unknown> => ({
    stream: {
        live: {
            ts: {
                m2ts: [{ name: 'template-m2ts' }],
                m2tsll: [{ name: 'template-m2tsll', cmd: 'template-command' }],
                webm: [{ name: 'template-live-webm', cmd: 'template-command' }],
                mp4: [{ name: 'template-live-mp4', cmd: 'template-command' }],
                hls: [{ name: 'template-live-hls', cmd: 'template-command' }],
            },
        },
        recorded: {
            ts: {
                webm: [{ name: 'template-recorded-webm', cmd: 'template-command' }],
                mp4: [{ name: 'template-recorded-mp4', cmd: 'template-command' }],
                hls: [{ name: 'template-recorded-hls', cmd: 'template-command' }],
            },
            encoded: {
                webm: [{ name: 'template-encoded-webm', cmd: 'template-command' }],
                mp4: [{ name: 'template-encoded-mp4', cmd: 'template-command' }],
                hls: [{ name: 'template-encoded-hls', cmd: 'template-command' }],
            },
        },
    },
});

const publicSourceConfig = (): Record<string, unknown> => ({
    port: 48100,
    socketioPort: 48101,
    clientSocketioPort: 48102,
    https: {
        port: 48443,
        socketioPort: 48444,
        key: 'synthetic-private-key-marker',
        cert: 'synthetic-certificate-marker',
    },
    recorded: [
        { name: 'archive-a', path: 'synthetic-internal-path-marker/a' },
        { name: 'archive-b', path: 'synthetic-internal-path-marker/b' },
    ],
    encode: [
        { name: 'encode-a', cmd: 'external-command-marker' },
        { name: 'encode-b', cmd: 'external-command-marker' },
    ],
    urlscheme: {
        m2ts: { ios: 'm2ts-ios', android: 'm2ts-android', mac: 'm2ts-mac', win: 'm2ts-win' },
        video: { ios: 'video-ios', android: 'video-android', mac: 'video-mac', win: 'video-win' },
        download: { ios: 'download-ios', android: 'download-android', mac: 'download-mac', win: 'download-win' },
    },
    stream: streamTemplate().stream,
    kodiHosts: [
        { name: 'living-room', host: 'internal-host-marker', password: 'synthetic-database-secret-marker' },
        { name: 'tablet', host: 'internal-host-marker' },
    ],
    mysql: { password: 'synthetic-database-secret-marker' },
    authenticationPassword: 'synthetic-authentication-secret-marker',
    streamFilePath: 'synthetic-internal-path-marker/stream',
    thumbnailCmd: 'external-command-marker',
    encodeQueueLimit: 1024,
    concurrentUploadNum: 3,
    uploadReceiveTimeoutMs: 300_000,
    thumbnailMaxPending: 32,
    hookCommandMaxPending: 64,
    hookCommandTimeoutMs: 300_000,
    storageLimitCommandTimeoutMs: { marker: 'storage-timeout-carrier-marker' },
    syntheticInternalField: 'synthetic-internal-marker',
});

const createPublicModel = (config: Record<string, unknown>): PublicConfigModel =>
    new ConfigApiModel(
        { getConfig: () => JSON.parse(JSON.stringify(config)) as Record<string, unknown> },
        {
            reserveation: {
                getBroadcastStatus: async () => ({ GR: true, BS: false, CS: true, SKY: false }),
            },
        },
    );

const missingStreamParentCases: Array<
    [
        label: string,
        removeParent: (stream: Record<string, any>) => void,
        readParent: (stream: Record<string, any>) => unknown,
    ]
> = [
    [
        'live',
        stream => {
            delete stream.live;
        },
        stream => stream.live,
    ],
    [
        'live.ts',
        stream => {
            delete stream.live.ts;
        },
        stream => stream.live.ts,
    ],
    [
        'recorded',
        stream => {
            delete stream.recorded;
        },
        stream => stream.recorded,
    ],
    [
        'recorded.ts',
        stream => {
            delete stream.recorded.ts;
        },
        stream => stream.recorded.ts,
    ],
    [
        'recorded.encoded',
        stream => {
            delete stream.recorded.encoded;
        },
        stream => stream.recorded.encoded,
    ],
];

describe('server configuration characterization contract', () => {
    it.each([
        ['HTTP only', 'http', 48100],
        ['HTTPS only', 'https', undefined],
        ['HTTP and HTTPS', 'both', 48100],
    ] as const)('[CFG-1.3-MINIMUM-SUCCESS] provides a complete configuration for %s', (_label, variant, port) => {
        const watchFile = installInitialReadDouble(() => yamlCandidate(variant));
        const logger = createLogger();

        const configuration = new Configuration({ getLogger: () => logger });
        const provided = configuration.getConfig();

        expect(provided.port).toBe(port);
        if (variant !== 'http') {
            expect(provided.https).toEqual({
                port: 48443,
                key: 'synthetic-key.pem',
                cert: 'synthetic-cert.pem',
            });
        }
        expect(watchFile).toHaveBeenCalledTimes(1);
        expect(logger.system.info).toHaveBeenCalledWith('config.yml read success');
    });

    it.each([
        ['missing', 'ENOENT'],
        ['unreadable', 'EACCES'],
    ])(
        '[CFG-1.3-INITIAL-READ-FAILURE] exits before watch or configuration provision when file is %s',
        (_label, code) => {
            const watchFile = installInitialReadDouble(() => {
                throw Object.assign(new Error(`synthetic ${code}`), { code });
            });
            const logger = createLogger();
            const exit = vi.spyOn(process, 'exit').mockImplementation(exitCode => {
                throw new Error(`SyntheticProcessExit:${String(exitCode)}`);
            });

            expect(() => new Configuration({ getLogger: () => logger })).toThrow('SyntheticProcessExit:1');
            expect(exit).toHaveBeenCalledOnce();
            expect(watchFile).not.toHaveBeenCalled();
            expect(logger.system.fatal).toHaveBeenCalledOnce();
        },
    );

    it.each([
        ['invalid YAML', () => 'port: ['],
        ['missing HTTP and complete HTTPS', () => yamlCandidate('invalid-minimum')],
        [
            'HTTPS without port',
            () => incompleteHttpsCandidate({ key: 'synthetic-key.pem', cert: 'synthetic-cert.pem' }),
        ],
        ['HTTPS without key', () => incompleteHttpsCandidate({ port: 48443, cert: 'synthetic-cert.pem' })],
        ['HTTPS without certificate', () => incompleteHttpsCandidate({ port: 48443, key: 'synthetic-key.pem' })],
    ])('[CFG-1.3-INVALID-CANDIDATE] rejects %s before watch or configuration provision', (_label, configRead) => {
        const watchFile = installInitialReadDouble(configRead);
        const logger = createLogger();
        const exit = vi.spyOn(process, 'exit').mockImplementation(exitCode => {
            throw new Error(`UnexpectedSyntheticProcessExit:${String(exitCode)}`);
        });

        expect(() => new Configuration({ getLogger: () => logger })).toThrow();
        expect(exit).not.toHaveBeenCalled();
        expect(watchFile).not.toHaveBeenCalled();
    });

    it('[CFG-2.1-RELOAD-SUCCESS] switches later requests to one complete normalized generation', async () => {
        const watchFile = installInitialReadDouble(() => reloadCandidate(48100, 'old-generation'));
        const logger = createLogger();
        const configuration = new Configuration({ getLogger: () => logger });
        const acquiredBeforeReload = configuration.getConfig();
        const reloadedNumericValues = {
            encodeQueueLimit: 2048,
            concurrentUploadNum: 4,
            uploadReceiveTimeoutMs: 400_000,
            thumbnailMaxPending: 48,
            hookCommandMaxPending: 96,
            hookCommandTimeoutMs: 450_000,
        };
        mutableFileSystem.promises.readFile = vi.fn(async () =>
            reloadCandidate(48200, 'new-generation', reloadedNumericValues),
        );
        const changeListener = watchFile.mock.calls[0][1] as () => Promise<void>;

        await changeListener();

        expect(acquiredBeforeReload).toMatchObject({
            port: 48100,
            recorded: [{ name: 'old-generation' }],
            subDirectory: rooted('old-generation'),
            ...providerNumericDefaults,
        });
        expect(configuration.getConfig()).toMatchObject({
            port: 48200,
            apiServers: [loopbackApiServer(48200)],
            recorded: [{ name: 'new-generation' }],
            subDirectory: rooted('new-generation'),
            ...reloadedNumericValues,
        });
        expect(acquiredBeforeReload).toMatchObject(providerNumericDefaults);
        expect(logger.system.info).toHaveBeenCalledWith('updated config file');
    });

    it('[CFG-1.1-ENV-EXPANSION] replaces an !env value with the environment variable as a string', () => {
        vi.stubEnv('EPGS_SYNTHETIC_DB_USER', 'synthetic-user');
        vi.stubEnv('EPGS_SYNTHETIC_DB_PORT', '3307');
        vi.stubEnv('EPGS_SYNTHETIC_EMPTY', '');
        installInitialReadDouble(() =>
            withEnvEntries([
                'mysql:',
                '    user: !env EPGS_SYNTHETIC_DB_USER',
                '    port: !env EPGS_SYNTHETIC_DB_PORT',
                '    database: !env EPGS_SYNTHETIC_EMPTY',
            ]),
        );

        const provided = new Configuration({ getLogger: () => createLogger() }).getConfig();

        expect(provided.mysql).toStrictEqual({ user: 'synthetic-user', port: '3307', database: '' });
    });

    it('[CFG-1.1-MERGE-KEY] merges the entries of an aliased map written with a merge key', () => {
        installInitialReadDouble(() =>
            withEnvEntries([
                'x-base: &base',
                '    host: synthetic-host',
                '    user: synthetic-user',
                'mysql:',
                '    <<: *base',
                '    database: synthetic-database',
            ]),
        );

        const provided = new Configuration({ getLogger: () => createLogger() }).getConfig();

        expect(provided.mysql).toStrictEqual({
            host: 'synthetic-host',
            user: 'synthetic-user',
            database: 'synthetic-database',
        });
    });

    it('[CFG-1.1-MERGE-KEY-MULTIPLE] merges a sequence of aliases and prefers the earlier one', () => {
        installInitialReadDouble(() =>
            withEnvEntries([
                'x-first: &first',
                '    host: synthetic-first-host',
                '    user: synthetic-first-user',
                'x-second: &second',
                '    host: synthetic-second-host',
                '    charset: synthetic-second-charset',
                'mysql:',
                '    <<: [*first, *second]',
            ]),
        );

        const provided = new Configuration({ getLogger: () => createLogger() }).getConfig();

        expect(provided.mysql).toStrictEqual({ host: 'synthetic-first-host', user: 'synthetic-first-user', charset: 'synthetic-second-charset' });
    });

    it('[CFG-1.1-MERGE-KEY-EXPLICIT] prefers an explicitly written entry over the merged one', () => {
        installInitialReadDouble(() =>
            withEnvEntries([
                'x-base: &base',
                '    host: synthetic-merged-host',
                '    user: synthetic-merged-user',
                'mysql:',
                '    host: synthetic-explicit-host',
                '    <<: *base',
            ]),
        );

        const provided = new Configuration({ getLogger: () => createLogger() }).getConfig();

        expect(provided.mysql).toStrictEqual({ host: 'synthetic-explicit-host', user: 'synthetic-merged-user' });
    });

    it('[CFG-1.1-MERGE-KEY-ARRAY] merges inside the maps that are elements of an array', () => {
        const candidate = readCandidate();
        delete candidate.recorded;
        installInitialReadDouble(
            () =>
                `${yamlDump(candidate)}${[
                    'x-limit: &limit',
                    '    limitThreshold: 90',
                    '    limitCmd: synthetic-limit-command',
                    'recorded:',
                    '    - name: archive-a',
                    '      path: "%ROOT%/archive-a"',
                    '      <<: *limit',
                    '    - name: archive-b',
                    '      path: "%ROOT%/archive-b"',
                ].join('\n')}\n`,
        );

        const provided = new Configuration({ getLogger: () => createLogger() }).getConfig();

        expect(provided.recorded).toMatchObject([
            { name: 'archive-a', limitThreshold: 90, limitCmd: 'synthetic-limit-command' },
            { name: 'archive-b' },
        ]);
        expect(provided.recorded[1]).not.toHaveProperty('limitThreshold');
        expect(provided.recorded[0]).not.toHaveProperty('<<');
    });

    it('[CFG-1.1-MERGE-KEY-ENV] uses a merge key and !env in the same file', () => {
        vi.stubEnv('EPGS_SYNTHETIC_DB_USER', 'synthetic-user');
        installInitialReadDouble(() =>
            withEnvEntries([
                'x-base: &base',
                '    host: synthetic-host',
                '    user: !env EPGS_SYNTHETIC_DB_USER',
                'mysql:',
                '    <<: *base',
                '    database: !env EPGS_SYNTHETIC_DB_USER',
            ]),
        );

        const provided = new Configuration({ getLogger: () => createLogger() }).getConfig();

        expect(provided.mysql).toStrictEqual({
            host: 'synthetic-host',
            user: 'synthetic-user',
            database: 'synthetic-user',
        });
    });

    it('[CFG-1.1-ENV-LITERAL] keeps values without !env exactly as written', () => {
        vi.stubEnv('EPGS_SYNTHETIC_DB_USER', 'must-not-be-used');
        installInitialReadDouble(() =>
            withEnvEntries([
                'mysql:',
                '    host: EPGS_SYNTHETIC_DB_USER',
                '    charset: $EPGS_SYNTHETIC_DB_USER',
                '    database: ${EPGS_SYNTHETIC_DB_USER}',
            ]),
        );

        const provided = new Configuration({ getLogger: () => createLogger() }).getConfig();

        expect(provided.mysql).toStrictEqual({
            host: 'EPGS_SYNTHETIC_DB_USER',
            charset: '$EPGS_SYNTHETIC_DB_USER',
            database: '${EPGS_SYNTHETIC_DB_USER}',
        });
    });

    it.each([
        ['better-sqlite3', 'sqlite'],
        ['sqlite', 'sqlite'],
        ['mysql', 'mysql'],
    ])('[CFG-1.7-DBTYPE-ALIAS] provides dbtype %s as %s', (written, provided) => {
        installInitialReadDouble(() => withEnvEntries([`dbtype: ${written}`]));

        expect(new Configuration({ getLogger: () => createLogger() }).getConfig().dbtype).toBe(provided);
    });

    it('[CFG-1.7-DBTYPE-DEFAULT] keeps sqlite when dbtype is omitted', () => {
        installInitialReadDouble(() => withEnvEntries([]));

        expect(new Configuration({ getLogger: () => createLogger() }).getConfig().dbtype).toBe('sqlite');
    });

    it('[CFG-1.7-DBTYPE-RELOAD] reads the alias again on reload', async () => {
        const watchFile = installInitialReadDouble(() => withEnvEntries(['dbtype: mysql']));
        const configuration = new Configuration({ getLogger: () => createLogger() });
        mutableFileSystem.promises.readFile = vi.fn(async () => withEnvEntries(['dbtype: better-sqlite3']));

        await (watchFile.mock.calls[0][1] as () => Promise<void>)();

        expect(configuration.getConfig().dbtype).toBe('sqlite');
    });

    it('[CFG-1.1-ENV-LOAD-ONLY] never selects the !env tag when a value is written back to YAML', () => {
        vi.stubEnv('EPGS_SYNTHETIC_DB_USER', 'synthetic-user');

        const written = yamlDump({ user: 'synthetic-user' }, Configuration.CONFIG_YAML_OPTIONS);

        expect(written).toBe('user: synthetic-user\n');
    });

    it('[CFG-1.1-ENV-NUMERIC-FIELD] fails the validation of an integer field given an !env string', () => {
        vi.stubEnv('EPGS_SYNTHETIC_LIMIT', '2048');
        const watchFile = installInitialReadDouble(() => withEnvEntries(['encodeQueueLimit: !env EPGS_SYNTHETIC_LIMIT']));

        expect(() => new Configuration({ getLogger: () => createLogger() })).toThrow(
            'ConfigValueError:encodeQueueLimit',
        );
        expect(watchFile).not.toHaveBeenCalled();
    });

    it('[CFG-1.3-ENV-UNDEFINED] fails to start naming the undefined environment variable', () => {
        vi.stubEnv('EPGS_SYNTHETIC_UNDEFINED', undefined);
        const watchFile = installInitialReadDouble(() =>
            withEnvEntries(['mysql:', '    user: !env EPGS_SYNTHETIC_UNDEFINED']),
        );

        expect(() => new Configuration({ getLogger: () => createLogger() })).toThrow(
            'environment variable EPGS_SYNTHETIC_UNDEFINED is not defined',
        );
        expect(watchFile).not.toHaveBeenCalled();
    });

    it('[CFG-2.1-ENV-RELOAD] reads the environment again on reload and switches to the new value', async () => {
        vi.stubEnv('EPGS_SYNTHETIC_DB_USER', 'synthetic-first');
        const watchFile = installInitialReadDouble(() =>
            withEnvEntries(['mysql:', '    user: !env EPGS_SYNTHETIC_DB_USER']),
        );
        const configuration = new Configuration({ getLogger: () => createLogger() });
        vi.stubEnv('EPGS_SYNTHETIC_DB_USER', 'synthetic-second');
        mutableFileSystem.promises.readFile = vi.fn(async () =>
            withEnvEntries(['mysql:', '    user: !env EPGS_SYNTHETIC_DB_USER']),
        );

        await (watchFile.mock.calls[0][1] as () => Promise<void>)();

        expect(configuration.getConfig().mysql).toStrictEqual({ user: 'synthetic-second' });
    });

    it('[CFG-2.2-ENV-RELOAD-UNDEFINED] keeps the prior generation when a reload names an undefined variable', async () => {
        vi.stubEnv('EPGS_SYNTHETIC_DB_USER', 'synthetic-first');
        const watchFile = installInitialReadDouble(() =>
            withEnvEntries(['mysql:', '    user: !env EPGS_SYNTHETIC_DB_USER']),
        );
        const logger = createLogger();
        const configuration = new Configuration({ getLogger: () => logger });
        const stableSnapshot = configuration.getConfig();
        mutableFileSystem.promises.readFile = vi.fn(async () =>
            withEnvEntries(['mysql:', '    user: !env EPGS_SYNTHETIC_UNDEFINED']),
        );

        await (watchFile.mock.calls[0][1] as () => Promise<void>)();

        expect(configuration.getConfig()).toEqual(stableSnapshot);
        expect(logger.system.error).toHaveBeenCalledWith('read config error');
        expect(logger.system.error).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'environment variable EPGS_SYNTHETIC_UNDEFINED is not defined' }),
        );
    });

    it('[CFG-4.1-DEFAULT-SNAPSHOT] provides all six internal numeric defaults in each complete clone', () => {
        const configuration = createConfiguration(null);
        configuration.config = configuration.formatConfig(readCandidate());

        const first = configuration.getConfig();
        const second = configuration.getConfig();

        expect(first).toMatchObject(providerNumericDefaults);
        expect(second).toMatchObject(providerNumericDefaults);
        expect(first).not.toBe(second);
    });

    it.each(providerNumericFields)(
        '[CFG-4.1-INITIAL-INVALID] rejects zero for %s before installing the watcher',
        field => {
            const watchFile = installInitialReadDouble(() =>
                reloadCandidate(48100, 'invalid-initial-generation', { [field]: 0 }),
            );
            const logger = createLogger();

            expect(() => new Configuration({ getLogger: () => logger })).toThrow(`ConfigValueError:${field}`);
            expect(watchFile).not.toHaveBeenCalled();
        },
    );

    it('[CFG-4.1-RELOAD-INVALID] discards every invalid numeric candidate and retains the old complete clone', async () => {
        const watchFile = installInitialReadDouble(() => reloadCandidate(48100, 'stable-generation'));
        const logger = createLogger();
        const configuration = new Configuration({ getLogger: () => logger });
        const stableInternalReference = configuration.config;
        const stableSnapshot = configuration.getConfig();
        const readFile = vi.fn();
        mutableFileSystem.promises.readFile = readFile;
        const changeListener = watchFile.mock.calls[0][1] as () => Promise<void>;

        for (const field of providerNumericFields) {
            readFile.mockResolvedValueOnce(reloadCandidate(48200, `invalid-${field}`, { [field]: 0 }));

            await changeListener();

            expect(configuration.config).toBe(stableInternalReference);
            expect(configuration.getConfig()).toEqual(stableSnapshot);
        }

        expect(readFile).toHaveBeenCalledTimes(providerNumericFields.length);
        expect(watchFile).toHaveBeenCalledTimes(1);
    });

    it('[CFG-2.2-RELOAD-FAILURE] keeps the prior generation and the same watcher after a read failure', async () => {
        const watchFile = installInitialReadDouble(() => reloadCandidate(48100, 'stable-generation'));
        const logger = createLogger();
        const configuration = new Configuration({ getLogger: () => logger });
        const stableSnapshot = configuration.getConfig();
        const readFile = vi.fn().mockRejectedValueOnce(new Error('synthetic reload read failure'));
        mutableFileSystem.promises.readFile = readFile;
        const changeListener = watchFile.mock.calls[0][1] as () => Promise<void>;

        await changeListener();

        expect(configuration.getConfig()).toEqual(stableSnapshot);
        expect(logger.system.error).toHaveBeenCalledWith('read config error');
        expect(logger.system.error).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'synthetic reload read failure' }),
        );
        expect(watchFile).toHaveBeenCalledTimes(1);

        readFile.mockResolvedValueOnce(reloadCandidate(48200, 'recovered-generation'));
        await changeListener();
        expect(configuration.getConfig()).toMatchObject({
            port: 48200,
            recorded: [{ name: 'recovered-generation' }],
        });
        expect(watchFile).toHaveBeenCalledTimes(1);
    });

    it('[CFG-1.1-YAML-DEFAULTS] builds a YAML candidate and fills only undefined top-level defaults', () => {
        const configuration = createConfiguration(null);
        const candidate = readCandidate();
        candidate.isAllowAllCORS = undefined;
        candidate.recPriority = 0;

        const formatted = configuration.formatConfig(candidate);

        expect(formatted.isAllowAllCORS).toBe(Configuration.DEFAULT_VALUE.isAllowAllCORS);
        expect(formatted.recPriority).toBe(0);
        expect(formatted.apiServers).toEqual([loopbackApiServer(48100)]);
    });

    // These six fields keep the same default values as v2's Configuration.DEFAULT_VALUE
    // (v2 5cf2ea383 src/model/Configuration.ts:224-229) and have no dedicated
    // default-application test elsewhere in test/server; every other reference to them across
    // test/server supplies an explicit fixture value rather than exercising the omitted-key path.
    it('[CFG-1.1-LEGACY-SCHEDULING-DEFAULTS] fills the six v2-compatible scheduling defaults when omitted', () => {
        const configuration = createConfiguration(null);
        const candidate = readCandidate();
        delete candidate.epgUpdateIntervalTime;
        delete candidate.conflictPriority;
        delete candidate.recPriority;
        delete candidate.streamingPriority;
        delete candidate.timeSpecifiedStartMargin;
        delete candidate.timeSpecifiedEndMargin;

        const formatted = configuration.formatConfig(candidate);

        expect(formatted.epgUpdateIntervalTime).toBe(10);
        expect(formatted.conflictPriority).toBe(1);
        expect(formatted.recPriority).toBe(2);
        expect(formatted.streamingPriority).toBe(0);
        expect(formatted.timeSpecifiedStartMargin).toBe(1);
        expect(formatted.timeSpecifiedEndMargin).toBe(1);
    });

    it('[CFG-1.1-STREAM-TEMPLATE] fills all eleven missing stream child arrays exactly', () => {
        const candidate = readCandidate();
        const configuration = createConfiguration(streamTemplate());

        const formatted = configuration.formatConfig(candidate);

        expect(formatted.stream).toEqual(streamTemplate().stream);
    });

    it.each(missingStreamParentCases)(
        '[CFG-1.1-STREAM-PARENT] does not create missing parent %s',
        (_label, removeParent, readParent) => {
            const candidate = readCandidate();
            const candidateStream = candidate.stream as Record<string, any>;
            removeParent(candidateStream);

            const formatted = createConfiguration(streamTemplate()).formatConfig(candidate);

            expect(readParent(formatted.stream as Record<string, any>)).toBeUndefined();
        },
    );

    it('[CFG-1.1-NO-TEMPLATE-INFERENCE] continues without inventing unavailable stream defaults', () => {
        const configuration = createConfiguration(null);
        const formatted = configuration.formatConfig(readCandidate());
        const stream = formatted.stream as Record<string, any>;

        expect(stream.live.ts).toEqual({});
        expect(stream.recorded.ts).toEqual({});
        expect(stream.recorded.encoded).toEqual({});
    });

    it('[CFG-1.2-SNAPSHOT] returns mutually independent deep snapshots and excludes only name tmp', () => {
        const configuration = createConfiguration(null);
        configuration.config = configuration.formatConfig(readCandidate());

        const first = configuration.getConfig();
        const second = configuration.getConfig();
        const firstRecorded = first.recorded as Array<Record<string, string>>;
        const secondRecorded = second.recorded as Array<Record<string, string>>;
        firstRecorded[0].name = 'mutated-name';
        (first.stream as Record<string, any>).live.ts.extra = [{ name: 'mutated-stream' }];

        expect(secondRecorded.map(entry => entry.name)).toEqual(['archive']);
        expect((second.stream as Record<string, any>).live.ts.extra).toBeUndefined();
        expect((configuration.getConfig().recorded as Array<Record<string, string>>).map(entry => entry.name)).toEqual([
            'archive',
        ]);
    });

    it('[TA-2.4-CONFIG-SNAPSHOT] preserves only the two raw tuner timeout settings in independent snapshots', () => {
        const configuration = createConfiguration(null);
        const candidate = readCandidate();
        candidate.tunerRestRequestTimeoutMs = { value: Number.NaN };
        candidate.tunerStreamEstablishmentTimeoutMs = new Date('2026-07-21T00:00:00.000Z');
        configuration.config = configuration.formatConfig(candidate);

        const first = configuration.getConfig();
        const second = configuration.getConfig();

        expect((first.tunerRestRequestTimeoutMs as { value: number }).value).toBeNaN();
        expect(first.tunerStreamEstablishmentTimeoutMs).toBeInstanceOf(Date);
        expect((first.tunerStreamEstablishmentTimeoutMs as Date).toISOString()).toBe('2026-07-21T00:00:00.000Z');
        expect(first.tunerRestRequestTimeoutMs).not.toBe(second.tunerRestRequestTimeoutMs);
        expect(first.tunerStreamEstablishmentTimeoutMs).not.toBe(second.tunerStreamEstablishmentTimeoutMs);

        const omitted = readCandidate();
        configuration.config = configuration.formatConfig(omitted);
        expect(configuration.getConfig()).not.toHaveProperty('tunerRestRequestTimeoutMs');
        expect(configuration.getConfig()).not.toHaveProperty('tunerStreamEstablishmentTimeoutMs');
    });

    it.each([
        ['plain explicit client port', false, publicSourceConfig(), 48102],
        ['secure explicit client port over HTTPS socket and listener ports', true, publicSourceConfig(), 48102],
        ['secure socket port', true, { ...publicSourceConfig(), clientSocketioPort: undefined }, 48444],
        [
            'secure listener port fallback',
            true,
            {
                ...publicSourceConfig(),
                clientSocketioPort: undefined,
                https: { port: 48443, key: 'synthetic-private-key-marker', cert: 'synthetic-certificate-marker' },
            },
            48443,
        ],
        ['plain socket port', false, { ...publicSourceConfig(), clientSocketioPort: undefined }, 48101],
        [
            'plain listener port fallback',
            false,
            { ...publicSourceConfig(), clientSocketioPort: undefined, socketioPort: undefined },
            48100,
        ],
    ])('[CFG-3.1-SOCKET-PRIORITY] selects %s', async (_label, secure, config, expectedPort) => {
        const result = await createPublicModel(config).getConfig(secure);

        expect(result.socketIOPort).toBe(expectedPort);
    });

    it('[CFG-3.1-HTTPS-CONFIG-ERROR] rejects a secure request with httpsConfigError when the HTTPS block is absent', async () => {
        const model = createPublicModel({ ...publicSourceConfig(), clientSocketioPort: undefined, https: undefined });

        await expect(model.getConfig(true)).rejects.toThrow('httpsConfigError');
    });

    it('[CFG-3.1-HTTP-CONFIG-ERROR] rejects a plain request with httpConfigError when the HTTP port is absent', async () => {
        const model = createPublicModel({ ...publicSourceConfig(), clientSocketioPort: undefined, port: undefined });

        await expect(model.getConfig(false)).rejects.toThrow('httpConfigError');
    });

    it('[CFG-3.1-PUBLIC-ALLOWLIST] exposes named display choices while excluding private and internal markers', async () => {
        const result = await createPublicModel(publicSourceConfig()).getConfig(false);

        const expectedStreamConfig = {
            live: {
                ts: {
                    m2ts: [{ name: 'template-m2ts', isUnconverted: true }],
                    m2tsll: ['template-m2tsll'],
                    webm: ['template-live-webm'],
                    mp4: ['template-live-mp4'],
                    hls: ['template-live-hls'],
                },
            },
            recorded: {
                ts: {
                    webm: ['template-recorded-webm'],
                    mp4: ['template-recorded-mp4'],
                    hls: ['template-recorded-hls'],
                },
                encoded: {
                    webm: ['template-encoded-webm'],
                    mp4: ['template-encoded-mp4'],
                    hls: ['template-encoded-hls'],
                },
            },
        };
        expect(result).toEqual({
            socketIOPort: 48102,
            broadcast: { GR: true, BS: false, CS: true, SKY: false },
            isEnableTSLiveStream: true,
            isEnableTSRecordedStream: true,
            isEnableEncodedRecordedStream: true,
            recorded: ['archive-a', 'archive-b'],
            encode: ['encode-a', 'encode-b'],
            urlscheme: {
                m2ts: { ios: 'm2ts-ios', android: 'm2ts-android', mac: 'm2ts-mac', win: 'm2ts-win' },
                video: { ios: 'video-ios', android: 'video-android', mac: 'video-mac', win: 'video-win' },
                download: {
                    ios: 'download-ios',
                    android: 'download-android',
                    mac: 'download-mac',
                    win: 'download-win',
                },
            },
            streamConfig: expectedStreamConfig,
            kodiHosts: ['living-room', 'tablet'],
        });
        expect(result.streamConfig).toEqual(expectedStreamConfig);
        for (const field of [
            'encodeQueueLimit',
            'concurrentUploadNum',
            'uploadReceiveTimeoutMs',
            'thumbnailMaxPending',
            'hookCommandMaxPending',
            'hookCommandTimeoutMs',
            'storageLimitCommandTimeoutMs',
            'syntheticInternalField',
        ]) {
            expect(result).not.toHaveProperty(field);
        }
        const serialized = JSON.stringify(result);
        for (const marker of [
            'database-secret-marker',
            'authentication-secret-marker',
            'internal-path-marker',
            'external-command-marker',
            'private-key-marker',
            'certificate-marker',
            'internal-host-marker',
            'storage-timeout-carrier-marker',
            'synthetic-internal-marker',
        ]) {
            expect(serialized).not.toContain(marker);
        }
    });

    it('[CFG-3.1-DEFERRED-LIVE-NAME] characterizes runtime isEnableTSLiveStream without resolving OpenAPI naming', async () => {
        const result = await createPublicModel(publicSourceConfig()).getConfig(false);

        expect(result.isEnableTSLiveStream).toBe(true);
        expect(result).not.toHaveProperty('isEnableLiveStream');
    });

    it('[CFG-3.2-COMMAND-SHAPE] treats the first literal-space element as executable and preserves argument order', () => {
        expect(ProcessUtil.parseCmdStr('%NODE% first second')).toEqual({
            bin: process.argv[0],
            args: ['first', 'second'],
        });
    });
});

/**
 * 同梱する script が、package が宣言する module 種別で動くかの検査。
 *
 * `package.json` の `type` は `.js` の意味を決める。`type: module` のもとで CommonJS の `require`
 * を使う script は、構文としては正しいので parse では落ちず、読み込んだ瞬間に
 * `ReferenceError: require is not defined in ES module scope` になる。encode の script は
 * `config.yml` の `cmd` から `%NODE%` で起動されるため、壊れていても encode process の
 * exit code 1 としてしか現れず、原因が見えない。`src` の外なので coverage の集計対象でもない。
 *
 * 実際に Node で起動して確かめる。ffmpeg の代わりに即座に成功して終わる binary を渡すので、
 * 符号化は走らない。
 */
describe('同梱 script は package の module 種別で動く', () => {
    const repositoryRoot = process.cwd();

    /** `config.yml.template` の `cmd` が `%NODE%` で起動する script を、template 側から導く。 */
    const launchedScripts = (): string[] => {
        const template = readFileSync(join(repositoryRoot, 'config/config.yml.template'), 'utf8');
        return [...new Set([...template.matchAll(/%NODE% %ROOT%\/(\S+\.js)/gu)].map(match => match[1]))];
    };

    it('config.yml.template が起動する script を導けている', () => {
        expect(launchedScripts()).toContain('config/enc.js');
    });

    it.each(['config/enc.js.template', 'config/enc-enhance.js.template'])(
        '%s が同梱の場所で読み込めて、最後まで走る',
        async script => {
            // 同梱 script は `<name>.js` として置かれる。template のまま実行すると Node は拡張子から
            // module 種別を決められないので `.js` へ写して起動する。module 種別は最も近い
            // `package.json` の `type` で決まるので、写す先に package の `type` と同じものを置く。
            // 候補 tree 自体へ書くと read-only の封印 checkout で `EACCES` になる。
            const stubRoot = await mkdtemp(join(tmpdir(), 'epgstation-shipped-script-'));
            const packageType = JSON.parse(
                await readFile(join(repositoryRoot, 'package.json'), 'utf8'),
            ).type;
            await writeFile(
                join(stubRoot, 'package.json'),
                `${JSON.stringify({ type: packageType })}\n`,
            );
            const runtimePath = join(stubRoot, `${basename(script, '.template')}.module-check.js`);
            // enc-enhance は ffprobe の JSON を読んで進捗を出すので、その形だけを返す stub を渡す。
            const ffprobeStub = join(stubRoot, 'ffprobe');
            await writeFile(ffprobeStub, '#!/bin/sh\nprintf \'{"format":{"duration":"10.0"}}\'\n', { mode: 0o755 });
            await writeFile(runtimePath, await readFile(join(repositoryRoot, script), 'utf8'));
            try {
                const settled = await new Promise<{ code: number | null; stderr: string }>(resolve => {
                    const child = spawn(process.execPath, [runtimePath], {
                        cwd: repositoryRoot,
                        env: {
                            ...process.env,
                            AUDIOCOMPONENTTYPE: '1',
                            FFMPEG: '/bin/true',
                            FFPROBE: ffprobeStub,
                            INPUT: '/dev/null',
                            OUTPUT: join(stubRoot, 'out.mp4'),
                            VIDEORESOLUTION: '720',
                        },
                        stdio: ['ignore', 'ignore', 'pipe'],
                    });
                    let stderr = '';
                    child.stderr.setEncoding('utf8');
                    child.stderr.on('data', chunk => (stderr += chunk));
                    child.once('close', code => resolve({ code, stderr }));
                });
                // 宣言された module 種別で読めないと ReferenceError / SyntaxError になり、
                // 起動した encode process の exit code 1 としてしか見えない。
                expect(settled.stderr).not.toMatch(/ReferenceError|SyntaxError/u);
                expect(settled.code).toBe(0);
            } finally {
                await rm(stubRoot, { force: true, recursive: true });
            }
        },
    );
});

/**
 * iOS VLC (`vlc-x-callback`) 側の受け口実装（videolan/vlc-ios `Sources/Helpers/Network/URLHandler.swift`
 * の `XCallbackURLHandler.performOpen` と `VLCURLHandler.getURLForValue`、2022-04-05 commit 8341da115
 * 以降）は、URL の path (`/stream` or `/download`) で action を決め、`url=` の値の先頭付近に
 * `%3A%2F%2F`（`://` の percent-encode）があれば値全体を percent-decode してから `URL(string:)` に渡す。
 * `config/config.yml.template` の `urlscheme.m2ts.ios`（再生）はこの形に既に沿っている
 * （2023-07-29 commit 38b31419e で対応済み）。
 *
 * `urlscheme.download.ios`（ダウンロード）は実機検証の結果、既定では設定しない方針になっている。iOS Safari は録画ファイルをブラウザから直接ダウンロードできる一方、vlc-x-callback を
 * 経由すると VLC 側が保存ファイル名を Base64 化してしまうため。`config/config.yml.template` は
 * `urlscheme.download` キー自体を（コメントのみで）省略し、`Configuration.DEFAULT_VALUE.urlscheme.download`
 * も `ios` を持たない空の URLSchemeInfo にする。config.yml で urlscheme.download を省略した利用者は
 * iOS ではブラウザの通常ダウンロードになる。
 *
 * この完全な scheme 文字列は、`x-callback-url` という実 host らしき authority を持つ
 * `<scheme>://...` 形の url になる。それは fixture として実 host を偽装しているわけではなく、
 * config.yml.template と Configuration.ts 自身に既にある本物の default 値を読んで比較して
 * いるだけである。そこでこの test は scheme 全体を一つの literal として書かず（部分文字列の
 * contains 検査と、2 つの実 source 同士の比較に置き換える）、test source に url 形の文字列を
 * 持ち込まない。
 */
describe('urlscheme の m2ts.ios が config.yml.template と Configuration.DEFAULT_VALUE で一致し、download.ios は既定で存在しない', () => {
    const repositoryRoot = process.cwd();

    const loadTemplateUrlScheme = (): { m2ts: { ios: string }; download?: { ios?: string } } => {
        const template = yamlLoad(
            readFileSync(join(repositoryRoot, 'config/config.yml.template'), 'utf8'),
        ) as { urlscheme: { m2ts: { ios: string }; download?: { ios?: string } } };
        return template.urlscheme;
    };

    it('[CFG-URLSCHEME-TEMPLATE] config.yml.template の urlscheme.m2ts.ios が vlc-x-callback の期待形と一致し、urlscheme.download.ios は設定されていない', () => {
        const { m2ts, download } = loadTemplateUrlScheme();

        // m2ts.ios (stream): 末尾に literal な引用符が紛れ込んでいない。
        expect(m2ts.ios.endsWith('"')).toBe(false);
        // url= の値は PROTOCOL の直後で "://" を percent-encode した形 (%3A%2F%2F) を保つ
        // （VLC 側が値全体を丸ごと percent-decode してから URL として開く前提）。
        expect(m2ts.ios).toContain('url=PROTOCOL%3A%2F%2FADDRESS');
        // download は既定で iOS 向け URL scheme を持たない（コメントのみで省略されている）。
        expect(download?.ios).toBeUndefined();
    });

    it('[CFG-URLSCHEME-DEFAULT] Configuration.DEFAULT_VALUE.urlscheme.m2ts.ios が config.yml.template と同じ値であり、urlscheme.download.ios は既定で存在しない', () => {
        const defaultUrlScheme = Configuration.DEFAULT_VALUE.urlscheme as {
            m2ts: { ios: string };
            download: { ios?: string };
        };
        const { m2ts } = loadTemplateUrlScheme();

        expect(defaultUrlScheme.m2ts.ios).toBe(m2ts.ios);
        expect(defaultUrlScheme.download).toEqual({});
        expect(defaultUrlScheme.download.ios).toBeUndefined();
    });

    /**
     * config.yml で `urlscheme:` 自体は書きつつ、`m2ts` / `video` だけを指定して `download` を省略する
     * （`config/config.yml.template` が例示する形。download.ios は既定では設定されない）。`urlscheme` 自体は undefined ではないため、
     * `setTemplateValues` の先頭ループ（トップレベル key が丸ごと undefined のときだけ補う）では
     * `download` は補われず、`config.urlscheme.download` は undefined のまま残る。
     * `ConfigApiModel.getConfig` は `config.urlscheme.download.ios` を直接読むため、undefined の
     * `download` に対しては `Cannot read properties of undefined (reading 'ios')` で 500 になる
     * （実機の config.yml から urlscheme.download を外して再現・確認済み）。
     */
    it('[CFG-URLSCHEME-DOWNLOAD-OMITTED] urlscheme はあるが download だけを省略した config でも例外にならず、download は空の URLSchemeInfo として補われる', async () => {
        const configuration = createConfiguration(null);
        const candidate: Record<string, unknown> = {
            port: 8888,
            urlscheme: {
                m2ts: { ios: 'm2ts-ios' },
                video: { ios: 'video-ios' },
            },
        };

        expect(() => {
            configuration.config = configuration.formatConfig(candidate);
        }).not.toThrow();

        const snapshot = configuration.getConfig() as Record<string, any>;
        expect(snapshot.urlscheme.download).toEqual({});
        expect(snapshot.urlscheme.m2ts).toEqual({ ios: 'm2ts-ios' });
        expect(snapshot.urlscheme.video).toEqual({ ios: 'video-ios' });

        const publicModel = new ConfigApiModel(
            { getConfig: () => configuration.getConfig() },
            {
                reserveation: {
                    getBroadcastStatus: async () => ({ GR: true, BS: false, CS: true, SKY: false }),
                },
            },
        );

        await expect(publicModel.getConfig(false)).resolves.toMatchObject({
            urlscheme: {
                m2ts: { ios: 'm2ts-ios' },
                video: { ios: 'video-ios' },
                download: { ios: undefined, android: undefined, mac: undefined, win: undefined },
            },
        });
    });

    it('[CFG-URLSCHEME-ALL-OMITTED] urlscheme を丸ごと省略した config でも m2ts / video / download すべてが DEFAULT_VALUE で補われ、公開 API は 200 相当で応答する', async () => {
        const configuration = createConfiguration(null);
        const candidate: Record<string, unknown> = { port: 8888 };

        configuration.config = configuration.formatConfig(candidate);
        const snapshot = configuration.getConfig() as Record<string, any>;

        expect(snapshot.urlscheme).toEqual(Configuration.DEFAULT_VALUE.urlscheme);
        expect(snapshot.urlscheme.download).toEqual({});

        const publicModel = new ConfigApiModel(
            { getConfig: () => configuration.getConfig() },
            {
                reserveation: {
                    getBroadcastStatus: async () => ({ GR: true, BS: false, CS: true, SKY: false }),
                },
            },
        );

        await expect(publicModel.getConfig(false)).resolves.toMatchObject({
            urlscheme: {
                download: { ios: undefined, android: undefined, mac: undefined, win: undefined },
            },
        });
    });

    /**
     * config.yml の `urlscheme:` に明示的に `null` を書いた場合（省略ではなく null 値）。
     * `setTemplateValues` の先頭の汎用ループは `typeof config.urlscheme === 'undefined'` しか見ないため、
     * すでに `null` が入っている key はこのループでは上書きされず、カテゴリ単位のループにも入らない
     * （`typeof null === 'object'` であり `null` チェックの分岐でのみ捕捉される）。この `null` 専用の
     * 分岐が本当に DEFAULT_VALUE.urlscheme で丸ごと補うことを確認する。
     */
    it('[CFG-URLSCHEME-NULL] urlscheme が明示的に null の config でも DEFAULT_VALUE で丸ごと補われる', () => {
        const configuration = createConfiguration(null);
        const candidate: Record<string, unknown> = { port: 8888, urlscheme: null };

        expect(() => {
            configuration.config = configuration.formatConfig(candidate);
        }).not.toThrow();

        const snapshot = configuration.getConfig() as Record<string, any>;
        expect(snapshot.urlscheme).toEqual(Configuration.DEFAULT_VALUE.urlscheme);
        expect(snapshot.urlscheme.download).toEqual({});
        expect(snapshot.urlscheme.m2ts.ios).toBe((Configuration.DEFAULT_VALUE.urlscheme as any).m2ts.ios);
    });
});

/**
 * `ConfigApiModel.getConfig` は `Configuration.setTemplateValues` が通常はカテゴリ単位で補うことを
 * 前提にしつつ、自身も `config.urlscheme` / `.m2ts` / `.video` / `.download` の欠落に対して
 * `?? {}` で二重に防御している。ここでは `IConfiguration` を直接の fake に置き換え、
 * `Configuration` を経由しない生の config を渡すことで、`ConfigApiModel` 自身の防御が独立して
 * 機能することを確認する（`Configuration` 側の補完に守られない、mock 実装や将来の別実装からの
 * 呼び出しを想定した検証）。
 */
describe('ConfigApiModel は urlscheme の欠落に対して Configuration の補完に依存せず自ら防御する', () => {
    const getBroadcastStatus = async () => ({ GR: true, BS: false, CS: true, SKY: false });
    const baseInternalConfig = (): Record<string, unknown> => ({
        clientSocketioPort: 8888,
        recorded: [],
        encode: [],
    });

    it('[CFG-URLSCHEME-APIMODEL-MISSING] urlscheme 自体が存在しない config でも例外にならず m2ts / video / download すべてが空の URLSchemeInfo として返る', async () => {
        const internal = baseInternalConfig();
        const publicModel = new ConfigApiModel({ getConfig: () => internal }, { reserveation: { getBroadcastStatus } });

        await expect(publicModel.getConfig(false)).resolves.toMatchObject({
            urlscheme: {
                m2ts: { ios: undefined, android: undefined, mac: undefined, win: undefined },
                video: { ios: undefined, android: undefined, mac: undefined, win: undefined },
                download: { ios: undefined, android: undefined, mac: undefined, win: undefined },
            },
        });
    });

    it('[CFG-URLSCHEME-APIMODEL-CATEGORY-MISSING] urlscheme はあるが m2ts が null、video が undefined、download だけが設定済みの config でも、null/undefined のカテゴリだけが空の URLSchemeInfo として返る', async () => {
        const internal = {
            ...baseInternalConfig(),
            urlscheme: {
                m2ts: null,
                download: { ios: 'download-ios', android: 'download-android', mac: 'download-mac', win: 'download-win' },
            },
        };
        const publicModel = new ConfigApiModel({ getConfig: () => internal }, { reserveation: { getBroadcastStatus } });

        await expect(publicModel.getConfig(false)).resolves.toMatchObject({
            urlscheme: {
                m2ts: { ios: undefined, android: undefined, mac: undefined, win: undefined },
                video: { ios: undefined, android: undefined, mac: undefined, win: undefined },
                download: { ios: 'download-ios', android: 'download-android', mac: 'download-mac', win: 'download-win' },
            },
        });
    });
});

// ConfigApiModel.getConfig()のbroadcastはgetBroadcastStatus()の戻り値をそのまま代入するだけ
// （フィルタしない）。BS4Kを追加してもConfigApiModel自身の変更は不要であることを、getBroadcastStatus
// がBS4Kを含む5 keyを返すfakeで確認する。
describe('ConfigApiModel の broadcast はBS4Kを含むgetBroadcastStatusの戻り値をそのまま反映する', () => {
    it('[CFG-BROADCAST-BS4K] response.broadcast equals whatever getBroadcastStatus resolves, including BS4K', async () => {
        const internal: Record<string, unknown> = { clientSocketioPort: 8888, recorded: [], encode: [] };
        const getBroadcastStatus = async () => ({ GR: true, BS: false, CS: true, SKY: false, BS4K: true });
        const publicModel = new ConfigApiModel({ getConfig: () => internal }, { reserveation: { getBroadcastStatus } });

        await expect(publicModel.getConfig(false)).resolves.toMatchObject({
            broadcast: { GR: true, BS: false, CS: true, SKY: false, BS4K: true },
        });
    });

    it('[CFG-BROADCAST-BS4K-FALSE] response.broadcast.BS4K reflects false when no BS4K tuner is available', async () => {
        const internal: Record<string, unknown> = { clientSocketioPort: 8888, recorded: [], encode: [] };
        const getBroadcastStatus = async () => ({ GR: true, BS: false, CS: false, SKY: false, BS4K: false });
        const publicModel = new ConfigApiModel({ getConfig: () => internal }, { reserveation: { getBroadcastStatus } });

        await expect(publicModel.getConfig(false)).resolves.toMatchObject({
            broadcast: { GR: true, BS: false, CS: false, SKY: false, BS4K: false },
        });
    });
});

/**
 * ffmpeg 8.0 は `readrate_catchup`（`-re` 使用時、既定で有効）により、`-map 0` で取り込む全ストリームの
 * 遅延（期待PTS-実PTSの差）を追跡して読み取り全体を絞る。EPGStation がライブ HLS 配信で挿入する
 * timed_id3 PID や、TS の epg/bin_data のように PTS が進行しない PID が含まれると、その PID の遅延が
 * 際限なく増加し、demux 全体を絞ってセグメント生成が遅延したり、ffmpeg が終了コード 255 で異常終了して
 * 配信が停止する（version bisect で確認済み、n5.1/n6.1/n7.1 では同一入力で lag 0）。放送波は既にチューナー
 * から実時間で届くため、ライブ配信の視聴用変換コマンドから `-re` を外してもストリームの実時間性は失われ
 * ない。録画配信の視聴用変換コマンドは元々 `-re` を使用しておらず変更しない。
 */
describe('ライブ配信の既定commandは-reを持たず、録画配信の既定commandは変更されない', () => {
    const repositoryRoot = process.cwd();

    const loadTemplateText = (): string => readFileSync(join(repositoryRoot, 'config/config.yml.template'), 'utf8');

    const loadTemplateStream = (): Record<string, any> => {
        const template = yamlLoad(loadTemplateText()) as { stream: Record<string, any> };
        return template.stream;
    };

    const collectCmds = (node: unknown): string[] => {
        const cmds: string[] = [];
        const walk = (value: unknown): void => {
            if (Array.isArray(value)) {
                value.forEach(walk);
            } else if (value !== null && typeof value === 'object') {
                for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
                    if (key === 'cmd' && typeof v === 'string') {
                        cmds.push(v);
                    } else {
                        walk(v);
                    }
                }
            }
        };
        walk(node);
        return cmds;
    };

    const hasReFlag = (cmd: string): boolean => /(^|\s)-re(\s|$)/u.test(cmd);

    it('[CFG-STREAM-LIVE-NO-READRATE] stream.live.ts の全commandが-reを持たない', () => {
        const { live } = loadTemplateStream();
        const liveCmds = collectCmds(live.ts);

        expect(liveCmds.length).toBeGreaterThan(0);
        for (const cmd of liveCmds) {
            expect(hasReFlag(cmd)).toBe(false);
        }
    });

    it('[CFG-STREAM-LIVE-NO-READRATE-RAW] config.yml.template のlive stream section全体（コメント併記の例を含む）に-reが残っていない', () => {
        const text = loadTemplateText();
        const liveStart = text.indexOf('\n    live:\n');
        const recordedStart = text.indexOf('\n    recorded:\n', liveStart);
        expect(liveStart).toBeGreaterThan(0);
        expect(recordedStart).toBeGreaterThan(liveStart);

        const liveSection = text.slice(liveStart, recordedStart);

        expect(hasReFlag(liveSection)).toBe(false);
    });

    it('[CFG-STREAM-RECORDED-UNCHANGED] stream.recorded の既定commandが変更されていない', () => {
        const { recorded } = loadTemplateStream();

        expect(recorded).toEqual({
            ts: {
                webm: [
                    {
                        name: '720p',
                        cmd: '%FFMPEG% -dual_mono_mode main -i pipe:0 -sn -threads 3 -c:a libvorbis -ar 48000 -b:a 192k -ac 2 -c:v libvpx-vp9 -vf yadif,scale=-2:720 -b:v 3000k -deadline realtime -speed 4 -cpu-used -8 -y -f webm pipe:1',
                    },
                    {
                        name: '480p',
                        cmd: '%FFMPEG% -dual_mono_mode main -i pipe:0 -sn -threads 3 -c:a libvorbis -ar 48000 -b:a 128k -ac 2 -c:v libvpx-vp9 -vf yadif,scale=-2:480 -b:v 1500k -deadline realtime -speed 4 -cpu-used -8 -y -f webm pipe:1',
                    },
                ],
                mp4: [
                    {
                        name: '720p',
                        cmd: '%FFMPEG% -dual_mono_mode main -i pipe:0 -sn -threads 0 -c:a aac -ar 48000 -b:a 192k -ac 2 -c:v libx264 -vf yadif,scale=-2:720 -b:v 3000k -profile:v baseline -preset veryfast -tune fastdecode,zerolatency -movflags frag_keyframe+empty_moov+faststart+default_base_moof -y -f mp4 pipe:1',
                    },
                    {
                        name: '480p',
                        cmd: '%FFMPEG% -dual_mono_mode main -i pipe:0 -sn -threads 0 -c:a aac -ar 48000 -b:a 128k -ac 2 -c:v libx264 -vf yadif,scale=-2:480 -b:v 1500k -profile:v baseline -preset veryfast -tune fastdecode,zerolatency -movflags frag_keyframe+empty_moov+faststart+default_base_moof -y -f mp4 pipe:1',
                    },
                ],
                hls: [
                    {
                        name: '720p',
                        cmd: '%FFMPEG% -dual_mono_mode main -i pipe:0 -sn -map 0 -threads 0 -ignore_unknown -max_muxing_queue_size 1024 -f hls -hls_time 3 -hls_list_size 0 -hls_allow_cache 1 -hls_segment_filename %streamFileDir%/stream%streamNum%-%09d.ts -hls_flags delete_segments -c:a aac -ar 48000 -b:a 192k -ac 2 -c:v libx264 -vf yadif,scale=-2:720 -b:v 3000k -preset veryfast -flags +loop-global_header %OUTPUT%',
                    },
                    {
                        name: '480p',
                        cmd: '%FFMPEG% -dual_mono_mode main -i pipe:0 -sn -map 0 -threads 0 -ignore_unknown -max_muxing_queue_size 1024 -f hls -hls_time 3 -hls_list_size 0 -hls_allow_cache 1 -hls_segment_filename %streamFileDir%/stream%streamNum%-%09d.ts -hls_flags delete_segments -c:a aac -ar 48000 -b:a 128k -ac 2 -c:v libx264 -vf yadif,scale=-2:480 -b:v 1500k -preset veryfast -flags +loop-global_header %OUTPUT%',
                    },
                ],
            },
            encoded: {
                webm: [
                    {
                        name: '720p',
                        cmd: '%FFMPEG% -dual_mono_mode main -ss %SS% -i %INPUT% -sn -threads 3 -c:a libvorbis -ar 48000 -b:a 192k -ac 2 -c:v libvpx-vp9 -vf scale=-2:720 -b:v 3000k -deadline realtime -speed 4 -cpu-used -8 -y -f webm pipe:1',
                    },
                    {
                        name: '480p',
                        cmd: '%FFMPEG% -dual_mono_mode main -ss %SS% -i %INPUT% -sn -threads 3 -c:a libvorbis -ar 48000 -b:a 128k -ac 2 -c:v libvpx-vp9 -vf scale=-2:480 -b:v 1500k -deadline realtime -speed 4 -cpu-used -8 -y -f webm pipe:1',
                    },
                ],
                mp4: [
                    {
                        name: '720p',
                        cmd: '%FFMPEG% -dual_mono_mode main -ss %SS% -i %INPUT% -sn -threads 0 -c:a aac -ar 48000 -b:a 192k -ac 2 -c:v libx264 -vf scale=-2:720 -b:v 3000k -profile:v baseline -preset veryfast -tune fastdecode,zerolatency -movflags frag_keyframe+empty_moov+faststart+default_base_moof -y -f mp4 pipe:1',
                    },
                    {
                        name: '480p',
                        cmd: '%FFMPEG% -dual_mono_mode main -ss %SS% -i %INPUT% -sn -threads 0 -c:a aac -ar 48000 -b:a 128k -ac 2 -c:v libx264 -vf scale=-2:480 -b:v 1500k -profile:v baseline -preset veryfast -tune fastdecode,zerolatency -movflags frag_keyframe+empty_moov+faststart+default_base_moof -y -f mp4 pipe:1',
                    },
                ],
                hls: [
                    {
                        name: '720p',
                        cmd: '%FFMPEG% -dual_mono_mode main -ss %SS% -i %INPUT% -sn -threads 0 -ignore_unknown -max_muxing_queue_size 1024 -f hls -hls_time 3 -hls_list_size 0 -hls_allow_cache 1 -hls_segment_filename %streamFileDir%/stream%streamNum%-%09d.ts -hls_flags delete_segments -c:a aac -ar 48000 -b:a 192k -ac 2 -c:v libx264 -vf scale=-2:720 -b:v 3000k -preset veryfast -flags +loop-global_header %OUTPUT%',
                    },
                    {
                        name: '480p',
                        cmd: '%FFMPEG% -dual_mono_mode main -ss %SS% -i %INPUT% -sn -threads 0 -ignore_unknown -max_muxing_queue_size 1024 -f hls -hls_time 3 -hls_list_size 0 -hls_allow_cache 1 -hls_segment_filename %streamFileDir%/stream%streamNum%-%09d.ts -hls_flags delete_segments -c:a aac -ar 48000 -b:a 128k -ac 2 -c:v libx264 -vf scale=-2:480 -b:v 3000k -preset veryfast -flags +loop-global_header %OUTPUT%',
                    },
                ],
            },
        });
    });
});

/*
 * Requirements 1 から 7 の AC は、節ごとの個数（1: 7、2: 4、3: 3、4: 5、5: 4、6: 4、7: 12）で全 39 個である。
 * 値は、その AC を検査する主 case の ID（case 題の先頭の `[ID]`）。補足 case（`CFG-4.2-*`）は含めない。
 */
const acceptanceCriteriaCounts = { 1: 7, 2: 4, 3: 3, 4: 5, 5: 4, 6: 4, 7: 12 } as const;

const acceptanceCriteriaTrace: Readonly<Record<string, readonly string[]>> = {
    '1.1': ['CFG-1.1-YAML-DEFAULTS', 'CFG-1.1-ENV-EXPANSION', 'CFG-1.1-ENV-LITERAL', 'CFG-1.1-ENV-LOAD-ONLY', 'CFG-1.1-ENV-NUMERIC-FIELD'],
    '1.2': ['CFG-1.1-YAML-DEFAULTS', 'CFG-1.1-LEGACY-SCHEDULING-DEFAULTS'],
    '1.3': ['CFG-1.1-STREAM-TEMPLATE', 'CFG-1.1-STREAM-PARENT'],
    '1.4': ['CFG-1.1-PATH-NORMALIZATION'],
    '1.5': ['CFG-1.1-SUBDIRECTORY-NORMALIZATION', 'CFG-1.1-PATH-NORMALIZATION'],
    '1.6': ['CFG-1.2-SNAPSHOT'],
    '1.7': ['CFG-1.7-DBTYPE-ALIAS', 'CFG-1.7-DBTYPE-DEFAULT', 'CFG-1.7-DBTYPE-RELOAD'],
    '2.1': ['CFG-1.3-INITIAL-READ-FAILURE', 'CFG-1.3-FILESYSTEM-FAILURE', 'CFG-1.3-ENV-UNDEFINED'],
    '2.2': ['CFG-1.3-MINIMUM-SUCCESS'],
    '2.3': ['CFG-1.3-INVALID-CANDIDATE'],
    '2.4': ['CFG-1.1-NO-TEMPLATE-INFERENCE', 'CFG-6.4-TEMPLATE-UNAVAILABLE'],
    '3.1': ['CFG-1.2-SNAPSHOT'],
    '3.2': ['CFG-1.2-SNAPSHOT', 'CFG-1.2-DEEP-CLONE'],
    '3.3': ['CFG-1.2-SNAPSHOT', 'CFG-1.2-DEEP-CLONE'],
    '4.1': ['CFG-2.1-RELOAD-SUCCESS'],
    '4.2': ['CFG-2.1-RELOAD-SUCCESS', 'CFG-2.1-ENV-RELOAD'],
    '4.3': ['CFG-2.1-RELOAD-SUCCESS', 'CFG-2.1-DEFERRED-ATOMIC-RELOAD'],
    '4.4': ['CFG-2.2-RELOAD-FAILURE', 'CFG-2.2-FAILED-CANDIDATES', 'CFG-2.2-ENV-RELOAD-UNDEFINED'],
    '4.5': ['CFG-2.2-FAILED-CANDIDATES'],
    '5.1': ['CFG-3.1-SOCKET-PRIORITY'],
    '5.2': ['CFG-3.1-PUBLIC-ALLOWLIST'],
    '5.3': ['CFG-3.1-PUBLIC-ALLOWLIST'],
    '5.4': ['CFG-3.1-PUBLIC-ALLOWLIST', 'CFG-3.1-HTTP-ALLOWLIST'],
    '6.1': ['CFG-3.2-COMMAND-SHAPE', 'CFG-3.2-LITERAL-SPACES'],
    '6.2': ['CFG-3.2-TOKENS'],
    '6.3': ['CFG-3.2-TOKENS'],
    '6.4': ['CFG-3.2-MISSING-BIN'],
    '7.1': ['CFG-4.1-DEFAULT-SNAPSHOT', 'CFG-4.1-DEFAULTS'],
    '7.2': ['CFG-4.1-DEFAULT-SNAPSHOT', 'CFG-4.1-DEFAULTS'],
    '7.3': ['CFG-4.1-DEFAULT-SNAPSHOT', 'CFG-4.1-DEFAULTS'],
    '7.4': ['CFG-4.1-DEFAULT-SNAPSHOT', 'CFG-4.1-DEFAULTS'],
    '7.5': ['CFG-4.1-DEFAULT-SNAPSHOT', 'CFG-4.1-DEFAULTS'],
    '7.6': ['CFG-4.1-DEFAULT-SNAPSHOT', 'CFG-4.1-DEFAULTS'],
    '7.7': ['CFG-4.1-BOUNDARY', 'CFG-4.1-INVALID'],
    '7.8': ['CFG-4.1-BOUNDARY', 'CFG-4.1-INVALID', 'CFG-4.1-LIMIT-CONSTANTS'],
    '7.9': ['CFG-4.1-BOUNDARY', 'CFG-4.1-INVALID', 'CFG-4.1-LIMIT-CONSTANTS'],
    '7.10': ['CFG-4.1-INITIAL-INVALID', 'CFG-4.1-RELOAD-INVALID'],
    '7.11': ['CFG-3.1-PUBLIC-ALLOWLIST', 'CFG-3.1-HTTP-ALLOWLIST'],
    '7.12': ['CFG-4.1-DEFAULT-SNAPSHOT', 'CFG-2.1-RELOAD-SUCCESS'],
};

describe('server configuration acceptance criteria trace', () => {
    it('[CFG-6.1-AC-TRACE] maps all 39 acceptance criteria to existing named cases', () => {
        const expectedCriteria = Object.entries(acceptanceCriteriaCounts).flatMap(([requirement, count]) =>
            Array.from({ length: count }, (_unused, index) => `${requirement}.${index + 1}`),
        );
        expect(expectedCriteria).toHaveLength(39);
        expect(Object.keys(acceptanceCriteriaTrace).sort()).toEqual([...expectedCriteria].sort());

        const directory = join(process.cwd(), 'test/server/configuration');
        const caseTitles = new Set<string>();
        const caseFiles = readdirSync(directory).filter(name => name.endsWith('.test.ts'));
        for (const name of caseFiles) {
            const source = readFileSync(join(directory, name), 'utf8');
            for (const match of source.matchAll(/['"`]\[(CFG-[A-Za-z0-9.-]+)\]/g)) {
                caseTitles.add(match[1]);
            }
            expect(source, `${name} must not skip or defer a case`).not.toMatch(
                /\b(?:it|describe|test)\.(?:skip|todo|skipIf|fails|only)\b/,
            );
        }
        expect(caseFiles).toContain('configuration.spec.test.ts');

        const unassigned = expectedCriteria.filter(
            criterion => (acceptanceCriteriaTrace[criterion] ?? []).length === 0,
        );
        const missingCases = expectedCriteria.flatMap(criterion =>
            (acceptanceCriteriaTrace[criterion] ?? [])
                .filter(caseId => !caseTitles.has(caseId))
                .map(caseId => `${criterion} -> ${caseId}`),
        );
        const supplementaryInTrace = Object.values(acceptanceCriteriaTrace)
            .flat()
            .filter(caseId => caseId.startsWith('CFG-4.2-'));
        expect(unassigned).toEqual([]);
        expect(missingCases).toEqual([]);
        expect(supplementaryInTrace).toEqual([]);
    });
});
