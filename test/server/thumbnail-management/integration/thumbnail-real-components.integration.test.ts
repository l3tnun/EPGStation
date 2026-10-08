import 'reflect-metadata';

import { createServer, type ServerResponse } from 'node:http';
import { unwatchFile, watchFile } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeferred } from '../../harness/async';
import { createSyntheticMedia, FFMPEG, runProcess } from '../../harness/synthetic-media';
import {
    createRepositoryPersistence,
    loadCompiledDefault,
    type RepositoryPersistence,
} from '../../persistence/repository-harness';

/*
 * thumbnail の test の多くは、DB・queue・ffmpeg・設定 file を偽物にして件数や呼び出しを見る。ここでは同じ受付・直列実行・
 * 再起動の条件を、本物の設定 file（Configuration）、本物の SQLite（RecordedDB・VideoFileDB・ThumbnailDB）、本物の
 * VideoUtil・PromiseQueue・ThumbnailEvent・ThumbnailManageModel・ThumbnailApiModel、実 file system、実 HTTP、本物の ffmpeg
 * で確かめる。先頭の依頼を止めるときは、本物の DB・VideoUtil を包んで deferred で待たせる。
 */

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');
const compiled = (...path: string[]): string => join(snapshot, ...path);

const Configuration = loadCompiledDefault<any>('model/Configuration.js');
const ThumbnailManageModel = loadCompiledDefault<any>('model/operator/thumbnail/ThumbnailManageModel.js');
const ThumbnailApiModel = loadCompiledDefault<any>('model/api/thumbnail/ThumbnailApiModel.js');
const PromiseQueue = loadCompiledDefault<any>('model/PromiseQueue.js');
const ThumbnailEvent = loadCompiledDefault<any>('model/event/ThumbnailEvent.js');
const VideoUtil = loadCompiledDefault<any>('model/api/video/VideoUtil.js');
const container = (require(compiled('model', 'ModelContainer.js')) as { default: any }).default;
type Operation = (request: any, response: any) => Promise<void>;
const regenerateApi = (require(compiled('model', 'service', 'api', 'thumbnails.js')) as { post: Operation }).post;
const cleanupApi = (require(compiled('model', 'service', 'api', 'thumbnails', 'cleanup.js')) as { post: Operation })
    .post;
const addApi = (
    require(compiled('model', 'service', 'api', 'thumbnails', 'videos', '{videoFileId}.js')) as { post: Operation }
).post;
const readApi = (require(compiled('model', 'service', 'api', 'thumbnails', '{thumbnailId}.js')) as { get: Operation })
    .get;

let root: string;
let storage: string;
let ffmpegPath: string;
let persistence: RepositoryPersistence;
let sequence = 0;
const cleanups: Array<() => Promise<void> | void> = [];

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-real-'));
    storage = join(root, 'synthetic-storage');
    await mkdir(storage, { recursive: true });
    await createSyntheticMedia(storage, 'synthetic-input.ts', 'mpegts', 2);
    ffmpegPath = (await runProcess('sh', ['-c', `command -v ${FFMPEG}`])).stdout.trim();
}, 120_000);

beforeEach(async () => {
    persistence = await createRepositoryPersistence('sqlite');
});

afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    if (container.isBound('IThumbnailApiModel')) container.unbind('IThumbnailApiModel');
    await persistence.cleanup();
});

afterAll(async () => {
    await rm(root, { force: true, recursive: true });
});

const recordedRow = (name: string) => ({
    reserveId: null,
    ruleId: null,
    programId: null,
    channelId: 10,
    isProtected: false,
    startAt: 1_000,
    endAt: 2_000,
    duration: 1_000,
    name,
    halfWidthName: name,
    isRecording: false,
    dropLogFileId: null,
});

const insertVideo = async (): Promise<{ recordedId: number; videoFileId: number }> => {
    const recordedId = Number(
        await persistence.db.RecordedDB.insertOnce(recordedRow(`synthetic-recorded-${++sequence}`)),
    );
    const videoFileId = Number(
        await persistence.db.VideoFileDB.insertOnce({
            recordedId,
            parentDirectoryName: 'synthetic-storage',
            filePath: 'synthetic-input.ts',
            type: 'ts',
            name: 'TS',
            size: (await stat(join(storage, 'synthetic-input.ts'))).size,
        }),
    );
    return { recordedId, videoFileId };
};

const logger = () => {
    const log = {
        system: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
        stream: { warn: vi.fn() },
    };
    return { getLogger: () => log, log };
};

/** 本物の設定 file access（実 fs。watch は短い polling）。 */
const fileAccess = (settingsFile: string) => {
    return {
        configPath: settingsFile,
        templatePath: `${settingsFile}.template`,
        readSync: (path: string) => require('node:fs').readFileSync(path, 'utf-8'),
        read: (path: string) => readFile(path, 'utf-8'),
        watch: (path: string, listener: () => void) => {
            watchFile(path, { interval: 20 }, listener);
        },
        unwatch: (path: string, listener: () => void) => unwatchFile(path, listener),
    };
};

interface Env {
    settingsFile: string;
    imageHome: string;
    configuration: any;
    log: ReturnType<typeof logger>['log'];
    writeConfig(maxPending: unknown): Promise<void>;
    startConfiguration(): any;
}

const makeEnv = async (maxPending: unknown): Promise<Env> => {
    const dir = await mkdtemp(join(root, 'env-'));
    const imageHome = join(dir, 'thumbnail');
    const settingsFile = join(dir, 'config.yml');
    const { getLogger, log } = logger();
    const writeConfig = async (value: unknown): Promise<void> => {
        const body = () => ({
            port: 49100,
            thumbnail: imageHome,
            ffmpeg: ffmpegPath,
            ffprobe: 'ffprobe',
            recorded: [{ name: 'synthetic-storage', path: storage }],
            thumbnailPosition: 1,
            thumbnailSize: '160x90',
            ...(value === undefined ? {} : { thumbnailMaxPending: value }),
        });
        await writeFile(settingsFile, JSON.stringify(body()), 'utf8');
    };
    await writeConfig(maxPending);
    const access = fileAccess(settingsFile);
    const startConfiguration = () => {
        const configuration = new Configuration({ getLogger }, access);
        cleanups.push(() => access.unwatch(settingsFile, (configuration as any).changeListener));
        return configuration;
    };
    return { settingsFile, imageHome, configuration: startConfiguration(), log, writeConfig, startConfiguration };
};

interface Stack {
    model: any;
    event: any;
    log: ReturnType<typeof logger>['log'];
    resolvedVideoIds: number[];
    /** findId を待たせる video file id の gate（本物の VideoFileDB を包む）。 */
    videoGate: ReturnType<typeof createDeferred<void>>;
    gatedIds: Set<number>;
    entered: number[];
    insertGate: ReturnType<typeof createDeferred<void>> | null;
    insertFailure: Error | null;
    insertCalls: number[];
}

const makeStack = (env: Env, configuration: any = env.configuration): Stack => {
    const { getLogger, log } = logger();
    const gatedIds = new Set<number>();
    const videoGate = createDeferred<void>();
    const entered: number[] = [];
    const stack: Stack = {
        model: undefined,
        event: new ThumbnailEvent({ getLogger }),
        log,
        resolvedVideoIds: [],
        videoGate,
        gatedIds,
        entered,
        insertGate: null,
        insertFailure: null,
        insertCalls: [],
    };
    const videoFileDB = new Proxy(persistence.db.VideoFileDB, {
        get(target, property, receiver) {
            if (property !== 'findId') return Reflect.get(target, property, receiver);
            return async (id: number) => {
                entered.push(id);
                if (gatedIds.has(id)) await videoGate.promise;
                return target.findId(id);
            };
        },
    });
    const realVideoUtil = new VideoUtil(configuration, persistence.db.VideoFileDB);
    const videoUtil = {
        getFullFilePathFromId: async (id: number) => {
            stack.resolvedVideoIds.push(id);
            return realVideoUtil.getFullFilePathFromId(id);
        },
    };
    const thumbnailDB = new Proxy(persistence.db.ThumbnailDB, {
        get(target, property, receiver) {
            if (property !== 'insertOnce') return Reflect.get(target, property, receiver);
            return async (thumbnail: { recordedId: number }) => {
                stack.insertCalls.push(thumbnail.recordedId);
                if (stack.insertGate !== null) await stack.insertGate.promise;
                if (stack.insertFailure !== null) throw stack.insertFailure;
                return target.insertOnce(thumbnail);
            };
        },
    });
    stack.model = new ThumbnailManageModel(
        { getLogger },
        configuration,
        new PromiseQueue(),
        persistence.db.RecordedDB,
        videoFileDB,
        thumbnailDB,
        stack.event,
        videoUtil,
    );
    return stack;
};

const thumbnailRows = (): Promise<Array<{ id: number; recordedId: number; filePath: string }>> =>
    persistence.db.ThumbnailDB.findAll();

const expressLikeResponse = (response: ServerResponse): ServerResponse => {
    const adapter = Object.assign(response, {
        header(name: string, value: string) {
            response.setHeader(name, value);
            return adapter;
        },
        json(body: unknown) {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify(body));
            return adapter;
        },
        status(code: number) {
            response.statusCode = code;
            return adapter;
        },
        set(headers: Record<string, string>) {
            for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
            return adapter;
        },
    });
    return adapter;
};

/** 本物の ApiModel（IPC は同じ process の model へ委譲）を実 HTTP の listener へ載せる。 */
const startHttp = async (manage: any, imageHome: string) => {
    const ipc = {
        thumbnail: {
            add: async (id: number) => manage.add(id),
            delete: async (id: number) => manage.delete(id),
            regenerate: async () => manage.regenerate(),
            fileCleanup: async () => manage.fileCleanup(),
        },
    };
    if (container.isBound('IThumbnailApiModel')) container.unbind('IThumbnailApiModel');
    container
        .bind('IThumbnailApiModel')
        .toConstantValue(
            new ThumbnailApiModel(ipc, persistence.db.ThumbnailDB, { getConfig: () => ({ thumbnail: imageHome }) }),
        );
    const server = createServer(async (incoming, outgoing) => {
        const match = incoming.url?.match(
            /^\/api\/thumbnails(?:\/videos\/(?<videoFileId>\d+)|\/cleanup|\/(?<thumbnailId>\d+))?$/u,
        );
        if (match === null || match === undefined) {
            outgoing.statusCode = 404;
            outgoing.end();
            return;
        }
        const operation =
            match.groups?.videoFileId !== undefined
                ? addApi
                : match.groups?.thumbnailId !== undefined
                  ? readApi
                  : incoming.url === '/api/thumbnails/cleanup'
                    ? cleanupApi
                    : regenerateApi;
        Object.assign(incoming, { params: match.groups ?? {} });
        await operation(incoming, expressLikeResponse(outgoing));
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    cleanups.push(async () => {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Loopback listener has no TCP port');
    return async (method: string, path: string) => {
        const response = await fetch(
            ['http:', '', `127.0.0.1:${address.port}`, ...path.split('/').filter(Boolean)].join('/'),
            {
                method,
            },
        );
        const bytes = Buffer.from(await response.arrayBuffer());
        const type = response.headers.get('content-type') ?? '';
        return {
            status: response.status,
            bytes,
            body: type.includes('application/json') ? JSON.parse(bytes.toString('utf8')) : null,
        };
    };
};

const waitRows = (count: number) =>
    vi.waitFor(async () => expect(await thumbnailRows()).toHaveLength(count), { timeout: 60_000, interval: 50 });

const accepted = (stack: Stack, id: number): boolean => {
    try {
        stack.model.add(id);
        return true;
    } catch (error) {
        expect((error as Error).message).toBe('ThumbnailQueueIsFull');
        return false;
    }
};

describe('thumbnail admission and restart against real components', () => {
    it('[TM-1.1][TM-1.7][TM-1.8] answers an HTTP add before generation, rejects only the request beyond the limit, and still completes every accepted request', async () => {
        const env = await makeEnv(2);
        const stack = makeStack(env);
        const call = await startHttp(stack.model, env.imageHome);
        const videos = [await insertVideo(), await insertVideo(), await insertVideo(), await insertVideo()];
        for (const video of videos) stack.gatedIds.add(video.videoFileId);

        // 1 件目は実行中（gate で待つ）。待機枠は 2 件。
        await expect(call('POST', `/api/thumbnails/videos/${videos[0].videoFileId}`)).resolves.toMatchObject({
            status: 200,
        });
        await vi.waitFor(() => expect(stack.entered).toEqual([videos[0].videoFileId]));
        // 受付は生成完了ではない: 応答の時点で DB にも画像にも何も無い。
        expect(await thumbnailRows()).toEqual([]);
        await expect(readdir(env.imageHome)).rejects.toMatchObject({ code: 'ENOENT' });

        await expect(call('POST', `/api/thumbnails/videos/${videos[1].videoFileId}`)).resolves.toMatchObject({
            status: 200,
        });
        await expect(call('POST', `/api/thumbnails/videos/${videos[2].videoFileId}`)).resolves.toMatchObject({
            status: 200,
        });
        const rejected = await call('POST', `/api/thumbnails/videos/${videos[3].videoFileId}`);
        expect(rejected).toMatchObject({
            status: 500,
            body: { code: 500, errors: 'ThumbnailQueueIsFull', message: 'Internal Server Error' },
        });
        // 待機中は 1 件目の準備だけが進んでいる（直列）。
        expect(stack.entered).toEqual([videos[0].videoFileId]);

        stack.videoGate.resolve();
        await waitRows(3);
        const rows = await thumbnailRows();
        expect(rows.map(row => row.recordedId).sort()).toEqual(
            [videos[0], videos[1], videos[2]].map(video => video.recordedId).sort(),
        );
        // 受け付けた順に 1 件ずつ準備された。拒否された依頼は DB にも無い。
        expect(stack.entered).toEqual([videos[0], videos[1], videos[2]].map(video => video.videoFileId));
        expect(rows.some(row => row.recordedId === videos[3].recordedId)).toBe(false);
        // 生成された画像は HTTP で本物の JPEG として取れる。
        const image = await call('GET', `/api/thumbnails/${rows[0].id}`);
        expect(image.status).toBe(200);
        expect(image.bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
        expect(stack.log.system.error).not.toHaveBeenCalled();
    }, 120_000);

    it('[TM-1.4] uses 32 when the real config file omits the limit: 1 running plus 32 waiting are accepted and the 34th is refused without cancelling them', async () => {
        const env = await makeEnv(undefined);
        const stack = makeStack(env);
        stack.gatedIds.add(9_999_001);
        expect(accepted(stack, 9_999_001)).toBe(true);
        await vi.waitFor(() => expect(stack.entered).toEqual([9_999_001]));
        for (let i = 0; i < 32; i++) expect(accepted(stack, 9_999_001)).toBe(true);
        expect(accepted(stack, 9_999_001)).toBe(false);

        stack.videoGate.resolve();
        // 受け付けた 33 件すべてが（動画が無いので）失敗として確定し、拒否した 1 件は数えられない。
        await vi.waitFor(() =>
            expect(
                stack.log.system.error.mock.calls.filter(call => call[0] === 'create thumbnail error: 9999001').length,
            ).toBe(33),
        );
        expect(accepted(stack, 9_999_001)).toBe(true);
    }, 60_000);

    it('[TM-1.5] refuses to start the configuration with a limit outside 1..10000 and admits exactly the configured limit at the bounds', async () => {
        const env = await makeEnv(1);
        for (const invalid of [0, 10_001, 1.5, -1, 'many']) {
            await env.writeConfig(invalid);
            expect(() => env.startConfiguration(), `thumbnailMaxPending=${String(invalid)}`).toThrow();
        }
        await env.writeConfig(10_000);
        expect(env.startConfiguration().getConfig().thumbnailMaxPending).toBe(10_000);

        await env.writeConfig(1);
        const configuration = env.startConfiguration();
        expect(configuration.getConfig().thumbnailMaxPending).toBe(1);
        const stack = makeStack(env, configuration);
        stack.gatedIds.add(9_999_002);
        expect(accepted(stack, 9_999_002)).toBe(true);
        await vi.waitFor(() => expect(stack.entered).toEqual([9_999_002]));
        expect(accepted(stack, 9_999_002)).toBe(true);
        expect(accepted(stack, 9_999_002)).toBe(false);
        stack.videoGate.resolve();
        await vi.waitFor(() =>
            expect(
                stack.log.system.error.mock.calls.filter(call => call[0] === 'create thumbnail error: 9999002').length,
            ).toBe(2),
        );
    }, 60_000);

    it('[TM-1.6] keeps the running limit when the real config file changes and reads the new value only on a restart', async () => {
        const env = await makeEnv(1);
        const stack = makeStack(env);
        await env.writeConfig(3);
        // 本物の fs.watchFile が設定の再読込みを発火する。設定側は新しい値を持つ。
        await vi.waitFor(() => expect(env.configuration.getConfig().thumbnailMaxPending).toBe(3), {
            timeout: 30_000,
            interval: 20,
        });
        stack.gatedIds.add(9_999_003);
        expect(accepted(stack, 9_999_003)).toBe(true);
        await vi.waitFor(() => expect(stack.entered).toEqual([9_999_003]));
        expect(accepted(stack, 9_999_003)).toBe(true);
        // 動いている instance は起動時の 1 のまま。
        expect(accepted(stack, 9_999_003)).toBe(false);

        const restarted = makeStack(env, env.configuration);
        restarted.gatedIds.add(9_999_004);
        expect(accepted(restarted, 9_999_004)).toBe(true);
        await vi.waitFor(() => expect(restarted.entered).toEqual([9_999_004]));
        for (let i = 0; i < 3; i++) expect(accepted(restarted, 9_999_004)).toBe(true);
        expect(accepted(restarted, 9_999_004)).toBe(false);
        stack.videoGate.resolve();
        restarted.videoGate.resolve();
        await vi.waitFor(() =>
            expect(
                restarted.log.system.error.mock.calls.filter(call => call[0] === 'create thumbnail error: 9999004')
                    .length,
            ).toBe(4),
        );
    }, 60_000);

    it('[TM-1.9] starts the next real generation after the added notification without waiting for a listener that never settles', async () => {
        const env = await makeEnv(8);
        const stack = makeStack(env);
        const neverSettles = new Promise<void>(() => undefined);
        const listener = vi.fn(() => neverSettles);
        stack.event.setAdded(listener);
        const first = await insertVideo();
        const second = await insertVideo();
        stack.model.add(first.videoFileId);
        stack.model.add(second.videoFileId);
        await waitRows(2);
        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener).toHaveBeenNthCalledWith(1, first.videoFileId, first.recordedId);
        expect(listener).toHaveBeenNthCalledWith(2, second.videoFileId, second.recordedId);
        expect((await readdir(env.imageHome)).filter(name => name.endsWith('.jpg')).sort()).toEqual(
            [`${first.recordedId}.jpg`, `${second.recordedId}.jpg`].sort(),
        );
    }, 60_000);

    it('[TM-1.10] keeps the next generation waiting while the real DB registration is unresolved, and moves on after a registration failure without keeping the image', async () => {
        const env = await makeEnv(8);
        const stack = makeStack(env);
        const added = vi.fn();
        stack.event.setAdded(added);
        const first = await insertVideo();
        const second = await insertVideo();
        stack.insertGate = createDeferred<void>();
        stack.insertFailure = new Error('synthetic thumbnail registration failure');
        stack.model.add(first.videoFileId);
        stack.model.add(second.videoFileId);

        await vi.waitFor(() => expect(stack.insertCalls).toEqual([first.recordedId]), { timeout: 60_000 });
        // 登録が未解決の間、2 件目は準備にも入らない。通知も出ない。
        expect(stack.resolvedVideoIds).toEqual([first.videoFileId]);
        expect(added).not.toHaveBeenCalled();

        stack.insertGate.resolve();
        // 1 件目の登録は失敗として確定し、その後で 2 件目が始まる（2 件目も同じ失敗を受ける）。
        await vi.waitFor(() => expect(stack.insertCalls).toEqual([first.recordedId, second.recordedId]), {
            timeout: 60_000,
        });
        expect(stack.resolvedVideoIds).toEqual([first.videoFileId, second.videoFileId]);
        await vi.waitFor(() =>
            expect(
                stack.log.system.error.mock.calls.filter(call => String(call[0]).startsWith('create thumbnail error')),
            ).toHaveLength(2),
        );
        expect(added).not.toHaveBeenCalled();
        expect(await thumbnailRows()).toEqual([]);
        expect((await readdir(env.imageHome)).filter(name => !name.startsWith('.thumbnail-'))).toEqual([]);
    }, 120_000);

    it('[TM-6.1][TM-6.2][TM-6.3][TM-6.4] does not carry waiting or running requests over a restart, and accepts explicit regenerate and cleanup over HTTP afterwards', async () => {
        const env = await makeEnv(8);
        const before = makeStack(env);
        const videos = [await insertVideo(), await insertVideo(), await insertVideo()];
        for (const video of videos) before.gatedIds.add(video.videoFileId);

        // 再起動前: 1 件が実行中、2 件が待機中。どちらも memory にだけ有り、DB にも画像にも現れない。
        for (const video of videos) before.model.add(video.videoFileId);
        await vi.waitFor(() => expect(before.entered).toEqual([videos[0].videoFileId]));
        expect(await thumbnailRows()).toEqual([]);
        await expect(readdir(env.imageHome)).rejects.toMatchObject({ code: 'ENOENT' });

        // 再起動: 同じ DB・同じ directory で新しい instance を作る。前の instance は止まったものとして扱う。
        const after = makeStack(env);
        const call = await startHttp(after.model, env.imageHome);
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(after.entered).toEqual([]);
        expect(after.resolvedVideoIds).toEqual([]);
        expect(await thumbnailRows()).toEqual([]);

        // 明示の再生成（HTTP）は受け付けられ、画像が無い 3 件を新しい instance が作る。
        await expect(call('POST', '/api/thumbnails')).resolves.toMatchObject({ status: 200, body: { code: 200 } });
        await waitRows(3);
        expect(after.entered.sort()).toEqual(videos.map(video => video.videoFileId).sort());
        const rows = await thumbnailRows();
        expect(rows.map(row => row.recordedId).sort()).toEqual(videos.map(video => video.recordedId).sort());

        // 明示のクリーンアップ（HTTP）も受け付けられ、DB に無い画像と、画像の無い DB 行を片付ける。
        await writeFile(join(env.imageHome, 'synthetic-orphan.jpg'), 'synthetic-orphan');
        await rm(join(env.imageHome, rows[0].filePath));
        await expect(call('POST', '/api/thumbnails/cleanup')).resolves.toMatchObject({
            status: 200,
            body: { code: 200 },
        });
        await vi.waitFor(async () => expect(await thumbnailRows()).toHaveLength(2));
        expect((await readdir(env.imageHome)).filter(name => name.endsWith('.jpg')).sort()).toEqual(
            rows
                .slice(1)
                .map(row => row.filePath)
                .sort(),
        );

        // 前の instance の gate を解いて資源を回収する（再起動後の状態を先に検査し終えている）。
        before.videoGate.resolve();
        await vi.waitFor(() => expect(before.entered).toHaveLength(3), { timeout: 60_000 });
        await waitRows(5);
    }, 180_000);
});
