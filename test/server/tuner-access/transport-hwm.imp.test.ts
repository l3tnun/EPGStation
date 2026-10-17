import { createServer, IncomingMessage, RequestOptions, request as nodeRequest, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');
const TunerHttpTransport = (
    require(join(snapshot, 'model', 'tuner', 'transport', 'TunerHttpTransport.js')) as any
).default;
const { parseConnectionTarget } = require(
    join(snapshot, 'model', 'tuner', 'transport', 'ConnectionTargetParser.js'),
) as any;

afterEach(() => vi.restoreAllMocks());

it('uses one shared 128 KiB receive Agent for REST, feeds and TS, preserving socket reuse and independent close', async () => {
    const sockets = new Set<Socket>();
    const responses = new Map<string, ServerResponse>();
    const server = createServer((request, response) => {
        const path = request.url ?? '';
        if (path === '/base/api/never-respond') {
            responses.set(path, response);
            return;
        }
        if (path === '/base/api/redirect') {
            response.writeHead(302, { Location: '/api/services/2/stream' });
            response.end();
        } else if (path === '/base/api/status') {
            response.end('{"available":true}');
        } else if (path === '/base/api/logo') {
            response.end('logo');
        } else {
            responses.set(path, response);
            response.writeHead(200);
            response.write('ts-or-event');
        }
    });
    server.on('connection', socket => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('HTTP server address is unavailable');

    const options: RequestOptions[] = [];
    const incoming: Array<{ path: string; readable: number; socketReadable: number; socketWritable: number; socket: Socket }> = [];
    const request = (option: RequestOptions, callback: (response: IncomingMessage) => void) => {
        options.push(option);
        return nodeRequest(option, response => {
            incoming.push({
                path: option.path ?? '',
                readable: response.readableHighWaterMark,
                socketReadable: response.socket.readableHighWaterMark,
                socketWritable: response.socket.writableHighWaterMark,
                socket: response.socket,
            });
            callback(response);
        });
    };
    const transport = new TunerHttpTransport(
        parseConnectionTarget(`http://127.0.0.1:${address.port}/base`),
        'epgstation/hwm-test',
        request,
    );
    const handles: Array<{ stream: IncomingMessage; close(): void }> = [];
    const otherStreams: IncomingMessage[] = [];
    try {
        await expect(transport.getJson('/api/status')).resolves.toEqual({ available: true });
        const restSocket = incoming.at(-1)?.socket;
        expect(restSocket).toBeDefined();
        const secondTransport = new TunerHttpTransport(
            parseConnectionTarget(`http://127.0.0.1:${address.port}/base`),
            'epgstation/hwm-test',
            request,
        );
        handles.push(await secondTransport.openStream('/api/programs/1/stream', 1));
        expect(incoming.at(-1)?.socket).toBe(restSocket);
        handles.push(await transport.openStream('/api/services/1/stream', 1));
        handles.push(await transport.openStream('/api/redirect', 1));
        const tsRequests = options.filter(option => option.path !== '/base/api/status');
        expect(tsRequests.map(option => option.path)).toEqual([
            '/base/api/programs/1/stream',
            '/base/api/services/1/stream',
            '/base/api/redirect',
            '/base/api/services/2/stream',
        ]);
        const agent = tsRequests[0].agent;
        expect(agent).toEqual(expect.objectContaining({
            keepAlive: true,
            options: expect.objectContaining({ timeout: 5_000, readableHighWaterMark: 128 * 1024 }),
        }));
        expect(tsRequests.every(option => option.agent === agent)).toBe(true);
        expect(incoming.filter(sample => sample.path.includes('/stream'))).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    path: '/base/api/programs/1/stream',
                    readable: 128 * 1024,
                    socketReadable: 128 * 1024,
                    socketWritable: 64 * 1024,
                }),
                expect.objectContaining({
                    path: '/base/api/services/1/stream',
                    readable: 128 * 1024,
                    socketReadable: 128 * 1024,
                    socketWritable: 64 * 1024,
                }),
                expect.objectContaining({
                    path: '/base/api/services/2/stream',
                    readable: 128 * 1024,
                    socketReadable: 128 * 1024,
                    socketWritable: 64 * 1024,
                }),
            ]),
        );

        await expect(transport.getJson('/api/status')).resolves.toEqual({ available: true });
        await expect(transport.getBuffer('/api/logo')).resolves.toEqual(Buffer.from('logo'));
        otherStreams.push(await transport.getStream('/api/events/stream'));
        otherStreams.push(await transport.getRootStream('/events'));
        expect(options.every(option => option.agent === agent)).toBe(true);
        for (const sample of incoming.filter(sample =>
            ['/base/api/status', '/base/api/logo', '/base/api/events/stream', '/events'].includes(sample.path),
        )) {
            expect(sample.readable).toBe(128 * 1024);
            expect(sample.socketReadable).toBe(128 * 1024);
            expect(sample.socketWritable).toBe(64 * 1024);
        }

        const controller = new AbortController();
        const pending = transport.openStream('/api/stall', 1, { signal: controller.signal });
        await vi.waitFor(() => expect(responses.has('/base/api/stall')).toBe(true));
        // A response already arrived for this path; closing this handle must leave other TS streams alive.
        const stalled = await pending;
        handles.push(stalled);
        stalled.close();
        await vi.waitFor(() => expect(stalled.stream.destroyed).toBe(true));
        expect(handles[1].stream.destroyed).toBe(false);

        const abortController = new AbortController();
        const cancelled = transport.openStream('/api/never-respond', 1, { signal: abortController.signal });
        await vi.waitFor(() => expect(responses.has('/base/api/never-respond')).toBe(true));
        // Abort after the server has seen the request but before it sends response headers.
        abortController.abort();
        await expect(cancelled).rejects.toThrow('Tuner request cancelled');
        expect(handles[0].stream.destroyed).toBe(false);

        handles[0].close();
        await vi.waitFor(() => expect(handles[0].stream.destroyed).toBe(true));
        expect(handles[1].stream.destroyed).toBe(false);
        expect(handles[2].stream.destroyed).toBe(false);
        expect(options.every(option => option.agent === agent)).toBe(true);
    } finally {
        for (const handle of handles) handle.close();
        for (const stream of otherStreams) stream.destroy();
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    }
});
