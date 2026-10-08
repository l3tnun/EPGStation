import 'reflect-metadata';

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { access as fsAccess, chmod, cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const ChannelApiModel = (require(join(compiledSnapshot, 'model', 'api', 'channel', 'ChannelApiModel.js')) as any)
    .default;
const MirakurunChangeAdapter = (
    require(join(compiledSnapshot, 'model', 'tuner', 'change', 'MirakurunChangeAdapter.js')) as any
).default;
const MirakcChangeAdapter = (
    require(join(compiledSnapshot, 'model', 'tuner', 'change', 'MirakcChangeAdapter.js')) as any
).default;
const ConnectionCheckModel = (require(join(compiledSnapshot, 'model', 'ConnectionCheckModel.js')) as any).default;
const { parseConnectionTarget } = require(
    join(compiledSnapshot, 'model', 'tuner', 'transport', 'ConnectionTargetParser.js'),
) as any;
const TunerHttpTransport = (
    require(join(compiledSnapshot, 'model', 'tuner', 'transport', 'TunerHttpTransport.js')) as any
).default;
const ProductDetector = (require(join(compiledSnapshot, 'model', 'tuner', 'change', 'ProductDetector.js')) as any)
    .default;
const tunerUserAgentModule = require(join(
    compiledSnapshot,
    'model',
    'tuner',
    'transport',
    'TunerUserAgent.js',
)) as any;
const composeTunerUserAgent = tunerUserAgentModule.default;
const TUNER_USER_AGENT_PRODUCT = tunerUserAgentModule.TUNER_USER_AGENT_PRODUCT;

const TunerServerAccessModel = (require(join(compiledSnapshot, 'model', 'tuner', 'TunerServerAccessModel.js')) as any)
    .default;
const EPGUpdateManageModel = (require(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdateManageModel.js')) as any)
    .default;
type CanonicalProbe = {
    readonly id: `${number}.${number}`;
    readonly label: string;
    readonly run: () => Promise<void> | void;
};

const tunerFixture = {
    index: 0,
    isAvailable: true,
    isFault: false,
    isFree: true,
    isRemote: false,
    isUsing: false,
    name: 'synthetic-tuner',
    types: ['GR'],
};
const serviceFixture = {
    channel: { channel: '13', type: 'GR' },
    hasLogoData: true,
    id: 101,
    name: 'synthetic-service',
    networkId: 10,
    serviceId: 102,
    type: 1,
};
const programFixture = (id = 201) => ({
    duration: 60_000,
    eventId: id + 1,
    id,
    isFree: true,
    name: 'synthetic-program',
    networkId: 10,
    serviceId: 102,
    startAt: 1_000,
});
const access = (
    transport: Record<string, unknown>,
    settings: Record<string, unknown> = {},
    connectionTarget = 'http://synthetic.invalid:40772',
) => new TunerServerAccessModel(connectionTarget, 'epgstation/synthetic', transport, settings);
const statusTransport = (current = '3.8.0') => ({
    getBuffer: vi.fn(),
    getJson: vi.fn(async (path: string) => (path === '/api/status' ? {} : { current, latest: '9.7.5' })),
});
const changeObserver = () => ({ aborted: vi.fn(), changed: vi.fn(), started: vi.fn() });
const changeProgram = () =>
    JSON.stringify({ resource: 'program', type: 'update', data: programFixture(), time: 2_000 });
const streamTransport = (stream: PassThrough) => {
    const close = vi.fn(() => stream.destroy());
    const openStream = vi.fn(async () => ({ close, stream }));
    return { close, openStream, transport: { getBuffer: vi.fn(), getJson: vi.fn(), openStream } };
};
const epgChangeConsumer = (tunerServerAccess: Record<string, unknown>) => {
    const channelDB = { insert: vi.fn(async () => undefined), update: vi.fn(async () => undefined) };
    const programDB = { insert: vi.fn(async () => undefined), update: vi.fn(async () => undefined) };
    const log = { system: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
    const model = new EPGUpdateManageModel(
        { getLogger: () => log },
        { getConfig: () => ({ excludeChannels: [], excludeSids: [] }) },
        tunerServerAccess,
        channelDB,
        programDB,
    );
    return { channelDB, log, model, programDB };
};
const deferredOperation = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
};
const cleanInstallChildTimeoutMs = 20_000;
const cleanInstallChildTerminationGraceMs = 1_000;
const cleanInstallProbeCleanupAllowanceMs = 8_000;
const cleanInstallProbeTimeoutMs =
    2 * (cleanInstallChildTimeoutMs + cleanInstallChildTerminationGraceMs) + cleanInstallProbeCleanupAllowanceMs;
const isCleanInstallEnvironmentFailure = (args: readonly string[], output: string) =>
    args[0] === 'ci' &&
    /\bnpm error code (?:EAI_AGAIN|ECONN(?:REFUSED|RESET)|ENET(?:DOWN|UNREACH)|ENOTCACHED|ENOTFOUND|ETIMEDOUT)\b/iu.test(
        output,
    );
const runNpm = (
    cwd: string,
    args: readonly string[],
    {
        spawnNpm = spawn,
        terminationGraceMs = cleanInstallChildTerminationGraceMs,
        timeoutMs = cleanInstallChildTimeoutMs,
    }: {
        readonly spawnNpm?: typeof spawn;
        readonly terminationGraceMs?: number;
        readonly timeoutMs?: number;
    } = {},
): Promise<string> =>
    new Promise((resolve, reject) => {
        const npmCli = process.env.npm_execpath;
        if (npmCli === undefined) {
            reject(new Error('The npm CLI path is required for the clean-install probe'));
            return;
        }
        const child = spawnNpm(process.execPath, [npmCli, ...args], {
            cwd,
            env: {
                ...process.env,
                npm_config_audit: 'false',
                npm_config_fund: 'false',
                npm_config_progress: 'false',
                npm_config_update_notifier: 'false',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        let timedOut = false;
        let terminationGrace: NodeJS.Timeout | undefined;
        const deadline = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            terminationGrace = setTimeout(() => child.kill('SIGKILL'), terminationGraceMs);
        }, timeoutMs);
        const clearDeadlines = () => {
            clearTimeout(deadline);
            if (terminationGrace !== undefined) clearTimeout(terminationGrace);
        };
        child.stdout?.on('data', chunk => {
            output += String(chunk);
        });
        child.stderr?.on('data', chunk => {
            output += String(chunk);
        });
        child.once('error', error => {
            if (timedOut) return;
            clearDeadlines();
            reject(error);
        });
        child.once('close', (code, signal) => {
            clearDeadlines();
            if (timedOut) {
                reject(
                    new Error(
                        `clean-install environment timeout after ${timeoutMs}ms: npm ${args.join(' ')} closed with ${
                            signal ?? `exit code ${code}`
                        }`,
                    ),
                );
            } else if (code === 0) {
                resolve(output);
            } else {
                const category = isCleanInstallEnvironmentFailure(args, output)
                    ? 'clean-install environment failure'
                    : 'clean-install product regression';
                reject(new Error(`${category}: npm ${args.join(' ')} failed with exit code ${code}: ${output}`));
            }
        });
    });
const runNode = (cwd: string, source: string): Promise<string> =>
    new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', source], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let standardOutput = '';
        let standardError = '';
        child.stdout?.on('data', chunk => {
            standardOutput += String(chunk);
        });
        child.stderr?.on('data', chunk => {
            standardError += String(chunk);
        });
        child.once('error', reject);
        child.once('close', code => {
            if (code === 0) resolve(standardOutput);
            else reject(new Error(`node import-graph probe failed with exit code ${code}: ${standardError}`));
        });
    });
const makeResponse = (
    statusCode: number | undefined,
    body: Buffer | string,
    location?: string,
    error?: Error,
): PassThrough => {
    const response = new PassThrough() as PassThrough & {
        headers: Record<string, string | undefined>;
        statusCode: number;
    };
    response.statusCode = statusCode;
    response.headers = location === undefined ? {} : { location };
    queueMicrotask(() => (error === undefined ? response.end(body) : response.destroy(error)));
    return response;
};

const makeRequestHarness = (
    responses: Array<{ body?: Buffer | string; error?: Error; location?: string; statusCode: number | undefined }>,
): { options: Record<string, unknown>[]; request: (...args: any[]) => any; responses: PassThrough[] } => {
    const options: Record<string, unknown>[] = [];
    const emittedResponses: PassThrough[] = [];
    const request = vi.fn((requestOptions: Record<string, unknown>, callback: (response: PassThrough) => void) => {
        const requestObject = new EventEmitter() as EventEmitter & {
            destroy: ReturnType<typeof vi.fn>;
            end: () => void;
        };
        requestObject.destroy = vi.fn();
        requestObject.end = () => {
            const next = responses.shift();
            if (next === undefined) throw new Error('missing synthetic response');
            const response = makeResponse(next.statusCode, next.body ?? '', next.location, next.error);
            emittedResponses.push(response);
            callback(response);
        };
        options.push(requestOptions);
        return requestObject;
    });
    return { options, request, responses: emittedResponses };
};

const makeTestOwnedDirectoriesTraversable = async (root: string): Promise<void> => {
    await chmod(root, 0o700);
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        await makeTestOwnedDirectoriesTraversable(join(root, entry.name));
    }
};

const canonicalAcceptanceProbes: readonly CanonicalProbe[] = [
    {
        id: '1.1',
        label: 'returns the Mirakurun minimum version through getStatus',
        run: async () =>
            expect(access(statusTransport('3.8.0')).getStatus()).resolves.toMatchObject({
                version: { current: '3.8.0' },
            }),
    },
    {
        id: '1.2',
        label: 'returns the mirakc minimum version through getStatus',
        run: async () =>
            expect(access(statusTransport('3.1.10')).getStatus()).resolves.toMatchObject({
                version: { current: '3.1.10' },
            }),
    },
    {
        id: '1.3',
        label: 'accepts a later version without a version allowlist',
        run: async () =>
            expect(access(statusTransport('99.7.5')).getStatus()).resolves.toMatchObject({
                version: { current: '99.7.5' },
            }),
    },
    {
        id: '1.4',
        label: 'builds without the dedicated client package and keeps the public status transport direct',
        run: async () => {
            const cleanRoot = await mkdtemp(join(tmpdir(), 'epgstation-tuner-clean-install-'));
            const transport = statusTransport();
            try {
                await Promise.all([
                    cp('api.d.ts', join(cleanRoot, 'api.d.ts')),
                    cp('src', join(cleanRoot, 'src'), { recursive: true }),
                    cp('package.json', join(cleanRoot, 'package.json')),
                    cp('package-lock.json', join(cleanRoot, 'package-lock.json')),
                    cp('tsconfig.json', join(cleanRoot, 'tsconfig.json')),
                ]);
                await runNpm(cleanRoot, [
                    'ci',
                    '--ignore-scripts',
                    '--no-audit',
                    '--fund=false',
                    '--no-progress',
                    '--no-update-notifier',
                    '--prefer-offline',
                ]);
                await runNpm(cleanRoot, ['run', 'compile']);
                await expect(fsAccess(join(cleanRoot, 'node_modules', 'mirakurun'))).rejects.toMatchObject({
                    code: 'ENOENT',
                });
                const resolvedGraph = JSON.parse(
                    await runNode(
                        cleanRoot,
                        [
                            "const Module = require('node:module');",
                            'const resolved = [];',
                            'const originalResolveFilename = Module._resolveFilename;',
                            'Module._resolveFilename = function(request) {',
                            '  const value = originalResolveFilename.apply(this, arguments);',
                            '  resolved.push([request, value]);',
                            '  return value;',
                            '};',
                            "require('reflect-metadata');",
                            "require('./dist/model/ModelContainerSetter.js');",
                            'process.stdout.write(JSON.stringify(resolved));',
                        ].join('\n'),
                    ),
                ) as Array<[string, string]>;
                expect(resolvedGraph).toEqual(
                    expect.arrayContaining([
                        expect.arrayContaining([expect.stringMatching(/[\\/]model[\\/]ModelContainerSetter\.js$/u)]),
                    ]),
                );
                expect(resolvedGraph.map(([request]) => request)).not.toEqual(
                    expect.arrayContaining([expect.stringMatching(/^mirakurun(?:\/|$)/u)]),
                );
                expect(resolvedGraph.map(([, resolved]) => resolved)).not.toEqual(
                    expect.arrayContaining([expect.stringMatching(/[\\/]node_modules[\\/]mirakurun(?:[\\/]|$)/u)]),
                );
                await expect(access(transport).getStatus()).resolves.toEqual({
                    available: true,
                    version: { current: '3.8.0', latest: '9.7.5' },
                });
                expect(transport.getJson).toHaveBeenNthCalledWith(1, '/api/status', {
                    signal: expect.any(AbortSignal),
                });
                expect(transport.getJson).toHaveBeenNthCalledWith(2, '/api/version', {
                    signal: expect.any(AbortSignal),
                });
            } finally {
                await makeTestOwnedDirectoriesTraversable(cleanRoot);
                await rm(cleanRoot, { force: true, recursive: true });
            }
        },
    },
    {
        id: '1.5',
        label: 'uses the same public access object for REST and stream operations',
        run: async () => {
            const stream = new PassThrough();
            const fixture = streamTransport(stream);
            const transport = { ...statusTransport(), openStream: fixture.openStream };
            const model = access(transport);
            await model.getStatus();
            await model.openServiceStream({ priority: 1, serviceId: 101 });
            expect(transport.getJson).toHaveBeenCalled();
            expect(fixture.openStream).toHaveBeenCalledOnce();
        },
    },
    {
        id: '1.6',
        label: 'sends HTTP status requests to the configured host and port',
        run: () =>
            expect(parseConnectionTarget('http://synthetic.invalid:40772/base')).toMatchObject({
                host: 'synthetic.invalid',
                kind: 'http',
                port: 40772,
            }),
    },
    {
        id: '1.7',
        label: 'keeps the configured Unix socket as the request transport boundary',
        run: () =>
            expect(
                parseConnectionTarget(['http+unix:', '', encodeURIComponent('/tmp/synthetic.sock')].join('/')),
            ).toMatchObject({ kind: 'unix', socketPath: '/tmp/synthetic.sock' }),
    },
    {
        id: '1.8',
        label: 'keeps the configured named pipe as the request transport boundary',
        run: () =>
            expect(parseConnectionTarget(String.raw`\\.\pipe\synthetic-tuner`)).toMatchObject({
                kind: 'named-pipe',
                socketPath: String.raw`\\.\pipe\synthetic-tuner`,
            }),
    },
    {
        id: '1.9',
        label: 'rejects HTTPS before creating a tuner access operation',
        run: () => expect(() => access(statusTransport(), {}, 'https://synthetic.invalid:443')).toThrow(),
    },
    // Requirement 1.10 / 1.11。mirakc は User-Agent の前方一致で EPGStation を識別し、一致したときだけ
    // `GET /api/programs/{id}` を EIT[p/f] の current / next で差し替え、`/stream` で一時 on-air tracker を
    // 起動する（mirakc-core/src/web/api/programs/mod.rs:106-112 の is_epgstation が
    // starts_with("EPGStation/") で判定する。大文字小文字を区別する）。
    {
        id: '1.10',
        label: 'composes the tuner User-Agent from the EPGStation product token and its own version',
        run: () => {
            expect(composeTunerUserAgent('9.9.9')).toBe('EPGStation/9.9.9');
            expect(composeTunerUserAgent('9.9.9').startsWith('EPGStation/')).toBe(true);
        },
    },
    {
        id: '1.11',
        label: 'keeps the product token spelled exactly EPGStation',
        run: () => {
            expect(TUNER_USER_AGENT_PRODUCT).toBe('EPGStation');
            // 小文字で始まると mirakc の判定に一致せず、録画中の番組情報を EIT[p/f] で取れない。
            expect(composeTunerUserAgent('9.9.9').startsWith('epgstation/')).toBe(false);
        },
    },
    {
        id: '2.1',
        label: 'returns availability and the server version to the caller',
        run: async () =>
            expect(access(statusTransport('3.8.0')).getStatus()).resolves.toEqual({
                available: true,
                version: { current: '3.8.0', latest: '9.7.5' },
            }),
    },
    {
        id: '2.2',
        label: 'returns available tuner types through getTuners',
        run: async () => {
            const getJson = vi.fn(async () => [tunerFixture]);
            await expect(access({ getBuffer: vi.fn(), getJson }).getTuners()).resolves.toMatchObject([
                { name: 'synthetic-tuner', types: ['GR'] },
            ]);
            expect(getJson).toHaveBeenCalledWith('/api/tuners', { signal: expect.any(AbortSignal) });
        },
    },
    {
        id: '2.3',
        label: 'returns the available service DTO through getServices',
        run: async () =>
            expect(
                access({ getBuffer: vi.fn(), getJson: vi.fn(async () => [serviceFixture]) }).getServices(),
            ).resolves.toMatchObject([{ id: 101, name: 'synthetic-service', networkId: 10, serviceId: 102 }]),
    },
    {
        id: '2.4',
        label: 'returns normalized programs through getPrograms',
        run: async () =>
            expect(
                access({ getBuffer: vi.fn(), getJson: vi.fn(async () => [programFixture()]) }).getPrograms(),
            ).resolves.toMatchObject([{ id: 201, name: 'synthetic-program' }]),
    },
    {
        id: '2.5',
        label: 'uses the requested program identifier in the public program route',
        run: async () => {
            const getJson = vi.fn(async () => programFixture(201));
            await expect(access({ getBuffer: vi.fn(), getJson }).getProgram(201)).resolves.toMatchObject({ id: 201 });
            expect(getJson).toHaveBeenCalledWith('/api/programs/201', { signal: expect.any(AbortSignal) });
        },
    },
    {
        id: '2.6',
        label: 'normalizes both product series-expiry spellings to one DTO field',
        run: async () => {
            const common = {
                ...programFixture(),
                series: { episode: 1, expiresAt: 7, id: 1, lastEpisode: 2, name: 'synthetic', pattern: 3, repeat: 4 },
            };
            const mirakurun = access({ getBuffer: vi.fn(), getJson: vi.fn(async () => [common]) });
            const mirakc = access({
                getBuffer: vi.fn(),
                getJson: vi.fn(async () => [
                    { ...common, series: { ...common.series, expireAt: 7, expiresAt: undefined } },
                ]),
            });
            await expect(mirakurun.getPrograms()).resolves.toMatchObject([{ series: { expiresAt: 7 } }]);
            await expect(mirakc.getPrograms()).resolves.toMatchObject([{ series: { expiresAt: 7 } }]);
        },
    },
    {
        id: '2.7',
        label: 'does not expose the mirakc-only expiry spelling to consumers',
        run: async () => {
            const result = await access({
                getBuffer: vi.fn(),
                getJson: vi.fn(async () => [
                    {
                        ...programFixture(),
                        series: {
                            episode: 1,
                            expireAt: 8,
                            id: 1,
                            lastEpisode: 2,
                            name: 'synthetic',
                            pattern: 3,
                            repeat: 4,
                        },
                    },
                ]),
            }).getPrograms();
            expect(result[0].series).toMatchObject({ expiresAt: 8 });
            expect(result[0].series).not.toHaveProperty('expireAt');
        },
    },
    {
        id: '2.8',
        label: 'does not persist a service result between public requests',
        run: async () => {
            const getJson = vi.fn(async () => [serviceFixture]);
            const model = access({ getBuffer: vi.fn(), getJson });
            await model.getServices();
            await model.getServices();
            expect(getJson).toHaveBeenCalledTimes(2);
        },
    },
    {
        id: '3.1',
        label: 'opens the public Mirakurun change stream and reports its start',
        run: async () => {
            const stream = new PassThrough();
            const observer = changeObserver();
            const handle = await new MirakurunChangeAdapter(vi.fn(async () => stream)).open(observer);
            expect(observer.started).toHaveBeenCalledOnce();
            handle.close();
            await expect(handle.completion).resolves.toBeUndefined();
        },
    },
    {
        id: '3.2',
        label: 'maps mirakc epg.programs-updated to a service-program public REST lookup',
        run: async () => {
            let now = 10_000;
            const stream = new PassThrough();
            const getJson = vi.fn(async (path: string) => {
                if (path === '/api/services') return [serviceFixture];
                if (path === '/api/services/102/programs') return [programFixture(622)];
                throw new Error(`unexpected route: ${path}`);
            });
            const tunerAccess = access(
                { getBuffer: vi.fn(), getJson },
                {
                    changeFeed: {
                        detector: { detect: vi.fn(async () => 'mirakc') },
                        mirakc: new MirakcChangeAdapter(
                            vi.fn(async () => stream),
                            () => now,
                        ),
                        mirakurun: { open: vi.fn() },
                    },
                },
            );
            const { model, programDB } = epgChangeConsumer(tunerAccess);
            const completion = model.start().catch(error => error);
            await vi.waitFor(() => expect(stream.listenerCount('data')).toBe(1));
            stream.write('event: epg.programs-updated\ndata: {"serviceId":101}\n\n');
            now += 1_001;
            stream.write('event: epg.programs-updated\ndata: {"serviceId":102}\n\n');
            await vi.waitFor(() => expect(model.updateServiceIds).toEqual({ 102: true }));
            await model.saveUpdateServices();
            expect(getJson).toHaveBeenCalledWith('/api/services/102/programs', { signal: expect.any(AbortSignal) });
            expect(programDB.insert).toHaveBeenCalledWith(expect.any(Object), [programFixture(622)], [102]);
            stream.emit('end');
            await expect(completion).resolves.toBeInstanceOf(Error);
        },
    },
    {
        id: '3.3',
        label: 'keeps initial-acquisition, Mirakurun communication, and mirakc payload failures public',
        run: async () => {
            const acquisitionFailure = new Error('synthetic initial acquisition failure');
            const acquisitionObserver = changeObserver();
            await expect(
                new MirakurunChangeAdapter(vi.fn(async () => Promise.reject(acquisitionFailure))).open(
                    acquisitionObserver,
                ),
            ).rejects.toBeInstanceOf(Error);
            expect(acquisitionObserver.started).not.toHaveBeenCalled();

            const stream = new PassThrough();
            const observer = changeObserver();
            const handle = await new MirakurunChangeAdapter(vi.fn(async () => stream)).open(observer);
            const completion = handle.completion.catch(error => error);
            const communicationFailure = new Error('synthetic Mirakurun communication failure');
            stream.destroy(communicationFailure);
            await expect(completion).resolves.toBe(communicationFailure);
            expect(observer.aborted).toHaveBeenCalledOnce();

            const mirakcStream = new PassThrough();
            const mirakcObserver = changeObserver();
            const mirakcHandle = await new MirakcChangeAdapter(vi.fn(async () => mirakcStream)).open(mirakcObserver);
            const mirakcCompletion = mirakcHandle.completion.catch(error => error);
            mirakcStream.write('event: onair.program-changed\ndata: {invalid}\n\n');
            await expect(mirakcCompletion).resolves.toMatchObject({ message: 'Invalid mirakc change frame' });
            expect(mirakcObserver.aborted).toHaveBeenCalledOnce();
        },
    },
    {
        id: '3.4',
        label: 'keeps a normal Mirakurun end distinct from an aborted observer notification',
        run: async () => {
            const stream = new PassThrough();
            const observer = changeObserver();
            const handle = await new MirakurunChangeAdapter(vi.fn(async () => stream)).open(observer);
            const completion = handle.completion.catch(error => error);
            stream.emit('end');
            expect(await completion).toBeInstanceOf(Error);
            expect(observer.aborted).not.toHaveBeenCalled();
        },
    },
    {
        id: '3.5',
        label: 'does not reconnect or initiate aggregate, save, or full-sync effects after mirakc close',
        run: async () => {
            const stream = new PassThrough();
            const open = vi.fn(async () => stream);
            const getJson = vi.fn();
            const tunerAccess = access(
                { getBuffer: vi.fn(), getJson },
                {
                    changeFeed: {
                        detector: { detect: vi.fn(async () => 'mirakc') },
                        mirakc: new MirakcChangeAdapter(open, () => 20_000),
                        mirakurun: { open: vi.fn() },
                    },
                },
            );
            const { channelDB, model, programDB } = epgChangeConsumer(tunerAccess);
            const completion = model.start().catch(error => error);
            await vi.waitFor(() => expect(stream.listenerCount('data')).toBe(1));
            stream.destroy();
            await expect(completion).resolves.toBeInstanceOf(Error);
            stream.emit('data', Buffer.from('event: epg.programs-updated\ndata: {"serviceId":101}\n\n'));
            await Promise.resolve();
            await model.saveUpdateServices();
            expect(open).toHaveBeenCalledOnce();
            expect(getJson).not.toHaveBeenCalled();
            expect(channelDB.insert).not.toHaveBeenCalled();
            expect(programDB.insert).not.toHaveBeenCalled();
            expect(model.updateServiceIds).toEqual({});
        },
    },
    {
        id: '3.6',
        label: 'forwards duplicated Mirakurun change notifications in observed order',
        run: async () => {
            const stream = new PassThrough();
            const observer = changeObserver();
            const handle = await new MirakurunChangeAdapter(vi.fn(async () => stream)).open(observer);
            stream.write(`${changeProgram()},${changeProgram()}`);
            await Promise.resolve();
            expect(observer.changed).toHaveBeenCalledTimes(2);
            handle.close();
            await handle.completion;
        },
    },
    {
        id: '3.7',
        label: 'keeps an established change stream open without a total-duration deadline',
        run: async () => {
            vi.useFakeTimers();
            const stream = new PassThrough();
            const handle = await new MirakurunChangeAdapter(vi.fn(async () => stream)).open(changeObserver());
            let settled = false;
            void handle.completion.finally(() => {
                settled = true;
            });
            await vi.advanceTimersByTimeAsync(3_600_000);
            expect(settled).toBe(false);
            handle.close();
            await handle.completion;
            expect(vi.getTimerCount()).toBe(0);
        },
    },
    {
        id: '3.8',
        label: 'skips Mirakurun job and unknown-resource frames, and fails on a malformed program or service frame',
        run: async () => {
            const stream = new PassThrough();
            const observer = changeObserver();
            const handle = await new MirakurunChangeAdapter(vi.fn(async () => stream)).open(observer);
            const ignoredFrames = [
                { resource: 'tuner', type: 'update', data: {}, time: 2_001 },
                { resource: 'job', type: 'create', data: { key: 'synthetic-job-key', status: 'queued' }, time: 2_002 },
                { resource: 'job_schedule', type: 'create', data: { key: 'synthetic-schedule-key' }, time: 2_003 },
                { resource: 'synthetic-future-resource', type: 'update', data: 7, time: 2_004 },
            ];
            for (const frame of ignoredFrames) stream.write(JSON.stringify(frame));
            stream.write(changeProgram());
            expect(observer.aborted).not.toHaveBeenCalled();
            expect(observer.changed).toHaveBeenCalledOnce();
            handle.close();
            await expect(handle.completion).resolves.toBeUndefined();

            for (const frame of [
                { resource: 'program', type: 'remove', data: null, time: 2_005 },
                { resource: 'service', type: 'synthetic-invalid', data: {}, time: 2_006 },
                { resource: 7, type: 'update', data: {}, time: 2_007 },
            ]) {
                const malformedStream = new PassThrough();
                const malformedObserver = changeObserver();
                const malformedHandle = await new MirakurunChangeAdapter(vi.fn(async () => malformedStream)).open(
                    malformedObserver,
                );
                malformedStream.write(JSON.stringify(frame));
                await expect(malformedHandle.completion).rejects.toThrow('Invalid Mirakurun change frame');
                expect(malformedObserver.aborted).toHaveBeenCalledOnce();
            }
        },
    },
    {
        id: '4.1',
        label: 'requests a program recording stream with its program identifier and priority',
        run: async () => {
            const fixture = streamTransport(new PassThrough());
            const handle = await access(fixture.transport).openProgramStream({ priority: 7, programId: 201 });
            expect(fixture.openStream).toHaveBeenCalledWith('/api/programs/201/stream?decode=1', 7, {
                signal: expect.any(AbortSignal),
            });
            handle.close();
        },
    },
    {
        id: '4.2',
        label: 'requests a time-based recording stream with its service identifier and priority',
        run: async () => {
            const fixture = streamTransport(new PassThrough());
            const handle = await access(fixture.transport).openServiceStream({ priority: 8, serviceId: 101 });
            expect(fixture.openStream).toHaveBeenCalledWith('/api/services/101/stream?decode=1', 8, {
                signal: expect.any(AbortSignal),
            });
            handle.close();
        },
    },
    {
        id: '4.3',
        label: 'returns the recording stream readable unchanged to its caller',
        run: async () => {
            const stream = new PassThrough();
            const fixture = streamTransport(stream);
            const handle = await access(fixture.transport).openProgramStream({ priority: 1, programId: 201 });
            expect(handle.stream).toBe(stream);
            handle.close();
        },
    },
    {
        id: '4.4',
        label: 'returns a recording establishment timeout and aborts the pending upstream operation',
        run: async () => {
            vi.useFakeTimers();
            const pending = deferredOperation<{ close: () => void; stream: PassThrough }>();
            const lateStream = new PassThrough();
            const closeLateStream = vi.fn(() => {
                lateStream.destroy();
                throw new Error('synthetic late stream close failure');
            });
            const observeAbort = vi.fn();
            let signal: AbortSignal | undefined;
            const openStream = vi.fn((_path: string, _priority: number, request: { signal?: AbortSignal }) => {
                signal = request.signal;
                request.signal?.addEventListener('abort', observeAbort, { once: true });
                return pending.promise;
            });
            const operation = access(
                { getBuffer: vi.fn(), getJson: vi.fn(), openStream },
                { tunerStreamEstablishmentTimeoutMs: 10 },
            ).openProgramStream({ priority: 1, programId: 201 });
            const rejected = expect(operation).rejects.toThrow('Tuner request timeout after 10ms');
            await vi.advanceTimersByTimeAsync(10);
            await rejected;
            expect(signal?.aborted).toBe(true);
            expect(observeAbort).toHaveBeenCalledOnce();
            expect(closeLateStream).not.toHaveBeenCalled();
            expect(lateStream.destroyed).toBe(false);
            expect(vi.getTimerCount()).toBe(0);
            pending.resolve({ close: closeLateStream, stream: lateStream });
            await Promise.resolve();
            await Promise.resolve();
            expect(closeLateStream).toHaveBeenCalledOnce();
            expect(lateStream.destroyed).toBe(true);
        },
    },
    {
        id: '4.5',
        label: 'lets recording cancellation destroy the EPGStation-side stream connection once',
        run: async () => {
            const stream = new PassThrough();
            Object.assign(stream, { headers: {}, statusCode: 200 });
            const destroyResponse = vi.spyOn(stream, 'destroy');
            const requestObject = new EventEmitter() as EventEmitter & {
                destroy: ReturnType<typeof vi.fn>;
                end(): void;
            };
            requestObject.destroy = vi.fn();
            const transport = new TunerHttpTransport(
                parseConnectionTarget('http://synthetic.invalid:40772'),
                'epgstation/synthetic',
                vi.fn((_options: Record<string, unknown>, callback: (response: PassThrough) => void) => {
                    requestObject.end = () => callback(stream);
                    return requestObject;
                }),
            );
            const handle = await access(transport).openProgramStream({ priority: 1, programId: 201 });
            handle.close();
            handle.close();
            expect(requestObject.destroy).toHaveBeenCalledOnce();
            expect(destroyResponse).toHaveBeenCalledOnce();
            expect(stream.destroyed).toBe(true);
        },
    },
    {
        id: '4.6',
        label: 'keeps an established recording stream alive beyond its establishment deadline',
        run: async () => {
            vi.useFakeTimers();
            const fixture = streamTransport(new PassThrough());
            const handle = await access(fixture.transport, { tunerStreamEstablishmentTimeoutMs: 10 }).openProgramStream(
                { priority: 1, programId: 201 },
            );
            await vi.advanceTimersByTimeAsync(3_600_000);
            expect(fixture.close).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
            handle.close();
        },
    },
    {
        id: '4.7',
        label: 'returns one interrupted recording-stream request failure without resuming it',
        run: async () => {
            const failure = new Error('synthetic recording stream failure');
            const openStream = vi.fn(async () => {
                throw failure;
            });
            await expect(
                access({ getBuffer: vi.fn(), getJson: vi.fn(), openStream }).openProgramStream({
                    priority: 1,
                    programId: 201,
                }),
            ).rejects.toBe(failure);
            expect(openStream).toHaveBeenCalledOnce();
        },
    },
    {
        id: '5.1',
        label: 'requests a live service stream with the caller-selected priority',
        run: async () => {
            const fixture = streamTransport(new PassThrough());
            const handle = await access(fixture.transport).openServiceStream({ priority: 11, serviceId: 101 });
            expect(fixture.openStream).toHaveBeenCalledWith('/api/services/101/stream?decode=1', 11, {
                signal: expect.any(AbortSignal),
            });
            handle.close();
        },
    },
    {
        id: '5.2',
        label: 'returns the live stream readable unchanged to the media caller',
        run: async () => {
            const stream = new PassThrough();
            const fixture = streamTransport(stream);
            const handle = await access(fixture.transport).openServiceStream({ priority: 2, serviceId: 101 });
            expect(handle.stream).toBe(stream);
            handle.close();
        },
    },
    {
        id: '5.3',
        label: 'returns a live stream establishment failure to the media caller',
        run: async () => {
            const failure = new Error('synthetic live stream failure');
            await expect(
                access({
                    getBuffer: vi.fn(),
                    getJson: vi.fn(),
                    openStream: vi.fn(async () => Promise.reject(failure)),
                }).openServiceStream({ priority: 2, serviceId: 101 }),
            ).rejects.toBe(failure);
        },
    },
    {
        id: '5.4',
        label: 'lets live-view termination destroy the EPGStation-side stream connection',
        run: async () => {
            const stream = new PassThrough();
            const fixture = streamTransport(stream);
            const handle = await access(fixture.transport).openServiceStream({ priority: 2, serviceId: 101 });
            handle.close();
            expect(fixture.close).toHaveBeenCalledOnce();
            expect(stream.destroyed).toBe(true);
        },
    },
    {
        id: '5.5',
        label: 'does not impose a total-duration deadline on an established live stream',
        run: async () => {
            vi.useFakeTimers();
            const fixture = streamTransport(new PassThrough());
            const handle = await access(fixture.transport, { tunerStreamEstablishmentTimeoutMs: 10 }).openServiceStream(
                { priority: 2, serviceId: 101 },
            );
            await vi.advanceTimersByTimeAsync(3_600_000);
            expect(fixture.close).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
            handle.close();
        },
    },
    {
        id: '5.6',
        label: 'does not choose admission or replacement between independent live stream requests',
        run: async () => {
            const fixture = streamTransport(new PassThrough());
            const model = access(fixture.transport);
            const first = await model.openServiceStream({ priority: 1, serviceId: 101 });
            const second = await model.openServiceStream({ priority: 99, serviceId: 101 });
            expect(fixture.openStream).toHaveBeenNthCalledWith(1, '/api/services/101/stream?decode=1', 1, {
                signal: expect.any(AbortSignal),
            });
            expect(fixture.openStream).toHaveBeenNthCalledWith(2, '/api/services/101/stream?decode=1', 99, {
                signal: expect.any(AbortSignal),
            });
            first.close();
            second.close();
        },
    },
    {
        id: '5.7',
        label: 'does not expose a tuner-resource-release completion result after live close',
        run: async () => {
            const fixture = streamTransport(new PassThrough());
            const handle = await access(fixture.transport).openServiceStream({ priority: 1, serviceId: 101 });
            expect(Object.keys(handle).sort()).toEqual(['close', 'stream']);
            handle.close();
        },
    },
    {
        id: '6.1',
        label: 'requests an eligible channel logo through the public channel API',
        run: async () => {
            const getLogo = vi.fn(async () => Buffer.from('synthetic-logo'));
            const model = new ChannelApiModel(
                { findId: vi.fn(async () => ({ hasLogoData: true, id: 100 })) },
                { getLogo },
            );
            await expect(model.getLogo(100)).resolves.toEqual(Buffer.from('synthetic-logo'));
            expect(getLogo).toHaveBeenCalledWith(100);
        },
    },
    {
        id: '6.2',
        label: 'returns a retrieved logo Buffer unchanged through the public channel API',
        run: async () => {
            const logo = Buffer.from('synthetic-logo');
            const model = new ChannelApiModel(
                { findId: vi.fn(async () => ({ hasLogoData: true, id: 100 })) },
                { getLogo: vi.fn(async () => logo) },
            );
            await expect(model.getLogo(100)).resolves.toBe(logo);
        },
    },
    {
        id: '6.3',
        label: 'returns an upstream logo failure instead of projecting no logo',
        run: async () => {
            const failure = new Error('synthetic logo failure');
            const model = new ChannelApiModel(
                { findId: vi.fn(async () => ({ hasLogoData: true, id: 100 })) },
                { getLogo: vi.fn(async () => Promise.reject(failure)) },
            );
            await expect(model.getLogo(100)).rejects.toBe(failure);
        },
    },
    {
        id: '6.4',
        label: 'does not retain a returned logo between public channel API requests',
        run: async () => {
            const first = Buffer.from('first');
            const second = Buffer.from('second');
            const getLogo = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
            const model = new ChannelApiModel(
                { findId: vi.fn(async () => ({ hasLogoData: true, id: 100 })) },
                { getLogo },
            );
            await expect(model.getLogo(100)).resolves.toBe(first);
            await expect(model.getLogo(100)).resolves.toBe(second);
        },
    },
    {
        id: '6.5',
        label: 're-requests the same channel logo upstream on every public request',
        run: async () => {
            const getLogo = vi.fn(async () => Buffer.from('synthetic-logo'));
            const model = new ChannelApiModel(
                { findId: vi.fn(async () => ({ hasLogoData: true, id: 100 })) },
                { getLogo },
            );
            await model.getLogo(100);
            await model.getLogo(100);
            expect(getLogo).toHaveBeenCalledTimes(2);
            expect(getLogo).toHaveBeenNthCalledWith(1, 100);
            expect(getLogo).toHaveBeenNthCalledWith(2, 100);
        },
    },
    {
        id: '7.1',
        label: 'aborts a pending post-start REST request at its configured deadline',
        run: async () => {
            vi.useFakeTimers();
            const pending = deferredOperation<unknown>();
            const unhandledRejection = vi.fn();
            let signal: AbortSignal | undefined;
            const getJson = vi.fn((_path: string, request: { signal?: AbortSignal }) => {
                signal = request.signal;
                return pending.promise;
            });
            const operation = access({ getBuffer: vi.fn(), getJson }, { tunerRestRequestTimeoutMs: 10 }).getServices();
            let callerSettlements = 0;
            const completion = operation.then(
                () => {
                    callerSettlements += 1;
                    return undefined;
                },
                error => {
                    callerSettlements += 1;
                    return error;
                },
            );
            process.on('unhandledRejection', unhandledRejection);
            try {
                await vi.advanceTimersByTimeAsync(10);
                expect(await completion).toMatchObject({ message: 'Tuner request timeout after 10ms' });
                expect(signal?.aborted).toBe(true);
                expect(vi.getTimerCount()).toBe(0);
                pending.resolve([]);
                await Promise.resolve();
                await Promise.resolve();
                expect(callerSettlements).toBe(1);
                expect(unhandledRejection).not.toHaveBeenCalled();
            } finally {
                process.off('unhandledRejection', unhandledRejection);
            }
        },
    },
    {
        id: '7.2',
        label: 'aborts a pending stream establishment request at its configured deadline',
        run: async () => {
            vi.useFakeTimers();
            const pending = deferredOperation<{ close: () => void; stream: PassThrough }>();
            const lateStream = new PassThrough();
            const closeLateStream = vi.fn(() => lateStream.destroy());
            const observeAbort = vi.fn();
            let signal: AbortSignal | undefined;
            const openStream = vi.fn((_path: string, _priority: number, request: { signal?: AbortSignal }) => {
                signal = request.signal;
                request.signal?.addEventListener('abort', observeAbort, { once: true });
                return pending.promise;
            });
            const operation = access(
                { getBuffer: vi.fn(), getJson: vi.fn(), openStream },
                { tunerStreamEstablishmentTimeoutMs: 10 },
            ).openServiceStream({ priority: 1, serviceId: 101 });
            const rejected = expect(operation).rejects.toThrow('Tuner request timeout after 10ms');
            await vi.advanceTimersByTimeAsync(10);
            await rejected;
            expect(signal?.aborted).toBe(true);
            expect(observeAbort).toHaveBeenCalledOnce();
            expect(closeLateStream).not.toHaveBeenCalled();
            expect(lateStream.destroyed).toBe(false);
            expect(vi.getTimerCount()).toBe(0);
            pending.resolve({ close: closeLateStream, stream: lateStream });
            await Promise.resolve();
            expect(closeLateStream).toHaveBeenCalledOnce();
            expect(lateStream.destroyed).toBe(true);
        },
    },
    {
        id: '7.3',
        label: 'returns a configured-deadline error to a logo requester',
        run: async () => {
            vi.useFakeTimers();
            const pending = deferredOperation<Buffer>();
            const operation = access(
                { getBuffer: vi.fn(() => pending.promise), getJson: vi.fn() },
                { tunerRestRequestTimeoutMs: 10 },
            ).getLogo(101);
            const rejected = expect(operation).rejects.toThrow('Tuner request timeout after 10ms');
            await vi.advanceTimersByTimeAsync(10);
            await rejected;
            expect(vi.getTimerCount()).toBe(0);
            pending.resolve(Buffer.from('late-logo'));
        },
    },
    {
        id: '7.4',
        label: 'does not automatically retry a failed post-start request',
        run: async () => {
            const failure = new Error('synthetic REST failure');
            const getJson = vi.fn(async () => Promise.reject(failure));
            await expect(access({ getBuffer: vi.fn(), getJson }).getPrograms()).rejects.toBe(failure);
            expect(getJson).toHaveBeenCalledOnce();
        },
    },
    {
        id: '7.5',
        label: 'waits one second after a failed startup availability check before retrying',
        run: async () => {
            vi.useFakeTimers();
            const checkAvailability = vi
                .fn()
                .mockRejectedValueOnce(new Error('synthetic startup failure'))
                .mockResolvedValueOnce(undefined);
            const checker = new ConnectionCheckModel(
                { getLogger: () => ({ system: { info: vi.fn() } }) },
                { checkAvailability },
                { checkConnection: vi.fn() },
            );
            const operation = checker.checkMirakurun();
            await Promise.resolve();
            expect(checkAvailability).toHaveBeenCalledOnce();
            await vi.advanceTimersByTimeAsync(999);
            expect(checkAvailability).toHaveBeenCalledOnce();
            await vi.advanceTimersByTimeAsync(1);
            await expect(operation).resolves.toBeUndefined();
            expect(checkAvailability).toHaveBeenCalledTimes(2);
            expect(vi.getTimerCount()).toBe(0);
        },
    },
    {
        id: '7.6',
        label: 'keeps the startup barrier closed while a single availability request remains pending',
        run: async () => {
            vi.useFakeTimers();
            const pending = deferredOperation<void>();
            const checkAvailability = vi.fn(() => pending.promise);
            const checker = new ConnectionCheckModel(
                { getLogger: () => ({ system: { info: vi.fn() } }) },
                { checkAvailability },
                { checkConnection: vi.fn() },
            );
            let released = false;
            const operation = checker.checkMirakurun().then(() => {
                released = true;
            });
            await Promise.resolve();
            await vi.advanceTimersByTimeAsync(3_600_000);
            expect(released).toBe(false);
            expect(checkAvailability).toHaveBeenCalledOnce();
            pending.resolve();
            await operation;
            expect(released).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        },
    },
    {
        id: '7.7',
        label: 'continues startup retries beyond two failures without a retry-count cap',
        run: async () => {
            vi.useFakeTimers();
            const checkAvailability = vi
                .fn()
                .mockRejectedValueOnce(new Error('first synthetic startup failure'))
                .mockRejectedValueOnce(new Error('second synthetic startup failure'))
                .mockResolvedValueOnce(undefined);
            const checker = new ConnectionCheckModel(
                { getLogger: () => ({ system: { info: vi.fn() } }) },
                { checkAvailability },
                { checkConnection: vi.fn() },
            );
            const operation = checker.checkMirakurun();
            await Promise.resolve();
            await vi.advanceTimersByTimeAsync(2_000);
            await expect(operation).resolves.toBeUndefined();
            expect(checkAvailability).toHaveBeenCalledTimes(3);
            expect(vi.getTimerCount()).toBe(0);
        },
    },
];
const executedCanonicalProbeIds = new Set<string>();

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('tuner access characterization contract', () => {
    it('[TA-1.4] waits for a timed-out clean-install child to close after terminating it', async () => {
        vi.useFakeTimers();
        const child = new EventEmitter() as EventEmitter & {
            kill: ReturnType<typeof vi.fn>;
            stderr: PassThrough;
            stdout: PassThrough;
        };
        child.kill = vi.fn(() => true);
        child.stderr = new PassThrough();
        child.stdout = new PassThrough();
        const spawnNpm = vi.fn(() => child) as unknown as typeof spawn;
        const operation = runNpm('/synthetic-clean-install', ['ci'], {
            spawnNpm,
            terminationGraceMs: 10,
            timeoutMs: 10,
        });
        const settled = vi.fn();
        void operation.then(settled, settled);
        let closed = false;

        try {
            expect(spawnNpm).toHaveBeenCalledWith(
                process.execPath,
                [process.env.npm_execpath, 'ci'],
                expect.objectContaining({
                    env: expect.objectContaining({
                        npm_config_audit: 'false',
                        npm_config_fund: 'false',
                        npm_config_progress: 'false',
                        npm_config_update_notifier: 'false',
                    }),
                }),
            );
            await vi.advanceTimersByTimeAsync(10);
            expect(child.kill).toHaveBeenCalledWith('SIGTERM');
            expect(settled).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(10);
            expect(child.kill).toHaveBeenCalledWith('SIGKILL');
            expect(settled).not.toHaveBeenCalled();

            child.emit('close', null, 'SIGTERM');
            closed = true;
            await expect(operation).rejects.toThrow('clean-install environment timeout');
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            if (!closed) child.emit('close', 1, null);
            await operation.catch(() => undefined);
        }
    });

    it('[TA-1.4] classifies only npm ci network error codes as clean-install environment failures', async () => {
        vi.useFakeTimers();
        const rejectNpm = (args: readonly string[], output: string): Promise<string> => {
            const child = new EventEmitter() as EventEmitter & {
                kill: ReturnType<typeof vi.fn>;
                stderr: PassThrough;
                stdout: PassThrough;
            };
            child.kill = vi.fn(() => true);
            child.stderr = new PassThrough();
            child.stdout = new PassThrough();
            const operation = runNpm('/synthetic-clean-install', args, {
                spawnNpm: vi.fn(() => child) as unknown as typeof spawn,
            });
            child.stderr.write(output);
            child.emit('close', 1, null);
            return operation;
        };

        await expect(rejectNpm(['ci'], 'npm error code ENOTFOUND')).rejects.toThrow(
            'clean-install environment failure',
        );
        await expect(rejectNpm(['run', 'compile'], 'npm error code ENOTFOUND')).rejects.toThrow(
            'clean-install product regression',
        );
        await expect(rejectNpm(['ci'], 'npm error: network cache unavailable')).rejects.toThrow(
            'clean-install product regression',
        );
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(canonicalAcceptanceProbes)(
        '[TA-AC-$id] $label',
        async probe => {
            await probe.run();
            executedCanonicalProbeIds.add(probe.id);
        },
        cleanInstallProbeTimeoutMs,
    );

    it('[TA-1.2] retrieves every eligible logo request upstream without caching', async () => {
        const logo = Buffer.from('synthetic-logo');
        const getLogo = vi.fn().mockResolvedValueOnce(logo).mockRejectedValueOnce(new Error('synthetic logo failure'));
        const model = new ChannelApiModel(
            { findId: vi.fn().mockResolvedValue({ id: 100, hasLogoData: true }) },
            { getLogo },
        );
        await expect(model.getLogo(100)).resolves.toBe(logo);
        await expect(model.getLogo(100)).rejects.toThrow('synthetic logo failure');
        expect(getLogo).toHaveBeenCalledTimes(2);
        expect(getLogo).toHaveBeenNthCalledWith(1, 100);
        expect(getLogo).toHaveBeenNthCalledWith(2, 100);
    });

    it('[TA-1.3] exposes the representative Mirakurun started, changed, and normal-completion contract', async () => {
        vi.useFakeTimers();
        const stream = new PassThrough();
        const ledger: string[] = [];
        const adapter = new MirakurunChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open({
            started: () => ledger.push('started'),
            changed: () => ledger.push('changed'),
            aborted: () => ledger.push('aborted'),
        });
        const pending = handle.completion.catch((error: Error) => {
            ledger.push(`completion:${error.message}`);
        });
        try {
            stream.write(
                Buffer.from(
                    '{"resource":"program","type":"update","data":{"id":1,"eventId":2,"serviceId":3,"networkId":4,"startAt":1,"duration":60000,"isFree":true,"name":"synthetic"},"time":5}\n,\n',
                ),
            );
            stream.emit('end');
            await pending;
            expect(ledger).toEqual(['started', 'changed', 'completion:Ended tuner change feed']);
            expect(stream.destroyed).toBe(true);
            for (const event of ['data', 'error', 'end', 'close']) expect(stream.listenerCount(event)).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            stream.removeAllListeners();
            stream.destroy();
        }
    });

    it('[TA-1.5] keeps the startup barrier closed until a failed status settles, one second elapses, and a retry succeeds', async () => {
        vi.useFakeTimers();
        const checkAvailability = vi
            .fn()
            .mockRejectedValueOnce(new Error('synthetic startup failure'))
            .mockResolvedValueOnce({ version: 'synthetic' });
        const checker = new ConnectionCheckModel(
            { getLogger: () => ({ system: { info: vi.fn() } }) },
            { checkAvailability },
            { checkConnection: vi.fn() },
        );
        let barrierReleased = false;
        const barrier = checker.checkMirakurun().then(() => {
            barrierReleased = true;
        });
        try {
            await Promise.resolve();
            expect(barrierReleased).toBe(false);
            expect(checkAvailability).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(999);
            expect(barrierReleased).toBe(false);
            expect(checkAvailability).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            await barrier;
            expect(barrierReleased).toBe(true);
            expect(checkAvailability).toHaveBeenCalledTimes(2);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.clearAllTimers();
        }
    });
});

describe('tuner direct HTTP gateway contract', () => {
    it('[TA-6.4] keeps capability probe and mirakc root stream inside the shared transport', async () => {
        const harness = makeRequestHarness([
            { statusCode: 200, body: '{}' },
            { statusCode: 404 },
            { statusCode: 503, body: 'unavailable' },
            { statusCode: 404, body: 'missing' },
            { statusCode: 200, body: 'synthetic-sse' },
        ]);
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772/base'),
            'epgstation/synthetic',
            harness.request,
        );

        await expect(transport.probeJson('/api/config/server')).resolves.toEqual({ status: 200, body: {} });
        await expect(transport.probeJson('/api/config/server')).resolves.toEqual({ status: 404 });
        await expect(transport.probeJson('/api/config/server')).rejects.toThrow(/503/);
        await expect(transport.getJson('/api/config/server')).rejects.toThrow(/404/);
        const stream = await transport.getRootStream('/events');

        expect(harness.options.map(option => option.path)).toEqual([
            '/base/api/config/server',
            '/base/api/config/server',
            '/base/api/config/server',
            '/base/api/config/server',
            '/events',
        ]);
        expect(harness.options.every(option => option.headers['X-Mirakurun-Priority'] === undefined)).toBe(true);
        expect(harness.responses[2].readableEnded).toBe(true);
        expect(harness.responses[3].readableEnded).toBe(true);
        expect(stream).toBe(harness.responses[4]);
        stream.destroy();
    });

    it('[TA-2.1] parses immutable HTTP, standard/legacy Unix socket, and named-pipe targets', () => {
        const userinfoTarget = new URL('http://synthetic.invalid:40772');
        userinfoTarget.username = '<test-user>';
        userinfoTarget.password = '<test-password>';
        const standardUnixTarget = ['http+unix:', '', encodeURIComponent('/tmp/synthetic.sock'), 'nested'].join('/');
        const targets = [
            [
                'http://synthetic.invalid:40772/nested/',
                { kind: 'http', host: 'synthetic.invalid', port: 40772, basePath: '/nested' },
            ],
            [standardUnixTarget, { kind: 'unix', socketPath: '/tmp/synthetic.sock', basePath: '/nested' }],
            [
                ['http:', '', 'unix:/tmp/synthetic.sock:', 'nested'].join('/'),
                { kind: 'unix', socketPath: '/tmp/synthetic.sock', basePath: '/nested' },
            ],
            [
                String.raw`\\.\pipe\synthetic-tuner`,
                { kind: 'named-pipe', socketPath: String.raw`\\.\pipe\synthetic-tuner`, basePath: '' },
            ],
        ] as const;

        for (const [source, expected] of targets) {
            const target = parseConnectionTarget(source);
            expect(target).toEqual(expected);
            expect(Object.isFrozen(target)).toBe(true);
        }
        expect(() => parseConnectionTarget('https://synthetic.invalid:443')).toThrow(/http/i);
        expect(() => parseConnectionTarget(userinfoTarget.toString())).toThrow('Invalid HTTP tuner target');
    });

    it('[TA-2.1] normalizes root/default-port targets and rejects every unsupported target component', () => {
        expect(parseConnectionTarget('http://synthetic.invalid')).toEqual({
            kind: 'http',
            host: 'synthetic.invalid',
            port: 80,
            basePath: '',
        });
        expect(parseConnectionTarget('http://synthetic.invalid:1')).toMatchObject({ port: 1 });
        expect(parseConnectionTarget('http://synthetic.invalid:65535')).toMatchObject({ port: 65_535 });
        expect(parseConnectionTarget(['http+unix:', '', encodeURIComponent('/tmp/synthetic.sock')].join('/'))).toEqual({
            kind: 'unix',
            socketPath: '/tmp/synthetic.sock',
            basePath: '',
        });
        expect(parseConnectionTarget(['http:', '', 'unix:/tmp/synthetic.sock:'].join('/'))).toEqual({
            kind: 'unix',
            socketPath: '/tmp/synthetic.sock',
            basePath: '',
        });

        const usernameOnly = new URL('http://synthetic.invalid:40772');
        usernameOnly.username = '<test-user>';
        const passwordOnly = new URL('http://synthetic.invalid:40772');
        passwordOnly.password = '<test-password>';
        const invalidTargets = [
            'not-a-target',
            'http://synthetic.invalid:0',
            'http://synthetic.invalid:40772?query=1',
            'http://synthetic.invalid:40772#fragment',
            usernameOnly.toString(),
            passwordOnly.toString(),
            ['http+unix:', '', encodeURIComponent('relative.sock')].join('/'),
            ['http+unix:', '', encodeURIComponent('/tmp/synthetic.sock'), 'nested?query=1'].join('/'),
            ['http:', '', 'unix:relative.sock:', 'nested'].join('/'),
            ['http:', '', 'unix:/tmp/synthetic.sock:relative'].join('/'),
            ['http:', '', 'unix:'].join('/'),
        ];
        for (const target of invalidTargets) {
            expect(() => parseConnectionTarget(target)).toThrow('Invalid HTTP tuner target');
        }
        expect(() => parseConnectionTarget(['http+unix:', '', '%ZZ'].join('/'))).toThrow();
    });

    it('[TA-2.1] composes the base path once, sets only GET/User-Agent transport policy, and accepts 200-202', async () => {
        const harness = makeRequestHarness([
            { statusCode: 200, body: '{"ok":true}' },
            { statusCode: 201, body: 'created' },
            { statusCode: 202, body: 'streamed' },
        ]);
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772/nested/'),
            'epgstation/synthetic',
            harness.request,
        );

        await expect(transport.getJson('/api/status')).resolves.toEqual({ ok: true });
        await expect(transport.getBuffer('/api/services/10/logo')).resolves.toEqual(Buffer.from('created'));
        const stream = await transport.getStream('/api/programs/20/stream?decode=1&priority=3');
        await expect(
            new Promise<string>(resolve => stream.once('data', chunk => resolve(chunk.toString()))),
        ).resolves.toBe('streamed');
        expect(harness.options.map(option => option.path)).toEqual([
            '/nested/api/status',
            '/nested/api/services/10/logo',
            '/nested/api/programs/20/stream?decode=1&priority=3',
        ]);
        for (const option of harness.options) {
            expect(option).toEqual({
                headers: { 'User-Agent': 'epgstation/synthetic' },
                host: 'synthetic.invalid',
                method: 'GET',
                path: expect.any(String),
                port: 40772,
            });
            expect(option).not.toHaveProperty('auth');
            expect(option).not.toHaveProperty('agent');
            expect(option).not.toHaveProperty('ca');
            expect(option).not.toHaveProperty('cert');
            expect(option).not.toHaveProperty('protocol');
        }
    });

    it('[TA-2.1] follows only root-relative redirects and drains redirects and failures without retrying', async () => {
        const harness = makeRequestHarness([
            { statusCode: 302, location: '/api/version' },
            { statusCode: 200, body: '{"current":"1","latest":"2"}' },
            { statusCode: 503, body: 'unavailable' },
            { statusCode: 302, location: 'http://synthetic.invalid:40772/nested' },
        ]);
        const transport = new TunerHttpTransport(
            parseConnectionTarget(['http+unix:', '', encodeURIComponent('/tmp/synthetic.sock'), 'nested'].join('/')),
            'epgstation/synthetic',
            harness.request,
        );

        await expect(transport.getJson('/api/status')).resolves.toEqual({ current: '1', latest: '2' });
        expect(harness.options.slice(0, 2).map(option => option.path)).toEqual([
            '/nested/api/status',
            '/nested/api/version',
        ]);
        expect(harness.options[0]).toEqual({
            headers: { 'User-Agent': 'epgstation/synthetic' },
            method: 'GET',
            path: '/nested/api/status',
            socketPath: '/tmp/synthetic.sock',
        });
        expect(harness.responses[0].readableEnded).toBe(true);

        await expect(transport.getBuffer('/api/status')).rejects.toThrow(/503/);
        expect(harness.responses[2].readableEnded).toBe(true);
        await expect(transport.getJson('/api/status')).rejects.toThrow(/redirect/i);
        expect(harness.responses[3].readableEnded).toBe(true);
        expect(harness.options).toHaveLength(4);
    });

    it('[TA-2.1] rejects unsafe routes before I/O and covers redirect/status/JSON boundaries', async () => {
        const request = vi.fn();
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            request,
        );
        for (const route of ['relative', '//api/status', '/other/status', '/api/../status', '/api/foo/../status']) {
            await expect(transport.getJson(route)).rejects.toThrow(/route/i);
        }
        expect(request).not.toHaveBeenCalled();

        const boundaryHarness = makeRequestHarness([
            { statusCode: 301, location: '/api/status' },
            { statusCode: 399, location: '/api/status' },
            { statusCode: 200, body: '{}' },
            { statusCode: 300 },
            { statusCode: 199 },
            { statusCode: 302 },
            { statusCode: 302, location: '//synthetic.invalid/api/status' },
            { statusCode: undefined },
            { statusCode: 200, body: 'not-json' },
        ]);
        const boundaryTransport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            boundaryHarness.request,
        );
        await expect(boundaryTransport.getJson('/api/status')).resolves.toEqual({});
        await expect(boundaryTransport.getBuffer('/api/status')).rejects.toThrow(/300/);
        await expect(boundaryTransport.getBuffer('/api/status')).rejects.toThrow(/199/);
        await expect(boundaryTransport.getBuffer('/api/status')).rejects.toThrow(/redirect/i);
        await expect(boundaryTransport.getBuffer('/api/status')).rejects.toThrow(/redirect/i);
        await expect(boundaryTransport.getBuffer('/api/status')).rejects.toThrow(/status code/i);
        await expect(boundaryTransport.getJson('/api/status')).rejects.toThrow(/JSON/i);

        const redirectHarness = makeRequestHarness([
            ...Array.from({ length: 6 }, () => ({ statusCode: 302, location: '/api/status' })),
            { statusCode: 200, body: '{}' },
        ]);
        const redirectTransport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            redirectHarness.request,
        );
        await expect(redirectTransport.getJson('/api/status')).resolves.toEqual({});
        expect(redirectHarness.options).toHaveLength(7);
    });

    it('[TA-2.1] sanitizes request and response errors while draining or collecting', async () => {
        const responseError = new Error('synthetic response error');
        const harness = makeRequestHarness([
            { statusCode: 503, error: responseError },
            { statusCode: 200, error: responseError },
        ]);
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            harness.request,
        );
        await expect(transport.getBuffer('/api/status')).rejects.toThrow('Tuner response failed');
        await expect(transport.getBuffer('/api/status')).rejects.toThrow('Tuner response failed');

        const requestError = new Error('synthetic request error');
        const failingRequest = vi.fn(() => {
            const requestObject = new EventEmitter() as EventEmitter & {
                destroy: ReturnType<typeof vi.fn>;
                end: () => void;
            };
            requestObject.destroy = vi.fn();
            requestObject.end = () => queueMicrotask(() => requestObject.emit('error', requestError));
            return requestObject;
        });
        const failingTransport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            failingRequest,
        );
        await expect(failingTransport.getJson('/api/status')).rejects.toThrow('Tuner request failed');
    });

    it('[TA-2.1] treats a directly emitted string response chunk the same as a Buffer chunk', async () => {
        // The response listeners in `collect` are attached synchronously from the request callback,
        // before `makeResponse`'s queued `response.end(body)` runs, so emitting a raw string 'data'
        // event here reaches the same onData handler as every Buffer-carrying response used elsewhere
        // in this suite (TunerHttpTransport.ts:48, the non-Buffer `Buffer.from(chunk)` arm).
        const harness = makeRequestHarness([{ statusCode: 200, body: '' }]);
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            harness.request,
        );

        const result = transport.getBuffer('/api/status');
        await vi.waitFor(() => expect(harness.responses).toHaveLength(1));
        harness.responses[0].emit('data', 'synthetic-string-chunk');
        harness.responses[0].emit('end');

        await expect(result).resolves.toEqual(Buffer.from('synthetic-string-chunk'));
    });

    it('[TA-2.4] ignores a destroy failure while releasing the EPGStation-side stream connection', async () => {
        const stream = new PassThrough();
        Object.assign(stream, { headers: {}, statusCode: 200 });
        const destroyFailure = new Error('synthetic destroy failure');
        const destroyResponse = vi.spyOn(stream, 'destroy').mockImplementation(() => {
            throw destroyFailure;
        });
        const requestObject = new EventEmitter() as EventEmitter & {
            destroy: ReturnType<typeof vi.fn>;
            end(): void;
        };
        requestObject.destroy = vi.fn();
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            vi.fn((_options: Record<string, unknown>, callback: (response: PassThrough) => void) => {
                requestObject.end = () => callback(stream);
                return requestObject;
            }),
        );
        const handle = await access(transport).openProgramStream({ priority: 1, programId: 201 });

        expect(() => handle.close()).not.toThrow();

        expect(requestObject.destroy).toHaveBeenCalledOnce();
        expect(destroyResponse).toHaveBeenCalledOnce();
    });
});

describe('tuner server access DTO contract', () => {

    it('[TA-2.2] calls common REST routes directly and returns copied EPGStation-owned DTOs', async () => {
        const rawReceiver = Object.assign(
            { index: 0, name: 'synthetic-tuner' },
            {
                types: ['GR', 'BS'],
                isAvailable: true,
                isRemote: false,
                isFree: true,
                isUsing: false,
                isFault: false,
                productOnly: 'ignored',
            },
        );
        const rawService = {
            id: 10,
            serviceId: 11,
            networkId: 12,
            name: 'synthetic service',
            type: 1,
            hasLogoData: true,
            channel: { type: 'GR', channel: '13', name: 'synthetic channel', satellite: 'ignored' },
            product: 'mirakurun',
        };
        const rawProgram = {
            id: 20,
            eventId: 21,
            serviceId: 11,
            networkId: 12,
            startAt: 1_000,
            duration: 30_000,
            isFree: true,
            name: 'synthetic-program',
            description: 'synthetic description',
            genres: [{ lv1: 1, lv2: 2, un1: 3, un2: 4, unknown: true }],
            video: { type: 'h.264', resolution: '1080i', streamContent: 1, componentType: 179, unknown: true },
            audio: { componentType: 3, componentTag: 16, isMain: true, samplingRate: 48_000, langs: ['jpn'] },
            series: { id: 1, repeat: 2, pattern: 3, expiresAt: 4, episode: 5, lastEpisode: 6, name: 'series' },
            extended: { heading: 'Mirakurun text' },
            relatedItems: [{ type: 'relay', networkId: 12, serviceId: 11, eventId: 22 }],
            productOnly: 'ignored',
        };
        const payloads = new Map<string, unknown>([
            ['/api/status', { currentTime: 1 }],
            ['/api/version', { current: '1.0.0', latest: '1.1.0', product: 'ignored' }],
            ['/api/tuners', [rawReceiver]],
            ['/api/services', [rawService]],
            ['/api/programs', [rawProgram]],
            ['/api/services/10/programs', [rawProgram]],
            ['/api/programs/20', rawProgram],
        ]);
        const transport = {
            getJson: vi.fn(async (path: string) => payloads.get(path)),
            getBuffer: vi.fn(async () => Buffer.from('synthetic logo')),
        };
        const access = new TunerServerAccessModel(
            'http://synthetic.invalid:40772/nested',
            'epgstation/synthetic',
            transport,
        );

        await expect(access.checkAvailability()).resolves.toBeUndefined();
        await expect(access.getStatus()).resolves.toEqual({
            available: true,
            version: { current: '1.0.0', latest: '1.1.0' },
        });
        const tuners = await access.getTuners();
        expect(tuners).toEqual([
            Object.assign(
                { index: 0, name: 'synthetic-tuner' },
                {
                    types: ['GR', 'BS'],
                    isAvailable: true,
                    isRemote: false,
                    isFree: true,
                    isUsing: false,
                    isFault: false,
                },
            ),
        ]);
        const services = await access.getServices();
        expect(services).toEqual([
            {
                id: 10,
                serviceId: 11,
                networkId: 12,
                name: 'synthetic service',
                type: 1,
                hasLogoData: true,
                channel: { type: 'GR', channel: '13', name: 'synthetic channel' },
            },
        ]);
        const programs = await access.getPrograms();
        expect(programs).toEqual([
            {
                id: 20,
                eventId: 21,
                serviceId: 11,
                networkId: 12,
                startAt: 1_000,
                duration: 30_000,
                isFree: true,
                name: 'synthetic-program',
                description: 'synthetic description',
                genres: [{ lv1: 1, lv2: 2, un1: 3, un2: 4 }],
                video: { type: 'h.264', resolution: '1080i', streamContent: 1, componentType: 179 },
                audios: [{ componentType: 3, componentTag: 16, isMain: true, samplingRate: 48_000, langs: ['jpn'] }],
                series: { id: 1, repeat: 2, pattern: 3, expiresAt: 4, episode: 5, lastEpisode: 6, name: 'series' },
                extended: { heading: 'Mirakurun text' },
                relatedItems: [{ type: 'relay', networkId: 12, serviceId: 11, eventId: 22 }],
            },
        ]);
        await expect(access.getProgramsByService(10)).resolves.toEqual(programs);
        await expect(access.getProgram(20)).resolves.toEqual(programs[0]);
        await expect(access.getLogo(10)).resolves.toEqual(Buffer.from('synthetic logo'));

        expect(tuners[0]).not.toBe(rawReceiver);
        expect(tuners[0].types).not.toBe(rawReceiver.types);
        expect(services[0]).not.toBe(rawService);
        expect(services[0].channel).not.toBe(rawService.channel);
        expect(programs[0]).not.toBe(rawProgram);
        expect(programs[0].audios[0]).not.toBe(rawProgram.audio);
        expect(programs[0].extended).not.toBe(rawProgram.extended);
        expect(transport.getJson.mock.calls.map((call: unknown[]) => call[0])).toEqual([
            '/api/status',
            '/api/status',
            '/api/version',
            '/api/tuners',
            '/api/services',
            '/api/programs',
            '/api/services/10/programs',
            '/api/programs/20',
        ]);
        expect(transport.getBuffer.mock.calls.map((call: unknown[]) => call[0])).toEqual(['/api/services/10/logo']);
    });

    it('[TA-2.2] normalizes mirakc plural audio and description/text extended pairs', async () => {
        const rawProgram = {
            id: 30,
            eventId: 31,
            serviceId: 32,
            networkId: 33,
            startAt: 2_000,
            duration: 60_000,
            isFree: false,
            audios: [{ componentType: 2, samplingRate: 44_100, langs: ['jpn', 'eng'] }],
            audio: { componentType: 99, samplingRate: 1, langs: [] },
            extended: [
                { description: 'heading', text: 'mirakc text' },
                { key: 'legacy heading', value: 'mirakc legacy text' },
            ],
        };
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
            getJson: vi.fn(async () => [rawProgram]),
            getBuffer: vi.fn(),
        });

        const result = await access.getPrograms();

        expect(result[0].audios).toEqual([{ componentType: 2, samplingRate: 44_100, langs: ['jpn', 'eng'] }]);
        expect(result[0].extended).toEqual({ heading: 'mirakc text', 'legacy heading': 'mirakc legacy text' });
        expect(result[0].audios).not.toBe(rawProgram.audios);
        expect(result[0].extended).not.toBe(rawProgram.extended);
    });

    it('[TA-2.2] omits null related-item network IDs while preserving finite IDs', async () => {
        const relatedItems = [
            { type: 'relay', networkId: null, serviceId: 32, eventId: 34 },
            { type: 'movement', networkId: 33, serviceId: 32, eventId: 35 },
        ];
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
            getJson: vi.fn(async () => [
                {
                    id: 30,
                    eventId: 31,
                    serviceId: 32,
                    networkId: 33,
                    startAt: 2_000,
                    duration: 60_000,
                    isFree: false,
                    relatedItems,
                },
            ]),
            getBuffer: vi.fn(),
        });

        const [program] = await access.getPrograms();

        expect(program.relatedItems).toEqual([
            { type: 'relay', serviceId: 32, eventId: 34 },
            { type: 'movement', networkId: 33, serviceId: 32, eventId: 35 },
        ]);
        expect(program.relatedItems).not.toBe(relatedItems);
    });

    it.each([
        ['a string', '33'],
        ['NaN', Number.NaN],
        ['positive infinity', Number.POSITIVE_INFINITY],
        ['negative infinity', Number.NEGATIVE_INFINITY],
    ])('[TA-2.2] rejects %s related-item network IDs', async (_label, networkId) => {
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
            getJson: vi.fn(async () => [
                {
                    id: 30,
                    eventId: 31,
                    serviceId: 32,
                    networkId: 33,
                    startAt: 2_000,
                    duration: 60_000,
                    isFree: false,
                    relatedItems: [{ type: 'relay', networkId, serviceId: 32, eventId: 34 }],
                },
            ]),
            getBuffer: vi.fn(),
        });

        await expect(access.getPrograms()).rejects.toThrow('Invalid tuner server response');
    });

    it('[TA-2.2] rejects missing, wrong-shaped, and non-finite required values without partial results or I/O for invalid IDs', async () => {
        const getJson = vi
            .fn()
            .mockResolvedValueOnce([
                {
                    index: 0,
                    name: 'synthetic-valid',
                    types: ['GR'],
                    isAvailable: true,
                    isRemote: false,
                    isFree: true,
                    isUsing: false,
                    isFault: false,
                },
                {
                    index: Number.POSITIVE_INFINITY,
                    name: 'synthetic-invalid',
                    types: ['GR'],
                    isAvailable: true,
                    isRemote: false,
                    isFree: true,
                    isUsing: false,
                    isFault: false,
                },
            ])
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ current: 'missing latest' });
        const transport = { getJson, getBuffer: vi.fn() };
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', transport);

        await expect(access.getTuners()).rejects.toThrow('Invalid tuner server response');
        await expect(access.getStatus()).rejects.toThrow('Invalid tuner server response');
        await expect(access.getProgram(Number.NaN)).rejects.toThrow('Invalid tuner server id');
        await expect(access.getProgramsByService(Number.POSITIVE_INFINITY)).rejects.toThrow('Invalid tuner server id');
        await expect(access.getLogo(Number.NaN)).rejects.toThrow('Invalid tuner server id');
        expect(getJson).toHaveBeenCalledTimes(3);
        expect(transport.getBuffer).not.toHaveBeenCalled();
    });

    it('[TA-2.2] does not cache status, information, or logo requests', async () => {
        const transport = {
            getJson: vi.fn(async (path: string) => {
                if (path === '/api/status') return {};
                if (path === '/api/version') return { current: '1', latest: '2' };
                return [];
            }),
            getBuffer: vi.fn(async () => Buffer.from('logo')),
        };
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', transport);

        await access.getStatus();
        await access.getStatus();
        await access.getServices();
        await access.getServices();
        await access.getLogo(10);
        await access.getLogo(10);

        expect(transport.getJson.mock.calls.map((call: unknown[]) => call[0])).toEqual([
            '/api/status',
            '/api/version',
            '/api/status',
            '/api/version',
            '/api/services',
            '/api/services',
        ]);
        expect(transport.getBuffer).toHaveBeenCalledTimes(2);
    });

    it('[TA-2.2] accepts every owned enum value and rejects invalid JSON shapes before returning a DTO', async () => {
        const validReceiverFields = {
            index: 0,
            name: 'synthetic-tuner',
            types: ['CS', 'SKY'],
            isAvailable: true,
            isRemote: false,
            isFree: true,
            isUsing: false,
            isFault: false,
        };
        const validProgram = {
            id: 40,
            eventId: 41,
            serviceId: 42,
            networkId: 43,
            startAt: 3_000,
            duration: 10_000,
            isFree: true,
            relatedItems: [
                { type: 'shared', serviceId: 42, eventId: 44 },
                { type: 'movement', serviceId: 42, eventId: 45 },
            ],
        };
        const getJson = vi.fn().mockResolvedValueOnce([validReceiverFields]).mockResolvedValueOnce([validProgram]);
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
            getJson,
            getBuffer: vi.fn(),
        });

        await expect(access.getTuners()).resolves.toEqual([validReceiverFields]);
        await expect(access.getPrograms()).resolves.toEqual([validProgram]);

        const receiverArray = Object.assign([], validReceiverFields);
        const receiverFunction = Object.assign(
            () => undefined,
            Object.fromEntries(Object.entries(validReceiverFields).filter(([key]) => key !== 'name')),
        );
        const invalidPayloads = [
            {},
            [null],
            [receiverArray],
            [receiverFunction],
            [Object.assign({}, validReceiverFields, { index: '0' })],
            [Object.assign({}, validReceiverFields, { isFree: 'true' })],
            [Object.assign({}, validReceiverFields, { types: [123] })],
        ];
        for (const payload of invalidPayloads) {
            getJson.mockResolvedValueOnce(payload);
            await expect(access.getTuners()).rejects.toThrow('Invalid tuner server response');
        }
        getJson.mockResolvedValueOnce([
            Object.assign({}, validProgram, {
                relatedItems: [{ type: 'invalid', serviceId: 42, eventId: 44 }],
            }),
        ]);
        await expect(access.getPrograms()).rejects.toThrow('Invalid tuner server response');
    });

    // .kiro/specs/server-tuner-access/design.md's正規化規則: `channel.type`はGR/BS/CS/SKY/BS4Kの
    // 既知5値に限定しない。Mirakurunはchannels.ymlのtypeを検証せずそのまま返すため、その5値以外の
    // 文字列も届き得る。この機能は`channel.type`が既知5値のいずれでもないことだけを理由に一件も解析
    // 失敗にせず、v2同様に文字列をそのまま公開DTOへ通す。undefined以下の他service群は失敗させない
    // 一方、rejectしたoperationは部分結果を返さない既存契約を保つ。BS4Kは既知種別（保存側で
    // channelTypeId 5）だが、正規化自体は既知/未知を区別せず同じ経路を通ることも併せて確認する。
    it('[TA-2.2] passes a known BS4K channel.type and an unknown channel.type value (any other server-defined string) through unchanged instead of rejecting the whole services batch', async () => {
        const grService = {
            id: 10,
            serviceId: 11,
            networkId: 12,
            name: 'synthetic-gr',
            type: 1,
            channel: { type: 'GR', channel: '13' },
        };
        const bs4kService = {
            id: 20,
            serviceId: 21,
            networkId: 22,
            name: 'synthetic-bs4k',
            type: 1,
            channel: { type: 'BS4K', channel: 'BS4K-01' },
        };
        const arbitraryTypeService = {
            id: 30,
            serviceId: 31,
            networkId: 32,
            name: 'synthetic-arbitrary',
            type: 1,
            channel: { type: 'WOWOW-4K', channel: 'ARB-01' },
        };
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
            getJson: vi.fn(async () => [grService, bs4kService, arbitraryTypeService]),
            getBuffer: vi.fn(),
        });

        await expect(access.getServices()).resolves.toEqual([
            {
                id: 10,
                serviceId: 11,
                networkId: 12,
                name: 'synthetic-gr',
                type: 1,
                channel: { type: 'GR', channel: '13' },
            },
            {
                id: 20,
                serviceId: 21,
                networkId: 22,
                name: 'synthetic-bs4k',
                type: 1,
                channel: { type: 'BS4K', channel: 'BS4K-01' },
            },
            {
                id: 30,
                serviceId: 31,
                networkId: 32,
                name: 'synthetic-arbitrary',
                type: 1,
                channel: { type: 'WOWOW-4K', channel: 'ARB-01' },
            },
        ]);
    });

    it.each([
        ['a number', 4],
        ['null', null],
        ['missing', undefined],
    ])('[TA-2.2] still rejects the whole services batch when channel.type is %s, like other required string fields', async (
        _label,
        type,
    ) => {
        const rawChannel: Record<string, unknown> = { channel: '13' };
        if (type !== undefined) rawChannel.type = type;
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
            getJson: vi.fn(async () => [
                {
                    id: 10,
                    serviceId: 11,
                    networkId: 12,
                    name: 'synthetic-gr',
                    type: 1,
                    channel: rawChannel,
                },
            ]),
            getBuffer: vi.fn(),
        });

        await expect(access.getServices()).rejects.toThrow('Invalid tuner server response');
    });

    // .kiro/specs/server-tuner-access/design.md's正規化規則: TunerInfo.types（/api/tunersのチューナー
    // 対応種別）も、Mirakurunの`channels.yml`に書かれた任意の文字列を含み得る点はchannel.typeと同じで
    // ある。v2はmirakurun clientの返す`types`を検証せずそのまま`Tuner`へ渡していたため、この機能も
    // GR/BS/CS/SKY/BS4Kの既知5値のいずれでもないことだけを理由に`getTuners()`全体を解析失敗にせず、
    // 他の必須文字列fieldと同じ型検査だけを適用してそのまま通す。BS4K対応tuner（`types`にBS4Kを含む）
    // も既知/未知を区別しない同じ経路を通ることを併せて確認する。
    it('[TA-2.2] passes a known BS4K tuner type and an unknown tuner type value (any other server-defined string) through unchanged instead of rejecting the whole tuners batch', async () => {
        const grTuner = {
            index: 0,
            name: 'synthetic-gr-tuner',
            types: ['GR', 'BS'],
            isAvailable: true,
            isRemote: false,
            isFree: true,
            isUsing: false,
            isFault: false,
        };
        const bs4kTuner = {
            index: 1,
            name: 'synthetic-bs4k-tuner',
            types: ['BS4K'],
            isAvailable: true,
            isRemote: false,
            isFree: true,
            isUsing: false,
            isFault: false,
        };
        const arbitraryTypeTuner = {
            index: 2,
            name: 'synthetic-arbitrary-tuner',
            types: ['WOWOW-4K'],
            isAvailable: true,
            isRemote: false,
            isFree: true,
            isUsing: false,
            isFault: false,
        };
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
            getJson: vi.fn(async () => [grTuner, bs4kTuner, arbitraryTypeTuner]),
            getBuffer: vi.fn(),
        });

        await expect(access.getTuners()).resolves.toEqual([grTuner, bs4kTuner, arbitraryTypeTuner]);
    });

    it.each([
        ['a number', 4],
        ['null', null],
    ])('[TA-2.2] still rejects the whole tuners batch when a types entry is %s, like other required string fields', async (
        _label,
        typeValue,
    ) => {
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
            getJson: vi.fn(async () => [
                {
                    index: 0,
                    name: 'synthetic-tuner',
                    types: [typeValue],
                    isAvailable: true,
                    isRemote: false,
                    isFree: true,
                    isUsing: false,
                    isFault: false,
                },
            ]),
            getBuffer: vi.fn(),
        });

        await expect(access.getTuners()).rejects.toThrow('Invalid tuner server response');
    });
});

describe('tuner request deadlines and stream handles', () => {
    // 2_147_483_648 rejected / 2_147_483_647 accepted below bound
    // TunerServerAccessModel.MAX_TUNER_TIMEOUT_MS (src/model/tuner/TunerServerAccessModel.ts:37),
    // a v3-only optional-field range with no v2 counterpart -- approved in
    // .kiro/specs/server-tuner-access/design.md:606-613.
    it('[TA-2.4] validates startup timeout snapshots without treating zero as unlimited', () => {
        const target = 'http://synthetic.invalid:40772';
        const userAgent = 'epgstation/synthetic';
        const invalid = [
            null,
            '30000',
            {},
            0,
            -1,
            1.5,
            Number.NaN,
            Number.POSITIVE_INFINITY,
            2_147_483_648,
            Number.MAX_SAFE_INTEGER,
        ];
        for (const value of invalid) {
            expect(
                () =>
                    new TunerServerAccessModel(target, userAgent, undefined, {
                        tunerRestRequestTimeoutMs: value,
                    }),
            ).toThrow(/timeout/i);
            expect(
                () =>
                    new TunerServerAccessModel(target, userAgent, undefined, {
                        tunerStreamEstablishmentTimeoutMs: value,
                    }),
            ).toThrow(/timeout/i);
        }
        expect(
            () =>
                new TunerServerAccessModel(target, userAgent, undefined, {
                    tunerRestRequestTimeoutMs: 1,
                    tunerStreamEstablishmentTimeoutMs: 2_147_483_647,
                }),
        ).not.toThrow();
    });

    it('[TA-2.4] leaves startup availability unbounded but bounds a later REST operation', async () => {
        vi.useFakeTimers();
        let resolveStartup: ((value: unknown) => void) | undefined;
        const signals: Array<AbortSignal | undefined> = [];
        const transport = {
            getJson: vi.fn((_path: string, options?: { signal?: AbortSignal }) => {
                signals.push(options?.signal);
                return new Promise<unknown>((resolve, reject) => {
                    if (signals.length === 1) {
                        resolveStartup = resolve;
                        return;
                    }
                    options?.signal?.addEventListener(
                        'abort',
                        () => reject(new Error('synthetic transport cancellation')),
                        { once: true },
                    );
                });
            }),
            getBuffer: vi.fn(),
            openStream: vi.fn(),
        };
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', transport, {
            tunerRestRequestTimeoutMs: 30_000,
        });

        let startupSettled = false;
        const startup = access.checkAvailability().then(() => {
            startupSettled = true;
        });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(startupSettled).toBe(false);
        expect(signals[0]).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
        resolveStartup?.({});
        await startup;

        let result = 'pending';
        void access.getPrograms().then(
            () => {
                result = 'resolved';
            },
            (error: Error) => {
                result = error.message;
            },
        );
        await vi.advanceTimersByTimeAsync(29_999);
        expect(result).toBe('pending');
        await vi.advanceTimersByTimeAsync(1);
        expect(result).toMatch(/timeout/i);
        expect(signals[1]?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    // 30_000 (30s) is TunerServerAccessModel.DEFAULT_TUNER_TIMEOUT_MS
    // (src/model/tuner/TunerServerAccessModel.ts:36), applied by the `value === undefined` branch
    // when a caller omits `tunerRestRequestTimeoutMs` / `tunerStreamEstablishmentTimeoutMs`
    // entirely -- approved in .kiro/specs/server-tuner-access/design.md:606-613.
    it('[TA-2.4-DEFAULT-TIMEOUT] applies the 30,000ms default to REST and stream requests when both timeout settings are omitted', async () => {
        vi.useFakeTimers();
        const target = access({
            getBuffer: vi.fn(),
            getJson: vi.fn(() => new Promise<unknown>(() => undefined)),
            openStream: vi.fn(() => new Promise<never>(() => undefined)),
        });

        let restResult = 'pending';
        void target.getStatus().then(
            () => {
                restResult = 'resolved';
            },
            (error: Error) => {
                restResult = error.message;
            },
        );
        await vi.advanceTimersByTimeAsync(29_999);
        expect(restResult).toBe('pending');
        await vi.advanceTimersByTimeAsync(1);
        expect(restResult).toMatch(/timeout/i);
        expect(vi.getTimerCount()).toBe(0);

        let streamResult = 'pending';
        void target.openProgramStream({ programId: 201, priority: 1 }).then(
            () => {
                streamResult = 'resolved';
            },
            (error: Error) => {
                streamResult = error.message;
            },
        );
        await vi.advanceTimersByTimeAsync(29_999);
        expect(streamResult).toBe('pending');
        await vi.advanceTimersByTimeAsync(1);
        expect(streamResult).toMatch(/timeout/i);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[TA-2.4] uses one absolute REST deadline across root-relative redirects', async () => {
        vi.useFakeTimers();
        const paths: string[] = [];
        const requests: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
        const request = vi.fn((options: { path: string }, callback: (response: PassThrough) => void) => {
            const requestObject = new EventEmitter() as EventEmitter & {
                destroy: ReturnType<typeof vi.fn>;
                end(): void;
            };
            let responseTimer: ReturnType<typeof setTimeout> | undefined;
            requestObject.destroy = vi.fn(() => clearTimeout(responseTimer));
            requestObject.end = () => {
                paths.push(options.path);
                responseTimer = setTimeout(() => {
                    const redirect = new PassThrough() as PassThrough & {
                        headers: { location: string };
                        statusCode: number;
                    };
                    redirect.statusCode = 302;
                    redirect.headers = { location: '/moved/status' };
                    queueMicrotask(() => redirect.end());
                    callback(redirect);
                }, 3);
            };
            requests.push(requestObject);
            return requestObject;
        });
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772/nested'),
            'epgstation/synthetic',
            request,
        );
        const access = new TunerServerAccessModel(
            'http://synthetic.invalid:40772/nested',
            'epgstation/synthetic',
            transport,
            { tunerRestRequestTimeoutMs: 10 },
        );

        let result = 'pending';
        void access.getPrograms().then(
            () => {
                result = 'resolved';
            },
            (error: Error) => {
                result = error.message;
            },
        );
        await vi.advanceTimersByTimeAsync(9);
        expect(result).toBe('pending');
        await vi.advanceTimersByTimeAsync(1);
        expect(result).toMatch(/timeout/i);
        expect(paths).toEqual([
            '/nested/api/programs',
            '/nested/moved/status',
            '/nested/moved/status',
            '/nested/moved/status',
        ]);
        expect(requests.at(-1)?.destroy).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[TA-2.4] passes request-local priority and returns an idempotently closable stream handle', async () => {
        vi.useFakeTimers();
        const response = new PassThrough();
        Object.assign(response, { headers: {}, statusCode: 200 });
        const responseDestroy = vi.spyOn(response, 'destroy');
        const requestObject = new EventEmitter() as EventEmitter & {
            destroy: ReturnType<typeof vi.fn>;
            end(): void;
        };
        requestObject.destroy = vi.fn();
        const optionsSeen: Record<string, unknown>[] = [];
        const request = vi.fn((options: Record<string, unknown>, callback: (value: PassThrough) => void) => {
            optionsSeen.push(options);
            requestObject.end = () => callback(response);
            return requestObject;
        });
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772/nested'),
            'epgstation/synthetic',
            request,
        );
        const access = new TunerServerAccessModel(
            'http://synthetic.invalid:40772/nested',
            'epgstation/synthetic',
            transport,
            { tunerStreamEstablishmentTimeoutMs: 30_000 },
        );
        const controller = new AbortController();
        const addCallerListener = vi.spyOn(controller.signal, 'addEventListener');
        const removeCallerListener = vi.spyOn(controller.signal, 'removeEventListener');

        const handle = await access.openServiceStream({ serviceId: 20, priority: 11, signal: controller.signal });
        expect(handle.stream).toBe(response);
        expect(optionsSeen).toEqual([
            {
                headers: {
                    'User-Agent': 'epgstation/synthetic',
                    'X-Mirakurun-Priority': '11',
                },
                host: 'synthetic.invalid',
                method: 'GET',
                path: '/nested/api/services/20/stream?decode=1',
                port: 40772,
            },
        ]);
        expect(addCallerListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
        expect(removeCallerListener).toHaveBeenCalledWith('abort', expect.any(Function));
        expect(removeCallerListener).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);

        controller.abort();
        expect(requestObject.destroy).not.toHaveBeenCalled();
        handle.close();
        handle.close();
        expect(requestObject.destroy).toHaveBeenCalledTimes(1);
        expect(responseDestroy).toHaveBeenCalledTimes(1);
    });

    it('[TA-2.4] exposes the program stream route through the facade without retaining its deadline', async () => {
        vi.useFakeTimers();
        const stream = new PassThrough();
        const close = vi.fn();
        const openStream = vi.fn(async () => ({ stream, close }));
        const transport = { getJson: vi.fn(), getBuffer: vi.fn(), openStream };
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', transport);
        const controller = new AbortController();

        await expect(
            access.openProgramStream({ programId: 30, priority: 12, signal: controller.signal }),
        ).resolves.toEqual({ stream, close });
        expect(openStream.mock.calls[0][0]).toBe('/api/programs/30/stream?decode=1');
        expect(openStream.mock.calls[0][1]).toBe(12);
        expect(openStream.mock.calls[0][2].signal).toBeInstanceOf(AbortSignal);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[TA-2.4] rejects a pre-cancelled stream without starting transport or deadline resources', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        controller.abort();
        const openStream = vi.fn();
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
            getJson: vi.fn(),
            getBuffer: vi.fn(),
            openStream,
        });

        await expect(
            access.openServiceStream({ serviceId: 20, priority: 11, signal: controller.signal }),
        ).rejects.toThrow('Tuner request cancelled');
        expect(openStream).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[TA-8.3] closes a late stream handle once after caller cancellation without changing its terminal result', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const pending = deferredOperation<{ close: () => void; stream: PassThrough }>();
        const lateStream = new PassThrough();
        const closeLateStream = vi.fn(() => {
            lateStream.destroy();
            throw new Error('synthetic late stream close failure');
        });
        const unhandledRejection = vi.fn();
        const addCallerListener = vi.spyOn(controller.signal, 'addEventListener');
        const removeCallerListener = vi.spyOn(controller.signal, 'removeEventListener');
        let upstreamSignal: AbortSignal | undefined;
        const openStream = vi.fn((_path: string, _priority: number, options: { signal?: AbortSignal }) => {
            upstreamSignal = options.signal;
            return pending.promise;
        });
        const model = new TunerServerAccessModel(
            'http://synthetic.invalid:40772',
            'epgstation/synthetic',
            { getBuffer: vi.fn(), getJson: vi.fn(), openStream },
            { tunerStreamEstablishmentTimeoutMs: 10 },
        );
        const operation = model.openServiceStream({ priority: 1, serviceId: 101, signal: controller.signal });
        let callerSettlements = 0;
        const completion = operation.then(
            () => {
                callerSettlements += 1;
                return undefined;
            },
            error => {
                callerSettlements += 1;
                return error;
            },
        );
        const unhandledRejectionListenerCount = process.listenerCount('unhandledRejection');
        process.on('unhandledRejection', unhandledRejection);
        try {
            expect(vi.getTimerCount()).toBe(1);
            controller.abort();
            const terminalResult = await completion;
            expect(terminalResult).toMatchObject({ message: 'Tuner request cancelled' });
            expect(upstreamSignal?.aborted).toBe(true);
            expect(addCallerListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
            expect(removeCallerListener).toHaveBeenCalledWith('abort', expect.any(Function));
            expect(removeCallerListener).toHaveBeenCalledOnce();
            expect(vi.getTimerCount()).toBe(0);

            pending.resolve({ close: closeLateStream, stream: lateStream });
            await Promise.resolve();
            await Promise.resolve();

            expect(callerSettlements).toBe(1);
            expect(terminalResult).toMatchObject({ message: 'Tuner request cancelled' });
            expect(closeLateStream).toHaveBeenCalledOnce();
            expect(lateStream.destroyed).toBe(true);
            expect(unhandledRejection).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
            expect(removeCallerListener).toHaveBeenCalledOnce();

            vi.useRealTimers();
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(unhandledRejection).not.toHaveBeenCalled();
        } finally {
            process.off('unhandledRejection', unhandledRejection);
            expect(process.listenerCount('unhandledRejection')).toBe(unhandledRejectionListenerCount);
        }
    });

    it('[TA-2.4] rejects an unavailable stream transport with its stable facade error', () => {
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
            getJson: vi.fn(),
            getBuffer: vi.fn(),
        });

        expect(() => access.openServiceStream({ serviceId: 20, priority: 11 })).toThrow(
            'Tuner stream transport is unavailable',
        );
    });

    it.each([
        ['asynchronously', () => Promise.reject('synthetic non-error rejection')],
        [
            'synchronously',
            () => {
                throw 'synthetic non-error throw';
            },
        ],
    ])('[TA-2.4] sanitizes a non-Error stream transport failure %s', async (_label, fail) => {
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
            getJson: vi.fn(),
            getBuffer: vi.fn(),
            openStream: vi.fn(fail),
        });

        await expect(access.openServiceStream({ serviceId: 20, priority: 11 })).rejects.toThrow('Tuner request failed');
    });

    it.each([
        ['mirakurun', 'mirakc'],
        ['mirakc', 'mirakurun'],
    ] as const)(
        '[TA-2.3] selects the %s adapter behind the change-feed facade and leaves %s unopened',
        async (product, unusedProduct) => {
            const stream = new PassThrough();
            const handle = { stream, completion: Promise.resolve(), close: vi.fn() };
            const detector = { detect: vi.fn(async () => product) };
            const mirakurun = { open: vi.fn(async () => handle) };
            const mirakc = { open: vi.fn(async () => handle) };
            const observer = { started: vi.fn(), changed: vi.fn(), aborted: vi.fn() };
            const controller = new AbortController();
            const access = new TunerServerAccessModel(
                'http://synthetic.invalid:40772',
                'epgstation/synthetic',
                { getJson: vi.fn(), getBuffer: vi.fn() },
                { changeFeed: { detector, mirakurun, mirakc } },
            );

            await expect(access.openChangeFeed(observer, { signal: controller.signal })).resolves.toBe(handle);

            expect(detector.detect).toHaveBeenCalledWith({ signal: controller.signal });
            expect({ mirakurun, mirakc }[product].open).toHaveBeenCalledWith(observer, { signal: controller.signal });
            expect({ mirakurun, mirakc }[unusedProduct].open).not.toHaveBeenCalled();
        },
    );

    it('[TA-2.3] rejects an unavailable change-feed dependency with its stable facade error', async () => {
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
            getJson: vi.fn(),
            getBuffer: vi.fn(),
        });

        await expect(access.openChangeFeed({ started: vi.fn(), changed: vi.fn(), aborted: vi.fn() })).rejects.toThrow(
            'Tuner change feed is unavailable',
        );
    });

    it('[TA-2.3] classifies the product from one capability probe and caches it for every later detection', async () => {
        const probe = vi.fn(async () => ({ status: 200, body: {} }));
        const detector = new ProductDetector(probe);

        await expect(detector.detect()).resolves.toBe('mirakurun');
        await expect(detector.detect()).resolves.toBe('mirakurun');

        expect(probe).toHaveBeenCalledTimes(1);
    });

    it('[TA-2.3] normalizes a Mirakurun program-update frame into a typed change with its own time', async () => {
        const stream = new PassThrough();
        const observer = changeObserver();
        const handle = await new MirakurunChangeAdapter(vi.fn(async () => stream)).open(observer);

        stream.write(changeProgram());
        await Promise.resolve();

        expect(observer.changed).toHaveBeenCalledWith({
            kind: 'program',
            operation: 'update',
            program: expect.objectContaining({ id: 201 }),
            time: 2_000,
        });
        handle.close();
        await handle.completion;
    });
});
