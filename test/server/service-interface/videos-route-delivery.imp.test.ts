import express from 'express';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { close, compiled, listen, modelContainer, require } from './_harness';

type Handler = (request: any, response: any) => Promise<void>;

const route = require(compiled('model', 'service', 'api', 'videos', '{videoFileId}.js')) as { get: Handler };

let origin = '';
let server: Server;
let directory = '';
let videoFile = '';
let activeRequest: any;

beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'epgstation-videos-route-'));
    videoFile = join(directory, 'video.ts');
    await writeFile(videoFile, 'synthetic-video-file');
    const app = express();
    app.all('/probe', async (request, response) => {
        Object.defineProperty(request, 'params', { configurable: true, value: { videoFileId: '31' } });
        Object.defineProperty(request, 'query', { configurable: true, value: activeRequest.query });
        await route.get(request, response);
    });
    server = app.listen(0, '127.0.0.1');
    origin = await listen(server);
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
    await close(server);
    await rm(directory, { force: true, recursive: true });
});

const waitFor = async (condition: () => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 200 && !condition(); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(condition()).toBe(true);
};

/**
 * GET /videos/{videoFileId} は配信 owner の `openDelivery` から貸し出しを受け、
 * 応答の終端で 1 回だけ貸し出しを返す。貸し出しが無ければ 404、応答の組み立てに
 * 失敗したときは貸し出しを返してから 500 にする。
 */
describe('GET /videos/{videoFileId} delivery lease (unittest/imp)', () => {
    it('[SI-4.3] answers 404 and opens no response when openDelivery returns null', async () => {
        activeRequest = { query: {} };
        const openDelivery = vi.fn().mockResolvedValue(null);
        vi.spyOn(modelContainer, 'get').mockReturnValue({ openDelivery });

        const response = await fetch(`${origin}/probe`);

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ code: 404, message: 'video file is not found' });
        expect(openDelivery).toHaveBeenCalledExactlyOnceWith(31, expect.any(Function));
    });

    it('[SI-4.3] streams the provider reader without Content-Length for a tail delivery and releases once', async () => {
        activeRequest = { query: {} };
        const readable = new PassThrough();
        readable.end('synthetic-tail-bytes');
        const release = vi.fn().mockResolvedValue(undefined);
        const openDelivery = vi.fn().mockResolvedValue({
            isTail: true,
            mime: 'video/mp2t',
            path: videoFile,
            reader: { readable },
            release,
        });
        vi.spyOn(modelContainer, 'get').mockReturnValue({ openDelivery });

        const response = await fetch(`${origin}/probe`);

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('video/mp2t');
        expect(response.headers.get('content-length')).toBeNull();
        expect(await response.text()).toBe('synthetic-tail-bytes');
        await waitFor(() => release.mock.calls.length > 0);
        expect(release).toHaveBeenCalledOnce();
    });

    it('[SI-2.8] reports the lease as inactive to the owner once the client connection has closed', async () => {
        activeRequest = { query: {} };
        let isActive: (() => boolean) | undefined;
        const openDelivery = vi.fn(async (_id: number, active: () => boolean) => {
            isActive = active;
            return null;
        });
        vi.spyOn(modelContainer, 'get').mockReturnValue({ openDelivery });

        const request = Object.assign(new (require('node:events').EventEmitter)(), {
            params: { videoFileId: '31' },
            query: {},
        });
        const response = { json: vi.fn(), status: vi.fn() };
        await route.get(request, response);
        expect(isActive!()).toBe(true);
        request.emit('close');
        expect(isActive!()).toBe(false);
    });

    it('[SI-4.7] releases the lease and answers 500 when building the file response throws', async () => {
        activeRequest = { query: {} };
        const release = vi.fn().mockResolvedValue(undefined);
        const openDelivery = vi.fn().mockResolvedValue({ mime: 'video/mp2t', path: directory, release });
        vi.spyOn(modelContainer, 'get').mockReturnValue({ openDelivery });

        const response = await fetch(`${origin}/probe`);

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({
            code: 500,
            errors: 'file path is derectory',
            message: 'Internal Server Error',
        });
        expect(release).toHaveBeenCalledOnce();
    });
});
