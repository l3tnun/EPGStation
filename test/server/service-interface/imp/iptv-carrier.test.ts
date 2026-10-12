import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compiled, modelContainer, require } from '../_harness';

const channelRoute = require(compiled('model', 'service', 'api', 'iptv', 'channel.m3u8.js')) as {
    get: (request: Record<string, unknown>, response: Record<string, unknown>) => Promise<void>;
};
const IPTVApiModel = (require(compiled('model', 'api', 'iptv', 'IPTVApiModel.js')) as any).default;

const response = (): Record<string, any> => {
    const value: Record<string, any> = Object.assign(new EventEmitter(), {
        body: undefined,
        destroyed: false,
        headers: {},
        headersSent: false,
        writableEnded: false,
    });
    value.setHeader = vi.fn((name: string, header: string) => (value.headers[name] = header));
    value.status = vi.fn(() => value);
    value.end = vi.fn((body: string) => {
        value.body = body;
        value.headersSent = true;
        value.writableEnded = true;
    });
    value.json = vi.fn((body: unknown) => {
        value.body = body;
        value.headersSent = true;
        value.writableEnded = true;
    });
    return value;
};

const request = (headers: Record<string, string>, mode = 1): Record<string, unknown> => ({
    header: (name: string) =>
        Object.entries(headers).find(([header]) => header.toLowerCase() === name.toLowerCase())?.[1],
    headers: Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])),
    protocol: 'http',
    query: { isHalfWidth: true, mode },
});

afterEach(() => {
    vi.restoreAllMocks();
    for (const binding of ['IConfiguration', 'IIPTVApiModel', 'IStreamApiModel']) {
        if (modelContainer.isBound(binding)) modelContainer.unbind(binding);
    }
});

describe('Service Interface IPTV typed public URL carrier [Task 2.4]', () => {
    it('constructs one immutable builder from the request Host, exact forwarded HTTPS, and configured subDirectory', async () => {
        const getChannelList = vi.fn(async (input: any) => {
            expect(Object.isFrozen(input.publicUrls)).toBe(true);
            return [input.publicUrls.channelLogoUrl(42), input.publicUrls.liveM2tsUrl(42, input.mode)].join('\n');
        });
        modelContainer.bind('IConfiguration').toConstantValue({ getConfig: () => ({ subDirectory: '/epg' }) });
        modelContainer.bind('IIPTVApiModel').toConstantValue({ getChannelList });
        const carrierResponse = response();

        await channelRoute.get(
            request({ Host: 'receiver.invalid:8443', 'X-Forwarded-Proto': 'https' }),
            carrierResponse,
        );

        expect(getChannelList).toHaveBeenCalledOnce();
        expect(getChannelList).toHaveBeenCalledWith({
            isHalfWidth: true,
            mode: 1,
            publicUrls: expect.any(Object),
        });
        expect(carrierResponse.headers['Content-Type']).toBe('application/x-mpegURL; charset="UTF-8"');
        expect(carrierResponse.body).toBe(
            'https://receiver.invalid:8443/epg/api/channels/42/logo\n' +
                'https://receiver.invalid:8443/epg/api/streams/live/42/m2ts?mode=1',
        );
    });

    it('returns the existing host error before invoking the provider or either database port', async () => {
        const channelDB = { findAll: vi.fn() };
        const programDB = { findSchedule: vi.fn() };
        const model = new IPTVApiModel(channelDB, programDB);
        const getChannelList = vi.spyOn(model, 'getChannelList');
        modelContainer.bind('IConfiguration').toConstantValue({ getConfig: () => ({}) });
        modelContainer.bind('IIPTVApiModel').toConstantValue(model);
        const resolve = vi.spyOn(modelContainer, 'get');
        const carrierResponse = response();

        await channelRoute.get(request({}), carrierResponse);

        expect(getChannelList).not.toHaveBeenCalled();
        expect(resolve).not.toHaveBeenCalledWith('IIPTVApiModel');
        expect(channelDB.findAll).not.toHaveBeenCalled();
        expect(programDB.findSchedule).not.toHaveBeenCalled();
        expect(carrierResponse.status).toHaveBeenCalledWith(500);
        expect(carrierResponse.body).toEqual({
            code: 500,
            errors: 'HostIsUndefined',
            message: 'Internal Server Error',
        });
    });

    it.each([
        {
            channels: [
                {
                    channelType: 'GR',
                    hasLogoData: true,
                    halfWidthName: 'logo-channel',
                    id: 10,
                    name: 'logo-channel',
                    type: 0x01,
                },
            ],
            kind: 'a logo-bearing selected service',
        },
        {
            channels: [
                {
                    channelType: 'GR',
                    hasLogoData: false,
                    halfWidthName: 'logo-less-channel',
                    id: 11,
                    name: 'logo-less-channel',
                    type: 0x01,
                },
            ],
            kind: 'a logo-less selected service',
        },
        { channels: [], kind: 'an empty document' },
    ])('never starts Media Delivery while serializing $kind', async ({ channels }) => {
        const channelDB = { findAll: vi.fn(async () => channels) };
        const programDB = { findSchedule: vi.fn() };
        const model = new IPTVApiModel(channelDB, programDB);
        const mediaDeliveryStarts = {
            startLiveHLSStream: vi.fn(),
            startLiveM2TsLLStream: vi.fn(),
            startLiveM2TsStream: vi.fn(),
            startLiveWebmStream: vi.fn(),
        };
        modelContainer.bind('IConfiguration').toConstantValue({ getConfig: () => ({}) });
        modelContainer.bind('IIPTVApiModel').toConstantValue(model);
        modelContainer.bind('IStreamApiModel').toConstantValue(mediaDeliveryStarts);
        const resolve = vi.spyOn(modelContainer, 'get');
        const carrierResponse = response();

        await channelRoute.get(request({ Host: 'receiver.invalid' }), carrierResponse);

        expect(channelDB.findAll).toHaveBeenCalledOnce();
        expect(resolve).not.toHaveBeenCalledWith('IStreamApiModel');
        for (const start of Object.values(mediaDeliveryStarts)) {
            expect(start).not.toHaveBeenCalled();
        }
        expect(carrierResponse.status).toHaveBeenCalledWith(200);
        expect(carrierResponse.headers['Content-Type']).toBe('application/x-mpegURL; charset="UTF-8"');
    });
});
