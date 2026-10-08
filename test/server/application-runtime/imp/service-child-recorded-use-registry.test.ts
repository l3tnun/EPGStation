import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Kind = 'delivery' | 'encoding';
type Lease = { kind: Kind; recordedId: number; requestId: number; senderPeer: object };
type DeletionGate = { readonly token: object } | { readonly status: 'busy' | 'unknown' };
interface Registry {
    acquire(input: Lease): { readonly status: 'granted' | 'blocked' | 'unknown' };
    registerPeer(peer: object): void;
    release(input: { acquisitionRequestId: number; senderPeer: object }): 'released' | 'already-released' | 'unknown';
    releaseDeletion(token: object): void;
    tryAcquireDeletion(recordedId: number): DeletionGate;
}

const packageRequire = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined || !isAbsolute(compiledSnapshot)) {
    throw new Error('Server test runner did not provide an absolute compiled snapshot');
}
const ServiceChildRecordedUseRegistry = (
    packageRequire(join(compiledSnapshot, 'model/ServiceChildRecordedUseRegistry.js')) as {
        default: new () => Registry;
    }
).default;

const lease = (senderPeer: object, requestId: number, recordedId: number, kind: Kind = 'encoding'): Lease => ({
    kind,
    recordedId,
    requestId,
    senderPeer,
});

/** A peer whose removeListener can be made inert, so a terminal event can fire the same listener twice. */
class StickyPeer {
    public readonly listeners = new Map<string, Array<() => void>>();
    public removeListener: unknown = (event: string, listener: () => void): void => {
        this.listeners.set(
            event,
            (this.listeners.get(event) ?? []).filter(candidate => candidate !== listener),
        );
    };

    public once(event: string, listener: () => void): void {
        this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    }

    public fire(event: string): void {
        for (const listener of [...(this.listeners.get(event) ?? [])]) listener();
    }
}

describe('ServiceChildRecordedUseRegistry', () => {
    it('[AR-9.4] reports unknown for every request until an object peer is registered and ignores non-object peers', () => {
        const registry = new ServiceChildRecordedUseRegistry();
        const peer = new EventEmitter();

        registry.registerPeer(null as never);
        registry.registerPeer(7 as never);

        expect(registry.acquire(lease(peer, 1, 10))).toEqual({ status: 'unknown' });
        expect(registry.tryAcquireDeletion(10)).toEqual({ status: 'unknown' });
    });

    it('[AR-9.4] observes each lifecycle peer once per terminal event even when it is registered again', () => {
        const registry = new ServiceChildRecordedUseRegistry();
        const peer = new EventEmitter();

        registry.registerPeer(peer);
        registry.registerPeer(peer);

        for (const event of ['close', 'disconnect', 'error', 'exit']) expect(peer.listenerCount(event)).toBe(1);
    });

    it('[AR-9.4] accepts a peer without lifecycle methods as current without attaching listeners', () => {
        const registry = new ServiceChildRecordedUseRegistry();
        const plainPeer = {};
        const halfLifecyclePeer = { once: () => undefined };

        registry.registerPeer(plainPeer);
        expect(registry.acquire(lease(plainPeer, 1, 10))).toEqual({ status: 'granted' });

        registry.registerPeer(halfLifecyclePeer);
        expect(registry.acquire(lease(halfLifecyclePeer, 1, 11))).toEqual({ status: 'granted' });
        expect(registry.acquire(lease(plainPeer, 2, 12))).toEqual({ status: 'unknown' });
    });

    it.each([
        ['request id 0', { requestId: 0 }],
        ['negative request id', { requestId: -1 }],
        ['fractional request id', { requestId: 1.5 }],
        ['unsafe request id', { requestId: Number.MAX_SAFE_INTEGER + 1 }],
        ['NaN request id', { requestId: Number.NaN }],
        ['recorded id 0', { recordedId: 0 }],
        ['fractional recorded id', { recordedId: 2.5 }],
        ['unsupported kind', { kind: 'recording' as never }],
        ['non-object sender', { senderPeer: null as never }],
    ])('[AR-9.4] answers unknown for %s without recording a lease', (_label, override) => {
        const registry = new ServiceChildRecordedUseRegistry();
        const peer = new EventEmitter();
        registry.registerPeer(peer);

        expect(registry.acquire({ ...lease(peer, 1, 10), ...override })).toEqual({ status: 'unknown' });
        expect(registry.tryAcquireDeletion(10)).toEqual({ token: expect.any(Object) });
    });

    it('[AR-9.4] answers unknown for a sender that is not the current peer', () => {
        const registry = new ServiceChildRecordedUseRegistry();
        const oldPeer = new EventEmitter();
        const currentPeer = new EventEmitter();
        registry.registerPeer(oldPeer);
        registry.registerPeer(currentPeer);

        expect(registry.acquire(lease(oldPeer, 1, 10))).toEqual({ status: 'unknown' });
        expect(registry.acquire(lease(currentPeer, 1, 10))).toEqual({ status: 'granted' });
    });

    it('[AR-9.4] rejects a repeated request id from the same peer and keeps the first lease', () => {
        const registry = new ServiceChildRecordedUseRegistry();
        const peer = new EventEmitter();
        registry.registerPeer(peer);

        expect(registry.acquire(lease(peer, 5, 10))).toEqual({ status: 'granted' });
        expect(registry.acquire(lease(peer, 5, 11))).toEqual({ status: 'unknown' });

        expect(registry.tryAcquireDeletion(10)).toEqual({ status: 'busy' });
        expect(registry.tryAcquireDeletion(11)).toEqual({ token: expect.any(Object) });
    });

    it('[AR-9.4] shares one recorded id between several leases and frees it only after the last release', () => {
        const registry = new ServiceChildRecordedUseRegistry();
        const peer = new EventEmitter();
        registry.registerPeer(peer);
        expect(registry.acquire(lease(peer, 1, 10, 'encoding'))).toEqual({ status: 'granted' });
        expect(registry.acquire(lease(peer, 2, 10, 'delivery'))).toEqual({ status: 'granted' });

        expect(registry.release({ acquisitionRequestId: 1, senderPeer: peer })).toBe('released');
        expect(registry.tryAcquireDeletion(10)).toEqual({ status: 'busy' });
        expect(registry.release({ acquisitionRequestId: 2, senderPeer: peer })).toBe('released');
        expect(registry.tryAcquireDeletion(10)).toEqual({ token: expect.any(Object) });
    });

    it.each([
        ['non-object sender', { acquisitionRequestId: 1, senderPeer: null as never }],
        ['request id 0', { acquisitionRequestId: 0, senderPeer: new EventEmitter() }],
        ['fractional request id', { acquisitionRequestId: 1.5, senderPeer: new EventEmitter() }],
    ])('[AR-9.4] answers unknown to a release with a %s', (_label, input) => {
        const registry = new ServiceChildRecordedUseRegistry();

        expect(registry.release(input)).toBe('unknown');
    });

    it('[AR-9.4] distinguishes a repeated release from a release of a lease never granted', () => {
        const registry = new ServiceChildRecordedUseRegistry();
        const peer = new EventEmitter();
        registry.registerPeer(peer);
        registry.acquire(lease(peer, 3, 10));

        expect(registry.release({ acquisitionRequestId: 4, senderPeer: peer })).toBe('unknown');
        expect(registry.release({ acquisitionRequestId: 3, senderPeer: peer })).toBe('released');
        expect(registry.release({ acquisitionRequestId: 3, senderPeer: peer })).toBe('already-released');
        expect(registry.release({ acquisitionRequestId: 4, senderPeer: peer })).toBe('unknown');
    });

    it('[AR-9.4] forgets the last released request id once the peer acquires again', () => {
        const registry = new ServiceChildRecordedUseRegistry();
        const peer = new EventEmitter();
        registry.registerPeer(peer);
        registry.acquire(lease(peer, 3, 10));
        registry.release({ acquisitionRequestId: 3, senderPeer: peer });

        registry.acquire(lease(peer, 4, 11));

        expect(registry.release({ acquisitionRequestId: 3, senderPeer: peer })).toBe('unknown');
    });

    it('[AR-9.4] leaves the lease untouched and answers unknown when the per-recorded lease set no longer holds it', () => {
        const registry = new ServiceChildRecordedUseRegistry();
        const peer = new EventEmitter();
        registry.registerPeer(peer);
        registry.acquire(lease(peer, 1, 10));
        (registry as unknown as { leasesByRecordedId: Map<number, unknown> }).leasesByRecordedId.delete(10);

        expect(registry.release({ acquisitionRequestId: 1, senderPeer: peer })).toBe('unknown');
        expect(registry.release({ acquisitionRequestId: 1, senderPeer: peer })).toBe('unknown');
    });

    it('[AR-9.4] blocks a new lease while a deletion token is held and admits it after the token is released', () => {
        const registry = new ServiceChildRecordedUseRegistry();
        const peer = new EventEmitter();
        registry.registerPeer(peer);

        const gate = registry.tryAcquireDeletion(10);
        expect(gate).toEqual({ token: expect.any(Object) });
        const token = (gate as { token: object }).token;
        expect(Object.isFrozen(gate)).toBe(true);
        expect(registry.tryAcquireDeletion(10)).toEqual({ status: 'busy' });
        expect(registry.acquire(lease(peer, 1, 10))).toEqual({ status: 'blocked' });
        expect(registry.acquire(lease(peer, 1, 11))).toEqual({ status: 'granted' });

        registry.releaseDeletion(token);

        expect(registry.acquire(lease(peer, 2, 10))).toEqual({ status: 'granted' });
    });

    it.each([0, -3, 1.5, Number.NaN])(
        '[AR-9.4] answers unknown to a deletion request for recorded id %s',
        recordedId => {
            const registry = new ServiceChildRecordedUseRegistry();
            registry.registerPeer(new EventEmitter());

            expect(registry.tryAcquireDeletion(recordedId)).toEqual({ status: 'unknown' });
        },
    );

    it('[AR-9.4] ignores a stale or foreign deletion token and keeps the current token effective', () => {
        const registry = new ServiceChildRecordedUseRegistry();
        registry.registerPeer(new EventEmitter());
        const first = (registry.tryAcquireDeletion(10) as { token: object }).token;
        registry.releaseDeletion(first);
        const second = (registry.tryAcquireDeletion(10) as { token: object }).token;

        registry.releaseDeletion(first);
        registry.releaseDeletion({});

        expect(registry.tryAcquireDeletion(10)).toEqual({ status: 'busy' });
        registry.releaseDeletion(second);
        expect(registry.tryAcquireDeletion(10)).toEqual({ token: expect.any(Object) });
    });

    it('[AR-9.4] stops answering for the current peer after any terminal event and removes every terminal listener', () => {
        for (const event of ['close', 'disconnect', 'error', 'exit']) {
            const registry = new ServiceChildRecordedUseRegistry();
            const peer = new EventEmitter();
            registry.registerPeer(peer);
            registry.acquire(lease(peer, 1, 10));

            peer.emit(event, event === 'error' ? new Error('synthetic') : undefined);

            for (const name of ['close', 'disconnect', 'error', 'exit']) expect(peer.listenerCount(name)).toBe(0);
            expect(registry.acquire(lease(peer, 2, 11))).toEqual({ status: 'unknown' });
            expect(registry.tryAcquireDeletion(11)).toEqual({ status: 'unknown' });
        }
    });

    it('[AR-9.4] keeps the replacement peer current when an earlier peer terminates and treats its leases as unknown until released', () => {
        const registry = new ServiceChildRecordedUseRegistry();
        const oldPeer = new EventEmitter();
        const newPeer = new EventEmitter();
        registry.registerPeer(oldPeer);
        registry.acquire(lease(oldPeer, 1, 10));
        registry.registerPeer(newPeer);

        oldPeer.emit('exit');

        expect(registry.acquire(lease(newPeer, 1, 20))).toEqual({ status: 'granted' });
        expect(registry.tryAcquireDeletion(10)).toEqual({ status: 'unknown' });
        expect(registry.tryAcquireDeletion(20)).toEqual({ status: 'busy' });
        expect(registry.release({ acquisitionRequestId: 1, senderPeer: oldPeer })).toBe('released');
        expect(registry.tryAcquireDeletion(10)).toEqual({ token: expect.any(Object) });
    });

    it('[AR-9.4] handles a terminal event for a peer that has no leases', () => {
        const registry = new ServiceChildRecordedUseRegistry();
        const peer = new EventEmitter();
        registry.registerPeer(peer);

        peer.emit('close');

        expect(registry.tryAcquireDeletion(10)).toEqual({ status: 'unknown' });
    });

    it('[AR-9.4] runs the terminal cleanup once when an inert removeListener lets a second terminal event arrive', () => {
        const registry = new ServiceChildRecordedUseRegistry();
        const peer = new StickyPeer();
        const removals: string[] = [];
        peer.removeListener = (event: string): void => {
            removals.push(event);
        };
        registry.registerPeer(peer);
        registry.acquire(lease(peer, 1, 10));

        peer.fire('close');
        expect(registry.tryAcquireDeletion(10)).toEqual({ status: 'unknown' });
        expect(removals).toEqual(['close', 'disconnect', 'error', 'exit']);
        peer.fire('exit');

        expect(removals).toEqual(['close', 'disconnect', 'error', 'exit']);
        expect(registry.acquire(lease(peer, 2, 11))).toEqual({ status: 'unknown' });
    });

    it('[AR-9.4] skips listener removal when the peer lost its lifecycle methods before terminating', () => {
        const registry = new ServiceChildRecordedUseRegistry();
        const peer = new StickyPeer();
        registry.registerPeer(peer);
        registry.acquire(lease(peer, 1, 10));
        peer.removeListener = undefined;

        peer.fire('disconnect');

        expect(registry.acquire(lease(peer, 2, 11))).toEqual({ status: 'unknown' });
    });
});
