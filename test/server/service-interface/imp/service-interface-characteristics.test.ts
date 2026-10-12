import express from 'express';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { IncomingHttpHeaders, Server } from 'node:http';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { close, compiled, listen, require } from '../_harness';

// Task 9.2 consumes these existing concrete characteristic suites through its one approved target.
import './iptv-carrier.test';
import './realtime-notifier.test';
import './upload-lifecycle.test';
import '../listener.spec.test';

const ServiceServer = (require(compiled('model', 'service', 'ServiceServer.js')) as any).default;

/*
 * api.js の `import * as fs from 'fs'` は静的に解決されるため、require() で読み込んだ 'node:fs' の
 * CommonJS module.exports を後から書き換えても ESM 側の import 束縛には届かない (in-process の従来の
 * `vi.spyOn(require('node:fs'), 'createReadStream')` 差し替えが効かなくなった)。`vi.doMock('fs', ...)` /
 * `vi.doMock('node:fs', ...)` で api.js が import する 'fs' 自体を、実体へ委譲しつつ名前ごとに上書き可能な
 * Proxy へ差し替えたうえで、動的 `import()` で読み直す（既存の合格例: public-contract.spec.test.ts の
 * version.js 差し替え、service-server-mutation-oracles.test.ts / upload-lifecycle.test.ts の同種対応）。
 */
const actualFileSystemForApi = require('node:fs') as Record<string, any>;
const apiFsOverrides = new Map<string, (...args: any[]) => any>();
const apiFsProxy = new Proxy(actualFileSystemForApi, {
    get(target, prop, receiver) {
        if (typeof prop === 'string' && apiFsOverrides.has(prop)) return apiFsOverrides.get(prop);
        return Reflect.get(target, prop, receiver);
    },
});
vi.doMock('fs', () => apiFsProxy);
vi.doMock('node:fs', () => apiFsProxy);
const spyOnApiFs = (name: string): ReturnType<typeof vi.fn> => {
    const spy = vi.fn((...args: any[]) => (actualFileSystemForApi as any)[name](...args));
    apiFsOverrides.set(name, spy);
    return spy;
};

const { isSecureProtocol, responseFile, responseJSON, responseServerError } = (await import(
    compiled('model', 'service', 'api.js')
)) as {
    isSecureProtocol(request: unknown): boolean;
    responseFile(request: unknown, response: unknown, filePath: string, mime: string): void;
    responseJSON(response: unknown, code: number, body?: unknown): unknown;
    responseServerError(response: unknown, errors?: string): unknown;
};

interface RawResponse {
    readonly body: Buffer;
    readonly headers: IncomingHttpHeaders;
    readonly status: number;
}

interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T): void;
}

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

let rangeFile = '';
let rangeOrigin = '';
let rangeRoot = '';
let rangeServer: Server;

const deferred = <T>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

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

const task9ImplementationFamilies = [
    'subDirectory / Host / scheme',
    'OpenAPI coercion without adapter second-floor',
    'upload defaults, bounds, deadline, finalizer, and namespace races',
    'status / encode 200 ms and destination failure isolation',
    'listener TLS and CORS boundaries',
] as const;

const rawRangeRequest = (range?: string): Promise<RawResponse> =>
    new Promise((resolve, reject) => {
        const target = new URL(rangeOrigin);
        const chunks: Buffer[] = [];
        const socket = createConnection({ host: target.hostname, port: Number(target.port) });
        socket.once('connect', () => {
            const rangeHeader = range === undefined ? [] : [`Range: ${range}`];
            socket.write(
                Buffer.from(
                    ['GET /range HTTP/1.1', `Host: ${target.host}`, 'Connection: close', ...rangeHeader]
                        .concat('', '')
                        .join('\r\n'),
                ),
            );
        });
        socket.on('data', chunk => chunks.push(Buffer.from(chunk)));
        socket.once('error', reject);
        socket.once('close', () => {
            const wire = Buffer.concat(chunks);
            const separator = wire.indexOf('\r\n\r\n');
            if (separator === -1) return reject(new Error('Raw HTTP response did not contain a header terminator'));
            const [statusLine, ...headerLines] = wire.subarray(0, separator).toString('latin1').split('\r\n');
            const status = Number(statusLine.match(/^HTTP\/1\.1 (?<status>\d{3})/u)?.groups?.status ?? 0);
            const headers: IncomingHttpHeaders = {};
            for (const line of headerLines) {
                const colon = line.indexOf(':');
                if (colon === -1) continue;
                headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
            }
            resolve({ body: wire.subarray(separator + 4), headers, status });
        });
    });

const rawKeepAliveRangeRequests = (ranges: readonly string[]): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        const target = new URL(rangeOrigin);
        const chunks: Buffer[] = [];
        const socket = createConnection({ host: target.hostname, port: Number(target.port) });
        socket.once('connect', () => {
            const requests = ranges.map((range, index) =>
                [
                    'GET /range HTTP/1.1',
                    `Host: ${target.host}`,
                    `Connection: ${index === ranges.length - 1 ? 'close' : 'keep-alive'}`,
                    `Range: ${range}`,
                    '',
                    '',
                ].join('\r\n'),
            );
            socket.write(Buffer.from(requests.join('')));
        });
        socket.on('data', chunk => chunks.push(Buffer.from(chunk)));
        socket.once('error', reject);
        socket.once('close', () => resolve(Buffer.concat(chunks)));
    });

const splitHttpResponses = (wire: Buffer): { body: string; head: string }[] => {
    const responses: { body: string; head: string }[] = [];
    let offset = 0;
    while (offset < wire.length) {
        const separator = wire.indexOf('\r\n\r\n', offset);
        if (separator === -1) throw new Error('Raw HTTP response did not contain a header terminator');
        const head = wire.subarray(offset, separator).toString('latin1');
        const length = Number(head.match(/^content-length: (?<length>\d+)$/imu)?.groups?.length ?? 0);
        responses.push({ body: wire.subarray(separator + 4, separator + 4 + length).toString('latin1'), head });
        offset = separator + 4 + length;
    }
    return responses;
};

beforeAll(async () => {
    rangeRoot = await mkdtemp(join(tmpdir(), 'epgstation-response-file-range-'));
    rangeFile = join(rangeRoot, 'eight-bytes.bin');
    await writeFile(rangeFile, '01234567');
    const app = express();
    app.get('/range', (request, response) => {
        try {
            responseFile(request, response, rangeFile, 'video/mp2t');
        } catch (error: any) {
            responseServerError(response, error.message);
        }
    });
    rangeServer = app.listen(0, '127.0.0.1');
    rangeOrigin = await listen(rangeServer);
});

afterEach(() => {
    vi.restoreAllMocks();
    apiFsOverrides.clear();
});

afterAll(async () => {
    if (rangeServer?.listening === true) await close(rangeServer);
    await rm(rangeRoot, { force: true, recursive: true });
});

describe('Service Interface formal implementation characteristics', () => {
    it.each([
        [undefined, '/api'],
        ['/epg', '/epg/api'],
    ] as const)('maps /api through subDirectory=%s exactly once', (subDirectory, expected) => {
        const service = Object.create(ServiceServer.prototype) as any;
        service.config = { subDirectory };

        expect(service.createUrl('/api')).toBe(expected);
    });

    it.each([
        ['http', undefined, false],
        ['https', undefined, true],
        ['http', 'https', true],
    ] as const)('maps protocol=%s forwarded=%s to secure=%s', (protocol, forwarded, expected) => {
        expect(
            isSecureProtocol({
                header: (name: string) => (name.toLowerCase() === 'x-forwarded-proto' ? forwarded : undefined),
                protocol,
            }),
        ).toBe(expected);
    });
});

describe('Service Interface aggregate implementation characteristics [IMP#SI-9.2]', () => {
    it('keeps every required implementation family in this exact target', () => {
        expect(task9ImplementationFamilies).toEqual([
            'subDirectory / Host / scheme',
            'OpenAPI coercion without adapter second-floor',
            'upload defaults, bounds, deadline, finalizer, and namespace races',
            'status / encode 200 ms and destination failure isolation',
            'listener TLS and CORS boundaries',
        ]);
    });
});

describe('Service Interface common JSON response characteristics [SI-4.1]', () => {
    it('writes the exact private no-cache headers on a normal JSON response', () => {
        const response = {
            header: vi.fn(),
            json: vi.fn(),
            status: vi.fn(),
        };
        const body = { result: 'synthetic' };

        expect(responseJSON(response, 201, body)).toBe(response);

        expect(response.status).toHaveBeenCalledOnce();
        expect(response.status).toHaveBeenCalledWith(201);
        expect(response.header.mock.calls).toEqual([
            ['Cache-Control', 'private, no-cache, no-store, must-revalidate'],
            ['Expires', '-1'],
            ['Pragma', 'no-cache'],
        ]);
        expect(response.json).toHaveBeenCalledOnce();
        expect(response.json).toHaveBeenCalledWith(body);
    });

    it.each([
        [undefined, { code: 500, message: 'Internal Server Error' }],
        ['synthetic-owner-failure', { code: 500, errors: 'synthetic-owner-failure', message: 'Internal Server Error' }],
    ] as const)('writes HTTP 500 with optional errors=%s', (errors, expected) => {
        const response = {
            json: vi.fn(),
            status: vi.fn(),
        };

        expect(responseServerError(response, errors)).toBe(response);

        expect(response.status).toHaveBeenCalledOnce();
        expect(response.status).toHaveBeenCalledWith(500);
        expect(response.json).toHaveBeenCalledOnce();
        expect(response.json).toHaveBeenCalledWith(expected);
    });
});

describe('Service Interface response-file byte range matrix [IMP#SI-9.2]', () => {
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
        '$name preserves helper wire bytes and file-handle ownership [IMP#SI-9.2/$name]',
        async rangeCase => {
            const actualCreateReadStream = actualFileSystemForApi.createReadStream.bind(actualFileSystemForApi);
            const releases: Promise<void>[] = [];
            let releaseCount = 0;
            const createReadStream = spyOnApiFs('createReadStream').mockImplementation(((...args: unknown[]) => {
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
            }) as typeof actualFileSystemForApi.createReadStream);

            const response = await rawRangeRequest(rangeCase.range);
            await Promise.all(releases);

            expect(response.status).toBe(rangeCase.status);
            expect(response.headers['content-range']).toBe(rangeCase.contentRange);
            expect(response.headers['content-length']).toBe(rangeCase.contentLength);
            expect(response.body).toEqual(Buffer.from(rangeCase.body));
            expect(createReadStream).toHaveBeenCalledTimes(rangeCase.createReadStreamCount);
            expect(releaseCount).toBe(rangeCase.releaseCount);
        },
    );

    it('keeps the response that follows a single-byte range intact on a reused connection [IMP#SI-9.2/range-start-equals-end-keep-alive]', async () => {
        const responses = splitHttpResponses(await rawKeepAliveRangeRequests(['bytes=3-3', 'bytes=0-1']));

        expect(responses).toHaveLength(2);
        expect(responses[0].head).toMatch(/^HTTP\/1\.1 206 /u);
        expect(responses[0].head).toMatch(/^content-range: bytes 3-3\/8$/imu);
        expect(responses[0].body).toBe('3');
        expect(responses[1].head).toMatch(/^HTTP\/1\.1 206 /u);
        expect(responses[1].head).toMatch(/^content-range: bytes 0-1\/8$/imu);
        expect(responses[1].body).toBe('01');
    });

    it('releases a real range stream once when the client closes before stream completion [IMP#SI-9.2/range-client-close-race]', async () => {
        const actualCreateReadStream = actualFileSystemForApi.createReadStream.bind(actualFileSystemForApi);
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
        const createReadStream = spyOnApiFs('createReadStream').mockImplementation(((...args: unknown[]) => {
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
        }) as typeof actualFileSystemForApi.createReadStream);

        try {
            const app = express();
            app.get('/range-client-close', (request, response) => {
                responseFile(request, response, rangeFile, 'video/mp2t');
            });
            listener = app.listen(0, '127.0.0.1');
            const raceOrigin = await listen(listener);
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
                    'GET /range-client-close HTTP/1.1',
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
            createReadStream.mockRestore();
        }
    });
});
