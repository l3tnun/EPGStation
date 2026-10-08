import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Socket } from 'node:net';
import { describe, expect, it, vi } from 'vitest';

import type { Logger } from 'log4js';

type AccessMiddleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required');
}

const ServiceServer = (
    require(join(compiledSnapshot, 'model', 'service', 'ServiceServer.js')) as {
        default: { readonly prototype: object };
    }
).default;
const loopbackHost = '127.0.0.1';

const createAccessMiddleware = (): {
    readonly log: ReturnType<typeof vi.fn>;
    readonly middleware: AccessMiddleware;
} => {
    const log = vi.fn();
    const accessLogger = {
        isLevelEnabled: () => true,
        log,
    } as unknown as Logger;
    const use = vi.fn();
    const service = Object.create(ServiceServer.prototype) as {
        app: { use(middleware: AccessMiddleware): void };
        log: { access: Logger };
        setLog(): void;
    };
    service.app = { use };
    service.log = { access: accessLogger };

    service.setLog();

    if (use.mock.calls.length !== 1) {
        throw new Error('ServiceServer did not register exactly one access middleware');
    }
    return {
        log,
        middleware: use.mock.calls[0][0] as AccessMiddleware,
    };
};

const listen = (server: ReturnType<typeof createServer>): Promise<number> =>
    new Promise((resolve, reject) => {
        const onError = (error: Error) => {
            server.off('listening', onListening);
            reject(error);
        };
        const onListening = () => {
            server.off('error', onError);
            const address = server.address();
            if (address === null || typeof address === 'string') {
                reject(new Error('Loopback HTTP server did not expose a TCP address'));
                return;
            }
            resolve((address as AddressInfo).port);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(0, loopbackHost);
    });

const closeServer = async (server: ReturnType<typeof createServer>, sockets: ReadonlySet<Socket>): Promise<number> => {
    for (const socket of sockets) {
        socket.destroy();
    }
    if (server.listening) {
        await new Promise<void>((resolve, reject) => {
            server.close(error => {
                if (error === undefined) {
                    resolve();
                } else {
                    reject(error);
                }
            });
        });
    }
    await new Promise<void>(resolve => setImmediate(resolve));
    return sockets.size;
};

const performRequest = (port: number): Promise<{ readonly body: string; readonly statusCode: number | undefined }> =>
    new Promise((resolve, reject) => {
        const clientRequest = request(
            {
                agent: false,
                headers: {
                    authorization: 'synthetic-authorization-allow',
                    connection: 'close',
                    referer: 'https://synthetic.invalid/schedule',
                    'user-agent': 'SyntheticLoopbackAgent/1.0',
                },
                host: loopbackHost,
                method: 'POST',
                path: '/synthetic/resource?source=integration',
                port,
            },
            response => {
                const chunks: Buffer[] = [];
                response.on('data', chunk => chunks.push(Buffer.from(chunk)));
                response.once('error', reject);
                response.once('end', () => {
                    resolve({
                        body: Buffer.concat(chunks).toString('utf8'),
                        statusCode: response.statusCode,
                    });
                });
            },
        );
        clientRequest.once('error', reject);
        clientRequest.end();
    });

describe('HTTP access logging loopback integration', () => {
    it('[OL-HTTP-LOOPBACK] records one line without changing the business response', async () => {
        const { log, middleware } = createAccessMiddleware();
        const sockets = new Set<Socket>();
        const responseBody = JSON.stringify({ accepted: true, source: 'synthetic' });
        const server = createServer((incomingRequest, outgoingResponse) => {
            middleware(incomingRequest, outgoingResponse, () => {
                const authorized = incomingRequest.headers.authorization === 'synthetic-authorization-allow';
                const body = authorized ? responseBody : JSON.stringify({ accepted: false });
                outgoingResponse.statusCode = authorized ? 202 : 403;
                outgoingResponse.setHeader('content-type', 'application/json');
                outgoingResponse.setHeader('content-length', Buffer.byteLength(body));
                outgoingResponse.end(body);
            });
        });
        const baselineConnectionListeners = server.listenerCount('connection');
        const onConnection = (socket: Socket): void => {
            sockets.add(socket);
            socket.once('close', () => sockets.delete(socket));
        };
        server.on('connection', onConnection);

        let remainingSockets = -1;
        try {
            const port = await listen(server);
            const response = await performRequest(port);

            expect(response).toEqual({
                body: responseBody,
                statusCode: 202,
            });
            expect(log).toHaveBeenCalledOnce();
            const record = String(log.mock.calls[0][1]);
            expect(record).toContain(loopbackHost);
            expect(record).toContain('"POST /synthetic/resource?source=integration HTTP/1.1"');
            expect(record).toContain('202');
            expect(record).toContain(Buffer.byteLength(responseBody).toString(10));
            expect(record).toContain('"https://synthetic.invalid/schedule"');
            expect(record).toContain('"SyntheticLoopbackAgent/1.0"');
        } finally {
            remainingSockets = await closeServer(server, sockets);
            server.off('connection', onConnection);
        }

        expect(remainingSockets).toBe(0);
        expect(server.listening).toBe(false);
        expect(server.listenerCount('connection')).toBe(baselineConnectionListeners);
        expect(log).toHaveBeenCalledOnce();
    });
});
