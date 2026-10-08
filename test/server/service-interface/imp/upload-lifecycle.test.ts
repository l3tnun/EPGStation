import express from 'express';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { request as httpRequest, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { load as loadYaml } from 'js-yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { close, compiled, listen, modelContainer, require } from '../_harness';

/*
 * ServiceServer.js の `import * as fs from 'fs'` / `import multer from 'multer'` は静的に解決される。
 * require() で読み込んだ 'node:fs' / 'multer' の CommonJS module.exports を後から書き換えても ESM 側の
 * import 束縛には届かない (in-process の従来の `vi.spyOn(require('node:fs'), ...)` や
 * `require.cache[...].exports = ...` 差し替えが効かなくなった)。
 *
 * `vi.doMock(specifier, factory)` で ServiceServer.js が import する 'fs' / 'node:fs' / 'multer' 自体を、
 * 実体へ委譲しつつ名前ごとに上書き可能な Proxy / 委譲関数へ差し替えたうえで、動的 `import()` で 1 度だけ
 * 読み直す（既存の合格例: public-contract.spec.test.ts の version.js 差し替え、
 * service-server-mutation-oracles.test.ts の同種対応）。個別 test ごとに `vi.resetModules()` して都度
 * import し直す方式は採らない。ServiceServer.js が内部で静的 import する UploadAdmissionController.js
 * まで毎回新しいモジュール実体になり、finishUploadRequest / getUploadRequestFinalizer が使う WeakMap や
 * 各 prototype が captured された ServiceServer とは別物になって request に紐付いた finalizer を取得
 * できなくなるため。
 */
const actualFileSystem = require('node:fs') as {
    readdirSync(path: string, options?: unknown): unknown;
    rmdirSync(path: string): void;
    statSync(path: string): { readonly dev: number; isDirectory(): boolean };
    unlinkSync(path: string): void;
    [key: string]: any;
};
const actualMulter = require('multer') as any;

const fsOverrides = new Map<string, (...args: any[]) => any>();
let currentMulter: ((...args: any[]) => any) | undefined;
let currentMulterErrorClass: any = actualMulter.MulterError;

const fsProxy = new Proxy(actualFileSystem, {
    get(target, prop, receiver) {
        if (typeof prop === 'string' && fsOverrides.has(prop)) return fsOverrides.get(prop);
        return Reflect.get(target, prop, receiver);
    },
});
const multerEntryPoint: any = (...args: any[]) => (currentMulter ?? actualMulter)(...args);
Object.defineProperty(multerEntryPoint, 'MulterError', {
    get: () => currentMulterErrorClass,
});

vi.doMock('fs', () => fsProxy);
vi.doMock('node:fs', () => fsProxy);
vi.doMock('multer', () => ({ default: multerEntryPoint }));

const spyOnFs = (name: string): ReturnType<typeof vi.fn> => {
    const spy = vi.fn((...args: any[]) => (actualFileSystem as any)[name](...args));
    fsOverrides.set(name, spy);
    return spy;
};

const Configuration = (require(compiled('model', 'Configuration.js')) as any).default;
const IPCClient = (require(compiled('model', 'ipc', 'IPCClient.js')) as any).default;
const { default: ServiceServer } = (await import(compiled('model', 'service', 'ServiceServer.js'))) as any;
const uploadLifecycle = (await import(
    compiled('model', 'service', 'upload', 'UploadAdmissionController.js')
)) as any;
const finishUploadRequest = uploadLifecycle.finishUploadRequest as (request: object, reason: string) => boolean;
const getUploadRequestFinalizer = uploadLifecycle.getUploadRequestFinalizer as (request: object) => any;
const bindUploadRequestFinalizer = uploadLifecycle.bindUploadRequestFinalizer as (
    request: object,
    finalizer: unknown,
) => void;
const unbindUploadRequestFinalizer = uploadLifecycle.unbindUploadRequestFinalizer as (
    request: object,
    finalizer: unknown,
) => void;
const UploadBodyReceiverTeardown = uploadLifecycle.UploadBodyReceiverTeardown;
const IncomingUploadFile = uploadLifecycle.IncomingUploadFile as any;
const UploadAdmissionController = uploadLifecycle.default;
const UploadRequestFinalizer = uploadLifecycle.UploadRequestFinalizer;

interface ClientHarness {
    readonly client: any;
    readonly send: ReturnType<typeof vi.fn>;
    receive(message: unknown): Promise<void>;
    cleanup(): void;
}

const flushNextTick = (): Promise<void> => new Promise(resolve => process.nextTick(resolve));
const realSetImmediate = setImmediate;
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;

const waitForCondition = async (condition: () => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 5_000; attempt++) {
        if (condition()) return;
        await new Promise<void>(resolve => realSetTimeout(resolve, 1));
    }
    throw new Error('ConditionTimeout');
};

const makeClient = (): ClientHarness => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'send');
    const existingListeners = new Set(process.listeners('message'));
    const send = vi.fn();
    Object.defineProperty(process, 'send', { configurable: true, value: send, writable: true });
    const client = new IPCClient(
        { getLogger: () => ({ system: { error: vi.fn(), fatal: vi.fn(), info: vi.fn() } }) },
        { notifyClient: vi.fn() },
        { push: vi.fn() },
    );
    const clientListeners = process.listeners('message').filter(listener => !existingListeners.has(listener));

    return {
        client,
        send,
        receive: async message => {
            await Promise.all(clientListeners.map(listener => listener(message)));
        },
        cleanup: () => {
            for (const listener of process.listeners('message')) {
                if (!existingListeners.has(listener)) process.removeListener('message', listener);
            }
            if (descriptor === undefined) delete process.send;
            else Object.defineProperty(process, 'send', descriptor);
        },
    };
};

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    fsOverrides.clear();
    currentMulter = undefined;
    currentMulterErrorClass = actualMulter.MulterError;
});

const formatConfiguration = (
    overrides: Record<string, unknown> = {},
    omitted: readonly string[] = [],
): Record<string, any> => {
    const configuration = Object.create(Configuration.prototype) as any;
    configuration.templateConfig = null;
    const candidate = { ...structuredClone(Configuration.DEFAULT_VALUE), port: 48_100, ...overrides };
    for (const field of omitted) delete candidate[field];
    return configuration.formatConfig(candidate);
};

const uploadService = (uploadTempDir: string, initializeNamespaces = false): any => {
    const service = Object.create(ServiceServer.prototype) as any;
    service.config = { uploadReceiveTimeoutMs: 300_000, uploadTempDir };
    service.log = {
        access: { error: vi.fn(), info: vi.fn() },
        system: { error: vi.fn(), info: vi.fn() },
    };
    service.uploadAdmission = new UploadAdmissionController(3);
    if (initializeNamespaces) service.createUploadDir();
    return service;
};

const uploadMultipart = (complete = true): { readonly body: Buffer; readonly boundary: string } => {
    const boundary = 'epgstation-upload-admission-boundary';
    const chunks = [
        `--${boundary}\r\nContent-Disposition: form-data; name="recordedId"\r\n\r\n12\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="parentDirectoryName"\r\n\r\nprimary\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="viewName"\r\n\r\nsynthetic-view\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="fileType"\r\n\r\nts\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.ts"\r\n` +
            'Content-Type: application/octet-stream\r\n\r\nsynthetic-upload\r\n',
    ];
    if (complete) chunks.push(`--${boundary}--\r\n`);
    return { body: Buffer.from(chunks.join('')), boundary };
};

const uploadRequestStream = (body: Buffer, boundary: string): PassThrough & Record<string, any> => {
    const request = new PassThrough() as PassThrough & Record<string, any>;
    request.headers = {
        'content-length': String(body.length),
        'content-type': `multipart/form-data; boundary=${boundary}`,
    };
    request.method = 'POST';
    return request;
};

const uploadResponseEmitter = (): EventEmitter & Record<string, any> => {
    const response = new EventEmitter() as EventEmitter & Record<string, any>;
    response.destroyed = false;
    response.headersSent = false;
    response.statusCode = 200;
    response.writableEnded = false;
    return response;
};

const permutations = <T>(values: readonly T[]): T[][] => {
    if (values.length === 0) return [[]];
    return values.flatMap((value, index) =>
        permutations([...values.slice(0, index), ...values.slice(index + 1)]).map(rest => [value, ...rest]),
    );
};

describe('Upload startup settings snapshot [SI-6.2/SI-6.3/SI-6.8]', () => {
    it('uses the Configuration owner defaults when both upload settings are omitted', () => {
        expect(formatConfiguration({}, ['concurrentUploadNum', 'uploadReceiveTimeoutMs'])).toMatchObject({
            concurrentUploadNum: 3,
            uploadReceiveTimeoutMs: 300_000,
        });
    });

    it.each([
        ['concurrentUploadNum', 1],
        ['concurrentUploadNum', Number.MAX_SAFE_INTEGER],
        ['uploadReceiveTimeoutMs', 1],
        ['uploadReceiveTimeoutMs', 2_147_483_647],
    ] as const)('accepts %s boundary %s in the completed Configuration snapshot', (field, value) => {
        expect(formatConfiguration({ [field]: value })[field]).toBe(value);
    });

    it.each([
        ['concurrentUploadNum', 0],
        ['concurrentUploadNum', -1],
        ['concurrentUploadNum', 1.5],
        ['concurrentUploadNum', '1'],
        ['concurrentUploadNum', Number.NaN],
        ['concurrentUploadNum', Number.POSITIVE_INFINITY],
        ['concurrentUploadNum', Number.MAX_SAFE_INTEGER + 1],
        ['uploadReceiveTimeoutMs', 0],
        ['uploadReceiveTimeoutMs', -1],
        ['uploadReceiveTimeoutMs', 1.5],
        ['uploadReceiveTimeoutMs', '1'],
        ['uploadReceiveTimeoutMs', Number.NaN],
        ['uploadReceiveTimeoutMs', Number.POSITIVE_INFINITY],
        ['uploadReceiveTimeoutMs', 2_147_483_648],
    ] as const)('rejects invalid %s=%s before ServiceServer startup', (field, value) => {
        const startListeners = vi.fn();

        expect(() => {
            const snapshot = formatConfiguration({ [field]: value });
            startListeners(snapshot);
        }).toThrow(`ConfigValueError:${field}`);
        expect(startListeners).not.toHaveBeenCalled();
    });

    it('retains one completed startup snapshot when the configuration owner later changes', () => {
        const initial = Object.freeze({ concurrentUploadNum: 3, uploadReceiveTimeoutMs: 300_000 });
        const reloaded = Object.freeze({ concurrentUploadNum: 7, uploadReceiveTimeoutMs: 700_000 });
        const getConfig = vi.fn().mockReturnValue(initial);
        vi.spyOn(ServiceServer.prototype as any, 'init').mockImplementation(() => undefined);

        const service = new ServiceServer({ getLogger: () => ({}) }, { getConfig }, { initialize: vi.fn() }) as any;
        getConfig.mockReturnValue(reloaded);

        expect(getConfig).toHaveBeenCalledOnce();
        expect(service.config).toBe(initial);
        expect(service.config).toMatchObject({ concurrentUploadNum: 3, uploadReceiveTimeoutMs: 300_000 });
        const leases = [
            service.uploadAdmission.tryAcquire(),
            service.uploadAdmission.tryAcquire(),
            service.uploadAdmission.tryAcquire(),
        ];
        expect(leases.every((lease: unknown) => lease !== null)).toBe(true);
        expect(service.uploadAdmission.tryAcquire()).toBeNull();
        for (const lease of leases) lease.releaseOnce();
    });

    it('does not apply the upload body deadline to the HTTP listener', async () => {
        const socketIoManageModel = { initialize: vi.fn() };
        vi.spyOn(ServiceServer.prototype as any, 'init').mockImplementation(() => undefined);
        const service = new ServiceServer(
            { getLogger: () => ({ system: { info: vi.fn() } }) },
            {
                getConfig: () => ({
                    concurrentUploadNum: 3,
                    port: 0,
                    uploadReceiveTimeoutMs: 12_347,
                }),
            },
            socketIoManageModel,
        );

        service.start();
        const listener = socketIoManageModel.initialize.mock.calls[0][0][0] as Server;
        try {
            await listen(listener);
            expect(listener.requestTimeout).not.toBe(12_347);
            expect(listener.headersTimeout).not.toBe(12_347);
            expect(listener.keepAliveTimeout).not.toBe(12_347);
            expect(listener.timeout).not.toBe(12_347);
        } finally {
            if (listener.listening) await close(listener);
        }
    });
});

describe('Upload namespace startup gate [SI-6.2/SI-6.3]', () => {
    it('creates incoming and adopted directories on the same filesystem before startup continues', async () => {
        const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-namespaces-'));
        const uploadRoot = join(temporaryRoot, 'uploads');
        const continueStartup = vi.fn();

        try {
            uploadService(uploadRoot).createUploadDir();
            continueStartup();

            const [incoming, adopted] = await Promise.all([
                stat(join(uploadRoot, 'incoming')),
                stat(join(uploadRoot, 'adopted')),
            ]);
            expect(incoming.isDirectory()).toBe(true);
            expect(adopted.isDirectory()).toBe(true);
            expect(incoming.dev).toBe(adopted.dev);
            expect(continueStartup).toHaveBeenCalledOnce();
        } finally {
            await rm(temporaryRoot, { force: true, recursive: true });
        }
    });

    it.each(['incoming', 'adopted'] as const)(
        'stops startup when the %s namespace cannot be a directory',
        async namespace => {
            const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-namespace-failure-'));
            const uploadRoot = join(temporaryRoot, 'uploads');
            await mkdir(uploadRoot);
            await writeFile(join(uploadRoot, namespace), 'not-a-directory');
            const continueStartup = vi.fn();

            try {
                expect(() => {
                    uploadService(uploadRoot).createUploadDir();
                    continueStartup();
                }).toThrow();
                expect(continueStartup).not.toHaveBeenCalled();
            } finally {
                await rm(temporaryRoot, { force: true, recursive: true });
            }
        },
    );

    it('stops startup when incoming and adopted report different filesystem devices', async () => {
        const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-device-gate-'));
        const uploadRoot = join(temporaryRoot, 'uploads');
        const incomingPath = join(uploadRoot, 'incoming');
        const adoptedPath = join(uploadRoot, 'adopted');
        await Promise.all([mkdir(incomingPath, { recursive: true }), mkdir(adoptedPath, { recursive: true })]);
        const statSync = actualFileSystem.statSync.bind(actualFileSystem);
        spyOnFs('statSync').mockImplementation(path => {
            const result = statSync(path);
            return path === adoptedPath ? { dev: result.dev + 1, isDirectory: () => result.isDirectory() } : result;
        });
        const continueStartup = vi.fn();

        try {
            expect(() => {
                uploadService(uploadRoot).createUploadDir();
                continueStartup();
            }).toThrow();
            expect(continueStartup).not.toHaveBeenCalled();
        } finally {
            await rm(temporaryRoot, { force: true, recursive: true });
        }
    });

    it('cleans only direct stale incoming payloads and empty token directories before startup continues', async () => {
        const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-restart-cleanup-'));
        const uploadRoot = join(temporaryRoot, 'uploads');
        const incomingRoot = join(uploadRoot, 'incoming');
        const adoptedRoot = join(uploadRoot, 'adopted');
        const staleToken = join(incomingRoot, 'upload-stale');
        const emptyToken = join(incomingRoot, 'upload-empty');
        const blockedToken = join(incomingRoot, 'upload-blocked');
        const linkedToken = join(incomingRoot, 'upload-linked');
        const payloadBlockedToken = join(incomingRoot, 'upload-payload-blocked');
        const adoptedPayload = join(adoptedRoot, 'upload-parent-owned', 'payload');
        const stalePayload = join(staleToken, 'payload');
        const blockedPayload = join(blockedToken, 'payload');
        const blockedSibling = join(blockedToken, 'unrelated');
        const payloadBlockedPath = join(payloadBlockedToken, 'payload');
        const payloadBlockedSibling = join(payloadBlockedPath, 'unrelated');
        const incomingSentinel = join(incomingRoot, 'unrelated-file');
        const readdirSync = spyOnFs('readdirSync');
        const unlinkSync = spyOnFs('unlinkSync');
        const rmdirSync = spyOnFs('rmdirSync');
        const service = uploadService(uploadRoot);

        await Promise.all([
            mkdir(staleToken, { recursive: true }),
            mkdir(emptyToken, { recursive: true }),
            mkdir(blockedToken, { recursive: true }),
            mkdir(payloadBlockedPath, { recursive: true }),
            mkdir(dirname(adoptedPayload), { recursive: true }),
        ]);
        await Promise.all([
            writeFile(stalePayload, 'stale'),
            writeFile(blockedPayload, 'stale-but-blocked'),
            writeFile(blockedSibling, 'keep'),
            writeFile(payloadBlockedSibling, 'keep'),
            writeFile(adoptedPayload, 'parent-owned'),
            writeFile(incomingSentinel, 'keep'),
        ]);
        await symlink(dirname(adoptedPayload), linkedToken);

        try {
            service.createUploadDir();

            await expect(access(stalePayload)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(access(staleToken)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(access(emptyToken)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(access(blockedPayload)).rejects.toMatchObject({ code: 'ENOENT' });
            expect(await readFile(blockedSibling, 'utf8')).toBe('keep');
            expect(await readFile(payloadBlockedSibling, 'utf8')).toBe('keep');
            expect(await readFile(adoptedPayload, 'utf8')).toBe('parent-owned');
            expect(await readFile(incomingSentinel, 'utf8')).toBe('keep');
            await expect(access(linkedToken)).resolves.toBeUndefined();
            const cleanupLogs = service.log.system.error.mock.calls.map(([message]: [string]) => message);
            expect(cleanupLogs).toHaveLength(3);
            expect(cleanupLogs).toEqual(
                expect.arrayContaining([
                    expect.stringContaining(`stale incoming upload token directory cleanup error: ${blockedToken}: `),
                    expect.stringContaining(`stale incoming upload payload cleanup error: ${payloadBlockedPath}: `),
                    expect.stringContaining(
                        `stale incoming upload token directory cleanup error: ${payloadBlockedToken}: `,
                    ),
                ]),
            );

            const namespaceReads = readdirSync.mock.calls
                .map(([target]) => target)
                .filter(target => target === incomingRoot || target === adoptedRoot);
            const removedTargets = [...unlinkSync.mock.calls, ...rmdirSync.mock.calls]
                .map(([target]) => target)
                .filter(target => target.startsWith(uploadRoot));
            expect(namespaceReads).toEqual([incomingRoot]);
            expect(removedTargets.some(target => target.startsWith(adoptedRoot))).toBe(false);
        } finally {
            await rm(temporaryRoot, { force: true, recursive: true });
        }
    });

    it('logs a non-Error stale incoming upload cleanup failure using its stringified value', async () => {
        const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-non-error-cleanup-'));
        const uploadRoot = join(temporaryRoot, 'uploads');
        const incomingRoot = join(uploadRoot, 'incoming');
        const staleToken = join(incomingRoot, 'upload-stale');
        const stalePayload = join(staleToken, 'payload');
        const unlinkSync = spyOnFs('unlinkSync');
        const service = uploadService(uploadRoot);

        await mkdir(staleToken, { recursive: true });
        await writeFile(stalePayload, 'stale');
        // Every other cleanup-failure case in this suite throws a real fs Error (ENOTEMPTY/ENOENT
        // etc.); this exercises removeStaleIncomingPath's non-Error `String(error)` fallback, which
        // no real fs.unlinkSync/rmdirSync failure can produce.
        unlinkSync.mockImplementationOnce(() => {
            throw 'synthetic non-error unlink failure';
        });

        try {
            service.createUploadDir();

            expect(service.log.system.error).toHaveBeenCalledWith(
                `stale incoming upload payload cleanup error: ${stalePayload}: synthetic non-error unlink failure`,
            );
        } finally {
            await rm(temporaryRoot, { force: true, recursive: true });
        }
    });
});

describe('Process-local upload admission [SI-6.4/SI-6.5/SI-6.6]', () => {
    it('admits exactly three active requests without a queue and lets each lease release once', () => {
        const admission = new UploadAdmissionController(3);
        const leases = [admission.tryAcquire(), admission.tryAcquire(), admission.tryAcquire()];

        expect(leases.every(lease => lease !== null)).toBe(true);
        expect(admission.tryAcquire()).toBeNull();
        leases[0].releaseOnce();
        leases[0].releaseOnce();
        const replacement = admission.tryAcquire();
        expect(replacement).not.toBeNull();
        expect(admission.tryAcquire()).toBeNull();

        for (const lease of [...leases.slice(1), replacement]) lease.releaseOnce();
        const restarted = [admission.tryAcquire(), admission.tryAcquire(), admission.tryAcquire()];
        expect(restarted.every(lease => lease !== null)).toBe(true);
        expect(admission.tryAcquire()).toBeNull();
        for (const lease of restarted) lease.releaseOnce();
    });

    it('selects one terminal decision across every ordering of request, response, body, timer, and IPC signals', () => {
        const signals = [
            { name: 'request aborted', reason: 'abort' },
            { name: 'response finish', reason: 'success' },
            { name: 'response close', reason: 'abort' },
            { name: 'Multer callback', reason: 'failure' },
            { name: 'deadline timer', reason: 'receive-timeout' },
            { name: 'IPC settlement', reason: 'registration-timeout' },
        ] as const;
        const orderings = permutations(signals);

        expect(orderings).toHaveLength(720);
        for (const ordering of orderings) {
            let releases = 0;
            const reasons: string[] = [];
            const finalizer = new UploadRequestFinalizer({ releaseOnce: () => releases++ }, (reason: string) =>
                reasons.push(reason),
            );

            for (const signal of ordering) finalizer.finishOnce(signal.reason);

            expect(reasons, ordering.map(signal => signal.name).join(' -> ')).toEqual([ordering[0].reason]);
            expect(releases, ordering.map(signal => signal.name).join(' -> ')).toBe(1);
        }
    });

    it('rejects a full request before Multer reads body bytes or creates a temporary file', async () => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-full-'));
        const service = uploadService(uploadRoot, true);
        service.uploadAdmission = { tryAcquire: vi.fn().mockReturnValue(null) };
        const form = uploadMultipart();
        const request = uploadRequestStream(form.body, form.boundary);
        const response = uploadResponseEmitter();
        const bodyListeners: string[] = [];
        const originalOn = request.on.bind(request);
        vi.spyOn(request, 'on').mockImplementation(((event: string, listener: (...args: any[]) => void) => {
            if (event === 'data') bodyListeners.push(event);
            return originalOn(event, listener);
        }) as any);
        let settleNext!: () => void;
        const nextSettled = new Promise<void>(resolve => {
            settleNext = resolve;
        });
        const next = vi.fn(() => settleNext());
        request.end(form.body);

        try {
            service.uploadFile(request, response, next);

            expect(service.uploadAdmission.tryAcquire).toHaveBeenCalledOnce();
            expect(next).toHaveBeenCalledOnce();
            expect(next.mock.calls[0]).toHaveLength(1);
            expect(next.mock.calls[0][0]).toBeDefined();
            expect(bodyListeners).toEqual([]);
            expect((await readdir(uploadRoot)).sort()).toEqual(['adopted', 'incoming']);
            expect(await readdir(join(uploadRoot, 'incoming'))).toEqual([]);
        } finally {
            await nextSettled;
            await rm(uploadRoot, { force: true, recursive: true });
        }
    });

    it('accepts three stalled bodies and rejects only the fourth before its body read', async () => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-default-three-'));
        const service = uploadService(uploadRoot, true);
        const requests = Array.from({ length: 4 }, () => {
            const form = uploadMultipart();
            const request = uploadRequestStream(form.body, form.boundary);
            const dataListeners: string[] = [];
            const originalOn = request.on.bind(request);
            vi.spyOn(request, 'on').mockImplementation(((event: string, listener: (...args: any[]) => void) => {
                if (event === 'data') dataListeners.push(event);
                return originalOn(event, listener);
            }) as any);
            return { dataListeners, request };
        });
        const responses = requests.map(() => uploadResponseEmitter());
        const next = requests.map(() => vi.fn());

        try {
            for (let index = 0; index < requests.length; index++) {
                service.uploadFile(requests[index].request, responses[index], next[index]);
            }

            expect(next.slice(0, 3).every(callback => callback.mock.calls.length === 0)).toBe(true);
            expect(next[3]).toHaveBeenCalledOnce();
            expect(next[3].mock.calls[0]).toHaveLength(1);
            expect(next[3].mock.calls[0][0]).toBeDefined();
            expect(requests.slice(0, 3).every(({ dataListeners }) => dataListeners.length > 0)).toBe(true);
            expect(requests[3].dataListeners).toEqual([]);
            expect((await readdir(uploadRoot)).sort()).toEqual(['adopted', 'incoming']);
            expect(await readdir(join(uploadRoot, 'incoming'))).toHaveLength(3);
        } finally {
            for (const { request } of requests) {
                request.emit('aborted');
                request.destroy();
            }
            await rm(uploadRoot, { force: true, recursive: true });
        }
    });

    it('acquires before body read and holds the lease through normal request close until response finish', async () => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-held-lease-'));
        const service = uploadService(uploadRoot, true);
        const releaseOnce = vi.fn();
        const ordering: string[] = [];
        service.uploadAdmission = {
            tryAcquire: vi.fn(() => {
                ordering.push('acquire');
                return { releaseOnce };
            }),
        };
        const form = uploadMultipart();
        const request = uploadRequestStream(form.body, form.boundary);
        const response = uploadResponseEmitter();
        const originalOn = request.on.bind(request);
        vi.spyOn(request, 'on').mockImplementation(((event: string, listener: (...args: any[]) => void) => {
            if (event === 'data') ordering.push('body-read');
            return originalOn(event, listener);
        }) as any);
        let settleNext!: () => void;
        const nextSettled = new Promise<void>(resolve => {
            settleNext = resolve;
        });
        const next = vi.fn(() => settleNext());

        try {
            service.uploadFile(request, response, next);
            request.end(form.body);
            await nextSettled;

            expect(ordering[0]).toBe('acquire');
            expect(ordering).toContain('body-read');
            expect(next).toHaveBeenCalledOnce();
            expect(releaseOnce).not.toHaveBeenCalled();
            request.emit('close');
            expect(releaseOnce).not.toHaveBeenCalled();

            response.emit('finish');
            response.emit('close');
            request.emit('aborted');
            expect(releaseOnce).toHaveBeenCalledOnce();
            expect(request.listenerCount('aborted')).toBe(0);
            expect(response.listenerCount('finish')).toBe(0);
            expect(response.listenerCount('close')).toBe(0);
        } finally {
            await rm(uploadRoot, { force: true, recursive: true });
        }
    });

    it('releases once when a Multer failure races abort and response terminal events', async () => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-multer-failure-'));
        const service = uploadService(uploadRoot, true);
        const releaseOnce = vi.fn();
        service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce })) };
        const form = uploadMultipart(false);
        const request = uploadRequestStream(form.body, form.boundary);
        const response = uploadResponseEmitter();
        let settleNext!: () => void;
        const nextSettled = new Promise<void>(resolve => {
            settleNext = resolve;
        });
        const next = vi.fn(() => settleNext());

        try {
            service.uploadFile(request, response, next);
            const finalizer = getUploadRequestFinalizer(request);
            request.end(form.body);
            await nextSettled;
            await finalizer.waitForCompletion();

            expect(next).toHaveBeenCalledOnce();
            expect(next.mock.calls[0][0]).toBeDefined();
            expect(releaseOnce).toHaveBeenCalledOnce();
            request.emit('aborted');
            response.emit('finish');
            response.emit('close');
            expect(releaseOnce).toHaveBeenCalledOnce();
        } finally {
            await rm(uploadRoot, { force: true, recursive: true });
        }
    });
});

describe('Upload request-local lifecycle guards [SI-6.6/SI-6.13/SI-6.14]', () => {
    it('keeps the first parser and file binding and returns one teardown promise with the first error', async () => {
        const request = new PassThrough();
        const firstParser = new PassThrough();
        const ignoredParser = new PassThrough();
        const firstFile = new PassThrough();
        const ignoredFile = new PassThrough();
        const firstOutput = new PassThrough();
        const ignoredOutput = new PassThrough();
        const requestUnpipe = vi.spyOn(request, 'unpipe');
        const firstFileUnpipe = vi.spyOn(firstFile, 'unpipe');
        const firstParserDestroy = vi.spyOn(firstParser, 'destroy');
        const ignoredParserDestroy = vi.spyOn(ignoredParser, 'destroy');
        const firstFileDestroy = vi.spyOn(firstFile, 'destroy');
        const ignoredFileDestroy = vi.spyOn(ignoredFile, 'destroy');
        const firstOutputDestroy = vi.spyOn(firstOutput, 'destroy');
        const ignoredOutputDestroy = vi.spyOn(ignoredOutput, 'destroy');
        const firstStorageSettlement = vi.fn();
        const ignoredStorageSettlement = vi.fn();
        const teardown = new UploadBodyReceiverTeardown(request);
        const firstError = new Error('first terminal reason');

        request.pipe(firstParser);
        firstFile.pipe(firstOutput);
        teardown.bindParser(firstParser);
        teardown.bindParser(ignoredParser);
        teardown.bindFile(firstFile, firstOutput, firstStorageSettlement);
        teardown.bindFile(ignoredFile, ignoredOutput, ignoredStorageSettlement);

        const firstCompletion = teardown.teardownOnce(firstError);
        const duplicateCompletion = teardown.teardownOnce(new Error('late terminal reason'));
        expect(duplicateCompletion).toBe(firstCompletion);
        await firstCompletion;

        expect(requestUnpipe).toHaveBeenCalledOnce();
        expect(requestUnpipe).toHaveBeenCalledWith(firstParser);
        expect(requestUnpipe.mock.invocationCallOrder[0]).toBeLessThan(firstParserDestroy.mock.invocationCallOrder[0]);
        expect(firstFileUnpipe).toHaveBeenCalledOnce();
        expect(firstFileUnpipe).toHaveBeenCalledWith(firstOutput);
        expect(firstFileUnpipe.mock.invocationCallOrder[0]).toBeLessThan(firstFileDestroy.mock.invocationCallOrder[0]);
        expect(firstParserDestroy).toHaveBeenCalledOnce();
        expect(firstFileDestroy).toHaveBeenCalledOnce();
        expect(firstOutputDestroy).toHaveBeenCalledOnce();
        expect(firstStorageSettlement).toHaveBeenCalledOnce();
        expect(firstStorageSettlement).toHaveBeenCalledWith(firstError);
        expect(ignoredParserDestroy).not.toHaveBeenCalled();
        expect(ignoredFileDestroy).not.toHaveBeenCalled();
        expect(ignoredOutputDestroy).not.toHaveBeenCalled();
        expect(ignoredStorageSettlement).not.toHaveBeenCalled();

        ignoredParser.destroy();
        ignoredFile.destroy();
        ignoredOutput.destroy();
        request.destroy();
    });

    it('does not touch absent or already-destroyed receiver resources', async () => {
        const emptyRequest = new PassThrough();
        const emptyUnpipe = vi.spyOn(emptyRequest, 'unpipe');
        await new UploadBodyReceiverTeardown(emptyRequest).teardownOnce(new Error('empty teardown'));
        expect(emptyUnpipe).not.toHaveBeenCalled();

        const request = new PassThrough();
        const parser = new PassThrough();
        const file = new PassThrough();
        const output = new PassThrough();
        request.pipe(parser);
        file.pipe(output);
        const parserDestroy = vi.spyOn(parser, 'destroy');
        const fileDestroy = vi.spyOn(file, 'destroy');
        parser.destroy();
        file.destroy();
        await Promise.all([
            new Promise<void>(resolve => parser.once('close', resolve)),
            new Promise<void>(resolve => file.once('close', resolve)),
        ]);
        const teardown = new UploadBodyReceiverTeardown(request);
        teardown.bindParser(parser);
        teardown.bindFile(file, output, vi.fn());

        await teardown.teardownOnce(new Error('already destroyed'));

        expect(parserDestroy).toHaveBeenCalledOnce();
        expect(fileDestroy).toHaveBeenCalledOnce();
        expect(output.destroyed).toBe(true);
        emptyRequest.destroy();
        request.destroy();
    });

    it('destroys the request transport at most once even when destroy does not update stream state', () => {
        const request = new PassThrough();
        const destroy = vi.spyOn(request, 'destroy').mockImplementation(() => request);
        const teardown = new UploadBodyReceiverTeardown(request);

        teardown.destroyTransportOnce();
        teardown.destroyTransportOnce();

        expect(destroy).toHaveBeenCalledOnce();
        destroy.mockRestore();
        request.destroy();

        const alreadyDestroyed = new PassThrough();
        alreadyDestroyed.destroy();
        const redundantDestroy = vi.spyOn(alreadyDestroyed, 'destroy');
        new UploadBodyReceiverTeardown(alreadyDestroyed).destroyTransportOnce();
        expect(redundantDestroy).not.toHaveBeenCalled();
    });

    it('releases synchronously when finalization has no asynchronous work', () => {
        const releaseOnce = vi.fn();
        const report = vi.fn();
        const finalizer = new UploadRequestFinalizer({ releaseOnce }, () => undefined, report);

        expect(finalizer.finishOnce('success')).toBe(true);
        expect(releaseOnce).toHaveBeenCalledOnce();
        expect(report).not.toHaveBeenCalled();
    });

    it('requests exact incoming cleanup only for a later success while preserving the first terminal decision', () => {
        const releaseOnce = vi.fn();
        const finalizer = new UploadRequestFinalizer({ releaseOnce });

        expect(finalizer.shouldCleanupIncomingAfterSuccess()).toBe(false);
        finalizer.requestIncomingCleanupAfterSuccess();
        expect(finalizer.shouldCleanupIncomingAfterSuccess()).toBe(true);
        expect(finalizer.finishOnce('success')).toBe(true);
        finalizer.requestIncomingCleanupAfterSuccess();

        expect(finalizer.shouldCleanupIncomingAfterSuccess()).toBe(true);
        expect(finalizer.finishOnce('failure')).toBe(false);
        expect(releaseOnce).toHaveBeenCalledOnce();
    });

    it('ignores a late success-cleanup request after terminal success without revisiting cleanup or the slot', () => {
        const releaseOnce = vi.fn();
        const cleanupIncoming = vi.fn();
        let finalizer: any;
        finalizer = new UploadRequestFinalizer({ releaseOnce }, (reason: string) => {
            if (reason === 'success' && finalizer.shouldCleanupIncomingAfterSuccess()) cleanupIncoming();
        });

        expect(finalizer.finishOnce('success')).toBe(true);
        finalizer.requestIncomingCleanupAfterSuccess();

        expect(finalizer.shouldCleanupIncomingAfterSuccess()).toBe(false);
        expect(finalizer.finishOnce('success')).toBe(false);
        expect(cleanupIncoming).not.toHaveBeenCalled();
        expect(releaseOnce).toHaveBeenCalledOnce();
    });

    it('reports asynchronous finalization failure before releasing and preserves the terminal result', async () => {
        const order: string[] = [];
        const failure = new Error('async finalization failed');
        const releaseOnce = vi.fn(() => {
            order.push('release');
        });
        const report = vi.fn((error: unknown) => {
            expect(error).toBe(failure);
            order.push('report');
        });
        const finalizer = new UploadRequestFinalizer({ releaseOnce }, () => Promise.reject(failure), report);

        expect(finalizer.finishOnce('failure')).toBe(true);
        expect(finalizer.isFinished()).toBe(true);
        expect(finalizer.finishOnce('success')).toBe(false);
        expect(releaseOnce).not.toHaveBeenCalled();
        await expect(finalizer.waitForCompletion()).resolves.toBeUndefined();

        expect(report).toHaveBeenCalledOnce();
        expect(releaseOnce).toHaveBeenCalledOnce();
        expect(order).toEqual(['report', 'release']);
    });

    it('absorbs synchronous finalization and reporting throws and releases exactly once', async () => {
        const failure = new Error('synchronous finalization failed');
        const reportingFailure = new Error('reporting failed');
        const releaseOnce = vi.fn();
        const report = vi.fn(() => {
            throw reportingFailure;
        });
        const finalizer = new UploadRequestFinalizer(
            { releaseOnce },
            () => {
                throw failure;
            },
            report,
        );

        expect(() => finalizer.finishOnce('failure')).not.toThrow();
        await expect(finalizer.waitForCompletion()).resolves.toBeUndefined();

        expect(report).toHaveBeenCalledOnce();
        expect(report).toHaveBeenCalledWith(failure);
        expect(releaseOnce).toHaveBeenCalledOnce();
        expect(finalizer.finishOnce('success')).toBe(false);
        expect(releaseOnce).toHaveBeenCalledOnce();
    });

    it('falls back to the default no-op onFinishError when a synchronous finalization throws and no reporter was supplied', () => {
        const failure = new Error('synchronous finalization failed with no explicit reporter');
        const releaseOnce = vi.fn();
        // No third constructor argument: reportFinishError must reach the default
        // `onFinishError = () => undefined` (UploadAdmissionController.ts:179) instead of a
        // caller-supplied reporter.
        const finalizer = new UploadRequestFinalizer({ releaseOnce }, () => {
            throw failure;
        });

        expect(() => finalizer.finishOnce('failure')).not.toThrow();
        expect(releaseOnce).toHaveBeenCalledOnce();
        expect(finalizer.isFinished()).toBe(true);
        expect(finalizer.finishOnce('success')).toBe(false);
        expect(releaseOnce).toHaveBeenCalledOnce();
    });

    it('waits for a non-Promise thenable before releasing the upload lease', async () => {
        let settle!: () => void;
        const thenable = {
            then: (resolve: () => void): void => {
                settle = resolve;
            },
        };
        const releaseOnce = vi.fn();
        const finalizer = new UploadRequestFinalizer({ releaseOnce }, () => thenable as unknown as Promise<void>);

        expect(finalizer.finishOnce('success')).toBe(true);
        expect(releaseOnce).not.toHaveBeenCalled();
        await Promise.resolve();
        expect(typeof settle).toBe('function');
        settle();
        await finalizer.waitForCompletion();

        expect(releaseOnce).toHaveBeenCalledOnce();
    });

    it('unbinds only the finalizer currently associated with the request identity', () => {
        const request = {};
        const first = new UploadRequestFinalizer({ releaseOnce: vi.fn() });
        const current = new UploadRequestFinalizer({ releaseOnce: vi.fn() });
        bindUploadRequestFinalizer(request, first);
        bindUploadRequestFinalizer(request, current);

        unbindUploadRequestFinalizer(request, first);
        expect(getUploadRequestFinalizer(request)).toBe(current);
        unbindUploadRequestFinalizer(request, current);
        expect(getUploadRequestFinalizer(request)).toBeUndefined();
    });
});

describe('Incoming upload ownership and body deadline [SI-6.7/SI-6.8/SI-6.11/SI-6.13/SI-6.14]', () => {
    it('cleans the exact incoming payload and empty token directory at most once without touching siblings', async () => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-exact-cleanup-'));
        const tokenDirectory = join(uploadRoot, 'incoming', 'owned-token');
        const payloadPath = join(tokenDirectory, 'payload');
        const otherPayload = join(uploadRoot, 'incoming', 'other-token', 'payload');
        const adoptedPayload = join(uploadRoot, 'adopted', 'owned-token', 'payload');
        await Promise.all([
            mkdir(tokenDirectory, { recursive: true }),
            mkdir(dirname(otherPayload), { recursive: true }),
            mkdir(dirname(adoptedPayload), { recursive: true }),
        ]);
        await Promise.all([
            writeFile(payloadPath, 'owned'),
            writeFile(otherPayload, 'other'),
            writeFile(adoptedPayload, 'adopted'),
        ]);
        const logger = { error: vi.fn() };
        const incoming = new IncomingUploadFile(tokenDirectory, payloadPath, logger);

        try {
            await Promise.all([incoming.cleanupOnce(), incoming.cleanupOnce(), incoming.cleanupOnce()]);

            await expect(access(payloadPath)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(access(tokenDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
            expect(await readFile(otherPayload, 'utf8')).toBe('other');
            expect(await readFile(adoptedPayload, 'utf8')).toBe('adopted');
            expect(logger.error).not.toHaveBeenCalled();

            await mkdir(tokenDirectory);
            await writeFile(payloadPath, 'replacement');
            await incoming.cleanupOnce();
            expect(await readFile(payloadPath, 'utf8')).toBe('replacement');
        } finally {
            await rm(uploadRoot, { force: true, recursive: true });
        }
    });

    it('treats missing payload as a no-op and logs cleanup failures without widening the target', async () => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-cleanup-error-'));
        const missingToken = join(uploadRoot, 'incoming', 'missing-payload');
        const blockedToken = join(uploadRoot, 'incoming', 'blocked-token');
        const blockedPayload = join(blockedToken, 'payload');
        const nested = join(blockedPayload, 'nested');
        const adoptedPayload = join(uploadRoot, 'adopted', 'blocked-token', 'payload');
        await Promise.all([
            mkdir(missingToken, { recursive: true }),
            mkdir(blockedPayload, { recursive: true }),
            mkdir(dirname(adoptedPayload), { recursive: true }),
        ]);
        await Promise.all([writeFile(nested, 'blocked'), writeFile(adoptedPayload, 'adopted')]);
        const missingLogger = { error: vi.fn() };
        const failureLogger = { error: vi.fn() };

        try {
            await new IncomingUploadFile(
                join(missingToken),
                join(missingToken, 'payload'),
                missingLogger,
            ).cleanupOnce();
            await new IncomingUploadFile(blockedToken, blockedPayload, failureLogger).cleanupOnce();

            await expect(access(missingToken)).rejects.toMatchObject({ code: 'ENOENT' });
            expect(missingLogger.error).not.toHaveBeenCalled();
            expect(await readFile(nested, 'utf8')).toBe('blocked');
            expect(await readFile(adoptedPayload, 'utf8')).toBe('adopted');
            expect(failureLogger.error).toHaveBeenCalledTimes(2);
            const payloadLogPrefix = `upload payload cleanup error: ${blockedPayload}: `;
            const tokenDirectoryLogPrefix = `upload token directory cleanup error: ${blockedToken}: `;
            expect(failureLogger.error.mock.calls[0][0].startsWith(payloadLogPrefix)).toBe(true);
            expect(failureLogger.error.mock.calls[0][0].length).toBeGreaterThan(payloadLogPrefix.length);
            expect(failureLogger.error.mock.calls[1][0].startsWith(tokenDirectoryLogPrefix)).toBe(true);
            expect(failureLogger.error.mock.calls[1][0].length).toBeGreaterThan(tokenDirectoryLogPrefix.length);
        } finally {
            await rm(uploadRoot, { force: true, recursive: true });
        }
    });

    it('starts one 300000ms whole-body timer before the receiver and does not extend it for chunks', async () => {
            // multer 2.x の内部 done() (node_modules/multer/lib/make-middleware.js) は
            // busboy のリスナー解除を setImmediate で遅延実行する。この immediate は
            // ServiceServer 自身のリソース管理や finalizer.waitForCompletion() とは無関係な
            // multer 内部の後始末であり、setImmediate まで fake にすると常に 1 件残留して
            // 見える。ここで検証したいのは ServiceServer が張る setTimeout の後始末なので、
            // setImmediate は実時間のまま進める。
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-body-deadline-'));
        const service = uploadService(uploadRoot, true);
        const releaseOnce = vi.fn();
        service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce })) };
        const form = uploadMultipart();
        const request = uploadRequestStream(form.body, form.boundary);
        const response = uploadResponseEmitter();
        const next = vi.fn();
        const on = vi.spyOn(request, 'on');
        const timer = vi.spyOn(globalThis, 'setTimeout');

        try {
            service.uploadFile(request, response, next);
            const finalizer = getUploadRequestFinalizer(request);
            const generatedTokens = await readdir(join(uploadRoot, 'incoming'));
            expect(generatedTokens).toHaveLength(1);
            const generatedToken = generatedTokens[0];
            const otherPayload = join(uploadRoot, 'incoming', 'other-request', 'payload');
            const adoptedPayload = join(uploadRoot, 'adopted', generatedToken, 'payload');
            await Promise.all([
                mkdir(dirname(otherPayload), { recursive: true }),
                mkdir(dirname(adoptedPayload), { recursive: true }),
            ]);
            await Promise.all([writeFile(otherPayload, 'other'), writeFile(adoptedPayload, 'adopted')]);

            const dataListenerIndex = on.mock.calls.findIndex(([event]) => event === 'data');
            expect(dataListenerIndex).toBeGreaterThanOrEqual(0);
            expect(service.uploadAdmission.tryAcquire.mock.invocationCallOrder[0]).toBeLessThan(
                timer.mock.invocationCallOrder[0],
            );
            expect(timer.mock.invocationCallOrder[0]).toBeLessThan(on.mock.invocationCallOrder[dataListenerIndex]);
            expect(timer).toHaveBeenCalledTimes(1);
            expect(timer.mock.calls[0][1]).toBe(300_000);
            expect(vi.getTimerCount()).toBe(1);

            request.write(form.body.subarray(0, Math.floor(form.body.length / 4)));
            await vi.advanceTimersByTimeAsync(150_000);
            request.write(form.body.subarray(Math.floor(form.body.length / 4), Math.floor(form.body.length / 2)));
            await vi.advanceTimersByTimeAsync(149_999);
            expect(releaseOnce).not.toHaveBeenCalled();
            expect(next).not.toHaveBeenCalled();
            expect(request.destroyed).toBe(false);
            expect(vi.getTimerCount()).toBe(1);

            await vi.advanceTimersByTimeAsync(1);
            await finalizer.waitForCompletion();
            expect(releaseOnce).toHaveBeenCalledOnce();
            expect(next).toHaveBeenCalledOnce();
            expect(next.mock.calls[0][0]).toBeDefined();
            expect(request.destroyed).toBe(false);
            expect(vi.getTimerCount()).toBe(0);
            await expect(access(join(uploadRoot, 'incoming', generatedToken))).rejects.toMatchObject({
                code: 'ENOENT',
            });
            expect(await readFile(otherPayload, 'utf8')).toBe('other');
            expect(await readFile(adoptedPayload, 'utf8')).toBe('adopted');
        } finally {
            request.destroy();
            await rm(uploadRoot, { force: true, recursive: true });
        }
    });

    it.each([
        ['receive-timeout', 'abort', 'response-close'],
        ['receive-timeout', 'response-close', 'abort'],
        ['abort', 'receive-timeout', 'response-close'],
        ['abort', 'response-close', 'receive-timeout'],
        ['response-close', 'receive-timeout', 'abort'],
        ['response-close', 'abort', 'receive-timeout'],
    ] as const)(
        'stops parser, file stream, and output FD before cleanup and slot reuse: %s -> %s -> %s',
        async (...signals) => {
            vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
            const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-active-file-terminal-'));
            const service = uploadService(uploadRoot, true);
            const admission = new UploadAdmissionController(1);
            let acquisitionCount = 0;
            let output: any;
            let payloadPath = '';
            const releaseStates: Array<{ readonly outputClosed: boolean; readonly payloadExists: boolean }> = [];
            service.uploadAdmission = {
                tryAcquire: () => {
                    const lease = admission.tryAcquire();
                    acquisitionCount++;
                    if (lease === null || acquisitionCount !== 1) return lease;
                    return {
                        releaseOnce: () => {
                            releaseStates.push({
                                outputClosed: output?.closed === true,
                                payloadExists: payloadPath.length > 0 && existsSync(payloadPath),
                            });
                            lease.releaseOnce();
                        },
                    };
                },
            };
            const form = uploadMultipart(false);
            const request = uploadRequestStream(form.body, form.boundary);
            request.aborted = false;
            const response = uploadResponseEmitter();
            const next = vi.fn();
            const pipe = vi.spyOn(Readable.prototype, 'pipe');
            const cleanupStates: boolean[] = [];
            const originalCleanupOnce = IncomingUploadFile.prototype.cleanupOnce;
            const cleanupOnce = vi.spyOn(IncomingUploadFile.prototype, 'cleanupOnce').mockImplementation(function (
                this: any,
            ) {
                cleanupStates.push(output?.closed === true);
                return originalCleanupOnce.call(this);
            });
            let parser: any;
            let fileStream: any;
            let parserDestroy: ReturnType<typeof vi.spyOn> | undefined;
            let fileDestroy: ReturnType<typeof vi.spyOn> | undefined;
            let outputDestroy: ReturnType<typeof vi.spyOn> | undefined;

            const trigger = (signal: (typeof signals)[number]): void => {
                if (signal === 'receive-timeout') {
                    vi.advanceTimersByTime(300_000);
                } else if (signal === 'abort') {
                    request.aborted = true;
                    request.emit('aborted');
                } else {
                    response.destroyed = true;
                    response.emit('close');
                }
            };

            try {
                service.uploadFile(request, response, next);
                const finalizer = getUploadRequestFinalizer(request);
                const generatedTokens = await readdir(join(uploadRoot, 'incoming'));
                expect(generatedTokens).toHaveLength(1);
                payloadPath = join(uploadRoot, 'incoming', generatedTokens[0], 'payload');
                const parserPipeIndex = pipe.mock.contexts.findIndex(context => context === request);
                expect(parserPipeIndex).toBeGreaterThanOrEqual(0);
                parser = pipe.mock.calls[parserPipeIndex][0];
                parserDestroy = vi.spyOn(parser, 'destroy');

                request.write(form.body);
                await waitForCondition(() =>
                    pipe.mock.calls.some((call, index) => {
                        const candidate = call[0] as any;
                        if (candidate?.path !== payloadPath || candidate.bytesWritten === 0) return false;
                        fileStream = pipe.mock.contexts[index];
                        output = candidate;
                        return true;
                    }),
                );
                fileDestroy = vi.spyOn(fileStream, 'destroy');
                outputDestroy = vi.spyOn(output, 'destroy');

                expect(output.closed).toBe(false);
                expect(typeof output.fd).toBe('number');
                expect(output.bytesWritten).toBeGreaterThan(0);

                trigger(signals[0]);
                const prematureLease = admission.tryAcquire();
                prematureLease?.releaseOnce();
                await finalizer.waitForCompletion();
                trigger(signals[1]);
                trigger(signals[2]);
                await new Promise<void>(resolve => realSetImmediate(resolve));

                expect.soft(prematureLease).toBeNull();
                /*
                 * When signals[0] === 'abort', multer 2.3.0's own `req.on('aborted', ...)` listener
                 * (node_modules/multer/lib/make-middleware.js, `handleRequestFailure`) reacts to the same
                 * 'aborted' event as ServiceServer's own `onRequestAborted` (src/model/service/
                 * ServiceServer.ts) and independently calls `busboy.destroy(err)`. Node dispatches an
                 * event to a snapshot of the listeners registered at emit time, so removing multer's
                 * listener afterward (ServiceServer's `removeUploadParserListeners`) cannot stop it from
                 * also firing for this same emission -- both listeners always run once per 'aborted'
                 * event, so `parser.destroy()` (the mocked stream method) is genuinely invoked twice, not
                 * a raw call-count regression to relax. The two calls are distinguishable by their
                 * arguments: UploadBodyReceiverTeardown.teardown calls `parser.destroy()` with no
                 * arguments, while multer's handleRequestFailure calls `busboy.destroy(err)` with an
                 * Error. Verified via instrumented run: calls are `[{argCount:0}, {argCount:1}]` in that
                 * order (ServiceServer's own `onRequestAborted` is registered before multer's, so it runs
                 * first). So instead of counting all invocations, assert ServiceServer's own
                 * (no-argument) destroy call happened exactly once -- that is what this test intends to
                 * verify (the upload's own teardown stops the parser exactly once).
                 */
                expect.soft(parserDestroy?.mock.calls.filter(call => call.length === 0)).toHaveLength(1);
                expect.soft(fileDestroy).toHaveBeenCalledOnce();
                expect.soft(outputDestroy).toHaveBeenCalledOnce();
                expect.soft(output.closed).toBe(true);
                expect.soft(output.fd).toBeNull();
                expect.soft(cleanupOnce).toHaveBeenCalledOnce();
                expect.soft(cleanupStates).toEqual([true]);
                expect.soft(releaseStates).toEqual([{ outputClosed: true, payloadExists: false }]);
                expect.soft(next).toHaveBeenCalledTimes(signals[0] === 'receive-timeout' ? 1 : 0);
                if (signals[0] === 'receive-timeout') expect.soft(next.mock.calls[0]?.[0]).toBeDefined();
                expect.soft(request.destroyed).toBe(signals[0] !== 'receive-timeout');
                expect(request.listenerCount('aborted')).toBe(0);
                expect(response.listenerCount('finish')).toBe(0);
                expect(response.listenerCount('close')).toBe(0);
                expect(vi.getTimerCount()).toBe(0);
                await expect(access(payloadPath)).rejects.toMatchObject({ code: 'ENOENT' });
                await expect(access(dirname(payloadPath))).rejects.toMatchObject({ code: 'ENOENT' });

                const replacement = admission.tryAcquire();
                expect(replacement).not.toBeNull();
                replacement?.releaseOnce();
            } finally {
                fileStream?.destroy();
                output?.destroy();
                parser?.destroy();
                request.destroy();
                await rm(uploadRoot, { force: true, recursive: true });
            }
        },
    );

    it.each(['failure', 'registration-timeout'] as const)(
        'ends the body timer before the %s finalizer seam and ignores every late terminal result',
        async reason => {
                // multer 2.x の内部 done() (node_modules/multer/lib/make-middleware.js) は
                // busboy のリスナー解除を setImmediate で遅延実行する。この immediate は
                // ServiceServer 自身のリソース管理や finalizer.waitForCompletion() とは無関係な
                // multer 内部の後始末であり、setImmediate まで fake にすると常に 1 件残留して
                // 見える。ここで検証したいのは ServiceServer が張る setTimeout の後始末なので、
                // setImmediate は実時間のまま進める。
            vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
            const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-registration-seam-'));
            const service = uploadService(uploadRoot, true);
            const releaseOnce = vi.fn();
            service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce })) };
            const form = uploadMultipart();
            const request = uploadRequestStream(form.body, form.boundary);
            const response = uploadResponseEmitter();
            let settleNext!: () => void;
            const nextSettled = new Promise<void>(resolve => {
                settleNext = resolve;
            });
            const next = vi.fn(() => settleNext());

            try {
                service.uploadFile(request, response, next);
                const finalizer = getUploadRequestFinalizer(request);
                request.end(form.body);
                await nextSettled;
                const payloadPath = request.file.path as string;
                const tokenDirectory = dirname(payloadPath);

                expect(basename(payloadPath)).toBe('payload');
                expect(dirname(tokenDirectory)).toBe(join(uploadRoot, 'incoming'));
                expect(vi.getTimerCount()).toBe(0);
                expect(releaseOnce).not.toHaveBeenCalled();
                expect(finishUploadRequest(request, reason)).toBe(true);
                expect(finishUploadRequest(request, 'success')).toBe(false);
                response.emit('finish');
                response.emit('close');
                request.emit('aborted');
                await finalizer.waitForCompletion();

                expect(next).toHaveBeenCalledOnce();
                expect(releaseOnce).toHaveBeenCalledOnce();
                await expect(access(payloadPath)).rejects.toMatchObject({ code: 'ENOENT' });
                await expect(access(tokenDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
            } finally {
                await rm(uploadRoot, { force: true, recursive: true });
            }
        },
    );

    it('uses the default failure reason while tearing down a real pending receiver', async () => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-default-failure-reason-'));
        const service = uploadService(uploadRoot, true);
        const releaseOnce = vi.fn();
        service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce })) };
        const form = uploadMultipart();
        const request = uploadRequestStream(form.body, form.boundary);
        const response = uploadResponseEmitter();
        const teardownOnce = vi.spyOn(UploadBodyReceiverTeardown.prototype, 'teardownOnce');

        try {
            service.uploadFile(request, response, vi.fn());
            const finalizer = getUploadRequestFinalizer(request);
            response.statusCode = 500;
            response.emit('finish');
            await finalizer.waitForCompletion();

            expect(teardownOnce).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ message: 'UploadTerminated:failure' }),
            );
            expect(releaseOnce).toHaveBeenCalledOnce();
            expect(await readdir(join(uploadRoot, 'incoming'))).toEqual([]);
            expect(service.log.access.error).not.toHaveBeenCalled();
        } finally {
            request.destroy();
            await rm(uploadRoot, { force: true, recursive: true });
        }
    });

    it('releases an already-aborted request without touching an absent incoming file', async () => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-preflight-abort-'));
        const service = uploadService(uploadRoot, true);
        const releaseOnce = vi.fn();
        service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce })) };
        const form = uploadMultipart();
        const request = uploadRequestStream(form.body, form.boundary);
        request.aborted = true;
        const response = uploadResponseEmitter();

        try {
            service.uploadFile(request, response, vi.fn());
            await new Promise<void>(resolve => realSetImmediate(resolve));

            expect(releaseOnce).toHaveBeenCalledOnce();
            expect(await readdir(join(uploadRoot, 'incoming'))).toEqual([]);
            expect(service.log.access.error).not.toHaveBeenCalled();
            expect(request.listenerCount('aborted')).toBe(0);
            expect(response.listenerCount('close')).toBe(0);
        } finally {
            request.destroy();
            await rm(uploadRoot, { force: true, recursive: true });
        }
    });

    it('removes only the now-empty incoming token after an adopted registration succeeds through the single finalizer', async () => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-adopted-success-finalizer-'));
        const service = uploadService(uploadRoot, true);
        const releaseOnce = vi.fn();
        service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce })) };
        const form = uploadMultipart();
        const request = uploadRequestStream(form.body, form.boundary);
        const response = uploadResponseEmitter();
        const requestUnpipe = vi.spyOn(request, 'unpipe');
        let settleNext!: () => void;
        const nextSettled = new Promise<void>(resolve => {
            settleNext = resolve;
        });
        const next = vi.fn(() => settleNext());

        try {
            service.uploadFile(request, response, next);
            const finalizer = getUploadRequestFinalizer(request);
            request.end(form.body);
            await nextSettled;
            const payloadPath = request.file.path as string;
            const tokenDirectory = dirname(payloadPath);

            finalizer.requestIncomingCleanupAfterSuccess();
            const unpipeCallsBeforeFinalization = requestUnpipe.mock.calls.length;
            expect(finishUploadRequest(request, 'success')).toBe(true);
            await finalizer.waitForCompletion();

            expect(releaseOnce).toHaveBeenCalledOnce();
            expect(requestUnpipe).toHaveBeenCalledTimes(unpipeCallsBeforeFinalization);
            expect(request.listenerCount('aborted')).toBe(0);
            expect(response.listenerCount('close')).toBe(0);
            await expect(access(payloadPath)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(access(tokenDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
            expect(next).toHaveBeenCalledOnce();
        } finally {
            request.destroy();
            await rm(uploadRoot, { force: true, recursive: true });
        }
    });
});

describe('Current Multer upload receiver [SI-6.1/SI-6.7/SI-6.15]', () => {
    it('returns the timeout error over a real partial multipart connection after exact-once cleanup and release', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-partial-http-timeout-'));
        const service = uploadService(uploadRoot, true);
        service.config.uploadReceiveTimeoutMs = 100;
        service.app = express();
        const apiDocument = loadYaml(readFileSync('api.yml', 'utf8')) as any;
        apiDocument.servers = [{ url: '/api' }];
        service.initOpenApi(apiDocument);
        const incomingDirectory = join(uploadRoot, 'incoming');
        let cleanupCompleted = 0;
        const originalCleanupOnce = IncomingUploadFile.prototype.cleanupOnce;
        const cleanupOnce = vi.spyOn(IncomingUploadFile.prototype, 'cleanupOnce').mockImplementation(async function (
            this: any,
        ) {
            await originalCleanupOnce.call(this);
            cleanupCompleted++;
        });
        const releaseStates: Array<{ readonly cleanupCompleted: number; readonly incomingEntries: number }> = [];
        const releaseOnce = vi.fn(() => {
            releaseStates.push({
                cleanupCompleted,
                incomingEntries: existsSync(incomingDirectory) ? readdirSync(incomingDirectory).length : -1,
            });
        });
        service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce })) };
        const getOwner = vi.spyOn(modelContainer, 'get');
        const server: Server = service.app.listen(0, '127.0.0.1');
        let outgoing: ReturnType<typeof httpRequest> | undefined;

        try {
            const origin = new URL(await listen(server));
            const complete = uploadMultipart();
            const closing = Buffer.from(`--${complete.boundary}--\r\n`);
            const partial = complete.body.subarray(0, complete.body.length - closing.length);
            const responsePromise = new Promise<{ body: string; contentType: string | undefined; status: number }>(
                (resolve, reject) => {
                    let settled = false;
                    const deadline = realSetTimeout(() => {
                        if (settled) return;
                        settled = true;
                        reject(new Error('PartialUploadResponseTimeout'));
                    }, 2_000);
                    outgoing = httpRequest(
                        {
                            headers: {
                                'Content-Length': String(complete.body.length),
                                'Content-Type': `multipart/form-data; boundary=${complete.boundary}`,
                            },
                            hostname: origin.hostname,
                            method: 'POST',
                            path: '/api/videos/upload',
                            port: origin.port,
                        },
                        incoming => {
                            incoming.setEncoding('utf8');
                            let body = '';
                            incoming.on('data', chunk => (body += chunk));
                            incoming.once('end', () => {
                                if (settled) return;
                                settled = true;
                                realClearTimeout(deadline);
                                resolve({
                                    body,
                                    contentType: incoming.headers['content-type'],
                                    status: incoming.statusCode ?? 0,
                                });
                            });
                        },
                    );
                    outgoing.once('error', error => {
                        if (settled) return;
                        settled = true;
                        realClearTimeout(deadline);
                        reject(error);
                    });
                    outgoing.write(partial);
                },
            );
            await waitForCondition(() => readdirSync(incomingDirectory).length === 1 && vi.getTimerCount() === 1);
            await vi.advanceTimersByTimeAsync(99);
            expect(cleanupOnce).not.toHaveBeenCalled();
            expect(releaseOnce).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            const response = await responsePromise;

            expect(response.status).toBe(400);
            expect(response.contentType).toContain('application/json');
            expect(JSON.parse(response.body)).toBe('UploadReceiveTimeout');
            expect(cleanupOnce).toHaveBeenCalledOnce();
            expect(releaseOnce).toHaveBeenCalledOnce();
            expect(releaseStates).toEqual([{ cleanupCompleted: 1, incomingEntries: 0 }]);
            expect(await readdir(incomingDirectory)).toEqual([]);
            expect(getOwner).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            outgoing?.destroy();
            if (server.listening) await close(server);
            await rm(uploadRoot, { force: true, recursive: true });
        }
    }, 10_000);

    // The 1_048_577-byte case does one real multipart POST through Multer to a temp file, and
    // measured 2.2-3.0s wall time on an otherwise-idle 16-thread host, and 5.1-11.7s when this
    // test file's worker shared the host with other CPU-bound test workers (reproduced with 40
    // busy loops pinned across 4 cores, which also reproduced the default 5000ms
    // `Test timed out in 5000ms` failure this test hits under shard contention).
    // 20_000ms keeps 1.7x margin over the worst measured contended run, 11.7s, and matches the
    // existing 20_000ms budget already used for a comparably heavier real-network test in
    // service-interface/public-contract.spec.test.ts.
    it.each([0, 1_048_577])('stores one %i-byte file in the configured temporary directory', async size => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-characterization-'));
        const service = uploadService(uploadRoot, true);
        const app = express();
        app.post(
            '/upload',
            (request, response, next) => service.uploadFile(request, response, next),
            (request, response) => response.status(200).json({ body: request.body, file: request.file }),
        );
        const server: Server = app.listen(0, '127.0.0.1');

        try {
            const origin = await listen(server);
            const form = new FormData();
            form.append('recordedId', '12');
            form.append('parentDirectoryName', 'primary');
            form.append('viewName', 'synthetic-view');
            form.append('fileType', 'ts');
            form.append('file', new Blob([Buffer.alloc(size, 0x61)]), 'synthetic.ts');

            const response = await fetch(`${origin}/upload`, { body: form, method: 'POST' });
            const result = (await response.json()) as any;

            expect(response.status).toBe(200);
            expect(result.body).toMatchObject({
                file: result.file.filename,
                fileType: 'ts',
                parentDirectoryName: 'primary',
                recordedId: 12,
                viewName: 'synthetic-view',
            });
            expect(result.file).toMatchObject({
                fieldname: 'file',
                filename: 'payload',
                originalname: 'synthetic.ts',
                path: expect.any(String),
                size,
            });
            expect(basename(dirname(result.file.path))).toMatch(/^upload-/u);
            expect(dirname(dirname(result.file.path))).toBe(join(uploadRoot, 'incoming'));
            expect(basename(result.file.path)).toBe('payload');
            expect(await readFile(result.file.path)).toEqual(Buffer.alloc(size, 0x61));
        } finally {
            if (server.listening) await close(server);
            await rm(uploadRoot, { force: true, recursive: true });
        }
    }, 20_000);

    it.each([
        ['raw-ascii', 'filename="synthetic.ts"', 'synthetic.ts'],
        ['raw-utf8-ja', 'filename="synthetic-検証.ts"', 'synthetic-検証.ts'],
        ['raw-utf8-literal', 'filename="synthetic-Ã©.ts"', 'synthetic-Ã©.ts'],
        ['extended-utf8-ja', "filename*=UTF-8''synthetic-%E6%A4%9C%E8%A8%BC.ts", 'synthetic-検証.ts'],
        ['extended-utf8-literal', "filename*=UTF-8''synthetic-%C3%83%C2%A9.ts", 'synthetic-Ã©.ts'],
        ['extended-latin1', "filename*=ISO-8859-1''synthetic-%E9.ts", 'synthetic-é.ts'],
        [
            'extended-priority',
            "filename=\"synthetic-fallback.ts\"; filename*=UTF-8''synthetic-%E6%A4%9C%E8%A8%BC.ts",
            'synthetic-検証.ts',
        ],
    ] as const)('[SI-6.19] preserves %s filename through real HTTP and Multer', async (_case, disposition, expectedName) => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-filename-'));
        let server: Server | undefined;
        let outgoing: ReturnType<typeof httpRequest> | undefined;
        let incoming: any;
        let finalizer: any;
        const settleFinalizer = async (): Promise<void> => {
            if (finalizer === undefined) return;
            let watchdog: ReturnType<typeof realSetTimeout> | undefined;
            try {
                await Promise.race([
                    finalizer.waitForCompletion(),
                    new Promise<never>((_resolve, reject) => {
                        watchdog = realSetTimeout(() => reject(new Error('UploadFinalizerTimeout')), 3_000);
                    }),
                ]);
            } finally {
                realClearTimeout(watchdog);
            }
        };

        try {
            const service = uploadService(uploadRoot, true);
            const app = express();
            app.post(
                '/upload',
                (request, response, next) => {
                    incoming = request;
                    service.uploadFile(request, response, next);
                    finalizer = getUploadRequestFinalizer(request);
                },
                (request, response) => response.status(200).json({ body: request.body, file: request.file }),
            );
            server = app.listen(0, '127.0.0.1');
            const origin = new URL(await listen(server));
            const boundary = 'synthetic-upload-filename-boundary';
            const payload = Buffer.from('synthetic-upload-payload');
            const body = Buffer.concat([
                Buffer.from(
                    `--${boundary}\r\nContent-Disposition: form-data; name="recordedId"\r\n\r\n12\r\n` +
                        `--${boundary}\r\nContent-Disposition: form-data; name="parentDirectoryName"\r\n\r\nprimary\r\n` +
                        `--${boundary}\r\nContent-Disposition: form-data; name="viewName"\r\n\r\nsynthetic-view\r\n` +
                        `--${boundary}\r\nContent-Disposition: form-data; name="fileType"\r\n\r\nts\r\n` +
                        `--${boundary}\r\nContent-Disposition: form-data; name="file"; ${disposition}\r\n` +
                        'Content-Type: application/octet-stream\r\n\r\n',
                    'utf8',
                ),
                payload,
                Buffer.from(`\r\n--${boundary}--\r\n`),
            ]);
            const result = await new Promise<{ status: number | undefined; body: any }>((resolve, reject) => {
                outgoing = httpRequest(
                    {
                        hostname: origin.hostname,
                        port: origin.port,
                        path: '/upload',
                        method: 'POST',
                        headers: {
                            'Content-Type': `multipart/form-data; boundary=${boundary}`,
                            'Content-Length': body.byteLength,
                        },
                    },
                    response => {
                        const chunks: Buffer[] = [];
                        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
                        response.once('error', reject);
                        response.once('end', () => {
                            try {
                                resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) });
                            } catch (error) {
                                reject(error);
                            }
                        });
                    },
                );
                outgoing.once('error', reject);
                outgoing.setTimeout(3_000, () => outgoing?.destroy(new Error('UploadHTTPTimeout')));
                outgoing.end(body);
            });

            expect(result.status).toBe(200);
            expect(result.body.body).toMatchObject({ recordedId: 12, parentDirectoryName: 'primary', viewName: 'synthetic-view', fileType: 'ts' });
            expect(result.body.file).toMatchObject({ fieldname: 'file', originalname: expectedName, filename: 'payload', size: payload.byteLength });
            expect(dirname(dirname(result.body.file.path))).toBe(join(uploadRoot, 'incoming'));
            expect(await readFile(result.body.file.path)).toEqual(payload);
            expect(finalizer).toBeDefined();
            await settleFinalizer();
            expect(finalizer.isFinished()).toBe(true);

            const leases = Array.from({ length: 3 }, () => service.uploadAdmission.tryAcquire());
            try {
                expect(leases.every(lease => lease !== null)).toBe(true);
                expect(service.uploadAdmission.tryAcquire()).toBeNull();
            } finally {
                for (const lease of leases) lease?.releaseOnce();
            }
        } finally {
            outgoing?.destroy();
            try {
                if (finalizer !== undefined && !finalizer.isFinished()) finishUploadRequest(incoming, 'abort');
                await settleFinalizer();
            } finally {
                try {
                    if (server !== undefined) {
                        server.closeAllConnections();
                        if (server.listening) await close(server);
                    }
                } finally {
                    await rm(uploadRoot, { force: true, recursive: true });
                }
            }
        }
    }, 10_000);

    it('configures one file receiver without file-size or aggregate-byte limits', async () => {
        const uploadConfigurationKeys = Object.keys(formatConfiguration())
            .filter(key => key.toLowerCase().includes('upload'))
            .sort();
        const receiveBody = vi.fn();
        const single = vi.fn(() => receiveBody);
        const multerFactory = vi.fn(() => ({ single }));
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-upload-options-'));
        const request = uploadRequestStream(Buffer.alloc(0), uploadMultipart().boundary);
        const response = uploadResponseEmitter();

        currentMulter = multerFactory;
        try {
            const service = uploadService(uploadRoot, true);
            const finalizerRelease = vi.fn();
            service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce: finalizerRelease })) };

            service.uploadFile(request, response, vi.fn());

            expect(uploadConfigurationKeys).toEqual(['concurrentUploadNum', 'uploadReceiveTimeoutMs', 'uploadTempDir']);
            expect(multerFactory).toHaveBeenCalledOnce();
            expect(Object.keys(multerFactory.mock.calls[0][0])).toEqual(['storage', 'defParamCharset']);
            expect(multerFactory.mock.calls[0][0].defParamCharset).toBe('utf8');
            expect(multerFactory.mock.calls[0][0]).not.toHaveProperty('limits');
            expect(single).toHaveBeenCalledExactlyOnceWith('file');
            expect(receiveBody).toHaveBeenCalledOnce();

            const finalizer = getUploadRequestFinalizer(request);
            expect(finishUploadRequest(request, 'abort')).toBe(true);
            await finalizer.waitForCompletion();
            expect(finalizerRelease).toHaveBeenCalledOnce();
        } finally {
            currentMulter = undefined;
            await rm(uploadRoot, { force: true, recursive: true });
        }
    });
});

describe('Current uploaded-file IPC deadline [SI-6.9/SI-6.11]', () => {
    it('times out at exactly ten minutes, ignores a late result, and sends no cancellation', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        const option = {
            fileName: 'synthetic.ts',
            filePath: 'synthetic-upload-path',
            fileType: 'ts',
            parentDirectoryName: 'primary',
            recordedId: 12,
            viewName: 'synthetic-view',
        };

        try {
            const pending = harness.client.recorded.addUploadedVideoFile(option) as Promise<void>;
            const settlement = vi.fn();
            void pending.then(
                value => settlement({ kind: 'fulfilled', value }),
                error => settlement({ error, kind: 'rejected' }),
            );
            await flushNextTick();

            expect(harness.send).toHaveBeenCalledOnce();
            const message = harness.send.mock.calls[0][0];
            expect(message).toEqual({
                args: { option },
                func: 'addUploadedVideoFile',
                id: 1,
                model: 'recorded',
            });
            expect(vi.getTimerCount()).toBe(1);

            await vi.advanceTimersByTimeAsync(599_999);
            expect(settlement).not.toHaveBeenCalled();
            expect(harness.send).toHaveBeenCalledOnce();

            await vi.advanceTimersByTimeAsync(1);
            expect(settlement).toHaveBeenCalledOnce();
            expect(settlement.mock.calls[0][0]).toMatchObject({
                error: expect.objectContaining({ message: 'IPCTimeout' }),
                kind: 'rejected',
            });
            expect(vi.getTimerCount()).toBe(0);

            await harness.receive({ id: message.id, result: undefined });
            await Promise.resolve();
            expect(settlement).toHaveBeenCalledOnce();
            expect(harness.send).toHaveBeenCalledOnce();
        } finally {
            harness.cleanup();
        }
    });
});
