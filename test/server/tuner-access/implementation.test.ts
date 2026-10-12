import 'reflect-metadata';

import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { Container } from 'inversify';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const ChannelApiModel = (require(join(compiledSnapshot, 'model', 'api', 'channel', 'ChannelApiModel.js')) as any)
    .default;
const { parseConnectionTarget } = require(
    join(compiledSnapshot, 'model', 'tuner', 'transport', 'ConnectionTargetParser.js'),
) as any;
const TunerServerAccessModel = (require(join(compiledSnapshot, 'model', 'tuner', 'TunerServerAccessModel.js')) as any)
    .default;
const ProductDetector = (require(join(compiledSnapshot, 'model', 'tuner', 'change', 'ProductDetector.js')) as any)
    .default;

// TA-1.10 / TA-6.4 exercise ModelContainerSetter's real `TunerServerAccess` binding, whose
// factory reads `<its own compiled file's dirname>/../../package.json`
// (src/model/ModelContainerSetter.ts) with no override hook -- unlike ServiceServer's
// PACKAGE_JSON static elsewhere in this suite, this path is fixed by wherever the loaded
// ModelContainerSetter.js module instance actually sits on disk. `compiledSnapshot` is the ONE
// compiled-dist root every worker in this test layer's run shares
// (scripts/server-test/compiled-snapshot.mjs's single per-layer `withCompiledSnapshot` call), so
// writing a package.json at its parent -- even transiently -- is visible to every other
// concurrently running worker's own module resolution, including one mid-`require`/`import` of
// an unrelated compiled module whose nearest-ancestor package.json search passes through that
// same directory (this is the documented cause of the intermittent cross-file
// `Invalid package config` failure this helper fixes). A private, per-test copy of the compiled
// snapshot -- with its own ModelContainerSetter require, since a distinct absolute path is a
// distinct require() cache entry with its own `import.meta.dirname` -- keeps this test's
// package.json write from ever being observable to any other file's resolution.
//
// The private root is created under this repository's own `test/server/.artifacts/` tree
// (excluded from Vitest collection by `vitest.server.config.ts`'s `exclude: ['.artifacts/**']`)
// rather than the OS temp dir: the compiled dist's own `require`/`import` of third-party
// packages (e.g. `axios`) resolves `node_modules` by walking up from the loaded file, and only
// an ancestor chain that still passes through this repository's root carries that
// `node_modules`. A distinct `private-manifest-*` prefix keeps this from ever being confused
// with the shared per-run `compiled-dist-*` root `compiled-snapshot.mjs` owns.
const privateManifestParent = resolve('test/server/.artifacts/private-manifest');
const withPrivateTunerContainerSetter = async <T>(
    manifest: { readonly name: string; readonly version: string },
    run: (privateContainerSetter: any) => Promise<T>,
): Promise<T> => {
    await mkdir(privateManifestParent, { recursive: true });
    const root = await mkdtemp(join(privateManifestParent, 'private-manifest-'));
    const dist = join(root, 'dist');
    try {
        await cp(compiledSnapshot, dist, { recursive: true });
        await writeFile(join(root, 'package.json'), JSON.stringify(manifest));
        const privateContainerSetter = require(join(dist, 'model', 'ModelContainerSetter.js')) as any;
        return await run(privateContainerSetter);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
};

describe('tuner access implementation baseline', () => {
    it('[TA-8.2] executes parser, facade route/normalizer, product probe, and deadline boundaries', async () => {
        expect(parseConnectionTarget('http://synthetic.invalid:40772/base')).toMatchObject({
            basePath: '/base',
            kind: 'http',
        });
        expect(() => parseConnectionTarget('https://synthetic.invalid:443')).toThrow();

        const getJson = vi.fn(async (path: string) => {
            if (path === '/api/status') return {};
            if (path === '/api/version') return { current: '3.8.0', latest: '9.7.5' };
            if (path === '/api/services') {
                return [
                    {
                        channel: { channel: '13', type: 'GR' },
                        hasLogoData: true,
                        id: 101,
                        name: 'synthetic',
                        networkId: 10,
                        serviceId: 102,
                        type: 1,
                    },
                ];
            }
            return {};
        });
        const access = new TunerServerAccessModel(
            'http://synthetic.invalid:40772',
            'epgstation/synthetic',
            { getBuffer: vi.fn(), getJson },
            { tunerRestRequestTimeoutMs: 1, tunerStreamEstablishmentTimeoutMs: 2_147_483_647 },
        );
        await expect(access.getStatus()).resolves.toMatchObject({ available: true, version: { current: '3.8.0' } });
        await expect(access.getServices()).resolves.toMatchObject([{ id: 101, name: 'synthetic' }]);
        expect(getJson).toHaveBeenCalledWith('/api/status', { signal: expect.anything() });
        expect(getJson).toHaveBeenCalledWith('/api/services', { signal: expect.anything() });
        expect(access.restTimeoutMs).toBe(1);
        expect(access.streamTimeoutMs).toBe(2_147_483_647);

        const detector = new ProductDetector(vi.fn(async () => ({ body: {}, status: 200 })));
        await expect(detector.detect()).resolves.toBe('mirakurun');
    });

    it('[TA-2.2] normalizes null and finite related-item network IDs through the public program DTO', async () => {
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
            getBuffer: vi.fn(),
            getJson: vi.fn(async () => [
                {
                    id: 30,
                    eventId: 31,
                    serviceId: 32,
                    networkId: 33,
                    startAt: 2_000,
                    duration: 60_000,
                    isFree: false,
                    relatedItems: [
                        { type: 'relay', networkId: null, serviceId: 32, eventId: 34 },
                        { type: 'movement', networkId: 33, serviceId: 32, eventId: 35 },
                    ],
                },
            ]),
        });

        const [program] = await access.getPrograms();

        expect(program.relatedItems).toEqual([
            { type: 'relay', serviceId: 32, eventId: 34 },
            { type: 'movement', networkId: 33, serviceId: 32, eventId: 35 },
        ]);
    });

    // The best-effort named-pipe request-seam characterization for this baseline lives in the
    // platform boundary file test/server/tuner-access/implementation.posix.test.ts, selected only
    // for the `posix` platform class by scripts/server-test/platform-boundary/selector.mjs before
    // Vitest collects tests. It is not duplicated or skipped here.

    // Requirement 1.10 / 1.11: mirakc は User-Agent の前方一致で EPGStation を識別し、一致したときだけ
    // 録画中の番組情報を EIT[p/f] で差し替える。判定は大文字小文字を区別するため、綴りを固定する。
    // package 名をそのまま使うと小文字で始まり、この経路を使えない。
    it('[TA-1.10] sends a User-Agent that starts with the EPGStation product token and its own version', async () => {
        await withPrivateTunerContainerSetter(
            { name: 'epgstation', type: 'module', version: 'synthetic' },
            async privateContainerSetter => {
                const container = new Container();
                privateContainerSetter.set(container);
                container.rebind('IConfiguration').toConstantValue({
                    getConfig: () => ({
                        mirakurunPath: 'http://synthetic.invalid:40772/base',
                        tunerRestRequestTimeoutMs: 101,
                        tunerStreamEstablishmentTimeoutMs: 202,
                    }),
                });

                const access = container.get<any>('TunerServerAccess');

                expect(access.transport.userAgent).toBe('EPGStation/synthetic');
                expect(access.transport.userAgent.startsWith('EPGStation/')).toBe(true);
            },
        );
    });

    it('[TA-6.4] shares one facade created from one startup connection and deadline snapshot', async () => {
        await withPrivateTunerContainerSetter(
            { name: 'epgstation', type: 'module', version: 'synthetic' },
            async privateContainerSetter => {
                const container = new Container();
                privateContainerSetter.set(container);
                const firstSnapshot = {
                    mirakurunPath: 'http://synthetic.invalid:40772/base',
                    tunerRestRequestTimeoutMs: 101,
                    tunerStreamEstablishmentTimeoutMs: 202,
                };
                const secondSnapshot = {
                    mirakurunPath: 'http://changed.invalid:40773/changed',
                    tunerRestRequestTimeoutMs: 303,
                    tunerStreamEstablishmentTimeoutMs: 404,
                };
                const getConfig = vi.fn().mockReturnValueOnce(firstSnapshot).mockReturnValue(secondSnapshot);
                container.rebind('IConfiguration').toConstantValue({ getConfig });

                const first = container.get<any>('TunerServerAccess');
                const second = container.get<any>('TunerServerAccess');

                expect(second).toBe(first);
                expect(getConfig).toHaveBeenCalledOnce();
                expect(first.restTimeoutMs).toBe(101);
                expect(first.streamTimeoutMs).toBe(202);
                expect(first.transport.target).toMatchObject({
                    kind: 'http',
                    host: 'synthetic.invalid',
                    port: 40772,
                    basePath: '/base',
                });
                expect(first.transport.userAgent).toBe('EPGStation/synthetic');
                expect(first.changeFeed).toEqual({
                    detector: expect.anything(),
                    mirakurun: expect.anything(),
                    mirakc: expect.anything(),
                });

                const options = { signal: new AbortController().signal };
                const probeJson = vi.spyOn(first.transport, 'probeJson').mockResolvedValue({ status: 200, body: {} });
                await expect(first.changeFeed.detector.detect(options)).resolves.toBe('mirakurun');
                expect(probeJson).toHaveBeenCalledWith('/api/config/server', options);

                const mirakurunStream = new PassThrough();
                const getStream = vi.spyOn(first.transport, 'getStream').mockResolvedValue(mirakurunStream);
                const mirakurunHandle = await first.changeFeed.mirakurun.open(
                    { started: vi.fn(), changed: vi.fn(), aborted: vi.fn() },
                    options,
                );
                expect(getStream).toHaveBeenCalledWith('/api/events/stream', options);
                mirakurunHandle.close();

                const mirakcStream = new PassThrough();
                const getRootStream = vi.spyOn(first.transport, 'getRootStream').mockResolvedValue(mirakcStream);
                const mirakcHandle = await first.changeFeed.mirakc.open(
                    { started: vi.fn(), changed: vi.fn(), aborted: vi.fn() },
                    options,
                );
                expect(getRootStream).toHaveBeenCalledWith('/events', options);
                mirakcHandle.close();
            },
        );
    });

    /**
     * Unlike `withPrivateTunerContainerSetter` above (needed because writing a `package.json` next
     * to the *shared* `compiledSnapshot` would race every other concurrently running worker's own
     * module resolution through that same directory -- the documented cause of an intermittent
     * cross-file `Invalid package config` failure), this mocks the one `readFileSync` call the
     * `TunerServerAccess` factory makes (`src/model/ModelContainerSetter.ts`'s
     * `readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')`) instead of
     * writing a real file anywhere, so `ModelContainerSetter.js` can be re-imported straight from the
     * shared canonical snapshot: no write, so no cross-worker race, and its V8 coverage attributes to
     * the same snapshot root every other test in this run already shares. A private per-test dist
     * copy's raw coverage is snapshot-external and never merges into `coverage-final.json` (see
     * `scripts/server-test/compiled-snapshot-coverage.mjs`'s module doc) -- this is the same factory
     * path `withPrivateTunerContainerSetter`'s own tests exercise, just resolved from a location the
     * converter's `snapshotRoots` actually includes.
     */
    it('[TA-1.10][TA-6.4] resolves the shared TunerServerAccess factory directly from the canonical compiled snapshot (no private dist copy)', async () => {
        const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
        const manifestPath = join(compiledSnapshot, '..', 'package.json');
        const fakeManifest = JSON.stringify({ name: 'epgstation', version: 'synthetic-shared-snapshot' });
        const mockedReadFileSync = (path: unknown, options?: unknown) =>
            path === manifestPath ? fakeManifest : (actualFs.readFileSync as any)(path, options);
        vi.doMock('node:fs', () => ({ ...actualFs, readFileSync: mockedReadFileSync }));
        vi.doMock('fs', () => ({ ...actualFs, readFileSync: mockedReadFileSync }));

        try {
            vi.resetModules();
            const sharedContainerSetter = (await import(join(compiledSnapshot, 'model', 'ModelContainerSetter.js'))) as {
                set: (container: Container) => void;
            };

            const container = new Container();
            sharedContainerSetter.set(container);
            container.rebind('IConfiguration').toConstantValue({
                getConfig: () => ({
                    mirakurunPath: 'http://synthetic.invalid:40772/base',
                    tunerRestRequestTimeoutMs: 111,
                    tunerStreamEstablishmentTimeoutMs: 222,
                }),
            });

            const access = container.get<any>('TunerServerAccess');

            expect(access.transport.userAgent).toBe('EPGStation/synthetic-shared-snapshot');
            expect(access.restTimeoutMs).toBe(111);
            expect(access.streamTimeoutMs).toBe(222);
            expect(access.changeFeed).toEqual({
                detector: expect.anything(),
                mirakurun: expect.anything(),
                mirakc: expect.anything(),
            });

            const second = container.get<any>('TunerServerAccess');
            expect(second).toBe(access);

            // The three change-feed adapters are constructed with callback arrow functions
            // (`options => transport.probeJson(...)` etc., src/model/ModelContainerSetter.ts around
            // the `TunerServerAccess` factory's `changeFeed` construction); those bodies only run
            // once `.detect()`/`.open()` is actually called, so exercise all three here too.
            const options = { signal: new AbortController().signal };
            const probeJson = vi.spyOn(access.transport, 'probeJson').mockResolvedValue({ status: 200, body: {} });
            await expect(access.changeFeed.detector.detect(options)).resolves.toBe('mirakurun');
            expect(probeJson).toHaveBeenCalledWith('/api/config/server', options);

            const mirakurunStream = new PassThrough();
            const getStream = vi.spyOn(access.transport, 'getStream').mockResolvedValue(mirakurunStream);
            const mirakurunHandle = await access.changeFeed.mirakurun.open(
                { started: vi.fn(), changed: vi.fn(), aborted: vi.fn() },
                options,
            );
            expect(getStream).toHaveBeenCalledWith('/api/events/stream', options);
            mirakurunHandle.close();

            const mirakcStream = new PassThrough();
            const getRootStream = vi.spyOn(access.transport, 'getRootStream').mockResolvedValue(mirakcStream);
            const mirakcHandle = await access.changeFeed.mirakc.open(
                { started: vi.fn(), changed: vi.fn(), aborted: vi.fn() },
                options,
            );
            expect(getRootStream).toHaveBeenCalledWith('/events', options);
            mirakcHandle.close();
        } finally {
            vi.doUnmock('node:fs');
            vi.doUnmock('fs');
            vi.resetModules();
        }
    });

    it('[TA-1.2] projects logo not-found locally but forwards upstream failure identity and does not retain a result', async () => {
        const missing = new ChannelApiModel(
            { findId: vi.fn().mockResolvedValue({ id: 1, hasLogoData: false }) },
            { getLogo: vi.fn() },
        );
        await expect(missing.getLogo(1)).rejects.toThrow('notfound');

        const upstreamFailure = new Error('synthetic upstream failure');
        const getLogo = vi.fn().mockRejectedValue(upstreamFailure);
        const upstream = new ChannelApiModel(
            { findId: vi.fn().mockResolvedValue({ id: 2, hasLogoData: true }) },
            { getLogo },
        );
        await expect(upstream.getLogo(2)).rejects.toBe(upstreamFailure);
        await expect(upstream.getLogo(2)).rejects.toBe(upstreamFailure);
        expect(getLogo).toHaveBeenCalledTimes(2);
    });
});
