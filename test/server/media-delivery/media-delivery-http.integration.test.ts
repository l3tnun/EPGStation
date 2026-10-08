import { once } from 'node:events';
import { createReadStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import {
    createServer,
    get as httpGet,
    type ClientRequest,
    type IncomingMessage,
    type Server,
    type ServerResponse,
} from 'node:http';
import { createRequire } from 'node:module';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, deferred, fakeChild, fakeIdAllocator, fakeStream, logger } from './_media-harness';

const container = compiled<any>('model', 'ModelContainer.js').default;
const kodiRoute = compiled<any>('model', 'service', 'api', 'videos', '{videoFileId}', 'kodi.js');
const ExecutionManagementModel = compiled<any>('model', 'ExecutionManagementModel.js').default;
const EncodeProcessManageModel = compiled<any>('model', 'service', 'encode', 'EncodeProcessManageModel.js').default;
const HLSFileDeleterModel = compiled<any>('model', 'service', 'stream', 'util', 'HLSFileDeleterModel.js').default;
const LiveStreamModel = compiled<any>('model', 'service', 'stream', 'LiveStreamModel.js').default;
const LoggerModel = compiled<any>('model', 'LoggerModel.js').default;
const RecordedDeliveryLeaseConsumer = compiled<any>(
    'model',
    'service',
    'stream',
    'recorded',
    'RecordedDeliveryLeaseConsumer.js',
).default;
const RecordedHLSStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedHLSStreamModel.js').default;
const RecordedStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedStreamModel.js').default;
const RecordedPlaybackSourceProvider = compiled<any>(
    'model',
    'operator',
    'recorded',
    'RecordedPlaybackSourceProvider.js',
).default;
const ServiceServer = compiled<any>('model', 'service', 'ServiceServer.js').default;
const StreamApiModel = compiled<any>('model', 'api', 'stream', 'StreamApiModel.js').default;
const StreamManageModel = compiled<any>('model', 'service', 'stream', 'manager', 'StreamManageModel.js').default;
const VideoApiModel = compiled<any>('model', 'api', 'video', 'VideoApiModel.js').default;
const VideoUtil = compiled<any>('model', 'api', 'video', 'VideoUtil.js').default;
const ApiUtil = compiled<any>('model', 'api', 'ApiUtil.js').default;
const require = createRequire(join(process.cwd(), 'package.json'));
const accessLogger = require('log4js').getLogger('synthetic-media-http');
accessLogger.level = 'off';
const originalServiceApiYml = ServiceServer.API_YML;
const originalServicePackageJson = ServiceServer.PACKAGE_JSON;
const realClearTimeout = clearTimeout;
const realSetTimeout = setTimeout;
const dirs: string[] = [];
const servers: Server[] = [];
const loopbackHost = '127.0.0.1';
const loopbackUrl = (port?: number): string =>
    ['http:', '', port === undefined ? loopbackHost : `${loopbackHost}:${port}`].join('/');

afterEach(async () => {
    if (container.isBound('IVideoApiModel')) container.unbind('IVideoApiModel');
    if (container.isBound('IStreamApiModel')) container.unbind('IStreamApiModel');
    ServiceServer.API_YML = originalServiceApiYml;
    ServiceServer.PACKAGE_JSON = originalServicePackageJson;
    vi.useRealTimers();
    for (const server of servers.splice(0)) {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
    for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

const response = () => {
    const res: any = {};
    res.status = vi.fn(() => res);
    res.header = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
};

const createServiceConfig = (root: string, overrides: Record<string, unknown> = {}) => ({
    ...baseConfig(),
    apiServers: [loopbackUrl()],
    isAllowAllCORS: false,
    recorded: [],
    recordedTmp: join(root, 'recorded-tmp'),
    streamFilePath: join(root, 'stream-files'),
    thumbnail: join(root, 'thumbnails'),
    uploadTempDir: join(root, 'uploads'),
    ...overrides,
});

const startLocalService = async (config: Record<string, unknown>): Promise<string> => {
    ServiceServer.API_YML = join(process.cwd(), 'api.yml');
    ServiceServer.PACKAGE_JSON = join(process.cwd(), 'package.json');
    const logs = logger();
    const service = new ServiceServer(
        { getLogger: () => ({ ...logs, access: accessLogger }) },
        { getConfig: () => config },
        { initialize: vi.fn() },
    );
    const server = createServer(service.app);
    servers.push(server);
    server.listen(0, loopbackHost);
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('SyntheticServerAddressIsUnavailable');
    return loopbackUrl(address.port);
};

const startKodiServer = async (
    handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ sockets: Set<Socket>; url: string }> => {
    const sockets = new Set<Socket>();
    const server = createServer(handler);
    server.on('connection', socket => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
    });
    servers.push(server);
    server.listen(0, loopbackHost);
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('SyntheticKodiServerAddressIsUnavailable');
    return { sockets, url: loopbackUrl(address.port) };
};

const getBuffer = (
    url: string,
    headers: Record<string, string> = {},
): Promise<{ body: Buffer; headers: IncomingMessage['headers']; status: number }> => {
    return new Promise((resolve, reject) => {
        const request = httpGet(url, { headers }, res => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.once('end', () =>
                resolve({ body: Buffer.concat(chunks), headers: res.headers, status: res.statusCode ?? 0 }),
            );
            res.once('error', reject);
        });
        request.once('error', reject);
    });
};

const awaitActualKodiBoundary = async <T>(operation: Promise<T>, failure: string): Promise<T> => {
    let guard!: NodeJS.Timeout;
    try {
        return await Promise.race([
            operation,
            new Promise<never>((_resolve, reject) => {
                guard = realSetTimeout(() => reject(new Error(failure)), 1_000);
            }),
        ]);
    } finally {
        realClearTimeout(guard);
    }
};

const awaitActualHttpBoundary = awaitActualKodiBoundary;

describe('media HTTP boundary', () => {
    it('[MD-2.1][MD-2.2] serves source and encoded play/download through the registered HTTP and actual video models', async () => {
        const root = mkdtempSync(join(tmpdir(), 'epg-media-video-http-'));
        dirs.push(root);
        const sourceDir = join(root, 'source-root');
        const encodedDir = join(root, 'encoded-root');
        mkdirSync(sourceDir);
        mkdirSync(encodedDir);
        const source = Buffer.alloc(1024 * 1024, 's');
        const encoded = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex');
        writeFileSync(join(sourceDir, 'source.ts'), source);
        writeFileSync(join(encodedDir, 'encoded.mp4'), encoded);
        const rows = new Map([
            [31, { filePath: 'source.ts', id: 31, parentDirectoryName: 'source', recordedId: 301, type: 'ts' }],
            [
                32,
                {
                    filePath: 'encoded.mp4',
                    id: 32,
                    parentDirectoryName: 'encoded',
                    recordedId: 302,
                    type: 'encoded',
                },
            ],
        ]);
        const videoFileDB = { findId: vi.fn(async (id: number) => rows.get(id) ?? null) };
        const recordedDB = {
            findId: vi.fn(async (id: number) => ({ duration: 10_000, id, name: `recorded-${id.toString(10)}` })),
        };
        const config = createServiceConfig(root, {
            recorded: [
                { name: 'source', path: sourceDir },
                { name: 'encoded', path: encodedDir },
            ],
        });
        const configuration = { getConfig: () => config };
        const videoUtil = new VideoUtil(configuration, videoFileDB);
        const pathSelection = vi.spyOn(videoUtil, 'getFullFilePathFromId');
        const leaseReleases: ReturnType<typeof vi.fn>[] = [];
        const sourceReaderCloses: ReturnType<typeof vi.fn>[] = [];
        const directProvider = {
            open: vi.fn(async (videoFileId: number, recordedId: number, playPosition: number) => {
                const row = rows.get(videoFileId)!;
                const playbackSource =
                    row.type === 'encoded'
                        ? {
                              inputPath: join(encodedDir, row.filePath),
                              kind: 'encoded-direct' as const,
                              playPosition,
                              recordedId,
                              videoFileId,
                              videoInfo: { bitRate: 8, duration: 10, size: encoded.length },
                          }
                        : (() => {
                              const close = vi.fn(async () => undefined);
                              sourceReaderCloses.push(close);
                              return {
                                  inputPath: join(sourceDir, row.filePath),
                                  kind: 'completed-file-reader' as const,
                                  playPosition,
                                  reader: { close, readable: createReadStream(join(sourceDir, row.filePath)) },
                                  recordedId,
                                  videoFileId,
                                  videoInfo: { bitRate: 8, duration: 10, size: source.length },
                              };
                          })();
                return {
                    adopt: () => ({ source: playbackSource, status: 'adopted' as const }),
                    disposeBeforeAdoption: vi.fn(async () => undefined),
                    state: 'pending' as const,
                };
            }),
            resolveRecordedId: vi.fn(async (videoFileId: number) => {
                const row = rows.get(videoFileId);
                if (row === undefined) throw new Error('RecordedPlaybackVideoFileNotFound');
                return row.recordedId;
            }),
        };
        const directDelivery = new RecordedDeliveryLeaseConsumer(directProvider, {
            acquire: vi.fn(async () => {
                const release = vi.fn(async () => undefined);
                leaseReleases.push(release);
                return { release };
            }),
        });
        const directManager = new StreamManageModel(
            { getLogger: logger },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { notifyClient: vi.fn() },
            undefined,
            directDelivery,
        );
        const videoApi = new VideoApiModel(
            configuration,
            videoFileDB,
            recordedDB,
            new ApiUtil(configuration),
            videoUtil,
            {},
            directManager,
        );
        container.bind('IVideoApiModel').toConstantValue(videoApi);
        const baseUrl = await startLocalService(config);

        const cases = [
            { body: source, download: false, id: 31, mime: 'video/mp2t', name: 'source.ts' },
            { body: source, download: true, id: 31, mime: 'application/octet-stream', name: 'source.ts' },
            { body: encoded, download: false, id: 32, mime: 'video/mp4', name: 'encoded.mp4' },
            { body: encoded, download: true, id: 32, mime: 'application/octet-stream', name: 'encoded.mp4' },
        ];
        for (const fixture of cases) {
            const result = await getBuffer(
                `${baseUrl}/api/videos/${fixture.id}${fixture.download ? '?isDownload=true' : ''}`,
            );
            expect(result.status, result.body.toString()).toBe(200);
            expect(result.body).toEqual(fixture.body);
            expect(result.headers['content-type']).toBe(fixture.mime);
            if (fixture.download) expect(result.headers['content-disposition']).toContain(fixture.name);
            else expect(result.headers).not.toHaveProperty('content-disposition');
        }
        const range = await getBuffer(`${baseUrl}/api/videos/31`, { Range: 'bytes=0-2' });
        expect(range.status).toBe(206);
        expect(range.body).toEqual(source.subarray(0, 3));
        await vi.waitFor(() => {
            expect(leaseReleases).toHaveLength(5);
            expect(sourceReaderCloses).toHaveLength(3);
            for (const close of sourceReaderCloses) expect(close).toHaveBeenCalledOnce();
        });
        const missing = await getBuffer(`${baseUrl}/api/videos/404`);
        expect(missing.status).toBe(404);
        expect(missing.body).toEqual(Buffer.from('{"code":404,"message":"video file is not found"}'));
        const playlist = await getBuffer(`${baseUrl}/api/videos/31/playlist`);
        expect(playlist.status).toBe(200);
        expect(playlist.body.toString()).toContain(`${baseUrl}/api/videos/31`);
        const abortedBeforeComplete = await new Promise<boolean>((resolve, reject) => {
            let request!: ClientRequest;
            request = httpGet(`${baseUrl}/api/videos/31`, response => {
                response.once('data', () => {
                    const complete = response.complete;
                    response.destroy();
                    request.destroy();
                    resolve(complete);
                });
                response.once('error', reject);
            });
            request.once('error', error => {
                if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
            });
        });
        expect(abortedBeforeComplete).toBe(false);
        expect(pathSelection).not.toHaveBeenCalled();
        expect(directProvider.resolveRecordedId.mock.calls).toEqual([[31], [31], [32], [32], [31], [404], [31]]);
        expect(directProvider.open.mock.calls).toEqual([
            [31, 301, 0, { allowMissingVideoInfo: true }],
            [31, 301, 0, { allowMissingVideoInfo: true }],
            [32, 302, 0, { allowMissingVideoInfo: true }],
            [32, 302, 0, { allowMissingVideoInfo: true }],
            [31, 301, 0, { allowMissingVideoInfo: true }],
            [31, 301, 0, { allowMissingVideoInfo: true }],
        ]);
        await vi.waitFor(() => expect(leaseReleases).toHaveLength(6));
        await vi.waitFor(() => {
            for (const release of leaseReleases) expect(release).toHaveBeenCalledOnce();
            expect(sourceReaderCloses).toHaveLength(4);
            for (const close of sourceReaderCloses) expect(close).toHaveBeenCalledOnce();
        });
        // This real
        // HTTP + real video-model case exceeded the default 5000ms testTimeout under contention at
        // every measured worker cap (no cap, 12 workers, 8 workers), while running in ~2966ms in isolation --
        // a budget miscalibration for one named heavyweight case, not flakiness. Assertions/oracle are
        // unchanged; only this test's own timeout is raised.
    }, 60_000);

    it('[MD-2.1][MD-2.2][MD-2.4] pipes the provider-owned recording reader through public HTTP growth/truncation while preserving range responses', async () => {
        const root = mkdtempSync(join(tmpdir(), 'epg-media-provider-reader-http-'));
        dirs.push(root);
        const inputPath = join(root, 'recording.ts');
        writeFileSync(inputPath, 'before-truncate');
        const config = createServiceConfig(root);
        const videoFileDB = {
            findId: vi.fn(async () => ({ id: 31, recordedId: 301, type: 'ts' })),
        };
        const recordedDB = {
            findId: vi.fn(async () => ({
                duration: 10_000,
                id: 301,
                isRecording: true,
                name: 'provider-reader-recording',
            })),
        };
        const playbackProvider = new RecordedPlaybackSourceProvider(videoFileDB, recordedDB, {
            getFullFilePathFromVideoFile: vi.fn(() => inputPath),
            getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 480 })),
        });
        const releases: ReturnType<typeof vi.fn>[] = [];
        const deliveryConsumer = new RecordedDeliveryLeaseConsumer(playbackProvider, {
            acquire: vi.fn(async () => {
                const release = vi.fn(async () => undefined);
                releases.push(release);
                return { release };
            }),
        });
        const manager = new StreamManageModel(
            { getLogger: logger },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { notifyClient: vi.fn() },
            undefined,
            deliveryConsumer,
        );
        const videoApi = new VideoApiModel(
            { getConfig: () => config },
            videoFileDB,
            recordedDB,
            new ApiUtil({ getConfig: () => config }),
            {
                getFullFilePathFromId: vi.fn(() => {
                    throw new Error('DirectPathFallback');
                }),
            },
            {},
            manager,
        );
        container.bind('IVideoApiModel').toConstantValue(videoApi);
        const baseUrl = await startLocalService(config);
        const body = await new Promise<Buffer>((resolve, reject) => {
            const request = httpGet(`${baseUrl}/api/videos/31`, response => {
                const chunks: Buffer[] = [];
                response.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                    if (Buffer.concat(chunks).toString() === 'before-truncate') {
                        writeFileSync(inputPath, 'after');
                    }
                });
                response.once('end', () => resolve(Buffer.concat(chunks)));
                response.once('error', reject);
            });
            request.once('error', reject);
        });

        expect(body.toString()).toBe('before-truncateafter');
        const range = await getBuffer(`${baseUrl}/api/videos/31`, { Range: 'bytes=0-2' });
        expect(range.status).toBe(206);
        expect(range.body.toString()).toBe('aft');
        await vi.waitFor(() => {
            expect(releases).toHaveLength(2);
            for (const release of releases) expect(release).toHaveBeenCalledOnce();
        });
    });

    it('[MD-2.2] serves a recording whose video info cannot be read, and reports an unknown format only as MimeTypeError', async () => {
        const root = mkdtempSync(join(tmpdir(), 'epg-media-video-info-failure-'));
        dirs.push(root);
        const tsPath = join(root, 'broken.ts');
        const unknownPath = join(root, 'unknown.xyz');
        writeFileSync(tsPath, 'broken-but-deliverable');
        writeFileSync(unknownPath, Buffer.alloc(5000, 1));
        const config = createServiceConfig(root);
        const paths: Record<number, string> = { 31: tsPath, 32: unknownPath };
        const videoFileDB = {
            findId: vi.fn(async (id: number) => ({ id, recordedId: 300 + id, type: 'ts' })),
        };
        const recordedDB = {
            findId: vi.fn(async (id: number) => ({
                duration: 10_000,
                id,
                isRecording: false,
                name: 'video-info-failure',
            })),
        };
        const getInfo = vi.fn(async (path: string) => {
            throw new Error(`Command failed: /usr/bin/ffprobe -v 0 -show_format -of json ${path}`);
        });
        const playbackProvider = new RecordedPlaybackSourceProvider(videoFileDB, recordedDB, {
            getFullFilePathFromVideoFile: vi.fn((videoFile: { id: number }) => paths[videoFile.id]),
            getInfo,
        });
        const releases: ReturnType<typeof vi.fn>[] = [];
        const deliveryConsumer = new RecordedDeliveryLeaseConsumer(playbackProvider, {
            acquire: vi.fn(async () => {
                const release = vi.fn(async () => undefined);
                releases.push(release);
                return { release };
            }),
        });
        const manager = new StreamManageModel(
            { getLogger: logger },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { notifyClient: vi.fn() },
            undefined,
            deliveryConsumer,
        );
        const videoApi = new VideoApiModel(
            { getConfig: () => config },
            videoFileDB,
            recordedDB,
            new ApiUtil({ getConfig: () => config }),
            {
                getFullFilePathFromId: vi.fn(() => {
                    throw new Error('DirectPathFallback');
                }),
            },
            {},
            manager,
        );
        container.bind('IVideoApiModel').toConstantValue(videoApi);
        const baseUrl = await startLocalService(config);

        const served = await getBuffer(`${baseUrl}/api/videos/31`);
        expect(served.status).toBe(200);
        expect(served.body.toString()).toBe('broken-but-deliverable');

        const unknown = await getBuffer(`${baseUrl}/api/videos/32`);
        expect(unknown.status).toBe(500);
        expect(JSON.parse(unknown.body.toString())).toMatchObject({ errors: 'MimeTypeError' });
        expect(unknown.body.toString()).not.toContain('ffprobe');
        expect(unknown.body.toString()).not.toContain(root);

        await vi.waitFor(() => {
            expect(releases).toHaveLength(2);
            for (const release of releases) expect(release).toHaveBeenCalledOnce();
        });
    });

    it('[MD-2.2][MD-6.2] exact-closes and releases a provider reader when response-file creation fails after delivery acquisition', async () => {
        const root = mkdtempSync(join(tmpdir(), 'epg-media-provider-reader-failure-'));
        dirs.push(root);
        const inputPath = join(root, 'vanishing.ts');
        writeFileSync(inputPath, 'will vanish before response');
        const config = createServiceConfig(root);
        const reader = { close: vi.fn(async () => undefined), readable: new PassThrough() };
        const release = vi.fn(async () => undefined);
        const deliveryConsumer = {
            acquireAndOpen: vi.fn(async () => ({
                release,
                source: {
                    inputPath,
                    kind: 'completed-file-reader' as const,
                    playPosition: 0,
                    reader,
                    recordedId: 301,
                    videoFileId: 31,
                    videoInfo: { bitRate: 8, duration: 60, size: 480 },
                },
            })),
        };
        const manager = new StreamManageModel(
            { getLogger: logger },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { notifyClient: vi.fn() },
            undefined,
            deliveryConsumer,
        );
        const videoApi = new VideoApiModel(
            { getConfig: () => config },
            {},
            {},
            new ApiUtil({ getConfig: () => config }),
            {},
            {},
            manager,
        );
        vi.spyOn(videoApi, 'createMime').mockImplementation(async () => {
            rmSync(inputPath);
            return 'video/mp2t';
        });
        container.bind('IVideoApiModel').toConstantValue(videoApi);
        const baseUrl = await startLocalService(config);

        const result = await getBuffer(`${baseUrl}/api/videos/31`);

        expect(result.status).toBe(500);
        expect(reader.close).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledOnce();
    });

    it('[MD-1.1][MD-1.3][MD-1.9] keeps the actual managed live HTTP body open beyond the startup horizon', async () => {
        vi.useFakeTimers();
        const root = mkdtempSync(join(tmpdir(), 'epg-media-live-http-'));
        dirs.push(root);
        const config = createServiceConfig(root);
        const configuration = { getConfig: () => config };
        const logs = { getLogger: logger };
        const socket = { notifyClient: vi.fn() };
        const tuner = new PassThrough();
        let tunerRequested!: () => void;
        const requested = new Promise<void>(resolve => {
            tunerRequested = resolve;
        });
        const tunerServerAccess = {
            openServiceStream: vi.fn(async () => {
                tunerRequested();
                return { stream: tuner, close: () => tuner.destroy() };
            }),
        };
        const stream = new LiveStreamModel(
            configuration,
            logs,
            { create: vi.fn() },
            { deleteAllFiles: vi.fn(), setOption: vi.fn() },
            tunerServerAccess,
            socket,
        );
        let stopped!: () => void;
        const stoppedResult = new Promise<void>(resolve => {
            stopped = resolve;
        });
        const actualStop = stream.stop.bind(stream);
        const stop = vi.spyOn(stream, 'stop').mockImplementation(async () => {
            await actualStop();
            stopped();
        });
        const execution = new ExecutionManagementModel(logs);
        const manager = new StreamManageModel(logs, execution, socket);
        const streamApi = new StreamApiModel(
            configuration,
            async () => stream,
            async () => {
                throw new Error('UnexpectedHlsProvider');
            },
            async () => {
                throw new Error('UnexpectedRecordedProvider');
            },
            async () => {
                throw new Error('UnexpectedRecordedHlsProvider');
            },
            manager,
            {},
            {},
            {},
            {},
            {},
        );
        container.bind('IStreamApiModel').toConstantValue(streamApi);
        const baseUrl = await startLocalService(config);
        const responsePromise = new Promise<{ request: ClientRequest; response: IncomingMessage }>(
            (resolve, reject) => {
                let request!: ClientRequest;
                request = httpGet(`${baseUrl}/api/streams/live/101/m2ts?mode=0`, response =>
                    resolve({ request, response }),
                );
                request.once('error', reject);
            },
        );
        await awaitActualHttpBoundary(requested, 'SyntheticLiveTunerWasNotRequested');
        tuner.write('before-horizon');
        const { request, response: liveResponse } = await awaitActualHttpBoundary(
            responsePromise,
            'SyntheticLiveResponseWasNotStarted',
        );
        let body = '';
        liveResponse.on('data', (chunk: Buffer) => {
            body += chunk.toString();
        });
        await awaitActualHttpBoundary(
            new Promise<void>(resolve => {
                if (body.includes('before-horizon')) resolve();
                else liveResponse.once('data', () => resolve());
            }),
            'SyntheticLiveBodyWasNotDelivered',
        );

        await vi.advanceTimersByTimeAsync(60_000);
        expect(liveResponse.destroyed).toBe(false);
        expect(tuner.destroyed).toBe(false);
        const appended = new Promise<void>(resolve => liveResponse.once('data', () => resolve()));
        tuner.write('|after-horizon');
        await appended;
        expect(body).toBe('before-horizon|after-horizon');
        expect(manager.getStreamInfos()).toHaveLength(1);

        const notificationsBeforeClose = socket.notifyClient.mock.calls.length;
        liveResponse.destroy();
        request.destroy();
        await awaitActualHttpBoundary(stoppedResult, 'SyntheticLiveStopWasNotObserved');
        expect(stop).toHaveBeenCalledOnce();
        await vi.waitFor(() => {
            expect(socket.notifyClient).toHaveBeenCalledTimes(notificationsBeforeClose + 2);
            expect(manager.getStreamInfos()).toEqual([]);
        });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-2.3][MD-4.5][MD-6.2] serves and client-stops public recorded WebM and MP4 bodies through the manager-owned provider lease', async () => {
        const root = mkdtempSync(join(tmpdir(), 'epg-media-recorded-direct-http-'));
        dirs.push(root);
        const inputPath = join(root, 'recorded.mp4');
        writeFileSync(inputPath, 'recorded-input');
        const config = createServiceConfig(root);
        const releases: ReturnType<typeof vi.fn>[] = [];
        const deliveryConsumer = new RecordedDeliveryLeaseConsumer(
            {
                open: vi.fn(async (videoFileId: number, recordedId: number, playPosition: number) => ({
                    adopt: () => ({
                        source: {
                            inputPath,
                            kind: 'encoded-direct' as const,
                            playPosition,
                            recordedId,
                            videoFileId,
                            videoInfo: { bitRate: 8, duration: 60, size: 480 },
                        },
                        status: 'adopted' as const,
                    }),
                    disposeBeforeAdoption: vi.fn(async () => undefined),
                    state: 'pending' as const,
                })),
                resolveRecordedId: vi.fn(async () => 41),
            },
            {
                acquire: vi.fn(async () => {
                    const release = vi.fn(async () => undefined);
                    releases.push(release);
                    return { release };
                }),
            },
        );
        const logs = { getLogger: logger };
        const manager = new StreamManageModel(
            logs,
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { notifyClient: vi.fn() },
            undefined,
            deliveryConsumer,
        );
        const children: any[] = [];
        const requestStop = vi.fn(async () => ({ sentSignals: ['SIGINT'], status: 'requested' }));
        const streamProvider = async () => {
            const child = fakeChild();
            children.push(child);
            return new RecordedStreamModel(
                { getConfig: () => config },
                logs,
                { createManaged: vi.fn(async () => ({ child, handle: Object.freeze({ child }) })), requestStop },
                { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
                { notifyClient: vi.fn() },
                {
                    findId: vi.fn(() => {
                        throw new Error('RecordedStreamDbFallback');
                    }),
                },
                {
                    findId: vi.fn(() => {
                        throw new Error('RecordedStreamRecordedFallback');
                    }),
                },
                {
                    getFullFilePathFromId: vi.fn(() => {
                        throw new Error('RecordedStreamPathFallback');
                    }),
                },
            );
        };
        const streamApi = new StreamApiModel(
            { getConfig: () => config },
            async () => fakeStream(),
            async () => fakeStream(),
            streamProvider,
            async () => fakeStream(),
            manager,
            {},
            {},
            {},
            {},
            {},
        );
        container.bind('IStreamApiModel').toConstantValue(streamApi);
        const baseUrl = await startLocalService(config);

        for (const type of ['webm', 'mp4'] as const) {
            const index = children.length;
            const body = `${type}-body`;
            const delivered = new Promise<void>((resolve, reject) => {
                let request!: ClientRequest;
                request = httpGet(`${baseUrl}/api/streams/recorded/31/${type}?ss=4&mode=0`, response => {
                    expect(response.statusCode).toBe(200);
                    expect(response.headers['content-type']).toBe(`video/${type}`);
                    response.once('data', (chunk: Buffer) => {
                        expect(chunk.toString()).toBe(body);
                        response.destroy();
                        request.destroy();
                        resolve();
                    });
                    response.once('error', reject);
                });
                request.once('error', error => {
                    if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
                });
            });
            await vi.waitFor(() => expect(children).toHaveLength(index + 1));
            children[index].stdout.write(body);
            await delivered;
        }

        await vi.waitFor(() => {
            expect(requestStop).toHaveBeenCalledTimes(2);
            expect(manager.getStreamInfos()).toEqual([]);
            expect(releases).toHaveLength(2);
        });
        for (const release of releases) expect(release).not.toHaveBeenCalled();

        for (const child of children) child.emit('exit', 0);
        await vi.waitFor(() => {
            for (const release of releases) expect(release).toHaveBeenCalledOnce();
        });
    });

    it('[MD-6.1][MD-6.3] forwards request host/protocol and maps success/failure status', async () => {
        const sendToKodi = vi.fn(async () => undefined);
        container.bind('IVideoApiModel').toConstantValue({ sendToKodi });
        const req: any = {
            body: { kodiName: 'room' },
            header: (name: string) => (name.toLowerCase() === 'x-forwarded-proto' ? 'https' : undefined),
            headers: { host: 'request.invalid:8888' },
            params: { videoFileId: '31' },
            protocol: 'http',
        };
        const ok = response();
        await kodiRoute.post(req, ok);
        expect(sendToKodi).toHaveBeenCalledWith('request.invalid:8888', true, 'room', 31);
        expect(ok.status).toHaveBeenCalledWith(200);

        sendToKodi.mockRejectedValueOnce(new Error('KodiOffline'));
        const failed = response();
        await kodiRoute.post(req, failed);
        expect(failed.status).toHaveBeenCalledWith(500);
        expect(failed.json).toHaveBeenCalledWith({
            code: 500,
            errors: 'KodiOffline',
            message: 'Internal Server Error',
        });
    });

    it('[MD-7.5][MD-7.6] projects a Kodi deadline failure through the HTTP route once', async () => {
        const deadlineError = new Error('KodiRequestDeadlineExceeded');
        const sendToKodi = vi.fn(async () => Promise.reject(deadlineError));
        container.bind('IVideoApiModel').toConstantValue({ sendToKodi });
        const req: any = {
            body: { kodiName: 'room' },
            header: (name: string) => (name.toLowerCase() === 'x-forwarded-proto' ? 'https' : undefined),
            headers: { host: 'request.invalid:8888' },
            params: { videoFileId: '31' },
            protocol: 'http',
        };
        const failed = response();

        await kodiRoute.post(req, failed);

        expect(sendToKodi).toHaveBeenCalledTimes(1);
        expect(sendToKodi).toHaveBeenCalledWith('request.invalid:8888', true, 'room', 31);
        expect(failed.status).toHaveBeenCalledWith(500);
        expect(failed.json).toHaveBeenCalledWith({
            code: 500,
            errors: 'KodiRequestDeadlineExceeded',
            message: 'Internal Server Error',
        });
    });

    it('[MD-7.5] waits for the actual Kodi HTTP adapter to finish parsing its response body', async () => {
        const requestReceived = deferred<void>();
        let finishResponse!: () => void;
        let requestBody = '';
        let requestHeaders: IncomingMessage['headers'] = {};
        const kodi = await startKodiServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on('data', (chunk: Buffer) => chunks.push(chunk));
            request.once('end', () => {
                requestBody = Buffer.concat(chunks).toString();
                requestHeaders = request.headers;
                response.setHeader('content-type', 'application/json');
                response.write('{"jsonrpc":"2.0","result":');
                finishResponse = () => response.end('"OK","id":1}');
                requestReceived.resolve();
            });
        });
        const apiUtil = new ApiUtil({ getConfig: () => ({}) });
        const pending = apiUtil.sendToKodi('https://request.invalid/video', {
            host: `${kodi.url}/base`,
            name: 'living-room',
            password: 'synthetic-password',
            user: 'synthetic-user',
        });
        let settled = false;
        void pending.then(
            () => {
                settled = true;
            },
            () => {
                settled = true;
            },
        );

        await awaitActualKodiBoundary(requestReceived.promise, 'SyntheticKodiRequestWasNotReceived');
        await Promise.resolve();

        expect(settled).toBe(false);
        expect(requestHeaders.authorization?.startsWith('Basic ')).toBe(true);
        expect(JSON.parse(requestBody)).toEqual({
            id: 1,
            jsonrpc: '2.0',
            method: 'Player.Open',
            params: { item: { file: 'https://request.invalid/video' } },
        });

        finishResponse();
        await expect(pending).resolves.toBeUndefined();
        expect(kodi.sockets.size).toBe(1);
    });

    it('[MD-7.5][MD-7.6] aborts the actual Kodi HTTP adapter connection when the deadline wins', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const responseStarted = deferred<void>();
        const responseClosed = deferred<void>();
        const kodi = await startKodiServer((_request, response) => {
            response.setHeader('content-type', 'application/json');
            response.write('{"jsonrpc":"2.0","result":');
            response.once('close', () => responseClosed.resolve());
            responseStarted.resolve();
        });
        const apiUtil = new ApiUtil({ getConfig: () => ({}) });
        const terminal = apiUtil
            .sendToKodi('https://request.invalid/video', { host: kodi.url, name: 'living-room' })
            .then(
                () => undefined,
                error => error,
            );

        await awaitActualKodiBoundary(responseStarted.promise, 'SyntheticKodiResponseWasNotStarted');
        expect(kodi.sockets.size).toBe(1);
        await vi.advanceTimersByTimeAsync(30_000);

        await expect(terminal).resolves.toMatchObject({ message: 'KodiRequestDeadlineExceeded' });
        await awaitActualKodiBoundary(responseClosed.promise, 'SyntheticKodiResponseWasNotAborted');
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(kodi.sockets.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-4.8] exposes stream artifacts at the configured public route', () => {
        const server = Object.create(ServiceServer.prototype) as any;
        server.app = { use: vi.fn() };
        server.config = {
            streamFilePath: join(tmpdir(), 'epgstation-stream-root'),
            thumbnail: join(tmpdir(), 'epgstation-thumbnail-root'),
        };
        server.createUrl = (value: string) => `/subdir${value}`;
        server.setStaticFiles();
        expect(server.app.use.mock.calls.some((call: unknown[]) => call[0] === '/subdir/streamfiles')).toBe(true);
    });

    it('[MD-1.7][MD-3.8][MD-3.9] serves the external-player playlist and stable HLS parent path through the actual carrier', async () => {
        const root = mkdtempSync(join(tmpdir(), 'epg-media-public-path-http-'));
        dirs.push(root);
        const config = createServiceConfig(root);
        mkdirSync(config.streamFilePath);
        const parentPlaylist = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nstream17-child.m3u8';
        writeFileSync(join(config.streamFilePath, 'stream17.m3u8'), parentPlaylist);
        const configuration = { getConfig: () => config };
        const streamApi = new StreamApiModel(
            configuration,
            async () => fakeStream(),
            async () => fakeStream(),
            async () => fakeStream(),
            async () => fakeStream(),
            {},
            {},
            {},
            {},
            { findId: vi.fn(async () => ({ name: 'synthetic-channel' })) },
            new ApiUtil(configuration),
        );
        container.bind('IStreamApiModel').toConstantValue(streamApi);
        const baseUrl = await startLocalService(config);

        const externalPlayer = await getBuffer(`${baseUrl}/api/streams/live/101/m2ts/playlist?mode=2`);
        expect(externalPlayer.status).toBe(200);
        expect(externalPlayer.body.toString()).toContain(`${baseUrl}/api/streams/live/101/m2ts?mode=2`);
        expect(externalPlayer.body.toString()).not.toMatch(/credential|generation|token|@/u);

        const hls = await getBuffer(`${baseUrl}/streamfiles/stream17.m3u8`);
        expect(hls.status).toBe(200);
        expect(hls.body.toString()).toBe(parentPlaylist);
        expect(hls.headers).not.toHaveProperty('www-authenticate');
        expect('./streamfiles/stream17.m3u8').not.toMatch(/credential|generation|token|@/u);
    });

    it('[MD-2.3][MD-3.8][MD-3.9][MD-4.7] connects public recorded HLS through the provider, writer, stable carrier, cleanup, and exact lease release', async () => {
        const root = mkdtempSync(join(tmpdir(), 'epg-media-recorded-hls-public-'));
        dirs.push(root);
        const inputPath = join(root, 'recorded.mp4');
        const writerPath = join(root, 'write-recorded-hls.cjs');
        writeFileSync(inputPath, 'recorded-source');
        writeFileSync(
            writerPath,
            [
                "const fs = require('node:fs');",
                "const path = require('node:path');",
                'const root = process.argv[2];',
                'const streamId = process.argv[3];',
                "fs.writeFileSync(path.join(root, `stream${streamId}.m3u8`), '#EXTM3U');",
                "fs.writeFileSync(path.join(root, `stream${streamId}-0.ts`), 'recorded-segment');",
                "fs.writeFileSync(path.join(root, `stream${streamId}-1.ts`), 'recorded-segment');",
                "process.on('SIGINT', () => process.exit(0));",
                'process.stdin.resume();',
                'setInterval(() => undefined, 1000);',
            ].join('\n'),
        );
        const config = createServiceConfig(root);
        mkdirSync(config.streamFilePath);
        config.stream.recorded.encoded.hls = [{ cmd: `%NODE% ${writerPath} %streamFileDir% %streamNum% %INPUT% %SS%` }];
        const actualLogger = new LoggerModel();
        actualLogger.initialize();
        for (const category of Object.values(actualLogger.getLogger()) as any[]) category.level = 'off';
        const logs = { getLogger: () => actualLogger.getLogger() };
        const hlsFileDeleter = new HLSFileDeleterModel(logs);
        const processManager = new EncodeProcessManageModel(logs, { getConfig: () => ({ encodeProcessNum: 1 }) });
        const stopHls = vi.spyOn(processManager, 'stopHls');
        const sourceVideoFileDB = { findId: vi.fn(async () => ({ id: 31, recordedId: 41, type: 'encoded' })) };
        const sourceRecordedDB = { findId: vi.fn(async () => ({ id: 41, isRecording: false })) };
        const sourceVideoUtil = {
            getFullFilePathFromVideoFile: vi.fn(() => inputPath),
            getInfo: vi.fn(async () => ({ bitRate: 8, duration: 10, size: 10 })),
        };
        const streamVideoFileDB = {
            findId: vi.fn(() => {
                throw new Error('RecordedStreamDbFallback');
            }),
        };
        const streamRecordedDB = {
            findId: vi.fn(() => {
                throw new Error('RecordedStreamRecordedFallback');
            }),
        };
        const streamVideoUtil = {
            getFullFilePathFromId: vi.fn(() => {
                throw new Error('RecordedStreamPathFallback');
            }),
        };
        const recordedHlsStream = new RecordedHLSStreamModel(
            { getConfig: () => config },
            logs,
            processManager,
            hlsFileDeleter,
            { notifyClient: vi.fn() },
            streamVideoFileDB,
            streamRecordedDB,
            streamVideoUtil,
        );
        const manager = new StreamManageModel(
            logs,
            new ExecutionManagementModel(logs),
            { notifyClient: vi.fn() },
            fakeIdAllocator(logs, { getConfig: () => config }, hlsFileDeleter),
        );
        const release = vi.fn(async () => undefined);
        const streamApi = new StreamApiModel(
            { getConfig: () => config },
            async () => fakeStream(),
            async () => fakeStream(),
            async () => fakeStream(),
            async () => recordedHlsStream,
            manager,
            {},
            sourceVideoFileDB,
            {},
            {},
            {},
            new RecordedDeliveryLeaseConsumer(
                new RecordedPlaybackSourceProvider(sourceVideoFileDB, sourceRecordedDB, sourceVideoUtil),
                { acquire: vi.fn(async () => ({ release })) },
            ),
        );
        container.bind('IStreamApiModel').toConstantValue(streamApi);
        const baseUrl = await startLocalService(config);

        try {
            const started = await getBuffer(`${baseUrl}/api/streams/recorded/31/hls?ss=4&mode=0`);
            expect(started.status).toBe(200);
            const { streamId } = JSON.parse(started.body.toString()) as { streamId: number };
            await vi.waitFor(async () => {
                const hls = await getBuffer(`${baseUrl}/streamfiles/stream${streamId}.m3u8`);
                expect(hls.status).toBe(200);
                expect(hls.body.toString()).toBe('#EXTM3U');
            });
            expect(sourceVideoFileDB.findId).toHaveBeenCalledTimes(2);
            expect(sourceRecordedDB.findId).toHaveBeenCalledOnce();
            expect(streamVideoFileDB.findId).not.toHaveBeenCalled();
            expect(streamRecordedDB.findId).not.toHaveBeenCalled();
            expect(streamVideoUtil.getFullFilePathFromId).not.toHaveBeenCalled();

            await streamApi.stop(streamId);

            expect(stopHls).toHaveBeenCalledOnce();
            expect(release).toHaveBeenCalledOnce();
            await vi.waitFor(async () => {
                const hls = await getBuffer(`${baseUrl}/streamfiles/stream${streamId}.m3u8`);
                expect(hls.status).toBe(404);
            });
        } finally {
            await manager.stopAll();
        }
    });
});
