// Must stay the very first import in this file: it registers a Node loader hook that has to be in
// place before anything (including the `../fixtures/listener-matrix` import below) can trigger
// `api.js` being loaded for the first time. See the comment in that file for why.
import { resetTestCreateReadStream, setTestCreateReadStream } from './fs-create-read-stream-hook';
import express from 'express';
import { Container } from 'inversify';
import { EventEmitter, once } from 'node:events';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import {
    copyFile,
    link,
    lstat,
    mkdir,
    mkdtemp,
    open,
    readFile,
    readdir,
    realpath,
    rename,
    rm,
    rmdir,
    stat,
    unlink,
    writeFile,
} from 'node:fs/promises';
import {
    createServer as createHttpServer,
    request as httpRequest,
    type IncomingHttpHeaders,
    type Server,
} from 'node:http';
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { close, compiled, compiledSnapshot, listen, modelContainer, require } from '../_harness';
import {
    allRouteCases,
    streamRouteCases,
    type RequestFixture,
    type RouteContractCase,
    type StreamRouteCase,
} from '../route-contracts';
import {
    assertApplicationSurfaces,
    connectPollingSocketIoClient,
    exchange as listenerExchange,
    listenerMatrixCases,
    originOf,
    startListenerFixture,
    startPublicSurfaceFixture,
} from '../fixtures/listener-matrix';

/*
 * この file の module 冒頭は `../fixtures/listener-matrix` を静的 import しており (下の import 文)、
 * ES module の評価順序上、fixtures 側の top-level `await loadServiceServer()` (vi.doMock('https', ...) +
 * `await import(ServiceServer.js)`) が、この file 自身の module 本体より必ず先に完走する。そのため
 * ServiceServer.js は fixtures 側の import で既に vitest の module registry へ確定済みで、この file の
 * 冒頭で `vi.doMock('fs' / 'multer', ...)` を後から登録しても、同じ絶対 path を再度 `import()` した際に
 * 返るのは fixtures が読み込んだ「差し替え前」の cached instance であり、doMock の factory は一度も
 * 呼ばれない (実測で確認済み: factory 内の console.log が全く出力されない)。`vi.resetModules()` で
 * 強制的に再読込みすることもできるが、それは vitest の module registry 全体を無効化し、fixtures 側が
 * 保持している ServiceServer 参照 (socket.io / listener matrix 系 test が使う) と、この file が
 * `express-openapi` (`initOpenApi` の `paths: ServiceServer.API_DIR`) 経由で実行時に internal
 * `require()` する handler file (例: `model/service/api/videos/*.js`、`UploadAdmissionController.js`) の
 * module 実体が食い違う原因になる (実測: `getUploadRequestFinalizer` の WeakMap が一致せず、
 * `videos/upload.ts` の `finalizer?.requestIncomingCleanupAfterSuccess()` が no-op になって incoming の
 * token directory が cleanup されず 3 件の既存合格 test が新規に壊れることを確認した)。
 *
 * `express-openapi` が `paths` directory から load する handler file (video streaming route の
 * `fs.createReadStream` を含む) は、この file や vitest の module runner を経由しない、
 * ライブラリ内部の生の `require()` で読み込まれる。vitest の mock hook は「vite-node が変換した
 * import/require 呼び出し」だけを差し替える仕組みのため、library 内部の生 require はそもそも横取り
 * できない。したがってこの file が module-level で共有する `ServiceServer` / `UploadAdmissionController`
 * については、in-process の `vi.doMock` + 動的 import 技法を適用しない (適用しても効果がなく、かつ
 * 上記の identity 分裂で他の合格 test を壊す)。
 *
 * 'fs' の再解釈が必要な少数の test (`api/version.js` の直接 route 登録、および startup 時の
 * `readdirSync`/`unlinkSync`/`rmdirSync` を検証する 1 test) は、shared module graph に触れない
 * *test 内 local* な doMock + `vi.resetModules()` + 動的 import で個別に対応する
 * (`captureServiceServerWithFsOverrides` 参照)。
 */
const ServiceServer = (require(compiled('model', 'service', 'ServiceServer.js')) as any).default;
const containerSetter = require(compiled('model', 'ModelContainerSetter.js')) as { set(container: Container): void };
const uploadLifecycle = require(compiled('model', 'service', 'upload', 'UploadAdmissionController.js')) as any;
const UploadAdmissionController = uploadLifecycle.default;
const UploadBodyReceiverTeardown = uploadLifecycle.UploadBodyReceiverTeardown;
const IPCClient = (require(compiled('model', 'ipc', 'IPCClient.js')) as any).default;
const IPCServer = (require(compiled('model', 'ipc', 'IPCServer.js')) as any).default;
const RecordedUploadAdoptionModel = (
    require(compiled('model', 'operator', 'recorded', 'RecordedUploadAdoptionModel.js')) as any
).default;
const RecordedManageModel = (require(compiled('model', 'operator', 'recorded', 'RecordedManageModel.js')) as any)
    .default;
const mutableFileSystem = require('node:fs') as {
    readFileSync(path: unknown, options?: unknown): unknown;
    readdirSync(path: string, options?: unknown): unknown;
    rmdirSync(path: string): void;
    unlinkSync(path: string): void;
};

/*
 * 上のコメントのとおり、"module-level で共有する" ServiceServer には fs の doMock は使えない。ここは
 * それとは別に、"この 1 test の中だけで新しく作る" 専用の ServiceServer インスタンス用の局所 capture。
 * `vi.doMock('fs'/'node:fs', ...)` + `vi.resetModules()` + 動的 `import()` で fs 差し替え可能な
 * ServiceServer/UploadAdmissionController を都度読み直す (service-server-mutation-oracles.test.ts の
 * useCapturedMulter と同じ技法)。呼び出し側は戻り値の ServiceServer だけを使い、shared な
 * `origin`/`server` や `createOpenApiService()` の中では絶対に使わない。
 */
const captureServiceServerWithFsOverrides = async <T>(
    overrides: Record<string, (...args: any[]) => any>,
    run: (CapturedServiceServer: any) => Promise<T>,
): Promise<T> => {
    const actual = require('node:fs') as Record<string, any>;
    const proxy = new Proxy(actual, {
        get(target, prop, receiver) {
            if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(overrides, prop)) {
                return overrides[prop];
            }
            return Reflect.get(target, prop, receiver);
        },
    });
    vi.doMock('fs', () => proxy);
    vi.doMock('node:fs', () => proxy);
    try {
        vi.resetModules();
        const CapturedServiceServer = ((await import(compiled('model', 'service', 'ServiceServer.js'))) as any)
            .default;
        return await run(CapturedServiceServer);
    } finally {
        vi.doUnmock('fs');
        vi.doUnmock('node:fs');
        vi.resetModules();
    }
};
const loopbackHost = '127.0.0.1';
const originalApiYml = ServiceServer.API_YML;
const originalPackageJson = ServiceServer.PACKAGE_JSON;
const rangeResourceFile = 'test/server/.artifacts/service-interface-response-content/range-eight-bytes.bin';
const resourceFile = 'test/server/.artifacts/service-interface-response-content/synthetic-resource.bin';

interface WireRequest {
    readonly body?: Buffer;
    readonly headers: Record<string, string>;
    readonly method: string;
    readonly path: string;
}

interface WireResponse {
    readonly body: Buffer;
    readonly headers: IncomingHttpHeaders;
    readonly status: number;
}

interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T): void;
}

interface UploadIpcHarnessOptions {
    readonly adoption?: any;
    readonly beforeParentRequest?: (message: any) => void;
    readonly domain?: { readonly addUploadedVideoFile: ReturnType<typeof vi.fn> };
    readonly onParentReply?: (
        message: any,
        deliver: (message: any, callback?: (error: Error | null) => void) => void,
        callback?: (error: Error | null) => void,
    ) => void;
    readonly onRequestSent?: (message: any, callback: (error: Error | null) => void) => void;
}

interface UploadIpcHarness {
    readonly childRequests: ReturnType<typeof vi.fn>;
    readonly client: any;
    readonly domain: { readonly addUploadedVideoFile: ReturnType<typeof vi.fn> };
    readonly parent: any;
    readonly parentReplies: ReturnType<typeof vi.fn>;
    readonly socketNotification: ReturnType<typeof vi.fn>;
    cleanup(): void;
}

let origin = '';
let server: Server;
let temporaryRoot = '';
let uploadRoot = '';
const ephemeralServers: Server[] = [];

const copy = <T>(value: T): T => structuredClone(value);

const deferred = <T>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

const createRecordedUseContainer = (): Container => {
    const container = new Container();
    containerSetter.set(container);
    container.rebind('ILoggerModel').toConstantValue({
        getLogger: () => ({
            encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            system: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
        }),
    });
    container.rebind('IConfiguration').toConstantValue({
        getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 1 }),
    });
    container.rebind('IExecutionManagementModel').toConstantValue({
        getExecution: vi.fn(async () => 1),
        unLockExecution: vi.fn(),
    });
    container.rebind('EncoderModelProvider').toConstantValue(async () => {
        throw new Error('synthetic encoder construction failure');
    });
    container.rebind('IEncodeEvent').toConstantValue({ emitAddEncode: vi.fn() });
    container
        .rebind('ISocketIOManageModel')
        .toConstantValue({ notifyClient: vi.fn(), notifyUpdateEncodeProgress: vi.fn() });
    return container;
};

const recordedUseEncodeOption = {
    mode: 'synthetic-mode',
    parentDir: 'synthetic-parent',
    recordedId: 71,
    removeOriginal: false,
    sourceVideoFileId: 72,
};

const uploadContract = allRouteCases.find(candidate => candidate.file === 'videos/upload');

if (uploadContract === undefined) throw new Error('Missing upload route contract');

const createUploadIpcHarness = async (options: UploadIpcHarnessOptions = {}): Promise<UploadIpcHarness> => {
    const processSendDescriptor = Object.getOwnPropertyDescriptor(process, 'send');
    const existingMessageListeners = new Set(process.listeners('message'));
    const child = new EventEmitter() as EventEmitter & Record<string, any>;
    child.connected = true;
    const domain = options.domain ?? { addUploadedVideoFile: vi.fn(async () => undefined) };
    const unused = {};
    const parent = new IPCServer(
        unused,
        domain,
        unused,
        unused,
        unused,
        unused,
        { getLogger: () => ({ system: { error: vi.fn() } }) },
        options.adoption ?? new RecordedUploadAdoptionModel(uploadRoot),
    );
    const socketNotification = vi.fn();
    const client = new IPCClient(
        { getLogger: () => ({ system: { error: vi.fn() } }) },
        { notifyClient: socketNotification },
        { push: vi.fn() },
    );
    const clientMessageListeners = process
        .listeners('message')
        .filter(listener => !existingMessageListeners.has(listener));
    const deliver = (message: any, callback?: (error: Error | null) => void): void => {
        void Promise.all(clientMessageListeners.map(listener => listener(message))).then(
            () => callback?.(null),
            error => callback?.(error instanceof Error ? error : new Error(String(error))),
        );
    };
    const parentReplies = vi.fn((message: any, callback?: (error: Error | null) => void) => {
        if (options.onParentReply === undefined) {
            deliver(message, callback);
        } else {
            options.onParentReply(message, deliver, callback);
        }
    });
    child.send = parentReplies;
    const childRequests = vi.fn((message: any, callback: (error: Error | null) => void) => {
        options.beforeParentRequest?.(message);
        child.emit('message', message);
        if (options.onRequestSent === undefined) callback(null);
        else options.onRequestSent(message, callback);
        return true;
    });
    Object.defineProperty(process, 'send', { configurable: true, value: childRequests, writable: true });
    parent.register(child as any);
    await parent.initialize();

    return {
        childRequests,
        client,
        domain,
        parent,
        parentReplies,
        socketNotification,
        cleanup: () => {
            child.emit('disconnect');
            for (const listener of process.listeners('message')) {
                if (!existingMessageListeners.has(listener)) process.removeListener('message', listener);
            }
            if (processSendDescriptor === undefined) delete (process as { send?: unknown }).send;
            else Object.defineProperty(process, 'send', processSendDescriptor);
        },
    };
};

const materializeOwnerResult = (value: unknown): unknown => {
    if (value === '$fixture') return resourceFile;
    if (typeof value === 'object' && value !== null && 'path' in value && value.path === '$fixture') {
        return { ...value, path: resourceFile };
    }
    return value;
};

const requestPath = (file: string, request: RequestFixture): string => {
    const path = file.replace(/\{([^}]+)\}/gu, (_match, name: string) => {
        const value = request.params?.[name];
        if (value === undefined) throw new Error(`Missing path fixture ${name} for ${file}`);
        return encodeURIComponent(value);
    });
    const target = new URL(`/api/${path}`, 'http://synthetic.invalid');
    for (const [name, raw] of Object.entries(request.query ?? {})) {
        for (const value of Array.isArray(raw) ? raw : [raw]) {
            if (value !== undefined) target.searchParams.append(name, String(value));
        }
    }
    return `${target.pathname}${target.search}`;
};

const routePath = (contract: RouteContractCase): string => requestPath(contract.file, contract.request);

const createOpenApiService = (subDirectory?: string, accessLogger?: Record<string, unknown>): any => {
    const service = Object.create(ServiceServer.prototype) as any;
    service.app = express();
    service.config = {
        apiServers: ['http://synthetic.invalid'],
        concurrentUploadNum: 3,
        subDirectory,
        uploadReceiveTimeoutMs: 300_000,
        uploadTempDir: uploadRoot,
    };
    service.log = {
        access: accessLogger ?? { error: vi.fn(), info: vi.fn() },
        system: { error: vi.fn(), info: vi.fn() },
    };
    service.uploadAdmission = new UploadAdmissionController(service.config.concurrentUploadNum);
    if (accessLogger !== undefined) service.setLog();
    service.createUploadDir();
    const document = service.getApiDocument(ServiceServer.API_YML);
    /*
     * ServiceServer の実 constructor (src/model/service/ServiceServer.ts の init()) は
     * holdParsedQuery() を initOpenApi() の直前に呼ぶ。Express 5 の req.query は参照するたびに
     * 生の query 文字列を解釈し直すため、この middleware が無いと OpenAPI 層が書き換えた値
     * (整数・真偽値への型変換) が次の参照へ残らず、該当する query parameter を持つ route が
     * すべて 400 になる。ここは Object.create(ServiceServer.prototype) で constructor を経由せず
     * 手動で初期化しているため、実 constructor と同じ呼び出しをテスト側でも再現する。
     */
    service.holdParsedQuery();
    service.initOpenApi(document);
    return service;
};

const listenWithProtocol = async (listener: Server, protocol: 'http' | 'https'): Promise<string> => {
    listener.listen(0, loopbackHost);
    await once(listener, 'listening');
    const address = listener.address();
    if (address === null || typeof address === 'string') throw new Error('HTTP fixture did not bind TCP');
    return `${protocol}://${loopbackHost}:${address.port}`;
};

const multipart = (request: RequestFixture): { readonly body: Buffer; readonly contentType: string } => {
    const boundary = 'epgstation-service-interface-synthetic-boundary';
    const parts: Buffer[] = [];
    for (const [name, value] of Object.entries(request.body ?? {})) {
        parts.push(
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(value)}\r\n`),
        );
    }
    if (request.file !== undefined) {
        parts.push(
            Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${String(
                    request.file.originalname,
                )}"\r\nContent-Type: application/octet-stream\r\n\r\nsynthetic-upload\r\n`,
            ),
        );
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
};

const wireRequest = (contract: RouteContractCase): WireRequest => {
    const method = contract.method === 'del' ? 'DELETE' : contract.method.toUpperCase();
    const headers = Object.fromEntries(
        Object.entries(contract.request.headers ?? {}).map(([name, value]) => [name, String(value)]),
    );
    if (contract.request.file !== undefined) {
        const form = multipart(contract.request);
        return {
            body: form.body,
            headers: {
                ...headers,
                'Content-Length': String(form.body.length),
                'Content-Type': form.contentType,
            },
            method,
            path: routePath(contract),
        };
    }
    if (contract.request.body === undefined) return { headers, method, path: routePath(contract) };
    const body = Buffer.from(JSON.stringify(contract.request.body));
    return {
        body,
        headers: {
            ...headers,
            'Content-Length': String(body.length),
            'Content-Type': 'application/json',
        },
        method,
        path: routePath(contract),
    };
};

const exchange = (base: string, outgoing: WireRequest): Promise<WireResponse> =>
    new Promise((resolve, reject) => {
        const target = new URL(base);
        const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
        const request = transport(
            {
                headers: outgoing.headers,
                hostname: target.hostname,
                method: outgoing.method,
                path: outgoing.path,
                port: target.port,
                rejectUnauthorized: false,
            },
            response => {
                const chunks: Buffer[] = [];
                response.on('data', chunk => chunks.push(Buffer.from(chunk)));
                response.once('error', reject);
                response.once('end', () =>
                    resolve({
                        body: Buffer.concat(chunks),
                        headers: response.headers,
                        status: response.statusCode ?? 0,
                    }),
                );
            },
        );
        request.once('error', reject);
        if (outgoing.body !== undefined) request.write(outgoing.body);
        request.end();
    });

const rawExchange = (base: string, outgoing: WireRequest): Promise<WireResponse> =>
    new Promise((resolve, reject) => {
        const target = new URL(base);
        const chunks: Buffer[] = [];
        const socket = createConnection({ host: target.hostname, port: Number(target.port) });
        socket.once('connect', () => {
            const headers = Object.entries(outgoing.headers).map(([name, value]) => `${name}: ${value}`);
            const head = Buffer.from(
                [
                    `${outgoing.method} ${outgoing.path} HTTP/1.1`,
                    `Host: ${target.host}`,
                    'Connection: close',
                    ...headers,
                ]
                    .concat('', '')
                    .join('\r\n'),
            );
            socket.write(outgoing.body === undefined ? head : Buffer.concat([head, outgoing.body]));
        });
        socket.on('data', chunk => chunks.push(Buffer.from(chunk)));
        socket.once('error', reject);
        socket.once('close', () => {
            const wire = Buffer.concat(chunks);
            const separator = wire.indexOf('\r\n\r\n');
            if (separator === -1) return reject(new Error('Raw HTTP response did not contain a header terminator'));
            const [statusLine, ...headerLines] = wire.subarray(0, separator).toString('latin1').split('\r\n');
            const status = Number(statusLine.match(/^HTTP\/1\.1 (?<status>\d{3})/u)?.groups?.status ?? 0);
            const responseHeaders: IncomingHttpHeaders = {};
            for (const line of headerLines) {
                const colon = line.indexOf(':');
                if (colon === -1) continue;
                responseHeaders[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
            }
            resolve({ body: wire.subarray(separator + 4), headers: responseHeaders, status });
        });
    });

const expectContentType = (response: WireResponse, expected: string): void => {
    expect(response.headers['content-type']?.toLowerCase()).toContain(expected.toLowerCase());
};

interface RangeCase {
    readonly body: string;
    readonly contentLength?: string;
    readonly contentRange?: string;
    readonly createReadStreamCount: number;
    readonly name: string;
    readonly range?: string;
    readonly releaseCount: number;
    readonly status: number;
}

const serverErrorBody = (errors: string): string =>
    JSON.stringify({ code: 500, message: 'Internal Server Error', errors });
const oversizedSuffixBody = serverErrorBody(
    'The value of "start" is out of range. It must be >= 0 && <= 9007199254740991. Received -1',
);
const reversedRangeBody = serverErrorBody(
    'The value of "start" is out of range. It must be <= "end" (here: 3). Received 5',
);

const rangeCases: readonly RangeCase[] = [
    {
        body: '01234567',
        contentLength: '8',
        createReadStreamCount: 1,
        name: 'range-absent',
        releaseCount: 1,
        status: 200,
    },
    {
        body: '01234567',
        contentLength: '8',
        createReadStreamCount: 1,
        name: 'range-empty',
        range: '',
        releaseCount: 1,
        status: 200,
    },
    {
        body: '2345',
        contentLength: '4',
        contentRange: 'bytes 2-5/8',
        createReadStreamCount: 1,
        name: 'range-normal-closed',
        range: 'bytes=2-5',
        releaseCount: 1,
        status: 206,
    },
    {
        body: '34567',
        contentLength: '5',
        contentRange: 'bytes 3-7/8',
        createReadStreamCount: 1,
        name: 'range-open-ended',
        range: 'bytes=3-',
        releaseCount: 1,
        status: 206,
    },
    {
        body: '567',
        contentLength: '3',
        contentRange: 'bytes 5-7/8',
        createReadStreamCount: 1,
        name: 'range-suffix',
        range: 'bytes=-3',
        releaseCount: 1,
        status: 206,
    },
    {
        body: oversizedSuffixBody,
        contentLength: String(Buffer.byteLength(oversizedSuffixBody)),
        createReadStreamCount: 1,
        name: 'range-oversized-suffix',
        range: 'bytes=-9',
        releaseCount: 0,
        status: 500,
    },
    {
        body: '3',
        contentLength: '1',
        contentRange: 'bytes 3-3/8',
        createReadStreamCount: 1,
        name: 'range-start-equals-end',
        range: 'bytes=3-3',
        releaseCount: 1,
        status: 206,
    },
    {
        body: reversedRangeBody,
        contentLength: String(Buffer.byteLength(reversedRangeBody)),
        createReadStreamCount: 1,
        name: 'range-start-greater-than-end',
        range: 'bytes=5-3',
        releaseCount: 0,
        status: 500,
    },
    {
        body: '',
        contentLength: '0',
        contentRange: 'bytes */8',
        createReadStreamCount: 0,
        name: 'range-start-equals-file-size',
        range: 'bytes=8-',
        releaseCount: 0,
        status: 416,
    },
    {
        body: '',
        contentLength: '0',
        contentRange: 'bytes */8',
        createReadStreamCount: 0,
        name: 'range-end-equals-file-size',
        range: 'bytes=2-8',
        releaseCount: 0,
        status: 416,
    },
    {
        body: '01234567',
        contentLength: '8',
        contentRange: 'bytes 0-7/8',
        createReadStreamCount: 1,
        name: 'range-malformed',
        range: 'bytes=abc-def',
        releaseCount: 1,
        status: 206,
    },
    {
        body: '01',
        contentLength: '2',
        contentRange: 'bytes 0-1/8',
        createReadStreamCount: 1,
        name: 'range-multiple',
        range: 'bytes=0-1,4-5',
        releaseCount: 1,
        status: 206,
    },
] as const;

beforeAll(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-interface-real-app-'));
    uploadRoot = join(temporaryRoot, 'uploads');
    await mkdir(uploadRoot);
    await mkdir(dirname(resourceFile), { recursive: true });
    await writeFile(resourceFile, 'synthetic-resource');
    await writeFile(rangeResourceFile, '01234567');

    ServiceServer.API_YML = join(process.cwd(), 'api.yml');
    ServiceServer.PACKAGE_JSON = join(process.cwd(), 'package.json');
    const service = createOpenApiService();
    server = service.app.listen(0, loopbackHost);
    origin = await listen(server);
});

afterEach(async () => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetTestCreateReadStream();
    await Promise.all(ephemeralServers.splice(0).map(listener => (listener.listening ? close(listener) : undefined)));
});

afterAll(async () => {
    if (server?.listening === true) await close(server);
    await rm(temporaryRoot, { force: true, recursive: true });
    await rm(dirname(resourceFile), { force: true, recursive: true });
    ServiceServer.API_YML = originalApiYml;
    ServiceServer.PACKAGE_JSON = originalPackageJson;
});

describe('Service Interface formal real OpenAPI carrier [SI-2.1/SI-2.2/SI-2.3]', () => {
    it('starts only after creating same-filesystem incoming and adopted upload namespaces', async () => {
        const [incoming, adopted] = await Promise.all([
            stat(join(uploadRoot, 'incoming')),
            stat(join(uploadRoot, 'adopted')),
        ]);

        expect(incoming.isDirectory()).toBe(true);
        expect(adopted.isDirectory()).toBe(true);
        expect(incoming.dev).toBe(adopted.dev);
    });

    it('makes startup incoming cleanup and an old parent rename converge in both winner orders without touching adopted', {
        // two real-filesystem winner orders with 2 s polls each; exceeds the 5 s default under CI load
        timeout: 30_000,
    }, async () => {
        for (const winner of ['startup-cleanup', 'parent-rename'] as const) {
            const rawRenameEntered = deferred<void>();
            const releaseRawRename = deferred<void>();
            const releaseDomain = deferred<void>();
            let rawRenameFailure: unknown;
            const rawRename = vi.fn(async (source: string, destination: string) => {
                rawRenameEntered.resolve();
                if (winner === 'startup-cleanup') await releaseRawRename.promise;
                try {
                    await rename(source, destination);
                } catch (error) {
                    rawRenameFailure = error;
                    throw error;
                }
            });
            const sourceRead = vi.fn();
            const domain = {
                addUploadedVideoFile: vi.fn(async (option: { readonly filePath: string }) => {
                    sourceRead();
                    await readFile(option.filePath);
                    if (winner === 'parent-rename') await releaseDomain.promise;
                }),
            };
            const adoption = new RecordedUploadAdoptionModel(uploadRoot, { rename: rawRename });
            const harness = await createUploadIpcHarness({ adoption, domain });
            const oldService = createOpenApiService();
            const oldListener = oldService.app.listen(0, loopbackHost);
            ephemeralServers.push(oldListener);
            const oldOrigin = await listen(oldListener);
            const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue(harness.client);
            const response = exchange(oldOrigin, wireRequest(uploadContract));
            const cleanupSpies: Array<{ mockRestore(): void }> = [];

            try {
                await rawRenameEntered.promise;
                const [incomingPayload, adoptedPayload] = rawRename.mock.calls[0] as [string, string];
                const incomingRoot = join(uploadRoot, 'incoming');
                const adoptedRoot = join(uploadRoot, 'adopted');
                const incomingToken = dirname(incomingPayload);

                if (winner === 'parent-rename') {
                    releaseRawRename.resolve();
                    await vi.waitFor(() => expect(domain.addUploadedVideoFile).toHaveBeenCalledOnce());
                }

                const readdirSync = vi.fn((...args: any[]) => (require('node:fs') as any).readdirSync(...args));
                const unlinkSync = vi.fn((...args: any[]) => (require('node:fs') as any).unlinkSync(...args));
                const rmdirSync = vi.fn((...args: any[]) => (require('node:fs') as any).rmdirSync(...args));
                cleanupSpies.push(readdirSync, unlinkSync, rmdirSync);
                const restartSocket = { initialize: vi.fn() };
                const restartedChild = await captureServiceServerWithFsOverrides(
                    { readdirSync, rmdirSync, unlinkSync },
                    async CapturedServiceServer => {
                        CapturedServiceServer.API_YML = join(process.cwd(), 'api.yml');
                        CapturedServiceServer.PACKAGE_JSON = join(process.cwd(), 'package.json');
                        return new CapturedServiceServer(
                            {
                                getLogger: () => ({
                                    access: { error: vi.fn(), info: vi.fn() },
                                    system: { error: vi.fn(), info: vi.fn() },
                                }),
                            },
                            {
                                getConfig: () => ({
                                    apiServers: ['http://synthetic.invalid'],
                                    concurrentUploadNum: 3,
                                    port: 0,
                                    streamFilePath: uploadRoot,
                                    thumbnail: uploadRoot,
                                    uploadReceiveTimeoutMs: 300_000,
                                    uploadTempDir: uploadRoot,
                                }),
                            },
                            restartSocket,
                        ) as any;
                    },
                );

                const namespaceReads = readdirSync.mock.calls
                    .map(([target]) => target)
                    .filter(target => target === incomingRoot || target === adoptedRoot);
                const removedTargets = [...unlinkSync.mock.calls, ...rmdirSync.mock.calls]
                    .map(([target]) => target)
                    .filter(target => target.startsWith(uploadRoot));
                expect(namespaceReads).toEqual([incomingRoot]);
                expect(removedTargets.some(target => target.startsWith(adoptedRoot))).toBe(false);
                expect(existsSync(incomingPayload)).toBe(false);
                expect(existsSync(incomingToken)).toBe(false);

                restartedChild.start();
                const restartListener = restartSocket.initialize.mock.calls[0][0][0] as Server;
                ephemeralServers.push(restartListener);
                await listen(restartListener);

                if (winner === 'startup-cleanup') {
                    releaseRawRename.resolve();
                    const result = await response;
                    expect(result.status).toBe(500);
                    expect(rawRenameFailure).toMatchObject({ code: 'ENOENT' });
                    expect(harness.parentReplies.mock.calls.map(([message]) => message.type)).not.toContain(
                        'uploadedVideoAdopted',
                    );
                    expect(sourceRead).not.toHaveBeenCalled();
                    expect(domain.addUploadedVideoFile).not.toHaveBeenCalled();
                    expect(existsSync(adoptedPayload)).toBe(false);
                } else {
                    expect(rawRenameFailure).toBeUndefined();
                    expect(await readFile(adoptedPayload, 'utf8')).toBe('synthetic-upload');
                    releaseDomain.resolve();
                    const result = await response;
                    expect(result.status).toBe(200);
                    expect(harness.parentReplies.mock.calls.map(([message]) => message.type)).toContain(
                        'uploadedVideoAdopted',
                    );
                    expect(sourceRead).toHaveBeenCalledOnce();
                    expect(domain.addUploadedVideoFile).toHaveBeenCalledOnce();
                    expect(await readFile(adoptedPayload, 'utf8')).toBe('synthetic-upload');
                }
                expect(getOwner).toHaveBeenCalledExactlyOnceWith('IIPCClient');
            } finally {
                releaseRawRename.resolve();
                releaseDomain.resolve();
                await response.catch(() => undefined);
                harness.cleanup();
                cleanupSpies.forEach(spy => spy.mockRestore());
                /*
                 * `getOwner` (vi.spyOn(modelContainer, 'get')) is created fresh on every loop
                 * iteration but was never restored between iterations. vi.spyOn on an
                 * already-spied method reuses the existing spy (its call history persists), so the
                 * second ('parent-rename') iteration's `getOwner` accumulated the first
                 * ('startup-cleanup') iteration's call too, making
                 * `toHaveBeenCalledExactlyOnceWith('IIPCClient')` see 2 calls instead of 1. This was
                 * masked before because the first iteration always threw earlier, at the
                 * readdirSync/unlinkSync/rmdirSync assertions (see the fs-mocking fix above), so the
                 * loop never reached a second `vi.spyOn` call. Restoring here keeps each iteration's
                 * spy independent, matching the per-iteration "get called exactly once" contract.
                 */
                getOwner.mockRestore();
            }
        }
    });

    it('contains the approved 66 non-stream operations', () => {
        expect(allRouteCases).toHaveLength(66);
    });

    it.each(allRouteCases)(
        '$method /$file traverses ServiceServer.initOpenApi with its real path/query/body/multipart carrier',
        async contract => {
            const operation = vi.fn().mockResolvedValue(materializeOwnerResult(contract.ownerResult));
            const dispatch = vi.fn(() => ({
                disposition: Promise.resolve({ completion: Promise.resolve(), kind: 'adopted' }),
            }));
            const getOwner = vi
                .spyOn(modelContainer, 'get')
                .mockImplementation((token: string) =>
                    contract.file === 'videos/upload'
                        ? { uploadedVideoRegistrationPort: { dispatch } }
                        : { [contract.ownerMethod]: operation },
                );

            const response = await exchange(origin, wireRequest(contract));

            expect(getOwner).toHaveBeenCalledOnce();
            if (contract.file === 'videos/upload') {
                expect(getOwner).toHaveBeenCalledWith('IIPCClient');
                expect(dispatch).toHaveBeenCalledOnce();
                const incomingRoot = join(uploadRoot, 'incoming');
                expect(dispatch).toHaveBeenCalledWith({
                    ...copy(contract.ownerArgs[0] as Record<string, unknown>),
                    filePath: expect.stringMatching(
                        new RegExp(`^${incomingRoot.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}/[^/]+/payload$`),
                    ),
                });
                expect(dirname(dirname(dispatch.mock.calls[0][0].filePath))).toBe(incomingRoot);
            } else {
                expect(getOwner).toHaveBeenCalledWith(contract.ownerToken);
                expect(operation).toHaveBeenCalledOnce();
                expect(operation).toHaveBeenCalledWith(...copy(contract.ownerArgs));
            }
            expect(response.status).toBe(contract.status);
            expectContentType(response, contract.contentType);
            if (contract.contentType === 'application/json') {
                expect(JSON.parse(response.body.toString('utf8'))).toEqual(contract.body);
            } else {
                expect(response.body.toString('utf8')).toBe(contract.body);
            }
        },
    );

    it('connects one real multipart request through the completed PM and parent adoption adapters before the exact HTTP success wire', async () => {
        const harness = await createUploadIpcHarness();
        const releaseOnce = vi.fn();
        const service = createOpenApiService();
        service.uploadAdmission = { tryAcquire: vi.fn(() => ({ releaseOnce })) };
        const listener = service.app.listen(0, loopbackHost);
        ephemeralServers.push(listener);
        const serviceOrigin = await listen(listener);
        const getOwner = vi.spyOn(modelContainer, 'get').mockImplementation((token: string) => {
            if (token === 'IIPCClient') return harness.client;
            throw new Error(`Unexpected owner ${token}`);
        });

        try {
            const response = await exchange(serviceOrigin, wireRequest(uploadContract));

            expect(response.status).toBe(200);
            expect(response.headers['content-type']).toContain('application/json');
            expect(JSON.parse(response.body.toString('utf8'))).toEqual({ code: 200, result: 'ok' });
            expect(getOwner).toHaveBeenCalledExactlyOnceWith('IIPCClient');
            expect(harness.childRequests).toHaveBeenCalledOnce();
            const dispatched = harness.childRequests.mock.calls[0][0] as any;
            expect(dispatched).toMatchObject({
                args: {
                    option: {
                        ...copy(uploadContract.ownerArgs[0] as Record<string, unknown>),
                        filePath: expect.stringMatching(/\/incoming\/[^/]+\/payload$/u),
                    },
                },
                func: 'addUploadedVideoFile',
                model: 'recorded',
            });
            expect(harness.parentReplies.mock.calls.map(([message]) => message)).toEqual([
                { id: dispatched.id, type: 'uploadedVideoAdopted' },
                { id: dispatched.id, result: undefined },
            ]);
            expect(harness.domain.addUploadedVideoFile).toHaveBeenCalledOnce();
            const adoptedOption = harness.domain.addUploadedVideoFile.mock.calls[0][0];
            expect(adoptedOption).toMatchObject({
                ...copy(uploadContract.ownerArgs[0] as Record<string, unknown>),
                filePath: expect.stringMatching(/\/adopted\/[^/]+\/payload$/u),
            });
            await expect(readFile(adoptedOption.filePath, 'utf8')).resolves.toBe('synthetic-upload');
            await vi.waitFor(async () => expect(await readdir(join(uploadRoot, 'incoming'))).toEqual([]));
            expect(releaseOnce).toHaveBeenCalledOnce();
        } finally {
            harness.cleanup();
        }
    });

    it('returns the established 500 while the completed parent adapter cleans only its empty adopted directory after raw rename failure', async () => {
        const renameFailure = Object.assign(new Error('SyntheticRawRenameFailure'), { code: 'EXDEV' });
        const rawRename = vi.fn(async (): Promise<void> => {
            throw renameFailure;
        });
        const domain = { addUploadedVideoFile: vi.fn(async () => undefined) };
        const adoption = new RecordedUploadAdoptionModel(uploadRoot, { rename: rawRename });
        const harness = await createUploadIpcHarness({ adoption, domain });
        const service = createOpenApiService();
        const listener = service.app.listen(0, loopbackHost);
        ephemeralServers.push(listener);
        const serviceOrigin = await listen(listener);
        const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue(harness.client);

        try {
            const response = await exchange(serviceOrigin, wireRequest(uploadContract));

            expect(response.status).toBe(500);
            expect(JSON.parse(response.body.toString('utf8'))).toEqual({
                code: 500,
                errors: 'SyntheticRawRenameFailure',
                message: 'Internal Server Error',
            });
            expect(getOwner).toHaveBeenCalledExactlyOnceWith('IIPCClient');
            expect(harness.childRequests).toHaveBeenCalledOnce();
            expect(rawRename).toHaveBeenCalledOnce();
            expect(domain.addUploadedVideoFile).not.toHaveBeenCalled();
            expect(harness.parentReplies.mock.calls.map(([message]) => message)).toEqual([
                expect.objectContaining({ error: 'SyntheticRawRenameFailure' }),
            ]);
            await vi.waitFor(async () => {
                await expect(readdir(join(uploadRoot, 'incoming'))).resolves.toEqual([]);
                await expect(readdir(join(uploadRoot, 'adopted'))).resolves.toEqual([]);
            });
        } finally {
            harness.cleanup();
        }
    });

    it('does not raw-rename, alter, or dispatch an adopted token that already belongs to the parent', async () => {
        const rawRename = vi.fn(
            async (source: string, destination: string): Promise<void> => rename(source, destination),
        );
        let adoptedSentinel = '';
        const domain = { addUploadedVideoFile: vi.fn(async () => undefined) };
        const adoption = new RecordedUploadAdoptionModel(uploadRoot, { rename: rawRename });
        const harness = await createUploadIpcHarness({
            adoption,
            beforeParentRequest: message => {
                const incomingPayload = message.args.option.filePath;
                const token = basename(dirname(incomingPayload));
                adoptedSentinel = join(uploadRoot, 'adopted', token, 'payload');
                mkdirSync(dirname(adoptedSentinel));
                writeFileSync(adoptedSentinel, 'parent-owned-sentinel');
            },
            domain,
        });
        const service = createOpenApiService();
        const listener = service.app.listen(0, loopbackHost);
        ephemeralServers.push(listener);
        const serviceOrigin = await listen(listener);
        const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue(harness.client);

        try {
            const response = await exchange(serviceOrigin, wireRequest(uploadContract));

            expect(response.status).toBe(500);
            expect(JSON.parse(response.body.toString('utf8'))).toEqual({
                code: 500,
                errors: expect.stringMatching(/EEXIST/u),
                message: 'Internal Server Error',
            });
            expect(getOwner).toHaveBeenCalledExactlyOnceWith('IIPCClient');
            expect(harness.childRequests).toHaveBeenCalledOnce();
            expect(rawRename).not.toHaveBeenCalled();
            expect(domain.addUploadedVideoFile).not.toHaveBeenCalled();
            await expect(readFile(adoptedSentinel, 'utf8')).resolves.toBe('parent-owned-sentinel');
            await expect(readdir(join(uploadRoot, 'incoming'))).resolves.toEqual([]);
        } finally {
            harness.cleanup();
            if (adoptedSentinel !== '') await rm(dirname(adoptedSentinel), { force: true, recursive: true });
        }
    });

    it('returns the established registration failure after parent adoption without letting child cleanup cross into adopted', async () => {
        const domain = {
            addUploadedVideoFile: vi.fn(async () => {
                throw new Error('SyntheticRegistrationFailure');
            }),
        };
        const harness = await createUploadIpcHarness({ domain });
        const service = createOpenApiService();
        const listener = service.app.listen(0, loopbackHost);
        ephemeralServers.push(listener);
        const serviceOrigin = await listen(listener);
        const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue(harness.client);

        try {
            const response = await exchange(serviceOrigin, wireRequest(uploadContract));
            const adoptedPath = domain.addUploadedVideoFile.mock.calls[0][0].filePath;

            expect(response.status).toBe(500);
            expect(JSON.parse(response.body.toString('utf8'))).toEqual({
                code: 500,
                errors: 'SyntheticRegistrationFailure',
                message: 'Internal Server Error',
            });
            expect(getOwner).toHaveBeenCalledExactlyOnceWith('IIPCClient');
            expect(harness.childRequests).toHaveBeenCalledOnce();
            expect(domain.addUploadedVideoFile).toHaveBeenCalledOnce();
            expect(harness.parentReplies.mock.calls.map(([message]) => message)).toEqual([
                expect.objectContaining({ type: 'uploadedVideoAdopted' }),
                expect.objectContaining({ error: 'SyntheticRegistrationFailure' }),
            ]);
            // SyntheticRegistrationFailure twin: the server's incoming cleanup
            // (IncomingUploadFile.cleanupOnce) runs as an async continuation of its own res
            // 'finish' handler; this test only awaits the client's response 'end'.
            // Contract is "incoming is eventually empty after failure finalize" — poll the same
            // public observable within a bounded window instead of asserting immediately.
            await expect
                .poll(() => readdir(join(uploadRoot, 'incoming')), { timeout: 2000, interval: 25 })
                .toEqual([]);
            await expect(readFile(adoptedPath, 'utf8')).resolves.toBe('synthetic-upload');
        } finally {
            harness.cleanup();
        }
    });

    it('preserves parent-owned adoption when acknowledgement delivery is lost and the child later receives an asynchronous send failure', async () => {
        let requestSendCallback: ((error: Error | null) => void) | undefined;
        let lateAcknowledgement: any;
        let deliverLateAcknowledgement: ((message: any) => void) | undefined;
        const domain = {
            addUploadedVideoFile: vi.fn(async () => {
                requestSendCallback?.(new Error('SyntheticAsyncSendFailure'));
            }),
        };
        const harness = await createUploadIpcHarness({
            domain,
            onParentReply: (message, deliver, callback) => {
                if (message.type === 'uploadedVideoAdopted') {
                    lateAcknowledgement = message;
                    deliverLateAcknowledgement = lateMessage => deliver(lateMessage);
                    callback?.(new Error('SyntheticAcknowledgementLoss'));
                    return;
                }
                deliver(message, callback);
            },
            onRequestSent: (_message, callback) => {
                requestSendCallback = callback;
            },
        });
        const service = createOpenApiService();
        const listener = service.app.listen(0, loopbackHost);
        ephemeralServers.push(listener);
        const serviceOrigin = await listen(listener);
        const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue(harness.client);

        try {
            const response = await exchange(serviceOrigin, wireRequest(uploadContract));
            const adoptedPath = domain.addUploadedVideoFile.mock.calls[0][0].filePath;

            expect(response.status).toBe(500);
            expect(JSON.parse(response.body.toString('utf8'))).toEqual({
                code: 500,
                errors: 'SyntheticAsyncSendFailure',
                message: 'Internal Server Error',
            });
            expect(getOwner).toHaveBeenCalledExactlyOnceWith('IIPCClient');
            expect(harness.childRequests).toHaveBeenCalledOnce();
            expect(domain.addUploadedVideoFile).toHaveBeenCalledOnce();
            expect(harness.parentReplies.mock.calls.map(([message]) => message)).toEqual([
                expect.objectContaining({ type: 'uploadedVideoAdopted' }),
                expect.objectContaining({ result: undefined }),
            ]);
            // The server's incoming cleanup
            // (IncomingUploadFile.cleanupOnce) runs as an async continuation of its own res 'finish'
            // handler, which this test cannot observe -- it only awaits the client's response 'end'.
            // The contract is "incoming is eventually empty after failure finalize", so this polls the
            // same public observable within a bounded window instead of asserting it immediately.
            await expect
                .poll(() => readdir(join(uploadRoot, 'incoming')), { timeout: 2000, interval: 25 })
                .toEqual([]);
            await expect(readFile(adoptedPath, 'utf8')).resolves.toBe('synthetic-upload');

            expect(deliverLateAcknowledgement).toBeTypeOf('function');
            deliverLateAcknowledgement?.(lateAcknowledgement);
            await Promise.resolve();
            expect(domain.addUploadedVideoFile).toHaveBeenCalledOnce();
            await expect(readFile(adoptedPath, 'utf8')).resolves.toBe('synthetic-upload');
        } finally {
            harness.cleanup();
        }
    });

    it('keeps normal API, live/recorded HTTP, and parent notifications live while three partial multipart uploads hold slots and rejects the fourth before body, temp, or IPC work', async () => {
        const registrationCompletion = deferred<void>();
        const domain = { addUploadedVideoFile: vi.fn(() => registrationCompletion.promise) };
        const harness = await createUploadIpcHarness({ domain });
        const channels = allRouteCases.find(candidate => candidate.file === 'channels');
        if (channels === undefined) throw new Error('Missing channel route contract');
        const live = streamRouteCases.find(candidate => candidate.file === 'streams/live/{channelId}/m2ts');
        const recorded = streamRouteCases.find(candidate => candidate.file === 'streams/recorded/{videoFileId}/mp4');
        if (live === undefined || recorded === undefined) throw new Error('Missing stream route contract');
        const getChannels = vi.fn(async () => copy(channels.ownerResult));
        const liveStarted = deferred<void>();
        const recordedStarted = deferred<void>();
        const liveStream = Object.assign(new EventEmitter(), { pipe: vi.fn() });
        const recordedStream = Object.assign(new EventEmitter(), { pipe: vi.fn() });
        const startLive = vi.fn(async () => {
            liveStarted.resolve();
            return { stream: liveStream, streamId: 901 };
        });
        const startRecorded = vi.fn(async () => {
            recordedStarted.resolve();
            return { stream: recordedStream, streamId: 902 };
        });
        const keep = vi.fn();
        const stop = vi.fn(async () => undefined);
        const service = createOpenApiService();
        const listener = service.app.listen(0, loopbackHost);
        ephemeralServers.push(listener);
        const serviceOrigin = await listen(listener);
        const upload = wireRequest(uploadContract);
        if (upload.body === undefined) throw new Error('Missing multipart upload body');
        const fileContents = Buffer.from('synthetic-upload');
        const partialEnd = upload.body.indexOf(fileContents) + fileContents.length - 1;
        if (partialEnd <= 0 || partialEnd >= upload.body.length) throw new Error('Missing multipart file contents');
        const getOwner = vi.spyOn(modelContainer, 'get').mockImplementation((token: string) => {
            if (token === 'IIPCClient') return harness.client;
            if (token === channels.ownerToken) return { [channels.ownerMethod]: getChannels };
            if (token === 'IStreamApiModel') {
                return {
                    [live.ownerMethod]: startLive,
                    [recorded.ownerMethod]: startRecorded,
                    keep,
                    stop,
                };
            }
            throw new Error(`Unexpected owner ${token}`);
        });
        const pendingUploads: Array<{ readonly complete: () => void; readonly response: Promise<WireResponse> }> = [];
        let fourthRequest: import('node:http').ClientRequest | undefined;

        try {
            pendingUploads.push(
                ...Array.from({ length: 3 }, () => {
                    const target = new URL(serviceOrigin);
                    let responseStarted = false;
                    let complete!: () => void;
                    const response = new Promise<WireResponse>((resolve, reject) => {
                        const request = httpRequest(
                            {
                                headers: upload.headers,
                                hostname: target.hostname,
                                method: upload.method,
                                path: upload.path,
                                port: target.port,
                            },
                            incoming => {
                                responseStarted = true;
                                const chunks: Buffer[] = [];
                                incoming.on('data', chunk => chunks.push(Buffer.from(chunk)));
                                incoming.once('error', reject);
                                incoming.once('end', () =>
                                    resolve({
                                        body: Buffer.concat(chunks),
                                        headers: incoming.headers,
                                        status: incoming.statusCode ?? 0,
                                    }),
                                );
                            },
                        );
                        request.once('error', error => {
                            if (!responseStarted) reject(error);
                        });
                        request.write(upload.body.subarray(0, partialEnd));
                        let completed = false;
                        complete = () => {
                            if (completed) return;
                            completed = true;
                            request.end(upload.body.subarray(partialEnd));
                        };
                    });
                    return { complete, response };
                }),
            );
            await vi.waitFor(async () => expect(await readdir(join(uploadRoot, 'incoming'))).toHaveLength(3));
            expect(harness.childRequests).not.toHaveBeenCalled();

            const target = new URL(serviceOrigin);
            let fourthResponseStarted = false;
            const fourthResponse = new Promise<WireResponse>((resolve, reject) => {
                fourthRequest = httpRequest(
                    {
                        headers: upload.headers,
                        hostname: target.hostname,
                        method: upload.method,
                        path: upload.path,
                        port: target.port,
                    },
                    incoming => {
                        fourthResponseStarted = true;
                        const chunks: Buffer[] = [];
                        incoming.on('data', chunk => chunks.push(Buffer.from(chunk)));
                        incoming.once('error', reject);
                        incoming.once('end', () =>
                            resolve({
                                body: Buffer.concat(chunks),
                                headers: incoming.headers,
                                status: incoming.statusCode ?? 0,
                            }),
                        );
                    },
                );
                fourthRequest.once('error', error => {
                    if (!fourthResponseStarted) reject(error);
                });
                fourthRequest.flushHeaders();
            });
            const rejectedFourth = await fourthResponse;
            fourthRequest?.destroy();
            const normalResponse = await exchange(serviceOrigin, wireRequest(channels));
            const liveResponse = exchange(serviceOrigin, {
                headers: {},
                method: 'GET',
                path: requestPath(live.file, live.request),
            });
            const recordedResponse = exchange(serviceOrigin, {
                headers: {},
                method: 'GET',
                path: requestPath(recorded.file, recorded.request),
            });
            await Promise.all([liveStarted.promise, recordedStarted.promise]);
            liveStream.emit('close');
            recordedStream.emit('close');
            const [liveWire, recordedWire] = await Promise.all([liveResponse, recordedResponse]);
            harness.parent.notifyClient();
            await vi.waitFor(() => expect(harness.socketNotification).toHaveBeenCalledOnce());

            expect(rejectedFourth.status).toBe(400);
            expect(harness.childRequests).not.toHaveBeenCalled();
            expect(await readdir(join(uploadRoot, 'incoming'))).toHaveLength(3);
            expect(normalResponse.status).toBe(channels.status);
            expect(JSON.parse(normalResponse.body.toString('utf8'))).toEqual(channels.body);
            expect(getChannels).toHaveBeenCalledOnce();
            expect(liveWire.status).toBe(200);
            expectContentType(liveWire, live.contentType);
            expect(recordedWire.status).toBe(200);
            expectContentType(recordedWire, recorded.contentType);
            expect(startLive).toHaveBeenCalledOnce();
            expect(startRecorded).toHaveBeenCalledOnce();
            expect(stop).toHaveBeenCalledTimes(2);
            expect(getOwner).toHaveBeenCalledTimes(3);

            pendingUploads.forEach(upload => upload.complete());
            await vi.waitFor(() => expect(domain.addUploadedVideoFile).toHaveBeenCalledTimes(3));
            registrationCompletion.resolve();
            const responses = await Promise.all(pendingUploads.map(upload => upload.response));

            expect(responses.map(response => response.status)).toEqual([200, 200, 200]);
            expect(harness.childRequests).toHaveBeenCalledTimes(3);
            expect(domain.addUploadedVideoFile).toHaveBeenCalledTimes(3);
            expect(getOwner).toHaveBeenCalledTimes(6);
            await vi.waitFor(async () => expect(await readdir(join(uploadRoot, 'incoming'))).toEqual([]));
        } finally {
            fourthRequest?.destroy();
            pendingUploads.forEach(upload => upload.complete());
            registrationCompletion.resolve();
            await Promise.allSettled(pendingUploads.map(upload => upload.response));
            harness.cleanup();
        }
    });

    it.each([{ terminal: 'abort' }, { terminal: 'ten-minute deadline' }] as const)(
        'keeps child cleanup as the only owner when $terminal wins before raw rename',
        async ({ terminal }) => {
            const realClearTimeout = global.clearTimeout;
            const realSetTimeout = global.setTimeout;
            vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
            const trackedTimers: Array<{ cleared: number; delay: number; fired: number; handle: unknown }> = [];
            const originalSetTimeout = global.setTimeout as any;
            const originalClearTimeout = global.clearTimeout as any;
            vi.spyOn(global, 'setTimeout').mockImplementation(((handler: any, delay?: number, ...args: any[]) => {
                const timer = { cleared: 0, delay: Number(delay ?? 0), fired: 0, handle: undefined as unknown };
                const wrapped = (...callbackArguments: unknown[]) => {
                    timer.fired += 1;
                    return typeof handler === 'function' ? handler(...callbackArguments) : undefined;
                };
                const handle = originalSetTimeout(wrapped, delay, ...args);
                timer.handle = handle;
                if (timer.delay === 300_000 || timer.delay === 600_000) trackedTimers.push(timer);
                return handle;
            }) as any);
            vi.spyOn(global, 'clearTimeout').mockImplementation(((handle: unknown) => {
                const timer = trackedTimers.find(candidate => candidate.handle === handle);
                if (timer !== undefined) timer.cleared += 1;
                return originalClearTimeout(handle);
            }) as any);
            const awaitWithRealDeadline = async <Value>(
                observation: string,
                operation: Promise<Value>,
            ): Promise<Value> => {
                let watchdog: ReturnType<typeof setTimeout> | undefined;
                try {
                    return await Promise.race([
                        operation,
                        new Promise<never>((_resolve, reject) => {
                            watchdog = realSetTimeout(
                                () => reject(new Error(`SyntheticUnlinkFirst${observation}WasNotObserved`)),
                                1_000,
                            );
                        }),
                    ]);
                } finally {
                    if (watchdog !== undefined) realClearTimeout(watchdog);
                }
            };
            const rawRenameEntered = deferred<void>();
            const releaseRawRename = deferred<void>();
            let rawRenameFailure: unknown;
            const rawRename = vi.fn(async (source: string, destination: string) => {
                rawRenameEntered.resolve();
                await releaseRawRename.promise;
                try {
                    await rename(source, destination);
                } catch (error) {
                    rawRenameFailure = error;
                    throw error;
                }
            });
            const adoption = new RecordedUploadAdoptionModel(uploadRoot, { rename: rawRename });
            const sourceRead = vi.fn();
            const domain = { addUploadedVideoFile: vi.fn(async () => sourceRead()) };
            const harness = await createUploadIpcHarness({
                adoption,
                domain,
            });
            const service = createOpenApiService();
            const admission = new UploadAdmissionController(1);
            let releaseCount = 0;
            service.uploadAdmission = {
                tryAcquire: () => {
                    const lease = admission.tryAcquire();
                    if (lease === null) return null;
                    return {
                        releaseOnce: () => {
                            releaseCount += 1;
                            lease.releaseOnce();
                        },
                    };
                },
            };
            const listener = service.app.listen(0, loopbackHost);
            ephemeralServers.push(listener);
            const serviceOrigin = await listen(listener);
            const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue(harness.client);
            const outgoing = wireRequest(uploadContract);
            const target = new URL(serviceOrigin);

            try {
                let aborted: Promise<void> | undefined;
                let abortRequest: import('node:http').ClientRequest | undefined;
                let response: Promise<WireResponse> | undefined;
                if (terminal === 'abort') {
                    let resolveAbort!: () => void;
                    aborted = new Promise(resolve => {
                        resolveAbort = resolve;
                    });
                    abortRequest = httpRequest(
                        {
                            headers: outgoing.headers,
                            hostname: target.hostname,
                            method: outgoing.method,
                            path: outgoing.path,
                            port: target.port,
                        },
                        incoming => incoming.resume(),
                    );
                    abortRequest.once('error', () => resolveAbort());
                    abortRequest.end(outgoing.body);
                } else {
                    response = exchange(serviceOrigin, outgoing);
                }

                await awaitWithRealDeadline('RawRename', rawRenameEntered.promise);
                await expect(readdir(join(uploadRoot, 'incoming'))).resolves.toHaveLength(1);
                expect(getOwner).toHaveBeenCalledExactlyOnceWith('IIPCClient');
                expect(rawRename).toHaveBeenCalledOnce();
                expect(harness.parentReplies).not.toHaveBeenCalled();
                expect(sourceRead).not.toHaveBeenCalled();
                expect(domain.addUploadedVideoFile).not.toHaveBeenCalled();
                await expect(readdir(join(uploadRoot, 'adopted'))).resolves.toHaveLength(1);
                expect(trackedTimers.filter(timer => timer.delay === 300_000)).toEqual([
                    expect.objectContaining({ cleared: 1, fired: 0 }),
                ]);
                expect(trackedTimers.filter(timer => timer.delay === 600_000)).toEqual([
                    expect.objectContaining({ cleared: 0, fired: 0 }),
                ]);

                if (terminal === 'abort') {
                    abortRequest?.destroy(new Error('SyntheticUnlinkFirstAbort'));
                    await awaitWithRealDeadline('Abort', aborted as Promise<void>);
                } else {
                    await vi.advanceTimersByTimeAsync(600_000);
                    const timeoutResponse = await awaitWithRealDeadline('Deadline', response as Promise<WireResponse>);
                    expect(timeoutResponse.status).toBe(500);
                    expect(timeoutResponse.body.toString('utf8')).toBe(serverErrorBody('IPCTimeout'));
                }

                await awaitWithRealDeadline(
                    'IncomingCleanup',
                    vi.waitFor(async () => expect(await readdir(join(uploadRoot, 'incoming'))).toEqual([])),
                );
                expect(releaseCount).toBe(1);
                const replacementLease = admission.tryAcquire();
                expect(replacementLease).not.toBeNull();
                replacementLease?.releaseOnce();
                expect(rawRenameFailure).toBeUndefined();
                expect(sourceRead).not.toHaveBeenCalled();
                expect(domain.addUploadedVideoFile).not.toHaveBeenCalled();

                releaseRawRename.resolve();
                await awaitWithRealDeadline(
                    'ParentReply',
                    vi.waitFor(() => expect(harness.parentReplies).toHaveBeenCalledOnce()),
                );
                expect(rawRename).toHaveBeenCalledOnce();
                expect(rawRenameFailure).toMatchObject({ code: 'ENOENT' });
                expect(harness.parentReplies.mock.calls.map(([message]) => message)).toEqual([
                    expect.objectContaining({ error: expect.stringMatching(/ENOENT/u) }),
                ]);
                expect(harness.parentReplies.mock.calls.map(([message]) => message.type)).not.toContain(
                    'uploadedVideoAdopted',
                );
                expect(sourceRead).not.toHaveBeenCalled();
                expect(domain.addUploadedVideoFile).not.toHaveBeenCalled();
                await expect(readdir(join(uploadRoot, 'adopted'))).resolves.toEqual([]);
                expect(trackedTimers.filter(timer => timer.delay === 300_000)).toEqual([
                    expect.objectContaining({ cleared: 1, fired: 0 }),
                ]);
                expect(trackedTimers.filter(timer => timer.delay === 600_000)).toEqual([
                    expect.objectContaining({
                        cleared: 1,
                        fired: terminal === 'ten-minute deadline' ? 1 : 0,
                    }),
                ]);
            } finally {
                releaseRawRename.resolve();
                harness.cleanup();
            }
        },
    );

    it('returns the established 500 at the ten-minute IPC deadline while parent-owned adopted work remains independent', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const registrationCompletion = deferred<void>();
        const domain = { addUploadedVideoFile: vi.fn(() => registrationCompletion.promise) };
        const harness = await createUploadIpcHarness({ domain });
        const service = createOpenApiService();
        const listener = service.app.listen(0, loopbackHost);
        ephemeralServers.push(listener);
        const serviceOrigin = await listen(listener);
        const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue(harness.client);

        try {
            const responsePromise = exchange(serviceOrigin, wireRequest(uploadContract));
            await vi.waitFor(() => expect(domain.addUploadedVideoFile).toHaveBeenCalledOnce());
            const adoptedPath = domain.addUploadedVideoFile.mock.calls[0][0].filePath;
            await vi.advanceTimersByTimeAsync(600_000);
            const response = await responsePromise;

            expect(response.status).toBe(500);
            expect(JSON.parse(response.body.toString('utf8'))).toEqual({
                code: 500,
                errors: 'IPCTimeout',
                message: 'Internal Server Error',
            });
            expect(getOwner).toHaveBeenCalledExactlyOnceWith('IIPCClient');
            expect(harness.childRequests).toHaveBeenCalledOnce();
            expect(domain.addUploadedVideoFile).toHaveBeenCalledOnce();
            expect(harness.parentReplies.mock.calls.map(([message]) => message)).toEqual([
                expect.objectContaining({ type: 'uploadedVideoAdopted' }),
            ]);
            await vi.waitFor(async () => expect(await readdir(join(uploadRoot, 'incoming'))).toEqual([]));
            await expect(readFile(adoptedPath, 'utf8')).resolves.toBe('synthetic-upload');

            registrationCompletion.resolve();
            await vi.waitFor(() => expect(harness.parentReplies).toHaveBeenCalledTimes(2));
            await expect(readFile(adoptedPath, 'utf8')).resolves.toBe('synthetic-upload');
        } finally {
            registrationCompletion.resolve();
            harness.cleanup();
        }
    });

    it('releases the HTTP request after client abort without cancelling parent work that already won adoption', async () => {
        const registrationCompletion = deferred<void>();
        const domain = { addUploadedVideoFile: vi.fn(() => registrationCompletion.promise) };
        const harness = await createUploadIpcHarness({ domain });
        const service = createOpenApiService();
        const listener = service.app.listen(0, loopbackHost);
        ephemeralServers.push(listener);
        const serviceOrigin = await listen(listener);
        const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue(harness.client);
        const outgoing = wireRequest(uploadContract);
        const target = new URL(serviceOrigin);

        try {
            let resolveAbort!: () => void;
            const aborted = new Promise<void>(resolve => {
                resolveAbort = resolve;
            });
            const request = httpRequest(
                {
                    headers: outgoing.headers,
                    hostname: target.hostname,
                    method: outgoing.method,
                    path: outgoing.path,
                    port: target.port,
                },
                response => response.resume(),
            );
            request.once('error', () => resolveAbort());
            request.write(outgoing.body);
            request.end();
            await vi.waitFor(() => expect(domain.addUploadedVideoFile).toHaveBeenCalledOnce());
            request.destroy(new Error('SyntheticClientAbort'));
            await aborted;
            const adoptedPath = domain.addUploadedVideoFile.mock.calls[0][0].filePath;
            registrationCompletion.resolve();
            await vi.waitFor(async () => expect(await readdir(join(uploadRoot, 'incoming'))).toEqual([]));
            await vi.waitFor(() => expect(harness.parentReplies).toHaveBeenCalledTimes(2));

            expect(getOwner).toHaveBeenCalledExactlyOnceWith('IIPCClient');
            expect(harness.childRequests).toHaveBeenCalledOnce();
            expect(domain.addUploadedVideoFile).toHaveBeenCalledOnce();
            await expect(readFile(adoptedPath, 'utf8')).resolves.toBe('synthetic-upload');
        } finally {
            registrationCompletion.resolve();
            harness.cleanup();
        }
    });

    it.each([
        { domainCallsAtTerminal: 1, phase: 'target-read-before', terminal: 'abort' },
        { domainCallsAtTerminal: 1, phase: 'target-read-before', terminal: 'ten-minute deadline' },
        { domainCallsAtTerminal: 0, phase: 'rename-after', terminal: 'abort' },
        { domainCallsAtTerminal: 0, phase: 'rename-after', terminal: 'ten-minute deadline' },
        { domainCallsAtTerminal: 1, phase: 'source-read-after', terminal: 'abort' },
        { domainCallsAtTerminal: 1, phase: 'source-read-after', terminal: 'ten-minute deadline' },
        { domainCallsAtTerminal: 1, phase: 'final-move-db-before', terminal: 'abort' },
        { domainCallsAtTerminal: 1, phase: 'final-move-db-before', terminal: 'ten-minute deadline' },
        { domainCallsAtTerminal: 1, phase: 'db-reply-before', terminal: 'abort' },
        { domainCallsAtTerminal: 1, phase: 'db-reply-before', terminal: 'ten-minute deadline' },
    ] as const)(
        'keeps exactly one owner through $terminal at $phase and releases the HTTP slot, timer, and listeners once',
        async ({ domainCallsAtTerminal, phase, terminal }) => {
            const realClearTimeout = global.clearTimeout;
            const realSetTimeout = global.setTimeout;
            vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
            const trackedTimers: Array<{ cleared: number; delay: number; fired: number; handle: unknown }> = [];
            const originalSetTimeout = global.setTimeout as any;
            const originalClearTimeout = global.clearTimeout as any;
            vi.spyOn(global, 'setTimeout').mockImplementation(((handler: any, delay?: number, ...args: any[]) => {
                const timer = { cleared: 0, delay: Number(delay ?? 0), fired: 0, handle: undefined as unknown };
                const wrapped = (...callbackArguments: unknown[]) => {
                    timer.fired += 1;
                    return typeof handler === 'function' ? handler(...callbackArguments) : undefined;
                };
                const handle = originalSetTimeout(wrapped, delay, ...args);
                timer.handle = handle;
                if (timer.delay === 300_000 || timer.delay === 600_000) trackedTimers.push(timer);
                return handle;
            }) as any);
            vi.spyOn(global, 'clearTimeout').mockImplementation(((handle: unknown) => {
                const timer = trackedTimers.find(candidate => candidate.handle === handle);
                if (timer !== undefined) timer.cleared += 1;
                return originalClearTimeout(handle);
            }) as any);
            const stageReached = deferred<void>();
            const awaitWithRealDeadline = async <Value>(
                observation: string,
                operation: Promise<Value>,
            ): Promise<Value> => {
                let watchdog: ReturnType<typeof setTimeout> | undefined;
                try {
                    return await Promise.race([
                        operation,
                        new Promise<never>((_resolve, reject) => {
                            watchdog = realSetTimeout(
                                () => reject(new Error(`Synthetic${phase}${observation}WasNotObserved`)),
                                1_000,
                            );
                        }),
                    ]);
                } finally {
                    if (watchdog !== undefined) realClearTimeout(watchdog);
                }
            };
            const awaitStageReached = async (): Promise<void> => awaitWithRealDeadline('Stage', stageReached.promise);
            const releaseStage = deferred<void>();
            const stageFailure = new Error(`Synthetic${phase}Failure`);
            const storageRoot = join(temporaryRoot, `recorded-owner-${phase}-${terminal.replaceAll(' ', '-')}`);
            const finalDestination = join(storageRoot, 'child', 'synthetic.ts');
            let adoptedPayload = '';
            let releaseParentReply: (() => void) | undefined;
            let captured:
                | {
                      readonly closeBaseline: number;
                      readonly finishBaseline: number;
                      readonly request: any;
                      readonly requestAbortBaseline: number;
                      readonly requestOnce: ReturnType<typeof vi.spyOn>;
                      readonly requestRemoveListener: ReturnType<typeof vi.spyOn>;
                      readonly response: any;
                  }
                | undefined;
            const originalUploadFile = ServiceServer.prototype.uploadFile;
            vi.spyOn(ServiceServer.prototype, 'uploadFile').mockImplementation(function (
                req: any,
                res: any,
                next: any,
            ) {
                const snapshot = {
                    closeBaseline: res.listenerCount('close'),
                    finishBaseline: res.listenerCount('finish'),
                    request: req,
                    requestAbortBaseline: req.listenerCount('aborted'),
                    // Captures the listener ServiceServer.uploadFile registers via `req.once('aborted',
                    // onRequestAborted)` so we can later identify, among all `removeListener('aborted', ...)`
                    // calls, the one call whose listener argument is that same reference (see the
                    // `ownAbortedListener` derivation below).
                    requestOnce: vi.spyOn(req, 'once'),
                    requestRemoveListener: vi.spyOn(req, 'removeListener'),
                    response: res,
                };
                captured = snapshot;
                return originalUploadFile.call(this, req, res, next);
            });

            await mkdir(storageRoot, { recursive: true });
            const recorded = Object.create(RecordedManageModel.prototype) as any;
            recorded.log = { system: { error: vi.fn(), info: vi.fn() } };
            recorded.recordedDB = {
                findId: vi.fn(async () => {
                    if (phase === 'target-read-before') {
                        stageReached.resolve();
                        await releaseStage.promise;
                        throw stageFailure;
                    }
                    if (phase === 'rename-after') throw stageFailure;
                    return { thumbnails: [] };
                }),
            };
            recorded.videoFileDB = {
                insertOnce: vi.fn(async () => {
                    if (phase === 'final-move-db-before') {
                        stageReached.resolve();
                        await releaseStage.promise;
                        throw stageFailure;
                    }
                    return 7_501;
                }),
            };
            recorded.recordedEvent = { emitAddUploadedVideoFile: vi.fn(), emitAddVideoFile: vi.fn() };
            recorded.recordingUtilModel = { formatFilePathString: vi.fn(async (value: string) => value) };
            recorded.videoUtil = { getParentDirPath: vi.fn(() => storageRoot) };
            let sourceReadHeld = false;
            recorded.uploadFileSystem = {
                copyFile,
                link,
                lstat,
                mkdir,
                open,
                realpath,
                rename,
                rmdir,
                stat: async (path: string) => {
                    if (phase === 'source-read-after' && !sourceReadHeld && path.endsWith('/synthetic.ts')) {
                        sourceReadHeld = true;
                        stageReached.resolve();
                        await releaseStage.promise;
                        throw stageFailure;
                    }
                    return await stat(path);
                },
                unlink,
            };
            const domain = { addUploadedVideoFile: vi.fn((option: unknown) => recorded.addUploadedVideoFile(option)) };
            const rawRename = vi.fn(async (source: string, destination: string) => {
                adoptedPayload = destination;
                await rename(source, destination);
                if (phase === 'rename-after') {
                    stageReached.resolve();
                    await releaseStage.promise;
                }
            });
            const adoption = new RecordedUploadAdoptionModel(uploadRoot, { rename: rawRename });
            const harness = await createUploadIpcHarness({
                adoption,
                domain,
                onParentReply: (message, deliver, callback) => {
                    if (phase === 'db-reply-before' && 'result' in message) {
                        stageReached.resolve();
                        releaseParentReply = () => deliver(message, callback);
                        return;
                    }
                    deliver(message, callback);
                },
            });
            const service = createOpenApiService();
            const admission = new UploadAdmissionController(1);
            let releaseCount = 0;
            service.uploadAdmission = {
                tryAcquire: () => {
                    const lease = admission.tryAcquire();
                    if (lease === null) return null;
                    return {
                        releaseOnce: () => {
                            releaseCount += 1;
                            lease.releaseOnce();
                        },
                    };
                },
            };
            const listener = service.app.listen(0, loopbackHost);
            ephemeralServers.push(listener);
            const serviceOrigin = await listen(listener);
            const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue(harness.client);
            const outgoing = wireRequest(uploadContract);
            const target = new URL(serviceOrigin);

            try {
                let abortedRequest: import('node:http').ClientRequest | undefined;
                let timeoutTerminal: Promise<WireResponse> | undefined;
                let resolveAbort!: () => void;
                const abortTerminal = new Promise<void>(resolve => {
                    resolveAbort = resolve;
                });
                if (terminal === 'abort') {
                    const request = httpRequest(
                        {
                            headers: outgoing.headers,
                            hostname: target.hostname,
                            method: outgoing.method,
                            path: outgoing.path,
                            port: target.port,
                        },
                        response => response.resume(),
                    );
                    abortedRequest = request;
                    request.once('error', () => resolveAbort());
                    request.write(outgoing.body);
                    request.end();
                } else {
                    timeoutTerminal = exchange(serviceOrigin, outgoing);
                }

                await awaitStageReached();
                expect(getOwner).toHaveBeenCalledExactlyOnceWith('IIPCClient');
                expect(rawRename).toHaveBeenCalledOnce();
                expect(domain.addUploadedVideoFile).toHaveBeenCalledTimes(domainCallsAtTerminal);
                expect(adoptedPayload).toMatch(/\/adopted\/[^/]+\/payload$/u);
                if (phase === 'target-read-before' || phase === 'rename-after') {
                    await expect(readFile(adoptedPayload, 'utf8')).resolves.toBe('synthetic-upload');
                } else {
                    await expect(readFile(finalDestination, 'utf8')).resolves.toBe('synthetic-upload');
                }
                expect(trackedTimers.filter(timer => timer.delay === 300_000)).toEqual([
                    expect.objectContaining({ cleared: 1, fired: 0 }),
                ]);
                expect(trackedTimers.filter(timer => timer.delay === 600_000)).toEqual([
                    expect.objectContaining({ cleared: 0, fired: 0 }),
                ]);

                if (terminal === 'abort') {
                    abortedRequest?.destroy(new Error('SyntheticLifecycleAbort'));
                    await awaitWithRealDeadline('AbortTerminal', abortTerminal);
                } else {
                    await vi.advanceTimersByTimeAsync(600_000);
                    const response = await awaitWithRealDeadline(
                        'DeadlineTerminal',
                        timeoutTerminal as Promise<WireResponse>,
                    );
                    expect(response.status).toBe(500);
                    expect(response.body.toString('utf8')).toBe(serverErrorBody('IPCTimeout'));
                }

                await awaitWithRealDeadline(
                    'Release',
                    vi.waitFor(() => expect(releaseCount).toBe(1)),
                );
                expect(captured).toBeDefined();
                expect(captured?.request.listenerCount('aborted')).toBe(captured?.requestAbortBaseline);
                expect(captured?.response.listenerCount('finish')).toBe(captured?.finishBaseline);
                expect(captured?.response.listenerCount('close')).toBe(captured?.closeBaseline);
                /*
                 * src/model/service/ServiceServer.ts's `uploadFile` now removes multer 2.3.0's leaked
                 * `req.on('aborted', ...)` / `req.on('close', ...)` listeners itself
                 * (`removeUploadParserListeners`, see the comment above it): multer registers those with
                 * `.on` rather than `.once` and never removes them, so without this cleanup they would
                 * stay attached to `req` after every upload request. That cleanup runs from the same
                 * `onFinalized` callback that also removes ServiceServer's own `onRequestAborted`
                 * listener, so `req.removeListener('aborted', ...)` is now called twice per request: once
                 * for `onRequestAborted` and once for multer's leaked listener. Raw call-count no longer
                 * distinguishes "did ServiceServer clean up exactly once" from "how many listeners needed
                 * removing", so instead identify the specific `removeListener('aborted', ...)` call that
                 * targets ServiceServer's own listener (captured by spying on `req.once` at the same time
                 * as `req.removeListener`, since `onRequestAborted` is registered via
                 * `req.once('aborted', onRequestAborted)`) and assert that one call happens exactly once.
                 * The `listenerCount('aborted')` assertion above already proves no listener -- multer's
                 * leaked one included -- is left behind.
                 */
                const ownAbortedRegistrations = captured?.requestOnce.mock.calls.filter(
                    ([event]) => event === 'aborted',
                );
                expect(ownAbortedRegistrations).toHaveLength(1);
                const ownAbortedListener = ownAbortedRegistrations?.[0]?.[1];
                expect(
                    captured?.requestRemoveListener.mock.calls.filter(
                        ([event, listener]) => event === 'aborted' && listener === ownAbortedListener,
                    ),
                ).toHaveLength(1);
                const replacementLease = admission.tryAcquire();
                expect(replacementLease).not.toBeNull();
                replacementLease?.releaseOnce();
                await expect(readdir(join(uploadRoot, 'incoming'))).resolves.toEqual([]);

                releaseStage.resolve();
                releaseParentReply?.();
                await awaitWithRealDeadline(
                    'ParentReply',
                    vi.waitFor(() => expect(harness.parentReplies).toHaveBeenCalledTimes(2)),
                );
                if (phase === 'db-reply-before') {
                    await expect(readFile(finalDestination, 'utf8')).resolves.toBe('synthetic-upload');
                } else {
                    await vi.waitFor(async () => {
                        await expect(readFile(adoptedPayload)).rejects.toMatchObject({ code: 'ENOENT' });
                        await expect(readFile(finalDestination)).rejects.toMatchObject({ code: 'ENOENT' });
                    });
                }
                expect(trackedTimers.filter(timer => timer.delay === 300_000)).toEqual([
                    expect.objectContaining({ cleared: 1, fired: 0 }),
                ]);
                const [ipcTimer] = trackedTimers.filter(timer => timer.delay === 600_000);
                expect(ipcTimer).toBeDefined();
                expect(ipcTimer?.fired).toBe(terminal === 'abort' ? 0 : 1);
                if (terminal === 'abort') expect(ipcTimer?.cleared).toBe(1);
            } finally {
                releaseStage.resolve();
                releaseParentReply?.();
                harness.cleanup();
                await rm(storageRoot, { force: true, recursive: true });
            }
        },
    );

    it.each([
        {
            carrier: 'path',
            expectedStatus: 404,
            outgoing: {
                headers: {},
                method: 'GET',
                path: '/api/channels/logo',
            },
            ownerMethod: 'getLogo',
            ownerBinding: 'IChannelApiModel',
            violation: 'missing required channelId segment',
        },
        {
            carrier: 'query',
            expectedStatus: 400,
            outgoing: {
                headers: {},
                method: 'GET',
                path: '/api/streams/live/11/hls',
            },
            ownerMethod: 'startLiveHLSStream',
            ownerBinding: 'IStreamApiModel',
            violation: 'missing required mode',
        },
        {
            carrier: 'JSON body',
            expectedStatus: 400,
            outgoing: {
                body: Buffer.from('{}'),
                headers: { 'Content-Length': '2', 'Content-Type': 'application/json' },
                method: 'POST',
                path: '/api/reserves',
            },
            ownerMethod: 'add',
            ownerBinding: 'IReserveApiModel',
            violation: 'missing required allowEndLack',
        },
        {
            carrier: 'multipart body',
            expectedStatus: 400,
            outgoing: (() => {
                const contract = allRouteCases.find(candidate => candidate.file === 'videos/upload');
                if (contract === undefined) throw new Error('Missing multipart route contract');
                const form = multipart({ body: contract.request.body });
                return {
                    body: form.body,
                    headers: {
                        'Content-Length': String(form.body.length),
                        'Content-Type': form.contentType,
                    },
                    method: 'POST',
                    path: '/api/videos/upload',
                };
            })(),
            ownerMethod: 'addUploadedVideoFile',
            ownerBinding: 'IRecordedApiModel',
            violation: 'missing required file',
        },
    ] as const)(
        'rejects $carrier $violation before invoking the owner operation',
        async ({ expectedStatus, outgoing, ownerBinding, ownerMethod }) => {
            const operation = vi.fn();
            const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue({ [ownerMethod]: operation });

            const response = await exchange(origin, outgoing);

            expect(response.status).toBe(expectedStatus);
            if (expectedStatus === 400) expectContentType(response, 'application/json');
            expect(operation).not.toHaveBeenCalled();
            expect(getOwner).not.toHaveBeenCalledWith(ownerBinding);
        },
    );
});

describe('Service Interface supplemental public API carrier [SI-2.9/SI-3.1/SI-3.6]', () => {
    it('delegates the config route to its owner and preserves broadcast plus the existing 500 wire', async () => {
        const config = { broadcast: true, recorded: ['primary'], socketIOPort: 7777 };
        const getConfig = vi
            .fn()
            .mockResolvedValueOnce(config)
            .mockRejectedValueOnce(new Error('synthetic-config-owner-failure'));
        const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue({ getConfig });

        const success = await exchange(origin, { headers: {}, method: 'GET', path: '/api/config' });
        const failure = await exchange(origin, { headers: {}, method: 'GET', path: '/api/config' });

        expect(getOwner).toHaveBeenCalledTimes(2);
        expect(getOwner).toHaveBeenNthCalledWith(1, 'IConfigApiModel');
        expect(getOwner).toHaveBeenNthCalledWith(2, 'IConfigApiModel');
        expect(getConfig).toHaveBeenNthCalledWith(1, false);
        expect(getConfig).toHaveBeenNthCalledWith(2, false);
        expect(success.status).toBe(200);
        expectContentType(success, 'application/json');
        expect(JSON.parse(success.body.toString('utf8'))).toEqual(config);
        expect(success.headers).toMatchObject({
            'cache-control': 'private, no-cache, no-store, must-revalidate',
            expires: '-1',
            pragma: 'no-cache',
        });
        expect(failure.status).toBe(500);
        expectContentType(failure, 'application/json');
        expect(JSON.parse(failure.body.toString('utf8'))).toEqual({
            code: 500,
            errors: 'synthetic-config-owner-failure',
            message: 'Internal Server Error',
        });
    });

    it('maps a file-private package read failure and recovery through the real public version carrier', async () => {
        const packageInfo = require(join(process.cwd(), 'package.json')) as { version: string };
        const getOwner = vi.spyOn(modelContainer, 'get');
        const canonicalPackageJson = join(compiledSnapshot!, '..', 'package.json');
        const packageJsonContent = JSON.stringify(packageInfo);
        let packageMissing = true;
        const originalReadFileSync = mutableFileSystem.readFileSync.bind(mutableFileSystem);
        const readFileSyncDouble = vi.fn((path: unknown, options?: unknown) => {
            if (String(path) === canonicalPackageJson) {
                if (packageMissing) {
                    throw Object.assign(
                        new Error(`ENOENT: no such file or directory, open '${canonicalPackageJson}'`),
                        {
                            code: 'ENOENT',
                            errno: -2,
                            path: canonicalPackageJson,
                            syscall: 'open',
                        },
                    );
                }
                return packageJsonContent;
            }
            return originalReadFileSync(path, options);
        });
        /*
         * version.js の `import * as fs from 'fs'` は静的に解決されるため、require() で読み込んだ
         * 名前空間 (mutableFileSystem) を後から書き換えても version.js 側には届かない (in-process の
         * 差し替えが効かない)。version.js はこの file の module-level ServiceServer の graph には属さず
         * (`app.get('/api/version', route.get)` でこの test だけが直接 route 登録する)、'fixtures/
         * listener-matrix' 側で先に cache されてもいないため、`vi.doMock('node:fs', ...)` で 'fs' 自体を
         * readFileSyncDouble へ委譲するラッパーへ差し替えたうえで `vi.resetModules()` してから動的
         * `import()` で読み直す（既存の合格例: public-contract.spec.test.ts の同じ差し替え）。
         */
        vi.doMock('node:fs', () => ({
            ...mutableFileSystem,
            readFileSync: (path: unknown, options?: unknown) => readFileSyncDouble(path, options),
        }));
        let route: { get: express.RequestHandler };
        try {
            vi.resetModules();
            route = (await import(compiled('model', 'service', 'api', 'version.js'))) as {
                get: express.RequestHandler;
            };
        } finally {
            vi.doUnmock('node:fs');
        }
        const app = express();
        app.get('/api/version', route.get);
        const listener = createHttpServer(app);
        ephemeralServers.push(listener);
        const privateOrigin = await listenWithProtocol(listener, 'http');
        const missingPackage = await exchange(privateOrigin, { headers: {}, method: 'GET', path: '/api/version' });

        expect(missingPackage.status).toBe(500);
        expectContentType(missingPackage, 'application/json');
        expect(JSON.parse(missingPackage.body.toString('utf8'))).toEqual({
            code: 500,
            errors: expect.stringMatching(/^ENOENT: no such file or directory/u),
            message: 'Internal Server Error',
        });

        packageMissing = false;
        const response = await exchange(privateOrigin, { headers: {}, method: 'GET', path: '/api/version' });

        expect(response.status).toBe(200);
        expectContentType(response, 'application/json');
        expect(JSON.parse(response.body.toString('utf8'))).toEqual({ version: packageInfo.version });
        expect(response.headers).toMatchObject({
            'cache-control': 'private, no-cache, no-store, must-revalidate',
            expires: '-1',
            pragma: 'no-cache',
        });
        expect(getOwner).not.toHaveBeenCalled();
    });

    it.each([
        {
            method: 'getChannelList',
            path: '/api/iptv/channel.m3u8?mode=1&isHalfWidth=false',
            requiresConfiguration: true,
        },
        {
            method: 'getEpg',
            path: '/api/iptv/epg.xml?days=1&isHalfWidth=false',
            requiresConfiguration: false,
        },
    ] as const)(
        'keeps $path owner failure on the existing 500 JSON wire',
        async ({ method, path, requiresConfiguration }) => {
            const operation = vi.fn().mockRejectedValue(new Error(`synthetic-${method}-failure`));
            const getOwner = vi.spyOn(modelContainer, 'get').mockImplementation((token: string) => {
                if (token === 'IConfiguration' && requiresConfiguration) return { getConfig: () => ({}) };
                if (token === 'IIPTVApiModel') return { [method]: operation };
                throw new Error(`Unexpected owner ${token}`);
            });

            const response = await exchange(origin, { headers: { Host: 'receiver.invalid' }, method: 'GET', path });

            expect(response.status).toBe(500);
            expectContentType(response, 'application/json');
            expect(JSON.parse(response.body.toString('utf8'))).toEqual({
                code: 500,
                errors: `synthetic-${method}-failure`,
                message: 'Internal Server Error',
            });
            expect(operation).toHaveBeenCalledOnce();
            if (requiresConfiguration) {
                expect(getOwner).toHaveBeenNthCalledWith(1, 'IConfiguration');
                expect(getOwner).toHaveBeenNthCalledWith(2, 'IIPTVApiModel');
            } else {
                expect(getOwner).toHaveBeenCalledOnce();
                expect(getOwner).toHaveBeenCalledWith('IIPTVApiModel');
            }
        },
    );
});

describe('Service Interface common HTTP boundary [SI-4.1]', () => {
    it('logs valid, invalid, and internal-failure requests once while preserving their exact response boundary', async () => {
        const accessLogger = {
            isLevelEnabled: vi.fn().mockReturnValue(true),
            log: vi.fn(),
        };
        const service = createOpenApiService(undefined, accessLogger);
        const listener = createHttpServer(service.app);
        ephemeralServers.push(listener);
        const carrierOrigin = await listenWithProtocol(listener, 'http');
        const getChannels = vi
            .fn()
            .mockResolvedValueOnce([{ id: 11, name: 'synthetic-channel' }])
            .mockRejectedValueOnce(new Error('synthetic-owner-failure'));
        const startLiveHLSStream = vi.fn();
        const getOwner = vi.spyOn(modelContainer, 'get').mockImplementation((token: string) => {
            if (token === 'IChannelApiModel') return { getChannels };
            if (token === 'IStreamApiModel') return { startLiveHLSStream };
            throw new Error(`Unexpected owner ${token}`);
        });

        const valid = await exchange(carrierOrigin, {
            headers: {},
            method: 'GET',
            path: '/api/channels',
        });
        const invalid = await exchange(carrierOrigin, {
            headers: {},
            method: 'GET',
            path: '/api/streams/live/11/hls',
        });
        const internalFailure = await exchange(carrierOrigin, {
            headers: {},
            method: 'GET',
            path: '/api/channels',
        });

        expect(valid.status).toBe(200);
        expect(valid.headers).toMatchObject({
            'cache-control': 'private, no-cache, no-store, must-revalidate',
            expires: '-1',
            pragma: 'no-cache',
        });
        expect(JSON.parse(valid.body.toString('utf8'))).toEqual([{ id: 11, name: 'synthetic-channel' }]);

        expect(invalid.status).toBe(400);
        expect(startLiveHLSStream).not.toHaveBeenCalled();
        expect(getOwner).not.toHaveBeenCalledWith('IStreamApiModel');

        expect(internalFailure.status).toBe(500);
        expect(JSON.parse(internalFailure.body.toString('utf8'))).toEqual({
            code: 500,
            errors: 'synthetic-owner-failure',
            message: 'Internal Server Error',
        });
        expect(getChannels).toHaveBeenCalledTimes(2);

        expect(accessLogger.isLevelEnabled).toHaveBeenCalled();
        expect(accessLogger.log).toHaveBeenCalledTimes(3);
        const lines = accessLogger.log.mock.calls.map(([, line]) => line as string);
        expect(lines.filter(line => line.includes('GET /api/channels '))).toHaveLength(2);
        expect(lines.filter(line => line.includes('GET /api/streams/live/11/hls '))).toHaveLength(1);
    });
});

describe('Service Interface response content types [SI-4.2]', () => {
    it('preserves the representative playlist, image, log, video, XML, and download wire headers', async () => {
        const getLogo = vi.fn().mockResolvedValue(Buffer.from('synthetic-logo'));
        const getIdFilePath = vi.fn().mockResolvedValue(resourceFile);
        const getFullFilePath = vi.fn().mockResolvedValue({ mime: 'video/mp2t', path: resourceFile });
        const getM3u8 = vi.fn().mockResolvedValue({
            name: 'synthetic.m3u8',
            playList: '#EXTM3U\nsynthetic.ts',
        });
        const getEpg = vi.fn().mockResolvedValue('<tv>synthetic</tv>');
        vi.spyOn(modelContainer, 'get').mockImplementation((token: string) => {
            if (token === 'IChannelApiModel') return { getLogo };
            if (token === 'IDropLogApiModel') return { getIdFilePath };
            if (token === 'IIPTVApiModel') return { getEpg };
            if (token === 'IVideoApiModel') return { getFullFilePath, getM3u8 };
            throw new Error(`Unexpected owner ${token}`);
        });

        const playlist = await exchange(origin, {
            headers: { Host: 'receiver.invalid', 'User-Agent': 'synthetic-agent' },
            method: 'GET',
            path: '/api/videos/22/playlist',
        });
        const image = await exchange(origin, {
            headers: {},
            method: 'GET',
            path: '/api/channels/11/logo',
        });
        const log = await exchange(origin, {
            headers: {},
            method: 'GET',
            path: '/api/dropLogs/32?maxsize=4096',
        });
        const video = await exchange(origin, {
            headers: {},
            method: 'GET',
            path: '/api/videos/22?isDownload=false',
        });
        const xml = await exchange(origin, {
            headers: {},
            method: 'GET',
            path: '/api/iptv/epg.xml?days=1&isHalfWidth=false',
        });
        const download = await exchange(origin, {
            headers: {},
            method: 'GET',
            path: '/api/videos/22?isDownload=true',
        });

        expect(playlist.status).toBe(200);
        expect(playlist.headers['content-type']).toBe('application/x-mpegURL; charset="UTF-8"');
        expect(playlist.body.toString('utf8')).toBe('#EXTM3U\nsynthetic.ts');

        expect(image.status).toBe(200);
        expect(image.headers['content-type']).toBe('image/png');
        expect(image.body.toString('utf8')).toBe('synthetic-logo');

        expect(log.status).toBe(200);
        expect(log.headers['content-type']).toBe('text/plain; charset=utf-8');
        expect(log.body.toString('utf8')).toBe('synthetic-resource');

        expect(video.status).toBe(200);
        expect(video.headers['content-type']).toBe('video/mp2t');
        expect(video.body.toString('utf8')).toBe('synthetic-resource');

        expect(xml.status).toBe(200);
        expect(xml.headers['content-type']).toBe('application/xml; charset="UTF-8"');
        expect(xml.body.toString('utf8')).toBe('<tv>synthetic</tv>');

        expect(download.status).toBe(200);
        expect(download.headers['content-type']).toBe('application/octet-stream');
        expect(download.headers['content-disposition']).toBe("attachment; filename*=utf-8'ja'synthetic-resource.bin;");
        expect(download.body.toString('utf8')).toBe('synthetic-resource');
    });
});

describe('Service Interface real HTTP byte range matrix [INT#SI-9.4]', () => {
    it('assigns all 12 named range cases exactly once', () => {
        expect(rangeCases.map(({ name }) => name)).toEqual([
            'range-absent',
            'range-empty',
            'range-normal-closed',
            'range-open-ended',
            'range-suffix',
            'range-oversized-suffix',
            'range-start-equals-end',
            'range-start-greater-than-end',
            'range-start-equals-file-size',
            'range-end-equals-file-size',
            'range-malformed',
            'range-multiple',
        ]);
    });

    it.each(rangeCases)(
        '$name preserves final wire bytes and file-handle ownership [INT#SI-9.4/$name]',
        async rangeCase => {
            const fs = require('node:fs') as typeof import('node:fs');
            const actualCreateReadStream = fs.createReadStream.bind(fs);
            const releases: Promise<void>[] = [];
            let releaseCount = 0;
            const createReadStream = vi.fn(((...args: unknown[]) => {
                const stream = actualCreateReadStream(...(args as Parameters<typeof actualCreateReadStream>));
                releases.push(
                    new Promise(resolve => {
                        stream.once('close', () => {
                            releaseCount += 1;
                            resolve();
                        });
                    }),
                );
                return stream;
            }) as typeof fs.createReadStream);
            setTestCreateReadStream(createReadStream);
            const getFullFilePath = vi.fn().mockResolvedValue({ mime: 'video/mp2t', path: rangeResourceFile });
            vi.spyOn(modelContainer, 'get').mockReturnValue({ getFullFilePath });
            const headers = rangeCase.range === undefined ? {} : { Range: rangeCase.range };

            const response = await rawExchange(origin, {
                headers,
                method: 'GET',
                path: '/api/videos/22?isDownload=false',
            });
            await Promise.all(releases);

            expect(response.status).toBe(rangeCase.status);
            expect(response.headers['content-range']).toBe(rangeCase.contentRange);
            expect(response.headers['content-length']).toBe(rangeCase.contentLength);
            expect(response.body).toEqual(Buffer.from(rangeCase.body));
            expect(createReadStream).toHaveBeenCalledTimes(rangeCase.createReadStreamCount);
            expect(releaseCount).toBe(rangeCase.releaseCount);
            expect(getFullFilePath).toHaveBeenCalledOnce();
            expect(getFullFilePath).toHaveBeenCalledWith(22);
        },
    );

    it('releases a real range stream once when the client closes before stream completion [INT#SI-9.4/range-client-close-race]', async () => {
        const fs = require('node:fs') as typeof import('node:fs');
        const actualCreateReadStream = fs.createReadStream.bind(fs);
        const pipeStarted = deferred<void>();
        const streamClosed = deferred<void>();
        const clientClosed = deferred<void>();
        const activeStreams = new Set<import('node:fs').ReadStream>();
        const deadlines = new Set<ReturnType<typeof setTimeout>>();
        let closeCount = 0;
        let endCount = 0;
        let heldStream: import('node:fs').ReadStream | undefined;
        let listener: Server | undefined;
        let socket: import('node:net').Socket | undefined;
        const within = <T>(promise: Promise<T>, label: string): Promise<T> =>
            new Promise<T>((resolve, reject) => {
                const timer = setTimeout(() => {
                    deadlines.delete(timer);
                    reject(new Error(`Timed out waiting for ${label}`));
                }, 2_000);
                deadlines.add(timer);
                promise.then(
                    value => {
                        clearTimeout(timer);
                        deadlines.delete(timer);
                        resolve(value);
                    },
                    error => {
                        clearTimeout(timer);
                        deadlines.delete(timer);
                        reject(error);
                    },
                );
            });
        const onStreamClose = (): void => {
            closeCount += 1;
            activeStreams.delete(heldStream!);
            streamClosed.resolve();
        };
        const onStreamEnd = (): void => {
            endCount += 1;
        };
        const onClientClose = (): void => clientClosed.resolve();
        const createReadStream = vi.fn(((...args: unknown[]) => {
            const stream = actualCreateReadStream(...(args as Parameters<typeof actualCreateReadStream>));
            heldStream = stream;
            activeStreams.add(stream);
            stream.once('close', onStreamClose);
            stream.once('end', onStreamEnd);
            Reflect.set(
                stream,
                'pipe',
                vi.fn((destination: NodeJS.WritableStream) => {
                    pipeStarted.resolve();
                    return destination;
                }),
            );
            return stream;
        }) as typeof fs.createReadStream);
        setTestCreateReadStream(createReadStream);
        const getFullFilePath = vi.fn().mockResolvedValue({ mime: 'video/mp2t', path: rangeResourceFile });
        const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue({ getFullFilePath });

        try {
            const service = createOpenApiService();
            listener = createHttpServer(service.app);
            ephemeralServers.push(listener);
            const raceOrigin = await listenWithProtocol(listener, 'http');
            const target = new URL(raceOrigin);
            socket = createConnection({ host: target.hostname, port: Number(target.port) });
            socket.once('close', onClientClose);
            await within(
                new Promise<void>((resolve, reject) => {
                    socket!.once('connect', resolve);
                    socket!.once('error', reject);
                }),
                'client connection',
            );
            socket.write(
                [
                    'GET /api/videos/22?isDownload=false HTTP/1.1',
                    `Host: ${target.host}`,
                    'Range: bytes=0-7',
                    'Connection: keep-alive',
                    '',
                    '',
                ].join('\r\n'),
            );
            await within(pipeStarted.promise, 'real file stream pipe');
            expect(heldStream?.readableEnded).toBe(false);

            socket.destroy();
            await within(Promise.all([clientClosed.promise, streamClosed.promise]), 'client and stream close');

            expect(getOwner).toHaveBeenCalledOnce();
            expect(getOwner).toHaveBeenCalledWith('IVideoApiModel');
            expect(getFullFilePath).toHaveBeenCalledOnce();
            expect(getFullFilePath).toHaveBeenCalledWith(22);
            expect(createReadStream).toHaveBeenCalledOnce();
            expect(closeCount).toBe(1);
            expect(endCount).toBe(0);
            expect(activeStreams.size).toBe(0);
            expect(heldStream?.closed).toBe(true);
            expect(socket.destroyed).toBe(true);
            expect(socket.listenerCount('close', onClientClose)).toBe(0);
            expect(heldStream?.listenerCount('close', onStreamClose)).toBe(0);
            heldStream?.removeListener('end', onStreamEnd);
            expect(heldStream?.listenerCount('end', onStreamEnd)).toBe(0);
            expect(deadlines.size).toBe(0);

            await close(listener);
            expect(listener.listening).toBe(false);
        } finally {
            socket?.removeListener('close', onClientClose);
            if (socket?.destroyed !== true) socket?.destroy();
            heldStream?.removeListener('end', onStreamEnd);
            if (heldStream?.closed !== true) heldStream?.close();
            for (const timer of deadlines) clearTimeout(timer);
            deadlines.clear();
            if (listener?.listening === true) await close(listener);
            getOwner.mockRestore();
            createReadStream.mockRestore();
        }
    });
});

const streamTerminalCases = streamRouteCases.flatMap(contract =>
    (['close', 'exit', 'error'] as const).map(terminal => ({ contract, terminal })),
);

describe('Service Interface real HTTP stream terminal matrix [SI-2.3]', () => {
    it('covers all six routes by all three owned-stream terminal events', () => {
        expect(streamTerminalCases).toHaveLength(18);
    });

    it.each(streamTerminalCases)(
        'GET /$contract.file settles its real HTTP connection once on $terminal',
        async ({ contract, terminal }: { contract: StreamRouteCase; terminal: 'close' | 'error' | 'exit' }) => {
            vi.useFakeTimers();
            const started = deferred<void>();
            const stopped = deferred<void>();
            const stream = Object.assign(new EventEmitter(), { pipe: vi.fn() });
            const start = vi.fn(async () => {
                started.resolve();
                return { stream, streamId: 81 };
            });
            const keep = vi.fn();
            const stop = vi.fn(async () => stopped.resolve());
            const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue({
                [contract.ownerMethod]: start,
                keep,
                stop,
            });

            const responsePromise = exchange(origin, {
                headers: {},
                method: 'GET',
                path: requestPath(contract.file, contract.request),
            });
            await started.promise;
            await Promise.resolve();
            await Promise.resolve();

            stream.emit(terminal, terminal === 'error' ? new Error('synthetic-stream-terminal') : undefined);
            const response = await responsePromise;
            await stopped.promise;

            expect(getOwner).toHaveBeenCalledOnce();
            expect(getOwner).toHaveBeenCalledWith('IStreamApiModel');
            expect(start).toHaveBeenCalledOnce();
            expect(start).toHaveBeenCalledWith(...copy(contract.ownerArgs));
            expect(stream.pipe).toHaveBeenCalledOnce();
            expect(response.status).toBe(200);
            expectContentType(response, contract.contentType);
            expect(stop).toHaveBeenCalledOnce();
            expect(stop).toHaveBeenCalledWith(81, true);
            expect(keep).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
            await vi.advanceTimersByTimeAsync(30_000);
            expect(keep).not.toHaveBeenCalled();
            expect(stop).toHaveBeenCalledOnce();
            expect(vi.getTimerCount()).toBe(0);
        },
    );
});

const publicUrlCarrierCases = (['http', 'https', 'forwarded-https'] as const).flatMap(mode =>
    ([undefined, '/epg'] as const).map(subDirectory => ({ mode, subDirectory })),
);

describe('Service Interface synthetic listener public URL matrix [SI-1.3]', () => {
    it('covers HTTP, real HTTPS, and forwarded HTTPS with and without subDirectory', () => {
        expect(publicUrlCarrierCases).toHaveLength(6);
    });

    it.each(publicUrlCarrierCases)(
        '$mode listener with subDirectory=$subDirectory passes exact Host and secure carriers to playlist and Kodi',
        async ({ mode, subDirectory }) => {
            const service = createOpenApiService(subDirectory);
            let listener: Server;
            if (mode === 'https') {
                const [privateMaterial, certificateMaterial] = await Promise.all([
                    readFile(join(process.cwd(), 'test/server/fixtures/configuration/synthetic-tls-key.pem')),
                    readFile(join(process.cwd(), 'test/server/fixtures/configuration/synthetic-tls-cert.pem')),
                ]);
                const tlsOptions: Record<string, Buffer> = {};
                Reflect.set(tlsOptions, 'key', privateMaterial);
                Reflect.set(tlsOptions, 'cert', certificateMaterial);
                listener = createHttpsServer(tlsOptions, service.app) as unknown as Server;
            } else {
                listener = createHttpServer(service.app);
            }
            ephemeralServers.push(listener);
            const listenerProtocol = mode === 'https' ? 'https' : 'http';
            const carrierOrigin = await listenWithProtocol(listener, listenerProtocol);
            const isSecure = mode !== 'http';
            const forwarded = mode === 'forwarded-https' ? { 'X-Forwarded-Proto': 'https' } : {};
            const host = 'receiver.invalid:8443';
            const getM3u8 = vi.fn().mockResolvedValue({
                name: 'synthetic.m3u8',
                playList: '#EXTM3U\n./streamfiles/stream81.m3u8',
            });
            const sendToKodi = vi.fn().mockResolvedValue(undefined);
            const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue({ getM3u8, sendToKodi });
            const base = subDirectory ?? '';

            const playlist = await exchange(carrierOrigin, {
                headers: { Host: host, 'User-Agent': 'synthetic-agent', ...forwarded },
                method: 'GET',
                path: `${base}/api/videos/22/playlist`,
            });
            const kodiBody = Buffer.from(JSON.stringify({ kodiName: 'living-room' }));
            const kodi = await exchange(carrierOrigin, {
                body: kodiBody,
                headers: {
                    'Content-Length': String(kodiBody.length),
                    'Content-Type': 'application/json',
                    Host: host,
                    ...forwarded,
                },
                method: 'POST',
                path: `${base}/api/videos/22/kodi`,
            });

            expect(getOwner).toHaveBeenCalledTimes(2);
            expect(getOwner).toHaveBeenNthCalledWith(1, 'IVideoApiModel');
            expect(getOwner).toHaveBeenNthCalledWith(2, 'IVideoApiModel');
            expect(getM3u8).toHaveBeenCalledOnce();
            expect(getM3u8).toHaveBeenCalledWith(host, isSecure, 22);
            expect(playlist.status).toBe(200);
            expectContentType(playlist, 'application/x-mpegURL');
            expect(playlist.body.toString('utf8')).toBe('#EXTM3U\n./streamfiles/stream81.m3u8');
            expect(sendToKodi).toHaveBeenCalledOnce();
            expect(sendToKodi).toHaveBeenCalledWith(host, isSecure, 'living-room', 22);
            expect(kodi.status).toBe(200);
            expectContentType(kodi, 'application/json');
            expect(JSON.parse(kodi.body.toString('utf8'))).toEqual({ code: 200 });
        },
    );
});

describe('Service Interface IPTV public URL builder carrier [Task 2.4]', () => {
    it.each(publicUrlCarrierCases)(
        '$mode listener with subDirectory=$subDirectory preserves the IPTV provider body while supplying exact typed URLs',
        async ({ mode, subDirectory }) => {
            const service = createOpenApiService(subDirectory);
            let listener: Server;
            if (mode === 'https') {
                const [privateMaterial, certificateMaterial] = await Promise.all([
                    readFile(join(process.cwd(), 'test/server/fixtures/configuration/synthetic-tls-key.pem')),
                    readFile(join(process.cwd(), 'test/server/fixtures/configuration/synthetic-tls-cert.pem')),
                ]);
                const tlsOptions: Record<string, Buffer> = {};
                Reflect.set(tlsOptions, 'key', privateMaterial);
                Reflect.set(tlsOptions, 'cert', certificateMaterial);
                listener = createHttpsServer(tlsOptions, service.app) as unknown as Server;
            } else {
                listener = createHttpServer(service.app);
            }
            ephemeralServers.push(listener);
            const listenerProtocol = mode === 'https' ? 'https' : 'http';
            const carrierOrigin = await listenWithProtocol(listener, listenerProtocol);
            const isSecure = mode !== 'http';
            const forwarded = mode === 'forwarded-https' ? { 'X-Forwarded-Proto': 'https' } : {};
            const host = 'receiver.invalid:8443';
            const getChannelList = vi.fn(async (input: any) =>
                [input.publicUrls.channelLogoUrl(42), input.publicUrls.liveM2tsUrl(42, input.mode)].join('\n'),
            );
            const getEpg = vi.fn(async () => '<tv>synthetic guide</tv>');
            vi.spyOn(modelContainer, 'get').mockImplementation((token: string) => {
                if (token === 'IConfiguration') return { getConfig: () => ({ subDirectory }) };
                if (token === 'IIPTVApiModel') return { getChannelList, getEpg };
                throw new Error(`Unexpected owner ${token}`);
            });
            const base = subDirectory ?? '';
            const scheme = isSecure ? 'https' : 'http';

            const playlist = await exchange(carrierOrigin, {
                headers: { Host: host, ...forwarded },
                method: 'GET',
                path: `${base}/api/iptv/channel.m3u8?mode=1.8&isHalfWidth=true`,
            });
            const guide = await exchange(carrierOrigin, {
                headers: { Host: host, ...forwarded },
                method: 'GET',
                path: `${base}/api/iptv/epg.xml?days=1.8&isHalfWidth=false`,
            });
            const expectedPlaylist =
                `${scheme}://${host}${base}/api/channels/42/logo\n` +
                `${scheme}://${host}${base}/api/streams/live/42/m2ts?mode=1`;

            expect(getChannelList).toHaveBeenCalledWith({
                isHalfWidth: true,
                mode: 1,
                publicUrls: expect.any(Object),
            });
            expect(playlist.status).toBe(200);
            expectContentType(playlist, 'application/x-mpegURL; charset="UTF-8"');
            expect(playlist.body.toString('utf8')).toBe(expectedPlaylist);
            expect(getEpg).toHaveBeenCalledWith(1, false);
            expect(guide.status).toBe(200);
            expectContentType(guide, 'application/xml; charset="UTF-8"');
            expect(guide.body.toString('utf8')).toBe('<tv>synthetic guide</tv>');
        },
    );

    it('passes the OpenAPI-coerced negative mode without a second conversion', async () => {
        const service = createOpenApiService();
        const listener = createHttpServer(service.app);
        ephemeralServers.push(listener);
        const carrierOrigin = await listenWithProtocol(listener, 'http');
        const getChannelList = vi.fn(async (input: any) => input.publicUrls.liveM2tsUrl(42, input.mode));
        vi.spyOn(modelContainer, 'get').mockImplementation((token: string) => {
            if (token === 'IConfiguration') return { getConfig: () => ({}) };
            if (token === 'IIPTVApiModel') return { getChannelList };
            throw new Error(`Unexpected owner ${token}`);
        });

        const playlist = await exchange(carrierOrigin, {
            headers: { Host: 'receiver.invalid' },
            method: 'GET',
            path: '/api/iptv/channel.m3u8?mode=-1.2&isHalfWidth=false',
        });

        expect(getChannelList).toHaveBeenCalledWith({
            isHalfWidth: false,
            mode: -2,
            publicUrls: expect.any(Object),
        });
        expect(playlist.status).toBe(200);
        expectContentType(playlist, 'application/x-mpegURL; charset="UTF-8"');
        expect(playlist.body.toString('utf8')).toBe('http://receiver.invalid/api/streams/live/42/m2ts?mode=-2');
    });

    it('keeps public URL builders isolated between consecutive requests on one listener and provider', async () => {
        const service = createOpenApiService('/epg');
        const listener = createHttpServer(service.app);
        ephemeralServers.push(listener);
        const carrierOrigin = await listenWithProtocol(listener, 'http');
        const builders: any[] = [];
        const getChannelList = vi.fn(async (input: any) => {
            builders.push(input.publicUrls);
            return [input.publicUrls.channelLogoUrl(42), input.publicUrls.liveM2tsUrl(42, input.mode)].join('\n');
        });
        vi.spyOn(modelContainer, 'get').mockImplementation((token: string) => {
            if (token === 'IConfiguration') return { getConfig: () => ({ subDirectory: '/epg' }) };
            if (token === 'IIPTVApiModel') return { getChannelList };
            throw new Error(`Unexpected owner ${token}`);
        });

        const first = await exchange(carrierOrigin, {
            headers: { Host: 'first.invalid' },
            method: 'GET',
            path: '/epg/api/iptv/channel.m3u8?mode=1&isHalfWidth=false',
        });
        const second = await exchange(carrierOrigin, {
            headers: { Host: 'second.invalid:8443', 'X-Forwarded-Proto': 'https' },
            method: 'GET',
            path: '/epg/api/iptv/channel.m3u8?mode=2&isHalfWidth=true',
        });

        expect(first.status).toBe(200);
        expect(first.body.toString('utf8')).toBe(
            'http://first.invalid/epg/api/channels/42/logo\n' +
                'http://first.invalid/epg/api/streams/live/42/m2ts?mode=1',
        );
        expect(second.status).toBe(200);
        expect(second.body.toString('utf8')).toBe(
            'https://second.invalid:8443/epg/api/channels/42/logo\n' +
                'https://second.invalid:8443/epg/api/streams/live/42/m2ts?mode=2',
        );
        expect(builders).toHaveLength(2);
        expect(builders[0]).not.toBe(builders[1]);
        expect(Object.isFrozen(builders[0])).toBe(true);
        expect(Object.isFrozen(builders[1])).toBe(true);
        expect(builders[0].channelLogoUrl(42)).toBe('http://first.invalid/epg/api/channels/42/logo');
        expect(builders[0].liveM2tsUrl(42, 1)).toBe('http://first.invalid/epg/api/streams/live/42/m2ts?mode=1');
        expect(builders[1].channelLogoUrl(42)).toBe('https://second.invalid:8443/epg/api/channels/42/logo');
        expect(builders[1].liveM2tsUrl(42, 2)).toBe('https://second.invalid:8443/epg/api/streams/live/42/m2ts?mode=2');
    });
});

describe('Service Interface actual HTTP/HTTPS listener surfaces [Task 7.1]', () => {
    it.each(listenerMatrixCases)(
        'serves Web, API, and notification surfaces on the configured topology: $name',
        async caseDefinition => {
            const fixture = await startListenerFixture(caseDefinition);

            try {
                await Promise.all(fixture.applications.map(assertApplicationSurfaces));
                const connections = await Promise.all(fixture.notificationListeners.map(connectPollingSocketIoClient));
                for (const connection of connections) {
                    expect(connection.confirmation).toMatchObject({ status: 200 });
                    expect(connection.confirmation.body).toMatch(/^40\{"sid":/u);
                }

                for (const application of fixture.applications.filter(listener => !listener.notification)) {
                    const response = await listenerExchange(
                        await originOf(application),
                        '/socket.io/?EIO=4&transport=polling',
                    );
                    expect(response.body).not.toMatch(/^0\{/u);
                    expect(response.status).toBe(404);
                }

                vi.useFakeTimers();
                fixture.socketIoManageModel.notifyClient();
                await vi.advanceTimersByTimeAsync(200);
                vi.useRealTimers();

                const deliveries = await Promise.all(
                    connections.map(async (connection, index) =>
                        listenerExchange(await originOf(fixture.notificationListeners[index]), connection.sessionPath),
                    ),
                );
                expect(deliveries).toHaveLength(fixture.notificationListeners.length);
                for (const delivery of deliveries) {
                    expect(delivery).toMatchObject({
                        body: '42["updateStatus"]',
                        status: 200,
                    });
                }
            } finally {
                vi.useRealTimers();
                await fixture.cleanup();
            }
        },
    );
});

describe('Service Interface CORS and no common application authentication [Task 7.2][LS#SI-8.4][LS#SI-8.5][LS#SI-8.6]', () => {
    it('allows distinct origins for Web, API, and Socket.IO while every representative public surface works without an Authorization header', async () => {
        const fixture = await startPublicSurfaceFixture(true);

        try {
            const origins = ['https://first.synthetic.invalid', 'https://second.synthetic.invalid'];

            const corsResponses = await Promise.all(
                origins.flatMap(origin => [
                    listenerExchange(fixture.origin, '/', { headers: { Origin: origin } }),
                    listenerExchange(fixture.origin, '/api/config', { headers: { Origin: origin } }),
                ]),
            );
            for (const [index, response] of corsResponses.entries()) {
                const route = index % 2 === 0 ? 'Web' : 'API';
                expect(response.status, `Task 7.2 ${route} CORS response: ${response.body.toString('utf8')}`).toBe(200);
                expect(response.headers['access-control-allow-origin']).toBe('*');
            }

            const notification = await connectPollingSocketIoClient(fixture.notificationListener, {
                headers: { Origin: origins[1] },
            });
            const [web, api, image, video, document] = await Promise.all([
                listenerExchange(fixture.origin, '/', { headers: { Origin: origins[0] } }),
                listenerExchange(fixture.origin, '/api/config', { headers: { Origin: origins[0] } }),
                listenerExchange(fixture.origin, '/thumbnail/task-7-2-thumbnail.png'),
                listenerExchange(fixture.origin, '/streamfiles/task-7-2-video.ts'),
                listenerExchange(fixture.origin, '/api/docs'),
            ]);
            expect(web).toMatchObject({ body: 'task-7-2-web', status: 200 });
            expect(api).toMatchObject({ body: JSON.stringify({ broadcast: true }), status: 200 });
            expect(image).toMatchObject({ status: 200 });
            expect(image.headers['content-type']).toContain('image/png');
            expect(video).toMatchObject({ status: 200 });
            expect(video.headers['content-type']).toContain('video/mpeg');
            expect(document).toMatchObject({ status: 200 });
            expect(notification.confirmation).toMatchObject({
                headers: { 'access-control-allow-origin': '*' },
                status: 200,
            });
            for (const response of [web, api, image, video, document, notification.confirmation]) {
                expect(response.headers['www-authenticate']).toBeUndefined();
            }
        } finally {
            await fixture.cleanup();
        }
    });
});

describe('Service Interface temporary static and owner-port carrier', () => {
    it.each([undefined, '/epg'] as const)(
        'serves static/HLS and public information below subDirectory=%s while passing external and IPTV URLs to owners',
        async subDirectory => {
            const fixtureRoot = await mkdtemp(join(temporaryRoot, 'task-8-2-static-'));
            const frontend = join(fixtureRoot, 'frontend');
            const thumbnail = join(fixtureRoot, 'thumbnail');
            const streamFiles = join(fixtureRoot, 'streamfiles');
            const originalFrontendDirectory = ServiceServer.FRONTEND_DIST_DIR;
            const base = subDirectory ?? '';
            const host = 'receiver.invalid:8443';
            const publicConfig = { broadcast: true, recorded: ['primary'], socketIOPort: 7777 };
            const getConfig = vi.fn(async () => publicConfig);
            const getM3u8 = vi.fn(async () => ({
                name: 'synthetic.m3u8',
                playList: '#EXTM3U\n./streamfiles/stream81.m3u8',
            }));
            const sendToKodi = vi.fn(async () => undefined);
            const getChannelList = vi.fn(async (input: any) =>
                [input.publicUrls.channelLogoUrl(42), input.publicUrls.liveM2tsUrl(42, input.mode)].join('\n'),
            );
            const getEpg = vi.fn(async () => '<tv>synthetic guide</tv>');

            await Promise.all([mkdir(frontend), mkdir(thumbnail), mkdir(streamFiles)]);
            await Promise.all([
                writeFile(join(frontend, 'index.html'), 'task-8-2-frontend'),
                writeFile(join(thumbnail, 'thumb.txt'), 'task-8-2-thumbnail'),
                writeFile(join(streamFiles, 'stream81.m3u8'), 'task-8-2-hls'),
            ]);

            try {
                ServiceServer.FRONTEND_DIST_DIR = frontend;
                const service = createOpenApiService(subDirectory);
                service.config.streamFilePath = streamFiles;
                service.config.thumbnail = thumbnail;
                service.setStaticFiles();
                const listener = createHttpServer(service.app);
                ephemeralServers.push(listener);
                const carrierOrigin = await listenWithProtocol(listener, 'http');
                vi.spyOn(modelContainer, 'get').mockImplementation((token: string) => {
                    if (token === 'IConfigApiModel') return { getConfig };
                    if (token === 'IVideoApiModel') return { getM3u8, sendToKodi };
                    if (token === 'IConfiguration') return { getConfig: () => ({ subDirectory }) };
                    if (token === 'IIPTVApiModel') return { getChannelList, getEpg };
                    throw new Error(`Unexpected owner ${token}`);
                });

                const [frontendResponse, thumbnailResponse, hlsResponse, configResponse, docsResponse] =
                    await Promise.all([
                        exchange(carrierOrigin, { headers: {}, method: 'GET', path: `${base}/` }),
                        exchange(carrierOrigin, { headers: {}, method: 'GET', path: `${base}/thumbnail/thumb.txt` }),
                        exchange(carrierOrigin, {
                            headers: {},
                            method: 'GET',
                            path: `${base}/streamfiles/stream81.m3u8`,
                        }),
                        exchange(carrierOrigin, { headers: {}, method: 'GET', path: `${base}/api/config` }),
                        exchange(carrierOrigin, { headers: {}, method: 'GET', path: `${base}/api/docs` }),
                    ]);
                const playlist = await exchange(carrierOrigin, {
                    headers: { Host: host, 'User-Agent': 'synthetic-agent', 'X-Forwarded-Proto': 'https' },
                    method: 'GET',
                    path: `${base}/api/videos/22/playlist`,
                });
                const kodiBody = Buffer.from(JSON.stringify({ kodiName: 'living-room' }));
                const kodi = await exchange(carrierOrigin, {
                    body: kodiBody,
                    headers: {
                        'Content-Length': String(kodiBody.length),
                        'Content-Type': 'application/json',
                        Host: host,
                        'X-Forwarded-Proto': 'https',
                    },
                    method: 'POST',
                    path: `${base}/api/videos/22/kodi`,
                });
                const [iptv, epg] = await Promise.all([
                    exchange(carrierOrigin, {
                        headers: { Host: host, 'X-Forwarded-Proto': 'https' },
                        method: 'GET',
                        path: `${base}/api/iptv/channel.m3u8?mode=1.8&isHalfWidth=true`,
                    }),
                    exchange(carrierOrigin, {
                        headers: { Host: host },
                        method: 'GET',
                        path: `${base}/api/iptv/epg.xml?days=1.8&isHalfWidth=false`,
                    }),
                ]);

                expect(frontendResponse).toMatchObject({ body: Buffer.from('task-8-2-frontend'), status: 200 });
                expect(thumbnailResponse).toMatchObject({ body: Buffer.from('task-8-2-thumbnail'), status: 200 });
                expect(hlsResponse).toMatchObject({ body: Buffer.from('task-8-2-hls'), status: 200 });
                expect(configResponse.status).toBe(200);
                expect(JSON.parse(configResponse.body.toString('utf8'))).toEqual(publicConfig);
                expect(docsResponse.status).toBe(200);
                expect(JSON.parse(docsResponse.body.toString('utf8')).paths['/iptv/channel.m3u8'].get).toBeTypeOf(
                    'object',
                );
                expect(getConfig).toHaveBeenCalledExactlyOnceWith(false);
                expect(getM3u8).toHaveBeenCalledExactlyOnceWith(host, true, 22);
                expect(playlist).toMatchObject({
                    body: Buffer.from('#EXTM3U\n./streamfiles/stream81.m3u8'),
                    status: 200,
                });
                expect(sendToKodi).toHaveBeenCalledExactlyOnceWith(host, true, 'living-room', 22);
                expect(kodi.status).toBe(200);
                expect(getChannelList).toHaveBeenCalledExactlyOnceWith({
                    isHalfWidth: true,
                    mode: 1,
                    publicUrls: expect.any(Object),
                });
                expect(getEpg).toHaveBeenCalledExactlyOnceWith(1, false);
                const secureProtocol = 'https:';
                expect(iptv).toMatchObject({
                    body: Buffer.from(
                        secureProtocol +
                            '//' +
                            host +
                            `${base}/api/channels/42/logo\n` +
                            secureProtocol +
                            '//' +
                            host +
                            `${base}/api/streams/live/42/m2ts?mode=1`,
                    ),
                    status: 200,
                });
                expect(epg).toMatchObject({ body: Buffer.from('<tv>synthetic guide</tv>'), status: 200 });
            } finally {
                ServiceServer.FRONTEND_DIST_DIR = originalFrontendDirectory;
                await rm(fixtureRoot, { force: true, recursive: true });
            }
        },
    );

    it('ends a stalled multipart body at its controlled deadline and releases its listener resources exactly once', async () => {
        const realClearTimeout = global.clearTimeout;
        const realSetTimeout = global.setTimeout;
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const trackedTimers: Array<{ cleared: number; delay: number; fired: number; handle: unknown }> = [];
        const originalSetTimeout = global.setTimeout as any;
        const originalClearTimeout = global.clearTimeout as any;
        vi.spyOn(global, 'setTimeout').mockImplementation(((handler: any, delay?: number, ...args: any[]) => {
            const timer = { cleared: 0, delay: Number(delay ?? 0), fired: 0, handle: undefined as unknown };
            const wrapped = (...callbackArguments: unknown[]) => {
                timer.fired += 1;
                return typeof handler === 'function' ? handler(...callbackArguments) : undefined;
            };
            const handle = originalSetTimeout(wrapped, delay, ...args);
            timer.handle = handle;
            if (timer.delay === 300_000) trackedTimers.push(timer);
            return handle;
        }) as any);
        vi.spyOn(global, 'clearTimeout').mockImplementation(((handle: unknown) => {
            const timer = trackedTimers.find(candidate => candidate.handle === handle);
            if (timer !== undefined) timer.cleared += 1;
            return originalClearTimeout(handle);
        }) as any);
        const awaitWithRealDeadline = async <Value>(observation: string, operation: Promise<Value>): Promise<Value> => {
            let watchdog: ReturnType<typeof setTimeout> | undefined;
            try {
                return await Promise.race([
                    operation,
                    new Promise<never>((_resolve, reject) => {
                        watchdog = realSetTimeout(
                            () => reject(new Error(`Task82StalledMultipart${observation}WasNotObserved`)),
                            1_000,
                        );
                    }),
                ]);
            } finally {
                if (watchdog !== undefined) realClearTimeout(watchdog);
            }
        };
        const admission = new UploadAdmissionController(1);
        let releaseCount = 0;
        let captured:
            | {
                  readonly closeBaseline: number;
                  readonly finishBaseline: number;
                  readonly request: any;
                  readonly requestAbortBaseline: number;
                  readonly requestOnce: ReturnType<typeof vi.spyOn>;
                  readonly requestRemoveListener: ReturnType<typeof vi.spyOn>;
                  readonly response: any;
                  readonly responseRemoveListener: ReturnType<typeof vi.spyOn>;
              }
            | undefined;
        const originalUploadFile = ServiceServer.prototype.uploadFile;
        vi.spyOn(ServiceServer.prototype, 'uploadFile').mockImplementation(function (req: any, res: any, next: any) {
            captured = {
                closeBaseline: res.listenerCount('close'),
                finishBaseline: res.listenerCount('finish'),
                request: req,
                requestAbortBaseline: req.listenerCount('aborted'),
                // See the removeListener assertion below: captures the listener ServiceServer.uploadFile
                // registers via `req.once('aborted', onRequestAborted)` so it can be told apart from
                // multer's own leaked 'aborted' listener.
                requestOnce: vi.spyOn(req, 'once'),
                requestRemoveListener: vi.spyOn(req, 'removeListener'),
                response: res,
                responseRemoveListener: vi.spyOn(res, 'removeListener'),
            };
            return originalUploadFile.call(this, req, res, next);
        });
        const receiverTeardown = vi.spyOn(UploadBodyReceiverTeardown.prototype, 'teardownOnce');
        const service = createOpenApiService();
        service.uploadAdmission = {
            tryAcquire: () => {
                const lease = admission.tryAcquire();
                if (lease === null) return null;
                return {
                    releaseOnce: () => {
                        releaseCount += 1;
                        lease.releaseOnce();
                    },
                };
            },
        };
        const listener = service.app.listen(0, loopbackHost);
        ephemeralServers.push(listener);
        const serviceOrigin = await listen(listener);
        const outgoing = wireRequest(uploadContract);
        if (outgoing.body === undefined) throw new Error('Missing multipart upload body');
        const closing = Buffer.from('--epgstation-service-interface-synthetic-boundary--\r\n');
        const partial = outgoing.body.subarray(0, outgoing.body.length - closing.length);
        if (partial.length === outgoing.body.length) throw new Error('Missing multipart closing boundary');
        const target = new URL(serviceOrigin);
        const getOwner = vi.spyOn(modelContainer, 'get');
        let request: import('node:http').ClientRequest | undefined;

        try {
            let responseStarted = false;
            const response = new Promise<WireResponse>((resolve, reject) => {
                request = httpRequest(
                    {
                        headers: outgoing.headers,
                        hostname: target.hostname,
                        method: outgoing.method,
                        path: outgoing.path,
                        port: target.port,
                    },
                    incoming => {
                        responseStarted = true;
                        const chunks: Buffer[] = [];
                        incoming.on('data', chunk => chunks.push(Buffer.from(chunk)));
                        incoming.once('error', reject);
                        incoming.once('end', () =>
                            resolve({
                                body: Buffer.concat(chunks),
                                headers: incoming.headers,
                                status: incoming.statusCode ?? 0,
                            }),
                        );
                    },
                );
                request.once('error', error => {
                    if (!responseStarted) reject(error);
                });
                request.write(partial);
            });

            await awaitWithRealDeadline(
                'IncomingToken',
                vi.waitFor(async () => expect(await readdir(join(uploadRoot, 'incoming'))).toHaveLength(1)),
            );
            expect(request.writableEnded).toBe(false);
            expect(trackedTimers).toEqual([expect.objectContaining({ cleared: 0, fired: 0 })]);
            await vi.advanceTimersByTimeAsync(300_000);
            const timeoutResponse = await awaitWithRealDeadline('Response', response);

            expect(timeoutResponse.status).toBe(400);
            expect(timeoutResponse.headers['content-type']).toContain('application/json');
            expect(JSON.parse(timeoutResponse.body.toString('utf8'))).toBe('UploadReceiveTimeout');
            expect(receiverTeardown).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ message: 'UploadReceiveTimeout' }),
            );
            expect(getOwner).not.toHaveBeenCalled();
            await expect(readdir(join(uploadRoot, 'incoming'))).resolves.toEqual([]);
            await awaitWithRealDeadline(
                'Release',
                vi.waitFor(() => expect(releaseCount).toBe(1)),
            );
            expect(trackedTimers).toEqual([expect.objectContaining({ cleared: 0, fired: 1 })]);
            expect(vi.getTimerCount()).toBe(0);

            expect(captured).toBeDefined();
            expect(captured?.request.listenerCount('aborted')).toBe(captured?.requestAbortBaseline);
            expect(captured?.response.listenerCount('finish')).toBe(captured?.finishBaseline);
            expect(captured?.response.listenerCount('close')).toBe(captured?.closeBaseline);
            expect(captured?.response.writableEnded).toBe(true);
            /*
             * src/model/service/ServiceServer.ts's `uploadFile` removes multer 2.3.0's leaked
             * `req.on('aborted', ...)` listener itself (`removeUploadParserListeners`): multer registers
             * it with `.on` rather than `.once` and never removes it, so ServiceServer's own
             * `onFinalized` cleanup removes both that leaked listener and its own `onRequestAborted`
             * listener, meaning `req.removeListener('aborted', ...)` is called twice per request. Identify
             * the call that targets ServiceServer's own listener (captured via a `req.once` spy, since
             * `onRequestAborted` is registered with `req.once('aborted', onRequestAborted)`) and assert
             * that one happens exactly once; `listenerCount('aborted')` above already proves no listener
             * -- multer's leaked one included -- is left behind.
             */
            const ownAbortedRegistrations = captured?.requestOnce.mock.calls.filter(([event]) => event === 'aborted');
            expect(ownAbortedRegistrations).toHaveLength(1);
            const ownAbortedListener = ownAbortedRegistrations?.[0]?.[1];
            expect(
                captured?.requestRemoveListener.mock.calls.filter(
                    ([event, listener]) => event === 'aborted' && listener === ownAbortedListener,
                ),
            ).toHaveLength(1);
            expect(captured?.responseRemoveListener.mock.calls.filter(([event]) => event === 'finish')).toHaveLength(1);
            expect(captured?.responseRemoveListener.mock.calls.filter(([event]) => event === 'close')).toHaveLength(1);
            const replacementLease = admission.tryAcquire();
            expect(replacementLease).not.toBeNull();
            replacementLease?.releaseOnce();
        } finally {
            request?.destroy();
        }
    }, 10_000);
});

describe('Service Interface recorded resource-use owner integration [INT#SI-9.4]', () => {
    it('consumes one generation-local Task 8.4 resource-use binding through the Service child without direct DB access', async () => {
        const initialMessageListeners = new Set(process.listeners('message'));
        try {
            const first = createRecordedUseContainer();
            const firstClient = first.get<any>('IIPCClient');
            const firstEncodingToken = { generation: 'first-encoding' };
            const firstDeliveryToken = { generation: 'first-delivery' };
            const firstRegister = vi.spyOn(firstClient.recordedUseSnapshotHandlerRegistrationPort, 'register');
            const firstAcquire = vi
                .spyOn(firstClient.recordedResourceUseClient, 'acquire')
                .mockResolvedValueOnce({ token: firstEncodingToken })
                .mockResolvedValueOnce({ token: firstDeliveryToken });
            const firstRelease = vi
                .spyOn(firstClient.recordedResourceUseClient, 'release')
                .mockResolvedValue(undefined);
            const encodingPort = first.get<any>('EncodingRecordedResourceUsePort');
            const deliveryPort = first.get<any>('DeliveryRecordedResourceUsePort');

            expect(() => encodingPort.acquire(71, 'encoding')).toThrow('RecordedResourceUseClientNotBound');
            await expect(deliveryPort.acquire(72, 'delivery')).rejects.toThrow('RecordedResourceUseClientNotBound');

            first.get('IEncodeFinishModel');
            expect(firstRegister).toHaveBeenCalledOnce();
            expect(firstRegister.mock.calls[0][0].getSnapshot()).toEqual({ recordedIds: [], status: 'known' });

            const firstEncoding = first.get<any>('IEncodeManageModel');
            await expect(firstEncoding.push(recordedUseEncodeOption)).rejects.toThrow(
                'synthetic encoder construction failure',
            );
            expect(firstAcquire).toHaveBeenNthCalledWith(1, 71, 'encoding');
            expect(firstRelease).toHaveBeenNthCalledWith(1, firstEncodingToken);

            const lease = await deliveryPort.acquire(72, 'delivery');
            await expect(lease.release()).resolves.toBeUndefined();
            expect(firstAcquire).toHaveBeenNthCalledWith(2, 72, 'delivery');
            expect(firstRelease).toHaveBeenNthCalledWith(2, firstDeliveryToken);

            const second = createRecordedUseContainer();
            const secondClient = second.get<any>('IIPCClient');
            const secondRegister = vi.spyOn(secondClient.recordedUseSnapshotHandlerRegistrationPort, 'register');
            second.get('IEncodeFinishModel');
            expect(secondClient).not.toBe(firstClient);
            expect(secondRegister).toHaveBeenCalledOnce();
            expect(secondRegister.mock.calls[0][0].getSnapshot()).toEqual({ recordedIds: [], status: 'known' });
        } finally {
            for (const listener of process.listeners('message')) {
                if (!initialMessageListeners.has(listener)) process.removeListener('message', listener);
            }
        }
    });
});
