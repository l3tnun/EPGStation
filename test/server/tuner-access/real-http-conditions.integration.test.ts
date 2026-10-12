import 'reflect-metadata';

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { connect as netConnect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Container } from 'inversify';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import compatibility from '../fixtures/tuner-access/compatibility.json';

/*
 * チューナーサーバー連携を、実 HTTP で応答する tuner server の代わり（Mirakurun・mirakc それぞれの応答を返す loopback の
 * server）と、本物の `TunerServerAccessModel`・`TunerHttpTransport`・変更通知の adapter・`ConnectionCheckModel` の上で確かめる。
 * server が受け取った request の時刻・件数・header を実測で見る。時計は実時計。
 */

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const load = (...segments: string[]): any => (require(join(compiledSnapshot, ...segments)) as { default: any }).default;
const TunerServerAccessModel = load('model', 'tuner', 'TunerServerAccessModel.js');
const TunerHttpTransport = load('model', 'tuner', 'transport', 'TunerHttpTransport.js');
const MirakurunChangeAdapter = load('model', 'tuner', 'change', 'MirakurunChangeAdapter.js');
const MirakcChangeAdapter = load('model', 'tuner', 'change', 'MirakcChangeAdapter.js');
const ProductDetector = load('model', 'tuner', 'change', 'ProductDetector.js');
const ConnectionCheckModel = load('model', 'ConnectionCheckModel.js');
const { parseConnectionTarget } = require(
    join(compiledSnapshot, 'model', 'tuner', 'transport', 'ConnectionTargetParser.js'),
) as any;

interface ReceivedRequest {
    readonly at: number;
    readonly headers: IncomingMessage['headers'];
    readonly url: string;
}
type Handler = (request: IncomingMessage, response: ServerResponse, server: RealHttpServer) => void;

/** loopback の実 HTTP server。受け取った request を記録し、`handler` が応答する。 */
class RealHttpServer {
    public readonly requests: ReceivedRequest[] = [];
    public readonly responses: ServerResponse[] = [];
    /** 変更通知の stream の応答（handler が設定する）。 */
    public feed: ServerResponse | undefined;
    private readonly server: Server;
    private readonly sockets = new Set<Socket>();

    constructor(public handler: Handler) {
        this.server = createServer((request, response) => {
            this.requests.push({ at: Date.now(), headers: request.headers, url: request.url ?? '' });
            this.responses.push(response);
            this.handler(request, response, this);
        });
        this.server.on('connection', socket => {
            this.sockets.add(socket);
            socket.once('close', () => this.sockets.delete(socket));
        });
    }

    public async listen(port = 0): Promise<string> {
        await new Promise<void>((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(port, '127.0.0.1', () => resolve());
        });
        const address = this.server.address();
        if (address === null || typeof address === 'string') throw new Error('address is unavailable');
        this.port = address.port;
        return ['http:', '', `127.0.0.1:${address.port}`].join('/');
    }

    public port = 0;

    public count(prefix: string): number {
        return this.requests.filter(request => request.url.startsWith(prefix)).length;
    }

    public async close(): Promise<void> {
        for (const socket of this.sockets) socket.destroy();
        await new Promise<void>(resolve => this.server.close(() => resolve()));
    }
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
    vi.doUnmock('node:fs');
    vi.doUnmock('fs');
    while (cleanups.length > 0) await cleanups.pop()!();
});
const start = async (handler: Handler): Promise<[RealHttpServer, string]> => {
    const server = new RealHttpServer(handler);
    const target = await server.listen();
    cleanups.push(() => server.close());
    return [server, target];
};

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const json = (response: ServerResponse, value: unknown, status = 200): void => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
};

type Product = 'mirakurun' | 'mirakc';

/** 製品ごとの応答を返す tuner server。`version` は `/api/version`、`extra` は未知の追加 field。 */
const productHandler =
    (options: { product: Product; version: string; extra?: boolean; series?: Record<string, unknown> }): Handler =>
    (request, response) => {
        const url = request.url ?? '';
        const extra = (name: string): Record<string, unknown> => (options.extra ? { [name]: { ignored: true } } : {});
        const program = {
            ...compatibility.program,
            ...extra('futureProgramField'),
            ...(options.series === undefined ? {} : { series: options.series }),
        };
        if (url === '/api/status') return json(response, { available: true, ...extra('futureStatusField') });
        if (url === '/api/version') {
            return json(response, {
                current: options.version,
                latest: options.version,
                ...extra('futureVersionField'),
            });
        }
        if (url === '/api/tuners') return json(response, [{ ...compatibility.tuner, ...extra('futureTunerField') }]);
        if (url === '/api/services')
            return json(response, [{ ...compatibility.service, ...extra('futureServiceField') }]);
        if (url === '/api/programs') return json(response, [program]);
        if (url === '/api/services/101/programs') return json(response, [program]);
        if (url === '/api/programs/201') return json(response, program);
        if (url === '/api/services/101/logo') {
            response.writeHead(200, { 'Content-Type': 'image/png' });
            response.end(Buffer.from('synthetic-logo'));
            return;
        }
        if (url === '/api/config/server') {
            if (options.product === 'mirakurun') return json(response, { version: options.version });
            response.writeHead(404);
            response.end();
            return;
        }
        if (/^\/api\/(programs|services)\/\d+\/stream\?decode=1$/u.test(url)) {
            response.writeHead(200, { 'Content-Type': 'video/MP2T' });
            response.write(Buffer.from('synthetic-ts'));
            return;
        }
        if (url === '/api/events/stream' && options.product === 'mirakurun') {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.write(JSON.stringify({ resource: 'program', type: 'update', data: program, time: 2_000 }));
            return;
        }
        if (url === '/events' && options.product === 'mirakc') {
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            response.write('event:onair.program-changed\ndata:{"serviceId":101}\n\n');
            return;
        }
        json(response, {}, 404);
    };

/** 本番の配線（`ModelContainerSetter`）と同じ組み立てで、製品判定と変更通知の adapter を持つ連携機能を作る。 */
const createAccess = (target: string, settings: Record<string, unknown> = {}) => {
    const userAgent = 'EPGStation/synthetic';
    const transport = new TunerHttpTransport(parseConnectionTarget(target), userAgent);
    const detector = new ProductDetector((options: any) => transport.probeJson('/api/config/server', options));
    const mirakurun = new MirakurunChangeAdapter((options: any) => transport.getStream('/api/events/stream', options));
    const mirakc = new MirakcChangeAdapter((options: any) => transport.getRootStream('/events', options));
    return new TunerServerAccessModel(target, userAgent, transport, {
        changeFeed: { detector, mirakurun, mirakc },
        ...settings,
    });
};

const exerciseEverything = async (access: any, product: Product): Promise<unknown[]> => {
    const results: unknown[] = [];
    results.push(await access.getStatus());
    results.push(await access.getTuners());
    results.push(await access.getServices());
    results.push(await access.getPrograms());
    results.push(await access.getProgramsByService(101));
    results.push(await access.getProgram(201));
    results.push(await access.getLogo(101));
    const programStream = await access.openProgramStream({ programId: 201, priority: 7 });
    const serviceStream = await access.openServiceStream({ serviceId: 101, priority: 11 });
    programStream.close();
    serviceStream.close();
    const observer = { aborted: vi.fn(), changed: vi.fn(), started: vi.fn() };
    const feed = await access.openChangeFeed(observer);
    await vi.waitFor(() => expect(observer.changed).toHaveBeenCalledOnce());
    results.push(observer.changed.mock.calls[0][0]);
    feed.close();
    await feed.completion;
    expect(product === 'mirakurun' ? 'program' : 'on-air-service').toBe(
        (observer.changed.mock.calls[0][0] as { kind: string }).kind,
    );
    return results;
};

describe('a tuner server of the minimum or a future version reached over real HTTP', () => {
    const versions: Array<{ label: string; product: Product; version: string; extra: boolean }> = [
        ...compatibility.fixtures.map(fixture => ({
            extra: fixture.futureFields,
            label: fixture.label,
            product: fixture.product as Product,
            version: fixture.version,
        })),
        { extra: true, label: 'Mirakurun 99.0.0', product: 'mirakurun', version: '99.0.0' },
        { extra: true, label: 'mirakc 99.0.0', product: 'mirakc', version: '99.0.0' },
    ];

    it.each(versions)(
        '[TA-REAL-HTTP-VERSION] reads the status, the version, the guide, the logo, the streams, and the changes of $label without refusing the version or the unknown fields',
        async ({ extra, product, version }) => {
            const [server, target] = await start(productHandler({ extra, product, version }));
            const access = createAccess(target);

            const results = await exerciseEverything(access, product);

            expect(results[0]).toEqual({ available: true, version: { current: version, latest: version } });
            expect(results[1]).toEqual([compatibility.tuner]);
            expect(results[2]).toEqual([compatibility.service]);
            expect(results[3]).toEqual([compatibility.expectedProgram]);
            expect(results[5]).toEqual(compatibility.expectedProgram);
            expect(results[6]).toEqual(Buffer.from('synthetic-logo'));
            expect(server.count('/api/status')).toBe(1);
        },
    );

    it('[TA-REAL-HTTP-STARTUP-CHECK] passes the startup availability check against a real Mirakurun 3.8.0 status', async () => {
        const [server, target] = await start(productHandler({ product: 'mirakurun', version: '3.8.0' }));
        const check = new ConnectionCheckModel(
            { getLogger: () => ({ system: { info: vi.fn() } }) },
            createAccess(target),
            { checkConnection: vi.fn() },
        );

        await check.checkMirakurun();

        expect(server.requests.map(request => request.url)).toEqual(['/api/status']);
    });
});

describe('the User-Agent of every request that reaches a tuner server, through the production wiring', () => {
    it('[TA-REAL-HTTP-USER-AGENT] starts the User-Agent of REST, logo, recording, live, and change requests of both products with EPGStation/ and the package version', async () => {
        const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
        const manifestPath = join(compiledSnapshot, '..', 'package.json');
        const manifest = JSON.parse(actualFs.readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
            version: string;
        };
        const mockedReadFileSync = (path: unknown, options?: unknown) =>
            path === manifestPath
                ? JSON.stringify({ name: 'epgstation', version: manifest.version })
                : (actualFs.readFileSync as any)(path, options);
        vi.doMock('node:fs', () => ({ ...actualFs, readFileSync: mockedReadFileSync }));
        vi.doMock('fs', () => ({ ...actualFs, readFileSync: mockedReadFileSync }));
        vi.resetModules();
        const containerSetter = (await import(join(compiledSnapshot, 'model', 'ModelContainerSetter.js'))) as {
            set: (container: Container) => void;
        };

        for (const product of ['mirakurun', 'mirakc'] as const) {
            const [server, target] = await start(productHandler({ product, version: '3.8.0' }));
            const container = new Container();
            containerSetter.set(container);
            container.rebind('IConfiguration').toConstantValue({
                getConfig: () => ({
                    mirakurunPath: target,
                    tunerRestRequestTimeoutMs: 5_000,
                    tunerStreamEstablishmentTimeoutMs: 5_000,
                }),
            });
            const access = container.get<any>('TunerServerAccess');

            await exerciseEverything(access, product);

            expect(server.requests.length).toBeGreaterThanOrEqual(12);
            const userAgents = new Set(server.requests.map(request => request.headers['user-agent']));
            expect([...userAgents]).toEqual([`EPGStation/${manifest.version}`]);
            expect(
                server.requests
                    .map(request => request.headers['user-agent'])
                    .every(value => /^EPGStation\//u.test(String(value))),
            ).toBe(true);
        }
    }, 30_000);
});

describe('what the tuner access exposes and keeps', () => {
    it('[TA-REAL-HTTP-NO-PRODUCT-FIELD] returns the series expiry as one field from both products and never exposes the mirakc-only spelling', async () => {
        const series = { episode: 1, id: 1, lastEpisode: 2, name: 'synthetic', pattern: 3, repeat: 4 };
        const results: string[] = [];
        for (const [product, spelling] of [
            ['mirakurun', 'expiresAt'],
            ['mirakc', 'expireAt'],
        ] as const) {
            const [, target] = await start(
                productHandler({ product, version: '3.8.0', series: { ...series, [spelling]: 8 } }),
            );
            const access = createAccess(target);
            const programs = await access.getPrograms();
            const byService = await access.getProgramsByService(101);
            const one = await access.getProgram(201);
            const observer = { aborted: vi.fn(), changed: vi.fn(), started: vi.fn() };
            const feed = await access.openChangeFeed(observer);
            if (product === 'mirakurun') await vi.waitFor(() => expect(observer.changed).toHaveBeenCalled());
            feed.close();
            await feed.completion;

            expect(programs[0].series).toMatchObject({ expiresAt: 8 });
            expect(programs[0].series).not.toHaveProperty('expireAt');
            results.push(JSON.stringify([programs, byService, one, observer.changed.mock.calls]));
        }
        expect(results.join('\n')).not.toContain('expireAt');
    });

    it('[TA-REAL-HTTP-NO-PERSISTENCE] writes no row to a real database and no file while the tuner access serves the guide, the streams, and the changes', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-tuner-access-'));
        cleanups.push(() => rm(root, { force: true, recursive: true }));
        const source = new DataSource({
            type: 'better-sqlite3',
            database: join(root, 'guide.db'),
            entities: [join(compiledSnapshot, 'db', 'entities', '*.js')],
            logging: false,
            synchronize: true,
        });
        await source.initialize();
        cleanups.push(() => source.destroy());
        const rowCounts = async (): Promise<Record<string, number>> => {
            const counts: Record<string, number> = {};
            for (const metadata of source.entityMetadatas) {
                counts[metadata.tableName] = await source.getRepository(metadata.target).count();
            }
            return counts;
        };
        const filesBefore = (await readdir(root)).sort();
        const sizeBefore = (await readFile(join(root, 'guide.db'))).length;
        const countsBefore = await rowCounts();
        expect(Object.keys(countsBefore).length).toBeGreaterThan(5);

        const [, target] = await start(productHandler({ product: 'mirakurun', version: '3.8.0' }));
        const access = createAccess(target);
        await exerciseEverything(access, 'mirakurun');
        await exerciseEverything(access, 'mirakurun');

        expect(await rowCounts()).toEqual(countsBefore);
        expect((await readdir(root)).sort()).toEqual(filesBefore);
        expect((await readFile(join(root, 'guide.db'))).length).toBe(sizeBefore);
    });
});

describe('the change feed of the tuner access over real HTTP', () => {
    const mirakurunProgramEvent = JSON.stringify({
        resource: 'program',
        type: 'update',
        data: compatibility.program,
        time: 2_000,
    });
    const mirakcEvent = 'event:onair.program-changed\ndata:{"serviceId":101}\n\n';

    const changeHandler =
        (product: Product, onFeed: (response: ServerResponse, server: RealHttpServer) => void): Handler =>
        (request, response, server) => {
            const url = request.url ?? '';
            if (url === '/api/config/server') {
                if (product === 'mirakurun') return json(response, { version: '3.8.0' });
                response.writeHead(404);
                response.end();
                return;
            }
            if (url === '/api/events/stream' || url === '/events') {
                response.writeHead(200, {
                    'Content-Type': product === 'mirakc' ? 'text/event-stream' : 'application/json',
                });
                onFeed(response, server);
                return;
            }
            json(response, {}, 404);
        };

    it('[TA-REAL-HTTP-FEED-CLOSE] neither reconnects nor does anything of its own after the real mirakc event stream is closed', async () => {
        const [server, target] = await start(
            changeHandler('mirakc', response => {
                response.write(mirakcEvent);
                setTimeout(() => response.socket?.destroy(), 200);
            }),
        );
        const access = createAccess(target);
        const observer = { aborted: vi.fn(), changed: vi.fn(), started: vi.fn() };
        const feed = await access.openChangeFeed(observer);
        await expect(feed.completion).rejects.toBeInstanceOf(Error);

        await delay(3_500);
        expect(observer.changed).toHaveBeenCalledTimes(1);
        expect(observer.aborted).toHaveBeenCalledTimes(1);
        expect(server.count('/events')).toBe(1);
        expect(server.requests.map(request => request.url)).toEqual(['/api/config/server', '/events']);
    }, 30_000);

    it.each([
        ['mirakurun', mirakurunProgramEvent, { kind: 'program', operation: 'update', time: 2_000 }],
        ['mirakc', mirakcEvent, { kind: 'on-air-service', serviceId: 101 }],
    ] as const)(
        '[TA-REAL-HTTP-FEED-DUPLICATE] passes the same %s notification twice, in the order observed, without adding a sequence number',
        async (product, frame, expected) => {
            const [, target] = await start(
                changeHandler(product, response => {
                    response.write(frame);
                    response.write(frame);
                }),
            );
            const access = createAccess(target);
            const observer = { aborted: vi.fn(), changed: vi.fn(), started: vi.fn() };
            const feed = await access.openChangeFeed(observer);
            await vi.waitFor(() => expect(observer.changed).toHaveBeenCalledTimes(2));
            feed.close();
            await feed.completion;

            const [first, second] = observer.changed.mock.calls.map(([change]) => change);
            expect(second).toEqual(first);
            expect(first).toMatchObject(expected);
            expect(Object.keys(first).sort()).toEqual(
                Object.keys(expected)
                    .concat(product === 'mirakurun' ? ['program'] : [])
                    .sort(),
            );
        },
    );

    it('[TA-REAL-HTTP-FEED-OPEN] keeps the Mirakurun and mirakc change streams open past the thirty-second REST deadline and still receives the next notification', async () => {
        await Promise.all(
            (
                [
                    ['mirakurun', mirakurunProgramEvent],
                    ['mirakc', mirakcEvent],
                ] as const
            ).map(async ([product, frame]) => {
                const [server, target] = await start(
                    changeHandler(product, (response, current) => {
                        current.feed = response;
                        response.write(frame);
                    }),
                );
                const access = createAccess(target);
                const observer = { aborted: vi.fn(), changed: vi.fn(), started: vi.fn() };
                const openedAt = Date.now();
                const feed = await access.openChangeFeed(observer);
                await vi.waitFor(() => expect(observer.changed).toHaveBeenCalledTimes(1));

                await delay(31_500);
                expect(Date.now() - openedAt).toBeGreaterThan(31_000);
                expect(observer.aborted).not.toHaveBeenCalled();
                server.feed!.write(frame);
                await vi.waitFor(() => expect(observer.changed).toHaveBeenCalledTimes(2));
                feed.close();
                await expect(feed.completion).resolves.toBeUndefined();
            }),
        );
    }, 60_000);
});

describe('failures and the startup wait of the tuner access over real HTTP', () => {
    it('[TA-REAL-HTTP-NO-RETRY] sends exactly one request per failed call when the tuner server answers 503', async () => {
        const [server, target] = await start((_request, response) => json(response, {}, 503));
        const access = createAccess(target);

        for (const call of [
            () => access.getStatus(),
            () => access.getTuners(),
            () => access.getServices(),
            () => access.getPrograms(),
            () => access.getProgramsByService(101),
            () => access.getProgram(201),
            () => access.getLogo(101),
        ]) {
            await expect(call()).rejects.toThrow('Tuner request failed with status 503');
        }
        await delay(1_500);

        expect(server.requests.map(request => request.url)).toEqual([
            '/api/status',
            '/api/tuners',
            '/api/services',
            '/api/programs',
            '/api/services/101/programs',
            '/api/programs/201',
            '/api/services/101/logo',
        ]);
    }, 30_000);

    const createCheck = (target: string) =>
        new ConnectionCheckModel({ getLogger: () => ({ system: { info: vi.fn() } }) }, createAccess(target), {
            checkConnection: vi.fn(),
        });

    it('[TA-REAL-HTTP-STARTUP-RETRY] waits one second between availability checks, keeps trying past two failures, and releases the barrier only after the first success', async () => {
        const failures = 6;
        const [server, target] = await start((request, response, current) => {
            if (request.url === '/api/status' && current.count('/api/status') <= failures)
                return json(response, {}, 503);
            json(response, { available: true });
        });
        let released = false;
        const barrier = createCheck(target)
            .checkMirakurun()
            .then(() => {
                released = true;
            });

        await delay(3_000);
        expect(released).toBe(false);
        await barrier;

        const attempts = server.requests.map(request => request.at);
        expect(server.requests.every(request => request.url === '/api/status')).toBe(true);
        expect(attempts).toHaveLength(failures + 1);
        for (let index = 1; index < attempts.length; index++) {
            expect(attempts[index] - attempts[index - 1]).toBeGreaterThanOrEqual(990);
            expect(attempts[index] - attempts[index - 1]).toBeLessThan(3_000);
        }
    }, 30_000);

    it('[TA-REAL-HTTP-STARTUP-NO-REQUEST-LIMIT] keeps waiting for one availability response that arrives after more than the thirty-second REST deadline', async () => {
        const [server, target] = await start((_request, response) => {
            setTimeout(() => json(response, { available: true }), 31_500);
        });
        let released = false;
        const startedAt = Date.now();
        const barrier = createCheck(target)
            .checkMirakurun()
            .then(() => {
                released = true;
            });

        await delay(30_800);
        expect(released).toBe(false);
        await barrier;
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(31_400);
        expect(server.requests).toHaveLength(1);
    }, 60_000);

    it('[TA-REAL-HTTP-STARTUP-BARRIER] opens the dependent port only after the first successful availability check, and not while the tuner server does not answer', async () => {
        const [probe] = await start((_request, response) => json(response, {}));
        const port = probe.port;
        await probe.close();
        cleanups.pop();
        const [, target] = await start((request, response, current) => {
            if (current.count('/api/status') <= 2) return json(response, {}, 503);
            json(response, { available: true });
        });
        const web = new RealHttpServer((_request, response) => json(response, { web: true }));
        cleanups.push(() => web.close());
        const connect = (): Promise<'open' | 'refused'> =>
            new Promise(resolve => {
                const socket = netConnect(port, '127.0.0.1');
                socket.once('connect', () => {
                    socket.destroy();
                    resolve('open');
                });
                socket.once('error', () => resolve('refused'));
            });

        const startup = (async () => {
            await createCheck(target).checkMirakurun();
            await web.listen(port);
        })();

        await delay(1_200);
        expect(await connect()).toBe('refused');
        await startup;
        expect(await connect()).toBe('open');
    }, 30_000);
});
