import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { compiled, require } from './_harness';

const SocketIOManageModel = (require(compiled('model', 'service', 'socketio', 'SocketIOManageModel.js')) as any)
    .default;

const servers: http.Server[] = [];
const models: any[] = [];

afterEach(async () => {
    for (const model of models.splice(0)) {
        for (const io of model.ios) await io.close();
    }
    for (const server of servers.splice(0)) {
        if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    }
});

const startServer = async (config: Record<string, unknown>): Promise<number> => {
    const server = http.createServer((_request, response) => {
        response.statusCode = 404;
        response.end();
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const model = new SocketIOManageModel(
        { getLogger: () => ({ system: { info: vi.fn(), error: vi.fn() } }) },
        { getConfig: () => config },
    );
    models.push(model);
    model.initialize([server]);
    return (server.address() as AddressInfo).port;
};

const status = (port: number, path: string): Promise<number> =>
    new Promise((resolve, reject) => {
        const request = http.get({ host: '127.0.0.1', port, path, agent: false }, response => {
            response.resume();
            response.once('end', () => resolve(response.statusCode ?? 0));
        });
        request.once('error', reject);
    });

describe('Socket.IO endpoint path', () => {
    it('[SI-6.1] serves the Socket.IO handshake at /socket.io when no sub directory is configured', async () => {
        const port = await startServer({});

        await expect(status(port, '/socket.io/?EIO=4&transport=polling')).resolves.toBe(200);
        await expect(status(port, '/sub/socket.io/?EIO=4&transport=polling')).resolves.not.toBe(200);
    });

    it('[SI-6.1] serves the Socket.IO handshake under the configured sub directory only', async () => {
        const port = await startServer({ subDirectory: '/sub' });

        await expect(status(port, '/sub/socket.io/?EIO=4&transport=polling')).resolves.toBe(200);
        await expect(status(port, '/socket.io/?EIO=4&transport=polling')).resolves.not.toBe(200);
    });
});
