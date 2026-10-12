import 'reflect-metadata';

import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DataSource } from 'typeorm';
import { expect, vi } from 'vitest';

import {
    load,
    logger as sharedLogger,
    makeReserve,
    RecordedDB,
    RecorderModel,
    RecordingEvent,
    RecordingManageModel,
    RecordingStreamCreator,
    RecordingUtilModel,
    Reserve,
    ReserveDB,
    VideoFileDB,
} from './_harness';
import { silentLoggerModel } from '../harness/silent-logger-model';

/*
 * 録画の結合 test が共有する、本物の部品の配線。tuner server は loopback の実 HTTP server
 * （`SyntheticTunerServer`）で、`TunerServerAccessModel`・`RecordingStreamCreator`・`RecorderModel`・
 * `RecordingManageModel` は本物、DB は呼び出し側が渡す実 DB、録画 file は実 file system に書く。
 */

export const TunerServerAccessModel = load<new (...args: any[]) => any>('model', 'tuner', 'TunerServerAccessModel.js');
export const ExecutionManagementModel = load<new (...args: any[]) => any>('model', 'ExecutionManagementModel.js');

export const CHUNK_SIZE = 1_880;
const retry = { run: <T>(operation: () => Promise<T>): Promise<T> => operation() };

export const chunk = (index: number): Buffer => {
    const bytes = Buffer.alloc(CHUNK_SIZE, index % 251);
    for (let offset = 0; offset < CHUNK_SIZE; offset += 188) bytes[offset] = 0x47;
    return bytes;
};

export const write = (
    target: { write(data: Buffer, callback: (error?: Error | null) => void): unknown },
    data: Buffer,
) => new Promise<void>((resolve, reject) => target.write(data, error => (error ? reject(error) : resolve())));

/** tuner server が 1 件の stream の要求に対して取る振る舞い。 */
export type StreamBehavior =
    /** 200 を返し、応答を開いたままにする（既定）。`headerDelayMs` だけ応答の送り出しを遅らせる。 */
    | { readonly kind: 'stream'; readonly headerDelayMs?: number }
    /** 指定の status で失敗させる。 */
    | { readonly kind: 'status'; readonly status: number; readonly delayMs?: number }
    /** 応答の header を送らずに接続を切る。 */
    | { readonly kind: 'drop' };

export interface ReceivedRequest {
    readonly at: number;
    readonly headers: IncomingHttpHeaders;
    readonly method: string;
    readonly url: string;
}

type StreamKey = `${'program' | 'service'}:${number}`;

/** tuner server の代わりの loopback の HTTP server。stream の応答と、受け取った request を test が扱う。 */
export class SyntheticTunerServer {
    /** 番組の stream の応答（番組の id が key）。 */
    public readonly responses = new Map<number, ServerResponse>();
    public readonly requests: ReceivedRequest[] = [];
    /** `GET /api/programs/{id}` の応答。`undefined` の番組は 404。`'error'` の番組は 500。 */
    public readonly programs = new Map<number, Record<string, unknown> | 'error'>();
    /** stream の応答を客側が閉じた時刻（`program:<id>`・`service:<id>`）。 */
    public readonly closedAt = new Map<string, number>();
    /** `true` なら、stream の応答を開いた直後に放送の data を 1 chunk 送る（既定は送らず、test が送る）。 */
    public autoData = false;
    private readonly behaviors = new Map<StreamKey, StreamBehavior>();
    private readonly waiters = new Map<number, Array<(response: ServerResponse) => void>>();
    private readonly server: Server;
    private readonly sockets = new Set<Socket>();
    private port = 0;

    constructor() {
        this.server = createServer((request, response) => {
            const url = request.url ?? '';
            this.requests.push({ at: Date.now(), headers: request.headers, method: request.method ?? '', url });
            const stream = /^\/api\/(programs|services)\/(\d+)\/stream\?decode=1$/u.exec(url);
            if (stream !== null) {
                this.serveStream(stream[1] === 'programs' ? 'program' : 'service', Number(stream[2]), response);
                return;
            }
            const program = /^\/api\/programs\/(\d+)$/u.exec(url);
            if (program !== null) {
                const value = this.programs.get(Number(program[1]));
                if (value === 'error') {
                    response.writeHead(500, { 'Content-Type': 'application/json' });
                    response.end('{}');
                } else if (value === undefined) {
                    response.writeHead(404, { 'Content-Type': 'application/json' });
                    response.end('{}');
                } else {
                    response.writeHead(200, { 'Content-Type': 'application/json' });
                    response.end(JSON.stringify(value));
                }
                return;
            }
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end('{}');
        });
        this.server.on('connection', socket => {
            this.sockets.add(socket);
            socket.once('close', () => this.sockets.delete(socket));
        });
    }

    /** 番組（`program`）または放送局（`service`）の stream の振る舞いを決める。決めなければ `stream`。 */
    public behave(kind: 'program' | 'service', id: number, behavior: StreamBehavior): void {
        this.behaviors.set(`${kind}:${id}`, behavior);
    }

    /** stream の request（番組または放送局）だけを、届いた順に返す。 */
    public streamRequests(kind: 'program' | 'service', id?: number): ReceivedRequest[] {
        const pattern = new RegExp(`^/api/${kind === 'program' ? 'programs' : 'services'}/${id ?? '\\d+'}/stream`, 'u');
        return this.requests.filter(request => pattern.test(request.url));
    }

    private serveStream(kind: 'program' | 'service', id: number, response: ServerResponse): void {
        const key: StreamKey = `${kind}:${id}`;
        const behavior = this.behaviors.get(key) ?? { kind: 'stream' };
        response.once('close', () => this.closedAt.set(key, Date.now()));
        if (behavior.kind === 'status') {
            const fail = (): void => {
                if (response.destroyed) return;
                response.writeHead(behavior.status, { 'Content-Type': 'application/json' });
                response.end('{}');
            };
            if (behavior.delayMs === undefined) fail();
            else setTimeout(fail, behavior.delayMs);
            return;
        }
        if (behavior.kind === 'drop') {
            response.socket?.destroy();
            return;
        }
        const open = (): void => {
            response.writeHead(200, { 'Content-Type': 'video/MP2T' });
            response.flushHeaders();
            if (this.autoData) response.write(chunk(0));
            if (kind === 'program') {
                this.responses.set(id, response);
                for (const waiter of this.waiters.get(id) ?? []) waiter(response);
                this.waiters.delete(id);
            }
        };
        if (behavior.headerDelayMs === undefined) open();
        else setTimeout(() => !response.destroyed && open(), behavior.headerDelayMs);
    }

    /** 接続先の文字列（`http://127.0.0.1:<port>`）。まだ listen していなければ listen する。 */
    public async listen(port = 0): Promise<string> {
        await new Promise<void>((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(port, '127.0.0.1', () => resolve());
        });
        const address = this.server.address();
        if (address === null || typeof address === 'string') throw new Error('synthetic tuner address is unavailable');
        this.port = address.port;
        return ['http:', '', `127.0.0.1:${address.port}`].join('/');
    }

    public get listeningPort(): number {
        return this.port;
    }

    public response(programId: number): Promise<ServerResponse> {
        const existing = this.responses.get(programId);
        if (existing !== undefined) return Promise.resolve(existing);
        return new Promise(resolve => {
            this.waiters.set(programId, [...(this.waiters.get(programId) ?? []), resolve]);
        });
    }

    /** listen をやめ、既存の接続を切る。同じ port で `listen(port)` し直せる。 */
    public async close(): Promise<void> {
        for (const socket of this.sockets) socket.destroy();
        await new Promise<void>(resolve => this.server.close(() => resolve()));
    }
}

export interface TunerFixture {
    readonly access: Record<string, any>;
    /** 番組の stream の送信側。 */
    sender(programId: number): Promise<{ write(data: Buffer): Promise<void>; end(): void }>;
    close(): Promise<void>;
}

/** 実 HTTP の tuner server と、それに繋ぐ本物の `TunerServerAccessModel`。 */
export const createRealTuner = async (
    options: { readonly establishmentTimeoutMs?: number } = {},
): Promise<TunerFixture & { readonly server: SyntheticTunerServer }> => {
    const server = new SyntheticTunerServer();
    const target = await server.listen();
    return {
        access: new TunerServerAccessModel(target, 'EPGStation/synthetic', undefined, {
            tunerRestRequestTimeoutMs: 10_000,
            tunerStreamEstablishmentTimeoutMs: options.establishmentTimeoutMs ?? 10_000,
        }),
        server,
        sender: async programId => {
            const response = await server.response(programId);
            return { write: data => write(response, data), end: () => response.end() };
        },
        close: () => server.close(),
    };
};

export interface WireOptions {
    /** 録画の設定の上書き。 */
    readonly config?: Record<string, unknown>;
    /** `setTuner` へ渡す tuner。 */
    readonly tuners?: ReadonlyArray<{ types: string[] }>;
    /** 録画先選択の実行権。既定は常に取得できる偽物。 */
    readonly execution?: {
        getExecution: (...args: any[]) => Promise<unknown>;
        unLockExecution: (...args: any[]) => void;
    };
    /** 運用 log。既定は共有の log（呼び出しの記録は test が消す）。 */
    readonly log?: typeof sharedLogger;
    /** 番組情報の DB。既定は番組の id だけを返す偽物（本物の DB を使うときに渡す）。 */
    readonly programDB?: Record<string, any>;
    /** 録画履歴の DB。既定は登録を受け付けるだけの偽物。 */
    readonly recordedHistoryDB?: Record<string, any>;
}

export const wireRecording = (
    source: DataSource,
    root: string,
    tuner: Pick<TunerFixture, 'access'>,
    options: WireOptions = {},
) => {
    const log = options.log ?? sharedLogger;
    const configuration = {
        getConfig: () => ({
            conflictPriority: 9,
            isEnabledDropCheck: false,
            recPriority: 2,
            recorded: [{ name: 'synthetic-root', path: root }],
            recordedFileExtension: '.ts',
            recordedFormat: 'synthetic-session',
            timeSpecifiedEndMargin: 0,
            timeSpecifiedStartMargin: 0,
            ...options.config,
        }),
    };
    const operator = { getConnection: async () => source, getLikeStr: () => 'like' };
    const reserveDB = new ReserveDB(silentLoggerModel, operator, retry);
    const recordedDB = new RecordedDB(silentLoggerModel, operator, retry);
    const videoFileDB = new VideoFileDB(silentLoggerModel, operator, retry);
    const streamCreator = new RecordingStreamCreator({ getLogger: () => log }, configuration, tuner.access);
    streamCreator.setTuner(options.tuners ?? [{ types: ['GR'] }]);
    const programDB = options.programDB ?? {
        findChannelIdAndTime: vi.fn(async () => null),
        findEventRelayProgram: vi.fn(async () => null),
        findId: vi.fn(async (programId: number) => ({ id: programId })),
    };
    const recordingUtil = new RecordingUtilModel(
        { getLogger: () => log },
        configuration,
        options.execution ?? { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
        {
            findId: vi.fn(async () => ({
                channel: 'synthetic-channel',
                channelType: 'GR',
                halfWidthName: 'synthetic-channel',
                name: 'synthetic-channel',
                serviceId: 1,
            })),
        },
        programDB,
        videoFileDB,
        {
            getFullFilePathFromId: vi.fn(async (videoFileId: number) => {
                const videoFile = await videoFileDB.findId(videoFileId);
                return videoFile === null ? null : join(root, videoFile.filePath);
            }),
        },
    );
    const event = new RecordingEvent({ getLogger: () => log });
    const recorders: any[] = [];
    const provider = vi.fn(async () => {
        const recorder = new RecorderModel(
            { getLogger: () => log },
            configuration,
            programDB,
            reserveDB,
            recordedDB,
            options.recordedHistoryDB ?? { insertOnce: vi.fn(async () => 1) },
            videoFileDB,
            { insertOnce: vi.fn(async () => 1), updateCnt: vi.fn(async () => undefined) },
            streamCreator,
            {
                getFilePath: vi.fn(() => null),
                getResult: vi.fn(async () => ({})),
                start: vi.fn(async () => undefined),
                stop: vi.fn(async () => undefined),
            },
            recordingUtil,
            event,
            tuner.access,
        );
        recorders.push(recorder);
        return recorder;
    });
    const manager = new RecordingManageModel(
        { getLogger: () => log },
        configuration,
        provider,
        event,
        streamCreator,
        recordedDB,
        reserveDB,
        recordingUtil,
    );
    const prepStarted = vi.spyOn(event, 'emitStartPrepRecording');
    const prepFailed = vi.spyOn(event, 'emitPrepRecordingFailed');
    const started = vi.spyOn(event, 'emitStartRecording');
    const finished = vi.spyOn(event, 'emitFinishRecording');
    const failed = vi.spyOn(event, 'emitRecordingFailed');

    /** 候補を作り直して、各予約の録画の準備を始める（`persistence.integration` の Task 8.2 と同じ手順）。 */
    const startAll = async (reservationIds: readonly number[]): Promise<Map<number, any>> => {
        await manager.rebuildCandidatesAndStart();
        await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(reservationIds.length));
        const byReservation = new Map<number, any>();
        for (const [index, reservationId] of reservationIds.entries()) {
            const controller = (manager as any).scheduleController;
            const waiting = controller.getSessionSnapshot(reservationId);
            expect(waiting).toMatchObject({ phase: 'Waiting', reservationId });
            expect(
                controller.tryTransitionSession(
                    reservationId,
                    waiting.generation,
                    waiting.sessionToken,
                    'Waiting',
                    'Preparing',
                ),
            ).toBe(true);
            const recorder = recorders[index];
            (manager as any).bindRecorder(recorder, controller.getSessionSnapshot(reservationId));
            byReservation.set(reservationId, recorder);
        }
        return byReservation;
    };

    return {
        event,
        failed,
        finished,
        prepFailed,
        prepStarted,
        provider,
        manager,
        recorders,
        recordedDB,
        recordingUtil,
        reserveDB,
        started,
        startAll,
        streamCreator,
        stop: () => (manager as any).scheduleController.stop(),
        /** scheduler を止め、動いている録画の準備・録画を取り消す。test の終わりに呼ぶ。 */
        shutdown: async () => {
            (manager as any).scheduleController.stop();
            await Promise.all(recorders.map(recorder => recorder.cancel(false).catch(() => undefined)));
        },
        videoFileDB,
    };
};

/** 実 SQLite（一時 directory の file）と、録画の保存先の一時 directory を用意して `operation` を流す。 */
export const withSqlite = async (operation: (source: DataSource, root: string) => Promise<void>): Promise<void> => {
    const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-real-'));
    const source = new DataSource({
        type: 'better-sqlite3',
        database: join(root, 'recording.db'),
        entities: [join(process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT!, 'db', 'entities', '*.js')],
        logging: false,
        synchronize: true,
    });
    try {
        await source.initialize();
        await operation(source, root);
    } finally {
        if (source.isInitialized) await source.destroy();
        await rm(root, { force: true, recursive: true });
    }
};

export const insertReserve = async (source: DataSource, overrides: Record<string, unknown>) => {
    const now = Date.now();
    const reserve = makeReserve({
        startAt: now + 120_000,
        endAt: now + 180_000,
        updateTime: now,
        ...overrides,
    });
    await source.getRepository(Reserve).insert(reserve);
    return reserve;
};
