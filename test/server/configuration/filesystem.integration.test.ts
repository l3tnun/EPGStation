// Must stay the very first import in this file: it registers a Node loader hook that has to be in
// place before `require(join(compiledSnapshot, 'model', 'Configuration.js'))` below can trigger
// `ConfigurationFileAccess.js` being loaded for the first time. See the comment in that file for why.
import { configFsOverrides, resetConfigFsOverrides } from './fs-override-hook';

import 'reflect-metadata';

import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { constants, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Container } from 'inversify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    createCompiledEntrypointSession,
    spawnCompiledChildScenario,
    type ChildHarnessCleanupEvidence,
    type ChildHarnessSession,
} from '../harness/child-process.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('Server test runner did not provide its compiled snapshot');
}

type ConfigurationChangeListener = () => void;

interface ConfigurationFileAccess {
    readonly configPath: string;
    readonly templatePath: string;
    readSync(path: string): string;
    read(path: string): Promise<string>;
    watch(path: string, listener: ConfigurationChangeListener): void;
    unwatch(path: string, listener: ConfigurationChangeListener): void;
}

interface ConfigurationRuntime {
    readonly config: Record<string, unknown>;
    getConfig(): Record<string, unknown>;
}

interface ConfigurationConstructor {
    new (logger: { getLogger(): Record<string, unknown> }, fileAccess: ConfigurationFileAccess): ConfigurationRuntime;
}

interface ConfigurationFileAccessConstructor {
    new (): ConfigurationFileAccess;
}

interface ServiceServerRuntime {
    app: { listen(port: number, listener: () => void): Server };
    config: Record<string, any>;
    log: { system: { info: ReturnType<typeof vi.fn> } };
    socketIoManageModel: { initialize(servers: Server[]): void };
    start(): void;
}

interface ServiceServerConstructor {
    readonly prototype: object;
}

const require = createRequire(join(repositoryRoot, 'package.json'));
const Configuration = (
    require(join(compiledSnapshot, 'model', 'Configuration.js')) as {
        default: ConfigurationConstructor;
    }
).default;
const ConfigurationFileAccess = (
    require(join(compiledSnapshot, 'model', 'ConfigurationFileAccess.js')) as {
        default: ConfigurationFileAccessConstructor;
    }
).default;
const setModelContainer = (
    require(join(compiledSnapshot, 'model', 'ModelContainerSetter.js')) as {
        set(container: Container): void;
    }
).set;
const ServiceServer = (
    require(join(compiledSnapshot, 'model', 'service', 'ServiceServer.js')) as {
        default: ServiceServerConstructor;
    }
).default;
const express = require('express') as () => ServiceServerRuntime['app'];
const reflectMetadataPath = require.resolve('reflect-metadata');
const expressPath = require.resolve('express');
const serviceServerPath = join(compiledSnapshot, 'model', 'service', 'ServiceServer.js');
const syntheticTlsKeyFixture = join(repositoryRoot, 'test/server/fixtures/configuration/synthetic-tls-key.pem');
const syntheticTlsCertificateFixture = join(
    repositoryRoot,
    'test/server/fixtures/configuration/synthetic-tls-cert.pem',
);
const loopbackHost = '127.0.0.1';

// `ServiceServer.js` は `import * as fs from 'fs'` という ESM 名前空間 import で TLS の
// key/cert を読む。Node builtin の ESM facade はこの named export をプロセス起動時点で
// 固定するため、子 process 内で CommonJS 側の `require('node:fs')` を書き換えても
// `ServiceServer.js` が見る binding には届かない（`fs-override-hook.ts` と同じ制約、
// 別プロセスで再検証済み）。そのため子 process 自身の中で module.registerHooks() の loader
// hook を使い、`ServiceServer.js` の `fs`/`node:fs` import だけを差し替える。
const harnessHookPath = join(repositoryRoot, 'test/server/harness/child-module-overrides.mjs');
const serviceServerModuleUrl = pathToFileURL(serviceServerPath).href;
const tlsFsShimSource = [
    "import * as realFs from 'node:fs';",
    "import { basename } from 'node:path';",
    'const reads = () => globalThis.__epgstationTlsReads;',
    "export * from 'node:fs';",
    'export const readFileSync = (...args) => {',
    '    const list = reads();',
    '    if (list !== undefined) list.push(basename(String(args[0])));',
    '    return realFs.readFileSync(...args);',
    '};',
    'export default { ...realFs, readFileSync };',
].join('\n');

const createLogger = (): Record<string, unknown> => ({
    stream: { warn: vi.fn() },
    system: { error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
});

const reloadedInternalValues = {
    encodeQueueLimit: 2048,
    concurrentUploadNum: 2,
    uploadReceiveTimeoutMs: 240_000,
    thumbnailMaxPending: 48,
    hookCommandMaxPending: 80,
    hookCommandTimeoutMs: 180_000,
} as const;

const syntheticConfiguration = (port: number, internalValues?: typeof reloadedInternalValues): string =>
    [
        `port: ${String(port)}`,
        "recorded: [{ name: 'synthetic', path: '%ROOT%/recorded' }]",
        "thumbnail: '%ROOT%/thumbnail'",
        "streamFilePath: '%ROOT%/streamfiles'",
        ...(internalValues === undefined
            ? []
            : Object.entries(internalValues).map(([field, value]) => `${field}: ${String(value)}`)),
        '',
    ].join('\n');

afterEach(() => {
    resetConfigFsOverrides();
    vi.restoreAllMocks();
});

type InvalidConfigFixture =
    | { readonly kind: 'directory'; readonly label: string }
    | { readonly kind: 'missing'; readonly label: string }
    | { readonly kind: 'text'; readonly label: string; readonly source: string };

const invalidFixtures: readonly InvalidConfigFixture[] = [
    { label: 'missing configuration', kind: 'missing' },
    { label: 'directory at the configuration path', kind: 'directory' },
    { label: 'invalid YAML', kind: 'text', source: 'port: [' },
    {
        label: 'missing HTTP and complete HTTPS minimum',
        kind: 'text',
        source: [
            "recorded: [{ name: 'synthetic', path: '%ROOT%/recorded' }]",
            "thumbnail: '%ROOT%/thumbnail'",
            "streamFilePath: '%ROOT%/streamfiles'",
            '',
        ].join('\n'),
    },
];

const resolveDependencyRoot = (): string =>
    dirname(dirname(createRequire(join(repositoryRoot, 'package.json')).resolve('reflect-metadata')));

const prepareRuntimeRoot = async (runtimeRoot: string, fixture: InvalidConfigFixture): Promise<void> => {
    await cp(compiledSnapshot, join(runtimeRoot, 'dist'), { recursive: true });
    await symlink(resolveDependencyRoot(), join(runtimeRoot, 'node_modules'), 'dir');
    await mkdir(join(runtimeRoot, 'config'), { recursive: true });
    await cp(join(repositoryRoot, 'config', 'config.yml.template'), join(runtimeRoot, 'config', 'config.yml.template'));

    const configPath = join(runtimeRoot, 'config', 'config.yml');
    if (fixture.kind === 'directory') {
        await mkdir(configPath);
    } else if (fixture.kind === 'text') {
        await writeFile(configPath, fixture.source, { encoding: 'utf8', mode: 0o600 });
    }
};

const expectRemoved = async (path: string): Promise<void> => {
    await expect(access(path, constants.F_OK)).rejects.toMatchObject({ code: 'ENOENT' });
};

type TlsChildMode = 'success' | 'key-read-failure' | 'certificate-read-failure';

const tlsServiceScenario = (mode: TlsChildMode): { readonly name: string; readonly source: string } => ({
    name: `configuration-tls-${mode}`,
    source: `
require(${JSON.stringify(reflectMetadataPath)});
const fs: any = require('node:fs');
const path: any = require('node:path');
const reads: string[] = [];
(globalThis as any).__epgstationTlsReads = reads;
const { registerOverrides } = require(${JSON.stringify(harnessHookPath)});
registerOverrides([
    { parentURL: ${JSON.stringify(serviceServerModuleUrl)}, specifier: 'fs', source: ${JSON.stringify(tlsFsShimSource)} },
    { parentURL: ${JSON.stringify(serviceServerModuleUrl)}, specifier: 'node:fs', source: ${JSON.stringify(tlsFsShimSource)} },
]);
const ServiceServer: any = require(${JSON.stringify(serviceServerPath)}).default;
const express: any = require(${JSON.stringify(expressPath)});
const mode: string = ${JSON.stringify(mode)};
const keyPath: string = path.join(__dirname, 'synthetic-key.pem');
const certificatePath: string = path.join(__dirname, 'synthetic-certificate.pem');
if (mode !== 'key-read-failure') {
    fs.copyFileSync(${JSON.stringify(syntheticTlsKeyFixture)}, keyPath);
}
if (mode === 'success') {
    fs.copyFileSync(${JSON.stringify(syntheticTlsCertificateFixture)}, certificatePath);
}
const service: any = Object.create(ServiceServer.prototype);
service.app = express();
service.config = { https: { port: 0, key: keyPath, cert: certificatePath } };
service.log = { system: { info: () => undefined } };
service.socketIoManageModel = {
    initialize: (servers: any[]): void => {
        const server: any = servers[0];
        const reportReady = (): void => {
            const address: any = server.address();
            process.send?.({ kind: 'listening', port: address.port, reads });
        };
        if (server.listening) {
            reportReady();
        } else {
            server.once('listening', reportReady);
        }
    },
};
try {
    service.start();
} catch (error: any) {
    process.send?.({ kind: 'failure', code: error.code, reads }, () => process.disconnect());
}
`,
});

const expectChildCleanup = async (
    session: ChildHarnessSession,
    expectedTemporaryDirectory: string,
): Promise<ChildHarnessCleanupEvidence> => {
    const cleanup = await session.cleanup();
    expect(cleanup).toEqual({
        remainingChildProcesses: 0,
        remainingListeners: 0,
        remainingTimers: 0,
        remainingTempResources: 0,
    });
    await expectRemoved(expectedTemporaryDirectory);
    return cleanup;
};

const expectTlsHandshake = (port: number): Promise<number> =>
    new Promise((resolve, reject) => {
        const request = httpsRequest({ host: loopbackHost, path: '/', port, rejectUnauthorized: false }, response => {
            const status = response.statusCode ?? 0;
            response.resume();
            response.once('end', () => resolve(status));
        });
        request.once('error', reject);
        request.end();
    });

const expectPortReleased = async (port: number): Promise<void> => {
    const probe = createServer();
    try {
        await new Promise<void>((resolve, reject) => {
            probe.once('error', reject);
            probe.listen(port, loopbackHost, () => {
                probe.off('error', reject);
                resolve();
            });
        });
    } finally {
        if (probe.listening) {
            await new Promise<void>((resolve, reject) => {
                probe.close(error => (error === undefined ? resolve() : reject(error)));
            });
        }
    }
    expect(probe.listening).toBe(false);
};

describe('configuration startup filesystem boundary', () => {
    it('[CFG-6.4-SERVICE-LISTENER] starts and closes the actual HTTP listener on an ephemeral port', async () => {
        let server: Server | undefined;
        let receivedServers: Server[] = [];
        const service = Object.create(ServiceServer.prototype) as ServiceServerRuntime;
        service.app = express();
        service.config = { port: 0 };
        service.log = { system: { info: vi.fn() } };
        service.socketIoManageModel = {
            initialize: servers => {
                receivedServers = [...servers];
                [server] = receivedServers;
                expect(receivedServers).toHaveLength(1);
            },
        };

        try {
            service.start();
            if (server === undefined) {
                throw new Error('ServiceServer did not provide its listener');
            }
            await new Promise<void>((resolve, reject) => {
                if (server?.listening === true) {
                    resolve();
                    return;
                }
                server?.once('listening', resolve);
                server?.once('error', reject);
            });
            expect(server.listening).toBe(true);
        } finally {
            for (const receivedServer of receivedServers) {
                receivedServer.closeAllConnections();
                if (receivedServer.listening) {
                    await new Promise<void>((resolve, reject) => {
                        receivedServer.close(error => (error === undefined ? resolve() : reject(error)));
                    });
                }
                expect(receivedServer.listening).toBe(false);
            }
        }
    });

    it('[CFG-6.4-SERVICE-TLS-SUCCESS] starts an isolated HTTPS listener with a temporary matching key and certificate', async () => {
        const session = await spawnCompiledChildScenario(tlsServiceScenario('success'), {
            observationDeadlineMilliseconds: 5_000,
        });
        const temporaryDirectory = session.tempDirectory;
        let port: number | undefined;

        try {
            const event = await session.waitForEvent('message');
            expect(event).toMatchObject({
                type: 'message',
                message: {
                    kind: 'listening',
                    reads: ['synthetic-key.pem', 'synthetic-certificate.pem'],
                },
            });
            const message = event.type === 'message' ? (event.message as Record<string, unknown>) : {};
            port = message.port as number;
            expect(Number.isSafeInteger(port)).toBe(true);
            expect(await expectTlsHandshake(port)).toBe(404);
        } finally {
            await expectChildCleanup(session, temporaryDirectory);
        }

        if (port !== undefined) {
            await expectPortReleased(port);
        }
    });

    it.each([
        {
            mode: 'key-read-failure',
            expectedReads: ['synthetic-key.pem'],
        },
        {
            mode: 'certificate-read-failure',
            expectedReads: ['synthetic-key.pem', 'synthetic-certificate.pem'],
        },
    ] as const)(
        '[CFG-6.4-SERVICE-TLS-READ-FAILURE] exits without a listener for $mode',
        async ({ mode, expectedReads }) => {
            const session = await spawnCompiledChildScenario(tlsServiceScenario(mode), {
                observationDeadlineMilliseconds: 5_000,
            });
            const temporaryDirectory = session.tempDirectory;

            try {
                await session.waitForClose();
                expect(session.messages).toContainEqual({
                    kind: 'failure',
                    code: 'ENOENT',
                    reads: expectedReads,
                });
                expect(session.events).not.toContainEqual(expect.objectContaining({ message: { kind: 'listening' } }));
            } finally {
                await expectChildCleanup(session, temporaryDirectory);
            }
        },
        10_000,
    );

    it('[CFG-6.4-CONTAINER-BINDING] resolves the production filesystem adapter from the model container', () => {
        const container = new Container();
        setModelContainer(container);

        expect(container.isBound('IConfigurationFileAccess')).toBe(true);
        const first = container.get<ConfigurationFileAccess>('IConfigurationFileAccess');
        const second = container.get<ConfigurationFileAccess>('IConfigurationFileAccess');
        expect(first).toBeInstanceOf(ConfigurationFileAccess);
        expect(second).toBe(first);
    });

    it('[CFG-6.4-PRODUCTION-FILE-ACCESS] delegates fixed paths, UTF-8 reads, and the same listener to node filesystem', async () => {
        const listener: ConfigurationChangeListener = vi.fn();
        const readSync = vi.fn(() => 'synthetic sync configuration');
        const asyncRead = vi.fn(async () => 'synthetic async configuration');
        const watchFile = vi.fn();
        const unwatchFile = vi.fn();
        configFsOverrides.readFileSync = readSync;
        configFsOverrides.readFile = asyncRead;
        configFsOverrides.watchFile = watchFile;
        configFsOverrides.unwatchFile = unwatchFile;
        const fileAccess = new ConfigurationFileAccess();

        expect(fileAccess.configPath).toBe(join(dirname(compiledSnapshot), 'config', 'config.yml'));
        expect(fileAccess.templatePath).toBe(join(dirname(compiledSnapshot), 'config', 'config.yml.template'));
        expect(fileAccess.readSync('synthetic-sync-path')).toBe('synthetic sync configuration');
        await expect(fileAccess.read('synthetic-async-path')).resolves.toBe('synthetic async configuration');
        fileAccess.watch(fileAccess.configPath, listener);
        fileAccess.unwatch(fileAccess.configPath, listener);

        expect(readSync).toHaveBeenCalledWith('synthetic-sync-path', 'utf-8');
        expect(asyncRead).toHaveBeenCalledWith('synthetic-async-path', 'utf-8');
        expect(watchFile).toHaveBeenCalledWith(fileAccess.configPath, listener);
        expect(unwatchFile).toHaveBeenCalledWith(fileAccess.configPath, listener);
    });

    it('[CFG-6.4-REAL-TEMPLATE-ACCESS] reads a real bundled repository file through unmocked filesystem calls and round-trips a watch listener without a fired event', async () => {
        const fileAccess = new ConfigurationFileAccess();
        const realTemplatePath = join(repositoryRoot, 'config', 'config.yml.template');
        const expectedTemplate = await readFile(realTemplatePath, 'utf8');

        expect(fileAccess.readSync(realTemplatePath)).toBe(expectedTemplate);
        await expect(fileAccess.read(realTemplatePath)).resolves.toBe(expectedTemplate);

        const listener: ConfigurationChangeListener = () => undefined;
        expect(() => fileAccess.watch(realTemplatePath, listener)).not.toThrow();
        expect(() => fileAccess.unwatch(realTemplatePath, listener)).not.toThrow();
    });

    it('[CFG-6.4-INJECTED-FILESYSTEM] reads temporary configuration and template paths through the injected port', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'epgstation-configuration-port-'));
        const configPath = join(temporaryDirectory, 'synthetic-config.yml');
        const templatePath = join(temporaryDirectory, 'synthetic-template.yml');
        await writeFile(configPath, syntheticConfiguration(49100), 'utf8');
        await writeFile(templatePath, syntheticConfiguration(49200), 'utf8');

        const listenerLedger: ConfigurationChangeListener[] = [];
        const access: ConfigurationFileAccess = {
            configPath,
            templatePath,
            readSync: vi.fn(path => readFileSync(path, 'utf8')),
            read: vi.fn(path => readFile(path, 'utf8')),
            watch: vi.fn((_path, listener) => listenerLedger.push(listener)),
            unwatch: vi.fn(),
        };
        const exit = vi.spyOn(process, 'exit').mockImplementation(code => {
            throw new Error(`SyntheticProcessExit:${String(code)}`);
        });

        try {
            const configuration = new Configuration({ getLogger: createLogger }, access);
            const initialInternalReference = configuration.config;
            const acquiredInitialSnapshot = configuration.getConfig();

            expect(acquiredInitialSnapshot).toMatchObject({ port: 49100 });
            expect(access.readSync).toHaveBeenNthCalledWith(1, templatePath);
            expect(access.readSync).toHaveBeenNthCalledWith(2, configPath);
            expect(access.watch).toHaveBeenCalledWith(configPath, expect.any(Function));
            expect(exit).not.toHaveBeenCalled();

            await rm(configPath);
            await listenerLedger[0]();
            expect(configuration.config).toBe(initialInternalReference);
            expect(configuration.getConfig()).toEqual(acquiredInitialSnapshot);

            await writeFile(configPath, 'port: [', 'utf8');
            await listenerLedger[0]();
            expect(configuration.config).toBe(initialInternalReference);
            expect(configuration.getConfig()).toEqual(acquiredInitialSnapshot);

            await writeFile(configPath, syntheticConfiguration(49300, reloadedInternalValues), 'utf8');
            await listenerLedger[0]();
            expect(configuration.config).not.toBe(initialInternalReference);
            const reloadedSnapshot = configuration.getConfig();
            expect(reloadedSnapshot).toMatchObject({ port: 49300, ...reloadedInternalValues });
            expect(acquiredInitialSnapshot).toMatchObject({ port: 49100 });

            const independentlyClonedSnapshot = configuration.getConfig();
            expect(independentlyClonedSnapshot).toEqual(reloadedSnapshot);
            expect(independentlyClonedSnapshot).not.toBe(reloadedSnapshot);

            const secondListenerLedger: ConfigurationChangeListener[] = [];
            const secondAccess: ConfigurationFileAccess = {
                ...access,
                watch: vi.fn((_path, listener) => secondListenerLedger.push(listener)),
                unwatch: vi.fn(),
            };
            const restartedConfiguration = new Configuration({ getLogger: createLogger }, secondAccess);
            expect(restartedConfiguration.getConfig()).toMatchObject({ port: 49300, ...reloadedInternalValues });

            secondAccess.unwatch(configPath, secondListenerLedger[0]);
            expect(secondAccess.unwatch).toHaveBeenCalledWith(configPath, secondListenerLedger[0]);
        } finally {
            if (listenerLedger[0] !== undefined) {
                access.unwatch(configPath, listenerLedger[0]);
                expect(access.unwatch).toHaveBeenCalledWith(configPath, listenerLedger[0]);
            }
            vi.restoreAllMocks();
            await rm(temporaryDirectory, { force: true, recursive: true });
        }
    });

    it.each([
        { kind: 'missing', label: 'missing template' },
        { kind: 'directory', label: 'unreadable template path' },
        { kind: 'invalid', label: 'invalid YAML template' },
    ] as const)('[CFG-6.4-TEMPLATE-UNAVAILABLE] continues from the main configuration for $label', async ({ kind }) => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'epgstation-configuration-template-'));
        const configPath = join(temporaryDirectory, 'synthetic-config.yml');
        const templatePath = join(temporaryDirectory, 'synthetic-template.yml');
        await writeFile(configPath, syntheticConfiguration(49400), 'utf8');
        if (kind === 'directory') {
            await mkdir(templatePath);
        } else if (kind === 'invalid') {
            await writeFile(templatePath, 'port: [', 'utf8');
        }
        let listener: ConfigurationChangeListener | undefined;
        const access: ConfigurationFileAccess = {
            configPath,
            templatePath,
            readSync: vi.fn(path => readFileSync(path, 'utf8')),
            read: path => readFile(path, 'utf8'),
            watch: vi.fn((_path, registeredListener) => {
                listener = registeredListener;
            }),
            unwatch: vi.fn(),
        };
        const logger = createLogger() as {
            stream: { warn: ReturnType<typeof vi.fn> };
            system: { fatal: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
        };

        try {
            const configuration = new Configuration({ getLogger: () => logger }, access);
            const snapshot = configuration.getConfig();

            expect(snapshot).toMatchObject({ port: 49400 });
            expect(snapshot.stream).toBeUndefined();
            expect(access.readSync).toHaveBeenNthCalledWith(1, templatePath);
            expect(access.readSync).toHaveBeenNthCalledWith(2, configPath);
            expect(access.watch).toHaveBeenCalledWith(configPath, listener);
            expect(logger.system.fatal).not.toHaveBeenCalled();
            if (kind === 'missing') {
                expect(logger.system.warn).toHaveBeenCalledWith(`${templatePath} is not found`);
                expect(logger.stream.warn).not.toHaveBeenCalled();
            } else if (kind === 'directory') {
                expect(logger.system.warn).not.toHaveBeenCalled();
                expect(logger.stream.warn).toHaveBeenCalledOnce();
            } else {
                expect(logger.system.warn).not.toHaveBeenCalled();
                expect(logger.stream.warn).not.toHaveBeenCalled();
            }
        } finally {
            if (listener !== undefined) {
                access.unwatch(configPath, listener);
                expect(access.unwatch).toHaveBeenCalledWith(configPath, listener);
            }
            await rm(temporaryDirectory, { force: true, recursive: true });
            await expectRemoved(temporaryDirectory);
        }
    });

    it.each(invalidFixtures)(
        '[CFG-1.3-FILESYSTEM-FAILURE] rejects $label before dependency or consumer startup',
        async fixture => {
            let session: ChildHarnessSession | undefined;
            let tempDirectory: string | undefined;

            try {
                session = await createCompiledEntrypointSession({
                    compiledEntrypoint: join(compiledSnapshot, 'index.js'),
                    cwd: dirname(compiledSnapshot),
                    detachedProcessGroup: process.platform !== 'win32',
                    prepareRuntimeRoot: runtimeRoot => prepareRuntimeRoot(runtimeRoot, fixture),
                });
                tempDirectory = session.tempDirectory;
                await session.waitForClose();

                expect(session.events).toContainEqual(expect.objectContaining({ type: 'exit', code: 1, signal: null }));
                expect(session.stdout).not.toContain('config.yml read success');
                expect(session.stdout).not.toContain('check mirakurun');
                expect(session.stdout).not.toContain('check db');
                expect(session.stdout).not.toMatch(/start service pid:/u);
                expect(session.stderr).not.toContain('configuration-provided-marker');
            } finally {
                if (session !== undefined) {
                    const cleanup = await session.cleanup();
                    expect(cleanup).toEqual({
                        remainingChildProcesses: 0,
                        remainingListeners: 0,
                        remainingTimers: 0,
                        remainingTempResources: 0,
                    });
                }
            }

            if (tempDirectory !== undefined) {
                await expectRemoved(tempDirectory);
            }
        },
        20_000,
    );
});
