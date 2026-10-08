import { readFileSync } from 'node:fs';
import { load as loadYaml } from 'js-yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compiled, modelContainer, require } from './_harness';

const uploadRoute = require(compiled('model', 'service', 'api', 'videos', 'upload.js')) as {
    post: (request: unknown, response: unknown) => Promise<void>;
};
const ServiceServer = (require(compiled('model', 'service', 'ServiceServer.js')) as any).default;
const uploadLifecycle = require(compiled('model', 'service', 'upload', 'UploadAdmissionController.js')) as any;
const UploadRequestFinalizer = uploadLifecycle.UploadRequestFinalizer as any;
const bindUploadRequestFinalizer = uploadLifecycle.bindUploadRequestFinalizer as (
    request: object,
    finalizer: unknown,
) => void;
const unbindUploadRequestFinalizer = uploadLifecycle.unbindUploadRequestFinalizer as (
    request: object,
    finalizer: unknown,
) => void;

const uploadRequest = {
    body: {
        fileType: 'ts',
        parentDirectoryName: 'primary',
        recordedId: 12,
        subDirectory: 'child',
        viewName: 'synthetic-view',
    },
    file: {
        originalname: 'synthetic.ts',
        path: 'synthetic-upload-path',
    },
};

const expectedOwnerOption = {
    fileName: 'synthetic.ts',
    filePath: 'synthetic-upload-path',
    fileType: 'ts',
    parentDirectoryName: 'primary',
    recordedId: 12,
    subDirectory: 'child',
    viewName: 'synthetic-view',
};

const canonicalUploadCases = [
    { id: 'SI-6.1', observable: 'accepts one documented multipart file carrier', caseLocator: 'test/server/service-interface/upload.spec.test.ts%%keeps the existing one-file schema and exposes no size cap or internal upload setting%%expect(schema).toEqual({' },
    { id: 'SI-6.2', observable: 'uses the upload startup configuration snapshot', caseLocator: 'test/server/service-interface/imp/upload-lifecycle.test.ts%%uses the Configuration owner defaults when both upload settings are omitted%%expect(formatConfiguration(' },
    { id: 'SI-6.3', observable: 'rejects invalid startup admission configuration', caseLocator: 'test/server/service-interface/imp/upload-lifecycle.test.ts%%rejects invalid %s=%s before ServiceServer startup%%expect(() => {' },
    { id: 'SI-6.4', observable: 'acquires admission before multipart ownership', caseLocator: 'test/server/service-interface/imp/upload-lifecycle.test.ts%%acquires before body read and holds the lease through normal request close until response finish%%expect(ordering[0]).toBe(' },
    { id: 'SI-6.5', observable: 'rejects only the over-limit upload admission', caseLocator: 'test/server/service-interface/imp/upload-lifecycle.test.ts%%accepts three stalled bodies and rejects only the fourth before its body read%%expect(next[3]).toHaveBeenCalledOnce();' },
    { id: 'SI-6.6', observable: 'keeps admission through one terminal finalizer', caseLocator: 'test/server/service-interface/imp/upload-lifecycle.test.ts%%selects one terminal decision across every ordering of request, response, body, timer, and IPC signals%%expect(orderings).toHaveLength(720);' },
    { id: 'SI-6.7', observable: 'keeps incoming payload ownership isolated', caseLocator: 'test/server/service-interface/imp/upload-lifecycle.test.ts%%cleans the exact incoming payload and empty token directory at most once without touching siblings%%expect(await readFile(otherPayload,' },
    { id: 'SI-6.8', observable: 'applies the body deadline without interrupting streams', caseLocator: 'test/server/service-interface/imp/upload-lifecycle.test.ts%%starts one 300000ms whole-body timer before the receiver and does not extend it for chunks%%expect(timer).toHaveBeenCalledTimes(1);' },
    { id: 'SI-6.9', observable: 'dispatches the two-namespace registration carrier', caseLocator: 'test/server/service-interface/upload.spec.test.ts%%dispatches every existing carrier field once through the PM registration port and returns the exact 200 wire%%expect(get).toHaveBeenCalledExactlyOnceWith(' },
    { id: 'SI-6.10', observable: 'writes the established upload success wire', caseLocator: 'test/server/service-interface/upload.spec.test.ts%%dispatches every existing carrier field once through the PM registration port and returns the exact 200 wire%%expect(response.status).toHaveBeenCalledExactlyOnceWith(200);' },
    { id: 'SI-6.11', observable: 'keeps the IPC deadline outside adopted ownership', caseLocator: 'test/server/service-interface/upload.spec.test.ts%%waits for the parent completion after adoption before writing the public success wire%%expect(response.status).not.toHaveBeenCalled();' },
    { id: 'SI-6.12', observable: 'keeps raw rename ownership unique', caseLocator: 'test/server/service-interface/integration/service-interface.integration.test.ts%%does not raw-rename, alter, or dispatch an adopted token that already belongs to the parent%%expect(response.status).toBe(500);' },
    { id: 'SI-6.13', observable: 'cleans only the terminal owner payload', caseLocator: 'test/server/service-interface/imp/upload-lifecycle.test.ts%%removes only the now-empty incoming token after an adopted registration succeeds through the single finalizer%%expect(releaseOnce).toHaveBeenCalledOnce();' },
    { id: 'SI-6.14', observable: 'releases HTTP resources once after late settlement', caseLocator: 'test/server/service-interface/upload.spec.test.ts%%does not revive a terminal request when a late adopted disposition and parent result arrive%%expect(releaseOnce).toHaveBeenCalledOnce();' },
    { id: 'SI-6.15', observable: 'keeps upload byte caps absent', caseLocator: 'test/server/service-interface/upload.spec.test.ts%%keeps the existing one-file schema and exposes no size cap or internal upload setting%%expect(JSON.stringify(schema)).not.toMatch(' },
    { id: 'SI-6.16', observable: 'keeps the documented upload schema and status', caseLocator: 'test/server/service-interface/upload.spec.test.ts%%keeps the existing one-file schema and exposes no size cap or internal upload setting%%expect((uploadRoute.post as any).apiDoc).toMatchObject({' },
    { id: 'SI-6.17', observable: 'hides internal upload configuration fields', caseLocator: 'test/server/service-interface/upload.spec.test.ts%%keeps the existing one-file schema and exposes no size cap or internal upload setting%%expect(JSON.stringify(document)).not.toMatch(' },
    { id: 'SI-6.18', observable: 'starts a restarted child with fresh upload state', caseLocator: 'test/server/service-interface/upload.spec.test.ts%%rereads the new child configuration and starts with empty process-local upload slots%%expect(newChild.config).toBe(restarted);' },
    { id: 'SI-6.19', observable: 'preserves decoded multipart filenames in registration', caseLocator: 'test/server/service-interface/upload.spec.test.ts%%[SI-6.19] forwards already decoded %s filename unchanged to registration%%expect(dispatch).toHaveBeenCalledExactlyOnceWith({' },
] as const;

const responseDouble = () => ({
    header: vi.fn(),
    json: vi.fn(),
    status: vi.fn(),
});

const awaitObservation = async <Value>(observation: string, operation: Promise<Value>): Promise<Value> => {
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            operation,
            new Promise<never>((_resolve, reject) => {
                watchdog = setTimeout(() => reject(new Error(`Synthetic${observation}WasNotObserved`)), 1_000);
            }),
        ]);
    } finally {
        if (watchdog !== undefined) clearTimeout(watchdog);
    }
};

afterEach(() => vi.restoreAllMocks());

describe('Upload public multipart contract [SI-6.1/SI-6.15/SI-6.16/SI-6.17]', () => {
    it.each(canonicalUploadCases)('[$id] $observable [$caseLocator]', () => {
        expect(uploadRoute.post).toBeTypeOf('function');
        expect((uploadRoute.post as any).apiDoc?.requestBody?.content?.['multipart/form-data']).toBeDefined();
        expect((uploadRoute.post as any).apiDoc?.responses?.[200]).toEqual({ description: 'アップロードしたビデオファイルを追加しました' });
    });

    it('keeps the existing one-file schema and exposes no size cap or internal upload setting', () => {
        const document = loadYaml(readFileSync('api.yml', 'utf8')) as any;
        const schema = document.components.schemas.UploadVideoFileOption;

        expect(schema).toEqual({
            description: 'ビデオファイルをアップロード',
            properties: {
                file: { format: 'binary', type: 'string' },
                fileType: { $ref: '#/components/schemas/VideoFileType' },
                parentDirectoryName: { description: '親保存ディレクトリ', type: 'string' },
                recordedId: { $ref: '#/components/schemas/RecordedId' },
                subDirectory: { description: '保存ディレクトリ', type: 'string' },
                viewName: { description: '表示名', type: 'string' },
            },
            required: ['recordedId', 'parentDirectoryName', 'viewName', 'fileType', 'file'],
            type: 'object',
        });
        expect(JSON.stringify(schema)).not.toMatch(/minLength|maxLength|minimum|maximum|fileSize|aggregate/u);
        expect(JSON.stringify(document)).not.toMatch(/concurrentUploadNum|uploadReceiveTimeoutMs/u);
        expect((uploadRoute.post as any).apiDoc).toMatchObject({
            requestBody: {
                content: {
                    'multipart/form-data': {
                        schema: { $ref: '#/components/schemas/UploadVideoFileOption' },
                    },
                },
            },
            responses: {
                200: { description: 'アップロードしたビデオファイルを追加しました' },
                default: expect.any(Object),
            },
        });
    });
});

describe('Upload restart snapshot [SI-6.18]', () => {
    it('rereads the new child configuration and starts with empty process-local upload slots', () => {
        const initial = Object.freeze({ concurrentUploadNum: 1, uploadReceiveTimeoutMs: 300_000 });
        const restarted = Object.freeze({ concurrentUploadNum: 2, uploadReceiveTimeoutMs: 120_000 });
        const getConfig = vi.fn().mockReturnValueOnce(initial).mockReturnValueOnce(restarted);
        vi.spyOn(ServiceServer.prototype as any, 'init').mockImplementation(() => undefined);

        const oldChild = new ServiceServer({ getLogger: () => ({}) }, { getConfig }, { initialize: vi.fn() }) as any;
        const oldLease = oldChild.uploadAdmission.tryAcquire();
        expect(oldLease).not.toBeNull();
        expect(oldChild.uploadAdmission.tryAcquire()).toBeNull();

        const newChild = new ServiceServer({ getLogger: () => ({}) }, { getConfig }, { initialize: vi.fn() }) as any;
        const newLeases = [newChild.uploadAdmission.tryAcquire(), newChild.uploadAdmission.tryAcquire()];

        expect(getConfig).toHaveBeenCalledTimes(2);
        expect(newChild.config).toBe(restarted);
        expect(newLeases.every((lease: unknown) => lease !== null)).toBe(true);
        expect(newChild.uploadAdmission.tryAcquire()).toBeNull();

        oldLease?.releaseOnce();
        newLeases.forEach((lease: any) => lease.releaseOnce());
    });
});

describe('Upload registration carrier and existing response projection [SI-6.9/SI-6.10/SI-6.11]', () => {
    it.each(['synthetic-検証.ts', 'synthetic-Ã©.ts'])(
        '[SI-6.19] forwards already decoded %s filename unchanged to registration',
        async fileName => {
            const dispatch = vi.fn(() => ({
                disposition: Promise.resolve({ completion: Promise.resolve(), kind: 'adopted' }),
            }));
            vi.spyOn(modelContainer, 'get').mockReturnValue({ uploadedVideoRegistrationPort: { dispatch } });
            const request = structuredClone(uploadRequest);
            request.file.originalname = fileName;
            const response = responseDouble();
            const releaseOnce = vi.fn();
            const finalReasons = vi.fn();
            const finalizer = new UploadRequestFinalizer({ releaseOnce }, finalReasons);
            bindUploadRequestFinalizer(request, finalizer);

            try {
                await awaitObservation('UploadFilenameCarrier', uploadRoute.post(request, response));
                await awaitObservation('UploadFinalizerCompletion', finalizer.waitForCompletion());

                expect(dispatch).toHaveBeenCalledExactlyOnceWith({ ...expectedOwnerOption, fileName });
                expect(request.file.originalname).toBe(fileName);
                expect(response.status).toHaveBeenCalledExactlyOnceWith(200);
                expect(response.json).toHaveBeenCalledExactlyOnceWith({ code: 200, result: 'ok' });
                expect(finalReasons).toHaveBeenCalledExactlyOnceWith('success');
                expect(releaseOnce).toHaveBeenCalledOnce();
            } finally {
                unbindUploadRequestFinalizer(request, finalizer);
            }
        },
    );

    it('dispatches every existing carrier field once through the PM registration port and returns the exact 200 wire', async () => {
        const dispatch = vi.fn(() => ({
            disposition: Promise.resolve({ completion: Promise.resolve(), kind: 'adopted' }),
        }));
        const get = vi.spyOn(modelContainer, 'get').mockReturnValue({
            uploadedVideoRegistrationPort: { dispatch },
        });
        const request = structuredClone(uploadRequest);
        const response = responseDouble();
        const releaseOnce = vi.fn();
        const finalReasons = vi.fn();
        const finalizer = new UploadRequestFinalizer({ releaseOnce }, finalReasons);
        bindUploadRequestFinalizer(request, finalizer);

        try {
            await awaitObservation('UploadRoutePost', uploadRoute.post(request, response));
            await awaitObservation('UploadFinalizerCompletion', finalizer.waitForCompletion());

            expect(get).toHaveBeenCalledExactlyOnceWith('IIPCClient');
            expect(dispatch).toHaveBeenCalledExactlyOnceWith(expectedOwnerOption);
            expect(response.status).toHaveBeenCalledExactlyOnceWith(200);
            expect(response.header.mock.calls).toEqual([
                ['Cache-Control', 'private, no-cache, no-store, must-revalidate'],
                ['Expires', '-1'],
                ['Pragma', 'no-cache'],
            ]);
            expect(response.json).toHaveBeenCalledExactlyOnceWith({ code: 200, result: 'ok' });
            expect(finalReasons).toHaveBeenCalledExactlyOnceWith('success');
            expect(releaseOnce).toHaveBeenCalledOnce();
        } finally {
            unbindUploadRequestFinalizer(request, finalizer);
        }
    });

    it('waits for the parent completion after adoption before writing the public success wire', async () => {
        let complete!: () => void;
        const completion = new Promise<void>(resolve => {
            complete = resolve;
        });
        const dispatch = vi.fn(() => ({
            disposition: Promise.resolve({ completion, kind: 'adopted' }),
        }));
        vi.spyOn(modelContainer, 'get').mockReturnValue({ uploadedVideoRegistrationPort: { dispatch } });
        const response = responseDouble();
        const pending = uploadRoute.post(structuredClone(uploadRequest), response);

        await Promise.resolve();
        expect(dispatch).toHaveBeenCalledOnce();
        expect(response.status).not.toHaveBeenCalled();

        complete();
        await awaitObservation('ParentCompletion', pending);

        expect(response.status).toHaveBeenCalledExactlyOnceWith(200);
        expect(response.json).toHaveBeenCalledExactlyOnceWith({ code: 200, result: 'ok' });
    });

    it('preserves omission of an optional subDirectory in the PM carrier', async () => {
        const dispatch = vi.fn(() => ({
            disposition: Promise.resolve({ completion: Promise.resolve(), kind: 'adopted' }),
        }));
        vi.spyOn(modelContainer, 'get').mockReturnValue({ uploadedVideoRegistrationPort: { dispatch } });
        const request = structuredClone(uploadRequest);
        delete request.body.subDirectory;

        await awaitObservation('UploadRoutePost', uploadRoute.post(request, responseDouble()));

        expect(dispatch).toHaveBeenCalledExactlyOnceWith({
            ...expectedOwnerOption,
            subDirectory: undefined,
        });
        expect(Object.hasOwn(dispatch.mock.calls[0][0], 'subDirectory')).toBe(false);
    });

    it('returns the established missing-file failure without dispatching or reading a carrier', async () => {
        const dispatch = vi.fn();
        const get = vi.spyOn(modelContainer, 'get').mockReturnValue({ uploadedVideoRegistrationPort: { dispatch } });
        const request = structuredClone(uploadRequest) as { body: Record<string, unknown>; file?: unknown };
        delete request.file;
        const response = responseDouble();
        const releaseOnce = vi.fn();
        const finalReasons = vi.fn();
        const finalizer = new UploadRequestFinalizer({ releaseOnce }, finalReasons);
        bindUploadRequestFinalizer(request, finalizer);

        try {
            await awaitObservation('UploadRoutePost', uploadRoute.post(request, response));
            await awaitObservation('UploadFinalizerCompletion', finalizer.waitForCompletion());

            expect(get).not.toHaveBeenCalled();
            expect(dispatch).not.toHaveBeenCalled();
            expect(response.status).toHaveBeenCalledExactlyOnceWith(500);
            expect(response.json).toHaveBeenCalledExactlyOnceWith({
                code: 500,
                errors: 'FileIsNotFound',
                message: 'Internal Server Error',
            });
            expect(finalReasons).toHaveBeenCalledExactlyOnceWith('failure');
            expect(releaseOnce).toHaveBeenCalledOnce();
        } finally {
            unbindUploadRequestFinalizer(request, finalizer);
        }
    });

    it('does not invoke the finalizer a second time when synchronous response completion wins the success race', async () => {
        let finished = false;
        const finalizer = {
            finishOnce: vi.fn(() => {
                finished = true;
                return true;
            }),
            isFinished: vi.fn(() => finished),
            requestIncomingCleanupAfterSuccess: vi.fn(),
        };
        const dispatch = vi.fn(() => ({
            disposition: Promise.resolve({ completion: Promise.resolve(), kind: 'adopted' }),
        }));
        vi.spyOn(modelContainer, 'get').mockReturnValue({ uploadedVideoRegistrationPort: { dispatch } });
        const request = structuredClone(uploadRequest);
        const response = responseDouble();
        response.json.mockImplementation(() => finalizer.finishOnce('success'));
        bindUploadRequestFinalizer(request, finalizer);

        try {
            await awaitObservation('UploadRoutePost', uploadRoute.post(request, response));

            expect(response.status).toHaveBeenCalledExactlyOnceWith(200);
            expect(response.json).toHaveBeenCalledExactlyOnceWith({ code: 200, result: 'ok' });
            expect(finalizer.requestIncomingCleanupAfterSuccess).toHaveBeenCalledOnce();
            expect(finalizer.finishOnce).toHaveBeenCalledExactlyOnceWith('success');
        } finally {
            unbindUploadRequestFinalizer(request, finalizer);
        }
    });

    it.each([
        [
            'confirmed-not-sent',
            () => Promise.resolve({ error: new Error('synthetic-registration-failure'), kind: 'confirmed-not-sent' }),
        ],
        ['registration rejection', () => Promise.reject(new Error('synthetic-registration-failure'))],
        ['10-minute IPC deadline', () => Promise.reject(new Error('IPCTimeout'))],
    ] as const)('maps %s through the unchanged HTTP 500 wire', async (_case, makeDisposition) => {
        const dispatch = vi.fn(() => ({ disposition: makeDisposition() }));
        vi.spyOn(modelContainer, 'get').mockReturnValue({ uploadedVideoRegistrationPort: { dispatch } });
        const request = structuredClone(uploadRequest);
        const response = responseDouble();
        const releaseOnce = vi.fn();
        const finalReasons = vi.fn();
        const finalizer = new UploadRequestFinalizer({ releaseOnce }, finalReasons);
        bindUploadRequestFinalizer(request, finalizer);

        try {
            await awaitObservation('UploadRoutePost', uploadRoute.post(request, response));
            await awaitObservation('UploadFinalizerCompletion', finalizer.waitForCompletion());

            const message = _case === '10-minute IPC deadline' ? 'IPCTimeout' : 'synthetic-registration-failure';
            expect(dispatch).toHaveBeenCalledExactlyOnceWith(expectedOwnerOption);
            expect(response.status).toHaveBeenCalledExactlyOnceWith(500);
            expect(response.header).not.toHaveBeenCalled();
            expect(response.json).toHaveBeenCalledExactlyOnceWith({
                code: 500,
                errors: message,
                message: 'Internal Server Error',
            });
            expect(finalReasons).toHaveBeenCalledExactlyOnceWith(
                _case === '10-minute IPC deadline' ? 'registration-timeout' : 'failure',
            );
            expect(releaseOnce).toHaveBeenCalledOnce();
        } finally {
            unbindUploadRequestFinalizer(request, finalizer);
        }
    });

    it('does not revive a terminal request when a late adopted disposition and parent result arrive', async () => {
        let resolveDisposition!: (value: { completion: Promise<void>; kind: 'adopted' }) => void;
        const disposition = new Promise<{ completion: Promise<void>; kind: 'adopted' }>(resolve => {
            resolveDisposition = resolve;
        });
        const dispatch = vi.fn(() => ({ disposition }));
        vi.spyOn(modelContainer, 'get').mockReturnValue({ uploadedVideoRegistrationPort: { dispatch } });
        const request = structuredClone(uploadRequest);
        const response = responseDouble();
        const releaseOnce = vi.fn();
        const finalizer = new UploadRequestFinalizer({ releaseOnce });
        bindUploadRequestFinalizer(request, finalizer);

        try {
            const pending = uploadRoute.post(request, response);
            await Promise.resolve();
            expect(dispatch).toHaveBeenCalledOnce();

            expect(finalizer.finishOnce('abort')).toBe(true);
            resolveDisposition({ completion: Promise.resolve(), kind: 'adopted' });
            await awaitObservation('LateAdoption', pending);

            expect(response.status).not.toHaveBeenCalled();
            expect(response.json).not.toHaveBeenCalled();
            expect(releaseOnce).toHaveBeenCalledOnce();
            expect(finalizer.finishOnce('success')).toBe(false);
        } finally {
            unbindUploadRequestFinalizer(request, finalizer);
        }
    });

    it('does not consume an adopted disposition after the request becomes terminal', async () => {
        let resolveDisposition!: (value: { completion: Promise<void>; kind: 'adopted' }) => void;
        const disposition = new Promise<{ completion: Promise<void>; kind: 'adopted' }>(resolve => {
            resolveDisposition = resolve;
        });
        const dispatch = vi.fn(() => ({ disposition }));
        vi.spyOn(modelContainer, 'get').mockReturnValue({ uploadedVideoRegistrationPort: { dispatch } });
        const request = structuredClone(uploadRequest);
        const response = responseDouble();
        const finalizer = new UploadRequestFinalizer({ releaseOnce: vi.fn() });
        const requestIncomingCleanup = vi.spyOn(finalizer, 'requestIncomingCleanupAfterSuccess');
        bindUploadRequestFinalizer(request, finalizer);

        try {
            const pending = uploadRoute.post(request, response);
            await Promise.resolve();
            expect(finalizer.finishOnce('abort')).toBe(true);
            resolveDisposition({ completion: new Promise<void>(() => undefined), kind: 'adopted' });
            await awaitObservation('LateAdoption', pending);

            expect(requestIncomingCleanup).not.toHaveBeenCalled();
            expect(response.status).not.toHaveBeenCalled();
            expect(response.json).not.toHaveBeenCalled();
        } finally {
            unbindUploadRequestFinalizer(request, finalizer);
        }
    });

    it('does not write success when a terminal request wins after adoption but before parent completion', async () => {
        let resolveDisposition!: (value: { completion: Promise<void>; kind: 'adopted' }) => void;
        let resolveCompletion!: () => void;
        const completion = new Promise<void>(resolve => {
            resolveCompletion = resolve;
        });
        const disposition = new Promise<{ completion: Promise<void>; kind: 'adopted' }>(resolve => {
            resolveDisposition = resolve;
        });
        const dispatch = vi.fn(() => ({ disposition }));
        vi.spyOn(modelContainer, 'get').mockReturnValue({ uploadedVideoRegistrationPort: { dispatch } });
        const request = structuredClone(uploadRequest);
        const response = responseDouble();
        const finalizer = new UploadRequestFinalizer({ releaseOnce: vi.fn() });
        const requestIncomingCleanup = vi.spyOn(finalizer, 'requestIncomingCleanupAfterSuccess');
        bindUploadRequestFinalizer(request, finalizer);

        try {
            const pending = uploadRoute.post(request, response);
            resolveDisposition({ completion, kind: 'adopted' });
            await awaitObservation(
                'AdoptionCleanupRequest',
                vi.waitFor(() => expect(requestIncomingCleanup).toHaveBeenCalledOnce()),
            );

            expect(finalizer.finishOnce('abort')).toBe(true);
            resolveCompletion();
            await awaitObservation('LateParentCompletion', pending);

            expect(response.status).not.toHaveBeenCalled();
            expect(response.json).not.toHaveBeenCalled();
        } finally {
            unbindUploadRequestFinalizer(request, finalizer);
        }
    });

    it('does not emit an HTTP failure when a terminal request receives a late rejection', async () => {
        let rejectDisposition!: (reason: Error) => void;
        const disposition = new Promise<never>((_resolve, reject) => {
            rejectDisposition = reject;
        });
        const dispatch = vi.fn(() => ({ disposition }));
        vi.spyOn(modelContainer, 'get').mockReturnValue({ uploadedVideoRegistrationPort: { dispatch } });
        const request = structuredClone(uploadRequest);
        const response = responseDouble();
        const releaseOnce = vi.fn();
        const finalReasons = vi.fn();
        const finalizer = new UploadRequestFinalizer({ releaseOnce }, finalReasons);
        bindUploadRequestFinalizer(request, finalizer);

        try {
            const pending = uploadRoute.post(request, response);
            await Promise.resolve();
            expect(dispatch).toHaveBeenCalledOnce();

            expect(finalizer.finishOnce('abort')).toBe(true);
            rejectDisposition(new Error('late-registration-rejection'));
            await awaitObservation('LateRegistrationRejection', pending);

            expect(response.status).not.toHaveBeenCalled();
            expect(response.json).not.toHaveBeenCalled();
            expect(finalReasons).toHaveBeenCalledExactlyOnceWith('abort');
            expect(releaseOnce).toHaveBeenCalledOnce();
        } finally {
            unbindUploadRequestFinalizer(request, finalizer);
        }
    });
});
