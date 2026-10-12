import express from 'express';
import { once } from 'node:events';
import { readdir, rm, mkdtemp } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { close, compiled, listen, modelContainer, require } from '../service-interface/_harness';

const ServiceServer = (require(compiled('model', 'service', 'ServiceServer.js')) as { default: any }).default;
const UploadAdmissionController = (
    require(compiled('model', 'service', 'upload', 'UploadAdmissionController.js')) as {
        default: new (limit: number) => any;
    }
).default;
const getUploadRequestFinalizer = (
    require(compiled('model', 'service', 'upload', 'UploadAdmissionController.js')) as {
        getUploadRequestFinalizer(request: object): unknown;
    }
).getUploadRequestFinalizer;
const originalApiYml = ServiceServer.API_YML;
const originalPackageJson = ServiceServer.PACKAGE_JSON;

const servers: any[] = [];
const temporaryRoots: string[] = [];
const loopbackHost = '127.0.0.1';

const createOpenApiService = (uploadRoot: string): any => {
    const service = Object.create(ServiceServer.prototype) as any;
    service.app = express();
    service.config = {
        apiServers: ['http://synthetic.invalid'],
        concurrentUploadNum: 1,
        uploadReceiveTimeoutMs: 30_000,
        uploadTempDir: uploadRoot,
    };
    service.log = { access: { error: vi.fn(), info: vi.fn() }, system: { error: vi.fn(), info: vi.fn() } };
    service.uploadAdmission = new UploadAdmissionController(service.config.concurrentUploadNum);
    ServiceServer.API_YML = join(process.cwd(), 'api.yml');
    ServiceServer.PACKAGE_JSON = join(process.cwd(), 'package.json');
    service.createUploadDir();
    // Production's `init()` always calls `holdParsedQuery()` immediately before `initOpenApi()`
    // (src/model/service/ServiceServer.ts) because Express 5's `req.query` re-parses the raw query
    // string on every access, discarding the OpenAPI layer's in-place type coercion. This harness
    // builds a partial `ServiceServer` directly (bypassing `init()`), so it must replicate that same
    // ordering or integer/boolean query parameters are rejected with 400 even though production works.
    service.holdParsedQuery();
    service.initOpenApi(service.getApiDocument(ServiceServer.API_YML));
    return service;
};

const jsonRequest = async (origin: string, path: string, method = 'GET', body?: object): Promise<Response> =>
    fetch(`${origin}${path}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        method,
    });

const uploadRequest = async (origin: string): Promise<Response> => {
    const body = new FormData();
    body.set('recordedId', '12');
    body.set('parentDirectoryName', 'main');
    body.set('viewName', 'Task 7.4 upload');
    body.set('fileType', 'ts');
    body.set('file', new Blob(['task-7-4-bytes']), 'task-7-4.ts');
    return fetch(`${origin}/api/videos/upload`, { body, method: 'POST' });
};

afterEach(async () => {
    vi.restoreAllMocks();
    ServiceServer.API_YML = originalApiYml;
    ServiceServer.PACKAGE_JSON = originalPackageJson;
    await Promise.all(servers.splice(0).map(server => (server.listening ? close(server) : Promise.resolve())));
    await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { force: true, recursive: true })));
});

describe('recorded content public HTTP integration', () => {
    it('public-recorded-operations', async () => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-recorded-task-7-4-http-'));
        temporaryRoots.push(uploadRoot);
        const recorded = {
            addUploadedVideoFile: vi.fn(async () => undefined),
            changeProtect: vi.fn(async () => undefined),
            createNewRecorded: vi.fn(async () => 701),
            delete: vi.fn(async () => undefined),
            fileCleanup: vi.fn(async () => undefined),
            get: vi.fn(async () => ({ id: 12, name: 'Task 7.4 detail' })),
            gets: vi.fn(async () => ({ records: [{ id: 12, name: 'Task 7.4 list' }], total: 1 })),
        };
        const recordedTag = { setRelation: vi.fn(async () => undefined) };
        // The upload route goes through the IPC registration port, not
        // `IRecordedApiModel.addUploadedVideoFile`, per `.kiro/specs/server-recorded-content/design.md:179-182`
        // (the SI process forwards the option to the parent's `RecordedManageModel`). An owner mock
        // without `IIPCClient` makes the route answer 500, so the port is doubled the same way as
        // `test/server/service-interface/upload.spec.test.ts`.
        const dispatch = vi.fn(() => ({
            disposition: Promise.resolve({ completion: Promise.resolve(), kind: 'adopted' }),
        }));
        const ipcClient = { uploadedVideoRegistrationPort: { dispatch } };
        const getOwner = vi.spyOn(modelContainer, 'get').mockImplementation((identifier: string) => {
            if (identifier === 'IRecordedApiModel') return recorded;
            if (identifier === 'IRecordedTagApiModel') return recordedTag;
            if (identifier === 'IIPCClient') return ipcClient;
            throw new Error(`Unexpected public recorded owner: ${identifier}`);
        });
        const service = createOpenApiService(uploadRoot);
        const server = service.app.listen(0, loopbackHost);
        servers.push(server);
        const origin = await listen(server);

        await expect(jsonRequest(origin, '/api/recorded?isHalfWidth=false')).resolves.toMatchObject({ status: 200 });
        await expect(jsonRequest(origin, '/api/recorded/12?isHalfWidth=false')).resolves.toMatchObject({ status: 200 });
        await expect(
            jsonRequest(origin, '/api/recorded', 'POST', {
                channelId: 101,
                endAt: 2_000,
                name: 'Task 7.4 created',
                startAt: 1_000,
            }),
        ).resolves.toMatchObject({ status: 201 });
        await expect(uploadRequest(origin)).resolves.toMatchObject({ status: 200 });
        await expect(jsonRequest(origin, '/api/tags/7/relate', 'PUT', { recordedId: 12 })).resolves.toMatchObject({
            status: 200,
        });
        await expect(jsonRequest(origin, '/api/recorded/12/protect', 'PUT')).resolves.toMatchObject({ status: 200 });
        await expect(jsonRequest(origin, '/api/recorded/12', 'DELETE')).resolves.toMatchObject({ status: 200 });
        await expect(jsonRequest(origin, '/api/recorded/cleanup', 'POST')).resolves.toMatchObject({ status: 200 });

        expect(recorded.gets).toHaveBeenCalledWith({ isHalfWidth: false, limit: 24, offset: 0 });
        expect(recorded.get).toHaveBeenCalledWith(12, false);
        expect(recorded.createNewRecorded).toHaveBeenCalledWith({
            channelId: 101,
            endAt: 2_000,
            name: 'Task 7.4 created',
            startAt: 1_000,
        });
        expect(dispatch).toHaveBeenCalledWith({
            fileName: 'task-7-4.ts',
            filePath: expect.stringMatching(new RegExp(`${uploadRoot}/incoming/upload-[^/]+/payload$`)),
            fileType: 'ts',
            parentDirectoryName: 'main',
            recordedId: 12,
            viewName: 'Task 7.4 upload',
        });
        expect(recordedTag.setRelation).toHaveBeenCalledWith(7, 12);
        expect(recorded.changeProtect).toHaveBeenCalledWith(12, true);
        expect(recorded.delete).toHaveBeenCalledWith(12);
        expect(recorded.fileCleanup).toHaveBeenCalledOnce();

        const missingFile = new FormData();
        missingFile.set('recordedId', '12');
        const validationFailure = await fetch(`${origin}/api/videos/upload`, { body: missingFile, method: 'POST' });
        expect(validationFailure.status).toBe(400);
        expect(dispatch).toHaveBeenCalledOnce();

        recorded.get.mockRejectedValueOnce(new Error('synthetic domain failure'));
        const domainFailure = await jsonRequest(origin, '/api/recorded/12?isHalfWidth=false');
        expect(domainFailure.status).toBe(500);
        await expect(domainFailure.json()).resolves.toEqual({
            code: 500,
            errors: 'synthetic domain failure',
            message: 'Internal Server Error',
        });

        // Success upload finalization is async after the 200 response; wait until incoming is empty
        // before measuring abort cleanup (avoids race against leftover upload-* tokens).
        await vi.waitFor(async () => {
            expect(await readdir(join(uploadRoot, 'incoming'))).toEqual([]);
        });
        let abortedRequest: any;
        const aborted = new Promise<void>(resolve => {
            server.once('request', request => {
                abortedRequest = request;
                request.once('aborted', resolve);
            });
        });
        let socket: Socket | undefined;
        try {
            socket = createConnection({ host: loopbackHost, port: Number(new URL(origin).port) });
            await once(socket, 'connect');
            socket.write(
                [
                    'POST /api/videos/upload HTTP/1.1',
                    `Host: ${new URL(origin).host}`,
                    'Content-Type: multipart/form-data; boundary=task-7-4-abort',
                    'Content-Length: 4096',
                    'Connection: close',
                    '',
                    '--task-7-4-abort',
                    'Content-Disposition: form-data; name="file"; filename="partial.ts"',
                    'Content-Type: application/octet-stream',
                    '',
                    'partial upload that must be aborted',
                ].join('\r\n'),
            );
            socket.destroy();
            await aborted;
            await vi.waitFor(async () => {
                expect(getUploadRequestFinalizer(abortedRequest)).toBeUndefined();
                expect(abortedRequest.listenerCount('aborted')).toBe(0);
                expect(await readdir(join(uploadRoot, 'incoming'))).toEqual([]);
            });
        } finally {
            socket?.destroy();
        }

        await expect(uploadRequest(origin)).resolves.toMatchObject({ status: 200 });
        expect(dispatch).toHaveBeenCalledTimes(2);
        expect(getOwner).toHaveBeenCalled();
    });
});
