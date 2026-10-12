import { expect, vi } from 'vitest';
import { loadModule, makeChannel, makeDeferred, makeModel, makeResponse } from '../../_harness';
import { defineCanonicalContract, type CanonicalContractCase } from './canonical-contract-case';

const file = 'request-lifecycle.spec.test.ts';
const container = () => loadModule<any>('model', 'ModelContainer.js').default;
const m3u8Request = (mode = 2, protocol = 'http', host: string | null = 'synthetic.invalid') => ({
    header: () => undefined,
    headers: host === null ? {} : { host },
    protocol,
    query: { isHalfWidth: false, mode },
});

const clearBindings = (): void => {
    for (const binding of ['IIPTVApiModel', 'IConfiguration']) {
        if (container().isBound(binding)) container().unbind(binding);
    }
};

const bindM3u8 = (model: Record<string, any>, subDirectory?: string) => {
    container().bind('IIPTVApiModel').toConstantValue(model);
    container()
        .bind('IConfiguration')
        .toConstantValue({ getConfig: () => (subDirectory === undefined ? {} : { subDirectory }) });
    return loadModule<any>('model', 'service', 'api', 'iptv', 'channel.m3u8.js').get;
};

export const canonicalLifecycleCases: readonly CanonicalContractCase[] = [
    defineCanonicalContract(
        'Requirement 6.1',
        file,
        'returns M3U8 HTTP status, type, and exact UTF-8 bytes',
        'HTTP 200, M3U8 content type, and exact UTF-8 bytes are observable',
        async () => {
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
        },
    ),
    defineCanonicalContract(
        'Requirement 6.2',
        file,
        'preserves the carrier Host and configured subdirectory in exact M3U8 URLs',
        'carrier host and subdirectory are observable in both URLs',
        async () => {
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
        },
    ),
    defineCanonicalContract(
        'Requirement 6.3',
        file,
        'fails host-missing M3U8 before a DB read',
        'host-missing request returns one public HTTP error before DB access',
        async () => {
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
        },
    ),
    defineCanonicalContract(
        'Requirement 6.4',
        file,
        'carries the carrier-selected HTTPS scheme into exact M3U8 URLs',
        'carrier-selected HTTPS scheme is observable in both URLs',
        async () => {
            const channel = makeChannel({ hasLogoData: true, id: 43, type: 0x02 });
            const handler = bindM3u8(makeModel({ channelDB: { findAll: async () => [channel] } }).model);
            const response = makeResponse();
            await handler(m3u8Request(8, 'https'), response);
            expect(response.body).toContain('https://synthetic.invalid/api/channels/43/logo');
            expect(response.body).toContain('https://synthetic.invalid/api/streams/live/43/m2ts?mode=8');
            expect(response.statusCode).toBe(200);
        },
    ),
    defineCanonicalContract(
        'Requirement 6.5',
        file,
        'keeps concurrent M3U8 reads request-local',
        'two concurrent response bodies retain their own request result',
        async () => {
            vi.useFakeTimers();
            const first = makeDeferred<string>();
            const second = makeDeferred<string>();
            const getChannelList = vi.fn(({ mode }: { mode: number }) => (mode === 1 ? first.promise : second.promise));
            const handler = bindM3u8({ getChannelList });
            const firstResponse = makeResponse();
            const secondResponse = makeResponse();
            const firstRequest = handler(m3u8Request(1), firstResponse);
            const secondRequest = handler(m3u8Request(2), secondResponse);
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
        },
    ),
    defineCanonicalContract(
        'Requirement 6.6',
        file,
        'maps one M3U8 DB rejection to one complete HTTP error',
        'one M3U8 DB failure is one complete HTTP error without document bytes',
        async () => {
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
        },
    ),
    defineCanonicalContract(
        'Requirement 6.7',
        file,
        'maps one XMLTV DB rejection to one complete HTTP error',
        'one XMLTV DB failure is one complete HTTP error without document bytes',
        async () => {
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
        },
    ),
    defineCanonicalContract(
        'Requirement 6.8',
        file,
        'does not regenerate M3U8 after document generation fails',
        'generation failure performs one read and one public HTTP error',
        async () => {
            const channel = makeChannel();
            Object.defineProperty(channel, 'type', {
                get: vi.fn(() => {
                    throw new Error('synthetic M3U8 generation failure');
                }),
            });
            const channelRead = vi.fn(async () => [channel]);
            const handler = bindM3u8(makeModel({ channelDB: { findAll: channelRead } }).model);
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
        },
    ),
    defineCanonicalContract(
        'Requirement 6.9',
        file,
        'accepts 29,999ms and rejects 30,000ms and 30,001ms',
        '29,999ms succeeds while 30,000ms and 30,001ms return HTTP failure',
        async () => {
            for (const { elapsed, status } of [
                { elapsed: 29_999, status: 200 },
                { elapsed: 30_000, status: 500 },
                { elapsed: 30_001, status: 500 },
            ]) {
                clearBindings();
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
                    expect(Buffer.from(response.body, 'utf8')).toEqual(Buffer.from('#EXTM3U\n#deadline\n', 'utf8'));
                    expect(response.end).toHaveBeenCalledOnce();
                } else {
                    expect(response.body).toMatchObject({ errors: 'IptvDocumentRequestDeadlineExceeded' });
                    expect(response.json).toHaveBeenCalledOnce();
                }
                expect(response.listenerCount('close')).toBe(0);
                expect(vi.getTimerCount()).toBe(0);
                vi.useRealTimers();
            }
        },
    ),
    defineCanonicalContract(
        'Requirement 6.10',
        file,
        'returns deadline failure while the M3U8 read remains pending',
        'pending read yields one deadline HTTP error and no later response',
        async () => {
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
        },
    ),
    defineCanonicalContract(
        'Requirement 6.11',
        file,
        'keeps disconnect terminal through both late resolve and late reject',
        'disconnect has no response after either late settlement and releases resources',
        async () => {
            for (const settlement of ['resolve', 'reject'] as const) {
                clearBindings();
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
                    vi.useRealTimers();
                }
            }
        },
    ),
];
