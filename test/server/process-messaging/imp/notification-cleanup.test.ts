import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushImmediate, makeChild, makeClient, makeServer } from '../_harness';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('notification kind recipient sync async cross product: isolated notification failure handling', () => {
    it('[IMP-NOTIFY PM-5.4] records and discards a synchronous notifyClient send failure', () => {
        const { logError, server } = makeServer();
        const child = makeChild();
        const failure = new Error('synthetic notify send failure');
        child.send.mockImplementation(() => {
            throw failure;
        });
        server.register(child);

        expect(() => server.notifyClient()).not.toThrow();
        expect(child.send).toHaveBeenCalledOnce();
        expect(logError).toHaveBeenCalledWith('IPC notification discarded: synthetic notify send failure');
    });

    it('[IMP-NOTIFY PM-5.4] records and discards a synchronous pushEncode send failure and reports it as not sent', () => {
        const { logError, server } = makeServer();
        const child = makeChild();
        const failure = new Error('synthetic push send failure');
        child.send.mockImplementation(() => {
            throw failure;
        });
        server.register(child);

        expect(server.pushEncode(31, { recordedId: 31 })).toBe(false);
        expect(child.send).toHaveBeenCalledOnce();
        expect(logError).toHaveBeenCalledExactlyOnceWith('IPC notification discarded: synthetic push send failure');
    });

    it('[IMP-NOTIFY PM-5.4] records a non-Error synchronous pushEncode send failure by its string form', () => {
        const { logError, server } = makeServer();
        const child = makeChild();
        child.send.mockImplementation(() => {
            throw 'synthetic-thrown-string';
        });
        server.register(child);

        expect(server.pushEncode(31, { recordedId: 31 })).toBe(false);
        expect(logError).toHaveBeenCalledExactlyOnceWith('IPC notification discarded: synthetic-thrown-string');
    });

    it('[IMP-NOTIFY PM-5.2] sends a store-forwarded pushEncode to the peer that is current when the store sends it', () => {
        const { domains, logError, server } = makeServer();
        const first = makeChild();
        const current = makeChild();
        server.register(first);
        server.setEncode({ recordedId: 41 });
        const sender = domains.encodeQueue.enqueueFromRecording.mock.calls[0][1];
        server.register(current);

        expect(sender(41, { recordedId: 41 })).toBe(true);
        expect(first.send).not.toHaveBeenCalled();
        expect(current.send).toHaveBeenCalledExactlyOnceWith(
            { encodeId: 41, type: 'pushEncode', value: { recordedId: 41 } },
            expect.any(Function),
        );
        expect(logError).not.toHaveBeenCalled();
    });

    it.each([
        ['notifyClient', (server: any) => server.notifyClient()],
        ['pushEncode', (server: any) => server.pushEncode(31, { recordedId: 31 })],
    ])('[IMP-NOTIFY PM-5.4] records and discards the asynchronous send callback failure for %s', (_case, invoke) => {
        const { logError, server } = makeServer();
        const child = makeChild();
        const failure = new Error('synthetic send callback failure');
        child.send.mockImplementation((_message, callback) => {
            expect(callback).toEqual(expect.any(Function));
            callback(failure);
            return true;
        });
        server.register(child);

        expect(() => invoke(server)).not.toThrow();
        expect(child.send).toHaveBeenCalledOnce();
        expect(logError).toHaveBeenCalledWith('IPC notification discarded: synthetic send callback failure');
    });

    it.each([
        ['notifyClient', (server: any) => server.notifyClient()],
        ['pushEncode', (server: any) => server.pushEncode(31, { recordedId: 31 })],
    ])('[IMP-NOTIFY PM-5.4] releases the send callback after successful completion for %s', (_case, invoke) => {
        const { logError, server } = makeServer();
        const child = makeChild();
        child.send.mockImplementation((_message, callback) => {
            expect(callback).toEqual(expect.any(Function));
            callback(null);
            return true;
        });
        server.register(child);

        expect(() => invoke(server)).not.toThrow();
        expect(child.send).toHaveBeenCalledOnce();
        expect(logError).not.toHaveBeenCalled();
    });
});

describe('IMP-NOTIFY child pushEncode intake', () => {
    it.each([
        ['missing', undefined],
        ['zero', 0],
        ['negative', -1],
        ['fractional', 1.5],
        ['unsafe', Number.MAX_SAFE_INTEGER + 1],
        ['not a number', Number.NaN],
        ['numeric string', '7'],
        ['null', null],
    ])('[IMP-NOTIFY PM-5.2] records and discards a pushEncode whose encodeId is %s', async (_case, encodeId) => {
        const harness = makeClient();
        try {
            await harness.receive({ encodeId, type: 'pushEncode', value: { recordedId: 31 } });
            await flushImmediate();

            expect(harness.encodePushPersisted).not.toHaveBeenCalled();
            expect(harness.encodePush).not.toHaveBeenCalled();
            expect(harness.logError).toHaveBeenCalledExactlyOnceWith('IPC pushEncode discarded: invalid encodeId');
            expect(harness.send).not.toHaveBeenCalled();
        } finally {
            harness.cleanup();
        }
    });

    it('[IMP-NOTIFY PM-5.2] accepts the largest safe encodeId', async () => {
        const harness = makeClient();
        try {
            await harness.receive({
                encodeId: Number.MAX_SAFE_INTEGER,
                type: 'pushEncode',
                value: { recordedId: 31 },
            });

            expect(harness.encodePushPersisted).toHaveBeenCalledExactlyOnceWith(Number.MAX_SAFE_INTEGER, {
                recordedId: 31,
            });
            expect(harness.logError).not.toHaveBeenCalled();
        } finally {
            harness.cleanup();
        }
    });

    it('[IMP-NOTIFY PM-5.2] records an asynchronous pushPersisted rejection without an unhandled rejection', async () => {
        const harness = makeClient();
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        try {
            let rejectPush!: (error: Error) => void;
            harness.encodePushPersisted.mockImplementationOnce(
                () =>
                    new Promise<void>((_resolve, reject) => {
                        rejectPush = reject;
                    }),
            );
            await harness.receive({ encodeId: 71, type: 'pushEncode', value: { recordedId: 31 } });
            expect(harness.encodePushPersisted).toHaveBeenCalledExactlyOnceWith(71, { recordedId: 31 });
            expect(harness.logError).not.toHaveBeenCalled();

            rejectPush(new Error('synthetic push persisted failure'));
            await flushImmediate();
            await flushImmediate();

            expect(harness.logError).toHaveBeenCalledExactlyOnceWith(
                'IPC pushEncode failed: synthetic push persisted failure',
            );
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.removeListener('unhandledRejection', unhandled);
            harness.cleanup();
        }
    });

    it('[IMP-NOTIFY PM-5.2] records a synchronous pushPersisted throw of a non-Error value', async () => {
        const harness = makeClient();
        try {
            harness.encodePushPersisted.mockImplementationOnce(() => {
                throw 'synthetic-thrown-string';
            });
            await harness.receive({ encodeId: 72, type: 'pushEncode', value: { recordedId: 31 } });
            await flushImmediate();

            expect(harness.encodePushPersisted).toHaveBeenCalledOnce();
            expect(harness.logError).toHaveBeenCalledExactlyOnceWith('IPC pushEncode failed: synthetic-thrown-string');
        } finally {
            harness.cleanup();
        }
    });
});
