import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compiled, require } from '../_harness';

/*
 * ServiceServer.js の `import * as fs from 'fs'` / `import { mkdirp } from 'mkdirp'` /
 * `import multer from 'multer'` は静的に解決される。require() で読み込んだ 'node:fs' / 'mkdirp' /
 * 'multer' の CommonJS module.exports を後から書き換えても ESM 側の import 束縛には届かない
 * (in-process の従来の `vi.spyOn(require('node:fs'), ...)` 差し替えが効かなくなった)。
 *
 * `vi.doMock(specifier, factory)` で ServiceServer.js が import する 'fs' / 'node:fs' / 'mkdirp' /
 * 'multer' 自体を、実体へ委譲しつつ名前ごとに上書き可能な Proxy / 委譲関数へ差し替えたうえで、動的
 * `import()` で 1 度だけ読み直す（既存の合格例: public-contract.spec.test.ts の version.js 差し替え）。
 *
 * 個別 test ごとに `vi.resetModules()` して都度 import し直す方式は採らない。ServiceServer.js が内部で
 * 静的 import する UploadAdmissionController.js まで毎回新しいモジュール実体になってしまい、
 * finishUploadRequest / getUploadRequestFinalizer が使う WeakMap や各 prototype が、直前に captured
 * された ServiceServer とは別物になって request に紐付いた finalizer を取得できなくなるため
 * (getUploadRequestFinalizer が undefined を返す)。代わりに fs / mkdirp / multer の実装を「実体へ委譲する
 * Proxy 経由の名前ごとの差し替え」にし、ServiceServer.js と UploadAdmissionController.js は最初の動的
 * import で 1 度だけ確定させ、以降は同じモジュール実体を全 test で共有する。
 */
const actualFileSystem = require('node:fs') as Record<string, any>;
const actualMkdirp = require('mkdirp') as { sync(path: string): unknown };
const actualMulter = require('multer') as any;

const fsOverrides = new Map<string, (...args: any[]) => any>();
const mkdirpOverrides = new Map<string, (...args: any[]) => any>();
let currentMulter: ((...args: any[]) => any) | undefined;
let currentMulterErrorClass: any = actualMulter.MulterError;

const fsProxy = new Proxy(actualFileSystem, {
    get(target, prop, receiver) {
        if (typeof prop === 'string' && fsOverrides.has(prop)) return fsOverrides.get(prop);
        return Reflect.get(target, prop, receiver);
    },
});
const mkdirpProxy = new Proxy(actualMkdirp, {
    get(target, prop, receiver) {
        if (typeof prop === 'string' && mkdirpOverrides.has(prop)) return mkdirpOverrides.get(prop);
        return Reflect.get(target, prop, receiver);
    },
});
const multerEntryPoint: any = (...args: any[]) => {
    if (currentMulter === undefined) throw new Error('test must configure multer via useCapturedMulter first');
    return currentMulter(...args);
};
Object.defineProperty(multerEntryPoint, 'MulterError', {
    get: () => currentMulterErrorClass,
});

vi.doMock('fs', () => fsProxy);
vi.doMock('node:fs', () => fsProxy);
vi.doMock('mkdirp', () => ({ mkdirp: mkdirpProxy }));
vi.doMock('multer', () => ({ default: multerEntryPoint }));

const spyOnFs = (name: string): ReturnType<typeof vi.fn> => {
    const spy = vi.fn((...args: any[]) => (actualFileSystem as any)[name](...args));
    fsOverrides.set(name, spy);
    return spy;
};
const spyOnMkdirp = (name: string): ReturnType<typeof vi.fn> => {
    const spy = vi.fn((...args: any[]) => (actualMkdirp as any)[name](...args));
    mkdirpOverrides.set(name, spy);
    return spy;
};

const { default: ServiceServer } = (await import(compiled('model', 'service', 'ServiceServer.js'))) as any;
const uploadLifecycle = (await import(
    compiled('model', 'service', 'upload', 'UploadAdmissionController.js')
)) as any;
const finishUploadRequest = uploadLifecycle.finishUploadRequest as (request: object, reason: string) => boolean;
const getUploadRequestFinalizer = uploadLifecycle.getUploadRequestFinalizer as (request: object) => any;
const IncomingUploadFile = uploadLifecycle.IncomingUploadFile as any;
const UploadBodyReceiverTeardown = uploadLifecycle.UploadBodyReceiverTeardown as any;
const UploadRequestFinalizer = uploadLifecycle.UploadRequestFinalizer as any;
const UploadAdmissionController = uploadLifecycle.default as any;

interface CapturedMulter {
    readonly finishUploadRequest: (request: object, reason: string) => boolean;
    readonly getUploadRequestFinalizer: (request: object) => any;
    readonly IncomingUploadFile: any;
    readonly multerErrorCalls: Array<{ readonly code: unknown; readonly field: unknown }>;
    readonly multerFactory: ReturnType<typeof vi.fn>;
    readonly receiveBody: ReturnType<typeof vi.fn>;
    readonly ServiceServer: any;
    readonly single: ReturnType<typeof vi.fn>;
    readonly UploadBodyReceiverTeardown: any;
    readonly UploadRequestFinalizer: any;
}

const useCapturedMulter = async (run: (captured: CapturedMulter) => Promise<void>): Promise<void> => {
    const multerErrorCalls: Array<{ readonly code: unknown; readonly field: unknown }> = [];
    const receiveBody = vi.fn();
    const single = vi.fn(() => receiveBody);
    class CapturedMulterError extends Error {
        constructor(code: unknown, field: unknown) {
            super(`${String(code)}:${String(field)}`);
            multerErrorCalls.push({ code, field });
        }
    }
    const multerFactory = Object.assign(
        vi.fn(() => ({ single })),
        { MulterError: CapturedMulterError },
    );

    currentMulter = multerFactory;
    currentMulterErrorClass = CapturedMulterError;
    try {
        await run({
            finishUploadRequest,
            getUploadRequestFinalizer,
            IncomingUploadFile,
            multerErrorCalls,
            multerFactory,
            receiveBody,
            ServiceServer,
            single,
            UploadBodyReceiverTeardown,
            UploadRequestFinalizer,
        });
    } finally {
        currentMulter = undefined;
        currentMulterErrorClass = actualMulter.MulterError;
    }
};

const makeService = (Constructor: any, uploadTempDir: string, initializeNamespaces = false): any => {
    const service = Object.create(Constructor.prototype) as any;
    service.config = { uploadReceiveTimeoutMs: 300_000, uploadTempDir };
    service.log = {
        access: { error: vi.fn(), info: vi.fn() },
        system: { error: vi.fn(), info: vi.fn() },
    };
    service.uploadAdmission = new UploadAdmissionController(3);
    if (initializeNamespaces) service.createUploadDir();
    return service;
};

const makeRequest = (): PassThrough & Record<string, any> => {
    const request = new PassThrough() as PassThrough & Record<string, any>;
    request.body = {};
    request.headers = {};
    request.method = 'POST';
    return request;
};

const makeResponse = (): EventEmitter & Record<string, any> => {
    const response = new EventEmitter() as EventEmitter & Record<string, any>;
    response.destroyed = false;
    response.headersSent = false;
    response.statusCode = 200;
    response.writableEnded = false;
    return response;
};

const makeRelease = () => {
    let resolveRelease!: () => void;
    const released = new Promise<void>(resolve => {
        resolveRelease = resolve;
    });
    const releaseOnce = vi.fn(resolveRelease);
    return { releaseOnce, released };
};

const flushMicrotasks = async (turns = 10): Promise<void> => {
    for (let turn = 0; turn < turns; turn++) await Promise.resolve();
};

const capturedReceiverCallback = (receiveBody: ReturnType<typeof vi.fn>): ((error?: unknown) => void) => {
    expect(receiveBody).toHaveBeenCalledOnce();
    return receiveBody.mock.calls[0][2] as (error?: unknown) => void;
};

const expectDetached = (request: EventEmitter, response: EventEmitter): void => {
    expect(request.listenerCount('aborted')).toBe(0);
    expect(response.listenerCount('finish')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
};

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    fsOverrides.clear();
    mkdirpOverrides.clear();
});

describe('ServiceServer upload namespace and admission mutation oracles', () => {
    it.each(['root', 'incoming', 'adopted'] as const)(
        '[A102 L216] reports the exact non-directory namespace for %s',
        async namespace => {
            const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-server-nondirectory-'));
            const uploadRoot = join(temporaryRoot, 'uploads');
            const blockedPath = namespace === 'root' ? uploadRoot : join(uploadRoot, namespace);
            if (namespace !== 'root') await mkdir(uploadRoot);
            await writeFile(blockedPath, 'not-a-directory');

            try {
                expect(() => makeService(ServiceServer, uploadRoot).createUploadDir()).toThrow(
                    `upload path is not a directory: ${blockedPath}`,
                );
            } finally {
                await rm(temporaryRoot, { force: true, recursive: true });
            }
        },
    );

    it.each(['root', 'incoming', 'adopted'] as const)(
        '[A105/A108 L220] rethrows the exact non-ENOENT stat failure for %s without mkdir',
        async namespace => {
            const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-server-stat-'));
            const uploadRoot = join(temporaryRoot, 'uploads');
            const target = namespace === 'root' ? uploadRoot : join(uploadRoot, namespace);
            await Promise.all([
                mkdir(join(uploadRoot, 'incoming'), { recursive: true }),
                mkdir(join(uploadRoot, 'adopted'), { recursive: true }),
            ]);
            const failure = Object.assign(new Error(`synthetic stat failure: ${namespace}`), { code: 'EACCES' });
            const statSync = actualFileSystem.statSync.bind(actualFileSystem);
            spyOnFs('statSync').mockImplementation((candidate: unknown) => {
                if (String(candidate) === target) throw failure;
                return statSync(candidate);
            });
            const mkdirp = spyOnMkdirp('sync');

            try {
                expect(() => makeService(ServiceServer, uploadRoot).createUploadDir()).toThrow(failure);
                expect(mkdirp).not.toHaveBeenCalled();
            } finally {
                await rm(temporaryRoot, { force: true, recursive: true });
            }
        },
    );

    it('[A114 L230] reports the exact cross-device namespace rejection', async () => {
        const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-server-device-'));
        const uploadRoot = join(temporaryRoot, 'uploads');
        const adoptedPath = join(uploadRoot, 'adopted');
        await Promise.all([
            mkdir(join(uploadRoot, 'incoming'), { recursive: true }),
            mkdir(adoptedPath, { recursive: true }),
        ]);
        const statSync = actualFileSystem.statSync.bind(actualFileSystem);
        spyOnFs('statSync').mockImplementation((candidate: unknown) => {
            const result = statSync(candidate);
            return String(candidate) === adoptedPath
                ? { dev: result.dev + 1, isDirectory: () => result.isDirectory() }
                : result;
        });

        try {
            expect(() => makeService(ServiceServer, uploadRoot).createUploadDir()).toThrow(
                'upload namespaces must use the same filesystem',
            );
        } finally {
            await rm(temporaryRoot, { force: true, recursive: true });
        }
    });

    it('[A121 L243] rejects full admission with the exact Multer field before receiver, token, or timer work', async () => {
        vi.useFakeTimers();
        await useCapturedMulter(async captured => {
            const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-server-full-'));
            const service = makeService(captured.ServiceServer, temporaryRoot, true);
            service.uploadAdmission = { tryAcquire: vi.fn(() => null) };
            const request = makeRequest();
            const response = makeResponse();
            const next = vi.fn();
            const mkdtempSync = spyOnFs('mkdtempSync');

            try {
                service.uploadFile(request, response, next);

                expect(captured.multerErrorCalls).toEqual([{ code: 'LIMIT_UNEXPECTED_FILE', field: 'file' }]);
                expect(next).toHaveBeenCalledExactlyOnceWith('LIMIT_UNEXPECTED_FILE:file');
                expect(captured.multerFactory).not.toHaveBeenCalled();
                expect(mkdtempSync).not.toHaveBeenCalled();
                expect(request.listenerCount('aborted')).toBe(0);
                expect(vi.getTimerCount()).toBe(0);
                expect(await readdir(join(temporaryRoot, 'incoming'))).toEqual([]);
            } finally {
                request.destroy();
                await rm(temporaryRoot, { force: true, recursive: true });
            }
        });
    });

    it('[A192/A195/A196 L310-311] pre-abort releases exactly once without receiver, token, timer, or report work', async () => {
        vi.useFakeTimers();
        await useCapturedMulter(async captured => {
            const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-server-preabort-'));
            const service = makeService(captured.ServiceServer, temporaryRoot, true);
            const release = makeRelease();
            service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce: release.releaseOnce })) };
            const request = makeRequest();
            request.aborted = true;
            const response = makeResponse();
            const next = vi.fn();
            const mkdtempSync = spyOnFs('mkdtempSync');

            try {
                service.uploadFile(request, response, next);
                await flushMicrotasks();

                expect(request.destroyed).toBe(true);
                expect(release.releaseOnce).toHaveBeenCalledOnce();
                expect(next).not.toHaveBeenCalled();
                expect(captured.multerFactory).not.toHaveBeenCalled();
                expect(mkdtempSync).not.toHaveBeenCalled();
                expect(service.log.access.error).not.toHaveBeenCalled();
                expect(captured.getUploadRequestFinalizer(request)).toBeUndefined();
                expectDetached(request, response);
                expect(await readdir(join(temporaryRoot, 'incoming'))).toEqual([]);
            } finally {
                request.destroy();
                await rm(temporaryRoot, { force: true, recursive: true });
            }
        });
    });

    it.each([
        { expected: 'synthetic create failure', thrown: new Error('synthetic create failure') },
        { expected: '73', thrown: 73 },
    ])('[A201/A202 L323-325] turns create throw $expected into one exact terminal release', async scenario => {
        vi.useFakeTimers();
        await useCapturedMulter(async captured => {
            const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-server-create-failure-'));
            const service = makeService(captured.ServiceServer, temporaryRoot, true);
            const release = makeRelease();
            service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce: release.releaseOnce })) };
            const request = makeRequest();
            request.aborted = false;
            const response = makeResponse();
            const next = vi.fn();
            const finish = vi.spyOn(captured.UploadRequestFinalizer.prototype, 'finishOnce');
            spyOnFs('mkdtempSync').mockImplementation((() => {
                throw scenario.thrown;
            }) as any);

            try {
                service.uploadFile(request, response, next);
                await release.released;

                expect(next).toHaveBeenCalledExactlyOnceWith(scenario.expected);
                expect(finish).toHaveBeenCalledExactlyOnceWith('failure');
                expect(release.releaseOnce).toHaveBeenCalledOnce();
                expect(captured.multerFactory).not.toHaveBeenCalled();
                expect(service.log.access.error).not.toHaveBeenCalled();
                expect(captured.getUploadRequestFinalizer(request)).toBeUndefined();
                expectDetached(request, response);
                expect(await readdir(join(temporaryRoot, 'incoming'))).toEqual([]);
            } finally {
                request.destroy();
                await rm(temporaryRoot, { force: true, recursive: true });
            }
        });
    });
});

describe('ServiceServer upload terminal and reporting mutation oracles', () => {
    it.each([
        { cleanup: false, reason: 'success', status: 399 },
        { cleanup: true, reason: 'failure', status: 400 },
    ] as const)(
        '[A125/A149/A155/A156/A158/A163/A165 L253/L265/L273/L279/L281] maps status $status to $reason with exact cleanup',
        async scenario => {
            vi.useFakeTimers();
            await useCapturedMulter(async captured => {
                const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-server-status-'));
                const service = makeService(captured.ServiceServer, temporaryRoot, true);
                const release = makeRelease();
                service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce: release.releaseOnce })) };
                const request = makeRequest();
                request.aborted = false;
                const response = makeResponse();
                response.statusCode = scenario.status;
                const next = vi.fn();
                const cleanup = vi.spyOn(captured.IncomingUploadFile.prototype, 'cleanupOnce');
                const finish = vi.spyOn(captured.UploadRequestFinalizer.prototype, 'finishOnce');

                try {
                    service.uploadFile(request, response, next);
                    const finalizer = captured.getUploadRequestFinalizer(request);
                    const tokens = await readdir(join(temporaryRoot, 'incoming'));
                    expect(tokens).toHaveLength(1);
                    const tokenDirectory = join(temporaryRoot, 'incoming', tokens[0]);

                    response.emit('finish');
                    await finalizer.waitForCompletion();

                    expect(finish.mock.calls[0][0]).toBe(scenario.reason);
                    expect(cleanup).toHaveBeenCalledTimes(scenario.cleanup ? 1 : 0);
                    expect(existsSync(tokenDirectory)).toBe(!scenario.cleanup);
                    expect(release.releaseOnce).toHaveBeenCalledOnce();
                    expect(next).not.toHaveBeenCalled();
                    expect(captured.getUploadRequestFinalizer(request)).toBeUndefined();
                    expectDetached(request, response);
                } finally {
                    request.destroy();
                    await rm(temporaryRoot, { force: true, recursive: true });
                }
            });
        },
    );

    it.each([
        { destroyed: false, expectedNext: 1, headersSent: false, writableEnded: false },
        { destroyed: true, expectedNext: 0, headersSent: false, writableEnded: false },
        { destroyed: false, expectedNext: 0, headersSent: true, writableEnded: false },
        { destroyed: false, expectedNext: 0, headersSent: false, writableEnded: true },
    ])(
        '[A132/A134/A135/A136/A137/A140/A143 L263] forwards failure only for writable response $destroyed/$headersSent/$writableEnded',
        async scenario => {
            vi.useFakeTimers();
            await useCapturedMulter(async captured => {
                const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-server-writable-'));
                const service = makeService(captured.ServiceServer, temporaryRoot, true);
                const release = makeRelease();
                service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce: release.releaseOnce })) };
                const request = makeRequest();
                request.aborted = false;
                const response = makeResponse();
                response.destroyed = scenario.destroyed;
                response.headersSent = scenario.headersSent;
                response.writableEnded = scenario.writableEnded;
                const next = vi.fn();

                try {
                    service.uploadFile(request, response, next);
                    const finalizer = captured.getUploadRequestFinalizer(request);
                    capturedReceiverCallback(captured.receiveBody)(new Error('synthetic receiver failure'));
                    await finalizer.waitForCompletion();

                    expect(next).toHaveBeenCalledTimes(scenario.expectedNext);
                    if (scenario.expectedNext === 1)
                        expect(next).toHaveBeenCalledExactlyOnceWith('synthetic receiver failure');
                    expect(release.releaseOnce).toHaveBeenCalledOnce();
                    expect(await readdir(join(temporaryRoot, 'incoming'))).toEqual([]);
                    expectDetached(request, response);
                } finally {
                    request.destroy();
                    await rm(temporaryRoot, { force: true, recursive: true });
                }
            });
        },
    );

    it('[L263] forwards a non-Error receiver failure using its stringified value', async () => {
        vi.useFakeTimers();
        await useCapturedMulter(async captured => {
            const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-server-non-error-receiver-'));
            const service = makeService(captured.ServiceServer, temporaryRoot, true);
            const release = makeRelease();
            service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce: release.releaseOnce })) };
            const request = makeRequest();
            request.aborted = false;
            const response = makeResponse();
            const next = vi.fn();

            try {
                service.uploadFile(request, response, next);
                const finalizer = captured.getUploadRequestFinalizer(request);
                // Every other receiver-failure case in this suite throws/passes a real Error; this
                // exercises the receiveBody error callback's `String(err)` fallback, which only a
                // non-Error rejection reaches.
                capturedReceiverCallback(captured.receiveBody)('synthetic non-error receiver failure');
                await finalizer.waitForCompletion();

                expect(next).toHaveBeenCalledExactlyOnceWith('synthetic non-error receiver failure');
                expect(release.releaseOnce).toHaveBeenCalledOnce();
                expect(await readdir(join(temporaryRoot, 'incoming'))).toEqual([]);
                expectDetached(request, response);
            } finally {
                request.destroy();
                await rm(temporaryRoot, { force: true, recursive: true });
            }
        });
    });

    it('[A129/A130 L258-259] forwards repeated successful receiver callbacks only once', async () => {
        vi.useFakeTimers();
        await useCapturedMulter(async captured => {
            const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-server-next-once-'));
            const service = makeService(captured.ServiceServer, temporaryRoot, true);
            const release = makeRelease();
            service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce: release.releaseOnce })) };
            const request = makeRequest();
            request.aborted = false;
            request.body = { recordedId: '12' };
            const response = makeResponse();
            const next = vi.fn();

            try {
                service.uploadFile(request, response, next);
                const finalizer = captured.getUploadRequestFinalizer(request);
                const receiverCallback = capturedReceiverCallback(captured.receiveBody);
                receiverCallback();
                receiverCallback();

                expect(next).toHaveBeenCalledOnce();
                expect(request.body.recordedId).toBe(12);
                response.emit('close');
                await finalizer.waitForCompletion();
                expect(release.releaseOnce).toHaveBeenCalledOnce();
                expect(await readdir(join(temporaryRoot, 'incoming'))).toEqual([]);
                expectDetached(request, response);
            } finally {
                request.destroy();
                await rm(temporaryRoot, { force: true, recursive: true });
            }
        });
    });

    it('[A125/A163/A165/A171/A172/A177 L253/L279/L281/L288/L292] detaches before abort cleanup and releases after cleanup', async () => {
        vi.useFakeTimers();
        await useCapturedMulter(async captured => {
            const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-server-cleanup-order-'));
            const service = makeService(captured.ServiceServer, temporaryRoot, true);
            const release = makeRelease();
            service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce: release.releaseOnce })) };
            const request = makeRequest();
            request.aborted = false;
            const response = makeResponse();
            const next = vi.fn();
            let releaseCleanup!: () => void;
            let markCleanupStarted!: () => void;
            const cleanupGate = new Promise<void>(resolve => {
                releaseCleanup = resolve;
            });
            const cleanupStarted = new Promise<void>(resolve => {
                markCleanupStarted = resolve;
            });
            const cleanupStates: Array<Record<string, unknown>> = [];
            const originalCleanup = captured.IncomingUploadFile.prototype.cleanupOnce;
            vi.spyOn(captured.IncomingUploadFile.prototype, 'cleanupOnce').mockImplementation(async function (this: any) {
                cleanupStates.push({
                    bound: captured.getUploadRequestFinalizer(request),
                    requestListeners: request.listenerCount('aborted'),
                    responseCloseListeners: response.listenerCount('close'),
                    responseFinishListeners: response.listenerCount('finish'),
                    timers: vi.getTimerCount(),
                });
                markCleanupStarted();
                await cleanupGate;
                await originalCleanup.call(this);
            });
            const teardown = vi.spyOn(captured.UploadBodyReceiverTeardown.prototype, 'teardownOnce');

            try {
                service.uploadFile(request, response, next);
                const finalizer = captured.getUploadRequestFinalizer(request);
                response.emit('close');
                await cleanupStarted;

                expect(teardown).toHaveBeenCalledOnce();
                expect(teardown.mock.calls[0][0]).toMatchObject({ message: 'UploadTerminated:abort' });
                expect(cleanupStates).toEqual([
                    {
                        bound: undefined,
                        requestListeners: 0,
                        responseCloseListeners: 0,
                        responseFinishListeners: 0,
                        timers: 0,
                    },
                ]);
                expect(release.releaseOnce).not.toHaveBeenCalled();
                expect(request.destroyed).toBe(true);
                releaseCleanup();
                await finalizer.waitForCompletion();

                expect(release.releaseOnce).toHaveBeenCalledOnce();
                expect(next).not.toHaveBeenCalled();
                expect(await readdir(join(temporaryRoot, 'incoming'))).toEqual([]);
                expectDetached(request, response);
            } finally {
                releaseCleanup();
                request.destroy();
                await rm(temporaryRoot, { force: true, recursive: true });
            }
        });
    });

    it.each([
        {
            expected: 'upload finalizer error: synthetic cleanup rejection',
            rejected: new Error('synthetic cleanup rejection'),
        },
        { expected: 'upload finalizer error: 79', rejected: 79 },
    ])('[A185/A186/A187 L296-299] reports finalizer rejection as $expected and still releases', async scenario => {
        vi.useFakeTimers();
        await useCapturedMulter(async captured => {
            const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-server-report-'));
            const service = makeService(captured.ServiceServer, temporaryRoot, true);
            const release = makeRelease();
            service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce: release.releaseOnce })) };
            const request = makeRequest();
            request.aborted = false;
            const response = makeResponse();
            const next = vi.fn();
            vi.spyOn(captured.IncomingUploadFile.prototype, 'cleanupOnce').mockRejectedValueOnce(scenario.rejected);

            try {
                service.uploadFile(request, response, next);
                const finalizer = captured.getUploadRequestFinalizer(request);
                capturedReceiverCallback(captured.receiveBody)(new Error('body failure'));
                await finalizer.waitForCompletion();

                expect(service.log.access.error).toHaveBeenCalledExactlyOnceWith(scenario.expected);
                expect(release.releaseOnce).toHaveBeenCalledOnce();
                expect(next).not.toHaveBeenCalled();
                expectDetached(request, response);
            } finally {
                request.destroy();
                await rm(temporaryRoot, { force: true, recursive: true });
            }
        });
    });

    it('[L296-299] swallows a logging failure while reporting a finalizer rejection without altering the upload outcome', async () => {
        vi.useFakeTimers();
        await useCapturedMulter(async captured => {
            const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-server-report-log-throw-'));
            const service = makeService(captured.ServiceServer, temporaryRoot, true);
            const release = makeRelease();
            service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce: release.releaseOnce })) };
            // Every other finalizer-rejection case in this suite has `log.access.error` succeed; this
            // makes it throw once to exercise reportFinalizerError's own `catch {}` -- otherwise
            // unreached since nothing else ever fails to log the reported message.
            service.log.access.error = vi.fn(() => {
                throw new Error('synthetic log sink failure');
            });
            const request = makeRequest();
            request.aborted = false;
            const response = makeResponse();
            const next = vi.fn();
            vi.spyOn(captured.IncomingUploadFile.prototype, 'cleanupOnce').mockRejectedValueOnce(
                new Error('synthetic cleanup rejection'),
            );

            try {
                service.uploadFile(request, response, next);
                const finalizer = captured.getUploadRequestFinalizer(request);
                capturedReceiverCallback(captured.receiveBody)(new Error('body failure'));

                await expect(finalizer.waitForCompletion()).resolves.toBeUndefined();
                expect(service.log.access.error).toHaveBeenCalledExactlyOnceWith(
                    'upload finalizer error: synthetic cleanup rejection',
                );
                expect(release.releaseOnce).toHaveBeenCalledOnce();
                expect(next).not.toHaveBeenCalled();
                expectDetached(request, response);
            } finally {
                request.destroy();
                await rm(temporaryRoot, { force: true, recursive: true });
            }
        });
    });
});

describe('ServiceServer Multer storage mutation oracles', () => {
    it.each(['error-before-finish', 'finish-before-error'] as const)(
        '[A208/A209/A211/A212 L335-336/L340] settles the writer callback once for %s',
        async ordering => {
            vi.useFakeTimers();
            await useCapturedMulter(async captured => {
                const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-server-writer-'));
                const service = makeService(captured.ServiceServer, temporaryRoot, true);
                const release = makeRelease();
                service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce: release.releaseOnce })) };
                const request = makeRequest();
                request.aborted = false;
                const response = makeResponse();
                const next = vi.fn();
                const fileStream = new PassThrough();
                const outputStream = new PassThrough() as PassThrough & { bytesWritten: number };
                outputStream.bytesWritten = 17;
                const createWriteStream = spyOnFs('createWriteStream').mockReturnValue(outputStream as any);
                const storageCallback = vi.fn();
                const failure = new Error(`synthetic ${ordering}`);

                try {
                    service.uploadFile(request, response, next);
                    const finalizer = captured.getUploadRequestFinalizer(request);
                    const storage = captured.multerFactory.mock.calls[0][0].storage;
                    storage._handleFile(request, { stream: fileStream }, storageCallback);

                    if (ordering === 'error-before-finish') {
                        outputStream.emit('error', failure);
                        outputStream.emit('finish');
                        expect(storageCallback).toHaveBeenCalledExactlyOnceWith(failure, undefined);
                    } else {
                        outputStream.emit('finish');
                        outputStream.emit('error', failure);
                        expect(storageCallback).toHaveBeenCalledOnce();
                        expect(storageCallback.mock.calls[0][0]).toBeUndefined();
                        expect(storageCallback.mock.calls[0][1]).toEqual({
                            destination: expect.stringMatching(/upload-/u),
                            filename: 'payload',
                            path: expect.stringMatching(/upload-[^/]+\/payload$/u),
                            size: 17,
                        });
                    }

                    expect(createWriteStream).toHaveBeenCalledOnce();
                    const fileClosed = new Promise<void>(resolve => fileStream.once('close', resolve));
                    const outputClosed = new Promise<void>(resolve => outputStream.once('close', resolve));
                    fileStream.destroy();
                    outputStream.destroy();
                    await Promise.all([fileClosed, outputClosed]);
                    expect(captured.finishUploadRequest(request, 'abort')).toBe(true);
                    await finalizer.waitForCompletion();

                    expect(storageCallback).toHaveBeenCalledOnce();
                    expect(release.releaseOnce).toHaveBeenCalledOnce();
                    expect(await readdir(join(temporaryRoot, 'incoming'))).toEqual([]);
                    expectDetached(request, response);
                } finally {
                    fileStream.destroy();
                    outputStream.destroy();
                    request.destroy();
                    await rm(temporaryRoot, { force: true, recursive: true });
                }
            });
        },
    );

    it('[A210 L339] routes the receiver teardown error into the captured storage callback', async () => {
        vi.useFakeTimers();
        await useCapturedMulter(async captured => {
            const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-server-storage-settle-'));
            const service = makeService(captured.ServiceServer, temporaryRoot, true);
            const release = makeRelease();
            service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce: release.releaseOnce })) };
            const request = makeRequest();
            request.aborted = false;
            const response = makeResponse();
            const fileStream = new PassThrough();
            const outputStream = new PassThrough();
            spyOnFs('createWriteStream').mockReturnValue(outputStream as any);
            const bindFile = vi.spyOn(captured.UploadBodyReceiverTeardown.prototype, 'bindFile');
            const storageCallback = vi.fn();
            const failure = new Error('synthetic teardown storage failure');

            try {
                service.uploadFile(request, response, vi.fn());
                const finalizer = captured.getUploadRequestFinalizer(request);
                const storage = captured.multerFactory.mock.calls[0][0].storage;
                storage._handleFile(request, { stream: fileStream }, storageCallback);
                expect(bindFile).toHaveBeenCalledOnce();

                const settleStorage = bindFile.mock.calls[0][2] as (error: Error) => void;
                settleStorage(failure);
                settleStorage(new Error('late teardown failure'));
                expect(storageCallback).toHaveBeenCalledExactlyOnceWith(failure, undefined);

                const fileClosed = new Promise<void>(resolve => fileStream.once('close', resolve));
                const outputClosed = new Promise<void>(resolve => outputStream.once('close', resolve));
                fileStream.destroy();
                outputStream.destroy();
                await Promise.all([fileClosed, outputClosed]);
                expect(captured.finishUploadRequest(request, 'abort')).toBe(true);
                await finalizer.waitForCompletion();
                expect(storageCallback).toHaveBeenCalledOnce();
                expect(release.releaseOnce).toHaveBeenCalledOnce();
                expect(await readdir(join(temporaryRoot, 'incoming'))).toEqual([]);
                expectDetached(request, response);
            } finally {
                fileStream.destroy();
                outputStream.destroy();
                request.destroy();
                await rm(temporaryRoot, { force: true, recursive: true });
            }
        });
    });

    it('[A217-A227 L351/L356-357] removes metadata and reports success, ENOENT, error, and non-string path exactly', async () => {
        vi.useFakeTimers();
        await useCapturedMulter(async captured => {
            const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-server-remove-file-'));
            const service = makeService(captured.ServiceServer, temporaryRoot, true);
            const release = makeRelease();
            service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce: release.releaseOnce })) };
            const request = makeRequest();
            request.aborted = false;
            const response = makeResponse();
            const unlinkOutcomes = [null, Object.assign(new Error('missing'), { code: 'ENOENT' }), new Error('denied')];
            const unlink = spyOnFs('unlink').mockImplementation(
                (_path: unknown, callback: (error: Error | null) => void) =>
                    callback(unlinkOutcomes.shift() as Error | null),
            );

            try {
                service.uploadFile(request, response, vi.fn());
                const finalizer = captured.getUploadRequestFinalizer(request);
                const storage = captured.multerFactory.mock.calls[0][0].storage;
                const successPath = join(temporaryRoot, 'success');
                const missingPath = join(temporaryRoot, 'missing');
                const deniedPath = join(temporaryRoot, 'denied');
                const successFile = {
                    destination: temporaryRoot,
                    filename: 'success',
                    path: successPath,
                };
                const missingFile = {
                    destination: temporaryRoot,
                    filename: 'missing',
                    path: missingPath,
                };
                const deniedFile = {
                    destination: temporaryRoot,
                    filename: 'denied',
                    path: deniedPath,
                };
                const nonStringFile = {
                    destination: temporaryRoot,
                    filename: 'non-string',
                    path: { synthetic: true },
                };
                const success = vi.fn();
                const missing = vi.fn();
                const denied = vi.fn();
                const nonString = vi.fn();

                storage._removeFile(request, successFile, success);
                storage._removeFile(request, missingFile, missing);
                storage._removeFile(request, deniedFile, denied);
                storage._removeFile(request, nonStringFile, nonString);

                expect(unlink).toHaveBeenCalledTimes(3);
                expect(unlink.mock.calls.map(([target]) => target)).toEqual([successPath, missingPath, deniedPath]);
                expect(success).toHaveBeenCalledExactlyOnceWith(null);
                expect(missing).toHaveBeenCalledExactlyOnceWith(null);
                expect(denied).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'denied' }));
                expect(nonString).toHaveBeenCalledExactlyOnceWith(null);
                for (const file of [successFile, missingFile, deniedFile, nonStringFile]) {
                    expect(file).not.toHaveProperty('destination');
                    expect(file).not.toHaveProperty('filename');
                    expect(file).not.toHaveProperty('path');
                }

                expect(captured.finishUploadRequest(request, 'abort')).toBe(true);
                await finalizer.waitForCompletion();
                expect(release.releaseOnce).toHaveBeenCalledOnce();
                expect(await readdir(join(temporaryRoot, 'incoming'))).toEqual([]);
                expectDetached(request, response);
            } finally {
                request.destroy();
                await rm(temporaryRoot, { force: true, recursive: true });
            }
        });
    });
});

describe('ServiceServer receiver callback and pipe restoration mutation oracles', () => {
    it('[A231/A242 L364/L381] times out with the exact reason and makes a late successful callback inert', async () => {
        vi.useFakeTimers();
        await useCapturedMulter(async captured => {
            const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-server-timeout-'));
            const service = makeService(captured.ServiceServer, temporaryRoot, true);
            service.config.uploadReceiveTimeoutMs = 83;
            const release = makeRelease();
            service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce: release.releaseOnce })) };
            const request = makeRequest();
            request.aborted = false;
            request.body = { recordedId: '0041' };
            request.file = { fieldname: 'file', filename: 'payload' };
            const response = makeResponse();
            const next = vi.fn();
            const finish = vi.spyOn(captured.UploadRequestFinalizer.prototype, 'finishOnce');

            try {
                service.uploadFile(request, response, next);
                const finalizer = captured.getUploadRequestFinalizer(request);
                const receiverCallback = capturedReceiverCallback(captured.receiveBody);
                await vi.advanceTimersByTimeAsync(83);
                await finalizer.waitForCompletion();

                expect(finish.mock.calls[0][0]).toBe('receive-timeout');
                expect(next).toHaveBeenCalledExactlyOnceWith('UploadReceiveTimeout');
                expect(release.releaseOnce).toHaveBeenCalledOnce();
                expect(await readdir(join(temporaryRoot, 'incoming'))).toEqual([]);
                expectDetached(request, response);

                receiverCallback();
                expect(request.body).toEqual({ recordedId: '0041' });
                expect(next).toHaveBeenCalledOnce();
                expect(release.releaseOnce).toHaveBeenCalledOnce();
            } finally {
                request.destroy();
                await rm(temporaryRoot, { force: true, recursive: true });
            }
        });
    });

    it('[A240 L377] forwards the exact receiver error once after cleanup', async () => {
        vi.useFakeTimers();
        await useCapturedMulter(async captured => {
            const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-server-body-error-'));
            const service = makeService(captured.ServiceServer, temporaryRoot, true);
            const release = makeRelease();
            service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce: release.releaseOnce })) };
            const request = makeRequest();
            request.aborted = false;
            const response = makeResponse();
            const next = vi.fn();
            const finish = vi.spyOn(captured.UploadRequestFinalizer.prototype, 'finishOnce');

            try {
                service.uploadFile(request, response, next);
                const finalizer = captured.getUploadRequestFinalizer(request);
                capturedReceiverCallback(captured.receiveBody)(new Error('synthetic exact body error'));
                await finalizer.waitForCompletion();

                expect(next).toHaveBeenCalledExactlyOnceWith('synthetic exact body error');
                expect(finish).toHaveBeenCalledExactlyOnceWith('failure');
                expect(release.releaseOnce).toHaveBeenCalledOnce();
                expect(await readdir(join(temporaryRoot, 'incoming'))).toEqual([]);
                expectDetached(request, response);
            } finally {
                request.destroy();
                await rm(temporaryRoot, { force: true, recursive: true });
            }
        });
    });

    it.each([
        {
            body: { recordedId: '0012' },
            expectedBody: { file: 'payload', recordedId: 12 },
            file: { fieldname: 'file', filename: 'payload' },
            name: 'string id and defined field',
        },
        {
            body: { recordedId: null },
            expectedBody: { recordedId: null },
            file: { filename: 'ignored' },
            name: 'non-string id and missing fieldname',
        },
        {
            body: { recordedId: 12 },
            expectedBody: { recordedId: 12 },
            file: undefined,
            name: 'numeric id and absent file',
        },
    ])('[A243/A254/A256 L383/L387] preserves the recordedId/file matrix for $name', async scenario => {
        vi.useFakeTimers();
        await useCapturedMulter(async captured => {
            const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-server-body-matrix-'));
            const service = makeService(captured.ServiceServer, temporaryRoot, true);
            const release = makeRelease();
            service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce: release.releaseOnce })) };
            const request = makeRequest();
            request.aborted = false;
            request.body = { ...scenario.body };
            request.file = scenario.file;
            const response = makeResponse();
            const next = vi.fn();

            try {
                service.uploadFile(request, response, next);
                const finalizer = captured.getUploadRequestFinalizer(request);
                capturedReceiverCallback(captured.receiveBody)();

                expect(request.body).toEqual(scenario.expectedBody);
                expect(next).toHaveBeenCalledOnce();
                expect(vi.getTimerCount()).toBe(0);
                response.emit('close');
                await finalizer.waitForCompletion();
                expect(release.releaseOnce).toHaveBeenCalledOnce();
                expect(await readdir(join(temporaryRoot, 'incoming'))).toEqual([]);
                expectDetached(request, response);
            } finally {
                request.destroy();
                await rm(temporaryRoot, { force: true, recursive: true });
            }
        });
    });

    it.each([
        { ownPipe: true, receiverThrows: false },
        { ownPipe: true, receiverThrows: true },
        { ownPipe: false, receiverThrows: false },
        { ownPipe: false, receiverThrows: true },
    ])(
        '[A233/A258/A259/A260 L366/L393-394] restores own=$ownPipe pipe descriptor after receiverThrows=$receiverThrows',
        async scenario => {
            vi.useFakeTimers();
            await useCapturedMulter(async captured => {
                const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-server-pipe-'));
                const service = makeService(captured.ServiceServer, temporaryRoot, true);
                const release = makeRelease();
                service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce: release.releaseOnce })) };
                const request = makeRequest();
                request.aborted = false;
                if (scenario.ownPipe) {
                    Object.defineProperty(request, 'pipe', {
                        configurable: true,
                        enumerable: false,
                        value: vi.fn(),
                        writable: true,
                    });
                }
                const originalPipe = request.pipe;
                const originalDescriptor = Object.getOwnPropertyDescriptor(request, 'pipe');
                expect(originalDescriptor === undefined).toBe(!scenario.ownPipe);
                const response = makeResponse();
                const failure = new Error('synthetic synchronous receiver failure');
                captured.receiveBody.mockImplementation((candidateRequest: any) => {
                    expect(candidateRequest.pipe).not.toBe(originalPipe);
                    expect(Object.hasOwn(candidateRequest, 'pipe')).toBe(true);
                    if (scenario.receiverThrows) throw failure;
                });

                try {
                    if (scenario.receiverThrows) {
                        expect(() => service.uploadFile(request, response, vi.fn())).toThrow(failure);
                    } else {
                        service.uploadFile(request, response, vi.fn());
                    }

                    expect(request.pipe).toBe(originalPipe);
                    expect(Object.getOwnPropertyDescriptor(request, 'pipe')).toEqual(originalDescriptor);
                    const finalizer = captured.getUploadRequestFinalizer(request);
                    expect(finalizer).toBeDefined();
                    expect(captured.finishUploadRequest(request, 'abort')).toBe(true);
                    await finalizer.waitForCompletion();
                    expect(release.releaseOnce).toHaveBeenCalledOnce();
                    expect(await readdir(join(temporaryRoot, 'incoming'))).toEqual([]);
                    expectDetached(request, response);
                } finally {
                    request.destroy();
                    await rm(temporaryRoot, { force: true, recursive: true });
                }
            });
        },
    );
});
