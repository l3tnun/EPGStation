import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOperator, type TestLogger } from './harness';
import { listenOnUnixSocket } from './unix-socket-listener';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
    while (cleanups.length > 0) {
        await cleanups.pop()?.();
    }
});

const createLogger = (): TestLogger => ({ system: { error: vi.fn(), info: vi.fn() } });

const listen = async () => {
    const listener = await listenOnUnixSocket();
    cleanups.push(() => listener.close());
    return listener;
};

describe('DBOperator MySQL UNIX socket connection integration', () => {
    it('[PERSIST-1.1-MYSQL-SOCKET-PATH-CONNECT] reaches the configured UNIX socket instead of the unresolvable host', async () => {
        const listener = await listen();
        const operator = createOperator(
            {
                dbtype: 'mysql',
                mysql: {
                    database: 'synthetic_database',
                    host: 'synthetic-db.invalid',
                    password: '<synthetic-password>',
                    port: 3307,
                    socketPath: listener.socketPath,
                    user: 'synthetic_user',
                },
            },
            createLogger(),
        );

        const failure = await operator.getConnection().then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(failure).toBeInstanceOf(Error);
        expect(listener.accepted()).toBeGreaterThanOrEqual(1);
        expect((failure as { code?: string }).code).not.toBe('ENOTFOUND');
    });

    it('[PERSIST-1.1-MYSQL-HOST-CONNECT] still resolves the configured host when no socket path is configured', async () => {
        const listener = await listen();
        const operator = createOperator(
            {
                dbtype: 'mysql',
                mysql: {
                    database: 'synthetic_database',
                    host: 'synthetic-db.invalid',
                    password: '<synthetic-password>',
                    port: 3307,
                    user: 'synthetic_user',
                },
            },
            createLogger(),
        );

        const failure = await operator.getConnection().then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(failure).toBeInstanceOf(Error);
        expect(listener.accepted()).toBe(0);
    });
});
