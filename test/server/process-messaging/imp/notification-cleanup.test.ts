import { describe, expect, it } from 'vitest';
import { makeChild, makeServer } from '../_harness';

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

    it('[IMP-NOTIFY PM-5.4] preserves a synchronous pushEncode send failure for the caller', () => {
        const { server } = makeServer();
        const child = makeChild();
        const failure = new Error('synthetic push send failure');
        child.send.mockImplementation(() => {
            throw failure;
        });
        server.register(child);

        expect(() => server.setEncode({ recordedId: 31 })).toThrow(failure);
        expect(child.send).toHaveBeenCalledOnce();
    });

    it.each([
        ['notifyClient', (server: any) => server.notifyClient()],
        ['pushEncode', (server: any) => server.setEncode({ recordedId: 31 })],
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
        ['pushEncode', (server: any) => server.setEncode({ recordedId: 31 })],
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
