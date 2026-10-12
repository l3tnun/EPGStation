import express from 'express';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { close, compiled, compiledSnapshot, listen, modelContainer, require } from './_harness';
import { allRouteCases, streamRouteCases } from './route-contracts';

const ServiceServer = (require(compiled('model', 'service', 'ServiceServer.js')) as any).default;
const SocketIOManageModel = (require(compiled('model', 'service', 'socketio', 'SocketIOManageModel.js')) as any)
    .default;
const servers: Server[] = [];
const socketServers: any[] = [];
// SI-1.1's version/docs test below needs a real, on-disk `package.json` next to a compiled
// `dist` so the production `model/service/api/version.js` (loaded by express-openapi's own
// internal `require()` from `ServiceServer.API_DIR`, which this repository's own module
// loading rules do not let a test intercept the way `vi.doMock('node:fs', ...)` intercepts a
// test-driven `import()`) can resolve `<its own dirname>/../../../../package.json` the same
// way production does. `compiledSnapshot` is the ONE compiled-dist root the whole test layer's
// worker pool shares for this entire run (`scripts/server-test/compiled-snapshot.mjs`'s single
// per-layer `withCompiledSnapshot` call): writing a `package.json` there -- even transiently --
// is a file every other concurrently running worker's own module resolution can walk into,
// including a worker mid-`import`/`require` of an unrelated compiled module whose nearest
// ancestor `package.json` search passes through that same directory. A private per-test copy
// keeps this test's `package.json` write from ever being visible to any other file's resolution.
//
// The private root is created under this repository's own `test/server/.artifacts/` tree
// (excluded from Vitest collection by `vitest.server.config.ts`'s `exclude: ['.artifacts/**']`)
// rather than the OS temp dir: the compiled dist's own third-party imports (e.g. `express`)
// resolve `node_modules` by walking up from the loaded file, and only an ancestor chain that
// still passes through this repository's root carries that `node_modules`. A distinct
// `private-manifest-*` prefix keeps this from ever being confused with the shared per-run
// `compiled-dist-*` root `compiled-snapshot.mjs` owns.
// `mkdtemp` only claims the private root's own name; it does not populate it. Populating it (the
// `cp` below) is left to the caller's own `try` so that a `cp` failure still runs inside the same
// `finally` that removes `root` -- otherwise a `cp` failure between `mkdtemp` succeeding and the
// caller's `try` starting would leak the private root under `test/server/.artifacts/private-manifest/`.
const privateManifestParent = resolve('test/server/.artifacts/private-manifest');
const privateManifestRoot = async (): Promise<{ readonly apiDir: string; readonly dist: string; readonly root: string }> => {
    await mkdir(privateManifestParent, { recursive: true });
    const root = await mkdtemp(join(privateManifestParent, 'private-manifest-'));
    const dist = join(root, 'dist');
    return { apiDir: join(dist, 'model', 'service', 'api'), dist, root };
};
const defaultApiDir = join(compiledSnapshot, 'model', 'service', 'api');

interface WireResponse {
    readonly body: string;
    readonly headers: IncomingHttpHeaders;
    readonly status: number;
}

const exchange = (
    origin: string,
    path: string,
    options: { readonly body?: string; readonly headers?: Record<string, string>; readonly method?: string } = {},
): Promise<WireResponse> =>
    new Promise((resolve, reject) => {
        const target = new URL(origin);
        const outgoing = request(
            {
                headers: options.headers,
                hostname: target.hostname,
                method: options.method ?? 'GET',
                path,
                port: target.port,
            },
            response => {
                const chunks: Buffer[] = [];
                response.on('data', chunk => chunks.push(Buffer.from(chunk)));
                response.once('end', () =>
                    resolve({
                        body: Buffer.concat(chunks).toString('utf8'),
                        headers: response.headers,
                        status: response.statusCode ?? 0,
                    }),
                );
            },
        );
        outgoing.once('error', reject);
        if (options.body !== undefined) outgoing.write(options.body);
        outgoing.end();
    });

afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(socketServers.splice(0).map(io => new Promise<void>(resolve => io.close(resolve))));
    await Promise.all(servers.splice(0).map(server => (server.listening ? close(server) : Promise.resolve())));
});

describe('SI-1.1 actual OpenAPI carrier base', () => {
    it.each([undefined, '/epg'] as const)(
        'serves version and machine-readable docs below subDirectory=%s',
        async subDirectory => {
            const pkg = require(join(process.cwd(), 'package.json')) as { name: string; version: string };
            const { apiDir, dist, root } = await privateManifestRoot();
            try {
                await cp(compiledSnapshot, dist, { recursive: true });
                await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
                const fixture = Object.create(ServiceServer.prototype) as any;
                fixture.app = express();
                fixture.config = { apiServers: ['http://synthetic.invalid'], subDirectory };
                fixture.log = { system: { error: vi.fn() } };
                ServiceServer.API_YML = join(process.cwd(), 'api.yml');
                ServiceServer.PACKAGE_JSON = join(process.cwd(), 'package.json');
                ServiceServer.API_DIR = apiDir;
                const document = fixture.getApiDocument(ServiceServer.API_YML);
                fixture.initOpenApi(document);
                const server = fixture.app.listen(0, '127.0.0.1');
                servers.push(server);
                const origin = await listen(server);
                const base = subDirectory ?? '';

                const version = await exchange(origin, `${base}/api/version`);
                expect(version.status).toBe(200);
                expect(version.headers['content-type']).toContain('application/json');
                expect(JSON.parse(version.body)).toEqual({ version: pkg.version });

                const docs = await exchange(origin, `${base}/api/docs`);
                expect(docs.status).toBe(200);
                expect(docs.headers['content-type']).toContain('application/json');
                const publicDocument = JSON.parse(docs.body);
                expect(publicDocument).toMatchObject({ info: { title: pkg.name, version: pkg.version } });
                for (const contract of allRouteCases) {
                    const method = contract.method === 'del' ? 'delete' : contract.method;
                    expect(
                        publicDocument.paths[`/${contract.file}`]?.[method],
                        `${method} /${contract.file}`,
                    ).toBeTypeOf('object');
                }
                for (const contract of streamRouteCases) {
                    expect(publicDocument.paths[`/${contract.file}`]?.get, `get /${contract.file}`).toBeTypeOf(
                        'object',
                    );
                }
                if (subDirectory !== undefined) {
                    await expect(exchange(origin, '/api/version')).resolves.toMatchObject({ status: 404 });
                    await expect(exchange(origin, '/api/docs')).resolves.toMatchObject({ status: 404 });
                }
            } finally {
                ServiceServer.API_DIR = defaultApiDir;
                await rm(root, { force: true, recursive: true });
            }
        },
    );
});

describe('SI-1.1 actual Socket.IO carrier path', () => {
    it.each([undefined, '/epg'] as const)('accepts polling handshake below subDirectory=%s', async subDirectory => {
        const model = new SocketIOManageModel(
            { getLogger: () => ({ system: { info: vi.fn() } }) },
            { getConfig: () => ({ subDirectory }) },
        );
        const server = createServer((_request, response) => {
            response.writeHead(404);
            response.end();
        });
        servers.push(server);
        model.initialize([server]);
        socketServers.push(...model.ios);
        server.listen(0, '127.0.0.1');
        const origin = await listen(server);
        const base = subDirectory ?? '';

        const handshake = await exchange(origin, `${base}/socket.io/?EIO=4&transport=polling`);

        expect(handshake.status).toBe(200);
        expect(handshake.headers['content-type']).toContain('text/plain');
        expect(handshake.body).toMatch(/^0\{"sid":/u);
        if (subDirectory !== undefined) {
            await expect(exchange(origin, '/socket.io/?EIO=4&transport=polling')).resolves.not.toMatchObject({
                status: 200,
            });
        }
    });
});

describe('SI-1.3 actual request Host extraction', () => {
    it.each([undefined, '/epg'] as const)(
        'passes request Host and forwarded HTTPS to playlist below %s',
        async base => {
            const getM3u8 = vi.fn().mockResolvedValue({
                name: 'synthetic.m3u8',
                playList: '#EXTM3U\n./streamfiles/stream81.m3u8',
            });
            vi.spyOn(modelContainer, 'get').mockReturnValue({ getM3u8 });
            const route = require(compiled('model', 'service', 'api', 'videos', '{videoFileId}', 'playlist.js')) as any;
            const app = express();
            app.get(`${base ?? ''}/api/videos/:videoFileId/playlist`, route.get);
            const server = app.listen(0, '127.0.0.1');
            servers.push(server);
            const origin = await listen(server);

            const response = await exchange(origin, `${base ?? ''}/api/videos/22/playlist`, {
                headers: {
                    Host: 'receiver.invalid:8443',
                    'User-Agent': 'synthetic-agent',
                    'X-Forwarded-Proto': 'https',
                },
            });

            expect(getM3u8).toHaveBeenCalledOnce();
            expect(getM3u8).toHaveBeenCalledWith('receiver.invalid:8443', true, 22);
            expect(response.status).toBe(200);
            expect(response.headers['content-type']).toContain('application/x-mpegURL');
            expect(response.body).toBe('#EXTM3U\n./streamfiles/stream81.m3u8');
        },
    );

    it.each([undefined, '/epg'] as const)('passes request Host and forwarded HTTPS to Kodi below %s', async base => {
        const sendToKodi = vi.fn().mockResolvedValue(undefined);
        vi.spyOn(modelContainer, 'get').mockReturnValue({ sendToKodi });
        const route = require(compiled('model', 'service', 'api', 'videos', '{videoFileId}', 'kodi.js')) as any;
        const app = express();
        app.use(express.json());
        app.post(`${base ?? ''}/api/videos/:videoFileId/kodi`, route.post);
        const server = app.listen(0, '127.0.0.1');
        servers.push(server);
        const origin = await listen(server);
        const body = JSON.stringify({ kodiName: 'living-room' });

        const response = await exchange(origin, `${base ?? ''}/api/videos/22/kodi`, {
            body,
            headers: {
                'Content-Length': String(Buffer.byteLength(body)),
                'Content-Type': 'application/json',
                Host: 'receiver.invalid:8443',
                'X-Forwarded-Proto': 'https',
            },
            method: 'POST',
        });

        expect(sendToKodi).toHaveBeenCalledOnce();
        expect(sendToKodi).toHaveBeenCalledWith('receiver.invalid:8443', true, 'living-room', 22);
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('application/json');
        expect(JSON.parse(response.body)).toEqual({ code: 200 });
    });
});
