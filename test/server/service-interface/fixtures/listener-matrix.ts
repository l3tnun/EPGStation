import express from 'express';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Server as NetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, vi } from 'vitest';

import { close, compiled, modelContainer, require } from '../_harness';

const SocketIOManageModel = (require(compiled('model', 'service', 'socketio', 'SocketIOManageModel.js')) as any)
    .default;
const httpsModule = require('node:https') as typeof import('node:https');

/*
 * server は ESM へ移行済みで、ServiceServer.js の `import * as https from 'https'` は静的に解決される。
 * `vi.spyOn(httpsModule.createServer)`（httpsModule は require('node:https') で得た名前空間）
 * だけで差し替えても、ServiceServer.js は独自の 'https' import binding を先に (このモジュール読込
 * 時点で) 解決済みのため、後から require 側の名前空間を書き換えても ServiceServer.js には届かず、
 * https listener が常に http として誤分類される (in-process の差し替えが効かない)。
 * `vi.doMock('https' / 'node:https', ...)` で ServiceServer.js が import する 'https' 自体を、
 * 常に `httpsCreateServerDelegate` の現在値へ委譲するラッパーへ差し替えたうえで `vi.resetModules()`
 * してから動的 `import()` で読み直す。一度この束縛を確立すれば、以降の
 * `httpsCreateServerDelegate = vi.fn(...)` のような per-test の差し替えは委譲先を書き換えるだけで
 * ServiceServer.js 実行時にも反映される。
 */
let httpsCreateServerDelegate: typeof httpsModule.createServer = httpsModule.createServer.bind(httpsModule);

const loadServiceServer = async (): Promise<any> => {
    const httpsMockFactory = () => ({
        ...httpsModule,
        createServer: (...arguments_: Parameters<typeof httpsModule.createServer>) =>
            (httpsCreateServerDelegate as any)(...arguments_),
    });
    vi.doMock('https', httpsMockFactory);
    vi.doMock('node:https', httpsMockFactory);
    try {
        vi.resetModules();
        const imported = (await import(compiled('model', 'service', 'ServiceServer.js'))) as { default: any };
        return imported.default;
    } finally {
        vi.doUnmock('https');
        vi.doUnmock('node:https');
    }
};

const ServiceServer = await loadServiceServer();
const loopbackHost = '127.0.0.1';
const tlsCertificatePath = join(process.cwd(), 'test/server/fixtures/configuration/synthetic-tls-cert.pem');
const tlsPrivateKeyPath = join(process.cwd(), 'test/server/fixtures/configuration/synthetic-tls-key.pem');
const dedicatedPortSentinels = {
    http: { application: 10_101, socketIo: 10_102 },
    https: { application: 20_101, socketIo: 20_102 },
} as const;
const listenerPortSentinels = new Set<number>([
    -dedicatedPortSentinels.http.application,
    -dedicatedPortSentinels.http.socketIo,
    -dedicatedPortSentinels.https.application,
    -dedicatedPortSentinels.https.socketIo,
]);

export type ListenerProtocol = 'http' | 'https';

export interface ListenerMatrixCase {
    readonly expectedStarts: Readonly<Record<ListenerProtocol, number>>;
    readonly http: { readonly dedicatedSocketIo: boolean } | null;
    readonly https: { readonly dedicatedSocketIo: boolean } | null;
    readonly name: string;
}

export interface WireResponse {
    readonly body: string;
    readonly headers: IncomingHttpHeaders;
    readonly status: number;
}

export interface ClientTlsIdentity {
    readonly certificate: string;
    readonly key: string;
}

export interface ListenerFixtureOptions {
    readonly clientCertificateAuthority?: string | readonly string[];
}

export interface SocketIoConnection {
    readonly confirmation: WireResponse;
    readonly sessionPath: string;
}

export interface StartedListener {
    readonly protocol: ListenerProtocol;
    readonly server: Server;
}

export interface ApplicationSurface extends StartedListener {
    readonly notification: boolean;
}

export interface ListenerFixture {
    readonly applications: readonly ApplicationSurface[];
    readonly caseDefinition: ListenerMatrixCase;
    readonly notificationListeners: readonly StartedListener[];
    readonly requestedListenPorts: readonly number[];
    readonly socketIoManageModel: any;
    readonly starts: readonly StartedListener[];
    readonly tlsOptions: readonly Record<string, Buffer>[];
    cleanup(): Promise<void>;
}

export interface PublicSurfaceFixture {
    readonly notificationListener: StartedListener;
    readonly origin: string;
    cleanup(): Promise<void>;
}

export const listenerMatrixCases: readonly ListenerMatrixCase[] = [
    {
        expectedStarts: { http: 1, https: 0 },
        http: { dedicatedSocketIo: false },
        https: null,
        name: 'HTTP only with same Socket.IO listener',
    },
    {
        expectedStarts: { http: 0, https: 1 },
        http: null,
        https: { dedicatedSocketIo: false },
        name: 'HTTPS only with same Socket.IO listener',
    },
    {
        expectedStarts: { http: 1, https: 1 },
        http: { dedicatedSocketIo: false },
        https: { dedicatedSocketIo: false },
        name: 'HTTP and HTTPS with same Socket.IO listeners',
    },
    {
        expectedStarts: { http: 2, https: 0 },
        http: { dedicatedSocketIo: true },
        https: null,
        name: 'HTTP only with dedicated Socket.IO listener',
    },
    {
        expectedStarts: { http: 0, https: 2 },
        http: null,
        https: { dedicatedSocketIo: true },
        name: 'HTTPS only with dedicated Socket.IO listener',
    },
    {
        expectedStarts: { http: 2, https: 2 },
        http: { dedicatedSocketIo: true },
        https: { dedicatedSocketIo: true },
        name: 'HTTP and HTTPS with dedicated Socket.IO listeners',
    },
] as const;

const originFor = async (listener: StartedListener): Promise<string> => {
    if (!listener.server.listening) await once(listener.server, 'listening');
    const address = listener.server.address();
    if (address === null || typeof address === 'string') throw new Error('Synthetic listener did not bind TCP');
    return `${listener.protocol}://${loopbackHost}:${String(address.port)}`;
};

export const exchange = (
    origin: string,
    path: string,
    options: {
        readonly body?: string;
        readonly clientTls?: ClientTlsIdentity;
        readonly headers?: Record<string, string>;
        readonly method?: string;
    } = {},
): Promise<WireResponse> =>
    new Promise((resolve, reject) => {
        const target = new URL(origin);
        const body = options.body;
        const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
        const outgoing = transport(
            {
                headers:
                    body === undefined
                        ? options.headers ?? {}
                        : {
                              ...options.headers,
                              'Content-Length': String(Buffer.byteLength(body)),
                              'Content-Type': 'text/plain;charset=UTF-8',
                          },
                hostname: target.hostname,
                method: options.method ?? 'GET',
                path,
                port: target.port,
                ...(target.protocol === 'https:'
                    ? {
                          cert: options.clientTls?.certificate,
                          key: options.clientTls?.key,
                          rejectUnauthorized: false,
                      }
                    : {}),
            },
            response => {
                const chunks: Buffer[] = [];
                response.on('data', chunk => chunks.push(Buffer.from(chunk)));
                response.once('error', reject);
                response.once('end', () =>
                    resolve({
                        body: Buffer.concat(chunks).toString('utf8'),
                        headers: response.headers,
                        status: response.statusCode ?? 0,
                    }),
                );
            },
        );
        outgoing.once('error', reject);
        if (body !== undefined) outgoing.write(body);
        outgoing.end();
    });

export const connectPollingSocketIoClient = async (
    listener: StartedListener,
    options: { readonly clientTls?: ClientTlsIdentity; readonly headers?: Record<string, string> } = {},
): Promise<SocketIoConnection> => {
    const origin = await originFor(listener);
    const open = await exchange(origin, '/socket.io/?EIO=4&transport=polling', options);
    if (!open.body.startsWith('0')) throw new Error(`Socket.IO opening packet was not received: ${open.body}`);
    const openingPacket = JSON.parse(open.body.slice(1)) as { readonly sid?: unknown };
    if (typeof openingPacket.sid !== 'string') throw new Error('Socket.IO opening packet omitted its session ID');
    const sessionPath = `/socket.io/?EIO=4&transport=polling&sid=${encodeURIComponent(openingPacket.sid)}`;
    const post = await exchange(origin, sessionPath, { body: '40', ...options, method: 'POST' });
    if (post.status !== 200) throw new Error(`Socket.IO connect packet was rejected: ${post.status}`);
    const confirmation = await exchange(origin, sessionPath, options);
    if (!/^40\{"sid":/u.test(confirmation.body)) {
        throw new Error(`Socket.IO namespace confirmation was not received: ${confirmation.body}`);
    }
    return { confirmation, sessionPath };
};

export const assertApplicationSurfaces = async (listener: ApplicationSurface): Promise<void> => {
    const origin = await originFor(listener);
    const [web, api] = await Promise.all([exchange(origin, '/'), exchange(origin, '/api/docs')]);

    expect(web).toMatchObject({ body: 'task-7-1-web', status: 200 });
    expect(web.headers['content-type']).toContain('text/html');
    expect(api.status).toBe(200);
    expect(api.headers['content-type']).toContain('application/json');
    expect(JSON.parse(api.body)).toMatchObject({
        info: { title: 'epgstation' },
        paths: { '/version': { get: expect.any(Object) } },
    });
};

export const originOf = originFor;

export const startListenerFixture = async (
    caseDefinition: ListenerMatrixCase,
    options: ListenerFixtureOptions = {},
): Promise<ListenerFixture> => {
    const frontendRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-interface-task-7-1-'));
    const clientCertificateAuthorities =
        options.clientCertificateAuthority === undefined
            ? []
            : typeof options.clientCertificateAuthority === 'string'
              ? [options.clientCertificateAuthority]
              : options.clientCertificateAuthority;
    const clientCertificateAuthorityPaths = clientCertificateAuthorities.map((_, index) =>
        join(frontendRoot, `task-7-2-client-ca-${String(index)}.pem`),
    );
    const originalApiYml = ServiceServer.API_YML;
    const originalPackageJson = ServiceServer.PACKAGE_JSON;
    const originalFrontendRoot = ServiceServer.FRONTEND_DIST_DIR;
    const application = express();
    let httpApplication: Server | null = null;
    const originalApplicationListen = application.listen.bind(application);
    application.listen = ((port: number, callback?: () => void): Server => {
        httpApplication = originalApplicationListen(port, loopbackHost, callback);
        return httpApplication;
    }) as typeof application.listen;
    const socketIoManageModel = new SocketIOManageModel(
        {
            getLogger: () => ({
                system: { error: vi.fn(), info: vi.fn() },
            }),
        },
        { getConfig: () => ({}) },
    );
    const service = Object.create(ServiceServer.prototype) as any;
    service.app = application;
    service.config = {
        apiServers: ['http://synthetic.invalid'],
        streamFilePath: frontendRoot,
        thumbnail: frontendRoot,
        ...(caseDefinition.http === null
            ? {}
            : {
                  port: caseDefinition.http.dedicatedSocketIo ? -dedicatedPortSentinels.http.application : 0,
                  ...(caseDefinition.http.dedicatedSocketIo
                      ? { socketioPort: -dedicatedPortSentinels.http.socketIo }
                      : {}),
              }),
        ...(caseDefinition.https === null
            ? {}
            : {
                  https: {
                      ...(options.clientCertificateAuthority === undefined
                          ? {}
                          : {
                                ca:
                                    typeof options.clientCertificateAuthority === 'string'
                                        ? clientCertificateAuthorityPaths[0]
                                        : clientCertificateAuthorityPaths,
                            }),
                      cert: tlsCertificatePath,
                      key: tlsPrivateKeyPath,
                      port: caseDefinition.https.dedicatedSocketIo ? -dedicatedPortSentinels.https.application : 0,
                      ...(caseDefinition.https.dedicatedSocketIo
                          ? { socketioPort: -dedicatedPortSentinels.https.socketIo }
                          : {}),
                  },
              }),
    };
    service.log = {
        access: { error: vi.fn(), info: vi.fn() },
        system: { error: vi.fn(), info: vi.fn() },
    };
    service.socketIoManageModel = socketIoManageModel;

    const httpsApplications: Server[] = [];
    const httpsDedicatedListeners: Server[] = [];
    const tlsOptions: Array<Record<string, Buffer>> = [];
    const originalCreateHttpsServer = httpsModule.createServer.bind(httpsModule);
    httpsCreateServerDelegate = ((...args: any[]) => {
        const listener = Reflect.apply(originalCreateHttpsServer, httpsModule, args) as Server;
        tlsOptions.push(args[0] as Record<string, Buffer>);
        if (args.length >= 2) httpsApplications.push(listener);
        else httpsDedicatedListeners.push(listener);
        return listener;
    }) as typeof httpsModule.createServer;
    const initializeSpy = vi.spyOn(socketIoManageModel, 'initialize');
    const originalNetListen = NetServer.prototype.listen;
    const requestedListenPorts: number[] = [];
    const listenSpy = vi.spyOn(NetServer.prototype, 'listen').mockImplementation(function (
        this: NetServer,
        ...args: any[]
    ): NetServer {
        const requestedPort = args[0];
        if (typeof requestedPort === 'number') requestedListenPorts.push(requestedPort);
        if (!listenerPortSentinels.has(requestedPort)) {
            return Reflect.apply(originalNetListen, this, args) as NetServer;
        }
        const callback = args.find(argument => typeof argument === 'function') as (() => void) | undefined;
        return Reflect.apply(originalNetListen, this, [
            0,
            loopbackHost,
            ...(callback === undefined ? [] : [callback]),
        ]) as NetServer;
    } as typeof NetServer.prototype.listen);

    let startedServers: Server[] = [];
    let socketListeners: Server[] | undefined;
    const observedStartedServers = (): Server[] =>
        listenSpy.mock.contexts.filter(
            (candidate): candidate is Server =>
                candidate instanceof NetServer && typeof (candidate as Server).address === 'function',
        );
    const cleanupResources = async (): Promise<void> => {
        await Promise.all(
            socketIoManageModel.ios.map(
                (io: { close(callback: () => void): void }) => new Promise<void>(resolve => io.close(resolve)),
            ),
        );
        await Promise.all(
            [...new Set(startedServers)].map(server => (server.listening ? close(server) : Promise.resolve())),
        );
        await rm(frontendRoot, { force: true, recursive: true });
    };
    try {
        if (options.clientCertificateAuthority !== undefined && caseDefinition.https === null) {
            throw new Error('A client certificate authority requires an HTTPS listener');
        }
        await Promise.all([
            writeFile(join(frontendRoot, 'index.html'), 'task-7-1-web'),
            ...clientCertificateAuthorities.map((certificate, index) =>
                writeFile(clientCertificateAuthorityPaths[index], certificate),
            ),
        ]);
        ServiceServer.API_YML = join(process.cwd(), 'api.yml');
        ServiceServer.PACKAGE_JSON = join(process.cwd(), 'package.json');
        ServiceServer.FRONTEND_DIST_DIR = frontendRoot;
        service.initOpenApi(service.getApiDocument(ServiceServer.API_YML));
        service.setStaticFiles();

        service.start();
        socketListeners = initializeSpy.mock.calls[0]?.[0] as Server[] | undefined;
        startedServers = observedStartedServers();
        await Promise.all(
            startedServers.map(async server => {
                if (!server.listening) await once(server, 'listening');
            }),
        );
    } catch (error: unknown) {
        startedServers = observedStartedServers();
        await cleanupResources();
        throw error;
    } finally {
        ServiceServer.API_YML = originalApiYml;
        ServiceServer.PACKAGE_JSON = originalPackageJson;
        ServiceServer.FRONTEND_DIST_DIR = originalFrontendRoot;
        listenSpy.mockRestore();
        initializeSpy.mockRestore();
        httpsCreateServerDelegate = httpsModule.createServer.bind(httpsModule);
    }

    if (socketListeners === undefined) {
        await cleanupResources();
        throw new Error('ServiceServer did not initialize Socket.IO listeners');
    }
    const httpsServers = new Set([...httpsApplications, ...httpsDedicatedListeners]);
    const starts = startedServers.map(server => ({
        protocol: httpsServers.has(server) ? ('https' as const) : ('http' as const),
        server,
    }));
    const notificationListeners = socketListeners.map(server => ({
        protocol: httpsServers.has(server) ? ('https' as const) : ('http' as const),
        server,
    }));
    const applications: ApplicationSurface[] = [
        ...(httpApplication === null
            ? []
            : [
                  {
                      notification: socketListeners.includes(httpApplication),
                      protocol: 'http' as const,
                      server: httpApplication,
                  },
              ]),
        ...httpsApplications.map(server => ({
            notification: socketListeners.includes(server),
            protocol: 'https' as const,
            server,
        })),
    ];

    return {
        applications,
        caseDefinition,
        notificationListeners,
        requestedListenPorts,
        socketIoManageModel,
        starts,
        tlsOptions,
        cleanup: cleanupResources,
    };
};

export const startPublicSurfaceFixture = async (isAllowAllCORS: boolean): Promise<PublicSurfaceFixture> => {
    const frontendRoot = await mkdtemp(join(tmpdir(), 'epgstation-service-interface-task-7-2-'));
    const originalApiYml = ServiceServer.API_YML;
    const originalPackageJson = ServiceServer.PACKAGE_JSON;
    const originalFrontendRoot = ServiceServer.FRONTEND_DIST_DIR;
    const getConfiguration = () => ({
        apiServers: ['http://synthetic.invalid'],
        concurrentUploadNum: 3,
        isAllowAllCORS,
        port: 0,
        streamFilePath: frontendRoot,
        thumbnail: frontendRoot,
        uploadReceiveTimeoutMs: 300_000,
        uploadTempDir: join(frontendRoot, 'upload'),
    });
    const socketIoManageModel = new SocketIOManageModel(
        { getLogger: () => ({ system: { error: vi.fn(), info: vi.fn() } }) },
        { getConfig: getConfiguration },
    );
    const initialize = vi.spyOn(socketIoManageModel, 'initialize');
    const accessLogger = { isLevelEnabled: vi.fn().mockReturnValue(true), log: vi.fn() };
    const configOwner = { getConfig: vi.fn(async () => ({ broadcast: true })) };
    const ownerLookup = vi.spyOn(modelContainer, 'get').mockImplementation((token: string) => {
        if (token === 'IConfigApiModel') return configOwner;
        throw new Error(`Unexpected owner ${token}`);
    });
    const initializedListeners = (): readonly Server[] => {
        const listeners = initialize.mock.calls[0]?.[0];
        return Array.isArray(listeners) ? (listeners as readonly Server[]) : [];
    };
    const cleanup = async (): Promise<void> => {
        ownerLookup.mockRestore();
        await Promise.all(
            socketIoManageModel.ios.map(
                (io: { close(callback: () => void): void }) => new Promise<void>(resolve => io.close(resolve)),
            ),
        );
        await Promise.all(
            initializedListeners().map(listener => (listener.listening ? close(listener) : Promise.resolve())),
        );
        ServiceServer.FRONTEND_DIST_DIR = originalFrontendRoot;
        ServiceServer.API_YML = originalApiYml;
        ServiceServer.PACKAGE_JSON = originalPackageJson;
        await rm(frontendRoot, { force: true, recursive: true });
    };

    try {
        await Promise.all([
            writeFile(join(frontendRoot, 'index.html'), 'task-7-2-web'),
            writeFile(join(frontendRoot, 'task-7-2-thumbnail.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47])),
            writeFile(join(frontendRoot, 'task-7-2-video.ts'), Buffer.from('task-7-2-video')),
        ]);
        ServiceServer.API_YML = join(process.cwd(), 'api.yml');
        ServiceServer.PACKAGE_JSON = join(process.cwd(), 'package.json');
        ServiceServer.FRONTEND_DIST_DIR = frontendRoot;

        const service = new ServiceServer(
            { getLogger: () => ({ access: accessLogger, system: { error: vi.fn(), info: vi.fn() } }) },
            { getConfig: getConfiguration },
            socketIoManageModel,
        );
        service.start();
        const listener = initializedListeners()[0];
        const io = socketIoManageModel.ios[0] as { close(callback: () => void): void } | undefined;
        if (listener === undefined || io === undefined) throw new Error('Task 7.2 fixture did not start Socket.IO');

        return {
            notificationListener: { protocol: 'http', server: listener },
            origin: await originFor({ protocol: 'http', server: listener }),
            cleanup,
        };
    } catch (error: unknown) {
        await cleanup();
        throw error;
    }
};

export const expectedTlsMaterial = async (): Promise<{ readonly cert: Buffer; readonly key: Buffer }> => {
    const [cert, key] = await Promise.all([readFile(tlsCertificatePath), readFile(tlsPrivateKeyPath)]);
    return { cert, key };
};
