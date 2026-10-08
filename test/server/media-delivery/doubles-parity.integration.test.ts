import 'reflect-metadata';

import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { load as loadYaml } from 'js-yaml';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createSyntheticMedia, FFMPEG, runProcess } from '../harness/synthetic-media';
import { baseConfig, compiled, executionManager, prepareEncodeProcessManageModel, spawnStub } from './_media-harness';

/*
 * 配信の test が差し替える外部の部品（Kodi への送信の axios、動画の種類を判定する file-type）が、本物と同じに
 * 振る舞うことを確かめる。偽物の test と同じ入力を、本物の axios と手作りの Kodi（実際の HTTP）、本物の file-type と
 * 実 file（本物の ffmpeg で作った合成の TS・MP4）で流す。
 */

const ApiUtil = compiled<{ default: new (...args: any[]) => any }>('model', 'api', 'ApiUtil.js').default;
const VideoApiModel = compiled<{ default: new (...args: any[]) => any }>(
    'model',
    'api',
    'video',
    'VideoApiModel.js',
).default;

interface KodiRequest {
    readonly authorization?: string;
    readonly body: unknown;
    readonly contentType?: string;
    readonly method?: string;
    readonly url?: string;
}

class SyntheticKodi {
    public readonly requests: KodiRequest[] = [];
    public readonly closedRequests: KodiRequest[] = [];
    private readonly server: Server;
    private readonly sockets = new Set<Socket>();

    constructor(private readonly respond: (request: KodiRequest, response: ServerResponse) => void) {
        this.server = createServer((incoming: IncomingMessage, response) => {
            const chunks: Buffer[] = [];
            incoming.on('data', chunk => chunks.push(chunk));
            incoming.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                const request: KodiRequest = {
                    authorization: incoming.headers.authorization,
                    body: text.length === 0 ? undefined : JSON.parse(text),
                    contentType: incoming.headers['content-type'],
                    method: incoming.method,
                    url: incoming.url,
                };
                this.requests.push(request);
                response.once('close', () => {
                    if (!response.writableFinished) this.closedRequests.push(request);
                });
                this.respond(request, response);
            });
        });
        this.server.on('connection', socket => {
            this.sockets.add(socket);
            socket.once('close', () => this.sockets.delete(socket));
        });
    }

    public async listen(): Promise<string> {
        await new Promise<void>((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(0, '127.0.0.1', () => resolve());
        });
        const address = this.server.address();
        if (address === null || typeof address === 'string') throw new Error('synthetic Kodi address is unavailable');
        return ['http:', '', `127.0.0.1:${address.port}`, 'synthetic-base'].join('/');
    }

    public async close(): Promise<void> {
        for (const socket of this.sockets) socket.destroy();
        await new Promise<void>(resolve => this.server.close(() => resolve()));
    }
}

const jsonRpcResult = (response: ServerResponse, body: unknown, status = 200): void => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
};

const withKodi = async (
    respond: (request: KodiRequest, response: ServerResponse) => void,
    run: (kodi: SyntheticKodi, host: string) => Promise<void>,
): Promise<void> => {
    const kodi = new SyntheticKodi(respond);
    const host = await kodi.listen();
    try {
        await run(kodi, host);
    } finally {
        await kodi.close();
    }
};

describe('Kodi axios double against real HTTP', () => {
    it('[MD-DOUBLE-PARITY-KODI] posts the same JSON-RPC playback request the axios double records to a real Kodi endpoint', async () => {
        await withKodi(
            (request, response) => jsonRpcResult(response, { id: 1, jsonrpc: '2.0', result: 'OK' }),
            async (kodi, host) => {
                const apiUtil = new ApiUtil({ getConfig: () => ({}) });
                await expect(
                    apiUtil.sendToKodi('https://request.invalid/video', {
                        host,
                        name: 'living-room',
                        password: '<synthetic-password>',
                        user: 'synthetic-user',
                    }),
                ).resolves.toBeUndefined();
                await expect(
                    apiUtil.sendToKodi('https://request.invalid/second', {
                        host,
                        name: 'living-room',
                        user: 'synthetic-user',
                    }),
                ).resolves.toBeUndefined();

                expect(kodi.requests).toEqual([
                    {
                        authorization: `Basic ${Buffer.from('synthetic-user:<synthetic-password>').toString('base64')}`,
                        body: {
                            id: 1,
                            jsonrpc: '2.0',
                            method: 'Player.Open',
                            params: { item: { file: 'https://request.invalid/video' } },
                        },
                        contentType: 'application/json',
                        method: 'POST',
                        // 設定の host の path は使わず、`/jsonrpc` を host の root に置く（偽物の test の url と同じ）。
                        url: '/jsonrpc',
                    },
                    expect.objectContaining({
                        authorization: undefined,
                        body: expect.objectContaining({ params: { item: { file: 'https://request.invalid/second' } } }),
                        url: '/jsonrpc',
                    }),
                ]);
            },
        );
    });

    it('[MD-DOUBLE-PARITY-KODI] resolves a JSON-RPC error body the same way as the fixed success double, and rejects HTTP failures and refused connections', async () => {
        await withKodi(
            (request, response) => {
                if (
                    (request.body as { params: { item: { file: string } } }).params.item.file.endsWith('unauthorized')
                ) {
                    jsonRpcResult(response, { error: 'synthetic-unauthorized' }, 401);
                    return;
                }
                jsonRpcResult(response, {
                    id: 1,
                    jsonrpc: '2.0',
                    error: { code: -32_602, message: 'Invalid params.' },
                });
            },
            async (_kodi, host) => {
                const apiUtil = new ApiUtil({ getConfig: () => ({}) });
                // 偽物は `{ data: {} }` を返して成功する。本物の Kodi は再生の失敗も HTTP 200 の JSON-RPC error で返し、
                // ApiUtil はそれを成功として扱う（v2 と同じ）。
                await expect(
                    apiUtil.sendToKodi('https://request.invalid/rpc-error', { host, name: 'living-room' }),
                ).resolves.toBeUndefined();
                await expect(
                    apiUtil.sendToKodi('https://request.invalid/unauthorized', { host, name: 'living-room' }),
                ).rejects.toMatchObject({ response: { status: 401 } });
            },
        );

        const refused = new SyntheticKodi(() => undefined);
        const refusedHost = await refused.listen();
        await refused.close();
        const apiUtil = new ApiUtil({ getConfig: () => ({}) });
        await expect(
            apiUtil.sendToKodi('https://request.invalid/video', { host: refusedHost, name: 'living-room' }),
        ).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    });

    it('[MD-DOUBLE-PARITY-KODI] aborts the real HTTP request when the 30-second deadline expires', async () => {
        await withKodi(
            () => undefined,
            async (kodi, host) => {
                vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
                try {
                    const apiUtil = new ApiUtil({ getConfig: () => ({}) });
                    const pending = apiUtil
                        .sendToKodi('https://request.invalid/video', { host, name: 'living-room' })
                        .then(
                            () => undefined,
                            (error: Error) => error,
                        );
                    await vi.waitFor(() => expect(kodi.requests).toHaveLength(1));
                    await vi.advanceTimersByTimeAsync(30_000);

                    await expect(pending).resolves.toMatchObject({ message: 'KodiRequestDeadlineExceeded' });
                    // 偽物の test は signal の aborted だけを見る。本物の axios は abort で実際に接続を閉じる。
                    await vi.waitFor(() => expect(kodi.closedRequests).toHaveLength(1));
                } finally {
                    vi.useRealTimers();
                }
            },
        );
    });
});

describe('file-type double against the real library and real media files', () => {
    let root: string;
    let ts: string;
    let mp4: string;

    beforeAll(async () => {
        root = await mkdtemp(join(tmpdir(), 'epgstation-media-file-type-'));
        ts = await createSyntheticMedia(root, 'synthetic.ts', 'mpegts');
        mp4 = await createSyntheticMedia(root, 'synthetic.mp4', 'mp4');
    }, 120_000);

    afterAll(async () => {
        await rm(root, { force: true, recursive: true });
    });

    const modelFor = (fullPath: string) =>
        new VideoApiModel(
            { getConfig: () => ({ recorded: [], thumbnail: 'synthetic-thumbnail' }) },
            { findId: vi.fn(async () => null) },
            { findId: vi.fn(async () => null) },
            { createM3U8PlayListStr: vi.fn(() => 'synthetic-playlist') },
            { getFullFilePathFromId: vi.fn(async () => fullPath), getInfo: vi.fn(async () => ({ duration: 0 })) },
            { recorded: { deleteVideoFile: vi.fn() } },
        );

    it('[MD-DOUBLE-PARITY-FILE-TYPE] keeps the extension fallback the double exercises when the real library cannot tell the type', async () => {
        const unknownMp4 = join(root, 'unknown.mp4');
        const unknownM2ts = join(root, 'unknown.m2ts');
        const emptyTs = join(root, 'recording-just-started.ts');
        await writeFile(unknownMp4, Buffer.from('synthetic-not-a-video'));
        await writeFile(unknownM2ts, Buffer.from('synthetic-not-a-video'));
        await writeFile(emptyTs, Buffer.alloc(0));

        await expect(modelFor(unknownMp4).getFullFilePath(1)).rejects.toThrow('MimeTypeError');
        await expect(modelFor(unknownM2ts).getFullFilePath(2)).resolves.toEqual({
            path: unknownM2ts,
            mime: 'video/mp2t',
        });
        await expect(modelFor(emptyTs).getFullFilePath(3)).resolves.toEqual({ path: emptyTs, mime: 'video/mp2t' });
    });

    it('[MD-DOUBLE-PARITY-FILE-TYPE] reads the type of real TS and MP4 files from their content, not from the extension', async () => {
        const mp4NamedTs = join(root, 'mp4-content.ts');
        const tsNamedMp4 = join(root, 'ts-content.mp4');
        await copyFile(mp4, mp4NamedTs);
        await copyFile(ts, tsNamedMp4);

        await expect(modelFor(ts).getFullFilePath(1)).resolves.toEqual({ path: ts, mime: 'video/mp2t' });
        await expect(modelFor(mp4).getFullFilePath(2)).resolves.toEqual({ path: mp4, mime: 'video/mp4' });
        await expect(modelFor(mp4NamedTs).getFullFilePath(3)).resolves.toEqual({ path: mp4NamedTs, mime: 'video/mp4' });
        await expect(modelFor(tsNamedMp4).getFullFilePath(4)).resolves.toEqual({
            path: tsNamedMp4,
            mime: 'video/mp2t',
        });
    });
});

describe('node script stream commands against the real ffmpeg', () => {
    const LiveHLSStreamModel = compiled<{ default: new (...args: any[]) => any }>(
        'model',
        'service',
        'stream',
        'LiveHLSStreamModel.js',
    ).default;
    const HLSFileDeleterModel = compiled<{ default: new (...args: any[]) => any }>(
        'model',
        'service',
        'stream',
        'util',
        'HLSFileDeleterModel.js',
    ).default;
    const StreamManageModel = compiled<{ default: new (...args: any[]) => any }>(
        'model',
        'service',
        'stream',
        'manager',
        'StreamManageModel.js',
    ).default;

    it('[MD-DOUBLE-PARITY-FFMPEG] writes, serves, and removes a live HLS playlist with the bundled command and the real ffmpeg', async () => {
        const EncodeProcessManageModel = await prepareEncodeProcessManageModel();
        spawnStub.mockReset();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-media-real-hls-'));
        const streamRoot = join(root, 'streamfiles');
        await runProcess('mkdir', ['-p', streamRoot]);
        const source = await createSyntheticMedia(root, 'live-source.ts', 'mpegts', 30);
        const template = loadYaml(await readFile(join(process.cwd(), 'config', 'config.yml.template'), 'utf8')) as {
            stream: { live: { ts: { hls: Array<{ cmd: string }> } } };
        };
        const ffmpegPath = (await runProcess('sh', ['-c', `command -v ${FFMPEG}`])).stdout.trim();
        const logs = {
            getLogger: () => ({
                encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
                stream: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
                system: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            }),
        };
        const processManager = new EncodeProcessManageModel(logs, { getConfig: () => ({ encodeProcessNum: 1 }) });
        // tuner の stream は偽物のまま（この case は ffmpeg を確かめる）。合成の TS を流し、終わりは送らない。
        const tuner = new PassThrough();
        tuner.write(await readFile(source));
        const model = new LiveHLSStreamModel(
            { getConfig: () => baseConfig({ ffmpeg: ffmpegPath, streamFilePath: streamRoot }) },
            logs,
            processManager,
            new HLSFileDeleterModel(logs),
            { openServiceStream: vi.fn(async () => ({ close: vi.fn(() => tuner.destroy()), stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101, cmd: template.stream.live.ts.hls[0].cmd }, 0);
        const manager = new StreamManageModel(logs, executionManager(), { notifyClient: vi.fn() });

        try {
            const streamId = await manager.start(model);
            await vi.waitFor(() => expect(model.getInfo().isEnable).toBe(true), { timeout: 60_000, interval: 200 });
            const playlist = await readFile(join(streamRoot, `stream${streamId}.m3u8`), 'utf8');
            const segments = playlist.split('\n').filter(line => line.endsWith('.ts'));
            expect(playlist.startsWith('#EXTM3U')).toBe(true);
            expect(segments.length).toBeGreaterThan(0);
            const firstSegment = await readFile(join(streamRoot, segments[0]));
            expect(firstSegment[0]).toBe(0x47);
            expect(firstSegment.length % 188).toBe(0);

            // 送った data を ffmpeg が読み切ってから止める。
            await vi.waitFor(
                () => {
                    const stdin = (model as { streamProcess: { stdin: { writableLength: number } } | null })
                        .streamProcess?.stdin;
                    expect(tuner.readableLength).toBe(0);
                    expect(stdin?.writableLength).toBe(0);
                },
                { timeout: 30_000, interval: 100 },
            );
            await manager.stop(streamId);
            expect(manager.getStreamInfos()).toEqual([]);
            await vi.waitFor(async () => expect(await readdir(streamRoot)).toEqual([]), { timeout: 10_000 });
        } finally {
            await manager.stopAll();
            tuner.destroy();
            await rm(root, { force: true, recursive: true });
        }
    }, 120_000);
});
