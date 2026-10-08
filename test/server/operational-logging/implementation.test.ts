import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Configuration, Logger } from 'log4js';

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
    body: string;
    getHeader(name: string): number | string | undefined;
    statusCode: number;
    writeHead(code: number, headers?: Record<string, string>): void;
}

type AccessMiddleware = (request: SyntheticRequest, response: SyntheticResponse, next: () => void) => void;
type TerminalEvent = 'close' | 'end' | 'error' | 'finish';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required');
}

const log4js = require('log4js') as typeof import('log4js');
const LoggerModel = (
    require(join(compiledSnapshot, 'model', 'LoggerModel.js')) as {
        default: LoggerModelConstructor;
    }
).default;
const ServiceServer = (
    require(join(compiledSnapshot, 'model', 'service', 'ServiceServer.js')) as {
        default: { readonly prototype: object };
    }
).default;
const reflectMetadataPath = require.resolve('reflect-metadata');
const loggerModelPath = join(compiledSnapshot, 'model', 'LoggerModel.js');
const businessReachedSentinel = 'BUSINESS_REACHED';
const roleRoutingFixturePath = resolve('test/server/fixtures/logging/role-routing.synthetic.yml');
const httpAccessFixturePath = resolve('test/server/fixtures/logging/http-access.synthetic.json');

interface SampleFileAppender {
    readonly backups: number;
    readonly filename: string;
    readonly maxLogSize: number;
    readonly pattern: string;
    readonly type: string;
}

interface SampleCategory {
    readonly appenders: readonly string[];
    readonly level: string;
}

interface SampleConfiguration {
    readonly appenders: Record<string, SampleFileAppender | { readonly type: string }>;
    readonly categories: Record<string, SampleCategory>;
}

const operationalCategories = ['system', 'access', 'stream', 'encode'] as const;
const sampleRoles = [
    {
        configPath: 'config/operatorLogConfig.sample.yml',
        directory: 'Operator',
        encodeCategory: false,
        tokenPrefix: 'Operator',
    },
    {
        configPath: 'config/serviceLogConfig.sample.yml',
        directory: 'Service',
        encodeCategory: true,
        tokenPrefix: 'Service',
    },
    {
        configPath: 'config/epgUpdaterLogConfig.sample.yml',
        directory: 'EPGUpdater',
        encodeCategory: false,
        tokenPrefix: 'EPGUpdater',
    },
] as const;
const tokenCases = sampleRoles.flatMap(role =>
    operationalCategories.map(category => ({
        category,
        expectedPath: join(compiledSnapshot, '..', 'logs', role.directory, `${category}.log`),
        token: `%${role.tokenPrefix}${category[0].toUpperCase()}${category.slice(1)}%`,
    })),
);
const terminalSequences: readonly (readonly TerminalEvent[])[] = [
    ['end', 'finish', 'error', 'close', 'end'],
    ['finish', 'close', 'end', 'error', 'finish'],
    ['error', 'end', 'close', 'finish', 'error'],
    ['close', 'error', 'finish', 'end', 'close'],
];

interface HttpAccessFixture {
    readonly contentLength: number;
    readonly headerCases: Readonly<
        Record<
            'duplicate' | 'empty' | 'missing',
            {
                readonly expected: { readonly referer: string; readonly userAgent: string };
                readonly headers: Readonly<Record<string, string>>;
            }
        >
    >;
    readonly method: string;
    readonly path: string;
    readonly remoteAddress: string;
    readonly status: number;
}

const initializationBoundaryCases = [
    {
        name: 'empty configuration path',
        operation: `new LoggerModel().initialize('');`,
        expectedStderr: 'log file is not found',
    },
    {
        name: 'missing configuration file',
        operation: `new LoggerModel().initialize(join(__dirname, 'missing.yml'));`,
        expectedStderr: 'log file is not found',
    },
    {
        name: 'unreadable configuration file',
        operation: `
const target = join(__dirname, 'unreadable.yml');
writeFileSync(target, 'appenders: {}', 'utf8');
chmodSync(target, 0o000);
if (typeof process.getuid === 'function' && process.getuid() === 0) {
    chmodSync(__dirname, 0o755);
    process.setgid?.(65534);
    process.setuid?.(65534);
}
new LoggerModel().initialize(target);`,
        expectedStderr: 'EACCES',
    },
    {
        name: 'invalid YAML configuration',
        operation: `
const target = join(__dirname, 'invalid.yml');
writeFileSync(target, 'categories: [', 'utf8');
new LoggerModel().initialize(target);`,
        expectedStderr: 'log file parse error',
    },
    {
        name: 'get before initialization',
        operation: `new LoggerModel().getLogger();`,
        expectedStderr: 'Logger is not initialized',
    },
] as const;

const initializationChildSource = (operation: string): string => `
require(${JSON.stringify(reflectMetadataPath)});
const { chmodSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const LoggerModel = require(${JSON.stringify(loggerModelPath)}).default;
${operation}
process.stdout.write(${JSON.stringify(`${businessReachedSentinel}\n`)});
`;

const cleanupSession = async (
    session: Awaited<ReturnType<typeof spawnCompiledChildScenario>>,
): Promise<ChildHarnessCleanupEvidence> => {
    const evidence = await session.cleanup();
    await expect(access(session.tempDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(session.compiledEntrypoint)).rejects.toMatchObject({ code: 'ENOENT' });
    return evidence;
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

    if (use.mock.calls.length !== 1) {
        throw new Error('ServiceServer did not register exactly one access middleware');
    }
    return {
        log,
        middleware: use.mock.calls[0][0] as AccessMiddleware,
    };
};

const createSyntheticExchange = (
    authorization = 'synthetic-authorization-allow',
    overrides: {
        readonly contentLength?: number;
        readonly headers?: Record<string, string>;
        readonly method?: string;
        readonly originalUrl?: string;
        readonly remoteAddress?: string;
        readonly statusCode?: number;
    } = {},
): {
    readonly request: SyntheticRequest;
    readonly response: SyntheticResponse;
} => {
    const request: SyntheticRequest = {
        headers:
            overrides.headers === undefined
                ? { authorization, referer: '', 'user-agent': '' }
                : { authorization, ...overrides.headers },
        httpVersionMajor: 1,
        httpVersionMinor: 1,
        method: overrides.method ?? 'GET',
        originalUrl: overrides.originalUrl ?? '/synthetic/business',
        socket: { remoteAddress: overrides.remoteAddress ?? 'synthetic-remote-address-8' },
    };
    const response = Object.assign(new EventEmitter(), {
        body: '',
        getHeader: (name: string): number | undefined =>
            name.toLowerCase() === 'content-length' ? overrides.contentLength : undefined,
        statusCode: overrides.statusCode ?? 200,
        writeHead(code: number): void {
            this.statusCode = code;
        },
    }) as SyntheticResponse;
    return { request, response };
};

const captureConfiguration = (filePath: string): SampleConfiguration => {
    let captured: Configuration | undefined;
    vi.spyOn(log4js, 'configure').mockImplementation(configuration => {
        captured = configuration;
        return log4js;
    });
    vi.spyOn(log4js, 'getLogger').mockImplementation(category => ({ category: category ?? 'default' }) as Logger);

    new LoggerModel().initialize(filePath);

    if (captured === undefined) {
        throw new Error('LoggerModel did not configure log4js');
    }
    return captured as unknown as SampleConfiguration;
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('operational logging default implementation', () => {
    it('[OL-IMP-DEFAULT-ROUTING] configures default appenders, routing, and acquisition order', () => {
        const loggerByCategory = new Map<string, Logger>();
        const configure = vi.spyOn(log4js, 'configure').mockImplementation((_configuration: Configuration) => log4js);
        const getLogger = vi.spyOn(log4js, 'getLogger').mockImplementation(category => {
            const name = category ?? 'default';
            const logger = { category: name } as Logger;
            loggerByCategory.set(name, logger);
            return logger;
        });
        const model = new LoggerModel();

        model.initialize();
        const aggregate = model.getLogger();

        expect(configure).toHaveBeenCalledOnce();
        expect(configure).toHaveBeenCalledWith({
            appenders: {
                system: { type: 'console' },
                access: { type: 'console' },
                stream: { type: 'console' },
                encode: { type: 'console' },
                console: { type: 'console' },
            },
            categories: {
                default: { appenders: ['console'], level: 'info' },
                system: { appenders: ['system'], level: 'info' },
                access: { appenders: ['access'], level: 'info' },
                stream: { appenders: ['stream'], level: 'info' },
                encode: { appenders: ['system'], level: 'info' },
            },
        });
        expect(getLogger.mock.calls.map(([category]) => category)).toEqual(['system', 'access', 'stream', 'encode']);
        expect(aggregate).toEqual({
            system: loggerByCategory.get('system'),
            access: loggerByCategory.get('access'),
            stream: loggerByCategory.get('stream'),
            encode: loggerByCategory.get('encode'),
        });
        expect(model.getLogger()).toBe(aggregate);
    });

    it('[OL-IMP-DEFAULT-ORDER] initializes before the aggregate logger is retrieved', () => {
        vi.spyOn(log4js, 'configure').mockImplementation((_configuration: Configuration) => log4js);
        vi.spyOn(log4js, 'getLogger').mockImplementation(category => ({ category }) as Logger);
        const model = new LoggerModel();

        model.initialize();
        const aggregate = model.getLogger();

        expect(Object.values(aggregate).map(logger => logger.category)).toEqual([
            'system',
            'access',
            'stream',
            'encode',
        ]);
    });
});

describe('operational logging initialization implementation boundaries', () => {
    it.each(initializationBoundaryCases)(
        '[OL-IMP-INIT-BOUNDARY] keeps $name isolated and stops before business work',
        async ({ expectedStderr, name, operation }) => {
            const session = await spawnCompiledChildScenario({
                name: `logging-implementation-${name}`,
                source: initializationChildSource(operation),
            });

            let cleanupEvidence: ChildHarnessCleanupEvidence | undefined;
            try {
                await session.waitForClose();
            } finally {
                cleanupEvidence = await cleanupSession(session);
            }

            expect(session.events).toContainEqual(expect.objectContaining({ type: 'exit', code: 1, signal: null }));
            expect(session.stderr).toContain(expectedStderr);
            expect(session.stdout.split(businessReachedSentinel).length - 1).toBe(0);
            expect(cleanupEvidence).toEqual({
                remainingChildProcesses: 0,
                remainingListeners: 0,
                remainingTimers: 0,
                remainingTempResources: 0,
            });
        },
    );
});

describe('shipped role logging samples', () => {
    it.each(sampleRoles)('[OL-IMP-ROLE-SAMPLES] preserves sample facts in $configPath', role => {
        const configuration = captureConfiguration(resolve(role.configPath));

        expect(configuration.categories).toEqual({
            default: { appenders: ['console', 'stdout'], level: 'info' },
            system: { appenders: ['system', 'stdout'], level: 'info' },
            access: { appenders: ['access', 'stdout'], level: 'info' },
            stream: { appenders: ['stream', 'stdout'], level: 'info' },
            ...(role.encodeCategory ? { encode: { appenders: ['encode', 'stdout'], level: 'info' } } : {}),
        });
        expect(configuration.appenders.console).toEqual({ type: 'console' });
        expect(configuration.appenders.stdout).toEqual({ type: 'stdout' });

        for (const category of operationalCategories) {
            expect(configuration.appenders[category]).toEqual({
                type: 'file',
                maxLogSize: 1_048_576,
                backups: 3,
                filename: join(compiledSnapshot, '..', 'logs', role.directory, `${category}.log`),
                pattern: '-yyyy-MM-dd',
            });
        }
    });

    it('replaces only the first occurrence of every role and category path token', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'epgstation-logging-tokens-'));
        const configPath = join(temporaryDirectory, 'tokens.yml');
        const appenders = tokenCases
            .map(
                ({ token }, index) =>
                    `  token${index}:\n    type: file\n    filename: "${token}--synthetic-token-separator--${token}"`,
            )
            .join('\n');
        const configurationSource = `appenders:\n${appenders}\ncategories:\n  default:\n    appenders:\n      - token0\n    level: info\n`;

        try {
            await writeFile(configPath, configurationSource, 'utf8');
            const configuration = captureConfiguration(configPath);

            for (const [index, tokenCase] of tokenCases.entries()) {
                const appender = configuration.appenders[`token${index}`] as SampleFileAppender;
                expect(appender.filename).toBe(
                    `${tokenCase.expectedPath}--synthetic-token-separator--${tokenCase.token}`,
                );
            }
        } finally {
            await rm(temporaryDirectory, { recursive: true, force: true });
        }
    });

    it('loads the synthetic role fixture and passes its rotation values to the real configuration boundary', async () => {
        const fixtureSource = await readFile(roleRoutingFixturePath, 'utf8');
        expect(fixtureSource).not.toMatch(/credential|password|authorization/iu);

        const configuration = captureConfiguration(roleRoutingFixturePath);
        expect(configuration.appenders.system).toEqual({
            type: 'file',
            filename: join(compiledSnapshot, '..', 'logs', 'Service', 'system.log'),
            maxLogSize: 1_024,
            backups: 2,
            pattern: '-yyyy-MM-dd',
        });
        expect(configuration.categories.system).toEqual({ appenders: ['system'], level: 'info' });
    });

    /**
     * `LoggerModel.createDefaultLogPath` only doubles backslashes when `process.platform ===
     * 'win32'` (see `src/model/LoggerModel.ts`). The doubling matters because the substituted path is
     * spliced into the *raw config text* before that text is parsed as YAML (`readLogFile` runs
     * `str.replace(...)` first, then `initialize` hands the result to `loadYaml`), and every shipped
     * sample config quotes its `filename:` value with double quotes, where a lone backslash is an
     * invalid YAML escape sequence. Doubling each backslash before substitution is what keeps a
     * literal Windows path parseable there; `loadYaml` then un-escapes `\\` back to a single `\`, so
     * the value log4js actually receives has single backslashes again. This test proved that
     * un-doubled substitution actually breaks the YAML parse on the way to writing this test: an
     * earlier draft substituted a win32-shaped (but un-doubled) path into the same fixture on a
     * non-win32 `process.platform` and `LoggerModel` failed with `YAMLException: unknown escape
     * sequence` before calling `process.exit(1)` -- exactly the failure the doubling exists to avoid.
     *
     * The host running this suite is not Windows, so this test remaps `path` (via `vi.doMock` + a
     * fresh dynamic `import()`, the same static-binding workaround `configuration.spec.test.ts` uses
     * for `fs`) to `path.win32.join` so the generated path itself contains backslashes, and overrides
     * `process.platform` with `Object.defineProperty` (configurable, so it can be restored) around the
     * `initialize()` call. The oracle path is computed independently (real `path.win32.join` on the
     * same segments `createDefaultLogPath` uses) and compared against the value log4js actually
     * receives after the full substitute-then-parse-then-unescape round trip; the ternary's other
     * (non-win32) outcome is already exercised by every other test in this file, which all run with
     * the real, non-win32 `process.platform`.
     */
    it('round-trips a win32-shaped default log path through YAML only because backslashes are doubled first', async () => {
        const originalPlatform = process.platform;
        const actualPath = await vi.importActual<typeof import('node:path')>('node:path');
        const win32JoinPath = { ...actualPath, join: actualPath.win32.join };
        vi.doMock('node:path', () => win32JoinPath);
        vi.doMock('path', () => win32JoinPath);

        try {
            vi.resetModules();
            const freshLog4js = ((await import('log4js')) as { default: typeof log4js }).default;
            const capturedConfigs: SampleConfiguration[] = [];
            vi.spyOn(freshLog4js, 'configure').mockImplementation(configuration => {
                capturedConfigs.push(configuration as unknown as SampleConfiguration);
                return freshLog4js;
            });
            vi.spyOn(freshLog4js, 'getLogger').mockImplementation(
                category => ({ category: category ?? 'default' }) as Logger,
            );
            const FreshLoggerModel = (
                (await import(loggerModelPath)) as {
                    default: LoggerModelConstructor;
                }
            ).default;

            const temporaryDirectory = await mkdtemp(join(tmpdir(), 'epgstation-logging-win32-'));
            const configPath = join(temporaryDirectory, 'win32-token.yml');
            await writeFile(
                configPath,
                'appenders:\n' +
                    '  token0:\n' +
                    '    type: file\n' +
                    '    filename: "%OperatorSystem%"\n' +
                    'categories:\n' +
                    '  default:\n' +
                    '    appenders:\n' +
                    '      - token0\n' +
                    '    level: info\n',
                'utf8',
            );

            try {
                Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
                // Would throw (LoggerModel logs "log file parse error" and calls process.exit(1),
                // which this suite never mocks) if the doubling branch did not run: see the module
                // doc comment above for the un-doubled failure this reproduced while writing this test.
                new FreshLoggerModel().initialize(configPath);
            } finally {
                Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
                await rm(temporaryDirectory, { recursive: true, force: true });
            }

            expect(capturedConfigs).toHaveLength(1);
            const win32Filename = (capturedConfigs[0].appenders.token0 as SampleFileAppender).filename;

            // Same segments as LoggerModel#createDefaultLogPath('Operator', 'system.log'):
            // path.join(import.meta.dirname, '..', '..', 'logs', 'Operator', 'system.log'), where
            // import.meta.dirname for the compiled LoggerModel.js is join(compiledSnapshot, 'model').
            const win32Oracle = actualPath.win32.join(compiledSnapshot, '..', 'logs', 'Operator', 'system.log');
            const posixOracle = join(compiledSnapshot, '..', 'logs', 'Operator', 'system.log');

            expect(win32Oracle).not.toBe(posixOracle);
            expect(win32Oracle).toContain('\\');
            // The doubled backslashes this branch inserts are exactly undone by loadYaml's own
            // double-quoted-string escape handling, so the value log4js receives matches the
            // (un-doubled) oracle -- proving the substituted text survived YAML parsing at all is
            // what the earlier un-doubled failure above (and process.exit not firing here) shows.
            expect(win32Filename).toBe(win32Oracle);
        } finally {
            vi.doUnmock('node:path');
            vi.doUnmock('path');
            vi.resetModules();
        }
    });
});

describe('HTTP access middleware implementation', () => {
    it.each(terminalSequences.map(sequence => ({ sequence })))(
        '[OL-IMP-HTTP-TERMINAL] records only the first terminal event in $sequence',
        ({ sequence }) => {
            const { log, middleware } = createAccessMiddleware();
            const { request, response } = createSyntheticExchange();
            const next = vi.fn();

            middleware(request, response, next);
            expect(next).toHaveBeenCalledOnce();

            const firstEvent = sequence[0];
            if (firstEvent === undefined) {
                throw new Error('A terminal-event sequence must not be empty');
            }
            response.emit(firstEvent, firstEvent === 'error' ? new Error('synthetic first terminal error') : undefined);
            expect(log).toHaveBeenCalledOnce();
            const firstRecord = log.mock.calls[0];
            expect(String(firstRecord?.[0])).toBe('INFO');
            expect(String(firstRecord?.[1])).toContain('"GET /synthetic/business HTTP/1.1"');
            expect(String(firstRecord?.[1])).toContain('200');

            for (const event of sequence.slice(1)) {
                response.emit(event, event === 'error' ? new Error('synthetic terminal error') : undefined);
            }

            expect(log).toHaveBeenCalledOnce();
            expect(log.mock.calls[0]).toEqual(firstRecord);
        },
    );

    it.each(['missing', 'empty', 'duplicate'] as const)(
        'records synthetic HTTP fields for the $caseName case without changing terminal output',
        async caseName => {
            const fixture = JSON.parse(await readFile(httpAccessFixturePath, 'utf8')) as HttpAccessFixture;
            const { log, middleware } = createAccessMiddleware();
            const fieldCase = fixture.headerCases[caseName];
            const { request, response } = createSyntheticExchange('synthetic-authorization-fixture', {
                contentLength: fixture.contentLength,
                headers: { ...fieldCase.headers },
                method: fixture.method,
                originalUrl: fixture.path,
                remoteAddress: fixture.remoteAddress,
                statusCode: fixture.status,
            });

            middleware(request, response, () => undefined);
            response.emit('finish');
            response.emit('close');

            expect(log).toHaveBeenCalledOnce();
            expect(String(log.mock.calls[0]?.[0])).toBe('INFO');
            const record = String(log.mock.calls[0]?.[1]);
            expect(record).toBe(
                `${fixture.remoteAddress} - - "${fixture.method} ${fixture.path} HTTP/1.1" ` +
                    `${fixture.status} ${fixture.contentLength} "${fieldCase.expected.referer}" ` +
                    `"${fieldCase.expected.userAgent}"`,
            );
        },
    );

    it.each([
        ['synthetic-authorization-allow', true, 202, '{"accepted":true}'],
        ['synthetic-authorization-deny', false, 403, '{"accepted":false}'],
    ] as const)(
        '[OL-IMP-HTTP-BUSINESS] does not change authorization, status, or body for %s',
        (authorization, expectedAuthorization, expectedStatus, expectedBody) => {
            const runBusiness = (withMiddleware: boolean) => {
                const { request, response } = createSyntheticExchange(authorization);
                const access = withMiddleware ? createAccessMiddleware() : undefined;
                let authorized = false;
                const business = () => {
                    authorized = request.headers.authorization === 'synthetic-authorization-allow';
                    response.statusCode = authorized ? 202 : 403;
                    response.body = JSON.stringify({ accepted: authorized });
                    response.emit('finish');
                };

                if (access === undefined) {
                    business();
                } else {
                    access.middleware(request, response, business);
                }
                return {
                    authorized,
                    body: response.body,
                    logCount: access?.log.mock.calls.length ?? 0,
                    statusCode: response.statusCode,
                };
            };

            const baseline = runBusiness(false);
            const withAccessLogging = runBusiness(true);

            expect(withAccessLogging).toEqual({
                ...baseline,
                logCount: 1,
            });
            expect(baseline).toEqual({
                authorized: expectedAuthorization,
                body: expectedBody,
                logCount: 0,
                statusCode: expectedStatus,
            });
        },
    );
});
