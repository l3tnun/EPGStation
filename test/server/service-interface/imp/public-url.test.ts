import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compiled, modelContainer, require } from '../_harness';

const { isSecureProtocol } = require(compiled('model', 'service', 'api.js')) as {
    isSecureProtocol(request: unknown): boolean;
};
const ApiUtil = (require(compiled('model', 'api', 'ApiUtil.js')) as any).default;
const VideoApiModel = (require(compiled('model', 'api', 'video', 'VideoApiModel.js')) as any).default;

afterEach(() => vi.restoreAllMocks());

describe('Service Interface public URL construction [SI-1.3]', () => {
    it.each([
        ['http', undefined, false],
        ['https', undefined, true],
        ['http', 'https', true],
        ['http', 'HTTPS', false],
        ['https', 'http', true],
    ] as const)('protocol=%s forwarded=%s resolves secure=%s', (protocol, forwarded, expected) => {
        const request = {
            header: (name: string) => (name.toLowerCase() === 'x-forwarded-proto' ? forwarded : undefined),
            protocol,
        };
        expect(isSecureProtocol(request)).toBe(expected);
    });

    it.each([
        [undefined, 'receiver.invalid:8888', 'http://receiver.invalid:8888/api/videos/42'],
        ['/epg', 'receiver.invalid:8888', 'http://receiver.invalid:8888/epg/api/videos/42'],
        ['epg/nested', 'receiver.invalid', 'http://receiver.invalid/epg/nested/api/videos/42'],
    ] as const)('adds subDirectory=%s exactly once to generated playlists', (subDirectory, host, expectedUrl) => {
        const util = new ApiUtil({ getConfig: () => ({ subDirectory }) });
        const playlist = util.createM3U8PlayListStr({
            baseUrl: '/api/videos/42',
            duration: 60,
            host,
            isSecure: false,
            name: 'synthetic',
        });
        expect(playlist).toBe(`#EXTM3U\n#EXTINF: 60, synthetic\n${expectedUrl}`);
    });

    it.each([
        ['http', undefined, undefined, 'http://receiver.invalid/api/videos/42'],
        ['https', undefined, undefined, 'https://receiver.invalid/api/videos/42'],
        ['http', 'https', undefined, 'https://receiver.invalid/api/videos/42'],
        ['http', undefined, '/epg', 'http://receiver.invalid/epg/api/videos/42'],
        ['https', undefined, '/epg', 'https://receiver.invalid/epg/api/videos/42'],
        ['http', 'https', '/epg', 'https://receiver.invalid/epg/api/videos/42'],
    ] as const)(
        'combines protocol=%s forwarded=%s subDirectory=%s into %s',
        (protocol, forwarded, subDirectory, expectedUrl) => {
            const request = {
                header: (name: string) => (name.toLowerCase() === 'x-forwarded-proto' ? forwarded : undefined),
                protocol,
            };
            const util = new ApiUtil({ getConfig: () => ({ subDirectory }) });
            expect(
                util.createM3U8PlayListStr({
                    baseUrl: '/api/videos/42',
                    duration: 60,
                    host: 'receiver.invalid',
                    isSecure: isSecureProtocol(request),
                    name: 'synthetic',
                }),
            ).toContain(expectedUrl);
        },
    );

    it('sends Kodi the request Host, secure scheme, subdirectory once, and video endpoint', async () => {
        const sendToKodi = vi.fn().mockResolvedValue(undefined);
        const publicPathConfig: Record<string, unknown> = {};
        const publicBase = `/${'epg'}`;
        publicPathConfig.subDirectory = publicBase;
        const apiUtil = new ApiUtil({ getConfig: () => publicPathConfig });
        apiUtil.sendToKodi = sendToKodi;
        const model = new VideoApiModel(
            { getConfig: () => ({ kodiHosts: [{ host: 'http://kodi.invalid', name: 'living-room' }] }) },
            { findId: vi.fn().mockResolvedValue({ id: 42 }) },
            {},
            apiUtil,
            {},
            {},
        );

        await model.sendToKodi('receiver.invalid:8443', true, 'living-room', 42);

        expect(sendToKodi).toHaveBeenCalledOnce();
        expect(sendToKodi).toHaveBeenCalledWith(
            'https://receiver.invalid:8443/epg/api/videos/42',
            expect.objectContaining({ name: 'living-room' }),
        );
    });
});

describe('Service Interface HLS parent playlist locator [SI-1.1]', () => {
    it('passes the exact configured stream directory and stream{id}.m3u8 output to the encoder', () => {
        const LiveHLSStreamModel = (require(compiled('model', 'service', 'stream', 'LiveHLSStreamModel.js')) as any)
            .default;
        const streamFilePath = join(tmpdir(), 'synthetic-hls');
        const streamConfig: Record<string, unknown> = { ffmpeg: 'synthetic-ffmpeg' };
        streamConfig.streamFilePath = streamFilePath;
        const model = new LiveHLSStreamModel(
            { getConfig: () => streamConfig },
            { getLogger: () => ({ stream: { error: vi.fn(), fatal: vi.fn(), info: vi.fn() } }) },
            {},
            {},
            {},
            {},
        );
        model.setOption({ cmd: '%FFMPEG% -i - -o %streamFileDir%/stream%streamNum%.m3u8' }, 0);

        expect(model.createProcessOption(17)).toMatchObject({
            cmd: `synthetic-ffmpeg -i - -o ${streamFilePath}/stream17.m3u8`,
            output: `${streamFilePath}/stream17.m3u8`,
        });
    });
});

describe('Service Interface related-resource carrier delegation [SI-2.2/SI-2.3]', () => {
    it('passes multipart upload fields to the PM registration port without filesystem decisions', async () => {
        const dispatch = vi.fn(() => ({
            disposition: Promise.resolve({ completion: Promise.resolve(), kind: 'adopted' }),
        }));
        vi.spyOn(modelContainer, 'get').mockReturnValue({ uploadedVideoRegistrationPort: { dispatch } });
        const route = require(compiled('model', 'service', 'api', 'videos', 'upload.js')) as Record<string, Function>;
        const response = { header: vi.fn(), json: vi.fn(), status: vi.fn() };
        await route.post(
            {
                body: {
                    fileType: 'ts',
                    parentDirectoryName: 'primary',
                    recordedId: 12,
                    subDirectory: 'child',
                    viewName: 'synthetic-view',
                },
                file: { originalname: 'synthetic.ts', path: 'synthetic-upload-path' },
            },
            response,
        );
        expect(dispatch).toHaveBeenCalledExactlyOnceWith({
            fileName: 'synthetic.ts',
            filePath: 'synthetic-upload-path',
            fileType: 'ts',
            parentDirectoryName: 'primary',
            recordedId: 12,
            subDirectory: 'child',
            viewName: 'synthetic-view',
        });
        expect(response.status).toHaveBeenCalledWith(200);
    });

    it('passes live HLS path/query input to the stream owner and returns its resource id', async () => {
        const startLiveHLSStream = vi.fn().mockResolvedValue(81);
        vi.spyOn(modelContainer, 'get').mockReturnValue({ startLiveHLSStream });
        const route = require(
            compiled('model', 'service', 'api', 'streams', 'live', '{channelId}', 'hls.js'),
        ) as Record<string, Function>;
        const response = { header: vi.fn(), json: vi.fn(), status: vi.fn() };
        await route.get({ params: { channelId: '11' }, query: { mode: '2' } }, response);
        expect(startLiveHLSStream).toHaveBeenCalledWith({ channelId: 11, mode: 2 });
        expect(response.status).toHaveBeenCalledWith(200);
        expect(response.json).toHaveBeenCalledWith({ streamId: 81 });
    });

    it('passes encode body input and returns the owner queue id without queue decisions', async () => {
        const add = vi.fn().mockResolvedValue(91);
        vi.spyOn(modelContainer, 'get').mockReturnValue({ add });
        const route = require(compiled('model', 'service', 'api', 'encode.js')) as Record<string, Function>;
        const body = { mode: 'mobile', recordedId: 12 };
        const response = { header: vi.fn(), json: vi.fn(), status: vi.fn() };
        await route.post({ body }, response);
        expect(add).toHaveBeenCalledWith(body);
        expect(response.status).toHaveBeenCalledWith(201);
        expect(response.json).toHaveBeenCalledWith({ encodeId: 91 });
    });

    it('returns storage owner data without interpreting capacity', async () => {
        const storage = { available: 10, total: 100, used: 90 };
        const getInfo = vi.fn().mockResolvedValue(storage);
        vi.spyOn(modelContainer, 'get').mockReturnValue({ getInfo });
        const route = require(compiled('model', 'service', 'api', 'storages.js')) as Record<string, Function>;
        const response = { header: vi.fn(), json: vi.fn(), status: vi.fn() };
        await route.get({}, response);
        expect(getInfo).toHaveBeenCalledOnce();
        expect(response.status).toHaveBeenCalledWith(200);
        expect(response.json).toHaveBeenCalledWith(storage);
    });

    it('maps an owner failure to the existing error body without adding business decisions', async () => {
        vi.spyOn(modelContainer, 'get').mockReturnValue({
            startLiveHLSStream: vi.fn().mockRejectedValue(new Error('synthetic')),
        });
        const route = require(
            compiled('model', 'service', 'api', 'streams', 'live', '{channelId}', 'hls.js'),
        ) as Record<string, Function>;
        const response = { header: vi.fn(), json: vi.fn(), status: vi.fn() };
        await route.get({ params: { channelId: '11' }, query: { mode: '2' } }, response);
        expect(response.status).toHaveBeenCalledWith(500);
        expect(response.json).toHaveBeenCalledWith({
            code: 500,
            errors: 'synthetic',
            message: 'Internal Server Error',
        });
    });
});
