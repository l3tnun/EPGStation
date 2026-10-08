import { once } from 'node:events';
import {
    createServer as createHttpServer,
    request as httpRequest,
    type IncomingHttpHeaders,
    type Server,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { close, compiled, require } from './_harness';

const SocketIOManageModel = (require(compiled('model', 'service', 'socketio', 'SocketIOManageModel.js')) as any)
    .default;
const ServiceServer = (require(compiled('model', 'service', 'ServiceServer.js')) as any).default;
const express = require('express') as () => any;
const loopbackHost = '127.0.0.1';
const foreignOrigin = 'https://another-origin.invalid';

type Scheme = 'http' | 'https';

interface WireResponse {
    readonly body: string;
    readonly headers: IncomingHttpHeaders;
    readonly status: number;
}

interface SocketFixture {
    readonly application: Server | null;
    readonly configuredSocketPort: number | undefined;
    readonly io: any;
    readonly listener: Server;
}

const fixtures: SocketFixture[] = [];

const originFor = async (server: Server, scheme: Scheme): Promise<string> => {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Synthetic listener did not bind TCP');
    return `${scheme}://${loopbackHost}:${String(address.port)}`;
};

const reservePort = async (): Promise<number> => {
    const probe = createHttpServer();
    probe.listen(0, loopbackHost);
    await once(probe, 'listening');
    const address = probe.address();
    if (address === null || typeof address === 'string')
        throw new Error('Dedicated Socket.IO port probe did not bind TCP');
    await close(probe);
    return address.port;
};

const exchange = (
    origin: string,
    path: string,
    options: { readonly body?: string; readonly method?: string } = {},
): Promise<WireResponse> =>
    new Promise((resolve, reject) => {
        const target = new URL(origin);
        const body = options.body;
        const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
        const outgoing = request(
            {
                headers: {
                    ...(body === undefined
                        ? {}
                        : {
                              'Content-Length': String(Buffer.byteLength(body)),
                              'Content-Type': 'text/plain;charset=UTF-8',
                          }),
                    Origin: foreignOrigin,
                },
                hostname: target.hostname,
                method: options.method ?? 'GET',
                path,
                port: target.port,
                ...(target.protocol === 'https:' ? { rejectUnauthorized: false } : {}),
            },
            response => {
                const chunks: Buffer[] = [];
                response.on('data', chunk => chunks.push(Buffer.from(chunk)));
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

const connectPollingSocketIoClient = async (origin: string, socketPath: string): Promise<WireResponse> => {
    const open = await exchange(origin, `${socketPath}/?EIO=4&transport=polling`);
    if (!open.body.startsWith('0')) throw new Error(`Socket.IO opening packet was not received: ${open.body}`);
    const openingPacket = JSON.parse(open.body.slice(1)) as { readonly sid?: unknown };
    if (typeof openingPacket.sid !== 'string') throw new Error('Socket.IO opening packet omitted its session ID');
    const sessionPath = `${socketPath}/?EIO=4&transport=polling&sid=${encodeURIComponent(openingPacket.sid)}`;
    const post = await exchange(origin, sessionPath, { body: '40', method: 'POST' });
    if (post.status !== 200) throw new Error(`Socket.IO connect packet was rejected: ${post.status}`);
    return exchange(origin, sessionPath);
};

const startService = async (
    scheme: Scheme,
    dedicated: boolean,
    subDirectory: string | undefined,
): Promise<SocketFixture> => {
    const socketIoManageModel = new SocketIOManageModel(
        { getLogger: () => ({ system: { info: vi.fn() } }) },
        { getConfig: () => ({ subDirectory }) },
    );
    const initialized = vi.spyOn(socketIoManageModel, 'initialize');
    const app = express();
    const originalListen = app.listen.bind(app);
    let application: Server | null = null;
    app.listen = (...args: any[]): Server => {
        application = originalListen(...args);
        return application;
    };
    const dedicatedPort = dedicated ? await reservePort() : undefined;
    const configuration =
        scheme === 'http'
            ? { ...(dedicatedPort === undefined ? {} : { socketioPort: dedicatedPort }), port: 0, subDirectory }
            : {
                  https: {
                      ...(dedicatedPort === undefined ? {} : { socketioPort: dedicatedPort }),
                      cert: join(process.cwd(), 'test/server/fixtures/configuration/synthetic-tls-cert.pem'),
                      key: join(process.cwd(), 'test/server/fixtures/configuration/synthetic-tls-key.pem'),
                      port: 0,
                  },
                  subDirectory,
              };
    const service = Object.create(ServiceServer.prototype) as any;
    service.app = app;
    service.config = configuration;
    service.log = { system: { info: vi.fn() } };
    service.socketIoManageModel = socketIoManageModel;
    service.start();

    const socketListeners = initialized.mock.calls[0]?.[0] as Server[] | undefined;
    if (socketListeners === undefined || socketListeners.length !== 1) {
        throw new Error('ServiceServer did not supply exactly one Socket.IO listener');
    }
    const listener = socketListeners[0];
    const io = socketIoManageModel.ios[0];
    if (io === undefined) throw new Error('Socket.IO server was not initialized');
    await originFor(listener, scheme);
    if (application !== null) await originFor(application, 'http');

    return { application, configuredSocketPort: dedicatedPort, io, listener };
};

afterEach(async () => {
    await Promise.all(
        fixtures.splice(0).map(async ({ application, io, listener }) => {
            await new Promise<void>(resolve => io.close(resolve));
            if (listener.listening) await close(listener);
            if (application !== listener && application?.listening) await close(application);
        }),
    );
});

describe('Socket.IO actual listener connection matrix [SI-7.1][SI-7.2][LS#SI-8.5]', () => {
    it.each([
        { dedicated: false, kind: 'same HTTP listener', scheme: 'http' as const, subDirectory: undefined },
        { dedicated: false, kind: 'same HTTPS listener', scheme: 'https' as const, subDirectory: undefined },
        { dedicated: true, kind: 'dedicated HTTP listener', scheme: 'http' as const, subDirectory: '/epg' },
    ])('connects a Socket.IO polling client through the $kind', async ({ dedicated, scheme, subDirectory }) => {
        const { application, configuredSocketPort, io, listener } = await startService(scheme, dedicated, subDirectory);
        const connections: string[] = [];
        io.on('connection', (socket: { readonly id: string }) => connections.push(socket.id));
        fixtures.push({ application, io, listener });
        const socketOrigin = await originFor(listener, scheme);
        const socketPath = `${subDirectory ?? ''}/socket.io`;

        const confirmation = await connectPollingSocketIoClient(socketOrigin, socketPath);

        expect(confirmation.status).toBe(200);
        expect(confirmation.headers['access-control-allow-origin']).toBe('*');
        expect(confirmation.body).toMatch(/^40\{"sid":/u);
        expect(connections).toHaveLength(1);
        if (dedicated) {
            expect(new URL(socketOrigin).port).toBe(String(configuredSocketPort));
            if (application !== null) {
                expect(listener).not.toBe(application);
                await expect(
                    connectPollingSocketIoClient(await originFor(application, 'http'), socketPath),
                ).rejects.toThrow('Socket.IO opening packet was not received');
            }
        } else if (application !== null) {
            expect(listener).toBe(application);
        }
    });
});
