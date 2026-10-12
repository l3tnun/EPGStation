import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Container } from 'inversify';
import { describe, expect, it, vi } from 'vitest';

type DeletionGateResult = { readonly token: object } | { readonly status: 'busy' | 'unknown' };

interface ServiceChildRecordedUseRegistryConstructor {
    new (): {
        acquire(input: {
            readonly kind: 'encoding' | 'delivery';
            readonly recordedId: number;
            readonly requestId: number;
            readonly senderPeer: object;
        }): { readonly status: 'granted' | 'blocked' | 'unknown' };
        release(input: {
            readonly acquisitionRequestId: number;
            readonly senderPeer: object;
        }): 'released' | 'already-released' | 'unknown';
        releaseDeletion(token: object): void;
        registerPeer(peer: object): void;
        tryAcquireDeletion(recordedId: number): DeletionGateResult;
    };
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const loadDefault = <T>(relativePath: string): T =>
    (require(join(compiledSnapshot, relativePath)) as { default: T }).default;

describe('Runtime service-child recorded-use registry', () => {
    it('[RUNTIME-T4.2] keeps peer/request leases exact and mutually exclusive with a storage-pressure deletion token', () => {
        const ServiceChildRecordedUseRegistry = loadDefault<ServiceChildRecordedUseRegistryConstructor>(
            'model/ServiceChildRecordedUseRegistry.js',
        );
        const registry = new ServiceChildRecordedUseRegistry();
        const oldPeer = new EventEmitter();
        const currentPeer = new EventEmitter();
        const replacementPeer = new EventEmitter();

        expect(registry.tryAcquireDeletion(41)).toEqual({ status: 'unknown' });
        registry.registerPeer(oldPeer);
        expect(registry.acquire({ kind: 'encoding', recordedId: 41, requestId: 1, senderPeer: oldPeer })).toEqual({
            status: 'granted',
        });
        expect(registry.acquire({ kind: 'delivery', recordedId: 41, requestId: 2, senderPeer: oldPeer })).toEqual({
            status: 'granted',
        });
        expect(registry.tryAcquireDeletion(41)).toEqual({ status: 'busy' });
        expect(registry.release({ acquisitionRequestId: 1, senderPeer: oldPeer })).toBe('released');
        expect(registry.release({ acquisitionRequestId: 1, senderPeer: oldPeer })).toBe('already-released');
        expect(registry.tryAcquireDeletion(41)).toEqual({ status: 'busy' });

        registry.registerPeer(currentPeer);
        expect(registry.acquire({ kind: 'delivery', recordedId: 41, requestId: 1, senderPeer: currentPeer })).toEqual({
            status: 'granted',
        });
        expect(registry.release({ acquisitionRequestId: 2, senderPeer: oldPeer })).toBe('released');
        expect(registry.release({ acquisitionRequestId: 1, senderPeer: oldPeer })).toBe('unknown');
        expect(registry.tryAcquireDeletion(41)).toEqual({ status: 'busy' });
        expect(registry.release({ acquisitionRequestId: 1, senderPeer: currentPeer })).toBe('released');

        const deletion = registry.tryAcquireDeletion(41);
        expect('token' in deletion).toBe(true);
        if (!('token' in deletion)) throw new Error('Expected a deletion token');
        expect(registry.acquire({ kind: 'encoding', recordedId: 41, requestId: 2, senderPeer: currentPeer })).toEqual({
            status: 'blocked',
        });
        registry.releaseDeletion(deletion.token);
        expect(registry.acquire({ kind: 'encoding', recordedId: 41, requestId: 2, senderPeer: currentPeer })).toEqual({
            status: 'granted',
        });
        const replacementDeletion = registry.tryAcquireDeletion(42);
        expect('token' in replacementDeletion).toBe(true);
        if (!('token' in replacementDeletion)) throw new Error('Expected a deletion token');
        currentPeer.emit('exit');
        expect(registry.tryAcquireDeletion(41)).toEqual({ status: 'unknown' });
        registry.registerPeer(replacementPeer);
        expect(
            registry.acquire({ kind: 'encoding', recordedId: 42, requestId: 2, senderPeer: replacementPeer }),
        ).toEqual({ status: 'blocked' });
        registry.releaseDeletion(replacementDeletion.token);
        expect(
            registry.acquire({ kind: 'encoding', recordedId: 42, requestId: 2, senderPeer: replacementPeer }),
        ).toEqual({ status: 'granted' });
        expect(registry.tryAcquireDeletion(41)).toEqual({ status: 'unknown' });
        expect(
            registry.acquire({ kind: 'delivery', recordedId: 41, requestId: 1, senderPeer: replacementPeer }),
        ).toEqual({ status: 'granted' });
        expect(registry.release({ acquisitionRequestId: 2, senderPeer: currentPeer })).toBe('released');
        expect(registry.tryAcquireDeletion(41)).toEqual({ status: 'busy' });
        expect(registry.release({ acquisitionRequestId: 1, senderPeer: replacementPeer })).toBe('released');
        expect(registry.release({ acquisitionRequestId: 2, senderPeer: replacementPeer })).toBe('released');
        const finalDeletion = registry.tryAcquireDeletion(41);
        expect('token' in finalDeletion).toBe(true);
    });

    it('[RUNTIME-T4.2] binds the singleton Runtime registry to the existing IPC registration port once', () => {
        const { set } = require(join(compiledSnapshot, 'model/ModelContainerSetter.js')) as {
            set(container: Container): void;
        };
        const IPCServer = loadDefault<any>('model/ipc/IPCServer.js');
        const registered = vi.fn();
        const register = vi.fn();
        const ipcServer = { register, recordedResourceUseRegistryRegistrationPort: { register: registered } };
        const container = new Container();
        set(container);
        container.rebind(IPCServer).toConstantValue(ipcServer);

        const runtimeIpcServer = container.get<any>('IIPCServer');
        expect(runtimeIpcServer).toBe(ipcServer);
        expect(container.get('IIPCServer')).toBe(ipcServer);
        expect(registered).toHaveBeenCalledOnce();
        const registry = registered.mock.calls[0][0] as InstanceType<ServiceChildRecordedUseRegistryConstructor>;
        expect(registry).toBeInstanceOf(
            loadDefault<ServiceChildRecordedUseRegistryConstructor>('model/ServiceChildRecordedUseRegistry.js'),
        );
        expect(registry.tryAcquireDeletion(77)).toEqual({ status: 'unknown' });
        const peer = Object.freeze({ generation: 'current' });
        runtimeIpcServer.register(peer);
        expect(register).toHaveBeenCalledExactlyOnceWith(peer);
        const deletion = registry.tryAcquireDeletion(77);
        expect('token' in deletion).toBe(true);
    });

    it('[RUNTIME-T4.2] retains only the immediate exact duplicate release during repeated child use', () => {
        const ServiceChildRecordedUseRegistry = loadDefault<ServiceChildRecordedUseRegistryConstructor>(
            'model/ServiceChildRecordedUseRegistry.js',
        );
        const registry = new ServiceChildRecordedUseRegistry();
        const peer = new EventEmitter();
        registry.registerPeer(peer);

        for (let requestId = 1; requestId <= 64; requestId += 1) {
            expect(
                registry.acquire({ kind: 'delivery', recordedId: 700 + requestId, requestId, senderPeer: peer }),
            ).toEqual({ status: 'granted' });
            expect(registry.release({ acquisitionRequestId: requestId, senderPeer: peer })).toBe('released');
        }

        expect(
            (
                registry as unknown as {
                    lastReleasedRequestIds: WeakMap<object, number>;
                }
            ).lastReleasedRequestIds.get(peer),
        ).toBe(64);
        expect(registry.release({ acquisitionRequestId: 1, senderPeer: peer })).toBe('unknown');
        expect(registry.release({ acquisitionRequestId: 64, senderPeer: peer })).toBe('already-released');
        expect(registry.acquire({ kind: 'encoding', recordedId: 900, requestId: 1, senderPeer: peer })).toEqual({
            status: 'granted',
        });
        expect(registry.release({ acquisitionRequestId: 1, senderPeer: peer })).toBe('released');
        expect(registry.release({ acquisitionRequestId: 1, senderPeer: peer })).toBe('already-released');
    });

    it('[RUNTIME-T4.2] rejects stale peers and unsupported resource kinds while preserving deletion token exactness', () => {
        const ServiceChildRecordedUseRegistry = loadDefault<ServiceChildRecordedUseRegistryConstructor>(
            'model/ServiceChildRecordedUseRegistry.js',
        );
        const registry = new ServiceChildRecordedUseRegistry();
        const oldPeer = new EventEmitter();
        const currentPeer = new EventEmitter();
        const unregisteredPeer = new EventEmitter();

        registry.registerPeer(oldPeer);
        registry.registerPeer(currentPeer);
        expect(
            registry.acquire({
                kind: 'other' as never,
                recordedId: 800,
                requestId: 1,
                senderPeer: currentPeer,
            }),
        ).toEqual({ status: 'unknown' });
        expect(registry.acquire({ kind: 'encoding', recordedId: 800, requestId: 1, senderPeer: oldPeer })).toEqual({
            status: 'unknown',
        });
        expect(
            registry.acquire({ kind: 'encoding', recordedId: 800, requestId: 1, senderPeer: unregisteredPeer }),
        ).toEqual({ status: 'unknown' });
        expect(registry.acquire({ kind: 'encoding', recordedId: 800, requestId: 1, senderPeer: currentPeer })).toEqual({
            status: 'granted',
        });
        expect(registry.acquire({ kind: 'delivery', recordedId: 801, requestId: 1, senderPeer: currentPeer })).toEqual({
            status: 'unknown',
        });
        expect(registry.release({ acquisitionRequestId: 2, senderPeer: currentPeer })).toBe('unknown');

        const firstDeletion = registry.tryAcquireDeletion(802);
        expect('token' in firstDeletion).toBe(true);
        if (!('token' in firstDeletion)) throw new Error('Expected a deletion token');
        registry.releaseDeletion({});
        expect(registry.tryAcquireDeletion(802)).toEqual({ status: 'busy' });
        registry.releaseDeletion(firstDeletion.token);
        const secondDeletion = registry.tryAcquireDeletion(802);
        expect('token' in secondDeletion).toBe(true);
        if (!('token' in secondDeletion)) throw new Error('Expected a deletion token');
        registry.releaseDeletion(firstDeletion.token);
        expect(registry.tryAcquireDeletion(802)).toEqual({ status: 'busy' });
        registry.releaseDeletion(secondDeletion.token);

        expect(registry.release({ acquisitionRequestId: 1, senderPeer: currentPeer })).toBe('released');
        expect(registry.acquire({ kind: 'delivery', recordedId: 803, requestId: 2, senderPeer: oldPeer })).toEqual({
            status: 'unknown',
        });
        oldPeer.emit('exit');
        expect(registry.acquire({ kind: 'delivery', recordedId: 803, requestId: 2, senderPeer: currentPeer })).toEqual({
            status: 'granted',
        });
    });

    it('[RUNTIME-T4.2] projects non-positive and non-safe-integer identifiers as unknown', () => {
        const ServiceChildRecordedUseRegistry = loadDefault<ServiceChildRecordedUseRegistryConstructor>(
            'model/ServiceChildRecordedUseRegistry.js',
        );
        const registry = new ServiceChildRecordedUseRegistry();
        const peer = new EventEmitter();
        registry.registerPeer(peer);

        for (const invalidRecordedId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
            expect(registry.tryAcquireDeletion(invalidRecordedId)).toEqual({ status: 'unknown' });
            expect(
                registry.acquire({
                    kind: 'encoding',
                    recordedId: invalidRecordedId,
                    requestId: 1,
                    senderPeer: peer,
                }),
            ).toEqual({ status: 'unknown' });
        }
        for (const invalidRequestId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
            expect(registry.release({ acquisitionRequestId: invalidRequestId, senderPeer: peer })).toBe('unknown');
            expect(
                registry.acquire({
                    kind: 'encoding',
                    recordedId: 800,
                    requestId: invalidRequestId,
                    senderPeer: peer,
                }),
            ).toEqual({ status: 'unknown' });
        }
    });

    it('[RUNTIME-T4.2] projects a terminal peer lease as unknown without affecting a replacement peer', () => {
        const ServiceChildRecordedUseRegistry = loadDefault<ServiceChildRecordedUseRegistryConstructor>(
            'model/ServiceChildRecordedUseRegistry.js',
        );
        const registry = new ServiceChildRecordedUseRegistry();
        const terminalPeer = new EventEmitter();
        const replacementPeer = new EventEmitter();
        const recordedId = 850;
        registry.registerPeer(terminalPeer);
        expect(registry.acquire({ kind: 'encoding', recordedId, requestId: 1, senderPeer: terminalPeer })).toEqual({
            status: 'granted',
        });

        terminalPeer.emit('exit');
        expect(registry.tryAcquireDeletion(recordedId)).toEqual({ status: 'unknown' });
        registry.registerPeer(replacementPeer);
        expect(registry.acquire({ kind: 'delivery', recordedId, requestId: 1, senderPeer: replacementPeer })).toEqual({
            status: 'granted',
        });
        expect(registry.release({ acquisitionRequestId: 1, senderPeer: terminalPeer })).toBe('released');
        expect(registry.tryAcquireDeletion(recordedId)).toEqual({ status: 'busy' });
    });

    it('[RUNTIME-T4.2] detaches every terminal listener after the first event', () => {
        const ServiceChildRecordedUseRegistry = loadDefault<ServiceChildRecordedUseRegistryConstructor>(
            'model/ServiceChildRecordedUseRegistry.js',
        );
        const terminalEvents = ['close', 'disconnect', 'error', 'exit'] as const;

        for (const [index, terminalEvent] of terminalEvents.entries()) {
            const registry = new ServiceChildRecordedUseRegistry();
            const terminalPeer = new EventEmitter();
            const recordedId = 850 + index;
            registry.registerPeer(terminalPeer);
            expect(registry.acquire({ kind: 'encoding', recordedId, requestId: 1, senderPeer: terminalPeer })).toEqual({
                status: 'granted',
            });
            for (const event of terminalEvents) expect(terminalPeer.listenerCount(event)).toBe(1);
            terminalPeer.emit(terminalEvent);
            for (const event of terminalEvents) expect(terminalPeer.listenerCount(event)).toBe(0);
            for (const laterTerminalEvent of terminalEvents) {
                if (laterTerminalEvent === terminalEvent) continue;
                if (laterTerminalEvent === 'error') terminalPeer.once('error', () => undefined);
                terminalPeer.emit(laterTerminalEvent);
            }
            for (const event of terminalEvents) expect(terminalPeer.listenerCount(event)).toBe(0);
        }
    });

    /**
     * OWNER_TEST_GAP for the following coverage IDs:
     * - statement:...ServiceChildRecordedUseRegistry.ts:38:32-38:39:966:973 (invalid peer early return)
     * - statement:...:91:49-91:56 / 91:56-91:65 / 91:65-91:66 (dual-map integrity release → unknown)
     */
    it('[RUNTIME-T4.2] rejects non-object peers without adopting current peer or lifecycle listeners', () => {
        const ServiceChildRecordedUseRegistry = loadDefault<ServiceChildRecordedUseRegistryConstructor>(
            'model/ServiceChildRecordedUseRegistry.js',
        );
        const registry = new ServiceChildRecordedUseRegistry();
        // Unknown-typed boundary: production is typed as object, but IPC/runtime can still deliver
        // non-objects; the guard must fail closed without throw.
        type RegisterPeerBoundary = { registerPeer(peer: unknown): void };
        const boundary = registry as unknown as RegisterPeerBoundary;

        expect(() => boundary.registerPeer(null)).not.toThrow();
        expect(() => boundary.registerPeer(0)).not.toThrow();
        expect(registry.tryAcquireDeletion(9101)).toEqual({ status: 'unknown' });

        const validPeer = new EventEmitter();
        // No current peer adopted from invalid inputs: acquire with a never-registered peer stays unknown.
        expect(
            registry.acquire({ kind: 'encoding', recordedId: 9101, requestId: 1, senderPeer: validPeer }),
        ).toEqual({ status: 'unknown' });
        for (const event of ['close', 'disconnect', 'error', 'exit'] as const) {
            expect(validPeer.listenerCount(event)).toBe(0);
        }

        // Normal valid-peer use still works after the invalid inputs.
        registry.registerPeer(validPeer);
        for (const event of ['close', 'disconnect', 'error', 'exit'] as const) {
            expect(validPeer.listenerCount(event)).toBe(1);
        }
        expect(
            registry.acquire({ kind: 'encoding', recordedId: 9101, requestId: 1, senderPeer: validPeer }),
        ).toEqual({ status: 'granted' });
        expect(registry.release({ acquisitionRequestId: 1, senderPeer: validPeer })).toBe('released');
    });

    it('[RUNTIME-T4.2] projects dual-map integrity failure as unknown without false release or deletion grant', () => {
        const ServiceChildRecordedUseRegistry = loadDefault<ServiceChildRecordedUseRegistryConstructor>(
            'model/ServiceChildRecordedUseRegistry.js',
        );
        const registry = new ServiceChildRecordedUseRegistry();
        const peer = new EventEmitter();
        registry.registerPeer(peer);
        expect(registry.acquire({ kind: 'encoding', recordedId: 9201, requestId: 1, senderPeer: peer })).toEqual({
            status: 'granted',
        });

        // Fixture setup only: keep the peer-side lease, replace recorded-ID Set with an empty Set so
        // the integrity guard on release fires. Do not assert private map contents as outcomes.
        (
            registry as unknown as {
                leasesByRecordedId: Map<number, Set<unknown>>;
            }
        ).leasesByRecordedId.set(9201, new Set());

        expect(registry.release({ acquisitionRequestId: 1, senderPeer: peer })).toBe('unknown');
        // Not a successful release path: never already-released from a prior successful release.
        expect(registry.release({ acquisitionRequestId: 1, senderPeer: peer })).toBe('unknown');
        // Deletion must not be falsely granted while the peer still holds the lease side-effect;
        // empty recorded Set still blocks as busy (not a deletion token).
        expect(registry.tryAcquireDeletion(9201)).toEqual({ status: 'busy' });
    });
});
