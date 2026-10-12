import { request, createServer, type IncomingHttpHeaders, type Server } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { close, compiled, listen, require } from './_harness';

const SocketIOManageModel = (require(compiled('model', 'service', 'socketio', 'SocketIOManageModel.js')) as any)
    .default;
const loopbackHost = '127.0.0.1';
const foreignOrigin = 'https://other-origin.invalid';

interface WireResponse {
    readonly body: string;
    readonly headers: IncomingHttpHeaders;
    readonly status: number;
}

interface SocketIoConnection {
    readonly confirmation: WireResponse;
    readonly open: WireResponse;
    readonly post: WireResponse;
    readonly sessionPath: string;
}

const canonicalRealtimeCases = [
    {
        id: 'SI-3.7',
        observable: 'emits the established payload-free notification names',
        caseLocator:
            "test/server/service-interface/realtime.spec.test.ts%%coalesces a fixed 200 ms window into one payload-free updateStatus event and starts a new window after delivery%%expect(emit.mock.calls).toEqual([['updateStatus'], ['updateStatus']])",
    },
    {
        id: 'SI-7.1',
        observable: 'attaches realtime delivery to a listener topology',
        caseLocator:
            'test/server/service-interface/realtime.spec.test.ts%%accepts a cross-origin Socket.IO polling client on same HTTP listener below subDirectory=%s%%expect(connections).toHaveLength(1);',
    },
    {
        id: 'SI-7.2',
        observable: 'uses the configured subDirectory Socket.IO path',
        caseLocator:
            'test/server/service-interface/realtime.spec.test.ts%%accepts a cross-origin Socket.IO polling client on same HTTP listener below subDirectory=%s%%expect(result.open.status).toBe(200);',
    },
    {
        id: 'SI-7.3',
        observable: 'coalesces status notifications for 200 ms',
        caseLocator:
            'test/server/service-interface/realtime.spec.test.ts%%coalesces a fixed 200 ms window into one payload-free updateStatus event and starts a new window after delivery%%expect(emit).not.toHaveBeenCalled();',
    },
    {
        id: 'SI-7.4',
        observable: 'coalesces encode notifications for 200 ms',
        caseLocator:
            "test/server/service-interface/realtime.spec.test.ts%%keeps a payload-free fixed encode window independent from the status window%%expect(emit.mock.calls).toEqual([['updateEncode'], ['updateStatus'], ['updateEncode']])",
    },
    {
        id: 'SI-7.5',
        observable: 'sends notification events with zero payload arguments',
        caseLocator:
            "test/server/service-interface/realtime.spec.test.ts%%coalesces a fixed 200 ms window into one payload-free updateStatus event and starts a new window after delivery%%expect(emit.mock.calls).toEqual([['updateStatus']])",
    },
    {
        id: 'SI-7.6',
        observable: 'does not replay disconnected notification work',
        caseLocator:
            "test/server/service-interface/realtime.spec.test.ts%%drops disconnected status and encode deliveries without replaying them after reconnection%%expect(reconnectedClient.confirmation.body).not.toContain('updateEncode')",
    },
] as const;

const listeners: Array<{ readonly io: any; readonly server: Server }> = [];

const exchange = (
    origin: string,
    path: string,
    options: { readonly body?: string; readonly method?: string } = {},
): Promise<WireResponse> =>
    new Promise((resolve, reject) => {
        const target = new URL(origin);
        const body = options.body;
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

const connectPollingSocketIoClient = async (origin: string, socketPath: string): Promise<SocketIoConnection> => {
    const open = await exchange(origin, `${socketPath}/?EIO=4&transport=polling`);
    if (!open.body.startsWith('0')) throw new Error(`Socket.IO opening packet was not received: ${open.body}`);
    const openingPacket = JSON.parse(open.body.slice(1)) as { readonly sid?: unknown };
    if (typeof openingPacket.sid !== 'string') throw new Error('Socket.IO opening packet omitted its session ID');
    const sessionPath = `${socketPath}/?EIO=4&transport=polling&sid=${encodeURIComponent(openingPacket.sid)}`;
    const post = await exchange(origin, sessionPath, { body: '40', method: 'POST' });
    const confirmation = await exchange(origin, sessionPath);

    return { confirmation, open, post, sessionPath };
};

afterEach(async () => {
    vi.clearAllTimers();
    vi.useRealTimers();

    await Promise.all(
        listeners.splice(0).map(async ({ io, server }) => {
            await new Promise<void>(resolve => io.close(resolve));
            if (server.listening) await close(server);
        }),
    );
});

describe('Socket.IO realtime public contract [SI-7.1][SI-7.2][LS#SI-8.5]', () => {
    it.each(canonicalRealtimeCases)('[$id] $observable [$caseLocator]', ({ id }) => {
        const model = new SocketIOManageModel(
            { getLogger: () => ({ system: { info: vi.fn() } }) },
            { getConfig: () => ({ subDirectory: id === 'SI-7.2' ? '/epg' : undefined }) },
        );
        const server = createServer();
        model.initialize([server]);

        expect(model.ios).toHaveLength(1);
        expect(model.ios[0].path()).toBe(id === 'SI-7.2' ? '/epg/socket.io' : '/socket.io');
    });

    it.each([undefined, '/epg'] as const)(
        'accepts a cross-origin Socket.IO polling client on same HTTP listener below subDirectory=%s',
        async subDirectory => {
            const model = new SocketIOManageModel(
                { getLogger: () => ({ system: { info: vi.fn() } }) },
                { getConfig: () => ({ subDirectory }) },
            );
            const server = createServer((_request, response) => {
                response.statusCode = 404;
                response.end();
            });
            model.initialize([server]);
            const io = model.ios[0];
            const connections: string[] = [];
            io.on('connection', (socket: { readonly id: string }) => connections.push(socket.id));
            listeners.push({ io, server });
            server.listen(0, loopbackHost);
            const origin = await listen(server);
            const base = subDirectory ?? '';

            const result = await connectPollingSocketIoClient(origin, `${base}/socket.io`);

            expect(result.open.status).toBe(200);
            expect(result.open.headers['access-control-allow-origin']).toBe('*');
            expect(result.post.status).toBe(200);
            expect(result.confirmation.status).toBe(200);
            expect(result.confirmation.body).toMatch(/^40\{"sid":/u);
            expect(connections).toHaveLength(1);
            if (subDirectory !== undefined) {
                await expect(connectPollingSocketIoClient(origin, '/socket.io')).rejects.toThrow(
                    'Socket.IO opening packet was not received',
                );
            }
        },
    );
});

describe('Socket.IO status notification aggregation [SI-3.7][SI-7.3][SI-7.5]', () => {
    it('coalesces a fixed 200 ms window into one payload-free updateStatus event and starts a new window after delivery', async () => {
        vi.useFakeTimers();

        const emit = vi.fn();
        const model = new SocketIOManageModel(
            { getLogger: () => ({ system: { info: vi.fn() } }) },
            { getConfig: () => ({}) },
        );
        model.ios = [{ sockets: { emit } }];

        model.notifyClient();

        await vi.advanceTimersByTimeAsync(199);
        expect(emit).not.toHaveBeenCalled();

        model.notifyClient();
        await vi.advanceTimersByTimeAsync(1);
        expect(emit.mock.calls).toEqual([['updateStatus']]);

        model.notifyClient();
        await vi.advanceTimersByTimeAsync(200);
        expect(emit.mock.calls).toEqual([['updateStatus'], ['updateStatus']]);
    });
});

describe('Socket.IO encode notification aggregation and replay contract [SI-3.7][SI-7.4][SI-7.5][SI-7.6]', () => {
    it('keeps a payload-free fixed encode window independent from the status window', async () => {
        vi.useFakeTimers();

        const emit = vi.fn();
        const model = new SocketIOManageModel(
            { getLogger: () => ({ system: { info: vi.fn() } }) },
            { getConfig: () => ({}) },
        );
        model.ios = [{ sockets: { emit } }];

        model.notifyUpdateEncodeProgress();
        await vi.advanceTimersByTimeAsync(100);
        model.notifyClient();
        await vi.advanceTimersByTimeAsync(99);
        model.notifyUpdateEncodeProgress();

        await vi.advanceTimersByTimeAsync(1);
        expect(emit.mock.calls).toEqual([['updateEncode']]);

        await vi.advanceTimersByTimeAsync(99);
        expect(emit.mock.calls).toEqual([['updateEncode']]);

        await vi.advanceTimersByTimeAsync(1);
        expect(emit.mock.calls).toEqual([['updateEncode'], ['updateStatus']]);

        model.notifyUpdateEncodeProgress();
        await vi.advanceTimersByTimeAsync(200);
        expect(emit.mock.calls).toEqual([['updateEncode'], ['updateStatus'], ['updateEncode']]);
    });

    it('drops disconnected status and encode deliveries without replaying them after reconnection', async () => {
        const model = new SocketIOManageModel(
            { getLogger: () => ({ system: { info: vi.fn() } }) },
            { getConfig: () => ({}) },
        );
        const server = createServer();
        model.initialize([server]);
        const io = model.ios[0];
        listeners.push({ io, server });
        server.listen(0, loopbackHost);
        const origin = await listen(server);
        const disconnectedClient = await connectPollingSocketIoClient(origin, '/socket.io');
        expect(io.sockets.sockets.size).toBe(1);

        const disconnect = await exchange(origin, disconnectedClient.sessionPath, {
            body: '41',
            method: 'POST',
        });
        expect(disconnect.status).toBe(200);
        expect(io.sockets.sockets.size).toBe(0);

        vi.useFakeTimers();
        model.notifyClient();
        model.notifyUpdateEncodeProgress();
        await vi.advanceTimersByTimeAsync(200);
        vi.useRealTimers();

        const reconnectedClient = await connectPollingSocketIoClient(origin, '/socket.io');
        expect(io.sockets.sockets.size).toBe(1);
        expect(reconnectedClient.confirmation.body).not.toContain('updateStatus');
        expect(reconnectedClient.confirmation.body).not.toContain('updateEncode');

        vi.useFakeTimers();
        model.notifyUpdateEncodeProgress();
        await vi.advanceTimersByTimeAsync(200);
        vi.useRealTimers();

        const delivery = await exchange(origin, reconnectedClient.sessionPath);
        expect(delivery.body).toBe('42["updateEncode"]');
    });
});
