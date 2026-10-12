import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadModule, makeChannel, makeDeferred, makeModel, makeProgram, makeResponse } from '../../_harness';
import { registerCanonicalContracts } from './canonical-contract-case';
import { canonicalLifecycleCases } from './canonical-lifecycle-cases';

const container = () => loadModule<any>('model', 'ModelContainer.js').default;

afterEach(() => {
    vi.useRealTimers();
    for (const binding of ['IIPTVApiModel', 'IConfiguration']) {
        if (container().isBound(binding)) container().unbind(binding);
    }
});

describe('IPTV request-local reads', () => {
    it('[Task 1.2] performs fresh reads for every M3U8 and XMLTV request', async () => {
        const harness = makeModel({
            channelDB: { findAll: vi.fn(async () => [makeChannel()]) },
            programDB: { findSchedule: vi.fn(async () => [makeProgram()]) },
        });
        await harness.model.getChannelList('synthetic.invalid', false, 1, false);
        await harness.model.getChannelList('synthetic.invalid', false, 2, false);
        await harness.model.getEpg(1, false);
        await harness.model.getEpg(2, false);
        expect(harness.channelDB.findAll.mock.calls.map((call: any[]) => call[0])).toEqual([
            true,
            true,
            undefined,
            undefined,
        ]);
        expect(harness.programDB.findSchedule).toHaveBeenCalledTimes(2);
    });

    it('[Task 1.2] propagates each DB failure without retrying or returning a partial document', async () => {
        const channelFailure = makeModel({
            channelDB: { findAll: vi.fn(async () => Promise.reject(new Error('synthetic channel failure'))) },
        });
        await expect(channelFailure.model.getChannelList('synthetic.invalid', false, 1, false)).rejects.toThrow(
            'synthetic channel failure',
        );
        expect(channelFailure.channelDB.findAll).toHaveBeenCalledOnce();

        const programFailure = makeModel({
            programDB: { findSchedule: vi.fn(async () => Promise.reject(new Error('synthetic program failure'))) },
        });
        await expect(programFailure.model.getEpg(1, false)).rejects.toThrow('synthetic program failure');
        expect(programFailure.programDB.findSchedule).toHaveBeenCalledOnce();
        expect(programFailure.channelDB.findAll).not.toHaveBeenCalled();

        const xmlChannelFailure = makeModel({
            programDB: { findSchedule: vi.fn(async () => [makeProgram()]) },
            channelDB: { findAll: vi.fn(async () => Promise.reject(new Error('synthetic XML channel failure'))) },
        });
        await expect(xmlChannelFailure.model.getEpg(1, false)).rejects.toThrow('synthetic XML channel failure');
        expect(xmlChannelFailure.programDB.findSchedule).toHaveBeenCalledOnce();
        expect(xmlChannelFailure.channelDB.findAll).toHaveBeenCalledOnce();
    });

    it('[Task 1.2] does not regenerate after document generation fails', async () => {
        const channel = makeChannel();
        Object.defineProperty(channel, 'type', {
            get: vi.fn(() => {
                throw new Error('synthetic generation failure');
            }),
        });
        const channelRead = vi.fn(async () => [channel]);
        const harness = makeModel({ channelDB: { findAll: channelRead } });

        await expect(harness.model.getChannelList('synthetic.invalid', false, 1, false)).rejects.toThrow(
            'synthetic generation failure',
        );
        expect(channelRead).toHaveBeenCalledOnce();
    });

    it('[Task 1.2] does not retry a failed request and starts a fresh read for the next request', async () => {
        const channelRead = vi
            .fn()
            .mockRejectedValueOnce(new Error('synthetic first-request failure'))
            .mockResolvedValueOnce([]);
        const harness = makeModel({ channelDB: { findAll: channelRead } });

        await expect(harness.model.getChannelList('synthetic.invalid', false, 1, false)).rejects.toThrow(
            'synthetic first-request failure',
        );
        expect(channelRead).toHaveBeenCalledOnce();
        await expect(harness.model.getChannelList('synthetic.invalid', false, 1, false)).resolves.toBe('#EXTM3U\n');
        expect(channelRead).toHaveBeenCalledTimes(2);
    });
});

describe.each([
    {
        document: '#EXTM3U\n',
        handlerFile: 'channel.m3u8.js',
        method: 'getChannelList',
        name: 'M3U8',
        query: { mode: 2, isHalfWidth: false },
        contentType: 'application/x-mpegURL; charset="UTF-8"',
    },
    {
        document: '<synthetic/>',
        handlerFile: 'epg.xml.js',
        method: 'getEpg',
        name: 'XMLTV',
        query: { days: 1, isHalfWidth: false },
        contentType: 'application/xml; charset="UTF-8"',
    },
])('IPTV $name HTTP deadline', scenario => {
    const startRequest = (document: Promise<string>) => {
        const model = {
            getChannelList: vi.fn(() =>
                scenario.method === 'getChannelList' ? document : Promise.resolve('#EXTM3U\n'),
            ),
            getEpg: vi.fn(() => (scenario.method === 'getEpg' ? document : Promise.resolve('<synthetic/>'))),
        };
        container().bind('IIPTVApiModel').toConstantValue(model);
        container()
            .bind('IConfiguration')
            .toConstantValue({ getConfig: () => ({}) });
        const handler = loadModule<any>('model', 'service', 'api', 'iptv', scenario.handlerFile).get;
        const response = makeResponse();
        const request = {
            header: () => undefined,
            headers: { host: 'synthetic.invalid' },
            protocol: 'http',
            query: scenario.query,
        };
        return { model, pending: handler(request, response), response };
    };

    // The 29,999/30,000/30,001ms boundaries here and in the [Task 6.1] case below are
    // IPTV_DOCUMENT_DEADLINE_MS (src/model/api/iptv/IptvDocumentRequestGuard.ts:4), a
    // v3-only per-request absolute response fence with no v2 counterpart -- approved in
    // .kiro/specs/server-iptv-export/design.md:15,265,360,596.
    it('[Task 6.1] returns the complete document when generation settles at 29,999ms', async () => {
        vi.useFakeTimers();
        const document = makeDeferred<string>();
        const request = startRequest(document.promise);

        await vi.advanceTimersByTimeAsync(29_999);
        document.resolve(scenario.document);
        await request.pending;

        expect(request.response.statusCode).toBe(200);
        expect(request.response.headers['Content-Type']).toBe(scenario.contentType);
        expect(request.response.body).toBe(scenario.document);
        expect(request.response.end).toHaveBeenCalledOnce();
        expect(request.response.json).not.toHaveBeenCalled();
    });

    it.each([30_000, 30_001])(
        '[Task 6.1] returns one existing generation failure when completion reaches %ims',
        async elapsed => {
            vi.useFakeTimers();
            const document = makeDeferred<string>();
            const request = startRequest(document.promise);

            await vi.advanceTimersByTimeAsync(elapsed);

            expect(request.response.statusCode).toBe(500);
            expect(request.response.body).toEqual({
                code: 500,
                message: 'Internal Server Error',
                errors: expect.any(String),
            });
            expect(request.response.json).toHaveBeenCalledOnce();
            expect(request.response.end).not.toHaveBeenCalled();

            document.resolve(scenario.document);
            await request.pending;
            expect(request.response.json).toHaveBeenCalledOnce();
            expect(request.response.end).not.toHaveBeenCalled();
        },
    );
});

registerCanonicalContracts(canonicalLifecycleCases);

describe('XMLTV HTTP stage fence', () => {
    it('[Task 6.3] does not start the channel read when a programme read resolves after the deadline', async () => {
        vi.useFakeTimers();
        const delayedPrograms = makeDeferred<Record<string, any>[]>();
        const channelRead = vi.fn(async () => [makeChannel()]);
        const harness = makeModel({
            channelDB: { findAll: channelRead },
            programDB: { findSchedule: vi.fn(() => delayedPrograms.promise) },
        });
        container().bind('IIPTVApiModel').toConstantValue(harness.model);
        const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'epg.xml.js').get;
        const response = makeResponse();
        const pending = handler({ query: { days: 1, isHalfWidth: false } }, response);

        await vi.advanceTimersByTimeAsync(30_000);
        await pending;
        delayedPrograms.resolve([makeProgram()]);
        await Promise.resolve();
        await Promise.resolve();

        expect(response.statusCode).toBe(500);
        expect(response.json).toHaveBeenCalledOnce();
        expect(response.end).not.toHaveBeenCalled();
        expect(channelRead).not.toHaveBeenCalled();
        expect(response.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('M3U8 HTTP lifecycle contract', () => {
    const execute = (document: Promise<string>) => {
        const model = { getChannelList: vi.fn(() => document) };
        container().bind('IIPTVApiModel').toConstantValue(model);
        container()
            .bind('IConfiguration')
            .toConstantValue({ getConfig: () => ({ subDirectory: '/synthetic' }) });
        const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'channel.m3u8.js').get;
        const response = makeResponse();
        return {
            model,
            pending: handler(
                {
                    headers: { host: 'synthetic.invalid' },
                    header: () => undefined,
                    protocol: 'http',
                    query: { mode: 2, isHalfWidth: false },
                },
                response,
            ),
            response,
        };
    };

    it('[Task 6.2] turns a M3U8 read rejection into one complete existing error response', async () => {
        const request = execute(Promise.reject(new Error('synthetic M3U8 DB failure')));
        await request.pending;

        expect(request.response.statusCode).toBe(500);
        expect(request.response.body).toEqual({
            code: 500,
            message: 'Internal Server Error',
            errors: 'synthetic M3U8 DB failure',
        });
        expect(request.response.json).toHaveBeenCalledOnce();
        expect(request.response.end).not.toHaveBeenCalled();
        expect(request.response.listenerCount('close')).toBe(0);
    });
});

describe('IPTV explicit HTTP observables', () => {
    const m3u8Request = (mode = 2, protocol = 'http', host: string | null = 'synthetic.invalid') => ({
        header: () => undefined,
        headers: host === null ? {} : { host },
        protocol,
        query: { isHalfWidth: false, mode },
    });

    const bindM3u8 = (model: Record<string, any>, subDirectory?: string) => {
        container().bind('IIPTVApiModel').toConstantValue(model);
        container()
            .bind('IConfiguration')
            .toConstantValue({ getConfig: () => (subDirectory === undefined ? {} : { subDirectory }) });
        return loadModule<any>('model', 'service', 'api', 'iptv', 'channel.m3u8.js').get;
    };

    it('[Task 6.2 evidence R6.1] returns M3U8 HTTP status, type, and exact UTF-8 bytes', async () => {
        const document = '#EXTM3U\n#EXTINF:-1,synthetic-byte\n';
        const handler = bindM3u8({ getChannelList: vi.fn(async () => document) });
        const response = makeResponse();

        await handler(m3u8Request(), response);

        expect(response.statusCode).toBe(200);
        expect(response.headers['Content-Type']).toBe('application/x-mpegURL; charset="UTF-8"');
        expect(Buffer.from(response.body, 'utf8')).toEqual(Buffer.from(document, 'utf8'));
        expect(response.end).toHaveBeenCalledOnce();
        expect(response.json).not.toHaveBeenCalled();
        expect(response.listenerCount('close')).toBe(0);
    });

    it('[Task 6.2 evidence R6.2] preserves the carrier Host and configured subdirectory in exact M3U8 URLs', async () => {
        const channel = makeChannel({ hasLogoData: true, id: 42, type: 0x02 });
        const harness = makeModel({ channelDB: { findAll: vi.fn(async () => [channel]) } });
        const handler = bindM3u8(harness.model, '/synthetic-subdir');
        const response = makeResponse();

        await handler(m3u8Request(7), response);

        expect(Buffer.from(response.body, 'utf8')).toEqual(
            Buffer.from(
                '#EXTM3U\n' +
                    '#KODIPROP:mimetype=video/mp2t\n' +
                    '#EXTINF:-1 tvg-id="42" tvg-logo="http://synthetic.invalid/synthetic-subdir/api/channels/42/logo" group-title="GR",通常局　\n' +
                    'http://synthetic.invalid/synthetic-subdir/api/streams/live/42/m2ts?mode=7\n',
                'utf8',
            ),
        );
        expect(response.statusCode).toBe(200);
        expect(response.headers['Content-Type']).toBe('application/x-mpegURL; charset="UTF-8"');
        expect(response.listenerCount('close')).toBe(0);
    });

    it('[Task 6.2 evidence R6.3] fails host-missing M3U8 before a DB read', async () => {
        const getChannelList = vi.fn(async () => '#EXTM3U\n');
        const handler = bindM3u8({ getChannelList });
        const response = makeResponse();

        await handler(m3u8Request(2, 'http', null), response);

        expect(getChannelList).not.toHaveBeenCalled();
        expect(response.statusCode).toBe(500);
        expect(response.body).toEqual({
            code: 500,
            message: 'Internal Server Error',
            errors: 'HostIsUndefined',
        });
        expect(response.json).toHaveBeenCalledOnce();
        expect(response.end).not.toHaveBeenCalled();
        expect(response.listenerCount('close')).toBe(0);
    });

    it('[Task 6.2 evidence R6.4] carries the carrier-selected HTTPS scheme into exact M3U8 URLs', async () => {
        const channel = makeChannel({ hasLogoData: true, id: 43, type: 0x02 });
        const harness = makeModel({ channelDB: { findAll: vi.fn(async () => [channel]) } });
        const handler = bindM3u8(harness.model);
        const response = makeResponse();

        await handler(m3u8Request(8, 'https'), response);

        expect(response.body).toContain('https://synthetic.invalid/api/channels/43/logo');
        expect(response.body).toContain('https://synthetic.invalid/api/streams/live/43/m2ts?mode=8');
        expect(response.statusCode).toBe(200);
        expect(response.headers['Content-Type']).toBe('application/x-mpegURL; charset="UTF-8"');
        expect(response.listenerCount('close')).toBe(0);
    });

    it('[Task 6.2 evidence R6.5] keeps concurrent M3U8 reads request-local', async () => {
        vi.useFakeTimers();
        const first = makeDeferred<string>();
        const second = makeDeferred<string>();
        const getChannelList = vi.fn(({ mode }: { mode: number }) => (mode === 1 ? first.promise : second.promise));
        const handler = bindM3u8({ getChannelList });
        const firstResponse = makeResponse();
        const secondResponse = makeResponse();
        const firstRequest = handler(m3u8Request(1), firstResponse);
        const secondRequest = handler(m3u8Request(2), secondResponse);

        expect(vi.getTimerCount()).toBe(2);
        second.resolve('#EXTM3U\n#second\n');
        await secondRequest;
        first.resolve('#EXTM3U\n#first\n');
        await firstRequest;

        expect(firstResponse.body).toBe('#EXTM3U\n#first\n');
        expect(secondResponse.body).toBe('#EXTM3U\n#second\n');
        expect(getChannelList).toHaveBeenCalledTimes(2);
        expect(firstResponse.listenerCount('close')).toBe(0);
        expect(secondResponse.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 6.2 evidence R6.6] maps one M3U8 DB rejection to one complete HTTP error', async () => {
        const handler = bindM3u8({
            getChannelList: vi.fn(() => Promise.reject(new Error('synthetic M3U8 DB failure'))),
        });
        const response = makeResponse();

        await handler(m3u8Request(), response);

        expect(response.statusCode).toBe(500);
        expect(response.body).toEqual({
            code: 500,
            message: 'Internal Server Error',
            errors: 'synthetic M3U8 DB failure',
        });
        expect(response.json).toHaveBeenCalledOnce();
        expect(response.end).not.toHaveBeenCalled();
        expect(response.listenerCount('close')).toBe(0);
    });

    it('[Task 6.2 evidence R6.7] maps one XMLTV DB rejection to one complete HTTP error', async () => {
        const getEpg = vi.fn(() => Promise.reject(new Error('synthetic XMLTV DB failure')));
        container().bind('IIPTVApiModel').toConstantValue({ getEpg });
        const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'epg.xml.js').get;
        const response = makeResponse();

        await handler({ query: { days: 1, isHalfWidth: false } }, response);

        expect(getEpg).toHaveBeenCalledOnce();
        expect(response.statusCode).toBe(500);
        expect(response.body).toEqual({
            code: 500,
            message: 'Internal Server Error',
            errors: 'synthetic XMLTV DB failure',
        });
        expect(response.json).toHaveBeenCalledOnce();
        expect(response.end).not.toHaveBeenCalled();
        expect(response.listenerCount('close')).toBe(0);
    });

    it('[Task 6.2 evidence R6.8] does not regenerate M3U8 after document generation fails', async () => {
        const channel = makeChannel();
        Object.defineProperty(channel, 'type', {
            get: vi.fn(() => {
                throw new Error('synthetic M3U8 generation failure');
            }),
        });
        const channelRead = vi.fn(async () => [channel]);
        const harness = makeModel({ channelDB: { findAll: channelRead } });
        const handler = bindM3u8(harness.model);
        const response = makeResponse();

        await handler(m3u8Request(), response);

        expect(channelRead).toHaveBeenCalledOnce();
        expect(response.statusCode).toBe(500);
        expect(response.body).toEqual({
            code: 500,
            message: 'Internal Server Error',
            errors: 'synthetic M3U8 generation failure',
        });
        expect(response.json).toHaveBeenCalledOnce();
        expect(response.end).not.toHaveBeenCalled();
        expect(response.listenerCount('close')).toBe(0);
    });

    it.each([
        { elapsed: 29_999, status: 200 },
        { elapsed: 30_000, status: 500 },
        { elapsed: 30_001, status: 500 },
    ])(
        '[Task 6.2 evidence R6.9 deadline $elapsed] returns the complete document before the absolute deadline',
        async ({ elapsed, status }) => {
            vi.useFakeTimers();
            const document = makeDeferred<string>();
            const handler = bindM3u8({ getChannelList: vi.fn(() => document.promise) });
            const response = makeResponse();
            const pending = handler(m3u8Request(), response);

            await vi.advanceTimersByTimeAsync(elapsed);
            document.resolve('#EXTM3U\n#deadline\n');
            await pending;

            expect(response.statusCode).toBe(status);
            if (status === 200) {
                expect(response.headers['Content-Type']).toBe('application/x-mpegURL; charset="UTF-8"');
                expect(Buffer.from(response.body, 'utf8')).toEqual(Buffer.from('#EXTM3U\n#deadline\n', 'utf8'));
                expect(response.end).toHaveBeenCalledOnce();
                expect(response.json).not.toHaveBeenCalled();
            } else {
                expect(response.body).toMatchObject({ errors: 'IptvDocumentRequestDeadlineExceeded' });
                expect(response.json).toHaveBeenCalledOnce();
                expect(response.end).not.toHaveBeenCalled();
            }
            expect(response.listenerCount('close')).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it('[Task 6.2 evidence R6.10] returns deadline failure while M3U8 read remains pending', async () => {
        vi.useFakeTimers();
        const document = makeDeferred<string>();
        const handler = bindM3u8({ getChannelList: vi.fn(() => document.promise) });
        const response = makeResponse();
        const pending = handler(m3u8Request(), response);

        await vi.advanceTimersByTimeAsync(30_000);
        await pending;
        document.resolve('#EXTM3U\n#late\n');
        await vi.advanceTimersByTimeAsync(0);

        expect(response.statusCode).toBe(500);
        expect(response.body).toMatchObject({ errors: 'IptvDocumentRequestDeadlineExceeded' });
        expect(response.json).toHaveBeenCalledOnce();
        expect(response.end).not.toHaveBeenCalled();
        expect(response.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['resolve', 'reject'] as const)(
        '[Task 6.2 evidence R6.11 disconnect %s] keeps the terminal disconnect through late settlement',
        async settlement => {
            vi.useFakeTimers();
            const document = makeDeferred<string>();
            const handler = bindM3u8({ getChannelList: vi.fn(() => document.promise) });
            const response = makeResponse();
            const unhandledRejections: unknown[] = [];
            const onUnhandledRejection = (reason: unknown): void => {
                unhandledRejections.push(reason);
            };
            process.on('unhandledRejection', onUnhandledRejection);
            try {
                const pending = handler(m3u8Request(), response);
                expect(response.listenerCount('close')).toBe(1);
                expect(vi.getTimerCount()).toBe(1);
                response.destroyed = true;
                response.emit('close');
                await pending;

                if (settlement === 'resolve') document.resolve('#EXTM3U\n#late\n');
                else document.reject(new Error('synthetic late M3U8 rejection'));
                await vi.advanceTimersByTimeAsync(0);

                expect(response.json).not.toHaveBeenCalled();
                expect(response.end).not.toHaveBeenCalled();
                expect(response.listenerCount('close')).toBe(0);
                expect(unhandledRejections).toEqual([]);
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                document.resolve('#EXTM3U\n');
                process.off('unhandledRejection', onUnhandledRejection);
            }
        },
    );
});
