import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compiled, modelContainer, require } from './_harness';

const mutableFileSystem = createRequire(import.meta.url)('node:fs') as Record<string, any>;

const makeResponse = () => {
    const response: Record<string, any> = {};
    response.status = vi.fn(() => response);
    response.header = vi.fn(() => response);
    response.json = vi.fn(() => response);
    return response;
};

afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('node:fs');
    vi.doUnmock('fs');
});

/**
 * 公開 API route の owner 失敗と、添付ダウンロードの応答 header。
 * route は owner の失敗を 500 の共通 error 形式へ変え、`isDownload` が真のとき
 * Content-Type と Content-Disposition を添付ダウンロード用にする。
 */
describe('service API route failure and download response (unittest/imp)', () => {
    it('[SI-1.4] GET /config answers 500 with the owner failure message when getConfig rejects', async () => {
        const getConfig = vi.fn().mockRejectedValue(new Error('config provider failed'));
        const get = vi.spyOn(modelContainer, 'get').mockReturnValue({ getConfig });
        const route = require(compiled('model', 'service', 'api', 'config.js')) as { get: Function };
        const response = makeResponse();
        const request = { header: vi.fn(() => undefined), protocol: 'http' };

        await route.get(request, response);

        expect(get).toHaveBeenCalledExactlyOnceWith('IConfigApiModel');
        expect(getConfig).toHaveBeenCalledExactlyOnceWith(false);
        expect(response.status).toHaveBeenCalledExactlyOnceWith(500);
        expect(response.json).toHaveBeenCalledExactlyOnceWith({
            code: 500,
            errors: 'config provider failed',
            message: 'Internal Server Error',
        });
    });

    it('[SI-1.5] GET /version answers 500 with the read failure message when package.json cannot be read', async () => {
        const failingFileSystem = {
            ...mutableFileSystem,
            readFileSync: () => {
                throw new Error('package unreadable');
            },
        };
        vi.doMock('node:fs', () => failingFileSystem);
        vi.doMock('fs', () => failingFileSystem);
        let route: { get: Function };
        try {
            vi.resetModules();
            route = (await import(compiled('model', 'service', 'api', 'version.js'))) as { get: Function };
        } finally {
            vi.doUnmock('node:fs');
            vi.doUnmock('fs');
        }
        const response = makeResponse();

        await route.get({}, response);

        expect(response.status).toHaveBeenCalledExactlyOnceWith(500);
        expect(response.json).toHaveBeenCalledExactlyOnceWith({
            code: 500,
            errors: 'package unreadable',
            message: 'Internal Server Error',
        });
    });

    it('[SI-4.6] responseFile with download true sends octet-stream and an encoded attachment file name', async () => {
        const { responseFile } = require(compiled('model', 'service', 'api.js')) as {
            responseFile(request: unknown, response: unknown, filePath: string, mime: string, download?: boolean): void;
        };
        const directory = await mkdtemp(join(tmpdir(), 'epgstation-download-'));
        try {
            const filePath = join(directory, '録画 1.ts');
            await writeFile(filePath, 'synthetic');
            const request = { headers: {}, method: 'HEAD' };
            const response = { end: vi.fn(), set: vi.fn(), status: vi.fn() };

            responseFile(request, response, filePath, 'video/mp4', true);

            expect(response.status).toHaveBeenCalledExactlyOnceWith(200);
            expect(response.set).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({
                    'Content-Type': 'application/octet-stream',
                    'Content-disposition': `attachment; filename*=utf-8'ja'${encodeURIComponent('録画 1.ts')};`,
                }),
            );
            expect(response.end).toHaveBeenCalledOnce();
        } finally {
            await rm(directory, { force: true, recursive: true });
        }
    });
});
