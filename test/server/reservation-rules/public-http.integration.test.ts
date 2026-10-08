import express, { type Express } from 'express';
import * as openapi from 'express-openapi';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

interface SuccessCase {
    readonly domainArgs: readonly unknown[];
    readonly domainMethod: string;
    readonly method: 'DELETE' | 'GET' | 'POST' | 'PUT';
    readonly path: string;
    readonly requestBody?: unknown;
    readonly result: unknown;
    readonly responseBody: unknown;
    readonly status: number;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const modelContainer = require(join(compiledSnapshot, 'model', 'ModelContainer.js')).default as {
    get(token: string): unknown;
};
const { holdParsedQuery } = require(join(compiledSnapshot, 'model', 'service', 'ServiceServer.js')) as {
    holdParsedQuery(app: Express): void;
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
    // 返すため、これが無いと OpenAPI 層の型変換が次の参照に残らない。
    holdParsedQuery(app);
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

const ruleOption = {
    isTimeSpecification: false,
    reserveOption: { allowEndLack: false, avoidDuplicate: false, enable: true },
    searchOption: { GR: true, keyword: 'synthetic-rule', name: true },
};

const rule = { ...ruleOption, id: 41, updateCnt: 3 };
const ruleList = { rules: [rule], total: 1 };

const successCases: readonly SuccessCase[] = [
    {
        domainArgs: [{ keyword: 'synthetic-rule', limit: 10, offset: 3, type: 'normal' }],
        domainMethod: 'gets',
        method: 'GET',
        path: `${apiPath('rules')}?keyword=synthetic-rule&offset=3&limit=10&type=normal`,
        result: ruleList,
        responseBody: ruleList,
        status: 200,
    },
    {
        domainArgs: [ruleOption],
        domainMethod: 'add',
        method: 'POST',
        path: apiPath('rules'),
        requestBody: ruleOption,
        result: 41,
        responseBody: { ruleId: 41 },
        status: 201,
    },
    {
        domainArgs: [{ keyword: 'synthetic-rule', limit: 10, offset: 3 }],
        domainMethod: 'searchKeyword',
        method: 'GET',
        path: `${apiPath('rules', 'keyword')}?keyword=synthetic-rule&offset=3&limit=10`,
        result: [{ id: 41, keyword: 'synthetic-rule' }],
        responseBody: { items: [{ id: 41, keyword: 'synthetic-rule' }] },
        status: 200,
    },
    {
        domainArgs: [ruleOption],
        domainMethod: 'add',
        method: 'POST',
        path: apiPath('rules', 'keyword'),
        requestBody: ruleOption,
        result: 41,
        responseBody: { ruleId: 41 },
        status: 201,
    },
    {
        domainArgs: [41],
        domainMethod: 'get',
        method: 'GET',
        path: apiPath('rules', '41'),
        result: rule,
        responseBody: rule,
        status: 200,
    },
    {
        domainArgs: [41],
        domainMethod: 'delete',
        method: 'DELETE',
        path: apiPath('rules', '41'),
        result: undefined,
        responseBody: { code: 200 },
        status: 200,
    },
    {
        domainArgs: [{ ...ruleOption, id: 41 }],
        domainMethod: 'update',
        method: 'PUT',
        path: apiPath('rules', '41'),
        requestBody: ruleOption,
        result: undefined,
        responseBody: { code: 200 },
        status: 200,
    },
    {
        domainArgs: [41],
        domainMethod: 'enable',
        method: 'PUT',
        path: apiPath('rules', '41', 'enable'),
        result: undefined,
        responseBody: { code: 200 },
        status: 200,
    },
    {
        domainArgs: [41],
        domainMethod: 'disable',
        method: 'PUT',
        path: apiPath('rules', '41', 'disable'),
        result: undefined,
        responseBody: { code: 200 },
        status: 200,
    },
];

beforeAll(async () => {
    const app = await createOpenApiApp();
    server = createServer(app);
    server.listen(0, loopbackHost);
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Rule HTTP fixture did not bind');
    origin = ['http', '://', loopbackHost, ':', String(address.port)].join('');
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
        server.close(error => (error === undefined ? resolve() : reject(error))),
    );
});

describe('reservation rule public HTTP carrier', () => {
    it.each(successCases)(
        '$method $path preserves the existing route, request, status, and JSON body',
        async contract => {
            const operation = vi.fn().mockResolvedValue(copy(contract.result));
            const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue({ [contract.domainMethod]: operation });
            const init: RequestInit = { method: contract.method };
            if (typeof contract.requestBody !== 'undefined') {
                init.body = JSON.stringify(contract.requestBody);
                init.headers = { 'content-type': 'application/json' };
            }

            const response = await request(contract.path, init);

            expect(getOwner).toHaveBeenCalledExactlyOnceWith('IRuleApiModel');
            expect(operation).toHaveBeenCalledExactlyOnceWith(...copy(contract.domainArgs));
            expect(response.status).toBe(contract.status);
            expect(response.headers.get('content-type')).toContain('application/json');
            expect(response.headers.get('cache-control')).toBe('private, no-cache, no-store, must-revalidate');
            expect(response.headers.get('expires')).toBe('-1');
            expect(response.headers.get('pragma')).toBe('no-cache');
            await expect(response.json()).resolves.toEqual(contract.responseBody);
        },
    );

    it('GET /api/rules applies the existing optional query defaults before reaching the domain option', async () => {
        const gets = vi.fn().mockResolvedValue({ rules: [], total: 0 });
        vi.spyOn(modelContainer, 'get').mockReturnValue({ gets });

        const response = await request(`${apiPath('rules')}?keyword=synthetic-only`);

        expect(gets).toHaveBeenCalledExactlyOnceWith({ keyword: 'synthetic-only', limit: 24, offset: 0 });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ rules: [], total: 0 });
    });

    it('GET /api/rules/{ruleId} preserves the existing not-found projection', async () => {
        const get = vi.fn().mockResolvedValue(null);
        vi.spyOn(modelContainer, 'get').mockReturnValue({ get });

        const response = await request(apiPath('rules', '404'));

        expect(get).toHaveBeenCalledExactlyOnceWith(404);
        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({ code: 404, message: 'Rule is not Found' });
    });

    it('[RR-1.2] POST /api/rules preserves the existing domain failure projection', async () => {
        const add = vi.fn().mockRejectedValue(new Error('synthetic-rule-domain-failure'));
        vi.spyOn(modelContainer, 'get').mockReturnValue({ add });

        const response = await request(apiPath('rules'), {
            body: JSON.stringify(ruleOption),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });

        expect(add).toHaveBeenCalledExactlyOnceWith(ruleOption);
        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
            code: 500,
            errors: 'synthetic-rule-domain-failure',
            message: 'Internal Server Error',
        });
    });
});
