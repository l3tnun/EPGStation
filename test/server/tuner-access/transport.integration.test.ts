import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const TunerHttpTransport = (
    require(join(compiledSnapshot, 'model', 'tuner', 'transport', 'TunerHttpTransport.js')) as any
).default;
const { parseConnectionTarget } = require(
    join(compiledSnapshot, 'model', 'tuner', 'transport', 'ConnectionTargetParser.js'),
) as any;
const TunerServerAccessModel = (require(join(compiledSnapshot, 'model', 'tuner', 'TunerServerAccessModel.js')) as any)
    .default;
const MirakurunChangeAdapter = (
    require(join(compiledSnapshot, 'model', 'tuner', 'change', 'MirakurunChangeAdapter.js')) as any
).default;
const MirakcChangeAdapter = (
    require(join(compiledSnapshot, 'model', 'tuner', 'change', 'MirakcChangeAdapter.js')) as any
).default;
const ProductDetector = (require(join(compiledSnapshot, 'model', 'tuner', 'change', 'ProductDetector.js')) as any)
    .default;

type RouteHandler = (request: IncomingMessage, response: ServerResponse) => void;
// Bounds connection establishment in exerciseCommonOperations/exerciseChangeOperations so a corrupted
// ConnectionTarget (e.g. from a defect in ConnectionTargetParser.ts) fails fast instead of hanging on a
// real loopback connect/request that never settles. The default TunerServerAccessModel /
// TunerHttpTransport deadline is 30_000ms (or unbounded for direct transport.*() calls with no signal),
// far above Vitest's default 5000ms case timeout, so a hang here would read as a timeout even though it
// would eventually settle. Measured via `vitest run --reporter=verbose` against this file: the slowest
// passing case (composite [TA-8.3] test exercising common + change + failure operations in sequence)
// took 383ms; individual REST/stream calls inside exerciseCommonOperations and exerciseChangeOperations
// are single loopback round trips and complete in low single-digit ms. 2000ms is ~5.2x that observed
// maximum (healthy margin over CI jitter) while staying well under the case timeout, so a real success
// never trips it but a genuine hang is capped early.
const connectionDeadlineMs = 2_000;
const loopbackHost = '127.0.0.1';
const loopbackUrl = (port: number): string => ['http:', '', `${loopbackHost}:${port}`, 'base'].join('/');

class SyntheticTunerServer {
    public readonly requests: Array<{ headers: IncomingMessage['headers']; method?: string; url?: string }> = [];
    private readonly server: Server;
    private readonly sockets = new Set<Socket>();
    private socketDirectory?: string;
    private socketPath?: string;

    constructor(handler: RouteHandler) {
        this.server = createServer((request, response) => {
            this.requests.push({ headers: request.headers, method: request.method, url: request.url });
            handler(request, response);
        });
        this.server.on('connection', socket => {
            this.sockets.add(socket);
            socket.once('close', () => this.sockets.delete(socket));
        });
    }

    public async listenHttp(): Promise<string> {
        await new Promise<void>((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(0, loopbackHost, () => resolve());
        });
        const address = this.server.address();
        if (address === null || typeof address === 'string') throw new Error('Synthetic HTTP address is unavailable');
        return loopbackUrl(address.port);
    }

    public async listenUnix(): Promise<string> {
        this.socketDirectory = await mkdtemp(join(tmpdir(), 'epgstation-tuner-'));
        this.socketPath = join(this.socketDirectory, 'tuner.sock');
        await new Promise<void>((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(this.socketPath, () => resolve());
        });
        return ['http+unix:', '', encodeURIComponent(this.socketPath), 'base'].join('/');
    }

    public async listenNamedPipe(): Promise<string> {
        this.socketPath = `\\\\.\\pipe\\epgstation-tuner-${process.pid}-${Date.now()}`;
        await new Promise<void>((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(this.socketPath, () => resolve());
        });
        return this.socketPath;
    }

    public activeSocketCount(): number {
        return this.sockets.size;
    }

    public async close(): Promise<void> {
        for (const socket of this.sockets) socket.destroy();
        await new Promise<void>((resolve, reject) => {
            this.server.close(error => (error === undefined ? resolve() : reject(error)));
        });
        if (this.socketPath !== undefined && process.platform !== 'win32') {
            await expect(stat(this.socketPath)).rejects.toMatchObject({ code: 'ENOENT' });
        }
        if (this.socketDirectory !== undefined) await rm(this.socketDirectory, { recursive: true });
    }
}

const servers = new Set<SyntheticTunerServer>();
const startServer = async (kind: 'http' | 'unix', handler: RouteHandler): Promise<[SyntheticTunerServer, string]> => {
    const server = new SyntheticTunerServer(handler);
    servers.add(server);
    return [server, kind === 'http' ? await server.listenHttp() : await server.listenUnix()];
};

afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const server of [...servers]) {
        await server.close();
        servers.delete(server);
    }
});

const writeJson = (response: ServerResponse, value: unknown, status: number = 200): void => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
};

const tuner = {
    index: 0,
    name: 'synthetic-tuner',
    types: ['GR'],
    isAvailable: true,
    isRemote: false,
    isFree: true,
    isUsing: false,
    isFault: false,
};
const service = {
    id: 101,
    serviceId: 102,
    networkId: 10,
    name: 'synthetic-service',
    type: 1,
    hasLogoData: true,
    channel: { type: 'GR', channel: '13' },
};
const program = {
    id: 201,
    eventId: 202,
    serviceId: 102,
    networkId: 10,
    startAt: 1_000,
    duration: 60_000,
    isFree: true,
    name: 'synthetic-program',
};

type MatrixState = {
    failure?: 'abort' | 'hang' | 'parse' | 'status';
    product: 'mirakurun' | 'mirakc';
};

const matrixUrl = (request: IncomingMessage): string => {
    const url = request.url ?? '';
    return url === '/events' || url.startsWith('/base/') ? url : `/base${url}`;
};

const commonHandler = (request: IncomingMessage, response: ServerResponse): void => {
    const url = matrixUrl(request);
    if (url === '/base/api/status') return writeJson(response, { available: true });
    if (url === '/base/api/version') return writeJson(response, { current: '3.8.0', latest: '3.8.0' });
    if (url === '/base/api/tuners') return writeJson(response, [tuner]);
    if (url === '/base/api/services') return writeJson(response, [service]);
    if (url === '/base/api/programs') return writeJson(response, [program]);
    if (url === '/base/api/services/101/programs') return writeJson(response, [program]);
    if (url === '/base/api/programs/201') return writeJson(response, program);
    if (url === '/base/api/services/101/logo') {
        response.writeHead(200, { 'Content-Type': 'image/png' });
        response.end(Buffer.from('synthetic-logo'));
        return;
    }
    if (url === '/base/api/redirect') {
        response.writeHead(302, { Location: '/api/status' });
        response.end();
        return;
    }
    if (url === '/base/api/programs/201/stream?decode=1' || url === '/base/api/services/101/stream?decode=1') {
        response.writeHead(200, { 'Content-Type': 'video/MP2T' });
        response.write(Buffer.from('synthetic-ts'));
        return;
    }
    writeJson(response, { failure: 'synthetic' }, 404);
};

const matrixHandler =
    (state: MatrixState): RouteHandler =>
    (request, response) => {
        const url = matrixUrl(request);
        if (state.failure === 'abort' && url === '/base/api/tuners') return;
        if (state.failure === 'status' && url === '/base/api/tuners') {
            response.writeHead(503, { 'Content-Type': 'text/plain' });
            response.end('SYNTHETIC_FAILURE_BODY_MUST_NOT_LEAK');
            return;
        }
        if (state.failure === 'parse' && url === '/base/api/services') {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end('{SYNTHETIC_FAILURE_BODY_MUST_NOT_LEAK');
            return;
        }
        if (state.failure === 'hang' && url === '/base/api/programs') return;
        if (url === '/base/api/config/server') {
            if (state.product === 'mirakurun') writeJson(response, {});
            else {
                response.writeHead(404);
                response.end();
            }
            return;
        }
        if (url === '/base/api/events/stream') {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.write(JSON.stringify({ resource: 'program', type: 'update', data: program, time: 2_000 }));
            return;
        }
        if (url === '/events') {
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            response.write('event:onair.program-changed\ndata:{"serviceId":101}\n\n');
            return;
        }
        commonHandler(request, response);
    };

const exerciseCommonOperations = async (server: SyntheticTunerServer, target: string): Promise<void> => {
    const access = new TunerServerAccessModel(target, 'epgstation/synthetic', undefined, {
        tunerRestRequestTimeoutMs: connectionDeadlineMs,
        tunerStreamEstablishmentTimeoutMs: connectionDeadlineMs,
    });
    const transport = new TunerHttpTransport(parseConnectionTarget(target), 'epgstation/synthetic');

    await expect(access.getStatus()).resolves.toEqual({
        available: true,
        version: { current: '3.8.0', latest: '3.8.0' },
    });
    await expect(access.getTuners()).resolves.toEqual([tuner]);
    await expect(access.getServices()).resolves.toEqual([service]);
    await expect(access.getPrograms()).resolves.toEqual([program]);
    await expect(access.getProgramsByService(101)).resolves.toEqual([program]);
    await expect(access.getProgram(201)).resolves.toEqual(program);
    await expect(access.getLogo(101)).resolves.toEqual(Buffer.from('synthetic-logo'));
    await expect(
        transport.getJson('/api/redirect', { signal: AbortSignal.timeout(connectionDeadlineMs) }),
    ).resolves.toEqual({
        available: true,
    });

    const recording = await access.openProgramStream({ programId: 201, priority: 7 });
    const live = await access.openServiceStream({ serviceId: 101, priority: 11 });
    expect(recording.stream.read()).toEqual(Buffer.from('synthetic-ts'));
    expect(live.stream.read()).toEqual(Buffer.from('synthetic-ts'));
    recording.close();
    recording.close();
    live.close();
    live.close();

    expect(server.requests.every(entry => entry.method === 'GET')).toBe(true);
    expect(
        server.requests
            .filter(entry => entry.url?.includes('/stream'))
            .map(entry => entry.headers['x-mirakurun-priority']),
    ).toEqual(['7', '11']);
    await vi.waitFor(() => expect(server.activeSocketCount()).toBe(0));
};

const exerciseChangeOperations = async (
    server: SyntheticTunerServer,
    target: string,
    state: MatrixState,
): Promise<void> => {
    const transport = new TunerHttpTransport(parseConnectionTarget(target), 'epgstation/synthetic');
    const observer = { aborted: vi.fn(), changed: vi.fn(), started: vi.fn() };
    const mirakurun = new MirakurunChangeAdapter((options: any) => transport.getStream('/api/events/stream', options));
    const mirakurunHandle = await mirakurun.open(observer, { signal: AbortSignal.timeout(connectionDeadlineMs) });
    await vi.waitFor(() =>
        expect(observer.changed).toHaveBeenCalledWith({
            kind: 'program',
            operation: 'update',
            program,
            time: 2_000,
        }),
    );
    mirakurunHandle.close();
    await expect(mirakurunHandle.completion).resolves.toBeUndefined();

    state.product = 'mirakc';
    const detector = new ProductDetector((options: any) => transport.probeJson('/api/config/server', options));
    await expect(detector.detect({ signal: AbortSignal.timeout(connectionDeadlineMs) })).resolves.toBe('mirakc');
    const mirakc = new MirakcChangeAdapter((options: any) => transport.getRootStream('/events', options));
    const mirakcHandle = await mirakc.open(observer, { signal: AbortSignal.timeout(connectionDeadlineMs) });
    await vi.waitFor(() => expect(observer.changed).toHaveBeenCalledWith({ kind: 'on-air-service', serviceId: 101 }));
    mirakcHandle.close();
    await expect(mirakcHandle.completion).resolves.toBeUndefined();

    expect(observer.started).toHaveBeenCalledTimes(2);
    expect(observer.aborted).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(server.activeSocketCount()).toBe(0));
};

const exerciseFailureOperations = async (
    server: SyntheticTunerServer,
    target: string,
    state: MatrixState,
): Promise<void> => {
    const secretBody = 'SYNTHETIC_FAILURE_BODY_MUST_NOT_LEAK';
    state.failure = 'abort';
    const abortAccess = new TunerServerAccessModel(target, 'epgstation/synthetic');
    const controller = new AbortController();
    const previousRequestCount = server.requests.length;
    const pending = abortAccess.getTuners({ signal: controller.signal }).catch((error: Error) => error);
    await vi.waitFor(() => expect(server.requests).toHaveLength(previousRequestCount + 1));
    controller.abort();
    const aborted = await pending;
    await vi.waitFor(() => expect(server.activeSocketCount()).toBe(0));
    const access = new TunerServerAccessModel(target, 'epgstation/synthetic', undefined, {
        tunerRestRequestTimeoutMs: 20,
    });
    state.failure = 'status';
    const status = await access.getTuners().catch((error: Error) => error);
    state.failure = 'parse';
    const parse = await access.getServices().catch((error: Error) => error);
    state.failure = 'hang';
    const timeout = await access.getPrograms().catch((error: Error) => error);
    state.failure = undefined;

    expect([aborted.message, status.message, parse.message, timeout.message]).toEqual([
        'Tuner request cancelled',
        'Tuner request failed with status 503',
        'Invalid tuner JSON response',
        'Tuner request timeout after 20ms',
    ]);
    for (const error of [aborted, status, parse, timeout]) {
        expect(error.message).not.toContain(secretBody);
        expect(error.message).not.toContain(target);
    }
    await vi.waitFor(() => expect(server.activeSocketCount()).toBe(0));
};

describe.each(['http', 'unix'] as const)('tuner %s transport integration', transportKind => {
    it('[TA-7.1] connects every common REST, redirect, logo, recording, and live route', async () => {
        const state: MatrixState = { product: 'mirakurun' };
        const [server, target] = await startServer(transportKind, matrixHandler(state));

        await exerciseCommonOperations(server, target);
    });

    it('[TA-7.1] carries Mirakurun events and mirakc SSE through the actual transport and releases them', async () => {
        const state: MatrixState = { product: 'mirakurun' };
        const [server, target] = await startServer(transportKind, matrixHandler(state));

        await exerciseChangeOperations(server, target, state);
    });

    it('[TA-7.1] cleans caller abort, timeout, HTTP status, and JSON parse failures', async () => {
        const state: MatrixState = { product: 'mirakurun' };
        const [server, target] = await startServer(transportKind, matrixHandler(state));

        await exerciseFailureOperations(server, target, state);
    });

    it('[TA-7.1] returns a sanitized network failure after the synthetic endpoint is closed', async () => {
        const [server, target] = await startServer(transportKind, commonHandler);
        await server.close();
        servers.delete(server);
        const access = new TunerServerAccessModel(target, 'epgstation/synthetic');

        const error = await access.getProgram(201).catch((failure: Error) => failure);

        expect(error.message).toBe('Tuner request failed');
        expect(error.message).not.toContain(target);
    });
});

// The Windows named-pipe connection integration for this transport lives in the platform boundary
// file test/server/tuner-access/transport.win32.integration.test.ts, selected only for the `win32`
// platform class by scripts/server-test/platform-boundary/selector.mjs before Vitest collects
// tests. It is not duplicated or skipped here.

describe('tuner connection target parser integration', () => {
    it('[TA-2.1-POSIX] resolves the Unix socket base path through the real Node.js POSIX path module', () => {
        const target = parseConnectionTarget(
            ['http+unix:', '', encodeURIComponent('/tmp/synthetic.sock'), 'nested', '..', 'api'].join('/'),
        );

        expect(target).toEqual({ kind: 'unix', socketPath: '/tmp/synthetic.sock', basePath: '/api' });
    });
});

it('[TA-8.3] executes transport-owned release and maps each Design N/A boundary to its runtime seam', async () => {
    const state: MatrixState = { product: 'mirakurun' };
    const [server, target] = await startServer('unix', matrixHandler(state));

    await exerciseCommonOperations(server, target);
    await exerciseChangeOperations(server, target, state);
    await exerciseFailureOperations(server, target, state);
    await vi.waitFor(() => expect(server.activeSocketCount()).toBe(0));
});
