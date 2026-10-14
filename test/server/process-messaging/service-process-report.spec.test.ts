import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushImmediate, flushNextTick, makeChild, makeClient, makeServer, type ClientHarness } from './_harness';

/**
 * Web・API 側処理が開始した外部プロセスの開始と終了の知らせ（Requirement 1.10、3.4、6.7）。知らせは応答を待たない
 * 一方向の message で、管理側では IPCServer が応答せず、管理側の記録（ServiceChildProcessRegistry）が受け取る。
 */

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;

type Identity = { readonly status: 'running'; readonly startTime: string };

interface Registry {
    registerPeer(peer: object): void;
    takeEntries(peer: object): Promise<readonly Record<string, unknown>[]>;
}

const Registry = (
    require(join(snapshot, 'model', 'ServiceChildProcessRegistry.js')) as {
        default: new (dependencies: {
            identify(pid: number): Identity;
            logger: { error(value: unknown): void };
        }) => Registry;
    }
).default;

const clients: ClientHarness[] = [];

afterEach(() => {
    for (const client of clients.splice(0)) client.cleanup();
    vi.useRealTimers();
});

const openClient = (): ClientHarness => {
    const client = makeClient();
    clients.push(client);
    return client;
};

describe('service process report messaging', () => {
    it('[PM-1.10] sends the start and end of an external process to the management side without waiting for a reply', async () => {
        const harness = openClient();

        harness.client.serviceProcessReporter.started({ kind: 'hls', pgid: 9101, pid: 9101, streamId: 4 });
        harness.client.serviceProcessReporter.started({ encodeId: 12, kind: 'encode', pid: 9102 });
        harness.client.serviceProcessReporter.ended(9102);
        await flushNextTick();

        expect(harness.send.mock.calls.map(([message]) => message)).toEqual([
            { kind: 'hls', pgid: 9101, pid: 9101, streamId: 4, type: 'serviceProcessStarted' },
            { encodeId: 12, kind: 'encode', pid: 9102, type: 'serviceProcessStarted' },
            { pid: 9102, type: 'serviceProcessEnded' },
        ]);
        for (const [, callback] of harness.send.mock.calls) expect(callback).toBeTypeOf('function');
        expect(harness.logError).not.toHaveBeenCalled();
    });

    it('[PM-1.10] records and discards a report that cannot be sent, without storing or resending it', async () => {
        const harness = openClient();
        harness.send.mockImplementationOnce(() => {
            throw new Error('synthetic channel closed');
        });

        expect(() => harness.client.serviceProcessReporter.ended(9103)).not.toThrow();
        harness.client.serviceProcessReporter.ended(9104);
        await flushNextTick();

        expect(harness.logError).toHaveBeenCalledWith('process.send error: synthetic channel closed');
        expect(harness.send).toHaveBeenCalledTimes(2);
        expect(harness.send.mock.calls[1][0]).toEqual({ pid: 9104, type: 'serviceProcessEnded' });
    });

    it('[PM-3.4] answers neither a reply nor an operation error to a report, valid or malformed', async () => {
        const { domains, server } = makeServer();
        const child = makeChild();
        server.register(child);

        child.emit('message', { kind: 'stream', pid: 9105, type: 'serviceProcessStarted' });
        child.emit('message', { pid: 9105, type: 'serviceProcessEnded' });
        child.emit('message', { kind: 'unknown', pid: -1, type: 'serviceProcessStarted' });
        await flushImmediate();

        expect(child.send).not.toHaveBeenCalled();
        for (const domain of Object.values(domains)) {
            for (const handler of Object.values(domain)) expect(handler).not.toHaveBeenCalled();
        }
    });

    it('[PM-3.4] records and discards a malformed report on the management side', async () => {
        const logger = { error: vi.fn() };
        const registry = new Registry({ identify: () => ({ startTime: '1', status: 'running' }), logger });
        const peer = new EventEmitter();
        registry.registerPeer(peer);

        peer.emit('message', { kind: 'encode', pid: 9106, type: 'serviceProcessStarted' });
        peer.emit('message', { kind: 'hls', pid: 9107, streamId: 1, type: 'serviceProcessStarted' });
        peer.emit('message', { kind: 'stream', pid: 0, type: 'serviceProcessStarted' });
        peer.emit('message', { kind: 'video', pid: 9108, type: 'serviceProcessStarted' });
        peer.emit('message', { pid: 1.5, type: 'serviceProcessEnded' });
        peer.emit('disconnect');

        await expect(registry.takeEntries(peer)).resolves.toEqual([]);
        expect(logger.error).toHaveBeenCalledTimes(5);
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('service process report discarded'),
        );
    });

    it('[PM-6.7] keeps receiving reports sent before the channel closes, including those that arrive after exit', async () => {
        const logger = { error: vi.fn() };
        const registry = new Registry({ identify: pid => ({ startTime: `start-${pid}`, status: 'running' }), logger });
        const peer = new EventEmitter();
        registry.registerPeer(peer);

        peer.emit('message', { encodeId: 3, kind: 'encode', pid: 9110, type: 'serviceProcessStarted' });
        peer.emit('exit', null, 'SIGKILL');
        peer.emit('message', { kind: 'hls', pgid: 9111, pid: 9111, streamId: 2, type: 'serviceProcessStarted' });
        const taken = registry.takeEntries(peer);
        peer.emit('message', { kind: 'stream', pid: 9112, type: 'serviceProcessStarted' });
        peer.emit('message', { pid: 9112, type: 'serviceProcessEnded' });
        peer.emit('disconnect');
        peer.emit('message', { kind: 'stream', pid: 9113, type: 'serviceProcessStarted' });

        await expect(taken).resolves.toEqual([
            { encodeId: 3, kind: 'encode', pid: 9110, startTime: 'start-9110' },
            { kind: 'hls', pgid: 9111, pid: 9111, startTime: 'start-9111', streamId: 2 },
        ]);
        expect(peer.listenerCount('message')).toBe(0);
        expect(logger.error).not.toHaveBeenCalled();
    });
});
