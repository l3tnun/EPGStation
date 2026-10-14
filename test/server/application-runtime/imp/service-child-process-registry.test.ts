import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadDefault } from '../_runtime-harness';

type Identity =
    | { readonly status: 'running'; readonly startTime: string }
    | { readonly status: 'zombie' }
    | { readonly status: 'absent' }
    | { readonly status: 'unavailable' };

interface Registry {
    registerPeer(peer: object): void;
    takeEntries(peer: object): Promise<readonly Record<string, unknown>[]>;
}

type RegistryConstructor = new (
    dependencies: { identify(pid: number): Identity; logger: { error(value: unknown): void } },
    drainMilliseconds?: number,
) => Registry;

const Registry = loadDefault<RegistryConstructor>('model/ServiceChildProcessRegistry.js');

const started = (pid: number, extra: Record<string, unknown> = { kind: 'stream' }) => ({
    pid,
    type: 'serviceProcessStarted',
    ...extra,
});

afterEach(() => {
    vi.useRealTimers();
});

describe('ServiceChildProcessRegistry', () => {
    it('[AR-9.4] records the start time read at the report and skips a process that is already gone or a zombie', async () => {
        const identities = new Map<number, Identity>([
            [9201, { startTime: '77', status: 'running' }],
            [9202, { status: 'unavailable' }],
            [9203, { status: 'absent' }],
            [9204, { status: 'zombie' }],
        ]);
        const registry = new Registry({ identify: pid => identities.get(pid)!, logger: { error: vi.fn() } });
        const peer = new EventEmitter();
        registry.registerPeer(peer);

        for (const pid of [9201, 9202, 9203, 9204]) peer.emit('message', started(pid));
        peer.emit('close', 0, null);

        await expect(registry.takeEntries(peer)).resolves.toEqual([
            { kind: 'stream', pid: 9201, startTime: '77' },
            { kind: 'stream', pid: 9202, startTime: null },
        ]);
    });

    it('[AR-9.4] forgets an ended process, ignores an unknown end, and returns the entries only once', async () => {
        const registry = new Registry({
            identify: () => ({ startTime: '1', status: 'running' }),
            logger: { error: vi.fn() },
        });
        const peer = new EventEmitter();
        registry.registerPeer(peer);
        registry.registerPeer(peer);
        expect(peer.listenerCount('message')).toBe(1);

        peer.emit('message', started(9211));
        peer.emit('message', started(9212, { encodeId: 5, kind: 'encode' }));
        peer.emit('message', { pid: 9211, type: 'serviceProcessEnded' });
        peer.emit('message', { pid: 9999, type: 'serviceProcessEnded' });
        peer.emit('message', { id: 1, model: 'recorded', func: 'delete' });
        peer.emit('message', null);
        peer.emit('message', 'synthetic-text');
        peer.emit('disconnect');

        await expect(registry.takeEntries(peer)).resolves.toEqual([
            { encodeId: 5, kind: 'encode', pid: 9212, startTime: '1' },
        ]);
        await expect(registry.takeEntries(peer)).resolves.toEqual([]);
        await expect(registry.takeEntries(new EventEmitter())).resolves.toEqual([]);
        expect(peer.listenerCount('disconnect')).toBe(0);
        expect(peer.listenerCount('close')).toBe(0);
    });

    it('[AR-9.4] stops waiting for the channel to close after two seconds and stops listening', async () => {
        vi.useFakeTimers();
        const registry = new Registry({
            identify: () => ({ startTime: '1', status: 'running' }),
            logger: { error: vi.fn() },
        });
        const peer = new EventEmitter();
        registry.registerPeer(peer);
        peer.emit('message', started(9221));
        let entries: readonly Record<string, unknown>[] | undefined;
        void registry.takeEntries(peer).then(value => {
            entries = value;
        });

        await vi.advanceTimersByTimeAsync(1_999);
        expect(entries).toBeUndefined();
        await vi.advanceTimersByTimeAsync(1);

        expect(entries).toEqual([{ kind: 'stream', pid: 9221, startTime: '1' }]);
        expect(peer.listenerCount('message')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[AR-9.4] validates every field of a report by kind', async () => {
        const logger = { error: vi.fn() };
        const registry = new Registry({ identify: () => ({ startTime: '1', status: 'running' }), logger });
        const peer = new EventEmitter();
        registry.registerPeer(peer);
        const malformed = [
            started(Number.MAX_SAFE_INTEGER + 1),
            started(-3),
            started('9231' as never),
            started(9232, { kind: 'encode', encodeId: 0 }),
            started(9233, { kind: 'encode', encodeId: 1.5 }),
            started(9234, { kind: 'hls', pgid: 9234, streamId: -1 }),
            started(9235, { kind: 'hls', pgid: 0, streamId: 1 }),
            started(9236, { kind: 'hls', streamId: 1 }),
            started(9237, { kind: undefined }),
            { pid: 0, type: 'serviceProcessEnded' },
        ];
        for (const message of malformed) peer.emit('message', message);
        peer.emit('message', started(9238, { kind: 'hls', pgid: 9238, streamId: 0 }));
        peer.emit('close', 1, null);

        await expect(registry.takeEntries(peer)).resolves.toEqual([
            { kind: 'hls', pgid: 9238, pid: 9238, startTime: '1', streamId: 0 },
        ]);
        expect(logger.error).toHaveBeenCalledTimes(malformed.length);
        expect(logger.error.mock.calls[0][0]).toBe(
            `service process report discarded: ${JSON.stringify(malformed[0])}`,
        );
    });

    it('[AR-9.4] accepts only object peers that can be observed', async () => {
        const registry = new Registry({
            identify: () => ({ startTime: '1', status: 'running' }),
            logger: { error: vi.fn() },
        });

        registry.registerPeer(null as never);
        registry.registerPeer({});

        await expect(registry.takeEntries({})).resolves.toEqual([]);
    });
});
