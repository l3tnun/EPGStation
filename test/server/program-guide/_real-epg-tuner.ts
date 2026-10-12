import 'reflect-metadata';

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { vi } from 'vitest';

import {
    createRepositoryPersistence,
    loadCompiledDefault,
    type RepositoryPersistence,
} from '../persistence/repository-harness';
import { createDeferred } from '../harness/async';

/*
 * 番組情報の更新の結合 test が共有する、本物の部品の配線。tuner server は loopback の実 HTTP server
 * （`EpgTunerServer`。REST の応答と変更通知の feed を出す）で、`TunerHttpTransport`・`TunerServerAccessModel`・
 * `EPGUpdateManageModel`・`EPGUpdater` は本物、DB は実 SQLite の `ChannelDB`・`ProgramDB`。
 * DB の書き込みを遅らせたいときは、本物の `ProgramDB` の前に「門」（呼び出しを待たせるだけで、中身は本物の書き込み）を置く。
 */

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');
const compiled = <T>(...segments: string[]): T => require(join(snapshot, ...segments)) as T as T;
const { parseConnectionTarget } = compiled<{ parseConnectionTarget(source: string): unknown }>(
    'model',
    'tuner',
    'transport',
    'ConnectionTargetParser.js',
);
const TunerHttpTransport = loadCompiledDefault<any>('model/tuner/transport/TunerHttpTransport.js') as unknown as new (
    ...args: any[]
) => any;
const TunerServerAccessModel = loadCompiledDefault<any>('model/tuner/TunerServerAccessModel.js') as unknown as new (
    ...args: any[]
) => any;
const ProductDetector = loadCompiledDefault<any>('model/tuner/change/ProductDetector.js') as unknown as new (
    ...args: any[]
) => any;
const MirakurunChangeAdapter = loadCompiledDefault<any>(
    'model/tuner/change/MirakurunChangeAdapter.js',
) as unknown as new (...args: any[]) => any;
const MirakcChangeAdapter = loadCompiledDefault<any>('model/tuner/change/MirakcChangeAdapter.js') as unknown as new (
    ...args: any[]
) => any;
const EPGUpdateManageModel = loadCompiledDefault<any>('model/epgUpdater/EPGUpdateManageModel.js') as unknown as new (
    ...args: any[]
) => any;
const EPGUpdater = loadCompiledDefault<any>('model/epgUpdater/EPGUpdater.js') as unknown as new (...args: any[]) => any;

const realSetTimeout = setTimeout;
const realNow = Date.now.bind(Date);

/** 実時間で条件が成り立つのを待つ（fake timer を入れている間も使える）。 */
export const until = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> => {
    const deadline = realNow() + timeoutMs;
    for (;;) {
        if (await predicate()) return;
        if (realNow() > deadline) throw new Error('until: the condition did not become true in time');
        await new Promise<void>(resolve => realSetTimeout(resolve, 10));
    }
};

export type Product = 'mirakurun' | 'mirakc';

export interface RecordedRequest {
    readonly method: string;
    readonly url: string;
}

/** tuner server の代わりの loopback の HTTP server。応答の保留・失敗と、変更通知の feed を test が扱う。 */
export class EpgTunerServer {
    public readonly requests: RecordedRequest[] = [];
    /** 応答を終える前に客側が切った request の url。 */
    public readonly abandoned: string[] = [];
    public services: Array<Record<string, unknown>> = [];
    public programs: Array<Record<string, unknown>> = [];
    public readonly programsByService = new Map<number, Array<Record<string, unknown>>>();
    public readonly failures = new Map<string, number>();
    private readonly gates = new Map<string, ReturnType<typeof createDeferred<void>>>();
    private readonly feedWaiters: Array<(response: ServerResponse) => void> = [];
    private readonly feeds: ServerResponse[] = [];
    private readonly server: Server;
    private readonly sockets = new Set<Socket>();
    private target = '';

    constructor(public readonly product: Product) {
        this.server = createServer((request, response) => void this.handle(request, response));
        this.server.on('connection', socket => {
            this.sockets.add(socket);
            socket.once('close', () => this.sockets.delete(socket));
        });
    }

    public count(url: string): number {
        return this.requests.filter(request => request.url === url).length;
    }

    /** `url` の応答を、`release()` が呼ばれるまで保留する。 */
    public hold(url: string): () => void {
        const gate = createDeferred<void>();
        this.gates.set(url, gate);
        return () => {
            this.gates.delete(url);
            gate.resolve();
        };
    }

    public async listen(): Promise<string> {
        await new Promise<void>((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(0, '127.0.0.1', () => resolve());
        });
        const address = this.server.address();
        if (address === null || typeof address === 'string') throw new Error('synthetic tuner address is unavailable');
        this.target = ['http:', '', `127.0.0.1:${address.port}`].join('/');
        return this.target;
    }

    /** 変更通知の feed の応答（接続されるまで待つ）。 */
    public feed(): Promise<ServerResponse> {
        const first = this.feeds[0];
        if (first !== undefined) return Promise.resolve(first);
        return new Promise(resolve => this.feedWaiters.push(resolve));
    }

    public async close(): Promise<void> {
        for (const socket of this.sockets) socket.destroy();
        await new Promise<void>(resolve => this.server.close(() => resolve()));
    }

    private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const url = request.url ?? '';
        this.requests.push({ method: request.method ?? '', url });
        request.once('close', () => {
            if (!response.writableEnded && !this.feeds.includes(response)) this.abandoned.push(url);
        });
        const feedPath = this.product === 'mirakurun' ? '/api/events/stream' : '/events';
        if (url === '/api/config/server') {
            response.writeHead(this.product === 'mirakurun' ? 200 : 404, { 'Content-Type': 'application/json' });
            response.end(this.product === 'mirakurun' ? '{}' : '{"message":"not found"}');
            return;
        }
        if (url === feedPath) {
            response.writeHead(200, {
                'Content-Type': this.product === 'mirakurun' ? 'application/json' : 'text/event-stream',
            });
            response.flushHeaders();
            this.feeds.push(response);
            for (const waiter of this.feedWaiters.splice(0)) waiter(response);
            return;
        }
        const gate = this.gates.get(url);
        if (gate !== undefined) await gate.promise;
        if (response.destroyed) return;
        const status = this.failures.get(url);
        if (status !== undefined) {
            response.writeHead(status, { 'Content-Type': 'application/json' });
            response.end('{"message":"synthetic failure"}');
            return;
        }
        const body = this.body(url);
        response.writeHead(body === undefined ? 404 : 200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(body ?? {}));
    }

    private body(url: string): unknown {
        if (url === '/api/services') return this.services;
        if (url === '/api/programs') return this.programs;
        const service = /^\/api\/services\/(\d+)\/programs$/u.exec(url);
        if (service !== null) return this.programsByService.get(Number(service[1])) ?? [];
        return undefined;
    }
}

/** feed へ、全体を 1 回で・1 byte ずつ・指定の大きさに分けて書く。 */
export const writeFeed = async (
    response: ServerResponse,
    text: string,
    mode: 'whole' | 'byte' = 'whole',
): Promise<void> => {
    response.socket?.setNoDelay(true);
    const bytes = Buffer.from(text, 'utf8');
    const pieces = mode === 'whole' ? [bytes] : Array.from(bytes, (_, index) => bytes.subarray(index, index + 1));
    for (const piece of pieces) {
        await new Promise<void>((resolve, reject) =>
            response.write(piece, error => (error === null || error === undefined ? resolve() : reject(error))),
        );
    }
};

export const rawServiceOf = (id: number, serviceId: number) => ({
    id,
    serviceId,
    networkId: 10,
    name: `synthetic-service-${id}`,
    type: 1,
    hasLogoData: false,
    remoteControlKeyId: serviceId % 100,
    channel: { type: 'GR', channel: `synthetic-${id}` },
});

export const rawProgramOf = (id: number, serviceId: number, startAt: number, name = `synthetic-program-${id}`) => ({
    id,
    eventId: id,
    serviceId,
    networkId: 10,
    startAt,
    // 長い番組にして、時計を進める間に古い番組の削除（周期処理の一部）に消されないようにする
    duration: 3_600_000,
    isFree: true,
    name,
});

export const mirakurunFrame = (type: 'create' | 'update', program: Record<string, unknown>, time: number): string =>
    JSON.stringify({ resource: 'program', type, data: program, time });

export const mirakcEvent = (event: 'onair.program-changed' | 'epg.programs-updated', serviceId: number): string =>
    `event: ${event}\ndata: {"serviceId":${serviceId}}\n\n`;

export interface Gate {
    /** 呼び出しの引数（呼ばれた順）。 */
    readonly args: unknown[][];
    calls: number;
    inflight: number;
    peak: number;
    /** 次の呼び出しから、`release()` まで書き込みを始めさせない。 */
    hold(): () => void;
}

const makeGate = (): Gate & { wait(): Promise<void> } => {
    let current: ReturnType<typeof createDeferred<void>> | undefined;
    return {
        args: [],
        calls: 0,
        inflight: 0,
        peak: 0,
        hold() {
            const gate = createDeferred<void>();
            current = gate;
            return () => {
                if (current === gate) current = undefined;
                gate.resolve();
            };
        },
        wait: () => current?.promise ?? Promise.resolve(),
    };
};

export interface EpgFixture {
    readonly persistence: RepositoryPersistence;
    readonly server: EpgTunerServer;
    readonly manager: any;
    readonly updater: any;
    readonly logger: {
        system: { debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };
    };
    readonly gates: { insert: Gate; update: Gate };
    readonly sent: unknown[];
    programRows(): Promise<Array<{ id: number; name: string; channelId: number }>>;
    close(): Promise<void>;
}

/** 本物の部品を production の配線（`ModelContainerSetter`）と同じ形でつなぐ。時計は呼び出し側が差し込む。 */
export const createEpgFixture = async (
    product: Product,
    options: { readonly now?: () => number } = {},
): Promise<EpgFixture> => {
    const persistence = await createRepositoryPersistence('sqlite');
    const server = new EpgTunerServer(product);
    const target = await server.listen();
    const transport = new TunerHttpTransport(parseConnectionTarget(target), 'epgstation/synthetic');
    const detector = new ProductDetector((requestOptions: unknown) =>
        transport.probeJson('/api/config/server', requestOptions),
    );
    const mirakurun = new MirakurunChangeAdapter((requestOptions: unknown) =>
        transport.getStream('/api/events/stream', requestOptions),
    );
    const mirakc = new MirakcChangeAdapter(
        (requestOptions: unknown) => transport.getRootStream('/events', requestOptions),
        options.now,
    );
    const tuner = new TunerServerAccessModel(target, 'epgstation/synthetic', transport, {
        changeFeed: { detector, mirakurun, mirakc },
    });
    const insertGate = makeGate();
    const updateGate = makeGate();
    const gated =
        (gate: ReturnType<typeof makeGate>, run: (...args: any[]) => Promise<unknown>) =>
        async (...args: any[]) => {
            gate.calls += 1;
            gate.args.push(args);
            gate.inflight += 1;
            gate.peak = Math.max(gate.peak, gate.inflight);
            try {
                await gate.wait();
                return await run(...args);
            } finally {
                gate.inflight -= 1;
            }
        };
    const programDB = {
        deleteOld: (...args: any[]) => persistence.db.ProgramDB.deleteOld(...args),
        insert: gated(insertGate, (...args) => persistence.db.ProgramDB.insert(...args)),
        update: gated(updateGate, (...args) => persistence.db.ProgramDB.update(...args)),
    };
    const logger = { system: { debug: vi.fn(), error: vi.fn(), info: vi.fn() } };
    const manager = new EPGUpdateManageModel(
        { getLogger: () => logger },
        { getConfig: () => ({}) },
        tuner,
        persistence.db.ChannelDB,
        programDB,
    );
    const updater = new EPGUpdater(
        { getLogger: () => logger },
        { getConfig: () => ({ epgUpdateIntervalTime: 1 }) },
        manager,
    );
    const sent: unknown[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(process, 'send');
    Object.defineProperty(process, 'send', {
        configurable: true,
        value: vi.fn((message: unknown) => {
            sent.push(message);
            return true;
        }),
        writable: true,
    });
    return {
        persistence,
        server,
        manager,
        updater,
        logger,
        gates: { insert: insertGate, update: updateGate },
        sent,
        programRows: async () =>
            (
                (await persistence.source.getRepository(persistence.entities.Program as any).find()) as Array<{
                    id: number;
                    name: string;
                    channelId: number;
                }>
            )
                .map(({ id, name, channelId }) => ({ id, name, channelId }))
                .sort((left, right) => left.id - right.id),
        close: async () => {
            if (descriptor === undefined) delete (process as { send?: unknown }).send;
            else Object.defineProperty(process, 'send', descriptor);
            await server.close();
            await persistence.cleanup();
        },
    };
};
