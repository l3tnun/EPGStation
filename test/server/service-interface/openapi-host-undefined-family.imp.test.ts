import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { compiled, modelContainer, require } from './_harness';

const m2tsPlaylistRoute = require(
    compiled('model', 'service', 'api', 'streams', 'live', '{channelId}', 'm2ts', 'playlist.js'),
) as { get: (req: Record<string, unknown>, res: Record<string, unknown>) => Promise<void> };

const videoPlaylistRoute = require(
    compiled('model', 'service', 'api', 'videos', '{videoFileId}', 'playlist.js'),
) as { get: (req: Record<string, unknown>, res: Record<string, unknown>) => Promise<void> };

const kodiRoute = require(compiled('model', 'service', 'api', 'videos', '{videoFileId}', 'kodi.js')) as {
    post: (req: Record<string, unknown>, res: Record<string, unknown>) => Promise<void>;
};

const response = (): Record<string, any> => {
    const value: Record<string, any> = Object.assign(new EventEmitter(), {
        body: undefined,
        destroyed: false,
        headers: {},
        headersSent: false,
        writableEnded: false,
    });
    value.setHeader = vi.fn((name: string, header: string) => {
        value.headers[name] = header;
    });
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

const requestWithoutHost = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    body: {},
    headers: {},
    params: { channelId: '101', videoFileId: '22' },
    protocol: 'http',
    query: { mode: '0' },
    ...extra,
});

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Combined OpenAPI HostIsUndefined family (residual-4351 G1–G3).
 * Three public Operations share typeof req.headers.host===undefined → throw HostIsUndefined (L10–12),
 * then responseServerError. container.get runs first; model methods must not run on missing host.
 * Product code is not modified.
 */
describe('OpenAPI HostIsUndefined family (unittest/imp)', () => {
    it('[R2-OPENAPI-HOST-UNDEFINED-FAMILY] three Operations return HostIsUndefined without model work', async () => {
        const getLiveM2TsStreamM3u8 = vi.fn();
        const getM3u8 = vi.fn();
        const sendToKodi = vi.fn();
        vi.spyOn(modelContainer, 'get').mockImplementation((token: string) => {
            if (token === 'IStreamApiModel') {
                return { getLiveM2TsStreamM3u8 };
            }
            if (token === 'IVideoApiModel') {
                return { getM3u8, sendToKodi };
            }
            throw new Error(`UnexpectedModelContainerLookup:${token}`);
        });

        const m2tsRes = response();
        await m2tsPlaylistRoute.get(requestWithoutHost(), m2tsRes);
        // responseServerError carries HostIsUndefined
        expect(m2tsRes.status).toHaveBeenCalledWith(500);
        expect(m2tsRes.body).toEqual({
            code: 500,
            errors: 'HostIsUndefined',
            message: 'Internal Server Error',
        });

        const videoRes = response();
        await videoPlaylistRoute.get(requestWithoutHost(), videoRes);
        expect(videoRes.status).toHaveBeenCalledWith(500);
        expect(videoRes.body).toEqual({
            code: 500,
            errors: 'HostIsUndefined',
            message: 'Internal Server Error',
        });

        const kodiRes = response();
        await kodiRoute.post(requestWithoutHost({ body: { kodiName: 'room' } }), kodiRes);
        expect(kodiRes.status).toHaveBeenCalledWith(500);
        expect(kodiRes.body).toEqual({
            code: 500,
            errors: 'HostIsUndefined',
            message: 'Internal Server Error',
        });

        expect(getLiveM2TsStreamM3u8).not.toHaveBeenCalled();
        expect(getM3u8).not.toHaveBeenCalled();
        expect(sendToKodi).not.toHaveBeenCalled();
    });
});
