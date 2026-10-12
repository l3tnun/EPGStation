import express, { type Express } from 'express';
import * as openapi from 'express-openapi';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

interface SuccessCase {
    readonly domainArgs: readonly unknown[];
    readonly domainMethod: string;
    readonly method: 'DELETE' | 'GET' | 'POST' | 'PUT';
    readonly path: string;
    readonly requestBody?: unknown;
    readonly responseBody?: unknown;
    readonly result: unknown;
    readonly status: number;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const modelContainer = require(join(compiledSnapshot, 'model', 'ModelContainer.js')).default as {
    get(token: string): unknown;
};
const ReserveApiModel = require(join(compiledSnapshot, 'model', 'api', 'reserve', 'ReserveApiModel.js'))
    .default as new (
    ipc: unknown,
    reserveDB: unknown,
) => {
    get(reserveId: number, isHalfWidth: boolean): Promise<unknown>;
    gets(option: unknown): Promise<unknown>;
};
const loopbackHost = '127.0.0.1';
const apiPath = (...segments: string[]): string => ['', 'api', ...segments].join('/');

let origin = '';
let server: Server;

const copy = <T>(value: T): T => structuredClone(value);

const createOpenApiApp = async (): Promise<Express> => {
    const apiDocument = loadYaml(readFileSync('api.yml', 'utf8')) as Record<string, unknown>;
    apiDocument.servers = [{ url: apiPath() }];
    const app = express();
    app.use(express.json());
    // 実装と同じ query の握り方を使う。Express 5 の req.query は参照ごとに別の object を
    // 返すため、これが無いと OpenAPI 層の型変換（query の schema coercion）が次の参照に残らない。
    require(join(compiledSnapshot, 'model', 'service', 'ServiceServer.js')).holdParsedQuery(app);
    await openapi.initialize({
        apiDoc: apiDocument,
        app,
        errorMiddleware: (error, _request, response, _next) => response.status(400).json(error),
        exposeApiDocs: false,
        paths: join(compiledSnapshot, 'model', 'service', 'api'),
    });
    return app;
};

const request = (path: string, init?: RequestInit): Promise<Response> => fetch(`${origin}${path}`, init);

const projectedReserve = {
    allowEndLack: true,
    channelId: 4,
    channelType: 'GR',
    directory: 'synthetic-directory',
    encodeDirectory1: 'synthetic-encode-directory-1',
    encodeMode1: 1,
    encodeParentDirectoryName1: 'synthetic-encode-parent-1',
    endAt: 1_700_000_600_000,
    id: 41,
    isConflict: false,
    isDeleteOriginalAfterEncode: false,
    isOverlap: false,
    isSkip: false,
    isTimeSpecified: false,
    name: 'synthetic-reservation',
    parentDirectoryName: 'synthetic-parent',
    programId: 601,
    recordedFormat: 'ts',
    ruleId: 71,
    startAt: 1_700_000_000_000,
    tags: [3, 5],
};

const rawReserve = {
    ...projectedReserve,
    audioSamplingRate: null,
    description: null,
    encodeDirectory2: 'synthetic-private-encode-directory-2',
    encodeDirectory3: 'synthetic-encode-directory-3',
    encodeMode2: null,
    encodeMode3: null,
    encodeParentDirectoryName2: null,
    encodeParentDirectoryName3: null,
    extended: null,
    genre1: null,
    genre2: null,
    genre3: null,
    halfWidthDescription: null,
    halfWidthExtended: null,
    halfWidthName: 'synthetic-reservation-half-width',
    isEventRelay: true,
    rawExtended: null,
    rawHalfWidthExtended: null,
    recordedFormat: null,
    subGenre1: null,
    subGenre2: null,
    subGenre3: null,
    tags: '[3,5]',
    videoComponentType: null,
    videoResolution: null,
    videoStreamContent: null,
    videoType: null,
};
const { recordedFormat: _recordedFormat, ...projectedReserveWithoutNullRecordedFormat } = projectedReserve;
const halfWidthProjectedReserve = {
    ...projectedReserveWithoutNullRecordedFormat,
    encodeDirectory3: 'synthetic-encode-directory-3',
    name: 'synthetic-reservation-half-width',
};
const halfWidthProjectedReserveList = { reserves: [halfWidthProjectedReserve], total: 1 };
const addOption = {
    allowEndLack: true,
    programId: 601,
    saveOption: { directory: 'synthetic-directory', parentDirectoryName: 'synthetic-parent' },
    tags: [3, 5],
};
const editOption = {
    allowEndLack: false,
    encodeOption: { isDeleteOriginalAfterEncode: false, mode1: 'synthetic-mode' },
    tags: [7],
};

const failureCases: readonly Omit<SuccessCase, 'responseBody' | 'result' | 'status'>[] = [
    {
        domainArgs: [{ isHalfWidth: true, limit: 10, offset: 3, ruleId: 71, type: 'conflict' }],
        domainMethod: 'gets',
        method: 'GET',
        path: `${apiPath('reserves')}?type=conflict&ruleId=71&offset=3&limit=10&isHalfWidth=true`,
    },
    {
        domainArgs: [41, true],
        domainMethod: 'get',
        method: 'GET',
        path: `${apiPath('reserves', '41')}?isHalfWidth=true`,
    },
    {
        domainArgs: [addOption],
        domainMethod: 'add',
        method: 'POST',
        path: apiPath('reserves'),
        requestBody: addOption,
    },
    {
        domainArgs: [41, editOption],
        domainMethod: 'edit',
        method: 'PUT',
        path: apiPath('reserves', '41'),
        requestBody: editOption,
    },
    {
        domainArgs: [41],
        domainMethod: 'cancel',
        method: 'DELETE',
        path: apiPath('reserves', '41'),
    },
];

const successCases: readonly SuccessCase[] = [
    {
        domainArgs: [addOption],
        domainMethod: 'add',
        method: 'POST',
        path: apiPath('reserves'),
        requestBody: addOption,
        responseBody: { reserveId: 81 },
        result: 81,
        status: 201,
    },
    {
        domainArgs: [41, editOption],
        domainMethod: 'edit',
        method: 'PUT',
        path: apiPath('reserves', '41'),
        requestBody: editOption,
        responseBody: { code: 201, message: 'ok' },
        result: undefined,
        status: 201,
    },
    {
        domainArgs: [41],
        domainMethod: 'cancel',
        method: 'DELETE',
        path: apiPath('reserves', '41'),
        result: undefined,
        status: 200,
    },
];

beforeAll(async () => {
    const app = await createOpenApiApp();
    server = createServer(app);
    server.listen(0, loopbackHost);
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Reservation HTTP fixture did not bind');
    origin = ['http', '://', loopbackHost, ':', String(address.port)].join('');
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
        server.close(error => (error === undefined ? resolve() : reject(error))),
    );
});

describe('public-routes-status-body-and-projection', () => {
    it('[RM-T9.5][RM-9.4] GET list and detail project optional fields without leaking private reservation fields', async () => {
        const reserveDB = {
            findAll: vi.fn().mockResolvedValue([[copy(rawReserve)], 1]),
            findId: vi.fn().mockResolvedValue(copy(rawReserve)),
        };
        const reserveApiModel = new ReserveApiModel(undefined, reserveDB);
        const gets = vi.spyOn(reserveApiModel, 'gets');
        const get = vi.spyOn(reserveApiModel, 'get');
        const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue(reserveApiModel);

        const listResponse = await request(
            `${apiPath('reserves')}?type=conflict&ruleId=71&offset=3&limit=10&isHalfWidth=true`,
        );
        const detailResponse = await request(`${apiPath('reserves', '41')}?isHalfWidth=true`);

        expect(getOwner).toHaveBeenNthCalledWith(1, 'IReserveApiModel');
        expect(getOwner).toHaveBeenNthCalledWith(2, 'IReserveApiModel');
        expect(gets).toHaveBeenCalledExactlyOnceWith({
            isHalfWidth: true,
            limit: 10,
            offset: 3,
            ruleId: 71,
            type: 'conflict',
        });
        expect(get).toHaveBeenCalledExactlyOnceWith(41, true);
        expect(reserveDB.findAll).toHaveBeenCalledExactlyOnceWith({
            isHalfWidth: true,
            limit: 10,
            offset: 3,
            ruleId: 71,
            type: 'conflict',
        });
        expect(reserveDB.findId).toHaveBeenCalledExactlyOnceWith(41);
        expect(listResponse.status).toBe(200);
        expect(detailResponse.status).toBe(200);
        await expect(listResponse.json()).resolves.toEqual(halfWidthProjectedReserveList);
        await expect(detailResponse.json()).resolves.toEqual(halfWidthProjectedReserve);
    });

    it.each(successCases)(
        '[RM-T9.5][RM-9.4] $method $path preserves the existing route, request, status, optional fields, and JSON body',
        async contract => {
            const operation = vi.fn().mockResolvedValue(copy(contract.result));
            const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue({ [contract.domainMethod]: operation });
            const init: RequestInit = { method: contract.method };
            if (typeof contract.requestBody !== 'undefined') {
                init.body = JSON.stringify(contract.requestBody);
                init.headers = { 'content-type': 'application/json' };
            }

            const response = await request(contract.path, init);

            expect(getOwner).toHaveBeenCalledExactlyOnceWith('IReserveApiModel');
            expect(operation).toHaveBeenCalledExactlyOnceWith(...copy(contract.domainArgs));
            expect(response.status).toBe(contract.status);
            expect(response.headers.get('cache-control')).toBe('private, no-cache, no-store, must-revalidate');
            expect(response.headers.get('expires')).toBe('-1');
            expect(response.headers.get('pragma')).toBe('no-cache');
            if (typeof contract.responseBody === 'undefined') {
                await expect(response.text()).resolves.toBe('');
            } else {
                expect(response.headers.get('content-type')).toContain('application/json');
                await expect(response.json()).resolves.toEqual(contract.responseBody);
            }
        },
    );

    it('[RM-T9.5][RM-9.4] GET /api/reserves/{reserveId} preserves the existing not-found projection', async () => {
        const get = vi.fn().mockResolvedValue(null);
        vi.spyOn(modelContainer, 'get').mockReturnValue({ get });

        const response = await request(`${apiPath('reserves', '404')}?isHalfWidth=false`);

        expect(get).toHaveBeenCalledExactlyOnceWith(404, false);
        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({ code: 404, message: 'reserve is not found' });
    });

    it.each(failureCases)(
        '[RM-T9.5][RM-9.4] $method $path preserves the existing domain failure projection',
        async contract => {
            const failure = new Error(`synthetic-${contract.domainMethod}-failure`);
            const operation = vi.fn().mockRejectedValue(failure);
            const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue({ [contract.domainMethod]: operation });
            const init: RequestInit = { method: contract.method };
            if (typeof contract.requestBody !== 'undefined') {
                init.body = JSON.stringify(contract.requestBody);
                init.headers = { 'content-type': 'application/json' };
            }

            const response = await request(contract.path, init);

            expect(getOwner).toHaveBeenCalledExactlyOnceWith('IReserveApiModel');
            expect(operation).toHaveBeenCalledExactlyOnceWith(...copy(contract.domainArgs));
            expect(response.status).toBe(500);
            await expect(response.json()).resolves.toEqual({
                code: 500,
                errors: failure.message,
                message: 'Internal Server Error',
            });
        },
    );
});
