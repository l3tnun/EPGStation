import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';

import { axiosRequestStub as axiosRequest, compiled, deferred, prepareApiUtil } from './_media-harness';

const VideoApiModel = compiled<any>('model', 'api', 'video', 'VideoApiModel.js').default;
let ApiUtil: new (...args: any[]) => any;
beforeAll(async () => {
    ApiUtil = await prepareApiUtil();
});

afterEach(() => {
    axiosRequest.mockReset();
    axiosRequest.mockResolvedValue({ data: {} });
    vi.useRealTimers();
});

describe('Kodi delivery contract', () => {
    it('[PRIMARY R7.1] sends exactly one playback request to the selected configured Kodi host', async () => {
        const sendToKodi = vi.fn(async () => undefined);
        const kodi = {
            host: 'http://kodi.invalid:8080/base',
            name: 'living-room',
            password: 'synthetic-password',
            user: 'synthetic-user',
        };
        const model = new VideoApiModel(
            { getConfig: () => ({ kodiHosts: [kodi] }) },
            { findId: async () => ({ id: 31 }) },
            {},
            { getHost: (host: string) => `${host}/epg`, sendToKodi },
            {},
            {},
        );
        await model.sendToKodi('request.invalid:8888', true, 'living-room', 31);
        expect(sendToKodi).toHaveBeenCalledWith('https://request.invalid:8888/epg/api/videos/31', kodi);

        const apiUtil = new ApiUtil({ getConfig: () => ({}) });
        await apiUtil.sendToKodi('https://request.invalid/video', kodi);
        expect(axiosRequest).toHaveBeenCalledWith({
            auth: { password: 'synthetic-password', username: 'synthetic-user' },
            data: {
                id: 1,
                jsonrpc: '2.0',
                method: 'Player.Open',
                params: { item: { file: 'https://request.invalid/video' } },
            },
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
            responseType: 'json',
            signal: expect.anything(),
            // KODI_REQUEST_TIMEOUT_MS (src/model/api/ApiUtil.ts, sendToKodi()). v2's sendToKodi
            // (v2 5cf2ea383 src/model/api/ApiUtil.ts) calls axios.request() without an
            // explicit `timeout`, so axios's own default (no timeout) applies there -- this bound
            // has no v2 counterpart and is a v3-only hardening addition.
            timeout: 30_000,
            url: 'http://kodi.invalid:8080/jsonrpc',
        });
    });

    it('[PRIMARY R7.2] builds the recorded-file URL from the request protocol, host, and video file ID', async () => {
        const sendToKodi = vi.fn(async () => undefined);
        const model = new VideoApiModel(
            { getConfig: () => ({ kodiHosts: [{ host: 'http://kodi.invalid', name: 'living-room' }] }) },
            { findId: async () => ({ id: 31 }) },
            {},
            { getHost: (host: string) => `${host}/epg`, sendToKodi },
            {},
            {},
        );

        await model.sendToKodi('viewer.invalid:8443', true, 'living-room', 31);

        expect(sendToKodi).toHaveBeenCalledWith('https://viewer.invalid:8443/epg/api/videos/31', expect.any(Object));
    });

    it('[PRIMARY R7.4] keeps Kodi credentials out of the recorded-file URL', async () => {
        const sendToKodi = vi.fn(async () => undefined);
        const testpass = 'test-pa:ss@word';
        const testuser = 'test-user:name';
        const model = new VideoApiModel(
            {
                getConfig: () => ({
                    kodiHosts: [
                        {
                            host: 'http://kodi.invalid',
                            name: 'living-room',
                            password: testpass,
                            user: testuser,
                        },
                    ],
                }),
            },
            { findId: async () => ({ id: 31 }) },
            {},
            { getHost: (host: string) => host, sendToKodi },
            {},
            {},
        );

        await model.sendToKodi('viewer.invalid', false, 'living-room', 31);

        expect(sendToKodi).toHaveBeenCalledWith('http://viewer.invalid/api/videos/31', expect.any(Object));
        expect(sendToKodi.mock.calls[0]?.[0]).not.toContain(testuser);
        expect(sendToKodi.mock.calls[0]?.[0]).not.toContain(testpass);
    });

    it('[PRIMARY R7.6] rejects missing Kodi configuration, video, and transport failures', async () => {
        const transport = vi.fn(async () => undefined);
        const create = (config: object, video: object | null, reject = false) =>
            new VideoApiModel(
                { getConfig: () => config },
                { findId: async () => video },
                {},
                {
                    getHost: (host: string) => host,
                    sendToKodi: reject ? async () => Promise.reject(new Error('KodiOffline')) : transport,
                },
                {},
                {},
            );
        await expect(create({}, {}).sendToKodi('host', false, 'missing', 1)).rejects.toThrow('KodiHostsIsUndefined');
        await expect(create({ kodiHosts: [] }, {}).sendToKodi('host', false, 'missing', 1)).rejects.toThrow(
            'KodiHostIsUndefined',
        );
        const config = { kodiHosts: [{ host: 'http://kodi.invalid', name: 'room' }] };
        await expect(create(config, null).sendToKodi('host', false, 'room', 1)).rejects.toThrow('VideoFileIsUndefined');
        await expect(create(config, {}, true).sendToKodi('host', false, 'room', 1)).rejects.toThrow('KodiOffline');
        expect(transport).not.toHaveBeenCalled();
    });

    it('[PRIMARY R7.3] uses complete Kodi credentials only for the Kodi transport authentication', async () => {
        const apiUtil = new ApiUtil({ getConfig: () => ({}) });
        await apiUtil.sendToKodi('https://request.invalid/video', {
            host: 'http://kodi.invalid:8080',
            name: 'living-room',
            password: 'synthetic-password',
            user: 'synthetic-user',
        });
        expect(axiosRequest).toHaveBeenLastCalledWith(
            expect.objectContaining({ auth: { password: 'synthetic-password', username: 'synthetic-user' } }),
        );
        axiosRequest.mockClear();
        const partialCredentials = [
            { host: 'http://kodi.invalid:8080', name: 'living-room', password: 'synthetic-password' },
            { host: 'http://kodi.invalid:8080', name: 'living-room', user: 'synthetic-user' },
            { host: 'http://kodi.invalid:8080', name: 'living-room' },
        ];
        for (const kodi of partialCredentials) {
            await apiUtil.sendToKodi('https://request.invalid/video', kodi);
        }
        for (const [option] of axiosRequest.mock.calls) {
            expect(option).not.toHaveProperty('auth');
        }

        const transportFailure = new Error('SyntheticKodiTransportFailure');
        axiosRequest.mockRejectedValueOnce(transportFailure);
        await expect(
            apiUtil.sendToKodi('https://request.invalid/video', {
                host: 'http://kodi.invalid:8080',
                name: 'living-room',
            }),
        ).rejects.toBe(transportFailure);
    });

    it('[PRIMARY R7.5] completes a parsed Kodi response before the finite deadline and clears its timer', async () => {
        vi.useFakeTimers();
        const response = deferred<unknown>();
        axiosRequest.mockImplementationOnce(() => response.promise);
        const apiUtil = new ApiUtil({ getConfig: () => ({}) });

        const pending = apiUtil.sendToKodi('https://request.invalid/video', {
            host: 'http://kodi.invalid:8080',
            name: 'living-room',
        });
        const option = axiosRequest.mock.calls[0]?.[0] as { signal: AbortSignal; timeout: number };
        expect(option.timeout).toBe(30_000);
        expect(option.signal.aborted).toBe(false);

        await vi.advanceTimersByTimeAsync(29_999);
        expect(vi.getTimerCount()).toBe(1);
        response.resolve({ data: {} });

        await expect(pending).resolves.toBeUndefined();
        expect(option.signal.aborted).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-7.5][MD-7.6] keeps the deadline terminal when response parsing fails at the same instant', async () => {
        vi.useFakeTimers();
        const response = deferred<unknown>();
        const responseParseError = new Error('SyntheticKodiResponseParseFailure');
        axiosRequest.mockImplementationOnce(() => response.promise);
        const apiUtil = new ApiUtil({ getConfig: () => ({}) });

        const pending = apiUtil.sendToKodi('https://request.invalid/video', {
            host: 'http://kodi.invalid:8080',
            name: 'living-room',
        });
        const terminal = pending.then(
            () => undefined,
            error => error,
        );
        const option = axiosRequest.mock.calls[0]?.[0] as { signal: AbortSignal };
        setTimeout(() => response.reject(responseParseError), 30_000);

        await vi.advanceTimersByTimeAsync(30_000);

        await expect(terminal).resolves.toMatchObject({ message: 'KodiRequestDeadlineExceeded' });
        expect(option.signal.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-7.5] isolates a late successful response from the next Kodi request', async () => {
        vi.useFakeTimers();
        const firstResponse = deferred<unknown>();
        axiosRequest.mockImplementationOnce(() => firstResponse.promise);
        const apiUtil = new ApiUtil({ getConfig: () => ({}) });

        const firstPending = apiUtil.sendToKodi('https://request.invalid/first', {
            host: 'http://kodi.invalid:8080',
            name: 'living-room',
        });
        const firstTerminal = firstPending.then(
            () => undefined,
            error => error,
        );
        const firstOption = axiosRequest.mock.calls[0]?.[0] as { signal: AbortSignal };
        await vi.advanceTimersByTimeAsync(30_000);
        await expect(firstTerminal).resolves.toBeInstanceOf(Error);

        const secondResponse = deferred<unknown>();
        axiosRequest.mockImplementationOnce(() => secondResponse.promise);
        const secondPending = apiUtil.sendToKodi('https://request.invalid/second', {
            host: 'http://kodi.invalid:8080',
            name: 'living-room',
        });
        let secondSettled = false;
        void secondPending.then(
            () => {
                secondSettled = true;
            },
            () => {
                secondSettled = true;
            },
        );
        const secondOption = axiosRequest.mock.calls[1]?.[0] as { signal: AbortSignal };
        expect(secondOption.signal).not.toBe(firstOption.signal);

        firstResponse.resolve({ data: {} });
        await Promise.resolve();
        expect(secondSettled).toBe(false);

        secondResponse.resolve({ data: {} });
        await expect(secondPending).resolves.toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });
});
