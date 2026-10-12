import express, { type Express } from 'express';
import * as openapi from 'express-openapi';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const modelContainer = (require(join(compiledSnapshot, 'model', 'ModelContainer.js')) as any).default;
const { IChannelApiModelError } = require(
    join(compiledSnapshot, 'model', 'api', 'channel', 'IChannelApiModel.js'),
) as any;
const { holdParsedQuery } = require(join(compiledSnapshot, 'model', 'service', 'ServiceServer.js')) as any;

const loopbackHost = '127.0.0.1';
const apiPath = (...segments: string[]): string => ['', 'api', ...segments].join('/');
let origin = '';
let server: Server;

const channelWithOptionalFields = {
    id: 1,
    serviceId: 101,
    networkId: 10,
    name: 'synthetic-channel',
    halfWidthName: 'synthetic-channel-half',
    remoteControlKeyId: 1,
    hasLogoData: true,
    channelType: 'GR',
    channel: '1',
    type: 1,
};
const channelWithoutOptionalFields = {
    id: 2,
    serviceId: 102,
    networkId: 10,
    name: 'synthetic-channel-minimal',
    halfWidthName: 'synthetic-channel-minimal-half',
    hasLogoData: false,
    channelType: 'GR',
    channel: '2',
};
const scheduleChannel = {
    id: 1,
    serviceId: 101,
    networkId: 10,
    name: 'synthetic-channel',
    remoteControlKeyId: 1,
    hasLogoData: true,
    channelType: 'GR',
    type: 1,
};
const completeProgram = {
    id: 11,
    channelId: 1,
    startAt: 1_000,
    endAt: 61_000,
    isFree: true,
    name: 'synthetic-program',
    description: 'synthetic-description',
    extended: '◇heading\nsynthetic-extended',
    rawExtended: { heading: 'synthetic-extended' },
    genre1: 1,
    subGenre1: 2,
    genre2: 3,
    subGenre2: 4,
    genre3: 5,
    subGenre3: 6,
    videoType: 'h.264',
    videoResolution: '1080i',
    videoStreamContent: 1,
    videoComponentType: 179,
    audioSamplingRate: 48_000,
    audioComponentType: 3,
};
const minimalProgram = {
    id: 12,
    channelId: 2,
    startAt: 2_000,
    endAt: 62_000,
    isFree: false,
    name: 'synthetic-program-minimal',
};
const schedule = [{ channel: scheduleChannel, programs: [completeProgram, minimalProgram] }];

const createOpenApiApp = async (): Promise<Express> => {
    const apiDocument = loadYaml(readFileSync('api.yml', 'utf8')) as any;
    apiDocument.servers = [{ url: apiPath() }];
    const app = express();
    app.use(express.json());
    // 実装と同じ query の握り方を使う。Express 5 の req.query は参照ごとに別の object を
    // 返すため、これが無いと OpenAPI 層の型変換が次の参照に残らない。
    holdParsedQuery(app);
    await openapi.initialize({
        apiDoc: apiDocument,
        app,
        exposeApiDocs: false,
        paths: join(compiledSnapshot, 'model', 'service', 'api'),
        errorMiddleware: (error, _request, response, _next) => response.status(400).json(error),
    });
    return app;
};

const request = (path: string, init?: RequestInit): Promise<Response> => fetch(`${origin}${path}`, init);
const expectJson = async (response: Response, status: number, body: unknown): Promise<void> => {
    expect(response.status).toBe(status);
    expect(response.headers.get('content-type')?.toLowerCase()).toContain('application/json');
    await expect(response.json()).resolves.toEqual(body);
};

beforeAll(async () => {
    const app = await createOpenApiApp();
    server = createServer(app);
    server.listen(0, loopbackHost);
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Program Guide HTTP fixture did not bind');
    origin = ['http', '://', loopbackHost, ':', String(address.port)].join('');
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
        server.close(error => (error === undefined ? resolve() : reject(error))),
    );
});

describe('Program Guide public HTTP contract', () => {
    it('[PG-T6.4] preserves every public route, request mapping, field key, and optional-field condition', async () => {
        const channelApi = {
            getChannels: vi.fn(async () => [channelWithOptionalFields, channelWithoutOptionalFields]),
        };
        const scheduleApi = {
            getBroadcastingSchedule: vi.fn(async () => schedule),
            getChannelSchedule: vi.fn(async () => schedule),
            getSchedule: vi.fn(async () => completeProgram),
            getSchedules: vi.fn(async () => schedule),
            search: vi.fn(async () => [completeProgram, minimalProgram]),
        };
        const getOwner = vi
            .spyOn(modelContainer, 'get')
            .mockImplementation((token: string) => (token === 'IChannelApiModel' ? channelApi : scheduleApi));

        const channelsResponse = await request(apiPath('channels'));
        await expectJson(channelsResponse, 200, [channelWithOptionalFields, channelWithoutOptionalFields]);

        const schedulesResponse = await request(
            `${apiPath('schedules')}?startAt=1000&endAt=62000&isHalfWidth=false&needsRawExtended=true&isFree=true&GR=true&BS=false&CS=false&SKY=false`,
        );
        await expectJson(schedulesResponse, 200, schedule);

        const channelScheduleResponse = await request(
            `${apiPath('schedules', '1')}?startAt=1000&days=2&isHalfWidth=true&needsRawExtended=false&isFree=false`,
        );
        await expectJson(channelScheduleResponse, 200, schedule);

        const detailResponse = await request(`${apiPath('schedules', 'detail', '11')}?isHalfWidth=false`);
        await expectJson(detailResponse, 200, completeProgram);

        const broadcastingResponse = await request(
            `${apiPath('schedules', 'broadcasting')}?time=1000&isHalfWidth=false`,
        );
        await expectJson(broadcastingResponse, 200, schedule);

        const searchOption = { keyword: 'synthetic', name: true, channelIds: [1] };
        const searchResponse = await request(apiPath('schedules', 'search'), {
            body: JSON.stringify({ option: searchOption, isHalfWidth: false, limit: 2 }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });
        await expectJson(searchResponse, 200, [completeProgram, minimalProgram]);

        expect(channelApi.getChannels).toHaveBeenCalledOnce();
        expect(scheduleApi.getSchedules).toHaveBeenCalledWith({
            BS: false,
            CS: false,
            GR: true,
            SKY: false,
            endAt: 62_000,
            isFree: true,
            isHalfWidth: false,
            needsRawExtended: true,
            startAt: 1_000,
        });
        expect(scheduleApi.getChannelSchedule).toHaveBeenCalledWith({
            channelId: 1,
            days: 2,
            isFree: false,
            isHalfWidth: true,
            needsRawExtended: false,
            startAt: 1_000,
        });
        expect(scheduleApi.getSchedule).toHaveBeenCalledWith(11, false);
        expect(scheduleApi.getBroadcastingSchedule).toHaveBeenCalledWith({ isHalfWidth: false, time: 1_000 });
        expect(scheduleApi.search).toHaveBeenCalledWith(searchOption, false, 2);
        expect(getOwner.mock.calls.map(([token]) => token)).toEqual([
            'IChannelApiModel',
            'IScheduleApiModel',
            'IScheduleApiModel',
            'IScheduleApiModel',
            'IScheduleApiModel',
            'IScheduleApiModel',
        ]);
        expect(Object.keys(channelWithOptionalFields).sort()).toEqual([
            'channel',
            'channelType',
            'halfWidthName',
            'hasLogoData',
            'id',
            'name',
            'networkId',
            'remoteControlKeyId',
            'serviceId',
            'type',
        ]);
        expect(Object.keys(channelWithoutOptionalFields).sort()).toEqual([
            'channel',
            'channelType',
            'halfWidthName',
            'hasLogoData',
            'id',
            'name',
            'networkId',
            'serviceId',
        ]);
        expect(Object.keys(minimalProgram).sort()).toEqual(['channelId', 'endAt', 'id', 'isFree', 'name', 'startAt']);
        expect(Object.keys(completeProgram).sort()).toEqual([
            'audioComponentType',
            'audioSamplingRate',
            'channelId',
            'description',
            'endAt',
            'extended',
            'genre1',
            'genre2',
            'genre3',
            'id',
            'isFree',
            'name',
            'rawExtended',
            'startAt',
            'subGenre1',
            'subGenre2',
            'subGenre3',
            'videoComponentType',
            'videoResolution',
            'videoStreamContent',
            'videoType',
        ]);
    });

    it('[PG-T6.4] keeps detail not-found and owner failures on their existing JSON wires', async () => {
        const detailApi = {
            getSchedule: vi.fn(async () => null),
        };
        vi.spyOn(modelContainer, 'get').mockReturnValue(detailApi);
        await expectJson(await request(`${apiPath('schedules', 'detail', '404')}?isHalfWidth=false`), 404, {
            code: 404,
            message: 'program is not found',
        });

        const cases = [
            { method: 'getChannels', path: apiPath('channels') },
            {
                method: 'getSchedules',
                path: `${apiPath('schedules')}?startAt=1000&endAt=62000&isHalfWidth=false&GR=true&BS=false&CS=false&SKY=false`,
            },
            {
                method: 'getChannelSchedule',
                path: `${apiPath('schedules', '1')}?startAt=1000&days=1&isHalfWidth=false`,
            },
            { method: 'getSchedule', path: `${apiPath('schedules', 'detail', '11')}?isHalfWidth=false` },
            {
                method: 'getBroadcastingSchedule',
                path: `${apiPath('schedules', 'broadcasting')}?isHalfWidth=false`,
            },
        ] as const;
        for (const contract of cases) {
            const failure = new Error(`synthetic-${contract.method}-failure`);
            vi.spyOn(modelContainer, 'get').mockReturnValue({
                [contract.method]: vi.fn(async () => Promise.reject(failure)),
            });
            await expectJson(await request(contract.path), 500, {
                code: 500,
                errors: failure.message,
                message: 'Internal Server Error',
            });
            vi.restoreAllMocks();
        }

        const searchFailure = new Error('synthetic-search-failure');
        vi.spyOn(modelContainer, 'get').mockReturnValue({
            search: vi.fn(async () => Promise.reject(searchFailure)),
        });
        const searchResponse = await request(apiPath('schedules', 'search'), {
            body: JSON.stringify({ option: { keyword: 'synthetic', name: true }, isHalfWidth: false }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });
        expect(searchResponse.status).toBe(500);
        await expectJson(searchResponse, 500, {
            code: 500,
            errors: searchFailure.message,
            message: 'Internal Server Error',
        });
    });

    it('[PG-T6.4] preserves uncached logo bytes, shared 404 categories, and acquisition failures as 500', async () => {
        const getLogo = vi.fn();
        const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue({ getLogo });
        const firstLogo = Buffer.from('synthetic-logo-first');
        const secondLogo = Buffer.from('synthetic-logo-second');
        getLogo.mockResolvedValueOnce(firstLogo).mockResolvedValueOnce(secondLogo);

        const first = await request(apiPath('channels', '1', 'logo'));
        expect(first.status).toBe(200);
        expect(first.headers.get('content-type')).toContain('image/png');
        expect(Buffer.from(await first.arrayBuffer())).toEqual(firstLogo);
        const second = await request(apiPath('channels', '1', 'logo'));
        expect(second.status).toBe(200);
        expect(second.headers.get('content-type')).toContain('image/png');
        expect(Buffer.from(await second.arrayBuffer())).toEqual(secondLogo);
        expect(getLogo.mock.calls).toEqual([[1], [1]]);

        for (const channelId of [2, 3]) {
            getLogo.mockRejectedValueOnce(new Error(IChannelApiModelError.NOT_FOUND));
            await expectJson(await request(apiPath('channels', String(channelId), 'logo')), 404, {
                code: 404,
                message: 'log file is not found',
            });
        }

        for (const category of ['network', 'status', 'parse', 'timeout'] as const) {
            const upstreamBody = `synthetic-${category}-body-must-not-escape`;
            const failure = Object.assign(new Error(`synthetic-logo-${category}-failure`), {
                body: Buffer.from(upstreamBody),
            });
            getLogo.mockRejectedValueOnce(failure);
            const response = await request(apiPath('channels', '4', 'logo'));
            const responseText = await response.text();
            expect(response.status).toBe(500);
            expect(response.headers.get('content-type')?.toLowerCase()).toContain('application/json');
            expect(JSON.parse(responseText)).toEqual({
                code: 500,
                errors: failure.message,
                message: 'Internal Server Error',
            });
            expect(responseText).not.toContain(upstreamBody);
        }
        expect(getOwner).toHaveBeenCalledTimes(8);
        expect(getLogo).toHaveBeenCalledTimes(8);
    });
});
