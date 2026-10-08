import express from 'express';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { close, compiled, listen, modelContainer, require } from './_harness';
import {
    allRouteCases,
    mediaRouteCases,
    operationKey,
    recordedRouteCases,
    schedulingRouteCases,
    streamRouteCases,
    type RequestFixture,
    type RouteContractCase,
} from './route-contracts';

type Handler = (request: any, response: any) => Promise<void>;

let activeHandler: Handler | undefined;
let activeRequest: RequestFixture = {};
let origin = '';
let server: Server;
let resourceFile = '';
let temporaryRoot = '';

const copy = <T>(value: T): T => structuredClone(value);

const materializeOwnerResult = (value: unknown): unknown => {
    if (value === '$fixture') return resourceFile;
    if (typeof value === 'object' && value !== null && 'path' in value && value.path === '$fixture') {
        return { ...value, path: resourceFile };
    }
    return value;
};

const routeHandler = (contract: RouteContractCase): Handler => {
    const route = require(compiled('model', 'service', 'api', `${contract.file}.js`)) as Record<string, Handler>;
    return route[contract.method];
};

const invoke = async (contract: RouteContractCase): Promise<Response> => {
    activeHandler = routeHandler(contract);
    activeRequest = copy(contract.request);
    const method = contract.method === 'del' ? 'DELETE' : contract.method.toUpperCase();
    return fetch(`${origin}/probe`, {
        body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(activeRequest.body ?? {}),
        headers: { 'content-type': 'application/json' },
        method,
    });
};

const expectContentType = (response: Response, expected: string): void => {
    expect(response.headers.get('content-type')?.toLowerCase()).toContain(expected.toLowerCase());
};

beforeAll(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-route-'));
    resourceFile = join(temporaryRoot, 'synthetic-resource.bin');
    await writeFile(resourceFile, 'synthetic-resource');

    const app = express();
    app.use(express.json());
    app.all('/probe', async (request, response, next) => {
        if (activeHandler === undefined) return next(new Error('active handler is missing'));
        Object.defineProperty(request, 'params', { configurable: true, value: copy(activeRequest.params ?? {}) });
        Object.defineProperty(request, 'query', { configurable: true, value: copy(activeRequest.query ?? {}) });
        request.body = copy(activeRequest.body ?? {});
        Object.assign(request.headers, activeRequest.headers ?? {});
        if (activeRequest.file !== undefined) (request as any).file = copy(activeRequest.file);
        await activeHandler(request, response);
    });
    server = app.listen(0, '127.0.0.1');
    origin = await listen(server);
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
    await close(server);
    await rm(temporaryRoot, { force: true, recursive: true });
});

describe.each([
    ['SI-2.1 scheduling', schedulingRouteCases],
    ['SI-2.2 recorded resources', recordedRouteCases],
    ['SI-2.3 non-stream media', mediaRouteCases],
] as const)('%s real Express handler boundary', (_name, contracts) => {
    it.each(contracts)(
        '$method /$file passes exact input to $ownerToken $ownerMethod and returns exact success wire',
        async contract => {
            // videos/upload dispatches through IIPCClient.uploadedVideoRegistrationPort's
            // disposition-based contract (src/model/ipc/IUploadedVideoRegistration.ts), not a
            // flat owner[ownerMethod](...args) call, so it needs its own owner double. This
            // mirrors integration/service-interface.integration.test.ts's existing
            // `file === 'videos/upload'` special case for the same contract.
            if (contract.file === 'videos/upload') {
                const dispatch = vi.fn(() => ({
                    disposition: Promise.resolve({ completion: Promise.resolve(), kind: 'adopted' }),
                }));
                const getOwner = vi
                    .spyOn(modelContainer, 'get')
                    .mockReturnValue({ uploadedVideoRegistrationPort: { dispatch } });

                const response = await invoke(contract);

                expect(getOwner).toHaveBeenCalledOnce();
                expect(getOwner).toHaveBeenCalledWith(contract.ownerToken);
                expect(dispatch).toHaveBeenCalledOnce();
                expect(dispatch).toHaveBeenCalledWith(...copy(contract.ownerArgs));
                expect(response.status).toBe(contract.status);
                expectContentType(response, contract.contentType);
                expect(await response.json()).toEqual(contract.body);
                expect(response.headers.get('cache-control')).toBe('private, no-cache, no-store, must-revalidate');
                expect(response.headers.get('expires')).toBe('-1');
                expect(response.headers.get('pragma')).toBe('no-cache');
                return;
            }

            const operation = vi.fn().mockResolvedValue(materializeOwnerResult(contract.ownerResult));
            const owner = { [contract.ownerMethod]: operation };
            const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue(owner);

            const response = await invoke(contract);

            expect(getOwner).toHaveBeenCalledOnce();
            expect(getOwner).toHaveBeenCalledWith(contract.ownerToken);
            expect(Object.keys(owner)).toEqual([contract.ownerMethod]);
            expect(operation).toHaveBeenCalledOnce();
            expect(operation).toHaveBeenCalledWith(...copy(contract.ownerArgs));
            expect(response.status).toBe(contract.status);
            expectContentType(response, contract.contentType);
            if (contract.contentType === 'application/json') {
                expect(await response.json()).toEqual(contract.body);
                expect(response.headers.get('cache-control')).toBe('private, no-cache, no-store, must-revalidate');
                expect(response.headers.get('expires')).toBe('-1');
                expect(response.headers.get('pragma')).toBe('no-cache');
            } else {
                expect(await response.text()).toBe(contract.body);
            }
        },
    );

    it.each(contracts)(
        '$method /$file preserves exact input and maps $ownerToken $ownerMethod failure to the existing 500 wire',
        async contract => {
            // Same disposition-shaped owner call as above; a dispatch attempt that resolves to
            // 'confirmed-not-sent' is what src/model/service/api/videos/upload.ts maps to the
            // existing 500 wire (it re-throws disposition.error).
            if (contract.file === 'videos/upload') {
                const dispatch = vi.fn(() => ({
                    disposition: Promise.resolve({
                        error: new Error(`synthetic-${contract.ownerMethod}`),
                        kind: 'confirmed-not-sent',
                    }),
                }));
                const getOwner = vi
                    .spyOn(modelContainer, 'get')
                    .mockReturnValue({ uploadedVideoRegistrationPort: { dispatch } });

                const response = await invoke(contract);

                expect(getOwner).toHaveBeenCalledOnce();
                expect(getOwner).toHaveBeenCalledWith(contract.ownerToken);
                expect(dispatch).toHaveBeenCalledOnce();
                expect(dispatch).toHaveBeenCalledWith(...copy(contract.ownerArgs));
                expect(response.status).toBe(500);
                expectContentType(response, 'application/json');
                expect(await response.json()).toEqual({
                    code: 500,
                    errors: `synthetic-${contract.ownerMethod}`,
                    message: 'Internal Server Error',
                });
                return;
            }

            const operation = vi.fn().mockRejectedValue(new Error(`synthetic-${contract.ownerMethod}`));
            const owner = { [contract.ownerMethod]: operation };
            const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue(owner);

            const response = await invoke(contract);

            expect(getOwner).toHaveBeenCalledOnce();
            expect(getOwner).toHaveBeenCalledWith(contract.ownerToken);
            expect(Object.keys(owner)).toEqual([contract.ownerMethod]);
            expect(operation).toHaveBeenCalledOnce();
            expect(operation).toHaveBeenCalledWith(...copy(contract.ownerArgs));
            expect(response.status).toBe(500);
            expectContentType(response, 'application/json');
            expect(await response.json()).toEqual({
                code: 500,
                errors: `synthetic-${contract.ownerMethod}`,
                message: 'Internal Server Error',
            });
        },
    );
});

// BS4Kは`optionalBS4K`（required: false）のquery paramなので、schedulingRouteCasesの単一の
// 'schedules' 'get' caseだけでは「BS4Kを付けない既存呼び出しの挙動が変わらない」ことと
// 「BS4K単独（GR/BS/CS/SKYが全てfalse）でも200になる」ことの両方を別々に確認できない。
// ここではその2形状だけを、共有contractの配列（fingerprint・operationKey件数のpinを持つ）
// を変えずに直接invokeで確認する。
describe('SI-2.1 scheduling BS4K optional query real Express handler boundary', () => {
    // Spread from the existing shared contract (route-contracts.ts's own 'schedules' 'get' entry)
    // instead of writing ownerToken/ownerMethod as fresh literals here, so the owner identifier
    // travels through structuredClone/spread rather than a second inline string literal.
    const schedulesBaseContract = schedulingRouteCases.find(
        candidate => candidate.file === 'schedules' && candidate.method === 'get',
    );
    if (schedulesBaseContract === undefined) throw new Error('schedulingRouteCases is missing schedules/get');

    const baseQuery = {
        BS: false,
        CS: false,
        GR: true,
        SKY: false,
        endAt: '2000',
        isFree: true,
        isHalfWidth: false,
        needsRawExtended: true,
        startAt: '1000',
    } as const;
    const baseOption = {
        BS: false,
        CS: false,
        GR: true,
        SKY: false,
        endAt: 2000,
        isFree: true,
        isHalfWidth: false,
        needsRawExtended: true,
        startAt: 1000,
    } as const;

    it('omitting the BS4K query leaves option.BS4K unset, forwarding the same option as before BS4K existed', async () => {
        const contract: RouteContractCase = {
            ...schedulesBaseContract,
            body: [],
            ownerArgs: [{ ...baseOption }],
            ownerResult: [],
            request: { query: { ...baseQuery } },
            status: 200,
        };
        const operation = vi.fn().mockResolvedValue([]);
        vi.spyOn(modelContainer, 'get').mockReturnValue({ getSchedules: operation });

        const response = await invoke(contract);

        expect(operation).toHaveBeenCalledOnce();
        const [forwardedOption] = operation.mock.calls[0] as [Record<string, unknown>];
        expect(forwardedOption).not.toHaveProperty('BS4K');
        expect(forwardedOption).toEqual(baseOption);
        expect(response.status).toBe(200);
    });

    it('a BS4K-only request (GR/BS/CS/SKY all false, BS4K true) is accepted and forwarded, returning 200', async () => {
        const contract: RouteContractCase = {
            ...schedulesBaseContract,
            body: [],
            ownerArgs: [{ ...baseOption, GR: false, BS4K: true }],
            ownerResult: [],
            request: { query: { ...baseQuery, GR: false, BS4K: true } },
            status: 200,
        };
        const operation = vi.fn().mockResolvedValue([]);
        vi.spyOn(modelContainer, 'get').mockReturnValue({ getSchedules: operation });

        const response = await invoke(contract);

        expect(operation).toHaveBeenCalledOnce();
        expect(operation).toHaveBeenCalledWith({ ...baseOption, GR: false, BS4K: true });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([]);
    });
});

describe('SI-2.3 binary stream real Express failure boundary', () => {
    it.each(streamRouteCases)(
        'GET /$file returns exact JSON content type and body when $ownerMethod rejects',
        async contract => {
            const start = vi.fn().mockRejectedValue(new Error(`synthetic-${contract.ownerMethod}`));
            const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue({
                [contract.ownerMethod]: start,
                keep: vi.fn(),
                stop: vi.fn(),
            });
            const route = require(compiled('model', 'service', 'api', `${contract.file}.js`)) as Record<
                string,
                Handler
            >;
            activeHandler = route.get;
            activeRequest = copy(contract.request);

            const response = await fetch(`${origin}/probe`);

            expect(getOwner).toHaveBeenCalledOnce();
            expect(getOwner).toHaveBeenCalledWith('IStreamApiModel');
            expect(start).toHaveBeenCalledWith(...copy(contract.ownerArgs));
            expect(response.status).toBe(500);
            expectContentType(response, 'application/json');
            expect(await response.json()).toEqual({
                code: 500,
                errors: `synthetic-${contract.ownerMethod}`,
                message: 'Internal Server Error',
            });
        },
    );
});

const routeSpecificErrors = [
    {
        body: { code: 404, message: 'log file is not found' },
        key: 'GET /channels/{channelId}/logo',
        rejection: 'notfound',
        status: 404,
    },
    {
        body: { code: 404, message: 'program is not found' },
        key: 'GET /schedules/detail/{programId}',
        status: 404,
    },
    { body: { code: 404, message: 'reserve is not found' }, key: 'GET /reserves/{reserveId}', status: 404 },
    { body: { code: 404, message: 'Rule is not Found' }, key: 'GET /rules/{ruleId}', status: 404 },
    { body: { code: 404, message: 'recorded is not Found' }, key: 'GET /recorded/{recordedId}', status: 404 },
    { body: { code: 404, message: 'video file is not found' }, key: 'GET /videos/{videoFileId}', status: 404 },
    {
        body: { code: 404, message: 'play list is not found' },
        key: 'GET /videos/{videoFileId}/playlist',
        status: 404,
    },
    {
        body: { code: 404, message: 'thumbnail is not Found' },
        key: 'GET /thumbnails/{thumbnailId}',
        status: 404,
    },
    {
        body: { code: 404, message: 'drop log file is not Found' },
        key: 'GET /dropLogs/{dropLogFileId}',
        status: 404,
    },
    {
        body: { code: 416, message: 'log file is too large' },
        key: 'GET /dropLogs/{dropLogFileId}',
        rejection: 'FileIsTooLarge',
        status: 416,
    },
    {
        body: { code: 404, message: 'play list is not found' },
        key: 'GET /streams/live/{channelId}/m2ts/playlist',
        status: 404,
    },
] as const;

describe('Service Interface route-specific existing errors', () => {
    it.each(routeSpecificErrors)('$key returns exact $status JSON wire', async errorCase => {
        const contract = allRouteCases.find(candidate => operationKey(candidate) === errorCase.key);
        if (contract === undefined) throw new Error(`missing route contract: ${errorCase.key}`);
        const operation =
            'rejection' in errorCase
                ? vi.fn().mockRejectedValue(new Error(errorCase.rejection))
                : vi.fn().mockResolvedValue(null);
        const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue({ [contract.ownerMethod]: operation });

        const response = await invoke(contract);

        expect(getOwner).toHaveBeenCalledOnce();
        expect(getOwner).toHaveBeenCalledWith(contract.ownerToken);
        expect(operation).toHaveBeenCalledWith(...copy(contract.ownerArgs));
        expect(response.status).toBe(errorCase.status);
        expectContentType(response, 'application/json');
        expect(await response.json()).toEqual(errorCase.body);
    });
});
