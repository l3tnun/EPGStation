import express from 'express';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { close, compiled, compiledSnapshot, listen, modelContainer, require } from './_harness';

const mutableFileSystem = require('node:fs') as {
    readFileSync(path: unknown, options?: unknown): unknown;
};
import {
    assertApplicationSurfaces,
    connectPollingSocketIoClient,
    exchange as listenerExchange,
    listenerMatrixCases,
    originOf,
    startListenerFixture,
    startPublicSurfaceFixture,
} from './fixtures/listener-matrix';
import {
    syntheticClientCertificateAuthority,
    trustedSyntheticClientIdentity,
    untrustedSyntheticClientIdentity,
} from './fixtures/synthetic-mtls';
import {
    allRouteCases,
    mediaRouteCases,
    operationKey,
    recordedRouteCases,
    schedulingRouteCases,
    streamRouteCases,
} from './route-contracts';

type HttpMethod = 'del' | 'get' | 'post' | 'put';
interface RouteContract {
    readonly file: string;
    readonly methods: readonly HttpMethod[];
}

interface CanonicalPublicCase {
    readonly file: string;
    readonly id: string;
    readonly method: HttpMethod;
    readonly observable: string;
}

const scheduling: readonly RouteContract[] = [
    { file: 'channels', methods: ['get'] },
    { file: 'channels/{channelId}/logo', methods: ['get'] },
    { file: 'schedules', methods: ['get'] },
    { file: 'schedules/broadcasting', methods: ['get'] },
    { file: 'schedules/detail/{programId}', methods: ['get'] },
    { file: 'schedules/search', methods: ['post'] },
    { file: 'schedules/{channelId}', methods: ['get'] },
    { file: 'reserves', methods: ['get', 'post'] },
    { file: 'reserves/cnts', methods: ['get'] },
    { file: 'reserves/lists', methods: ['get'] },
    { file: 'reserves/update', methods: ['post'] },
    { file: 'reserves/{reserveId}', methods: ['get', 'del', 'put'] },
    { file: 'reserves/{reserveId}/overlap', methods: ['del'] },
    { file: 'reserves/{reserveId}/skip', methods: ['del'] },
    { file: 'rules', methods: ['get', 'post'] },
    { file: 'rules/keyword', methods: ['get', 'post'] },
    { file: 'rules/{ruleId}', methods: ['get', 'del', 'put'] },
    { file: 'rules/{ruleId}/disable', methods: ['put'] },
    { file: 'rules/{ruleId}/enable', methods: ['put'] },
    { file: 'recording', methods: ['get'] },
    { file: 'recording/resettimer', methods: ['post'] },
] as const;

const recorded: readonly RouteContract[] = [
    { file: 'recorded', methods: ['get', 'post'] },
    { file: 'recorded/cleanup', methods: ['post'] },
    { file: 'recorded/options', methods: ['get'] },
    { file: 'recorded/{recordedId}', methods: ['get', 'del'] },
    { file: 'recorded/{recordedId}/encode', methods: ['del'] },
    { file: 'recorded/{recordedId}/protect', methods: ['put'] },
    { file: 'recorded/{recordedId}/unprotect', methods: ['put'] },
    { file: 'videos/upload', methods: ['post'] },
    { file: 'videos/{videoFileId}', methods: ['get', 'del'] },
    { file: 'videos/{videoFileId}/duration', methods: ['get'] },
    { file: 'videos/{videoFileId}/kodi', methods: ['post'] },
    { file: 'videos/{videoFileId}/playlist', methods: ['get'] },
    { file: 'thumbnails', methods: ['post'] },
    { file: 'thumbnails/cleanup', methods: ['post'] },
    { file: 'thumbnails/videos/{videoFileId}', methods: ['post'] },
    { file: 'thumbnails/{thumbnailId}', methods: ['get', 'del'] },
    { file: 'dropLogs/{dropLogFileId}', methods: ['get'] },
    { file: 'tags', methods: ['get', 'post'] },
    { file: 'tags/{tagId}', methods: ['del', 'put'] },
    { file: 'tags/{tagId}/relate', methods: ['del', 'put'] },
] as const;

const media: readonly RouteContract[] = [
    { file: 'encode', methods: ['get', 'post'] },
    { file: 'encode/{encodeId}', methods: ['del'] },
    { file: 'storages', methods: ['get'] },
    { file: 'streams', methods: ['get', 'del'] },
    { file: 'streams/{streamId}', methods: ['del'] },
    { file: 'streams/{streamId}/keep', methods: ['put'] },
    { file: 'streams/live/{channelId}/hls', methods: ['get'] },
    { file: 'streams/live/{channelId}/m2ts', methods: ['get'] },
    { file: 'streams/live/{channelId}/m2ts/playlist', methods: ['get'] },
    { file: 'streams/live/{channelId}/m2tsll', methods: ['get'] },
    { file: 'streams/live/{channelId}/mp4', methods: ['get'] },
    { file: 'streams/live/{channelId}/webm', methods: ['get'] },
    { file: 'streams/recorded/{videoFileId}/hls', methods: ['get'] },
    { file: 'streams/recorded/{videoFileId}/mp4', methods: ['get'] },
    { file: 'streams/recorded/{videoFileId}/webm', methods: ['get'] },
] as const;

const canonicalPublicCases: readonly CanonicalPublicCase[] = [
    {
        file: 'config',
        id: 'SI-1.1',
        method: 'get',
        observable: 'serves the Web/API public root contract',
        caseLocator:
            'test/server/service-interface/static-public.integration.test.ts%%serves frontend, image, thumbnail and exact HLS assets below subDirectory=%s%%await expect((await fetch(`${base}/`)).text()).resolves.toBe(',
    },
    {
        file: 'channels/{channelId}/logo',
        id: 'SI-1.2',
        method: 'get',
        observable: 'serves the public image contract',
        caseLocator:
            'test/server/service-interface/static-public.integration.test.ts%%serves frontend, image, thumbnail and exact HLS assets below subDirectory=%s%%await expect((await fetch(`${base}/img/${imageName}`)).text()).resolves.toBe(',
    },
    {
        file: 'config',
        id: 'SI-1.3',
        method: 'get',
        observable: 'keeps the shared public base contract',
        caseLocator:
            'test/server/service-interface/carrier.integration.test.ts%%serves version and machine-readable docs below subDirectory=%s%%expect(docs.status).toBe(200);',
    },
    {
        file: 'config',
        id: 'SI-1.4',
        method: 'get',
        observable: 'projects public configuration',
        caseLocator:
            'test/server/service-interface/public-contract.spec.test.ts%%projects public configuration without exposing upload filesystem settings%%expect(result).toEqual({',
    },
    {
        file: 'version',
        id: 'SI-1.5',
        method: 'get',
        observable: 'serves the public package version',
        caseLocator:
            'test/server/service-interface/public-contract.spec.test.ts%%returns the package version through the public version operation%%expect(response.status).toHaveBeenCalledWith(200);',
    },
    {
        file: 'config',
        id: 'SI-1.6',
        method: 'get',
        observable: 'exposes the machine-readable API contract',
        caseLocator:
            'test/server/service-interface/public-contract.spec.test.ts%%uses package identity and subdirectory-aware /api server URLs in the public document%%expect(document.servers).toEqual(',
    },
    {
        file: 'config',
        id: 'SI-1.7',
        method: 'get',
        observable: 'keeps the API documentation surface optional',
        caseLocator:
            'test/server/service-interface/static-public.integration.test.ts%%provides the documentation screen only when its distribution is %s%%expect(debug.status).toBe(present ? 302 : 404);',
    },
    {
        file: 'streams/live/{channelId}/hls',
        id: 'SI-1.8',
        method: 'get',
        observable: 'serves the HLS playlist contract',
        caseLocator:
            'test/server/service-interface/imp/public-url.test.ts%%passes the exact configured stream directory and stream{id}.m3u8 output to the encoder%%expect(model.createProcessOption(17)).toMatchObject({',
    },
    {
        file: 'config',
        id: 'SI-1.9',
        method: 'get',
        observable: 'keeps public static access bounded',
        caseLocator:
            'test/server/service-interface/static-public.integration.test.ts%%serves frontend, image, thumbnail and exact HLS assets below subDirectory=%s%%expect(result.status).toBe(404);',
    },
    {
        file: 'channels',
        id: 'SI-2.1',
        method: 'get',
        observable: 'accepts program and channel reads',
        caseLocator:
            'test/server/service-interface/route-runtime.spec.test.ts%%$method /$file passes exact input to $ownerToken $ownerMethod and returns exact success wire%%route:GET /channels',
    },
    {
        file: 'reserves',
        id: 'SI-2.2',
        method: 'get',
        observable: 'accepts reservation operations',
        caseLocator:
            'test/server/service-interface/route-runtime.spec.test.ts%%$method /$file passes exact input to $ownerToken $ownerMethod and returns exact success wire%%route:GET /reserves',
    },
    {
        file: 'rules',
        id: 'SI-2.3',
        method: 'get',
        observable: 'accepts rule operations',
        caseLocator:
            'test/server/service-interface/route-runtime.spec.test.ts%%$method /$file passes exact input to $ownerToken $ownerMethod and returns exact success wire%%route:GET /rules',
    },
    {
        file: 'recording',
        id: 'SI-2.4',
        method: 'get',
        observable: 'accepts recording operations',
        caseLocator:
            'test/server/service-interface/route-runtime.spec.test.ts%%$method /$file passes exact input to $ownerToken $ownerMethod and returns exact success wire%%route:GET /recording',
    },
    {
        file: 'recorded',
        id: 'SI-2.5',
        method: 'get',
        observable: 'accepts recorded-content operations',
        caseLocator:
            'test/server/service-interface/route-runtime.spec.test.ts%%$method /$file passes exact input to $ownerToken $ownerMethod and returns exact success wire%%route:GET /recorded',
    },
    {
        file: 'encode',
        id: 'SI-2.6',
        method: 'get',
        observable: 'accepts encode operations',
        caseLocator:
            'test/server/service-interface/route-runtime.spec.test.ts%%$method /$file passes exact input to $ownerToken $ownerMethod and returns exact success wire%%route:GET /encode',
    },
    {
        file: 'storages',
        id: 'SI-2.7',
        method: 'get',
        observable: 'accepts storage reads',
        caseLocator:
            'test/server/service-interface/route-runtime.spec.test.ts%%$method /$file passes exact input to $ownerToken $ownerMethod and returns exact success wire%%route:GET /storages',
    },
    {
        file: 'streams',
        id: 'SI-2.8',
        method: 'get',
        observable: 'accepts media stream operations',
        caseLocator:
            'test/server/service-interface/route-runtime.spec.test.ts%%$method /$file passes exact input to $ownerToken $ownerMethod and returns exact success wire%%route:GET /streams',
    },
    {
        file: 'iptv/channel.m3u8',
        id: 'SI-2.9',
        method: 'get',
        observable: 'uses the IPTV public builder contract',
        caseLocator:
            'test/server/service-interface/imp/iptv-carrier.test.ts%%constructs one immutable builder from the request Host, exact forwarded HTTPS, and configured subDirectory%%expect(carrierResponse.body).toBe(',
    },
    {
        file: 'videos/upload',
        id: 'SI-2.10',
        method: 'post',
        observable: 'delegates the recorded carrier contract',
        caseLocator:
            'test/server/service-interface/imp/public-url.test.ts%%passes multipart upload fields to the PM registration port without filesystem decisions%%expect(response.status).toHaveBeenCalledWith(200);',
    },
    {
        file: 'reserves',
        id: 'SI-3.1',
        method: 'post',
        observable: 'keeps public request and response routing',
        caseLocator:
            'test/server/service-interface/route-runtime.spec.test.ts%%$method /$file passes exact input to $ownerToken $ownerMethod and returns exact success wire%%route:POST /reserves',
    },
    {
        file: 'streams',
        id: 'SI-3.2',
        method: 'get',
        observable: 'keeps recorded stream response fields',
        caseLocator:
            'test/server/service-interface/public-contract.spec.test.ts%%keeps recorded stream info on the runtime viodeFileId spelling%%expect(result).toEqual({',
    },
    {
        file: 'reserves/lists',
        id: 'SI-3.3',
        method: 'get',
        observable: 'keeps reserve-list response fields',
        caseLocator:
            'test/server/service-interface/public-contract.spec.test.ts%%keeps all four reserve-list classifications as arrays%%expect(result).toEqual({',
    },
    {
        file: 'rules',
        id: 'SI-3.4',
        method: 'post',
        observable: 'keeps both rule creation routes',
        caseLocator:
            'test/server/service-interface/public-contract.spec.test.ts%%keeps both Rule creation POST routes on their exact 201 wire contract%%expect(rulePosts).toHaveLength(2);',
    },
    {
        file: 'recording/resettimer',
        id: 'SI-3.5',
        method: 'post',
        observable: 'keeps recording timer reset wire semantics',
        caseLocator:
            'test/server/service-interface/public-contract.spec.test.ts%%keeps recording timer reset bodyless with the exact success body%%expect(resetTimer).toMatchObject({',
    },
    {
        file: 'config',
        id: 'SI-3.6',
        method: 'get',
        observable: 'keeps the broadcast configuration projection',
        caseLocator:
            'test/server/service-interface/public-contract.spec.test.ts%%projects public configuration without exposing upload filesystem settings%%expect(getBroadcastStatus).toHaveBeenCalledOnce();',
    },
    {
        file: 'streams',
        id: 'SI-3.8',
        method: 'get',
        observable: 'keeps the documented runtime schema',
        caseLocator:
            'test/server/service-interface/public-contract.spec.test.ts%%documents the runtime and public recorded-stream field as viodeFileId%%expect(declaration).toContain(',
    },
    {
        file: 'channels',
        id: 'SI-4.1',
        method: 'get',
        observable: 'validates malformed request routing',
        caseLocator:
            'test/server/service-interface/integration/service-interface.integration.test.ts%%logs valid, invalid, and internal-failure requests once while preserving their exact response boundary%%expect(invalid.status).toBe(400);',
    },
    {
        file: 'config',
        id: 'SI-4.2',
        method: 'get',
        observable: 'writes the no-cache JSON response contract',
        caseLocator:
            'test/server/service-interface/imp/service-interface-characteristics.test.ts%%writes the exact private no-cache headers on a normal JSON response%%expect(response.header.mock.calls).toEqual(',
    },
    {
        file: 'streams/live/{channelId}/hls',
        id: 'SI-4.3',
        method: 'get',
        observable: 'writes stream content response types',
        caseLocator:
            'test/server/service-interface/integration/service-interface.integration.test.ts%%preserves the representative playlist, image, log, video, XML, and download wire headers%%expect(image.headers',
    },
    {
        file: 'videos/{videoFileId}',
        id: 'SI-4.4',
        method: 'get',
        observable: 'writes closed, single-byte, open and suffix byte ranges',
        caseLocator:
            'test/server/service-interface/integration/service-interface.integration.test.ts%%$name preserves final wire bytes and file-handle ownership [INT#SI-9.4/$name]%%range:range-normal-closed',
    },
    {
        file: 'videos/{videoFileId}',
        id: 'SI-4.5',
        method: 'get',
        observable: 'writes an unsatisfied byte range response',
        caseLocator:
            'test/server/service-interface/integration/service-interface.integration.test.ts%%$name preserves final wire bytes and file-handle ownership [INT#SI-9.4/$name]%%range:range-start-equals-file-size',
    },
    {
        file: 'videos/{videoFileId}',
        id: 'SI-4.6',
        method: 'get',
        observable: 'writes the download content response',
        caseLocator:
            "test/server/service-interface/integration/service-interface.integration.test.ts%%preserves the representative playlist, image, log, video, XML, and download wire headers%%expect(download.headers['content-disposition']).toBe(",
    },
    {
        file: 'version',
        id: 'SI-4.7',
        method: 'get',
        observable: 'writes the internal error response',
        caseLocator:
            'test/server/service-interface/imp/service-interface-characteristics.test.ts%%writes HTTP 500 with optional errors=%s%%expect(response.status).toHaveBeenCalledWith(500);',
    },
    {
        file: 'config',
        id: 'SI-4.8',
        method: 'get',
        observable: 'writes the HTTP access record',
        caseLocator:
            'test/server/service-interface/integration/service-interface.integration.test.ts%%logs valid, invalid, and internal-failure requests once while preserving their exact response boundary%%expect(accessLogger.log).toHaveBeenCalledTimes(3);',
    },
    {
        file: 'iptv/channel.m3u8',
        id: 'SI-5.1',
        method: 'get',
        observable: 'uses the request Host public URL contract',
        caseLocator:
            'test/server/service-interface/imp/public-url.test.ts%%sends Kodi the request Host, secure scheme, subdirectory once, and video endpoint%%expect(sendToKodi).toHaveBeenCalledWith(',
    },
    {
        file: 'iptv/epg.xml',
        id: 'SI-5.2',
        method: 'get',
        observable: 'uses the secure-protocol public URL contract',
        caseLocator:
            'test/server/service-interface/carrier.integration.test.ts%%passes request Host and forwarded HTTPS to playlist below %s%%expect(getM3u8).toHaveBeenCalledWith(',
    },
    {
        file: 'videos/{videoFileId}/playlist',
        id: 'SI-5.3',
        method: 'get',
        observable: 'uses subDirectory exactly once in public URLs',
        caseLocator:
            'test/server/service-interface/imp/public-url.test.ts%%adds subDirectory=%s exactly once to generated playlists%%expect(playlist).toBe(',
    },
] as const;

const operations = (contracts: readonly RouteContract[]): string[] =>
    contracts.flatMap(({ file, methods }) => methods.map(method => `${method.toUpperCase()} /${file}`));

const apiDocFingerprint = (contracts: readonly RouteContract[]): string => {
    const documents = contracts.flatMap(({ file, methods }) => {
        const route = require(compiled('model', 'service', 'api', `${file}.js`)) as Record<string, any>;
        return methods.map(method => ({ operation: `${method.toUpperCase()} /${file}`, apiDoc: route[method].apiDoc }));
    });
    return createHash('sha256').update(JSON.stringify(documents)).digest('hex');
};

const checkpointLoopbackHost = '127.0.0.1';

interface CheckpointWireResponse {
    readonly body: Buffer;
    readonly headers: IncomingHttpHeaders;
    readonly status: number;
}

interface CheckpointRequest {
    readonly request: import('node:http').ClientRequest;
    readonly response: Promise<CheckpointWireResponse>;
}

interface CheckpointSocketIoServer {
    close(callback: () => void): void;
}

const closeCheckpointSocketIo = (socketIo: CheckpointSocketIoServer | undefined): Promise<void> =>
    socketIo === undefined ? Promise.resolve() : new Promise(resolve => socketIo.close(resolve));

const cleanupCheckpointResources = async (cleanupActions: readonly (() => Promise<void>)[]): Promise<void> => {
    let cleanupError: unknown;
    for (const cleanup of cleanupActions) {
        try {
            await cleanup();
        } catch (error: unknown) {
            cleanupError ??= error;
        }
    }
    if (cleanupError !== undefined) throw cleanupError;
};

const startCheckpointRequest = (
    origin: string,
    options: { readonly headers: Record<string, string>; readonly method: string; readonly path: string },
): CheckpointRequest => {
    const target = new URL(origin);
    let responseStarted = false;
    let request!: import('node:http').ClientRequest;
    const response = new Promise<CheckpointWireResponse>((resolve, reject) => {
        request = httpRequest(
            {
                headers: options.headers,
                hostname: target.hostname,
                method: options.method,
                path: options.path,
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
    });
    return { request, response };
};

const sendCheckpointRequest = async (
    origin: string,
    options: {
        readonly body?: Buffer;
        readonly headers?: Record<string, string>;
        readonly method: string;
        readonly path: string;
    },
): Promise<CheckpointWireResponse> => {
    const request = startCheckpointRequest(origin, {
        headers: options.headers ?? {},
        method: options.method,
        path: options.path,
    });
    if (options.body !== undefined) request.request.write(options.body);
    request.request.end();
    return request.response;
};

const checkpointUploadBody = (): {
    readonly body: Buffer;
    readonly headers: Record<string, string>;
    readonly partialEnd: number;
} => {
    const boundary = 'service-interface-task-8-3-boundary';
    const filePayload = Buffer.from('synthetic-checkpoint-upload');
    const fields = {
        fileType: 'ts',
        parentDirectoryName: 'primary',
        recordedId: '12',
        subDirectory: 'child',
        viewName: 'synthetic-view',
    };
    const fieldParts = Object.entries(fields).map(([name, value]) =>
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
    );
    const filePart = Buffer.concat([
        Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.ts"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        filePayload,
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const body = Buffer.concat([...fieldParts, filePart]);
    const partialEnd = body.indexOf(filePayload) + filePayload.length;
    if (partialEnd <= 0 || partialEnd >= body.length)
        throw new Error('Checkpoint multipart fixture has no partial boundary');
    return {
        body,
        headers: {
            'Content-Length': String(body.length),
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        partialEnd,
    };
};

const checkpointUploadService = (uploadRoot: string): any => {
    const ServiceServer = (require(compiled('model', 'service', 'ServiceServer.js')) as any).default;
    const UploadAdmissionController = (
        require(compiled('model', 'service', 'upload', 'UploadAdmissionController.js')) as any
    ).default;
    const service = Object.create(ServiceServer.prototype) as any;
    service.app = express();
    service.config = {
        apiServers: ['http://synthetic.invalid'],
        concurrentUploadNum: 3,
        uploadReceiveTimeoutMs: 300_000,
        uploadTempDir: uploadRoot,
    };
    service.log = {
        access: { error: vi.fn(), info: vi.fn() },
        system: { error: vi.fn(), info: vi.fn() },
    };
    service.uploadAdmission = new UploadAdmissionController(3);
    service.createUploadDir();
    service.initOpenApi(service.getApiDocument(join(process.cwd(), 'api.yml')));
    return service;
};

const checkpointPollingClient = async (
    origin: string,
    socketPath: string,
): Promise<{ readonly confirmation: string; readonly sessionPath: string }> => {
    const open = await listenerExchange(origin, `${socketPath}/?EIO=4&transport=polling`);
    if (!open.body.startsWith('0')) throw new Error(`Socket.IO opening packet was not received: ${open.body}`);
    const openingPacket = JSON.parse(open.body.slice(1)) as { readonly sid?: unknown };
    if (typeof openingPacket.sid !== 'string') throw new Error('Socket.IO opening packet omitted its session ID');
    const sessionPath = `${socketPath}/?EIO=4&transport=polling&sid=${encodeURIComponent(openingPacket.sid)}`;
    const post = await listenerExchange(origin, sessionPath, { body: '40', method: 'POST' });
    if (post.status !== 200) throw new Error(`Socket.IO connect packet was rejected: ${post.status}`);
    const confirmation = await listenerExchange(origin, sessionPath);
    if (!/^40\{"sid":/u.test(confirmation.body)) {
        throw new Error(`Socket.IO namespace confirmation was not received: ${confirmation.body}`);
    }
    return { confirmation: confirmation.body, sessionPath };
};

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('Service Interface public contract [SI-2.1/SI-2.2/SI-2.3]', () => {
    it.each(canonicalPublicCases)('[$id] $observable [$caseLocator]', ({ file, method }) => {
        const route = require(compiled('model', 'service', 'api', `${file}.js`)) as Record<string, any>;
        const operation = route[method];

        expect(operation, `${method.toUpperCase()} /${file}`).toBeTypeOf('function');
        expect(operation.apiDoc?.responses, `${method.toUpperCase()} /${file} responses`).toBeTypeOf('object');
        expect(Object.keys(operation.apiDoc.responses).some(status => /^2\d\d$/u.test(status))).toBe(true);
    });

    it('maps every documented operation to one explicit runtime contract row', () => {
        expect(schedulingRouteCases.map(operationKey)).toEqual(operations(scheduling));
        expect(recordedRouteCases.map(operationKey)).toEqual(operations(recorded));
        expect(
            [...mediaRouteCases.map(operationKey), ...streamRouteCases.map(({ file }) => `GET /${file}`)].sort(),
        ).toEqual(operations(media).sort());
    });

    it.each([
        [
            'schedule/reserve/rule/recording',
            scheduling,
            '10ba20f897442952debba2effad3a63fa57b6e9ca8e8c115108ece8435943e83',
        ],
        [
            'recorded/video/thumbnail/drop-log/tag',
            recorded,
            '33b1c5b2a9f5293d99e4021d7b35f56af99cd1b1973dcfc9667a71b7ef7684c1',
        ],
        ['encode/storage/stream', media, '1f837c5e4db017f276e471accf47096cdb3dbf7a866378e08f126e0dfc4b87ce'],
    ] as const)(
        '%s route group retains its complete method/path and OpenAPI response inventory',
        (_name, contracts, fingerprint) => {
            const actual: string[] = [];
            for (const contract of contracts) {
                const route = require(compiled('model', 'service', 'api', `${contract.file}.js`)) as Record<
                    string,
                    any
                >;
                for (const method of contract.methods) {
                    expect(route[method], `${method} /${contract.file}`).toBeTypeOf('function');
                    expect(route[method].apiDoc?.responses, `${method} /${contract.file} responses`).toBeTypeOf(
                        'object',
                    );
                    expect(Object.keys(route[method].apiDoc.responses).some(status => /^2\d\d$/u.test(status))).toBe(
                        true,
                    );
                    actual.push(`${method.toUpperCase()} /${contract.file}`);
                }
            }
            expect(actual).toEqual(operations(contracts));
            expect(apiDocFingerprint(contracts)).toBe(fingerprint);
        },
    );
});

describe('Service Interface configuration/document contract [SI-1.2/SI-3.1]', () => {
    it('projects public configuration without exposing upload filesystem settings', async () => {
        const ConfigApiModel = (require(compiled('model', 'api', 'config', 'ConfigApiModel.js')) as any).default;
        const internal = {
            clientSocketioPort: 7777,
            encode: [{ name: 'mobile', cmd: 'secret-encode-command' }],
            kodiHosts: [{ name: 'living-room', host: 'http://secret.invalid' }],
            recorded: [{ name: 'primary', path: 'synthetic-recorded-path' }],
            stream: {
                live: {
                    ts: {
                        hls: [{ cmd: 'secret-live-hls-command', name: 'live-hls' }],
                        m2ts: [{ name: 'live-direct' }, { cmd: 'secret-live-m2ts-command', name: 'live-m2ts' }],
                        m2tsll: [{ cmd: 'secret-live-m2tsll-command', name: 'live-m2tsll' }],
                        mp4: [{ cmd: 'secret-live-mp4-command', name: 'live-mp4' }],
                        webm: [{ cmd: 'secret-live-webm-command', name: 'live-webm' }],
                    },
                },
                recorded: {
                    encoded: {
                        hls: [{ cmd: 'secret-encoded-hls-command', name: 'encoded-hls' }],
                        mp4: [{ cmd: 'secret-encoded-mp4-command', name: 'encoded-mp4' }],
                        webm: [{ cmd: 'secret-encoded-webm-command', name: 'encoded-webm' }],
                    },
                    ts: {
                        hls: [{ cmd: 'secret-recorded-hls-command', name: 'recorded-hls' }],
                        mp4: [{ cmd: 'secret-recorded-mp4-command', name: 'recorded-mp4' }],
                        webm: [{ cmd: 'secret-recorded-webm-command', name: 'recorded-webm' }],
                    },
                },
            },
            concurrentUploadNum: 5,
            uploadTempDir: 'synthetic-upload-path',
            uploadReceiveTimeoutMs: 12_345,
            urlscheme: {
                download: { android: 'a', ios: 'i', mac: 'm', win: 'w' },
                m2ts: { android: 'a', ios: 'i', mac: 'm', win: 'w' },
                video: { android: 'a', ios: 'i', mac: 'm', win: 'w' },
            },
        };
        const getBroadcastStatus = vi.fn().mockResolvedValue(true);
        const model = new ConfigApiModel({ getConfig: () => internal }, { reserveation: { getBroadcastStatus } });

        const result = await model.getConfig(false);

        expect(result).toEqual({
            broadcast: true,
            encode: ['mobile'],
            isEnableEncodedRecordedStream: true,
            isEnableTSLiveStream: true,
            isEnableTSRecordedStream: true,
            kodiHosts: ['living-room'],
            recorded: ['primary'],
            socketIOPort: 7777,
            streamConfig: {
                live: {
                    ts: {
                        hls: ['live-hls'],
                        m2ts: [
                            { isUnconverted: true, name: 'live-direct' },
                            { isUnconverted: false, name: 'live-m2ts' },
                        ],
                        m2tsll: ['live-m2tsll'],
                        mp4: ['live-mp4'],
                        webm: ['live-webm'],
                    },
                },
                recorded: {
                    encoded: {
                        hls: ['encoded-hls'],
                        mp4: ['encoded-mp4'],
                        webm: ['encoded-webm'],
                    },
                    ts: {
                        hls: ['recorded-hls'],
                        mp4: ['recorded-mp4'],
                        webm: ['recorded-webm'],
                    },
                },
            },
            urlscheme: internal.urlscheme,
        });
        expect(JSON.stringify(result)).not.toContain('synthetic-recorded-path');
        expect(JSON.stringify(result)).not.toContain('synthetic-upload-path');
        expect(JSON.stringify(result)).not.toContain('secret-');
        expect(result).not.toHaveProperty('concurrentUploadNum');
        expect(result).not.toHaveProperty('uploadReceiveTimeoutMs');
        expect(getBroadcastStatus).toHaveBeenCalledOnce();
    });

    it('uses package identity and subdirectory-aware /api server URLs in the public document', () => {
        const ServiceServer = (require(compiled('model', 'service', 'ServiceServer.js')) as any).default;
        ServiceServer.API_YML = join(process.cwd(), 'api.yml');
        ServiceServer.PACKAGE_JSON = join(process.cwd(), 'package.json');
        const instance = Object.create(ServiceServer.prototype) as any;
        instance.config = { apiServers: ['https://one.invalid/root'] };
        const publicBase = `/${'epg'}`;
        instance.config.subDirectory = publicBase;
        const document = instance.getApiDocument(ServiceServer.API_YML);
        const pkg = require(join(process.cwd(), 'package.json')) as { name: string; version: string };
        expect(document.info).toMatchObject({ title: pkg.name, version: pkg.version });
        expect(document.servers).toEqual([{ url: 'https://one.invalid/root/epg/api' }]);
        expect(JSON.stringify(document)).not.toMatch(/concurrentUploadNum|uploadReceiveTimeoutMs/u);
        expect((document.components?.schemas?.Config as any).properties).not.toHaveProperty('concurrentUploadNum');
        expect((document.components?.schemas?.Config as any).properties).not.toHaveProperty('uploadReceiveTimeoutMs');
    });

    it('returns the package version through the public version operation', async () => {
        const pkg = require(join(process.cwd(), 'package.json')) as { name: string; version: string };
        const canonicalPackageJson = join(compiledSnapshot!, '..', 'package.json');
        const originalReadFileSync = mutableFileSystem.readFileSync.bind(mutableFileSystem);
        const readFileSyncDouble = vi.fn((path: unknown, options?: unknown) => {
            if (String(path) === canonicalPackageJson) {
                return JSON.stringify(pkg);
            }
            return originalReadFileSync(path, options);
        });
        /*
         * version.js の `import * as fs from 'fs'` は静的に解決されるため、require() で読み込んだ
         * 名前空間 (mutableFileSystem) を後から書き換えても version.js 側には届かない (in-process の
         * 差し替えが効かない)。`vi.doMock('node:fs', ...)` で version.js が import する 'fs' 自体を
         * readFileSyncDouble へ委譲するラッパーへ差し替えたうえで `vi.resetModules()` してから動的
         * `import()` で読み直す。
         */
        vi.doMock('node:fs', () => ({
            ...mutableFileSystem,
            readFileSync: (path: unknown, options?: unknown) => readFileSyncDouble(path, options),
        }));
        let route: { get: Function };
        try {
            vi.resetModules();
            route = (await import(compiled('model', 'service', 'api', 'version.js'))) as { get: Function };
        } finally {
            vi.doUnmock('node:fs');
        }
        const response = {
            header: vi.fn(),
            json: vi.fn(),
            status: vi.fn(),
        };
        await route.get({}, response);
        expect(response.status).toHaveBeenCalledWith(200);
        expect(response.json).toHaveBeenCalledWith({ version: pkg.version });
    });
});

describe('Service Interface exact runtime compatibility [SI-3.1]', () => {
    it('keeps recorded stream info on the runtime viodeFileId spelling', async () => {
        const StreamApiModel = (require(compiled('model', 'api', 'stream', 'StreamApiModel.js')) as any).default;
        const streamManageModel = {
            getStreamInfos: vi.fn().mockReturnValue([
                {
                    info: {
                        isEnable: true,
                        mode: 2,
                        type: 'RecordedStream',
                        videoFileId: 42,
                    },
                    streamId: 81,
                },
            ]),
        };
        const videoFileDB = { findId: vi.fn().mockResolvedValue(null) };
        const model = new StreamApiModel(
            {},
            vi.fn(),
            vi.fn(),
            vi.fn(),
            vi.fn(),
            streamManageModel,
            {},
            videoFileDB,
            {},
            {},
            {},
        );

        const result = await model.getStreamInfos(false);

        expect(result).toEqual({
            items: [
                {
                    channelId: 0,
                    endAt: 0,
                    isEnable: true,
                    mode: 2,
                    name: '',
                    recordedId: 0,
                    startAt: 0,
                    streamId: 81,
                    type: 'RecordedStream',
                    viodeFileId: 42,
                },
            ],
        });
        expect(result.items[0]).not.toHaveProperty('videoFileId');
        expect(videoFileDB.findId).toHaveBeenCalledOnce();
        expect(videoFileDB.findId).toHaveBeenCalledWith(42);
    });

    it('keeps all four reserve-list classifications as arrays', async () => {
        const Reserve = (require(compiled('db', 'entities', 'Reserve.js')) as any).default;
        const ReserveApiModel = (require(compiled('model', 'api', 'reserve', 'ReserveApiModel.js')) as any).default;
        const reserve = (
            id: number,
            classification: Partial<{ isConflict: boolean; isOverlap: boolean; isSkip: boolean }>,
        ): any => Object.assign(new Reserve(), { id, ...classification });
        const findLists = vi
            .fn()
            .mockResolvedValue([
                reserve(11, {}),
                reserve(12, { isConflict: true }),
                reserve(13, { isSkip: true }),
                reserve(14, { isOverlap: true }),
            ]);
        const model = new ReserveApiModel({ reserveation: {} }, { findLists });
        const option = { endAt: 2_000, startAt: 1_000 };

        const result = await model.getLists(option);

        expect(result).toEqual({
            conflicts: [{ reserveId: 12 }],
            normal: [{ reserveId: 11 }],
            overlaps: [{ reserveId: 14 }],
            skips: [{ reserveId: 13 }],
        });
        expect(Object.values(result).every(Array.isArray)).toBe(true);
        expect(findLists).toHaveBeenCalledOnce();
        expect(findLists).toHaveBeenCalledWith(option);
    });

    // v2 の予約 API は channelType を返さず、client が channelId から channel 一覧を引いて
    // 放送波を得ていた（v2 client/src/model/channels/ChannelModel.ts:77-78）。v3 は予約 item 自体へ
    // 載せ、client の引き当てを不要にしている。公開 field なので契約として固定する。
    it('carries the broadcast wave on each public reserve item', async () => {
        const Reserve = (require(compiled('db', 'entities', 'Reserve.js')) as any).default;
        const ReserveApiModel = (require(compiled('model', 'api', 'reserve', 'ReserveApiModel.js')) as any).default;
        const stored = Object.assign(new Reserve(), {
            id: 31,
            channelId: 3273601024,
            channelType: 'GR',
            startAt: 1_000,
            endAt: 2_000,
            isTimeSpecified: false,
            allowEndLack: true,
            isConflict: false,
            isOverlap: false,
            isSkip: false,
            isDeleteOriginalAfterEncode: false,
            name: 'synthetic',
            halfWidthName: 'synthetic',
            ruleId: null,
            tags: null,
            parentDirectoryName: null,
            directory: null,
            recordedFormat: null,
            encodeMode1: null,
            encodeParentDirectoryName1: null,
            encodeDirectory1: null,
            encodeMode2: null,
            encodeParentDirectoryName2: null,
            encodeDirectory2: null,
            encodeMode3: null,
            encodeParentDirectoryName3: null,
            encodeDirectory3: null,
            rawExtended: null,
            rawHalfWidthExtended: null,
        });
        const findId = vi.fn().mockResolvedValue(stored);
        const model = new ReserveApiModel({ reserveation: {} }, { findId });

        const item = await model.get(31, true);

        // field の有無は api.d.ts の ReserveItem が required で守る（外すと TS2741 になる）。
        // ここで見るのは、entity の値がそのまま公開 item へ渡ることである。
        expect(item).toMatchObject({ channelId: 3273601024, channelType: 'GR' });
    });

    it('keeps both Rule creation POST routes on their exact 201 wire contract', () => {
        const expectedRuleOwner = 'IRuleApiModel';
        const rulePosts = schedulingRouteCases.filter(
            ({ file, method }) => method === 'post' && (file === 'rules' || file === 'rules/keyword'),
        );

        expect(rulePosts).toHaveLength(2);
        expect(
            rulePosts.map(({ body, file, ownerArgs, ownerMethod, ownerToken, status }) => ({
                body,
                file,
                ownerArgs,
                ownerMethod,
                ownerToken,
                status,
            })),
        ).toEqual([
            {
                body: { ruleId: 14 },
                file: 'rules',
                ownerArgs: [expect.any(Object)],
                ownerMethod: 'add',
                ownerToken: expectedRuleOwner,
                status: 201,
            },
            {
                body: { ruleId: 14 },
                file: 'rules/keyword',
                ownerArgs: [expect.any(Object)],
                ownerMethod: 'add',
                ownerToken: expectedRuleOwner,
                status: 201,
            },
        ]);
    });

    it('keeps recording timer reset bodyless with the exact success body', () => {
        const expectedRecordingOwner = 'IRecordingApiModel';
        const resetTimer = schedulingRouteCases.find(
            ({ file, method }) => file === 'recording/resettimer' && method === 'post',
        );

        expect(resetTimer).toMatchObject({
            body: { code: 200 },
            ownerArgs: [],
            ownerMethod: 'resetTimer',
            ownerToken: expectedRecordingOwner,
            request: {},
            status: 200,
        });
    });

    it('emits updateStatus and updateEncode with their existing names and no payload', async () => {
        vi.useFakeTimers();
        const SocketIOManageModel = (require(compiled('model', 'service', 'socketio', 'SocketIOManageModel.js')) as any)
            .default;
        const emit = vi.fn();
        const model = new SocketIOManageModel(
            { getLogger: () => ({ system: { info: vi.fn() } }) },
            { getConfig: () => ({}) },
        );
        Reflect.set(model, 'ios', [{ sockets: { emit } }]);

        model.notifyClient();
        model.notifyUpdateEncodeProgress();
        await vi.advanceTimersByTimeAsync(200);

        expect(emit.mock.calls).toEqual([['updateStatus'], ['updateEncode']]);
    });
});

describe('Service Interface OpenAPI document compatibility [SI-3.2]', () => {
    it('documents every runtime and public ReserveLists field as an array of ReserveListItem', () => {
        const publicTypes = readFileSync(join(process.cwd(), 'api.d.ts'), 'utf8');
        const declaration = publicTypes.match(/export interface ReserveLists \{(?<body>[\s\S]*?)\n\}/u)?.groups?.body;
        expect(declaration).toBeTypeOf('string');

        const ServiceServer = (require(compiled('model', 'service', 'ServiceServer.js')) as any).default;
        const service = Object.create(ServiceServer.prototype) as any;
        service.config = { apiServers: [] };
        const properties = service.getApiDocument(join(process.cwd(), 'api.yml')).components.schemas.ReserveLists
            .properties;

        for (const name of ['normal', 'conflicts', 'skips', 'overlaps'] as const) {
            expect(declaration, name).toMatch(new RegExp(`\\b${name}: ReserveListItem\\[\\];`, 'u'));
            expect(properties[name], name).toEqual({
                items: { $ref: '#/components/schemas/ReserveListItem' },
                type: 'array',
            });
        }
    });

    it('documents the runtime and public recorded-stream field as viodeFileId', () => {
        const publicTypes = readFileSync(join(process.cwd(), 'api.d.ts'), 'utf8');
        const declaration = publicTypes.match(/export interface VideoFileStreamInfoItem[^\{]*\{(?<body>[\s\S]*?)\n\}/u)
            ?.groups?.body;
        expect(declaration).toContain('viodeFileId: VideoFileId;');
        expect(declaration).not.toContain('videoFileId: VideoFileId;');

        const ServiceServer = (require(compiled('model', 'service', 'ServiceServer.js')) as any).default;
        const service = Object.create(ServiceServer.prototype) as any;
        service.config = { apiServers: [] };
        const properties = service.getApiDocument(join(process.cwd(), 'api.yml')).components.schemas.StreamInfoItem
            .properties;

        expect(properties).toHaveProperty('viodeFileId', { $ref: '#/components/schemas/VideoFileId' });
        expect(properties).not.toHaveProperty('videoFileId');
    });
});

describe('Service Interface feature-local external checkpoint', () => {
    // Starts several real HTTP/HTTPS/Socket.IO listener fixtures (same-listener, dedicated-listener, and
    // public-surface) plus real TLS handshakes and socket connections in one case; that real I/O work reliably
    // approaches Vitest's default 5000ms testTimeout under full-suite contention, so this needs an explicit,
    // generous budget.
    it('keeps HTTP/HTTPS same and dedicated Socket.IO listeners, client CA, CORS, and public access externally reachable', async () => {
        const sameCase = listenerMatrixCases.find(
            ({ name }) => name === 'HTTP and HTTPS with same Socket.IO listeners',
        );
        const dedicatedCase = listenerMatrixCases.find(
            ({ name }) => name === 'HTTP and HTTPS with dedicated Socket.IO listeners',
        );
        if (sameCase === undefined || dedicatedCase === undefined) {
            throw new Error('Task 8.3 listener checkpoint matrix is incomplete');
        }

        let same: Awaited<ReturnType<typeof startListenerFixture>> | undefined;
        let dedicated: Awaited<ReturnType<typeof startListenerFixture>> | undefined;
        let publicSurface: Awaited<ReturnType<typeof startPublicSurfaceFixture>> | undefined;
        try {
            same = await startListenerFixture(sameCase);
            dedicated = await startListenerFixture(dedicatedCase, {
                clientCertificateAuthority: syntheticClientCertificateAuthority(),
            });
            publicSurface = await startPublicSurfaceFixture(true);
            for (const application of same.applications) {
                await assertApplicationSurfaces(application);
                const notification = same.notificationListeners.find(
                    listener => listener.protocol === application.protocol,
                );
                expect(notification).toBeDefined();
                expect(notification?.server).toBe(application.server);
                await expect(
                    connectPollingSocketIoClient(notification as NonNullable<typeof notification>),
                ).resolves.toMatchObject({
                    confirmation: { status: 200 },
                });
            }

            const trusted = trustedSyntheticClientIdentity();
            for (const application of dedicated.applications) {
                const clientTls = application.protocol === 'https' ? trusted : undefined;
                const applicationResponse = await listenerExchange(await originOf(application), '/api/docs', {
                    clientTls,
                });
                const notification = dedicated.notificationListeners.find(
                    listener => listener.protocol === application.protocol,
                );
                expect(applicationResponse.status).toBe(200);
                expect(applicationResponse.headers['www-authenticate']).toBeUndefined();
                expect(notification).toBeDefined();
                expect(notification?.server).not.toBe(application.server);
                await expect(
                    connectPollingSocketIoClient(notification as NonNullable<typeof notification>, { clientTls }),
                ).resolves.toMatchObject({ confirmation: { status: 200 } });
            }

            const httpsApplication = dedicated.applications.find(listener => listener.protocol === 'https');
            const httpsNotification = dedicated.notificationListeners.find(listener => listener.protocol === 'https');
            if (httpsApplication === undefined || httpsNotification === undefined) {
                throw new Error('Task 8.3 dedicated HTTPS listener is missing');
            }
            await Promise.all([
                expect(listenerExchange(await originOf(httpsApplication), '/api/docs')).rejects.toBeInstanceOf(Error),
                expect(
                    listenerExchange(await originOf(httpsApplication), '/api/docs', {
                        clientTls: untrustedSyntheticClientIdentity(),
                    }),
                ).rejects.toBeInstanceOf(Error),
                expect(connectPollingSocketIoClient(httpsNotification)).rejects.toBeInstanceOf(Error),
            ]);

            const origin = 'https://task-8-3-origin.synthetic.invalid';
            const [web, api, notification] = await Promise.all([
                listenerExchange(publicSurface.origin, '/', { headers: { Origin: origin } }),
                listenerExchange(publicSurface.origin, '/api/config', { headers: { Origin: origin } }),
                connectPollingSocketIoClient(publicSurface.notificationListener, { headers: { Origin: origin } }),
            ]);
            expect(web).toMatchObject({ headers: { 'access-control-allow-origin': '*' }, status: 200 });
            expect(api).toMatchObject({ headers: { 'access-control-allow-origin': '*' }, status: 200 });
            expect(notification.confirmation).toMatchObject({
                headers: { 'access-control-allow-origin': '*' },
                status: 200,
            });
        } finally {
            await cleanupCheckpointResources([
                () => publicSurface?.cleanup() ?? Promise.resolve(),
                () => dedicated?.cleanup() ?? Promise.resolve(),
                () => same?.cleanup() ?? Promise.resolve(),
            ]);
        }
    }, 20_000);

    it('delivers independent payload-free notifications to a subdirectory Socket.IO client and never replays disconnected work', async () => {
        const SocketIOManageModel = (require(compiled('model', 'service', 'socketio', 'SocketIOManageModel.js')) as any)
            .default;
        let server: Server | undefined;
        let io: CheckpointSocketIoServer | undefined;
        try {
            const activeServer = createServer((_request, response) => {
                response.statusCode = 404;
                response.end();
            });
            server = activeServer;
            const model = new SocketIOManageModel(
                { getLogger: () => ({ system: { error: vi.fn(), info: vi.fn() } }) },
                { getConfig: () => ({ subDirectory: '/checkpoint' }) },
            );
            model.initialize([activeServer]);
            io = model.ios[0] as CheckpointSocketIoServer;
            activeServer.listen(0, checkpointLoopbackHost);
            const origin = await listen(activeServer);
            const client = await checkpointPollingClient(origin, '/checkpoint/socket.io');
            await expect(checkpointPollingClient(origin, '/socket.io')).rejects.toThrow(
                'Socket.IO opening packet was not received',
            );

            vi.useFakeTimers();
            model.notifyClient();
            model.notifyClient();
            await vi.advanceTimersByTimeAsync(100);
            model.notifyUpdateEncodeProgress();
            model.notifyUpdateEncodeProgress();
            await vi.advanceTimersByTimeAsync(100);

            const statusDelivery = await listenerExchange(origin, client.sessionPath);
            const statusEvents = statusDelivery.body.split('\u001e').filter(packet => packet.startsWith('42'));
            expect(statusEvents).toEqual(['42["updateStatus"]']);
            await vi.advanceTimersByTimeAsync(100);
            const encodeDelivery = await listenerExchange(origin, client.sessionPath);
            const encodeEvents = encodeDelivery.body.split('\u001e').filter(packet => packet.startsWith('42'));
            expect(encodeEvents).toEqual(['42["updateEncode"]']);
            vi.useRealTimers();

            const disconnected = await listenerExchange(origin, client.sessionPath, { body: '41', method: 'POST' });
            expect(disconnected.status).toBe(200);
            vi.useFakeTimers();
            model.notifyClient();
            model.notifyUpdateEncodeProgress();
            await vi.advanceTimersByTimeAsync(200);
            vi.useRealTimers();

            const reconnected = await checkpointPollingClient(origin, '/checkpoint/socket.io');
            expect(reconnected.confirmation).not.toContain('updateStatus');
            expect(reconnected.confirmation).not.toContain('updateEncode');
            vi.useFakeTimers();
            model.notifyClient();
            model.notifyUpdateEncodeProgress();
            await vi.advanceTimersByTimeAsync(200);
            vi.useRealTimers();

            const deliveryAfterReconnect = await listenerExchange(origin, reconnected.sessionPath);
            const eventsAfterReconnect = deliveryAfterReconnect.body
                .split('\u001e')
                .filter(packet => packet.startsWith('42'));
            expect(eventsAfterReconnect).toEqual(['42["updateStatus"]', '42["updateEncode"]']);
        } finally {
            vi.useRealTimers();
            await cleanupCheckpointResources([
                () => closeCheckpointSocketIo(io),
                () => (server?.listening === true ? close(server) : Promise.resolve()),
            ]);
        }
    });

    it('keeps normal HTTP and actual realtime delivery live while three partial uploads hold slots and rejects only the fourth before dispatch', async () => {
        const SocketIOManageModel = (require(compiled('model', 'service', 'socketio', 'SocketIOManageModel.js')) as any)
            .default;
        const registrationCompletion = Promise.withResolvers<void>();
        const dispatch = vi.fn(() => ({
            disposition: Promise.resolve({ completion: registrationCompletion.promise, kind: 'adopted' }),
        }));
        const channels = allRouteCases.find(candidate => candidate.file === 'channels' && candidate.method === 'get');
        if (channels === undefined) throw new Error('Task 8.3 normal API checkpoint route is missing');
        const getChannels = vi.fn(async () => structuredClone(channels.ownerResult));
        const pendingUploads: CheckpointRequest[] = [];
        let fourth: CheckpointRequest | undefined;
        let uploadRoot: string | undefined;
        let listener: Server | undefined;
        let io: CheckpointSocketIoServer | undefined;
        let ownerLookup: { mockRestore(): void } | undefined;
        try {
            const root = await mkdtemp(join(tmpdir(), 'epgstation-service-interface-task-8-3-'));
            uploadRoot = root;
            const service = checkpointUploadService(root);
            const activeListener = service.app.listen(0, checkpointLoopbackHost) as Server;
            listener = activeListener;
            const origin = await listen(activeListener);
            const notification = new SocketIOManageModel(
                { getLogger: () => ({ system: { error: vi.fn(), info: vi.fn() } }) },
                { getConfig: () => ({}) },
            );
            notification.initialize([activeListener]);
            const activeIo = notification.ios[0] as CheckpointSocketIoServer;
            io = activeIo;
            const upload = checkpointUploadBody();
            ownerLookup = vi.spyOn(modelContainer, 'get').mockImplementation((token: string) => {
                if (token === 'IIPCClient') return { uploadedVideoRegistrationPort: { dispatch } };
                if (token === channels.ownerToken) return { [channels.ownerMethod]: getChannels };
                throw new Error(`Unexpected Task 8.3 owner ${token}`);
            });
            const socketClient = await connectPollingSocketIoClient({ protocol: 'http', server: activeListener });
            pendingUploads.push(
                ...Array.from({ length: 3 }, () => {
                    const request = startCheckpointRequest(origin, {
                        headers: upload.headers,
                        method: 'POST',
                        path: '/api/videos/upload',
                    });
                    request.request.write(upload.body.subarray(0, upload.partialEnd));
                    return request;
                }),
            );
            await vi.waitFor(async () => expect(await readdir(join(root, 'incoming'))).toHaveLength(3));
            expect(dispatch).not.toHaveBeenCalled();

            fourth = startCheckpointRequest(origin, {
                headers: upload.headers,
                method: 'POST',
                path: '/api/videos/upload',
            });
            fourth.request.flushHeaders();
            const rejectedFourth = await fourth.response;
            fourth.request.destroy();

            const normalResponse = await sendCheckpointRequest(origin, { method: 'GET', path: '/api/channels' });
            vi.useFakeTimers();
            notification.notifyClient();
            await vi.advanceTimersByTimeAsync(200);
            vi.useRealTimers();
            const realtimeResponse = await listenerExchange(origin, socketClient.sessionPath);

            expect(rejectedFourth.status).toBe(400);
            expect(dispatch).not.toHaveBeenCalled();
            expect(await readdir(join(root, 'incoming'))).toHaveLength(3);
            expect(normalResponse.status).toBe(channels.status);
            expect(JSON.parse(normalResponse.body.toString('utf8'))).toEqual(channels.body);
            expect(getChannels).toHaveBeenCalledOnce();
            expect(realtimeResponse.body).toBe('42["updateStatus"]');

            for (const pending of pendingUploads) pending.request.end(upload.body.subarray(upload.partialEnd));
            await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(3));
            registrationCompletion.resolve();
            const completed = await Promise.all(pendingUploads.map(pending => pending.response));
            expect(completed.map(response => response.status)).toEqual([200, 200, 200]);
            await vi.waitFor(async () => expect(await readdir(join(root, 'incoming'))).toEqual([]));
        } finally {
            vi.useRealTimers();
            fourth?.request.destroy();
            for (const pending of pendingUploads) pending.request.end();
            registrationCompletion.resolve();
            await Promise.allSettled(pendingUploads.map(pending => pending.response));
            ownerLookup?.mockRestore();
            await cleanupCheckpointResources([
                () => closeCheckpointSocketIo(io),
                () => (listener?.listening === true ? close(listener) : Promise.resolve()),
                () => (uploadRoot === undefined ? Promise.resolve() : rm(uploadRoot, { force: true, recursive: true })),
            ]);
        }
    });

    it('isolates one destination failure for both notification channels without a fatal path or duplicate timer reset', async () => {
        const SocketIOManageModel = (require(compiled('model', 'service', 'socketio', 'SocketIOManageModel.js')) as any)
            .default;
        for (const notification of [
            { event: 'updateStatus', method: 'notifyClient', timer: 'callTimer' },
            { event: 'updateEncode', method: 'notifyUpdateEncodeProgress', timer: 'encodeProgressCallTimer' },
        ] as const) {
            vi.useFakeTimers();
            const error = new Error(`Task83${notification.event}Failure`);
            const logError = vi.fn();
            const logFatal = vi.fn();
            const model = new SocketIOManageModel(
                { getLogger: () => ({ system: { error: logError, fatal: logFatal, info: vi.fn() } }) },
                { getConfig: () => ({}) },
            );
            let timer = model[notification.timer];
            let timerResetCount = 0;
            Object.defineProperty(model, notification.timer, {
                configurable: true,
                get: () => timer,
                set: (value: unknown) => {
                    if (value === null) timerResetCount++;
                    timer = value;
                },
            });
            let resetBeforeFailure = false;
            const failingEmit = vi.fn(() => {
                resetBeforeFailure = model[notification.timer] === null;
                throw error;
            });
            const laterEmit = vi.fn();
            model.ios = [{ sockets: { emit: failingEmit } }, { sockets: { emit: laterEmit } }];

            model[notification.method]();
            await vi.advanceTimersByTimeAsync(200);

            expect(resetBeforeFailure).toBe(true);
            expect(timerResetCount).toBe(1);
            expect(failingEmit).toHaveBeenCalledExactlyOnceWith(notification.event);
            expect(laterEmit).toHaveBeenCalledExactlyOnceWith(notification.event);
            expect(logError).toHaveBeenCalledExactlyOnceWith(error);
            expect(logFatal).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
            vi.useRealTimers();
        }
    });
});
