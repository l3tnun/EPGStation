import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');

const load = <T>(path: string): T => (require(join(snapshot, path)) as { default: T }).default;
const IPCClient = load<new (...args: any[]) => any>('model/ipc/IPCClient.js');
const IPCServer = load<new (...args: any[]) => any>('model/ipc/IPCServer.js');

interface Peer extends EventEmitter {
    connected: boolean;
    send(message: unknown, callback?: (error: Error | null) => void): boolean;
}

const messageError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

describe('thumbnail IPC integration', () => {
    it('[TM-7.4-IPC] serialize-add-delete-regenerate-cleanup-and-error releases the peer and pending message listeners after terminal IPC handling', async () => {
        const processSendDescriptor = Object.getOwnPropertyDescriptor(process, 'send');
        const existingListeners = new Set(process.listeners('message'));
        const peer = Object.assign(new EventEmitter(), { connected: true }) as Peer;
        const model = {
            add: vi.fn(),
            delete: vi.fn(async () => undefined),
            fileCleanup: vi.fn(async () => undefined),
            regenerate: vi.fn(async () => undefined),
        };
        const unused = {};
        const parent = new IPCServer(unused, unused, unused, unused, unused, model, undefined, undefined);
        const client = new IPCClient(
            { getLogger: () => ({ system: { error: vi.fn() } }) },
            { notifyClient: vi.fn() },
            { push: vi.fn() },
        );
        const pending = (client as { pending: Map<number, unknown> }).pending;
        const releasePending = vi.spyOn(pending, 'delete');
        const clientListeners = process.listeners('message').filter(listener => !existingListeners.has(listener));
        peer.send = (message, callback) => {
            void Promise.all(clientListeners.map(listener => listener(message))).then(
                () => callback?.(null),
                error => callback?.(messageError(error)),
            );
            return true;
        };
        const requests = vi.fn((message: unknown, callback: (error: Error | null) => void) => {
            peer.emit('message', message);
            callback(null);
            return true;
        });
        Object.defineProperty(process, 'send', { configurable: true, value: requests, writable: true });
        parent.register(peer as any);

        try {
            await client.thumbnail.regenerate();
            await client.thumbnail.fileCleanup();
            await client.thumbnail.add(51);
            await client.thumbnail.delete(61);
            expect(model.regenerate).toHaveBeenCalledOnce();
            expect(model.fileCleanup).toHaveBeenCalledOnce();
            expect(model.add).toHaveBeenCalledWith(51);
            expect(model.delete).toHaveBeenCalledWith(61);
            expect(requests).toHaveBeenCalledTimes(4);

            model.delete.mockRejectedValueOnce(new Error('synthetic IPC delete failure'));
            await expect(client.thumbnail.delete(62)).rejects.toThrow('synthetic IPC delete failure');
            expect(model.delete).toHaveBeenCalledWith(62);
            expect(releasePending).toHaveBeenCalledTimes(5);
            expect(pending.size).toBe(0);

            model.add.mockImplementationOnce(() => {
                throw new Error('ThumbnailQueueIsFull');
            });
            await expect(client.thumbnail.add(52)).rejects.toThrow('ThumbnailQueueIsFull');
            expect(model.add).toHaveBeenLastCalledWith(52);

            model.delete.mockRejectedValueOnce(new Error('ThumbnailIsNotFound'));
            await expect(client.thumbnail.delete(63)).rejects.toThrow('ThumbnailIsNotFound');
            expect(model.delete).toHaveBeenLastCalledWith(63);

            model.regenerate.mockRejectedValueOnce(new Error('synthetic regenerate failure'));
            await expect(client.thumbnail.regenerate()).rejects.toThrow('synthetic regenerate failure');
            await expect(client.thumbnail.regenerate()).resolves.toBeUndefined();
            expect(model.regenerate).toHaveBeenCalledTimes(3);

            await client.thumbnail.add(53);
            expect(model.add).toHaveBeenLastCalledWith(53);
            expect(requests).toHaveBeenCalledTimes(10);
            expect(releasePending).toHaveBeenCalledTimes(10);
            expect(pending.size).toBe(0);
        } finally {
            peer.emit('disconnect');
            expect(peer.listenerCount('message')).toBe(0);
            expect(pending.size).toBe(0);
            for (const listener of process.listeners('message')) {
                if (!existingListeners.has(listener)) process.removeListener('message', listener);
            }
            if (processSendDescriptor === undefined) delete (process as { send?: unknown }).send;
            else Object.defineProperty(process, 'send', processSendDescriptor);
            expect(new Set(process.listeners('message'))).toEqual(existingListeners);
        }
    });
});
