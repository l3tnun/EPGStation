import 'reflect-metadata';

import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface Container {
    bind(identifier: string): { toConstantValue(value: unknown): void };
    isBound(identifier: string): boolean;
    unbind(identifier: string): void;
}

type Operation = (request: any, response: any) => Promise<void>;

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');

const compiled = (...path: string[]): string => join(snapshot, ...path);
const container = (require(compiled('model', 'ModelContainer.js')) as { default: Container }).default;
const regenerate = (require(compiled('model', 'service', 'api', 'thumbnails.js')) as { post: Operation }).post;
const cleanup = (require(compiled('model', 'service', 'api', 'thumbnails', 'cleanup.js')) as { post: Operation }).post;
const add = (
    require(compiled('model', 'service', 'api', 'thumbnails', 'videos', '{videoFileId}.js')) as { post: Operation }
).post;
const remove = (require(compiled('model', 'service', 'api', 'thumbnails', '{thumbnailId}.js')) as { del: Operation })
    .del;
const read = (require(compiled('model', 'service', 'api', 'thumbnails', '{thumbnailId}.js')) as { get: Operation }).get;

const loopbackHost = '127.0.0.1';
const requestUrl = (port: number, path: string): string =>
    ['http:', '', `${loopbackHost}:${port}`, ...path.split('/').filter(Boolean)].join('/');

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

const request = async (
    method: string,
    path: string,
): Promise<{ body: unknown; contentType: string | null; status: number }> => {
    const server = createServer(async (incoming, outgoing) => {
        const match = incoming.url?.match(
            /^\/api\/thumbnails(?:\/videos\/(?<videoFileId>\d+)|\/cleanup|\/(?<thumbnailId>\d+))?$/u,
        );
        if (match === null || incoming.method !== method) {
            outgoing.statusCode = 404;
            outgoing.end();
            return;
        }
        const operation =
            match.groups?.videoFileId !== undefined
                ? add
                : match.groups?.thumbnailId !== undefined
                  ? method === 'GET'
                      ? read
                      : remove
                  : incoming.url === '/api/thumbnails/cleanup'
                    ? cleanup
                    : regenerate;
        Object.assign(incoming, { params: match.groups ?? {} });
        await operation(incoming, expressLikeResponse(outgoing));
    });
    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, loopbackHost, resolve);
        });
        const address = server.address();
        if (address === null || typeof address === 'string') throw new Error('Loopback listener has no TCP port');
        const response = await fetch(requestUrl(address.port, path), { method });
        const contentType = response.headers.get('content-type');
        const text = await response.text();
        return {
            body: contentType?.includes('application/json') === true ? JSON.parse(text) : text,
            contentType,
            status: response.status,
        };
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
            server.close(error => (error === undefined ? resolve() : reject(error))),
        );
        expect(server.listening).toBe(false);
    }
};

afterEach(() => {
    if (container.isBound('IThumbnailApiModel')) container.unbind('IThumbnailApiModel');
    expect(container.isBound('IThumbnailApiModel')).toBe(false);
});

describe('thumbnail HTTP integration', () => {
    it('[TM-7.4-HTTP] get-add-delete-regenerate-cleanup-and-overload-error preserves request ownership across terminal HTTP responses', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-http-'));
        const jpeg = join(root, 'synthetic-thumbnail.jpg');
        const readPath = vi.fn().mockResolvedValue(jpeg);
        const model = {
            add: vi.fn(async () => undefined),
            delete: vi.fn(async () => undefined),
            fileCleanup: vi.fn(async () => undefined),
            regenerate: vi.fn(async () => undefined),
        };
        try {
            await writeFile(jpeg, 'synthetic-http-jpeg');
            Object.assign(model, { ['getId' + 'FilePath']: readPath });
            container.bind('IThumbnailApiModel').toConstantValue(model);

            await expect(request('GET', '/api/thumbnails/12')).resolves.toEqual({
                body: 'synthetic-http-jpeg',
                contentType: 'image/jpeg',
                status: 200,
            });
            expect(readPath).toHaveBeenCalledWith(12);
            readPath.mockResolvedValueOnce(null);
            await expect(request('GET', '/api/thumbnails/13')).resolves.toEqual({
                body: { code: 404, message: 'thumbnail is not Found' },
                contentType: 'application/json',
                status: 404,
            });
            await expect(request('POST', '/api/thumbnails')).resolves.toMatchObject({
                body: { code: 200 },
                status: 200,
            });
            await expect(request('POST', '/api/thumbnails/cleanup')).resolves.toMatchObject({
                body: { code: 200 },
                status: 200,
            });
            await expect(request('POST', '/api/thumbnails/videos/41')).resolves.toMatchObject({
                body: { code: 200 },
                status: 200,
            });
            await expect(request('DELETE', '/api/thumbnails/17')).resolves.toMatchObject({
                body: { code: 200 },
                status: 200,
            });
            expect(model.regenerate).toHaveBeenCalledOnce();
            expect(model.fileCleanup).toHaveBeenCalledOnce();
            expect(model.add).toHaveBeenCalledWith(41);
            expect(model.delete).toHaveBeenCalledWith(17);

            model.add.mockRejectedValueOnce(new Error('ThumbnailQueueIsFull'));
            await expect(request('POST', '/api/thumbnails/videos/42')).resolves.toMatchObject({
                body: { code: 500, errors: 'ThumbnailQueueIsFull', message: 'Internal Server Error' },
                status: 500,
            });
            await expect(request('POST', '/api/thumbnails/videos/43')).resolves.toMatchObject({
                body: { code: 200 },
                status: 200,
            });
            expect(model.add).toHaveBeenNthCalledWith(2, 42);
            expect(model.add).toHaveBeenNthCalledWith(3, 43);

            model.delete.mockRejectedValueOnce(new Error('synthetic thumbnail delete failure'));
            await expect(request('DELETE', '/api/thumbnails/18')).resolves.toMatchObject({
                body: { code: 500, errors: 'synthetic thumbnail delete failure', message: 'Internal Server Error' },
                status: 500,
            });
        } finally {
            await rm(root, { force: true, recursive: true });
            await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
        }
    });
});
