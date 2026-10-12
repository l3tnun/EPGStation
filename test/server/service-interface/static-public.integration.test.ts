import express from 'express';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compiled, compiledSnapshot, require } from './_harness';

const ServiceServer = (require(compiled('model', 'service', 'ServiceServer.js')) as any).default;
const compiledImages: string[] = [];
const temporaryRoots: string[] = [];
const servers: Server[] = [];
const loopbackHost = '127.0.0.1';
const loopbackOrigin = (port: number): string => {
    const origin = new URL('http://synthetic.invalid');
    origin.hostname = loopbackHost;
    origin.port = String(port);
    return origin.origin;
};

const closeServer = (server: Server): Promise<void> =>
    new Promise((resolve, reject) => server.close(error => (error === undefined ? resolve() : reject(error))));

const rawGet = (origin: string, path: string): Promise<{ readonly body: string; readonly status: number }> =>
    new Promise((resolve, reject) => {
        const target = new URL(origin);
        const outgoing = request({ hostname: target.hostname, method: 'GET', path, port: target.port }, response => {
            const chunks: Buffer[] = [];
            response.on('data', chunk => chunks.push(Buffer.from(chunk)));
            response.once('end', () =>
                resolve({ body: Buffer.concat(chunks).toString('utf8'), status: response.statusCode ?? 0 }),
            );
        });
        outgoing.once('error', reject);
        outgoing.end();
    });

afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
    await Promise.all(compiledImages.splice(0).map(file => rm(file, { force: true })));
    await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { force: true, recursive: true })));
});

describe('Service Interface static HTTP roots [SI-1.1]', () => {
    it.each([undefined, '/epg'] as const)(
        'serves frontend, image, thumbnail and exact HLS assets below subDirectory=%s',
        async subDirectory => {
            const root = await mkdtemp(join(tmpdir(), 'epgstation-service-interface-'));
            temporaryRoots.push(root);
            const frontend = join(root, 'frontend');
            const thumbnail = join(root, 'thumbnail');
            const stream = join(root, 'streamfiles');
            const outsideSentinel = join(root, 'outside-sentinel.txt');
            const outsideSentinelBody = 'must-not-escape';
            await Promise.all([mkdir(frontend), mkdir(thumbnail), mkdir(stream)]);
            await Promise.all([
                writeFile(join(frontend, 'index.html'), 'frontend-sentinel'),
                writeFile(join(thumbnail, 'thumb.txt'), 'thumbnail-sentinel'),
                writeFile(join(stream, 'stream81.m3u8'), 'hls-parent-sentinel'),
                writeFile(join(stream, 'stream810.m3u8'), 'neighbor-sentinel'),
                writeFile(outsideSentinel, outsideSentinelBody),
            ]);

            const compiledImageDirectory = join(compiledSnapshot, '..', 'img');
            await mkdir(compiledImageDirectory, { recursive: true });
            const imageName = `service-interface-${process.pid}.png`;
            const imagePath = join(compiledImageDirectory, imageName);
            const imageOutsideName = `service-interface-outside-${process.pid}.txt`;
            const imageOutsidePath = join(compiledImageDirectory, '..', imageOutsideName);
            const imageOutsideSentinelBody = 'image-must-not-escape';
            compiledImages.push(imagePath, imageOutsidePath);
            await Promise.all([
                writeFile(imagePath, 'image-sentinel'),
                writeFile(imageOutsidePath, imageOutsideSentinelBody),
            ]);
            ServiceServer.FRONTEND_DIST_DIR = frontend;
            const fixture = Object.create(ServiceServer.prototype) as any;
            fixture.app = express();
            fixture.config = {};
            fixture.config.streamFilePath = stream;
            fixture.config.subDirectory = subDirectory;
            fixture.config.thumbnail = thumbnail;
            fixture.setStaticFiles();
            const server = fixture.app.listen(0);
            servers.push(server);
            await new Promise<void>(resolve => server.once('listening', resolve));
            const address = server.address();
            if (address === null || typeof address === 'string') throw new Error('HTTP fixture did not bind TCP');
            const origin = loopbackOrigin(address.port);
            const base = `${origin}${subDirectory ?? ''}`;

            await expect(fetch(`${base}/`)).resolves.toMatchObject({ status: 200 });
            await expect((await fetch(`${base}/`)).text()).resolves.toBe('frontend-sentinel');
            await expect((await fetch(`${base}/img/${imageName}`)).text()).resolves.toBe('image-sentinel');
            await expect((await fetch(`${base}/thumbnail/thumb.txt`)).text()).resolves.toBe('thumbnail-sentinel');
            await expect((await fetch(`${base}/streamfiles/stream81.m3u8`)).text()).resolves.toBe(
                'hls-parent-sentinel',
            );
            expect(await (await fetch(`${base}/streamfiles/stream810.m3u8`)).text()).toBe('neighbor-sentinel');
            expect((await fetch(`${base}/thumbnail/missing.txt`)).status).toBe(404);
            expect((await fetch(`${base}/streamfiles/missing.m3u8`)).status).toBe(404);
            for (const { outsideName, publicRoot, sentinelBody } of [
                { outsideName: 'outside-sentinel.txt', publicRoot: '', sentinelBody: outsideSentinelBody },
                { outsideName: imageOutsideName, publicRoot: 'img', sentinelBody: imageOutsideSentinelBody },
                { outsideName: 'outside-sentinel.txt', publicRoot: 'thumbnail', sentinelBody: outsideSentinelBody },
                { outsideName: 'outside-sentinel.txt', publicRoot: 'streamfiles', sentinelBody: outsideSentinelBody },
            ]) {
                const mount = [subDirectory ?? '', publicRoot]
                    .map(segment => segment.replace(/^\/+|\/+$/gu, ''))
                    .filter(segment => segment !== '')
                    .join('/');
                const publicPrefix = mount === '' ? '' : `/${mount}`;
                for (const path of [
                    `${publicPrefix}/../${outsideName}`,
                    `${publicPrefix}/%2e%2e/${outsideName}`,
                    `${publicPrefix}/%2e%2e%2f${outsideName}`,
                    `${publicPrefix}/%2Fetc%2Fpasswd`,
                ]) {
                    const result = await rawGet(origin, path);
                    expect(result.status).toBe(404);
                    expect(result.body).not.toContain(sentinelBody);
                }
            }
            if (subDirectory !== undefined) {
                expect((await fetch(`${origin}/thumbnail/thumb.txt`)).status).toBe(404);
            }
        },
    );
});

describe('Service Interface Swagger availability [SI-1.2]', () => {
    it.each([
        ['absent', false],
        ['present', true],
    ] as const)('provides the documentation screen only when its distribution is %s', async (_name, present) => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-service-swagger-'));
        temporaryRoots.push(root);
        ServiceServer.SWAGGER_UI_DIST = present
            ? join(process.cwd(), 'node_modules', 'swagger-ui-dist')
            : join(root, 'missing-swagger-dist');
        const fixture = Object.create(ServiceServer.prototype) as any;
        fixture.app = express();
        fixture.config = {};
        const documentationBase = `/${'epg'}`;
        fixture.config.subDirectory = documentationBase;
        fixture.setSwaggerUI();
        const server = fixture.app.listen(0);
        servers.push(server);
        await new Promise<void>(resolve => server.once('listening', resolve));
        const address = server.address();
        if (address === null || typeof address === 'string') throw new Error('HTTP fixture did not bind TCP');
        const base = loopbackOrigin(address.port);

        const debug = await fetch(`${base}/epg/api/debug`, { redirect: 'manual' });
        expect(debug.status).toBe(present ? 302 : 404);
        if (present) {
            expect(debug.headers.get('location')).toBe('/epg/api-docs?url=/epg/api/docs');
            const initializer = await fetch(`${base}/epg/api-docs/swagger-initializer.js`);
            expect(initializer.status).toBe(200);
            expect(await initializer.text()).toContain('/epg/api/docs');
        }
    });
});
