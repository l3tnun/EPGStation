import express, { type Express } from 'express';
import * as openapi from 'express-openapi';
import { readFileSync } from 'node:fs';
import { createServer, get as httpGet, type Server } from 'node:http';
import { join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS,
    provisionMariaDb,
    type MariaDbRuntime,
} from '../../persistence/mysql-runtime';
import {
    createRepositoryPersistence,
    immediateRetry,
    repositoryOperator,
    type RepositoryDialect,
    type RepositoryPersistence,
} from '../../persistence/repository-harness';
import {
    ChannelDB,
    IPTVApiModel,
    loadModule,
    logger,
    makeChannel,
    makeDeferred,
    makeModel,
    makeProgram,
    makeResponse,
} from '../_harness';

const container = () => loadModule<any>('model', 'ModelContainer.js').default;
const loopbackHost = '127.0.0.1';
const apiPath = (...segments: string[]): string => ['', 'api', ...segments].join('/');
const xmltvTimezone = new Date().toString().replace(/^.*GMT([+-]\d{4}).*$/, '$1');

let maria: MariaDbRuntime | undefined;

beforeAll(async () => {
    maria = await provisionMariaDb();
}, MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS);

afterAll(async () => {
    await maria?.cleanup();
    maria = undefined;
});

const createOpenApiApp = async (observeResponse?: (response: any) => void): Promise<Express> => {
    const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
    if (snapshot === undefined) throw new Error('The compiled server snapshot is required');
    const apiDoc = loadYaml(readFileSync('api.yml', 'utf8')) as any;
    apiDoc.servers = [{ url: apiPath() }];
    const app = express();
    // 実装と同じ query の握り方を使う。Express 5 の req.query は参照ごとに別の object を
    // 返すため、これが無いと OpenAPI 層の型変換が次の参照に残らない。
    loadModule<any>('model', 'service', 'ServiceServer.js').holdParsedQuery(app);
    if (observeResponse !== undefined) {
        app.use((_request, response, next) => {
            observeResponse(response);
            next();
        });
    }
    await openapi.initialize({
        apiDoc,
        app,
        exposeApiDocs: false,
        paths: join(snapshot, 'model', 'service', 'api'),
        errorMiddleware: (error, _request, response, _next) => response.status(400).json(error),
    });
    return app;
};

const listen = (server: Server): Promise<number> =>
    new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, loopbackHost, () => {
            server.off('error', reject);
            const address = server.address();
            if (address === null || typeof address === 'string') return reject(new Error('Missing server address'));
            resolve(address.port);
        });
    });

type HttpProbeResult =
    | { readonly kind: 'aborted' }
    | { readonly kind: 'error'; readonly error: Error }
    | {
          readonly kind: 'response';
          readonly body: string;
          readonly contentType: string | undefined;
          readonly status: number;
      };

const startHttpProbe = (server: Server, port: number, path: string) => {
    let abortRequested = false;
    let responseCount = 0;
    let settled = false;
    let resolveCompletion!: (result: HttpProbeResult) => void;
    const completion = new Promise<HttpProbeResult>(resolve => {
        resolveCompletion = resolve;
    });
    const settle = (result: HttpProbeResult): void => {
        if (settled) return;
        settled = true;
        resolveCompletion(result);
    };
    const outgoing = httpGet({ host: loopbackHost, port, path, headers: { host: 'synthetic.invalid' } }, incoming => {
        responseCount += 1;
        incoming.setEncoding('utf8');
        let body = '';
        incoming.on('data', chunk => (body += chunk));
        incoming.on('error', error => settle({ kind: 'error', error }));
        incoming.on('end', () =>
            settle({
                kind: 'response',
                status: incoming.statusCode ?? 0,
                body,
                contentType: incoming.headers['content-type'],
            }),
        );
    });
    outgoing.once('error', error => {
        settle(abortRequested ? { kind: 'aborted' } : { kind: 'error', error });
    });
    outgoing.once('close', () => {
        if (abortRequested) settle({ kind: 'aborted' });
    });

    return {
        abort: (): void => {
            abortRequested = true;
            outgoing.destroy();
        },
        close: async (): Promise<void> => {
            outgoing.destroy();
            if (!server.listening) return;
            await new Promise<void>((resolve, reject) =>
                server.close(error => (error === undefined ? resolve() : reject(error))),
            );
        },
        completion,
        responseCount: (): number => responseCount,
    };
};

const requestDocument = async (
    app: Express,
    path: string,
): Promise<Extract<HttpProbeResult, { readonly kind: 'response' }>> => {
    const server = createServer(app);
    const port = await listen(server);
    const probe = startHttpProbe(server, port, path);
    try {
        const result = await probe.completion;
        if (result.kind === 'error') throw result.error;
        if (result.kind !== 'response') throw new Error('The synthetic HTTP document request was aborted');
        if (probe.responseCount() !== 1)
            throw new Error('The synthetic HTTP document request completed more than once');
        return result;
    } finally {
        probe.abort();
        await probe.close();
        if (server.listening) throw new Error('The synthetic HTTP server remained open');
    }
};

const repositoryDialects = ['sqlite', 'mysql'] as const;

const holdNextQueryRunnerQuery = (source: RepositoryPersistence['source']) => {
    const gate = makeDeferred<{ readonly error?: Error; readonly kind: 'reject' | 'resolve' }>();
    const queryStarted = makeDeferred<void>();
    const querySettled = makeDeferred<void>();
    const releaseCompleted = makeDeferred<void>();
    const originalCreateQueryRunner = source.createQueryRunner.bind(source);
    let intercepted = false;
    let interceptedQuerySettled = false;
    let queryHeld = false;
    let querySpy: ReturnType<typeof vi.spyOn> | undefined;
    let releaseSpy: ReturnType<typeof vi.spyOn> | undefined;
    const createQueryRunnerSpy = vi.spyOn(source, 'createQueryRunner').mockImplementation(((...arguments_: any[]) => {
        const queryRunner = originalCreateQueryRunner(...arguments_);
        if (intercepted) return queryRunner;
        intercepted = true;
        const originalQuery = queryRunner.query.bind(queryRunner);
        const originalRelease = queryRunner.release.bind(queryRunner);
        querySpy = vi.spyOn(queryRunner, 'query').mockImplementation(async (...queryArguments: any[]) => {
            if (queryHeld) return originalQuery(...queryArguments);
            queryHeld = true;
            queryStarted.resolve(undefined);
            try {
                const settlement = await gate.promise;
                if (settlement.kind === 'reject') throw settlement.error;
                return await originalQuery(...queryArguments);
            } finally {
                interceptedQuerySettled = true;
                querySettled.resolve(undefined);
            }
        });
        releaseSpy = vi.spyOn(queryRunner, 'release').mockImplementation(async () => {
            try {
                return await originalRelease();
            } finally {
                if (interceptedQuerySettled) releaseCompleted.resolve(undefined);
            }
        });
        return queryRunner;
    }) as RepositoryPersistence['source']['createQueryRunner']);

    return {
        createQueryRunnerSpy,
        querySettled: querySettled.promise,
        queryStarted: queryStarted.promise,
        reject: (error: Error): void => gate.resolve({ error, kind: 'reject' }),
        releaseCompleted: releaseCompleted.promise,
        releaseSpy: () => releaseSpy,
        resolve: (): void => gate.resolve({ kind: 'resolve' }),
        restore: (): void => {
            querySpy?.mockRestore();
            releaseSpy?.mockRestore();
            createQueryRunnerSpy.mockRestore();
        },
    };
};

const withRepositoryDialect = async (
    dialect: RepositoryDialect,
    run: (persistence: RepositoryPersistence) => Promise<void>,
): Promise<void> => {
    if (maria === undefined) throw new Error('The shared MariaDB runtime is required');
    const persistence = await createRepositoryPersistence(dialect, maria);
    try {
        await run(persistence);
    } finally {
        if (container().isBound('IIPTVApiModel')) container().unbind('IIPTVApiModel');
        await persistence.cleanup();
    }
    expect(persistence.source.isInitialized).toBe(false);
};

const xmltvTime = (time: number): string => {
    const value = new Date(time);
    const pad = (part: number): string => String(part).padStart(2, '0');
    return (
        String(value.getFullYear()).padStart(4, '0') +
        pad(value.getMonth() + 1) +
        pad(value.getDate()) +
        pad(value.getHours()) +
        pad(value.getMinutes()) +
        pad(value.getSeconds()) +
        ` ${xmltvTimezone}`
    );
};

const seedXmltvRepository = async (persistence: RepositoryPersistence, now: number): Promise<string> => {
    await persistence.source.getRepository(persistence.entities.Channel).insert({
        id: 80,
        serviceId: 801,
        networkId: 8,
        name: 'NORMAL-DB-CHANNEL',
        halfWidthName: 'HALF-DB-CHANNEL',
        remoteControlKeyId: 8,
        hasLogoData: false,
        channelTypeId: 0,
        channelType: 'GR',
        channel: 'synthetic-db-channel',
        type: 0x01,
    });
    await persistence.source.getRepository(persistence.entities.Program).insert(
        makeProgram({
            id: 8_001,
            channelId: 80,
            serviceId: 801,
            networkId: 8,
            eventId: 8_001,
            channelType: 'GR',
            channel: 'synthetic-db-channel',
            name: 'NORMAL-DB-PROGRAM',
            halfWidthName: 'HALF-DB-PROGRAM',
            description: 'NORMAL-DB-DESCRIPTION',
            halfWidthDescription: 'HALF-DB-DESCRIPTION',
            extended: null,
            halfWidthExtended: null,
            startAt: now + 1_000,
            endAt: now + 2_000,
            duration: 1_000,
            startHour: 0,
            week: 0,
        }),
    );
    return (
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<!DOCTYPE tv SYSTEM "xmltv.dtd">' +
        '<tv generator-info-name="EPGStation">' +
        '<channel id="80" tp="synthetic-db-channel"><display-name lang="ja_JP">NORMAL-DB-CHANNEL</display-name><service_id>801</service_id></channel>\n' +
        `<programme start="${xmltvTime(now + 1_000)}" stop="${xmltvTime(
            now + 2_000,
        )}" channel="80"><title lang="ja_JP">NORMAL-DB-PROGRAM</title>    <desc lang="ja_JP">NORMAL-DB-DESCRIPTION</desc></programme></tv>`
    );
};

const seedM3u8Repository = async (persistence: RepositoryPersistence): Promise<string> => {
    await persistence.source.getRepository(persistence.entities.Channel).insert({
        id: 71,
        serviceId: 701,
        networkId: 7,
        name: 'SYNTHETIC-M3U8-LIFECYCLE',
        halfWidthName: 'SYNTHETIC-M3U8-LIFECYCLE',
        remoteControlKeyId: 7,
        hasLogoData: true,
        channelTypeId: 1,
        channelType: 'BS',
        channel: 'synthetic-m3u8-lifecycle',
        type: 0x01,
    });
    return (
        '#EXTM3U\n' +
        '#KODIPROP:mimetype=video/mp2t\n' +
        '#EXTINF:-1 tvg-id="71" tvg-logo="http://synthetic.invalid/api/channels/71/logo" group-title="BS",SYNTHETIC-M3U8-LIFECYCLE　\n' +
        'http://synthetic.invalid/api/streams/live/71/m2ts?mode=6\n'
    );
};

const request = async (app: Express, path: string): Promise<{ status: number; body: string }> => {
    const server = createServer(app);
    const port = await listen(server);
    try {
        return await new Promise((resolve, reject) => {
            const outgoing = httpGet(
                { host: loopbackHost, port, path, headers: { host: 'synthetic.invalid' } },
                incoming => {
                    incoming.setEncoding('utf8');
                    let body = '';
                    incoming.on('data', chunk => (body += chunk));
                    incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, body }));
                },
            );
            outgoing.once('error', reject);
        });
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    }
};

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    for (const binding of ['IIPTVApiModel', 'IConfiguration']) {
        if (container().isBound(binding)) container().unbind(binding);
    }
});

describe('IPTV DB-to-HTTP adapter', () => {
    it('[Task 1.1] applies defaults and floors positive and negative decimals in actual OpenAPI middleware', async () => {
        const model = {
            getChannelList: vi.fn(async () => '#EXTM3U\n'),
            getEpg: vi.fn(async () => '<synthetic/>'),
        };
        container().bind('IIPTVApiModel').toConstantValue(model);
        container()
            .bind('IConfiguration')
            .toConstantValue({ getConfig: () => ({}) });
        const app = await createOpenApiApp();

        await expect(request(app, `${apiPath('iptv', 'channel.m3u8')}?mode=3.9&isHalfWidth=false`)).resolves.toEqual({
            status: 200,
            body: '#EXTM3U\n',
        });
        await expect(request(app, `${apiPath('iptv', 'epg.xml')}?days=-1.2&isHalfWidth=false`)).resolves.toEqual({
            status: 200,
            body: '<synthetic/>',
        });
        await expect(request(app, apiPath('iptv', 'epg.xml'))).resolves.toEqual({
            status: 200,
            body: '<synthetic/>',
        });

        expect(model.getChannelList).toHaveBeenCalledTimes(1);
        const [channelListInput] = model.getChannelList.mock.calls[0];
        expect(channelListInput).toMatchObject({ isHalfWidth: false, mode: 3 });
        expect(channelListInput.publicUrls.channelLogoUrl(42)).toBe('http://synthetic.invalid/api/channels/42/logo');
        expect(channelListInput.publicUrls.liveM2tsUrl(42, 3)).toBe(
            'http://synthetic.invalid/api/streams/live/42/m2ts?mode=3',
        );
        expect(model.getEpg).toHaveBeenNthCalledWith(1, -2, false);
        expect(model.getEpg).toHaveBeenNthCalledWith(2, 3, true);
    });

    it('[Task 2.2] carries configured SQLite channel order and ids through the HTTP handler as exact M3U8 bytes', async () => {
        const persistence = await createRepositoryPersistence('sqlite');
        try {
            await persistence.db.ChannelDB.insert([
                {
                    id: 30,
                    serviceId: 103,
                    networkId: 1,
                    name: 'synthetic-thirty',
                    remoteControlKeyId: 3,
                    hasLogoData: false,
                    channel: { type: 'GR', channel: 'synthetic-30' },
                    type: 0x01,
                },
                {
                    id: 10,
                    serviceId: 101,
                    networkId: 1,
                    name: 'synthetic-ten',
                    remoteControlKeyId: 1,
                    hasLogoData: false,
                    channel: { type: 'GR', channel: 'synthetic-10' },
                    type: 0x01,
                },
                {
                    id: 20,
                    serviceId: 102,
                    networkId: 1,
                    name: 'synthetic-twenty',
                    remoteControlKeyId: 2,
                    hasLogoData: true,
                    channel: { type: 'GR', channel: 'synthetic-20' },
                    type: 0x01,
                },
            ]);
            const channelDB = new ChannelDB(
                { getLogger: () => logger },
                { getConfig: () => ({ channelOrder: [20], sidOrder: [103] }) },
                repositoryOperator(persistence.source),
                immediateRetry,
            );
            const model = new IPTVApiModel(channelDB, {});
            container().bind('IIPTVApiModel').toConstantValue(model);
            container()
                .bind('IConfiguration')
                .toConstantValue({ getConfig: () => ({ subDirectory: '/synthetic-subdir' }) });
            const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'channel.m3u8.js').get;
            const response = makeResponse();

            await handler(
                {
                    headers: { host: 'synthetic.invalid' },
                    header: () => undefined,
                    protocol: 'http',
                    query: { mode: 6, isHalfWidth: false },
                },
                response,
            );

            expect(response.statusCode).toBe(200);
            expect(response.headers['Content-Type']).toBe('application/x-mpegURL; charset="UTF-8"');
            expect(Buffer.from(response.body, 'utf8')).toEqual(
                Buffer.from(
                    '#EXTM3U\n' +
                        '#KODIPROP:mimetype=video/mp2t\n' +
                        '#EXTINF:-1 tvg-id="20" tvg-logo="http://synthetic.invalid/synthetic-subdir/api/channels/20/logo" group-title="GR",synthetic-twenty　\n' +
                        'http://synthetic.invalid/synthetic-subdir/api/streams/live/20/m2ts?mode=6\n' +
                        '#KODIPROP:mimetype=video/mp2t\n' +
                        '#EXTINF:-1 tvg-id="10"  group-title="GR",synthetic-ten　\n' +
                        'http://synthetic.invalid/synthetic-subdir/api/streams/live/10/m2ts?mode=6\n' +
                        '#KODIPROP:mimetype=video/mp2t\n' +
                        '#EXTINF:-1 tvg-id="30"  group-title="GR",synthetic-thirty　\n' +
                        'http://synthetic.invalid/synthetic-subdir/api/streams/live/30/m2ts?mode=6\n',
                    'utf8',
                ),
            );
        } finally {
            await persistence.cleanup();
        }
        expect(persistence.source.isInitialized).toBe(false);
    });

    it('[Task 5.1] carries duplicate suffixes 0,2,3,4 through SQLite and the compiled M3U8 handler', async () => {
        const persistence = await createRepositoryPersistence('sqlite');
        try {
            await persistence.db.ChannelDB.insert(
                Array.from({ length: 4 }, (_, index) => ({
                    id: index + 1,
                    serviceId: 101 + index,
                    networkId: 1,
                    name: 'synthetic-duplicate',
                    remoteControlKeyId: index + 1,
                    hasLogoData: index % 2 === 0,
                    channel: { type: 'GR', channel: `synthetic-${index + 1}` },
                    type: 0x01,
                })),
            );
            const model = new IPTVApiModel(persistence.db.ChannelDB, persistence.db.ProgramDB);
            container().bind('IIPTVApiModel').toConstantValue(model);
            container()
                .bind('IConfiguration')
                .toConstantValue({ getConfig: () => ({}) });
            const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'channel.m3u8.js').get;
            const response = makeResponse();

            await handler(
                {
                    headers: { host: 'synthetic.invalid' },
                    header: () => undefined,
                    protocol: 'http',
                    query: { mode: 5, isHalfWidth: false },
                },
                response,
            );

            expect(response.statusCode).toBe(200);
            expect(response.headers['Content-Type']).toBe('application/x-mpegURL; charset="UTF-8"');
            expect(Buffer.from(response.body, 'utf8')).toEqual(
                Buffer.from(
                    '#EXTM3U\n' +
                        '#KODIPROP:mimetype=video/mp2t\n' +
                        '#EXTINF:-1 tvg-id="1" tvg-logo="http://synthetic.invalid/api/channels/1/logo" group-title="GR",synthetic-duplicate　\n' +
                        'http://synthetic.invalid/api/streams/live/1/m2ts?mode=5\n' +
                        '#KODIPROP:mimetype=video/mp2t\n' +
                        '#EXTINF:-1 tvg-id="2"  group-title="GR",synthetic-duplicate' +
                        ' '.repeat(2) +
                        '　\n' +
                        'http://synthetic.invalid/api/streams/live/2/m2ts?mode=5\n' +
                        '#KODIPROP:mimetype=video/mp2t\n' +
                        '#EXTINF:-1 tvg-id="3" tvg-logo="http://synthetic.invalid/api/channels/3/logo" group-title="GR",synthetic-duplicate' +
                        ' '.repeat(3) +
                        '　\n' +
                        'http://synthetic.invalid/api/streams/live/3/m2ts?mode=5\n' +
                        '#KODIPROP:mimetype=video/mp2t\n' +
                        '#EXTINF:-1 tvg-id="4"  group-title="GR",synthetic-duplicate' +
                        ' '.repeat(4) +
                        '　\n' +
                        'http://synthetic.invalid/api/streams/live/4/m2ts?mode=5\n',
                    'utf8',
                ),
            );
        } finally {
            await persistence.cleanup();
        }
        expect(persistence.source.isInitialized).toBe(false);
    });

    it('[Task 3.1 review] carries inclusive wave endpoints and SQLite tie order through the compiled XML handler', async () => {
        const persistence = await createRepositoryPersistence('sqlite');
        const now = 1_700_000_000_000;
        const periodEnd = now + 24 * 60 * 60 * 1_000;
        try {
            await persistence.db.ChannelDB.insert([
                {
                    id: 10,
                    serviceId: 101,
                    networkId: 1,
                    name: 'synthetic-gr',
                    remoteControlKeyId: 1,
                    hasLogoData: false,
                    channel: { type: 'GR', channel: 'synthetic-gr' },
                    type: 0x01,
                },
                {
                    id: 20,
                    serviceId: 201,
                    networkId: 2,
                    name: 'synthetic-bs',
                    remoteControlKeyId: 2,
                    hasLogoData: false,
                    channel: { type: 'BS', channel: 'synthetic-bs' },
                    type: 0x01,
                },
                {
                    id: 30,
                    serviceId: 301,
                    networkId: 3,
                    name: 'synthetic-cs',
                    remoteControlKeyId: 3,
                    hasLogoData: false,
                    channel: { type: 'CS', channel: 'synthetic-cs' },
                    type: 0x01,
                },
                {
                    id: 40,
                    serviceId: 401,
                    networkId: 4,
                    name: 'synthetic-sky',
                    remoteControlKeyId: 4,
                    hasLogoData: false,
                    channel: { type: 'SKY', channel: 'synthetic-sky' },
                    type: 0x01,
                },
            ]);
            const program = (
                id: number,
                channelId: number,
                channelType: string,
                name: string,
                startAt: number,
                endAt: number,
            ) =>
                makeProgram({
                    id,
                    channelId,
                    serviceId: channelId * 10 + 1,
                    networkId: channelId / 10,
                    eventId: id,
                    channelType,
                    channel: `synthetic-${channelType.toLowerCase()}`,
                    name,
                    halfWidthName: name,
                    description: null,
                    halfWidthDescription: null,
                    extended: null,
                    halfWidthExtended: null,
                    startAt,
                    endAt,
                    duration: endAt - startAt,
                    startHour: 0,
                    week: 0,
                });
            await persistence.source
                .getRepository(persistence.entities.Program)
                .insert([
                    program(900, 10, 'GR', 'excluded-before', now - 2_000, now - 1),
                    program(1_001, 10, 'GR', 'gr-start-endpoint', now - 1_000, now),
                    program(2_001, 20, 'BS', 'bs-same-first', now + 1_000, now + 2_000),
                    program(2_002, 20, 'BS', 'bs-same-second', now + 1_000, now + 2_000),
                    program(3_001, 30, 'CS', 'cs-end-endpoint', periodEnd, periodEnd + 1_000),
                    program(4_001, 40, 'SKY', 'sky-inside', now + 500, now + 1_500),
                    program(4_900, 40, 'SKY', 'excluded-after', periodEnd + 1, periodEnd + 2_000),
                ]);

            const schedule = await persistence.db.ProgramDB.findSchedule({
                startAt: now,
                endAt: periodEnd,
                isHalfWidth: false,
                types: ['GR', 'BS', 'CS', 'SKY'],
            });
            expect(schedule.map((row: Record<string, any>) => Number(row.id))).toEqual([
                1_001, 4_001, 2_001, 2_002, 3_001,
            ]);

            const model = new IPTVApiModel(persistence.db.ChannelDB, persistence.db.ProgramDB);
            container().bind('IIPTVApiModel').toConstantValue(model);
            const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'epg.xml.js').get;
            const response = makeResponse();
            vi.useFakeTimers();
            vi.setSystemTime(now);

            await handler({ query: { days: 1, isHalfWidth: false } }, response);

            expect(response.statusCode).toBe(200);
            expect(response.headers['Content-Type']).toBe('application/xml; charset="UTF-8"');
            expect(Buffer.from(response.body, 'utf8')).toEqual(
                Buffer.from(
                    '<?xml version="1.0" encoding="UTF-8"?>' +
                        '<!DOCTYPE tv SYSTEM "xmltv.dtd">' +
                        '<tv generator-info-name="EPGStation">' +
                        '<channel id="10" tp="synthetic-gr"><display-name lang="ja_JP">synthetic-gr</display-name><service_id>101</service_id></channel>\n' +
                        `<programme start="${model.getTimeStr(now - 1_000)}" stop="${model.getTimeStr(now)}" channel="10"><title lang="ja_JP">gr-start-endpoint</title></programme>` +
                        '<channel id="20" tp="synthetic-bs"><display-name lang="ja_JP">synthetic-bs</display-name><service_id>201</service_id></channel>\n' +
                        `<programme start="${model.getTimeStr(now + 1_000)}" stop="${model.getTimeStr(now + 2_000)}" channel="20"><title lang="ja_JP">bs-same-first</title></programme>` +
                        `<programme start="${model.getTimeStr(now + 1_000)}" stop="${model.getTimeStr(now + 2_000)}" channel="20"><title lang="ja_JP">bs-same-second</title></programme>` +
                        '<channel id="30" tp="synthetic-cs"><display-name lang="ja_JP">synthetic-cs</display-name><service_id>301</service_id></channel>\n' +
                        `<programme start="${model.getTimeStr(periodEnd)}" stop="${model.getTimeStr(periodEnd + 1_000)}" channel="30"><title lang="ja_JP">cs-end-endpoint</title></programme>` +
                        '<channel id="40" tp="synthetic-sky"><display-name lang="ja_JP">synthetic-sky</display-name><service_id>401</service_id></channel>\n' +
                        `<programme start="${model.getTimeStr(now + 500)}" stop="${model.getTimeStr(now + 1_500)}" channel="40"><title lang="ja_JP">sky-inside</title></programme>` +
                        '</tv>',
                    'utf8',
                ),
            );
        } finally {
            vi.useRealTimers();
            await persistence.cleanup();
        }
        expect(persistence.source.isInitialized).toBe(false);
    });

    it('[Task 1.1/3.1/3.2] carries explicit normal-width XML query values and exact bytes through the HTTP handler', async () => {
        const channel = makeChannel();
        const program = makeProgram();
        const harness = makeModel({
            channelDB: { findAll: async () => [channel] },
            programDB: { findSchedule: async () => [program] },
        });
        container().bind('IIPTVApiModel').toConstantValue(harness.model);
        const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'epg.xml.js').get;
        const response = makeResponse();
        await handler({ query: { days: 3, isHalfWidth: false } }, response);
        expect(response.statusCode).toBe(200);
        expect(response.headers['Content-Type']).toBe('application/xml; charset="UTF-8"');
        expect(response.body).toBe(
            '<?xml version="1.0" encoding="UTF-8"?>' +
                '<!DOCTYPE tv SYSTEM "xmltv.dtd">' +
                '<tv generator-info-name="EPGStation">' +
                '<channel id="10" tp="synthetic-channel">' +
                '<display-name lang="ja_JP">通常局</display-name>' +
                '<service_id>101</service_id></channel>\n' +
                `<programme start="${harness.model.getTimeStr(program.startAt)}" stop="${harness.model.getTimeStr(program.endAt)}" channel="10">` +
                '<title lang="ja_JP">通常番組</title>    <desc lang="ja_JP">通常説明通常詳細</desc></programme></tv>',
        );
    });

    it('[Task 4.2] isolates sequential and concurrent exact XML projections over one SQLite fixture', async () => {
        const persistence = await createRepositoryPersistence('sqlite');
        const now = 1_700_000_000_000;
        try {
            await persistence.source.getRepository(persistence.entities.Channel).insert({
                id: 50,
                serviceId: 501,
                networkId: 5,
                name: 'NORMAL-CHANNEL',
                halfWidthName: 'HALF-CHANNEL',
                remoteControlKeyId: 1,
                hasLogoData: false,
                channelTypeId: 0,
                channelType: 'GR',
                channel: 'synthetic-projection',
                type: 0x01,
            });
            const programme = (
                id: number,
                offset: number,
                values: Record<string, string | null>,
            ): Record<string, any> =>
                makeProgram({
                    id,
                    channelId: 50,
                    serviceId: 501,
                    networkId: 5,
                    eventId: id,
                    channelType: 'GR',
                    channel: 'synthetic-projection',
                    startAt: now + offset,
                    endAt: now + offset + 1_000,
                    duration: 1_000,
                    startHour: 0,
                    week: 0,
                    ...values,
                });
            await persistence.source.getRepository(persistence.entities.Program).insert([
                programme(5_001, 1_000, {
                    name: 'NORMAL<A>\x1a',
                    halfWidthName: 'HALF<A>\x1a',
                    description: 'NORMAL&A\x1a',
                    halfWidthDescription: 'HALF&A\x1a',
                    extended: '"NORMAL-A"\'',
                    halfWidthExtended: '"HALF-A"\'',
                }),
                programme(5_002, 2_000, {
                    name: 'NORMAL-B',
                    halfWidthName: 'HALF-B',
                    description: 'NORMAL-B-DESCRIPTION',
                    halfWidthDescription: 'HALF-B-DESCRIPTION',
                    extended: null,
                    halfWidthExtended: null,
                }),
                programme(5_003, 3_000, {
                    name: 'NORMAL-C',
                    halfWidthName: 'HALF-C',
                    description: null,
                    halfWidthDescription: null,
                    extended: 'IGNORED-NORMAL-C',
                    halfWidthExtended: 'IGNORED-HALF-C',
                }),
                programme(5_004, 4_000, {
                    name: 'NORMAL-D',
                    halfWidthName: 'HALF-D',
                    description: null,
                    halfWidthDescription: null,
                    extended: null,
                    halfWidthExtended: null,
                }),
            ]);
            const channelRepository = persistence.source.getRepository(persistence.entities.Channel);
            const programRepository = persistence.source.getRepository(persistence.entities.Program);
            const snapshot = {
                channels: (await channelRepository.find({ order: { id: 'ASC' } })).map(row => ({ ...row })),
                programs: (await programRepository.find({ order: { id: 'ASC' } })).map(row => ({ ...row })),
            };
            const model = new IPTVApiModel(persistence.db.ChannelDB, persistence.db.ProgramDB);
            container().bind('IIPTVApiModel').toConstantValue(model);
            const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'epg.xml.js').get;
            const sequentialNormalResponse = makeResponse();
            const sequentialHalfWidthResponse = makeResponse();
            const concurrentNormalResponse = makeResponse();
            const concurrentHalfWidthResponse = makeResponse();
            vi.useFakeTimers();
            vi.setSystemTime(now);
            try {
                await handler({ query: { days: 1, isHalfWidth: false } }, sequentialNormalResponse);
                await handler({ query: { days: 1, isHalfWidth: true } }, sequentialHalfWidthResponse);
                await Promise.all([
                    handler({ query: { days: 1, isHalfWidth: false } }, concurrentNormalResponse),
                    handler({ query: { days: 1, isHalfWidth: true } }, concurrentHalfWidthResponse),
                ]);
            } finally {
                vi.useRealTimers();
            }

            const documentPrefix =
                '<?xml version="1.0" encoding="UTF-8"?>' +
                '<!DOCTYPE tv SYSTEM "xmltv.dtd">' +
                '<tv generator-info-name="EPGStation">';
            const channelPrefix = '<channel id="50" tp="synthetic-projection"><display-name lang="ja_JP">';
            const channelSuffix = '</display-name><service_id>501</service_id></channel>\n';
            const normalDocument =
                documentPrefix +
                channelPrefix +
                'NORMAL-CHANNEL' +
                channelSuffix +
                `<programme start="${model.getTimeStr(now + 1_000)}" stop="${model.getTimeStr(now + 2_000)}" channel="50"><title lang="ja_JP">NORMAL＜A＞</title>    <desc lang="ja_JP">NORMAL＆A”NORMAL-A”’</desc></programme>` +
                `<programme start="${model.getTimeStr(now + 2_000)}" stop="${model.getTimeStr(now + 3_000)}" channel="50"><title lang="ja_JP">NORMAL-B</title>    <desc lang="ja_JP">NORMAL-B-DESCRIPTION</desc></programme>` +
                `<programme start="${model.getTimeStr(now + 3_000)}" stop="${model.getTimeStr(now + 4_000)}" channel="50"><title lang="ja_JP">NORMAL-C</title></programme>` +
                `<programme start="${model.getTimeStr(now + 4_000)}" stop="${model.getTimeStr(now + 5_000)}" channel="50"><title lang="ja_JP">NORMAL-D</title></programme>` +
                '</tv>';
            const halfWidthDocument =
                documentPrefix +
                channelPrefix +
                'HALF-CHANNEL' +
                channelSuffix +
                `<programme start="${model.getTimeStr(now + 1_000)}" stop="${model.getTimeStr(now + 2_000)}" channel="50"><title lang="ja_JP">HALF＜A＞</title>    <desc lang="ja_JP">HALF＆A”HALF-A”’</desc></programme>` +
                `<programme start="${model.getTimeStr(now + 2_000)}" stop="${model.getTimeStr(now + 3_000)}" channel="50"><title lang="ja_JP">HALF-B</title>    <desc lang="ja_JP">HALF-B-DESCRIPTION</desc></programme>` +
                `<programme start="${model.getTimeStr(now + 3_000)}" stop="${model.getTimeStr(now + 4_000)}" channel="50"><title lang="ja_JP">HALF-C</title></programme>` +
                `<programme start="${model.getTimeStr(now + 4_000)}" stop="${model.getTimeStr(now + 5_000)}" channel="50"><title lang="ja_JP">HALF-D</title></programme>` +
                '</tv>';
            for (const [response, document] of [
                [sequentialNormalResponse, normalDocument],
                [sequentialHalfWidthResponse, halfWidthDocument],
                [concurrentNormalResponse, normalDocument],
                [concurrentHalfWidthResponse, halfWidthDocument],
            ] as const) {
                expect(Buffer.from(response.body, 'utf8')).toEqual(Buffer.from(document, 'utf8'));
                expect(response.statusCode).toBe(200);
                expect(response.headers['Content-Type']).toBe('application/xml; charset="UTF-8"');
            }
            expect({
                channels: (await channelRepository.find({ order: { id: 'ASC' } })).map(row => ({ ...row })),
                programs: (await programRepository.find({ order: { id: 'ASC' } })).map(row => ({ ...row })),
            }).toEqual(snapshot);
        } finally {
            vi.useRealTimers();
            await persistence.cleanup();
        }
        expect(persistence.source.isInitialized).toBe(false);
    });

    it.each(['deadline', 'disconnect'] as const)(
        '[Task 6.2] keeps a later M3U8 HTTP request independent after %s and ignores the late result',
        async terminal => {
            vi.useFakeTimers();
            const delayedResult = makeDeferred<string>();
            const firstReadStarted = makeDeferred<void>();
            let requestCount = 0;
            const model = {
                getChannelList: vi.fn(() => {
                    requestCount += 1;
                    if (requestCount === 1) {
                        firstReadStarted.resolve(undefined);
                        return delayedResult.promise;
                    }
                    return Promise.resolve('#EXTM3U\n');
                }),
            };
            container().bind('IIPTVApiModel').toConstantValue(model);
            container()
                .bind('IConfiguration')
                .toConstantValue({ getConfig: () => ({}) });
            const observations: Array<Record<string, any>> = [];
            const app = await createOpenApiApp(response => {
                const terminalEvent = observations.length === 0 ? 'close' : 'finish';
                observations.push({
                    end: vi.spyOn(response, 'end'),
                    json: vi.spyOn(response, 'json'),
                    response,
                    terminal: new Promise<void>(resolve => response.once(terminalEvent, resolve)),
                });
            });
            const server = createServer(app);
            const port = await listen(server);
            const probe = startHttpProbe(server, port, `${apiPath('iptv', 'channel.m3u8')}?mode=2&isHalfWidth=false`);
            const unhandledRejections: unknown[] = [];
            const onUnhandledRejection = (reason: unknown): void => {
                unhandledRejections.push(reason);
            };
            process.on('unhandledRejection', onUnhandledRejection);

            try {
                await firstReadStarted.promise;
                const independent = await requestDocument(
                    app,
                    `${apiPath('iptv', 'channel.m3u8')}?mode=2&isHalfWidth=false`,
                );
                expect(independent).toEqual({
                    body: '#EXTM3U\n',
                    contentType: 'application/x-mpegURL; charset="UTF-8"',
                    kind: 'response',
                    status: 200,
                });

                if (terminal === 'deadline') {
                    await vi.advanceTimersByTimeAsync(30_000);
                    const result = await probe.completion;
                    expect(result).toMatchObject({ kind: 'response', status: 500 });
                    if (result.kind !== 'response') throw new Error('Expected one M3U8 deadline failure response');
                    expect(JSON.parse(result.body)).toEqual({
                        code: 500,
                        message: 'Internal Server Error',
                        errors: 'IptvDocumentRequestDeadlineExceeded',
                    });
                    expect(probe.responseCount()).toBe(1);
                    expect(observations[0].json).toHaveBeenCalledOnce();
                    expect(observations[0].end).toHaveBeenCalledOnce();
                } else {
                    probe.abort();
                    await expect(probe.completion).resolves.toEqual({ kind: 'aborted' });
                    await observations[0].terminal;
                    expect(probe.responseCount()).toBe(0);
                    expect(observations[0].json).not.toHaveBeenCalled();
                    expect(observations[0].end).not.toHaveBeenCalled();
                }

                delayedResult.resolve('#EXTM3U\n#late\n');
                await Promise.resolve();
                await Promise.resolve();
                await vi.advanceTimersByTimeAsync(0);

                expect(model.getChannelList).toHaveBeenCalledTimes(2);
                expect(probe.responseCount()).toBe(terminal === 'deadline' ? 1 : 0);
                expect(observations[0].response.listenerCount('close')).toBe(0);
                expect(observations[1].response.listenerCount('close')).toBe(0);
                expect(unhandledRejections).toEqual([]);
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                delayedResult.resolve('#EXTM3U\n');
                process.off('unhandledRejection', onUnhandledRejection);
                probe.abort();
                await probe.close();
                vi.useRealTimers();
            }
        },
        15_000,
    );

    it.each(repositoryDialects)(
        '[Task 7.1][IPTV-7.4] keeps empty M3U8, DB failure, and the next independent %s request observable through HTTP',
        async dialect => {
            await withRepositoryDialect(dialect, async persistence => {
                const model = new IPTVApiModel(persistence.db.ChannelDB, persistence.db.ProgramDB);
                container().bind('IIPTVApiModel').toConstantValue(model);
                container()
                    .bind('IConfiguration')
                    .toConstantValue({ getConfig: () => ({}) });
                const responses: any[] = [];
                const app = await createOpenApiApp(response => responses.push(response));
                const documentPath = `${apiPath('iptv', 'channel.m3u8')}?mode=6.9&isHalfWidth=false`;
                vi.useFakeTimers();

                const empty = await requestDocument(app, documentPath);
                expect(empty.status).toBe(200);
                expect(empty.contentType).toBe('application/x-mpegURL; charset="UTF-8"');
                expect(Buffer.from(empty.body, 'utf8')).toEqual(Buffer.from('#EXTM3U\n', 'utf8'));
                expect(responses[0].listenerCount('close')).toBe(0);

                const failure = new Error(`synthetic ${dialect} M3U8 repository failure`);
                const failedRead = holdNextQueryRunnerQuery(persistence.source);
                const failedRequest = requestDocument(app, documentPath);
                await failedRead.queryStarted;
                failedRead.reject(failure);
                const failed = await failedRequest;
                await failedRead.querySettled;
                await failedRead.releaseCompleted;

                expect(failed.status).toBe(500);
                expect(failed.contentType).toBe('application/json; charset=utf-8');
                expect(JSON.parse(failed.body)).toEqual({
                    code: 500,
                    message: 'Internal Server Error',
                    errors: failure.message,
                });
                expect(failed.body).not.toContain('#EXTM3U');
                expect(responses[1].listenerCount('close')).toBe(0);
                expect(failedRead.releaseSpy()).toHaveBeenCalledOnce();
                failedRead.restore();

                const independent = await requestDocument(app, documentPath);
                expect(independent.status).toBe(200);
                expect(independent.contentType).toBe('application/x-mpegURL; charset="UTF-8"');
                expect(Buffer.from(independent.body, 'utf8')).toEqual(Buffer.from('#EXTM3U\n', 'utf8'));
                expect(responses[2].listenerCount('close')).toBe(0);
                expect(vi.getTimerCount()).toBe(0);
            });
        },
        120_000,
    );

    it.each(repositoryDialects)(
        '[Task 7.1][IPTV-7.4] fences deadline and disconnect late M3U8 reads with cleanup for real %s DB and HTTP',
        async dialect => {
            await withRepositoryDialect(dialect, async persistence => {
                const expectedDocument = await seedM3u8Repository(persistence);
                const model = new IPTVApiModel(persistence.db.ChannelDB, persistence.db.ProgramDB);
                container().bind('IIPTVApiModel').toConstantValue(model);
                container()
                    .bind('IConfiguration')
                    .toConstantValue({ getConfig: () => ({}) });
                const documentPath = `${apiPath('iptv', 'channel.m3u8')}?mode=6.9&isHalfWidth=false`;

                for (const terminal of ['deadline', 'disconnect'] as const) {
                    const heldQuery = holdNextQueryRunnerQuery(persistence.source);
                    const observations: Array<Record<string, any>> = [];
                    const app = await createOpenApiApp(response => {
                        const terminalEvent =
                            observations.length === 0 && terminal === 'disconnect' ? 'close' : 'finish';
                        observations.push({
                            end: vi.spyOn(response, 'end'),
                            json: vi.spyOn(response, 'json'),
                            response,
                            terminal: new Promise<void>(resolve => response.once(terminalEvent, resolve)),
                        });
                    });
                    const server = createServer(app);
                    const port = await listen(server);
                    const probe = startHttpProbe(server, port, documentPath);
                    const unhandledRejections: unknown[] = [];
                    const onUnhandledRejection = (reason: unknown): void => {
                        unhandledRejections.push(reason);
                    };
                    process.on('unhandledRejection', onUnhandledRejection);
                    vi.useFakeTimers();

                    try {
                        await heldQuery.queryStarted;
                        const independent = await requestDocument(app, documentPath);
                        expect(independent.status).toBe(200);
                        expect(independent.contentType).toBe('application/x-mpegURL; charset="UTF-8"');
                        expect(Buffer.from(independent.body, 'utf8')).toEqual(Buffer.from(expectedDocument, 'utf8'));
                        expect(observations).toHaveLength(2);
                        expect(vi.getTimerCount()).toBe(1);

                        if (terminal === 'deadline') {
                            await vi.advanceTimersByTimeAsync(30_000);
                            const result = await probe.completion;
                            await observations[0].terminal;
                            expect(result).toMatchObject({ kind: 'response', status: 500 });
                            if (result.kind !== 'response') throw new Error('Expected one M3U8 deadline response');
                            expect(result.contentType).toBe('application/json; charset=utf-8');
                            expect(JSON.parse(result.body)).toEqual({
                                code: 500,
                                message: 'Internal Server Error',
                                errors: 'IptvDocumentRequestDeadlineExceeded',
                            });
                            expect(probe.responseCount()).toBe(1);
                            expect(observations[0].json).toHaveBeenCalledOnce();
                            expect(observations[0].end).toHaveBeenCalledOnce();
                            heldQuery.resolve();
                        } else {
                            probe.abort();
                            await expect(probe.completion).resolves.toEqual({ kind: 'aborted' });
                            await observations[0].terminal;
                            expect(probe.responseCount()).toBe(0);
                            expect(observations[0].json).not.toHaveBeenCalled();
                            expect(observations[0].end).not.toHaveBeenCalled();
                            heldQuery.reject(new Error(`synthetic late ${dialect} M3U8 rejection`));
                        }
                        await heldQuery.querySettled;
                        await heldQuery.releaseCompleted;
                        await vi.advanceTimersByTimeAsync(0);

                        expect(heldQuery.createQueryRunnerSpy).toHaveBeenCalledTimes(2);
                        expect(heldQuery.releaseSpy()).toHaveBeenCalledTimes(dialect === 'sqlite' ? 2 : 1);
                        expect(observations[0].response.listenerCount('close')).toBe(0);
                        expect(observations[1].response.listenerCount('close')).toBe(0);
                        expect(observations[1].json).not.toHaveBeenCalled();
                        expect(observations[1].end).toHaveBeenCalledOnce();
                        expect(unhandledRejections).toEqual([]);
                        expect(vi.getTimerCount()).toBe(0);
                    } finally {
                        heldQuery.resolve();
                        process.off('unhandledRejection', onUnhandledRejection);
                        probe.abort();
                        await probe.close();
                        vi.useRealTimers();
                        heldQuery.restore();
                    }
                    expect(server.listening).toBe(false);
                }
            });
        },
        120_000,
    );

    it.each(repositoryDialects)(
        '[Task 7.2] carries empty, endpoint, tie, normal, and half-width XMLTV bytes through real %s DB and HTTP adapters',
        async dialect => {
            await withRepositoryDialect(dialect, async persistence => {
                const now = 1_700_000_000_000;
                const periodEnd = now + 24 * 60 * 60 * 1_000;
                const channelRepository = persistence.source.getRepository(persistence.entities.Channel);
                const programRepository = persistence.source.getRepository(persistence.entities.Program);
                await channelRepository.insert([
                    {
                        id: 40,
                        serviceId: 401,
                        networkId: 4,
                        name: 'NORMAL-SKY-CHANNEL',
                        halfWidthName: 'HALF-SKY-CHANNEL',
                        remoteControlKeyId: 4,
                        hasLogoData: false,
                        channelTypeId: 3,
                        channelType: 'SKY',
                        channel: 'synthetic-sky',
                        type: 0x01,
                    },
                    {
                        id: 20,
                        serviceId: 201,
                        networkId: 2,
                        name: 'NORMAL-BS-CHANNEL',
                        halfWidthName: 'HALF-BS-CHANNEL',
                        remoteControlKeyId: 2,
                        hasLogoData: false,
                        channelTypeId: 1,
                        channelType: 'BS',
                        channel: 'synthetic-bs',
                        type: 0x01,
                    },
                    {
                        id: 10,
                        serviceId: 101,
                        networkId: 1,
                        name: 'NORMAL-GR-CHANNEL',
                        halfWidthName: 'HALF-GR-CHANNEL',
                        remoteControlKeyId: 1,
                        hasLogoData: false,
                        channelTypeId: 0,
                        channelType: 'GR',
                        channel: 'synthetic-gr',
                        type: 0x01,
                    },
                    {
                        id: 30,
                        serviceId: 301,
                        networkId: 3,
                        name: 'NORMAL-CS-CHANNEL',
                        halfWidthName: 'HALF-CS-CHANNEL',
                        remoteControlKeyId: 3,
                        hasLogoData: false,
                        channelTypeId: 2,
                        channelType: 'CS',
                        channel: 'synthetic-cs',
                        type: 0x01,
                    },
                ]);

                const readOrder: string[] = [];
                const findSchedule = persistence.db.ProgramDB.findSchedule.bind(persistence.db.ProgramDB);
                const findAllChannels = persistence.db.ChannelDB.findAll.bind(persistence.db.ChannelDB);
                const programRead = vi
                    .spyOn(persistence.db.ProgramDB, 'findSchedule')
                    .mockImplementation(async (...arguments_: any[]) => {
                        readOrder.push('programme');
                        return findSchedule(...arguments_);
                    });
                const channelRead = vi
                    .spyOn(persistence.db.ChannelDB, 'findAll')
                    .mockImplementation(async (...arguments_: any[]) => {
                        readOrder.push('channel');
                        return findAllChannels(...arguments_);
                    });
                const model = new IPTVApiModel(persistence.db.ChannelDB, persistence.db.ProgramDB);
                container().bind('IIPTVApiModel').toConstantValue(model);
                const app = await createOpenApiApp();

                vi.useFakeTimers({ toFake: ['Date'] });
                vi.setSystemTime(now);
                try {
                    const empty = await requestDocument(
                        app,
                        `${apiPath('iptv', 'epg.xml')}?days=1.9&isHalfWidth=false`,
                    );
                    expect(empty.status).toBe(200);
                    expect(empty.contentType).toBe('application/xml; charset="UTF-8"');
                    expect(Buffer.from(empty.body, 'utf8')).toEqual(
                        Buffer.from(
                            '<?xml version="1.0" encoding="UTF-8"?>' +
                                '<!DOCTYPE tv SYSTEM "xmltv.dtd">' +
                                '<tv generator-info-name="EPGStation"></tv>',
                            'utf8',
                        ),
                    );
                } finally {
                    vi.useRealTimers();
                }

                const programme = (
                    id: number,
                    channelId: number,
                    serviceId: number,
                    networkId: number,
                    channelType: string,
                    channel: string,
                    startAt: number,
                    endAt: number,
                    values: Record<string, string | null>,
                ) =>
                    makeProgram({
                        id,
                        channelId,
                        serviceId,
                        networkId,
                        eventId: id,
                        channelType,
                        channel,
                        startAt,
                        endAt,
                        duration: endAt - startAt,
                        startHour: 0,
                        week: 0,
                        ...values,
                    });
                await programRepository.insert([
                    programme(9_001, 10, 101, 1, 'GR', 'synthetic-gr', now - 2_000, now - 1, {
                        name: 'EXCLUDED-BEFORE',
                        halfWidthName: 'EXCLUDED-BEFORE',
                        description: null,
                        halfWidthDescription: null,
                        extended: null,
                        halfWidthExtended: null,
                    }),
                    programme(1_001, 10, 101, 1, 'GR', 'synthetic-gr', now - 1_000, now, {
                        name: 'NORMAL<START>\x1a',
                        halfWidthName: 'HALF<START>\x1a',
                        description: 'NORMAL&START\x1a',
                        halfWidthDescription: 'HALF&START\x1a',
                        extended: '"NORMAL-DETAIL"\'',
                        halfWidthExtended: '"HALF-DETAIL"\'',
                    }),
                    programme(2_001, 20, 201, 2, 'BS', 'synthetic-bs', now + 1_000, now + 2_000, {
                        name: 'NORMAL-BS-FIRST',
                        halfWidthName: 'HALF-BS-FIRST',
                        description: 'NORMAL-BS-DESCRIPTION',
                        halfWidthDescription: 'HALF-BS-DESCRIPTION',
                        extended: null,
                        halfWidthExtended: null,
                    }),
                    programme(2_002, 20, 201, 2, 'BS', 'synthetic-bs', now + 1_000, now + 2_000, {
                        name: 'NORMAL-BS-SECOND',
                        halfWidthName: 'HALF-BS-SECOND',
                        description: null,
                        halfWidthDescription: null,
                        extended: 'IGNORED-NORMAL-BS-DETAIL',
                        halfWidthExtended: 'IGNORED-HALF-BS-DETAIL',
                    }),
                    programme(3_001, 30, 301, 3, 'CS', 'synthetic-cs', periodEnd, periodEnd + 1_000, {
                        name: 'NORMAL-CS-END',
                        halfWidthName: 'HALF-CS-END',
                        description: null,
                        halfWidthDescription: null,
                        extended: null,
                        halfWidthExtended: null,
                    }),
                    programme(4_001, 40, 401, 4, 'SKY', 'synthetic-sky', now + 500, now + 1_500, {
                        name: 'NORMAL-SKY-INSIDE',
                        halfWidthName: 'HALF-SKY-INSIDE',
                        description: 'NORMAL-SKY-DESCRIPTION',
                        halfWidthDescription: 'HALF-SKY-DESCRIPTION',
                        extended: 'NORMAL-SKY-DETAIL',
                        halfWidthExtended: 'HALF-SKY-DETAIL',
                    }),
                    programme(9_002, 40, 401, 4, 'SKY', 'synthetic-sky', periodEnd + 1, periodEnd + 2_000, {
                        name: 'EXCLUDED-AFTER',
                        halfWidthName: 'EXCLUDED-AFTER',
                        description: null,
                        halfWidthDescription: null,
                        extended: null,
                        halfWidthExtended: null,
                    }),
                ]);
                const persistedSnapshot = {
                    channels: (await channelRepository.find({ order: { id: 'ASC' } })).map(row => ({ ...row })),
                    programs: (await programRepository.find({ order: { id: 'ASC' } })).map(row => ({ ...row })),
                };

                const documentPrefix =
                    '<?xml version="1.0" encoding="UTF-8"?>' +
                    '<!DOCTYPE tv SYSTEM "xmltv.dtd">' +
                    '<tv generator-info-name="EPGStation">';
                const expectedDocument = (halfWidth: boolean): string =>
                    documentPrefix +
                    `<channel id="10" tp="synthetic-gr"><display-name lang="ja_JP">${
                        halfWidth ? 'HALF-GR-CHANNEL' : 'NORMAL-GR-CHANNEL'
                    }</display-name><service_id>101</service_id></channel>\n` +
                    `<programme start="${xmltvTime(now - 1_000)}" stop="${xmltvTime(
                        now,
                    )}" channel="10"><title lang="ja_JP">${
                        halfWidth ? 'HALF＜START＞' : 'NORMAL＜START＞'
                    }</title>    <desc lang="ja_JP">${
                        halfWidth ? 'HALF＆START”HALF-DETAIL”’' : 'NORMAL＆START”NORMAL-DETAIL”’'
                    }</desc></programme>` +
                    `<channel id="20" tp="synthetic-bs"><display-name lang="ja_JP">${
                        halfWidth ? 'HALF-BS-CHANNEL' : 'NORMAL-BS-CHANNEL'
                    }</display-name><service_id>201</service_id></channel>\n` +
                    `<programme start="${xmltvTime(now + 1_000)}" stop="${xmltvTime(
                        now + 2_000,
                    )}" channel="20"><title lang="ja_JP">${
                        halfWidth ? 'HALF-BS-FIRST' : 'NORMAL-BS-FIRST'
                    }</title>    <desc lang="ja_JP">${
                        halfWidth ? 'HALF-BS-DESCRIPTION' : 'NORMAL-BS-DESCRIPTION'
                    }</desc></programme>` +
                    `<programme start="${xmltvTime(now + 1_000)}" stop="${xmltvTime(
                        now + 2_000,
                    )}" channel="20"><title lang="ja_JP">${
                        halfWidth ? 'HALF-BS-SECOND' : 'NORMAL-BS-SECOND'
                    }</title></programme>` +
                    `<channel id="30" tp="synthetic-cs"><display-name lang="ja_JP">${
                        halfWidth ? 'HALF-CS-CHANNEL' : 'NORMAL-CS-CHANNEL'
                    }</display-name><service_id>301</service_id></channel>\n` +
                    `<programme start="${xmltvTime(periodEnd)}" stop="${xmltvTime(
                        periodEnd + 1_000,
                    )}" channel="30"><title lang="ja_JP">${
                        halfWidth ? 'HALF-CS-END' : 'NORMAL-CS-END'
                    }</title></programme>` +
                    `<channel id="40" tp="synthetic-sky"><display-name lang="ja_JP">${
                        halfWidth ? 'HALF-SKY-CHANNEL' : 'NORMAL-SKY-CHANNEL'
                    }</display-name><service_id>401</service_id></channel>\n` +
                    `<programme start="${xmltvTime(now + 500)}" stop="${xmltvTime(
                        now + 1_500,
                    )}" channel="40"><title lang="ja_JP">${
                        halfWidth ? 'HALF-SKY-INSIDE' : 'NORMAL-SKY-INSIDE'
                    }</title>    <desc lang="ja_JP">${
                        halfWidth ? 'HALF-SKY-DESCRIPTIONHALF-SKY-DETAIL' : 'NORMAL-SKY-DESCRIPTIONNORMAL-SKY-DETAIL'
                    }</desc></programme></tv>`;

                vi.useFakeTimers({ toFake: ['Date'] });
                vi.setSystemTime(now);
                try {
                    const normal = await requestDocument(
                        app,
                        `${apiPath('iptv', 'epg.xml')}?days=1.9&isHalfWidth=false`,
                    );
                    const halfWidth = await requestDocument(
                        app,
                        `${apiPath('iptv', 'epg.xml')}?days=1.9&isHalfWidth=true`,
                    );
                    for (const [response, expected] of [
                        [normal, expectedDocument(false)],
                        [halfWidth, expectedDocument(true)],
                    ] as const) {
                        expect(response.status).toBe(200);
                        expect(response.contentType).toBe('application/xml; charset="UTF-8"');
                        expect(Buffer.from(response.body, 'utf8')).toEqual(Buffer.from(expected, 'utf8'));
                    }
                } finally {
                    vi.useRealTimers();
                }

                expect(readOrder).toEqual(['programme', 'channel', 'programme', 'channel', 'programme', 'channel']);
                expect(programRead).toHaveBeenCalledTimes(3);
                expect(
                    programRead.mock.calls.map(([option]: [Record<string, any>]) => ({
                        startAt: option.startAt,
                        endAt: option.endAt,
                        isHalfWidth: option.isHalfWidth,
                    })),
                ).toEqual([
                    { startAt: now, endAt: periodEnd, isHalfWidth: false },
                    { startAt: now, endAt: periodEnd, isHalfWidth: false },
                    { startAt: now, endAt: periodEnd, isHalfWidth: true },
                ]);
                expect(channelRead).toHaveBeenCalledTimes(3);
                expect({
                    channels: (await channelRepository.find({ order: { id: 'ASC' } })).map(row => ({ ...row })),
                    programs: (await programRepository.find({ order: { id: 'ASC' } })).map(row => ({ ...row })),
                }).toEqual(persistedSnapshot);
            });
        },
        120_000,
    );

    it.each(repositoryDialects)(
        '[Task 7.2] converts each %s repository read failure to one whole-document HTTP failure',
        async dialect => {
            await withRepositoryDialect(dialect, async persistence => {
                const now = 1_700_000_000_000;
                await seedXmltvRepository(persistence, now);
                const programRead = vi.spyOn(persistence.db.ProgramDB, 'findSchedule');
                const channelRead = vi.spyOn(persistence.db.ChannelDB, 'findAll');
                const model = new IPTVApiModel(persistence.db.ChannelDB, persistence.db.ProgramDB);
                container().bind('IIPTVApiModel').toConstantValue(model);
                const observedResponses: any[] = [];
                const app = await createOpenApiApp(response => observedResponses.push(response));
                const documentPath = `${apiPath('iptv', 'epg.xml')}?days=1&isHalfWidth=false`;

                vi.useFakeTimers({ toFake: ['Date'] });
                vi.setSystemTime(now);
                try {
                    const programFailure = new Error(`synthetic ${dialect} programme repository failure`);
                    const programRepository = persistence.source.getRepository(persistence.entities.Program);
                    const failProgramRead = vi.spyOn(programRepository, 'find').mockRejectedValueOnce(programFailure);
                    const programResponse = await requestDocument(app, documentPath);
                    failProgramRead.mockRestore();

                    expect(programResponse.status).toBe(500);
                    expect(programResponse.contentType).toBe('application/json; charset=utf-8');
                    expect(JSON.parse(programResponse.body)).toEqual({
                        code: 500,
                        message: 'Internal Server Error',
                        errors: programFailure.message,
                    });
                    expect(programResponse.body).not.toContain('<?xml');
                    expect(programRead).toHaveBeenCalledOnce();
                    expect(channelRead).not.toHaveBeenCalled();
                    expect(observedResponses[0].listenerCount('close')).toBe(0);

                    programRead.mockClear();
                    channelRead.mockClear();
                    const channelFailure = new Error(`synthetic ${dialect} channel repository failure`);
                    const channelRepository = persistence.source.getRepository(persistence.entities.Channel);
                    const failChannelRead = vi
                        .spyOn(channelRepository, 'createQueryBuilder')
                        .mockImplementationOnce(() => {
                            throw channelFailure;
                        });
                    const channelResponse = await requestDocument(app, documentPath);
                    failChannelRead.mockRestore();

                    expect(channelResponse.status).toBe(500);
                    expect(channelResponse.contentType).toBe('application/json; charset=utf-8');
                    expect(JSON.parse(channelResponse.body)).toEqual({
                        code: 500,
                        message: 'Internal Server Error',
                        errors: channelFailure.message,
                    });
                    expect(channelResponse.body).not.toContain('<?xml');
                    expect(programRead).toHaveBeenCalledOnce();
                    expect(channelRead).toHaveBeenCalledOnce();
                    expect(observedResponses[1].listenerCount('close')).toBe(0);
                } finally {
                    vi.useRealTimers();
                }
            });
        },
        120_000,
    );

    it.each(repositoryDialects)(
        '[Task 7.2] isolates a successful %s repository request from a deadline and late programme result',
        async dialect => {
            await withRepositoryDialect(dialect, async persistence => {
                const now = 1_700_000_000_000;
                const expectedDocument = await seedXmltvRepository(persistence, now);
                const releaseFirstRead = makeDeferred<void>();
                const firstReadStarted = makeDeferred<void>();
                const findSchedule = persistence.db.ProgramDB.findSchedule.bind(persistence.db.ProgramDB);
                let programReadCount = 0;
                const programRead = vi
                    .spyOn(persistence.db.ProgramDB, 'findSchedule')
                    .mockImplementation(async (...arguments_: any[]) => {
                        const rows = await findSchedule(...arguments_);
                        programReadCount += 1;
                        if (programReadCount === 1) {
                            firstReadStarted.resolve(undefined);
                            await releaseFirstRead.promise;
                        }
                        return rows;
                    });
                const channelRead = vi.spyOn(persistence.db.ChannelDB, 'findAll');
                const model = new IPTVApiModel(persistence.db.ChannelDB, persistence.db.ProgramDB);
                container().bind('IIPTVApiModel').toConstantValue(model);
                const observations: Array<Record<string, any>> = [];
                const app = await createOpenApiApp(response => {
                    const finished = new Promise<void>(resolve => response.once('finish', resolve));
                    observations.push({
                        end: vi.spyOn(response, 'end'),
                        finished,
                        json: vi.spyOn(response, 'json'),
                        response,
                    });
                });
                const server = createServer(app);
                const port = await listen(server);
                const documentPath = `${apiPath('iptv', 'epg.xml')}?days=1&isHalfWidth=false`;
                const unhandledRejections: unknown[] = [];
                const onUnhandledRejection = (reason: unknown): void => {
                    unhandledRejections.push(reason);
                };
                process.on('unhandledRejection', onUnhandledRejection);
                vi.useFakeTimers();
                vi.setSystemTime(now);
                const delayedProbe = startHttpProbe(server, port, documentPath);

                try {
                    await firstReadStarted.promise;
                    expect(observations).toHaveLength(1);

                    const independent = await requestDocument(app, documentPath);
                    expect(independent.status).toBe(200);
                    expect(independent.contentType).toBe('application/xml; charset="UTF-8"');
                    expect(Buffer.from(independent.body, 'utf8')).toEqual(Buffer.from(expectedDocument, 'utf8'));
                    expect(observations).toHaveLength(2);
                    expect(channelRead).toHaveBeenCalledOnce();
                    expect(vi.getTimerCount()).toBe(1);

                    await vi.advanceTimersByTimeAsync(30_000);
                    const delayed = await delayedProbe.completion;
                    await observations[0].finished;
                    expect(delayed).toMatchObject({ kind: 'response', status: 500 });
                    if (delayed.kind !== 'response') throw new Error('Expected the deadline HTTP response');
                    expect(delayed.contentType).toBe('application/json; charset=utf-8');
                    expect(JSON.parse(delayed.body)).toEqual({
                        code: 500,
                        message: 'Internal Server Error',
                        errors: 'IptvDocumentRequestDeadlineExceeded',
                    });
                    expect(delayed.body).not.toContain('<?xml');
                    expect(delayedProbe.responseCount()).toBe(1);
                    expect(observations[0].json).toHaveBeenCalledOnce();
                    expect(observations[0].end).toHaveBeenCalledOnce();

                    releaseFirstRead.resolve(undefined);
                    await Promise.resolve();
                    await Promise.resolve();
                    await vi.advanceTimersByTimeAsync(0);

                    expect(programRead).toHaveBeenCalledTimes(2);
                    expect(channelRead).toHaveBeenCalledOnce();
                    expect(delayedProbe.responseCount()).toBe(1);
                    expect(observations[0].json).toHaveBeenCalledOnce();
                    expect(observations[0].end).toHaveBeenCalledOnce();
                    expect(observations[1].json).not.toHaveBeenCalled();
                    expect(observations[1].end).toHaveBeenCalledOnce();
                    expect(observations[0].response.listenerCount('close')).toBe(0);
                    expect(observations[1].response.listenerCount('close')).toBe(0);
                    expect(unhandledRejections).toEqual([]);
                    expect(vi.getTimerCount()).toBe(0);
                } finally {
                    releaseFirstRead.resolve(undefined);
                    process.off('unhandledRejection', onUnhandledRejection);
                    delayedProbe.abort();
                    await delayedProbe.close();
                    vi.useRealTimers();
                }
                expect(server.listening).toBe(false);
            });
        },
        120_000,
    );

    it.each(repositoryDialects)(
        '[Task 7.2] isolates a successful %s repository request from disconnect and late channel rejection',
        async dialect => {
            await withRepositoryDialect(dialect, async persistence => {
                const now = 1_700_000_000_000;
                const expectedDocument = await seedXmltvRepository(persistence, now);
                const delayedChannelRead = makeDeferred<void>();
                const firstChannelReadStarted = makeDeferred<void>();
                const findAllChannels = persistence.db.ChannelDB.findAll.bind(persistence.db.ChannelDB);
                let channelReadCount = 0;
                let delayedReadStarted = false;
                const channelRead = vi
                    .spyOn(persistence.db.ChannelDB, 'findAll')
                    .mockImplementation(async (...arguments_: any[]) => {
                        const rows = await findAllChannels(...arguments_);
                        channelReadCount += 1;
                        if (channelReadCount === 1) {
                            delayedReadStarted = true;
                            firstChannelReadStarted.resolve(undefined);
                            await delayedChannelRead.promise;
                        }
                        return rows;
                    });
                const programRead = vi.spyOn(persistence.db.ProgramDB, 'findSchedule');
                const model = new IPTVApiModel(persistence.db.ChannelDB, persistence.db.ProgramDB);
                container().bind('IIPTVApiModel').toConstantValue(model);
                const observations: Array<Record<string, any>> = [];
                const app = await createOpenApiApp(response => {
                    const terminalEvent = observations.length === 0 ? 'close' : 'finish';
                    const terminal = new Promise<void>(resolve => response.once(terminalEvent, resolve));
                    observations.push({
                        end: vi.spyOn(response, 'end'),
                        json: vi.spyOn(response, 'json'),
                        response,
                        terminal,
                    });
                });
                const server = createServer(app);
                const port = await listen(server);
                const documentPath = `${apiPath('iptv', 'epg.xml')}?days=1&isHalfWidth=false`;
                const lateFailure = new Error(`synthetic late ${dialect} channel rejection`);
                const unhandledRejections: unknown[] = [];
                const onUnhandledRejection = (reason: unknown): void => {
                    unhandledRejections.push(reason);
                };
                process.on('unhandledRejection', onUnhandledRejection);
                vi.useFakeTimers();
                vi.setSystemTime(now);
                const disconnectedProbe = startHttpProbe(server, port, documentPath);

                try {
                    await firstChannelReadStarted.promise;
                    expect(observations).toHaveLength(1);

                    disconnectedProbe.abort();
                    await expect(disconnectedProbe.completion).resolves.toEqual({ kind: 'aborted' });
                    await observations[0].terminal;
                    expect(disconnectedProbe.responseCount()).toBe(0);
                    expect(observations[0].json).not.toHaveBeenCalled();
                    expect(observations[0].end).not.toHaveBeenCalled();

                    const independent = await requestDocument(app, documentPath);
                    expect(independent.status).toBe(200);
                    expect(independent.contentType).toBe('application/xml; charset="UTF-8"');
                    expect(Buffer.from(independent.body, 'utf8')).toEqual(Buffer.from(expectedDocument, 'utf8'));
                    expect(observations).toHaveLength(2);

                    delayedChannelRead.reject(lateFailure);
                    await Promise.resolve();
                    await Promise.resolve();
                    await vi.advanceTimersByTimeAsync(0);

                    expect(programRead).toHaveBeenCalledTimes(2);
                    expect(channelRead).toHaveBeenCalledTimes(2);
                    expect(disconnectedProbe.responseCount()).toBe(0);
                    expect(observations[0].json).not.toHaveBeenCalled();
                    expect(observations[0].end).not.toHaveBeenCalled();
                    expect(observations[1].json).not.toHaveBeenCalled();
                    expect(observations[1].end).toHaveBeenCalledOnce();
                    expect(observations[0].response.listenerCount('close')).toBe(0);
                    expect(observations[1].response.listenerCount('close')).toBe(0);
                    expect(unhandledRejections).toEqual([]);
                    expect(vi.getTimerCount()).toBe(0);
                } finally {
                    if (delayedReadStarted) {
                        delayedChannelRead.reject(lateFailure);
                        await Promise.resolve();
                        await Promise.resolve();
                    }
                    process.off('unhandledRejection', onUnhandledRejection);
                    disconnectedProbe.abort();
                    await disconnectedProbe.close();
                    vi.useRealTimers();
                }
                expect(server.listening).toBe(false);
            });
        },
        120_000,
    );

    it.each(repositoryDialects)(
        '[Task 7.2] rejects %s XMLTV when synchronous generation reaches the absolute deadline',
        async dialect => {
            await withRepositoryDialect(dialect, async persistence => {
                const now = 1_700_000_000_000;
                await seedXmltvRepository(persistence, now);
                let monotonicNow = 0;
                const generatedChannelName = vi.fn(() => {
                    monotonicNow = 30_000;
                    return 'NORMAL-DB-CHANNEL';
                });
                const findAllChannels = persistence.db.ChannelDB.findAll.bind(persistence.db.ChannelDB);
                const channelRead = vi
                    .spyOn(persistence.db.ChannelDB, 'findAll')
                    .mockImplementation(async (...arguments_: any[]) => {
                        const rows = await findAllChannels(...arguments_);
                        Object.defineProperty(rows[0], 'name', {
                            configurable: true,
                            get: generatedChannelName,
                        });
                        return rows;
                    });
                const programRead = vi.spyOn(persistence.db.ProgramDB, 'findSchedule');
                const model = new IPTVApiModel(persistence.db.ChannelDB, persistence.db.ProgramDB);
                container().bind('IIPTVApiModel').toConstantValue(model);
                const observedResponse = makeDeferred<Record<string, any>>();
                const app = await createOpenApiApp(response => {
                    observedResponse.resolve({
                        end: vi.spyOn(response, 'end'),
                        finished: new Promise<void>(resolve => response.once('finish', resolve)),
                        json: vi.spyOn(response, 'json'),
                        response,
                    });
                });
                const server = createServer(app);
                const port = await listen(server);
                vi.useFakeTimers();
                vi.setSystemTime(now);
                const performanceNow = vi.spyOn(globalThis.performance, 'now').mockImplementation(() => monotonicNow);
                const probe = startHttpProbe(server, port, `${apiPath('iptv', 'epg.xml')}?days=1&isHalfWidth=false`);

                try {
                    const response = await probe.completion;
                    const observed = await observedResponse.promise;
                    await observed.finished;
                    expect(response).toMatchObject({ kind: 'response', status: 500 });
                    if (response.kind !== 'response') throw new Error('Expected the generation deadline response');
                    expect(response.contentType).toBe('application/json; charset=utf-8');
                    expect(JSON.parse(response.body)).toEqual({
                        code: 500,
                        message: 'Internal Server Error',
                        errors: 'IptvDocumentRequestDeadlineExceeded',
                    });
                    expect(response.body).not.toContain('<?xml');
                    expect(programRead).toHaveBeenCalledOnce();
                    expect(channelRead).toHaveBeenCalledOnce();
                    expect(generatedChannelName).toHaveBeenCalledOnce();
                    expect(probe.responseCount()).toBe(1);
                    expect(observed.json).toHaveBeenCalledOnce();
                    expect(observed.end).toHaveBeenCalledOnce();
                    expect(observed.response.listenerCount('close')).toBe(0);
                    expect(vi.getTimerCount()).toBe(0);
                } finally {
                    probe.abort();
                    await probe.close();
                    performanceNow.mockRestore();
                    vi.useRealTimers();
                }
                expect(server.listening).toBe(false);
            });
        },
        120_000,
    );

    it('[Task 1.2] converts a DB rejection to one existing HTTP error response without regeneration', async () => {
        const channelDB = { findAll: vi.fn(async () => Promise.reject(new Error('synthetic DB failure'))) };
        const harness = makeModel({ channelDB });
        container().bind('IIPTVApiModel').toConstantValue(harness.model);
        container()
            .bind('IConfiguration')
            .toConstantValue({ getConfig: () => ({}) });
        const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'channel.m3u8.js').get;
        const response = makeResponse();
        await handler(
            {
                headers: { host: 'synthetic.invalid' },
                header: () => undefined,
                protocol: 'http',
                query: { mode: 1, isHalfWidth: true },
            },
            response,
        );
        expect(response.statusCode).toBe(500);
        expect(channelDB.findAll).toHaveBeenCalledOnce();
        expect(response.end).not.toHaveBeenCalled();
        expect(response.json).toHaveBeenCalledOnce();
    });

    it('[Task 6.3] stops after a late programme read while a concurrent XMLTV request remains independent', async () => {
        vi.useFakeTimers();
        const delayedPrograms = makeDeferred<Record<string, any>[]>();
        const programRead = vi.fn().mockReturnValueOnce(delayedPrograms.promise).mockResolvedValueOnce([makeProgram()]);
        const channelRead = vi.fn(async () => [makeChannel()]);
        const harness = makeModel({
            channelDB: { findAll: channelRead },
            programDB: { findSchedule: programRead },
        });
        container().bind('IIPTVApiModel').toConstantValue(harness.model);
        const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'epg.xml.js').get;
        const execute = () => {
            const response = makeResponse();
            return {
                pending: handler({ query: { days: 1, isHalfWidth: false } }, response),
                response,
            };
        };

        const delayed = execute();
        const next = execute();
        await next.pending;
        expect(next.response.statusCode).toBe(200);
        expect(next.response.headers['Content-Type']).toBe('application/xml; charset="UTF-8"');
        expect(next.response.body).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
        expect(next.response.body).toMatch(/<\/tv>$/);
        expect(channelRead).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(30_000);
        await delayed.pending;
        expect(delayed.response.statusCode).toBe(500);
        expect(delayed.response.json).toHaveBeenCalledOnce();
        expect(delayed.response.end).not.toHaveBeenCalled();

        delayedPrograms.resolve([makeProgram()]);
        await Promise.resolve();
        await Promise.resolve();
        expect(channelRead).toHaveBeenCalledOnce();
        expect(delayed.response.json).toHaveBeenCalledOnce();
        expect(delayed.response.end).not.toHaveBeenCalled();
        expect(programRead).toHaveBeenCalledTimes(2);
        expect(delayed.response.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 6.3] does not start the XMLTV channel read after disconnect', async () => {
        vi.useFakeTimers();
        const delayedPrograms = makeDeferred<Record<string, any>[]>();
        const channelRead = vi.fn(async () => [makeChannel()]);
        const harness = makeModel({
            channelDB: { findAll: channelRead },
            programDB: { findSchedule: vi.fn(() => delayedPrograms.promise) },
        });
        container().bind('IIPTVApiModel').toConstantValue(harness.model);
        const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'epg.xml.js').get;
        const response = makeResponse();
        const pending = handler({ query: { days: 1, isHalfWidth: false } }, response);

        expect(response.listenerCount('close')).toBe(1);
        expect(vi.getTimerCount()).toBe(1);
        response.destroyed = true;
        response.emit('close');
        await pending;
        delayedPrograms.resolve([makeProgram()]);
        await Promise.resolve();
        await Promise.resolve();

        expect(channelRead).not.toHaveBeenCalled();
        expect(response.json).not.toHaveBeenCalled();
        expect(response.end).not.toHaveBeenCalled();
        expect(response.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 6.3] does not generate XMLTV after a late channel read', async () => {
        vi.useFakeTimers();
        const delayedChannels = makeDeferred<Record<string, any>[]>();
        const channelNameRead = vi.fn(() => 'synthetic-late-channel');
        const delayedChannel = makeChannel();
        Object.defineProperty(delayedChannel, 'name', { get: channelNameRead });
        const harness = makeModel({
            channelDB: { findAll: vi.fn(() => delayedChannels.promise) },
            programDB: { findSchedule: vi.fn(async () => [makeProgram()]) },
        });
        container().bind('IIPTVApiModel').toConstantValue(harness.model);
        const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'epg.xml.js').get;
        const response = makeResponse();
        const pending = handler({ query: { days: 1, isHalfWidth: false } }, response);
        await Promise.resolve();
        expect(harness.channelDB.findAll).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(30_000);
        await pending;
        delayedChannels.resolve([delayedChannel]);
        await Promise.resolve();
        await Promise.resolve();

        expect(channelNameRead).not.toHaveBeenCalled();
        expect(response.statusCode).toBe(500);
        expect(response.json).toHaveBeenCalledOnce();
        expect(response.end).not.toHaveBeenCalled();
        expect(response.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 6.3] rejects XMLTV whose synchronous generation reaches the absolute deadline', async () => {
        vi.useFakeTimers();
        let monotonicNow = 0;
        vi.spyOn(globalThis.performance, 'now').mockImplementation(() => monotonicNow);
        const channel = makeChannel();
        Object.defineProperty(channel, 'name', {
            get: () => {
                monotonicNow = 30_000;
                return 'synthetic-deadline-channel';
            },
        });
        const harness = makeModel({
            channelDB: { findAll: vi.fn(async () => [channel]) },
            programDB: { findSchedule: vi.fn(async () => [makeProgram()]) },
        });
        container().bind('IIPTVApiModel').toConstantValue(harness.model);
        const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'epg.xml.js').get;
        const response = makeResponse();

        await handler({ query: { days: 1, isHalfWidth: false } }, response);

        expect(response.statusCode).toBe(500);
        expect(response.json).toHaveBeenCalledOnce();
        expect(response.end).not.toHaveBeenCalled();
        expect(response.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 6.3] carries programme, channel, and XMLTV generation failures through one existing error response', async () => {
        vi.useFakeTimers();
        const generationFailureChannel = makeChannel();
        Object.defineProperty(generationFailureChannel, 'name', {
            get: () => {
                throw new Error('synthetic XMLTV generation failure');
            },
        });
        const programRead = vi
            .fn()
            .mockRejectedValueOnce(new Error('synthetic XMLTV programme failure'))
            .mockResolvedValue([makeProgram()]);
        const channelRead = vi
            .fn()
            .mockRejectedValueOnce(new Error('synthetic XMLTV channel failure'))
            .mockResolvedValueOnce([generationFailureChannel]);
        const harness = makeModel({
            channelDB: { findAll: channelRead },
            programDB: { findSchedule: programRead },
        });
        container().bind('IIPTVApiModel').toConstantValue(harness.model);
        const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'epg.xml.js').get;
        const execute = () => {
            const response = makeResponse();
            return {
                pending: handler({ query: { days: 1, isHalfWidth: false } }, response),
                response,
            };
        };

        const programFailure = execute();
        await programFailure.pending;
        const channelFailure = execute();
        await channelFailure.pending;
        const generationFailure = execute();
        await generationFailure.pending;

        for (const [request, error] of [
            [programFailure, 'synthetic XMLTV programme failure'],
            [channelFailure, 'synthetic XMLTV channel failure'],
            [generationFailure, 'synthetic XMLTV generation failure'],
        ] as const) {
            expect(request.response.statusCode).toBe(500);
            expect(request.response.body).toEqual({
                code: 500,
                message: 'Internal Server Error',
                errors: error,
            });
            expect(request.response.json).toHaveBeenCalledOnce();
            expect(request.response.end).not.toHaveBeenCalled();
            expect(request.response.listenerCount('close')).toBe(0);
        }
        expect(programRead).toHaveBeenCalledTimes(3);
        expect(channelRead).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    const httpLifecycleCases = (['programme', 'channel'] as const).flatMap(stage =>
        (['deadline', 'abort'] as const).flatMap(terminal =>
            (['resolve', 'reject'] as const).map(settlement => ({ settlement, stage, terminal })),
        ),
    );

    it.each(httpLifecycleCases)(
        '[Task 6.3 review] fences late $settlement at the $stage stage after HTTP $terminal',
        async ({ settlement, stage, terminal }) => {
            expect(vi.isFakeTimers()).toBe(false);

            const delayedRead = makeDeferred<Record<string, any>[]>();
            const stageStarted = makeDeferred<void>();
            const generatedChannelName = vi.fn(() => 'synthetic-late-channel');
            const lateChannel = makeChannel();
            Object.defineProperty(lateChannel, 'name', { get: generatedChannelName });
            let programmeReadCount = 0;
            let channelReadCount = 0;
            const programmeRead = vi.fn(() => {
                programmeReadCount += 1;
                if (stage === 'programme' && programmeReadCount === 1) {
                    stageStarted.resolve(undefined);
                    return delayedRead.promise;
                }
                return Promise.resolve([makeProgram()]);
            });
            const channelRead = vi.fn(() => {
                channelReadCount += 1;
                if (stage === 'channel' && channelReadCount === 1) {
                    stageStarted.resolve(undefined);
                    return delayedRead.promise;
                }
                return Promise.resolve([makeChannel()]);
            });
            const model = new IPTVApiModel({ findAll: channelRead }, { findSchedule: programmeRead });
            container().bind('IIPTVApiModel').toConstantValue(model);

            const observedResponse = makeDeferred<Record<string, any>>();
            const app = await createOpenApiApp(response => {
                const event = terminal === 'deadline' ? 'finish' : 'close';
                const terminalEvent = new Promise<void>(resolve => response.once(event, resolve));
                observedResponse.resolve({
                    end: vi.spyOn(response, 'end'),
                    json: vi.spyOn(response, 'json'),
                    response,
                    terminalEvent,
                });
            });
            const server = createServer(app);
            const port = await listen(server);
            vi.useFakeTimers();
            const probe = startHttpProbe(server, port, `${apiPath('iptv', 'epg.xml')}?days=1&isHalfWidth=false`);
            const unhandledRejections: unknown[] = [];
            const onUnhandledRejection = (reason: unknown): void => {
                unhandledRejections.push(reason);
            };
            process.on('unhandledRejection', onUnhandledRejection);

            try {
                await stageStarted.promise;
                const observed = await observedResponse.promise;

                if (terminal === 'deadline') {
                    await vi.advanceTimersByTimeAsync(30_000);
                } else {
                    probe.abort();
                }
                const clientResult = await probe.completion;
                await observed.terminalEvent;

                if (terminal === 'deadline') {
                    expect(clientResult).toMatchObject({ kind: 'response', status: 500 });
                    if (clientResult.kind !== 'response') throw new Error('Expected one HTTP failure response');
                    expect(JSON.parse(clientResult.body)).toEqual({
                        code: 500,
                        message: 'Internal Server Error',
                        errors: 'IptvDocumentRequestDeadlineExceeded',
                    });
                    expect(probe.responseCount()).toBe(1);
                    expect(observed.json).toHaveBeenCalledOnce();
                    expect(observed.end).toHaveBeenCalledOnce();
                } else {
                    expect(clientResult.kind).toBe('aborted');
                    expect(probe.responseCount()).toBe(0);
                    expect(observed.json).not.toHaveBeenCalled();
                    expect(observed.end).not.toHaveBeenCalled();
                }

                if (settlement === 'resolve') {
                    delayedRead.resolve(stage === 'programme' ? [makeProgram()] : [lateChannel]);
                } else {
                    delayedRead.reject(new Error(`synthetic late ${stage} rejection`));
                }
                await Promise.resolve();
                await Promise.resolve();
                await vi.advanceTimersByTimeAsync(0);

                expect(programmeRead).toHaveBeenCalledOnce();
                expect(channelRead).toHaveBeenCalledTimes(stage === 'programme' ? 0 : 1);
                expect(generatedChannelName).not.toHaveBeenCalled();
                expect(probe.responseCount()).toBe(terminal === 'deadline' ? 1 : 0);
                expect(observed.json).toHaveBeenCalledTimes(terminal === 'deadline' ? 1 : 0);
                expect(observed.end).toHaveBeenCalledTimes(terminal === 'deadline' ? 1 : 0);
                expect(observed.response.listenerCount('close')).toBe(0);
                expect(unhandledRejections).toEqual([]);
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                process.off('unhandledRejection', onUnhandledRejection);
                probe.abort();
                await probe.close();
            }
        },
        15_000,
    );

    it.each(repositoryDialects)(
        '[Task 7.1][IPTV-7.4] carries exact M3U8 bytes from a real %s repository through HTTP',
        async dialect => {
            await withRepositoryDialect(dialect, async persistence => {
                await persistence.source.getRepository(persistence.entities.Channel).insert({
                    id: 70,
                    serviceId: 701,
                    networkId: 7,
                    name: 'SYNTHETIC-M3U8-CHANNEL',
                    halfWidthName: 'SYNTHETIC-M3U8-CHANNEL',
                    remoteControlKeyId: 7,
                    hasLogoData: true,
                    channelTypeId: 1,
                    channelType: 'BS',
                    channel: 'synthetic-m3u8-channel',
                    type: 0x01,
                });
                const model = new IPTVApiModel(persistence.db.ChannelDB, persistence.db.ProgramDB);
                container().bind('IIPTVApiModel').toConstantValue(model);
                container()
                    .bind('IConfiguration')
                    .toConstantValue({ getConfig: () => ({ subDirectory: '/synthetic-subdir' }) });
                const responses: any[] = [];
                const app = await createOpenApiApp(response => responses.push(response));

                const response = await requestDocument(
                    app,
                    `${apiPath('iptv', 'channel.m3u8')}?mode=6.9&isHalfWidth=false`,
                );

                expect(response.status).toBe(200);
                expect(response.contentType).toBe('application/x-mpegURL; charset="UTF-8"');
                expect(Buffer.from(response.body, 'utf8')).toEqual(
                    Buffer.from(
                        '#EXTM3U\n' +
                            '#KODIPROP:mimetype=video/mp2t\n' +
                            '#EXTINF:-1 tvg-id="70" tvg-logo="http://synthetic.invalid/synthetic-subdir/api/channels/70/logo" group-title="BS",SYNTHETIC-M3U8-CHANNEL　\n' +
                            'http://synthetic.invalid/synthetic-subdir/api/streams/live/70/m2ts?mode=6\n',
                        'utf8',
                    ),
                );
                expect(responses).toHaveLength(1);
                expect(responses[0].listenerCount('close')).toBe(0);
            });
        },
        120_000,
    );
});

// The container is removed here, in a test of its own with the budget its provisioning has, rather than in
// `afterAll`: the Docker daemon answers `docker rm --force` late while it is busy (an image export holds
// it for tens of seconds), and a hook only has Vitest's default 10 s. The `afterAll` above confirms the
// container is gone and removes it itself only when this test did not run (a filtered or aborted file).
it(
    'releases the isolated MySQL fixture container after every case of the file',
    async () => {
        await maria?.cleanup();
    },
    MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS,
);
