import { once } from 'node:events';
import { createServer as createNetServer, type Server } from 'node:net';
import type { Server as HttpServer } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { close, compiled, require } from './_harness';

const ServiceServer = (require(compiled('model', 'service', 'ServiceServer.js')) as any).default;
const express = require('express') as () => any;

const occupied: Server[] = [];
const started: HttpServer[] = [];

afterEach(async () => {
    await Promise.all(started.splice(0).map(server => (server.listening ? close(server) : Promise.resolve())));
    await Promise.all(occupied.splice(0).map(server => close(server as unknown as HttpServer)));
});

const occupyPort = async (): Promise<number> => {
    const blocker = createNetServer();
    blocker.listen(0, '0.0.0.0');
    await once(blocker, 'listening');
    occupied.push(blocker);
    const address = blocker.address();
    if (address === null || typeof address === 'string') throw new Error('Synthetic blocker did not bind TCP');
    return address.port;
};

/**
 * Starts the real ServiceServer HTTP listener. `app.listen` runs the callback from the server's event
 * handlers, so a throw there surfaces as an uncaught exception; the wrapper records it for assertion.
 */
const startService = (port: number) => {
    const app = express();
    const originalListen = app.listen.bind(app);
    const thrown: unknown[] = [];
    app.listen = (listenPort: number, callback: (error?: Error) => void): HttpServer => {
        const server = originalListen(listenPort, (error?: Error) => {
            try {
                callback(error);
            } catch (caught) {
                thrown.push(caught);
            }
        }) as HttpServer;
        started.push(server);
        return server;
    };
    const log = { system: { fatal: vi.fn(), info: vi.fn() } };
    const service = Object.create(ServiceServer.prototype) as any;
    service.app = app;
    service.config = { port };
    service.log = log;
    service.socketIoManageModel = { initialize: vi.fn() };
    service.start();
    return { log, thrown };
};

describe('HTTP listener start failure [SI-8.1][LISTEN-FAILURE]', () => {
    it('[SI-8.1][LISTEN-FAILURE] reports EADDRINUSE as a start failure instead of recording listening', async () => {
        const port = await occupyPort();

        const { log, thrown } = startService(port);
        await vi.waitFor(() => expect(thrown).toHaveLength(1));

        expect(thrown[0]).toMatchObject({ code: 'EADDRINUSE' });
        expect(log.system.fatal).toHaveBeenCalledOnce();
        expect(String(log.system.fatal.mock.calls[0]?.[0])).toContain('EADDRINUSE');
        expect(log.system.info).not.toHaveBeenCalledWith(expect.stringContaining('listening'));
    });

    it('[SI-8.1][LISTEN-FAILURE] still records listening when the port is free', async () => {
        const { log, thrown } = startService(0);
        await vi.waitFor(() => expect(log.system.info).toHaveBeenCalledWith(expect.stringContaining('listening')));

        expect(thrown).toHaveLength(0);
        expect(log.system.fatal).not.toHaveBeenCalled();
    });
});
