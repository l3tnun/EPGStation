import { describe, expect, it, vi } from 'vitest';

import { compiled, require } from './_harness';

const ServiceServer = (require(compiled('model', 'service', 'ServiceServer.js')) as any).default;

/**
 * `app.listen` の callback が受け取る error（Express 5 は listen の失敗もここへ渡す）の分岐を、実際の port を使わず
 * 偽の app で確かめる。実際の EADDRINUSE は listen-failure.integration.test.ts が確かめる。
 */
const startWithListenCallback = (invoke: (callback: (error?: Error) => void) => void) => {
    const log = { system: { fatal: vi.fn(), info: vi.fn() } };
    const service = Object.create(ServiceServer.prototype) as any;
    service.app = {
        listen: (_port: number, callback: (error?: Error) => void) => {
            invoke(callback);
            return {};
        },
    };
    service.config = { port: 8888 };
    service.log = log;
    service.socketIoManageModel = { initialize: vi.fn() };
    service.start();
    return log;
};

describe('HTTP listener listen callback (unittest/imp)', () => {
    it('[SI-8.1][LISTEN-FAILURE] records the cause with the port as fatal, rethrows the same error and never records listening', () => {
        const failure = new Error('listen EADDRINUSE: address already in use :::8888');
        const log = { system: { fatal: vi.fn(), info: vi.fn() } };
        const service = Object.create(ServiceServer.prototype) as any;
        service.app = {
            listen: (_port: number, callback: (error?: Error) => void) => {
                expect(() => callback(failure)).toThrow(failure);
                return {};
            },
        };
        service.config = { port: 8888 };
        service.log = log;
        service.socketIoManageModel = { initialize: vi.fn() };

        service.start();

        expect(log.system.fatal).toHaveBeenCalledExactlyOnceWith(`http server listen error on 8888: ${failure.message}`);
        expect(log.system.info).not.toHaveBeenCalled();
    });

    it('[SI-8.1][LISTEN-FAILURE] records listening when the callback receives no error', () => {
        const log = startWithListenCallback(callback => callback());

        expect(log.system.info).toHaveBeenCalledExactlyOnceWith('http server listening on 8888');
        expect(log.system.fatal).not.toHaveBeenCalled();
    });
});
