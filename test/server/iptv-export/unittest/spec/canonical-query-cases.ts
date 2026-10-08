import express, { type Express } from 'express';
import * as openapi from 'express-openapi';
import { readFileSync } from 'node:fs';
import { createServer, get as httpGet, type Server } from 'node:http';
import { join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { expect, vi } from 'vitest';
import { loadModule, makeChannel, makeModel, makeProgram } from '../../_harness';
import { defineCanonicalContract, type CanonicalContractCase } from './canonical-contract-case';

const file = 'query.spec.test.ts';
const apiPath = (...segments: string[]): string => ['', 'api', ...segments].join('/');
const loopbackHost = '127.0.0.1';
const container = () => loadModule<any>('model', 'ModelContainer.js').default;

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

const createOpenApiApp = async (): Promise<Express> => {
    const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
    if (snapshot === undefined) throw new Error('The compiled server snapshot is required');
    const apiDoc = loadYaml(readFileSync('api.yml', 'utf8')) as any;
    apiDoc.servers = [{ url: apiPath() }];
    const app = express();
    // 実装と同じ query の握り方を使う。Express 5 の req.query は参照ごとに別の object を
    // 返すため、これが無いと OpenAPI 層の型変換が次の参照に残らない。
    loadModule<any>('model', 'service', 'ServiceServer.js').holdParsedQuery(app);
    await openapi.initialize({
        apiDoc,
        app,
        exposeApiDocs: false,
        paths: join(snapshot, 'model', 'service', 'api'),
        errorMiddleware: (error, _request, response, _next) => response.status(400).json(error),
    });
    return app;
};

const request = async (app: Express, path: string): Promise<{ readonly body: string; readonly status: number }> => {
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
                    incoming.on('end', () => resolve({ body, status: incoming.statusCode ?? 0 }));
                },
            );
            outgoing.once('error', reject);
        });
    } finally {
        await new Promise<void>((resolve, reject) =>
            server.close(error => (error === undefined ? resolve() : reject(error))),
        );
    }
};

const withQueryModel = async (model: Record<string, any>, run: (app: Express) => Promise<void>): Promise<void> => {
    container().bind('IIPTVApiModel').toConstantValue(model);
    container()
        .bind('IConfiguration')
        .toConstantValue({ getConfig: () => ({}) });
    try {
        await run(await createOpenApiApp());
    } finally {
        for (const binding of ['IIPTVApiModel', 'IConfiguration']) {
            if (container().isBound(binding)) container().unbind(binding);
        }
    }
};

const echoModel = () => ({
    getChannelList: vi.fn(
        async ({ isHalfWidth, mode, publicUrls }: Record<string, any>) =>
            `#EXTM3U\nhalf=${String(isHalfWidth)} mode=${String(mode)} ${publicUrls.liveM2tsUrl(42, mode)}\n`,
    ),
    getEpg: vi.fn(async (days: number, isHalfWidth: boolean) => `<epg days="${days}" half="${isHalfWidth}"/>`),
});

export const canonicalQueryCases: readonly CanonicalContractCase[] = [
    defineCanonicalContract(
        'Requirement 1.1',
        file,
        'emits the accepted integer mode in the public live URL',
        'the requested integer mode is visible in M3U8 bytes',
        async () => {
            const model = echoModel();
            await withQueryModel(model, async app => {
                const response = await request(app, `${apiPath('iptv', 'channel.m3u8')}?mode=7&isHalfWidth=false`);
                expect(response).toEqual({
                    body: '#EXTM3U\nhalf=false mode=7 http://synthetic.invalid/api/streams/live/42/m2ts?mode=7\n',
                    status: 200,
                });
            });
        },
    ),
    defineCanonicalContract(
        'Requirement 1.2',
        file,
        'emits a document for the accepted integer day count',
        'the accepted integer days value is visible in XMLTV bytes',
        async () => {
            const model = echoModel();
            await withQueryModel(model, async app => {
                await expect(request(app, `${apiPath('iptv', 'epg.xml')}?days=5&isHalfWidth=false`)).resolves.toEqual({
                    body: '<epg days="5" half="false"/>',
                    status: 200,
                });
            });
        },
    ),
    defineCanonicalContract(
        'Requirement 1.3',
        file,
        'uses three days when the HTTP query omits days',
        'an omitted days query is observable as days=3 in the returned document',
        async () => {
            const model = echoModel();
            await withQueryModel(model, async app => {
                await expect(request(app, `${apiPath('iptv', 'epg.xml')}?isHalfWidth=false`)).resolves.toEqual({
                    body: '<epg days="3" half="false"/>',
                    status: 200,
                });
            });
        },
    ),
    defineCanonicalContract(
        'Requirement 1.4',
        file,
        'uses half-width fields when the HTTP query omits the notation flag',
        'an omitted notation query is observable as half-width output',
        async () => {
            const model = echoModel();
            await withQueryModel(model, async app => {
                await expect(request(app, `${apiPath('iptv', 'epg.xml')}?days=1`)).resolves.toEqual({
                    body: '<epg days="1" half="true"/>',
                    status: 200,
                });
            });
        },
    ),
    defineCanonicalContract(
        'Requirement 1.5',
        file,
        'emits normal channel and programme fields when normal notation is requested',
        'normal channel and programme text are both visible in public documents',
        async () => {
            const channel = makeChannel({ name: 'NORMAL-CHANNEL', halfWidthName: 'HALF-CHANNEL' });
            const program = makeProgram({ name: 'NORMAL-PROGRAM', halfWidthName: 'HALF-PROGRAM' });
            const harness = makeModel({
                channelDB: { findAll: async () => [channel] },
                programDB: { findSchedule: async () => [program] },
            });

            const [m3u8, xmltv] = await Promise.all([
                harness.model.getChannelList('synthetic.invalid', false, 2, false),
                harness.model.getEpg(1, false),
            ]);
            expect(m3u8).toContain('NORMAL-CHANNEL');
            expect(m3u8).not.toContain('HALF-CHANNEL');
            expect(xmltv).toContain('NORMAL-CHANNEL');
            expect(xmltv).toContain('NORMAL-PROGRAM');
            expect(xmltv).not.toContain('HALF-PROGRAM');
        },
    ),
    defineCanonicalContract(
        'Requirement 1.6',
        file,
        'emits half-width channel and programme fields when half-width notation is requested',
        'half-width channel and programme text are both visible in public documents',
        async () => {
            const channel = makeChannel({ name: 'NORMAL-CHANNEL', halfWidthName: 'HALF-CHANNEL' });
            const program = makeProgram({ name: 'NORMAL-PROGRAM', halfWidthName: 'HALF-PROGRAM' });
            const harness = makeModel({
                channelDB: { findAll: async () => [channel] },
                programDB: { findSchedule: async () => [program] },
            });

            const [m3u8, xmltv] = await Promise.all([
                harness.model.getChannelList('synthetic.invalid', false, 2, true),
                harness.model.getEpg(1, true),
            ]);
            expect(m3u8).toContain('HALF-CHANNEL');
            expect(m3u8).not.toContain('NORMAL-CHANNEL');
            expect(xmltv).toContain('HALF-CHANNEL');
            expect(xmltv).toContain('HALF-PROGRAM');
            expect(xmltv).not.toContain('NORMAL-PROGRAM');
        },
    ),
    defineCanonicalContract(
        'Requirement 1.7',
        file,
        'does not reject day counts outside a generator-owned range',
        'negative and large day values both reach public document generation',
        async () => {
            const model = echoModel();
            await withQueryModel(model, async app => {
                await expect(request(app, `${apiPath('iptv', 'epg.xml')}?days=-999`)).resolves.toEqual({
                    body: '<epg days="-999" half="true"/>',
                    status: 200,
                });
                await expect(request(app, `${apiPath('iptv', 'epg.xml')}?days=999`)).resolves.toEqual({
                    body: '<epg days="999" half="true"/>',
                    status: 200,
                });
            });
        },
    ),
    defineCanonicalContract(
        'Requirement 1.8',
        file,
        'emits an unregistered mode without starting or validating a media stream',
        'an unregistered mode remains visible in a successfully generated live URL',
        async () => {
            const channel = makeChannel({ hasLogoData: false });
            const harness = makeModel({ channelDB: { findAll: async () => [channel] } });
            await expect(harness.model.getChannelList('synthetic.invalid', false, 999, false)).resolves.toContain(
                'm2ts?mode=999',
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 1.9',
        file,
        'floors positive and negative decimal day queries',
        '1.9 and -1.2 are observable as document day values 1 and -2',
        async () => {
            const model = echoModel();
            await withQueryModel(model, async app => {
                await expect(request(app, `${apiPath('iptv', 'epg.xml')}?days=1.9`)).resolves.toEqual({
                    body: '<epg days="1" half="true"/>',
                    status: 200,
                });
                await expect(request(app, `${apiPath('iptv', 'epg.xml')}?days=-1.2`)).resolves.toEqual({
                    body: '<epg days="-2" half="true"/>',
                    status: 200,
                });
            });
        },
    ),
    defineCanonicalContract(
        'Requirement 1.10',
        file,
        'floors positive and negative decimal mode queries',
        '3.9 and -1.2 are observable as live URL mode values 3 and -2',
        async () => {
            const model = echoModel();
            await withQueryModel(model, async app => {
                const positive = await request(app, `${apiPath('iptv', 'channel.m3u8')}?mode=3.9`);
                const negative = await request(app, `${apiPath('iptv', 'channel.m3u8')}?mode=-1.2`);
                expect(positive.body).toContain('m2ts?mode=3');
                expect(negative.body).toContain('m2ts?mode=-2');
                expect([positive.status, negative.status]).toEqual([200, 200]);
            });
        },
    ),
];
