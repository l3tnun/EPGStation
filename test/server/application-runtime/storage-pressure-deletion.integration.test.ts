import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Container } from 'inversify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type IStorageDeletionCandidatePort from '../../../src/model/operator/storage/IStorageDeletionCandidatePort';

type Snapshot =
    | { readonly status: 'known'; readonly recordedIds: ReadonlySet<number> }
    | { readonly status: 'unknown' };
type ChildSnapshot =
    | { readonly status: 'known'; readonly recordedIds: readonly number[] }
    | { readonly status: 'unknown' };
type Gate = {
    tryAcquireDeletion(recordedId: number): { readonly token: object } | { readonly status: 'busy' | 'unknown' };
    releaseDeletion(token: object): void;
};
type Preparation = { readonly status: 'prepared'; readonly token: object } | { readonly status: 'not-deleted' };

interface SnapshotAdapterConstructor {
    new (
        recording: { getActiveRecordedIds(): Snapshot } | null,
        serviceChild: { requestSnapshot(): Promise<ChildSnapshot> } | null,
    ): { getSnapshot(): Promise<Snapshot> };
}

interface DeletionAdapterConstructor {
    new (
        recorded: {
            prepareStorageDeletion(recordedId: number, storageName: string): Promise<Preparation>;
            deletePreparedForStorage(token: object): Promise<'deleted' | 'not-deleted'>;
        },
        recordingGate: Gate,
        serviceGate: Gate,
    ): { deleteForStoragePressure(recordedId: number, storageName: string): Promise<'deleted' | 'not-deleted'> };
}

interface StorageManagerConstructor {
    new (...arguments_: any[]): {
        check(entries: readonly unknown[]): Promise<void>;
        getFreeSize(path: string): Promise<number>;
    };
}

interface ServiceChildRegistryConstructor {
    new (): Gate & {
        acquire(input: {
            readonly kind: 'encoding' | 'delivery';
            readonly recordedId: number;
            readonly requestId: number;
            readonly senderPeer: object;
        }): { readonly status: 'granted' | 'blocked' | 'unknown' };
        registerPeer(peer: object): void;
        release(input: { readonly acquisitionRequestId: number; readonly senderPeer: object }): string;
    };
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const loadDefault = <T>(relativePath: string): T =>
    (require(join(compiledSnapshot, relativePath)) as { default: T }).default;

const known = (...recordedIds: number[]): Snapshot => ({ status: 'known', recordedIds: new Set(recordedIds) });

const tokenGate = (ledger: string[], name: string): Gate => {
    const gateToken = {};
    return {
        releaseDeletion: value => {
            expect(value).toBe(gateToken);
            ledger.push(`${name}:release`);
        },
        tryAcquireDeletion: recordedId => {
            ledger.push(`${name}:acquire:${recordedId}`);
            return { token: gateToken };
        },
    };
};

afterEach(() => {
    vi.useRealTimers();
});

describe('storage pressure deletion Runtime composition', () => {
    it('[AR-4.2] exclusive-prepare-and-final-delete reads each known snapshot once, exposes only their union to the Storage contract, and releases gates in reverse order', async () => {
        const SnapshotAdapter = loadDefault<SnapshotAdapterConstructor>(
            'model/operator/storage/StorageRecordedUseSnapshotAdapter.js',
        );
        const DeletionAdapter = loadDefault<DeletionAdapterConstructor>(
            'model/operator/storage/StoragePressureDeletionAdapter.js',
        );
        const ledger: string[] = [];
        const firstPreparationToken = { preparation: 41 };
        const recording = {
            getActiveRecordedIds: vi.fn(() => {
                ledger.push('recording:snapshot');
                return known(7, 11);
            }),
        };
        const child = {
            requestSnapshot: vi.fn(async (): Promise<ChildSnapshot> => {
                ledger.push('service:snapshot');
                return { status: 'known', recordedIds: [11, 13] };
            }),
        };
        const recorded = {
            deletePreparedForStorage: vi.fn(async token => {
                expect(token).toBe(firstPreparationToken);
                ledger.push('final-delete');
                return 'deleted' as const;
            }),
            prepareStorageDeletion: vi.fn(async (recordedId, storageName): Promise<Preparation> => {
                ledger.push(`prepare:${recordedId}:${storageName}`);
                return { status: 'prepared', token: firstPreparationToken };
            }),
        };
        const snapshot = new SnapshotAdapter(recording, child);
        const deletion = new DeletionAdapter(recorded, tokenGate(ledger, 'recording'), tokenGate(ledger, 'service'));
        const observedSnapshot = await snapshot.getSnapshot();
        expect(observedSnapshot.status).toBe('known');
        if (observedSnapshot.status !== 'known') throw new Error('Expected a known Runtime snapshot');
        ledger.push(`candidate-filter:${[...observedSnapshot.recordedIds].join(',')}:archive`);
        await expect(deletion.deleteForStoragePressure(41, 'archive')).resolves.toBe('deleted');

        expect(recording.getActiveRecordedIds).toHaveBeenCalledOnce();
        expect(child.requestSnapshot).toHaveBeenCalledOnce();
        expect(ledger).toEqual([
            'recording:snapshot',
            'service:snapshot',
            'candidate-filter:7,11,13:archive',
            'prepare:41:archive',
            'recording:acquire:41',
            'service:acquire:41',
            'final-delete',
            'service:release',
            'recording:release',
        ]);
    });

    it.each([
        ['deleted', 2],
        ['not-deleted', 1],
        ['rejection', 1],
    ] as const)(
        '[STORAGE-T7.8][AR-4.2][SM-6.4] forwards the candidate ID and storage name to the Runtime adapter and re-reads only after %s',
        async (outcome, expectedReadCount) => {
            const DeletionAdapter = loadDefault<DeletionAdapterConstructor>(
                'model/operator/storage/StoragePressureDeletionAdapter.js',
            );
            const StorageManager = loadDefault<StorageManagerConstructor>(
                'model/operator/storage/StorageManageModel.js',
            );
            const entry = {
                action: 'remove' as const,
                limitThreshold: 1,
                name: 'archive',
                path: 'synthetic-storage/archive',
            };
            const finalRejection = new Error('synthetic final deletion rejection');
            const preparationToken = { preparation: 41 };
            const findOldestUnused = vi.fn(
                async (...[request]: Parameters<IStorageDeletionCandidatePort['findOldestUnused']>) => {
                    expect(request).toEqual({ excludedRecordedIds: new Set(), storageName: entry.name });
                    return 41;
                },
            );
            const prepareStorageDeletion = vi.fn(
                async (recordedId: number, storageName: string): Promise<Preparation> => {
                    if (outcome === 'not-deleted') return { status: 'not-deleted' };
                    expect({ recordedId, storageName }).toEqual({ recordedId: 41, storageName: entry.name });
                    return { status: 'prepared', token: preparationToken };
                },
            );
            const deletePreparedForStorage = vi.fn(async (preparedToken: object): Promise<'deleted'> => {
                expect(preparedToken).toBe(preparationToken);
                if (outcome === 'rejection') throw finalRejection;
                return 'deleted';
            });
            const deletion = new DeletionAdapter(
                { deletePreparedForStorage, prepareStorageDeletion },
                tokenGate([], 'recording'),
                tokenGate([], 'service'),
            );
            const logger = { system: { error: vi.fn(), info: vi.fn() } };
            const manager = new StorageManager(
                { getLogger: () => logger },
                { getConfig: () => ({ recorded: [entry], storageLimitCheckIntervalTime: 1 }) },
                { findOldestUnused },
                deletion,
                { getSnapshot: async () => known() },
            );
            const freeSize = vi
                .fn<(path: string) => Promise<number>>()
                .mockResolvedValueOnce(1024 * 1024)
                .mockResolvedValueOnce(2 * 1024 * 1024);
            manager.getFreeSize = freeSize;

            await manager.check([entry]);

            expect(findOldestUnused).toHaveBeenCalledOnce();
            expect(prepareStorageDeletion).toHaveBeenCalledWith(41, entry.name);
            expect(deletePreparedForStorage).toHaveBeenCalledTimes(outcome === 'not-deleted' ? 0 : 1);
            expect(freeSize.mock.calls.map(([path]) => path)).toEqual(
                Array.from({ length: expectedReadCount }, () => entry.path),
            );
            if (outcome === 'rejection') expect(logger.system.error).toHaveBeenCalledWith(finalRejection);
        },
    );

    it('[AR-4.2] binds each Runtime adapter to the existing provider ports once without binding a Storage consumer', async () => {
        const { set } = require(join(compiledSnapshot, 'model/ModelContainerSetter.js')) as {
            set(container: Container): void;
        };
        const IPCServer = loadDefault<any>('model/ipc/IPCServer.js');
        const SnapshotAdapter = loadDefault<any>('model/operator/storage/StorageRecordedUseSnapshotAdapter.js');
        const DeletionAdapter = loadDefault<any>('model/operator/storage/StoragePressureDeletionAdapter.js');
        const childSnapshot = vi.fn(async (): Promise<ChildSnapshot> => ({ status: 'known', recordedIds: [91] }));
        const container = new Container();
        set(container);
        container.rebind(IPCServer).toConstantValue({ recordedUseSnapshotClient: { requestSnapshot: childSnapshot } });
        container.rebind('IRecordedManageModel').toConstantValue({
            deletePreparedForStorage: vi.fn(async (): Promise<'deleted'> => 'deleted'),
            prepareStorageDeletion: vi.fn(async (): Promise<Preparation> => ({ status: 'prepared', token: {} })),
        });

        const snapshot = container.get<any>('IStorageRecordedUseSnapshotPort');
        const deletion = container.get<any>('IRecordedStorageDeletionPort');

        expect(snapshot).toBeInstanceOf(SnapshotAdapter);
        expect(deletion).toBeInstanceOf(DeletionAdapter);
        await expect(snapshot.getSnapshot()).resolves.toEqual({ status: 'known', recordedIds: new Set([91]) });
        expect(childSnapshot).toHaveBeenCalledOnce();
    });

    it.each([
        [
            'recording provider absent',
            null,
            { requestSnapshot: vi.fn(async (): Promise<ChildSnapshot> => ({ status: 'known', recordedIds: [7] })) },
        ],
        ['service provider absent', { getActiveRecordedIds: () => known(7) }, null],
        [
            'recording unknown',
            { getActiveRecordedIds: () => ({ status: 'unknown' as const }) },
            { requestSnapshot: vi.fn(async (): Promise<ChildSnapshot> => ({ status: 'known', recordedIds: [7] })) },
        ],
        [
            'service unknown generation mismatch',
            { getActiveRecordedIds: () => known(7) },
            { requestSnapshot: vi.fn(async (): Promise<ChildSnapshot> => ({ status: 'unknown' })) },
        ],
        [
            'service rejection',
            { getActiveRecordedIds: () => known(7) },
            {
                requestSnapshot: vi.fn(
                    async (): Promise<ChildSnapshot> => Promise.reject(new Error('synthetic snapshot rejection')),
                ),
            },
        ],
        [
            'invalid child ID',
            { getActiveRecordedIds: () => known(7) },
            { requestSnapshot: vi.fn(async (): Promise<ChildSnapshot> => ({ status: 'known', recordedIds: [0] })) },
        ],
        [
            'invalid recording ID',
            { getActiveRecordedIds: () => ({ status: 'known' as const, recordedIds: new Set([1.5]) }) },
            { requestSnapshot: vi.fn(async (): Promise<ChildSnapshot> => ({ status: 'known', recordedIds: [7] })) },
        ],
    ] as const)(
        '[AR-4.2] fails closed for %s without producing a candidate-filter snapshot',
        async (_label, recording, child) => {
            const SnapshotAdapter = loadDefault<SnapshotAdapterConstructor>(
                'model/operator/storage/StorageRecordedUseSnapshotAdapter.js',
            );
            const snapshot = new SnapshotAdapter(recording, child);

            await expect(snapshot.getSnapshot()).resolves.toEqual({ status: 'unknown' });
        },
    );

    it('[AR-4.2] maps the normal five-second timeout and its late reply to unknown without reusing it', async () => {
        vi.useFakeTimers();
        const SnapshotAdapter = loadDefault<SnapshotAdapterConstructor>(
            'model/operator/storage/StorageRecordedUseSnapshotAdapter.js',
        );
        let resolveFirst!: (value: ChildSnapshot) => void;
        const first = new Promise<ChildSnapshot>(resolve => {
            resolveFirst = resolve;
        });
        const child = {
            requestSnapshot: vi
                .fn<() => Promise<ChildSnapshot>>()
                .mockReturnValueOnce(first)
                .mockResolvedValueOnce({ status: 'unknown' }),
        };
        const snapshot = new SnapshotAdapter({ getActiveRecordedIds: () => known(7) }, child);

        const firstSnapshot = snapshot.getSnapshot();
        await vi.advanceTimersByTimeAsync(5_000);
        await expect(firstSnapshot).resolves.toEqual({ status: 'unknown' });
        resolveFirst({ status: 'known', recordedIds: [8] });
        await Promise.resolve();

        await expect(snapshot.getSnapshot()).resolves.toEqual({ status: 'unknown' });
        expect(child.requestSnapshot).toHaveBeenCalledTimes(2);
    });

    it.each([
        [
            'prepare refusal',
            { status: 'not-deleted' } as const,
            { status: 'busy' } as const,
            { status: 'busy' } as const,
            'not-deleted' as const,
        ],
        [
            'recording busy',
            { status: 'prepared', token: {} } as const,
            { status: 'busy' } as const,
            undefined,
            'not-deleted' as const,
        ],
        [
            'recording unknown',
            { status: 'prepared', token: {} } as const,
            { status: 'unknown' } as const,
            undefined,
            'not-deleted' as const,
        ],
        [
            'service busy',
            { status: 'prepared', token: {} } as const,
            'token' as const,
            { status: 'busy' } as const,
            'not-deleted' as const,
        ],
        [
            'service unknown',
            { status: 'prepared', token: {} } as const,
            'token' as const,
            { status: 'unknown' } as const,
            'not-deleted' as const,
        ],
    ])(
        '[AR-4.2] projects %s to not-deleted without a final delete',
        async (_label, preparation, recordingResult, serviceResult, outcome) => {
            const DeletionAdapter = loadDefault<DeletionAdapterConstructor>(
                'model/operator/storage/StoragePressureDeletionAdapter.js',
            );
            const ledger: string[] = [];
            const recordingToken = Object.freeze({ recording: true });
            const serviceToken = Object.freeze({ service: true });
            const recordingGate: Gate = {
                releaseDeletion: token => {
                    expect(token).toBe(recordingToken);
                    ledger.push('recording:release');
                },
                tryAcquireDeletion: () => {
                    ledger.push('recording:acquire');
                    return recordingResult === 'token' ? { token: recordingToken } : recordingResult;
                },
            };
            const serviceGate: Gate = {
                releaseDeletion: token => {
                    expect(token).toBe(serviceToken);
                    ledger.push('service:release');
                },
                tryAcquireDeletion: () => {
                    ledger.push('service:acquire');
                    return serviceResult === 'token' ? { token: serviceToken } : serviceResult ?? { status: 'unknown' };
                },
            };
            const recorded = {
                deletePreparedForStorage: vi.fn(async (): Promise<'deleted'> => 'deleted'),
                prepareStorageDeletion: vi.fn(async (): Promise<Preparation> => preparation),
            };
            const adapter = new DeletionAdapter(recorded, recordingGate, serviceGate);

            await expect(adapter.deleteForStoragePressure(41, 'archive')).resolves.toBe(outcome);
            expect(recorded.deletePreparedForStorage).not.toHaveBeenCalled();
            if (recordingResult === 'token' && serviceResult !== undefined) {
                expect(ledger).toEqual(['recording:acquire', 'service:acquire', 'recording:release']);
            } else if (preparation.status === 'prepared') {
                expect(ledger).toEqual(['recording:acquire']);
            } else {
                expect(ledger).toEqual([]);
            }
        },
    );

    it.each(['deleted', 'not-deleted'] as const)(
        '[AR-4.2] releases both gates once in reverse order after final %s',
        async outcome => {
            const DeletionAdapter = loadDefault<DeletionAdapterConstructor>(
                'model/operator/storage/StoragePressureDeletionAdapter.js',
            );
            const ledger: string[] = [];
            const adapter = new DeletionAdapter(
                {
                    deletePreparedForStorage: vi.fn(async (): Promise<'deleted' | 'not-deleted'> => {
                        ledger.push('final-delete');
                        return outcome;
                    }),
                    prepareStorageDeletion: vi.fn(
                        async (): Promise<Preparation> => ({ status: 'prepared', token: {} }),
                    ),
                },
                tokenGate(ledger, 'recording'),
                tokenGate(ledger, 'service'),
            );

            await expect(adapter.deleteForStoragePressure(41, 'archive')).resolves.toBe(outcome);
            expect(ledger).toEqual([
                'recording:acquire:41',
                'service:acquire:41',
                'final-delete',
                'service:release',
                'recording:release',
            ]);
        },
    );

    it('[AR-4.2] releases both gates once in reverse order when final deletion rejects synchronously', async () => {
        const DeletionAdapter = loadDefault<DeletionAdapterConstructor>(
            'model/operator/storage/StoragePressureDeletionAdapter.js',
        );
        const ledger: string[] = [];
        const rejection = new Error('synthetic final deletion failure');
        const adapter = new DeletionAdapter(
            {
                deletePreparedForStorage: vi.fn(() => {
                    ledger.push('final-delete');
                    throw rejection;
                }),
                prepareStorageDeletion: vi.fn(async (): Promise<Preparation> => ({ status: 'prepared', token: {} })),
            },
            tokenGate(ledger, 'recording'),
            tokenGate(ledger, 'service'),
        );

        await expect(adapter.deleteForStoragePressure(41, 'archive')).rejects.toBe(rejection);
        expect(ledger).toEqual([
            'recording:acquire:41',
            'service:acquire:41',
            'final-delete',
            'service:release',
            'recording:release',
        ]);
    });

    it('[AR-4.2] holds both deletion gates through an asynchronous final rejection, then releases in reverse order without replacing the error', async () => {
        const DeletionAdapter = loadDefault<DeletionAdapterConstructor>(
            'model/operator/storage/StoragePressureDeletionAdapter.js',
        );
        const ledger: string[] = [];
        const rejection = new Error('synthetic asynchronous final deletion failure');
        const preparedToken = Object.freeze({ prepared: 41 });
        let rejectFinal!: (reason: Error) => void;
        let signalFinalStart!: () => void;
        const finalStarted = new Promise<void>(resolve => {
            signalFinalStart = resolve;
        });
        const finalDeletion = new Promise<never>((_resolve, reject: (reason: Error) => void) => {
            rejectFinal = reject;
        });
        const adapter = new DeletionAdapter(
            {
                deletePreparedForStorage: (): Promise<'deleted' | 'not-deleted'> => {
                    ledger.push('final-delete');
                    signalFinalStart();
                    return finalDeletion;
                },
                prepareStorageDeletion: async (recordedId, storageName): Promise<Preparation> => {
                    ledger.push(`prepare:${recordedId}:${storageName}`);
                    return { status: 'prepared', token: preparedToken };
                },
            },
            tokenGate(ledger, 'recording'),
            tokenGate(ledger, 'service'),
        );

        const pending = adapter.deleteForStoragePressure(41, 'archive');
        await finalStarted;
        expect(ledger).toEqual(['prepare:41:archive', 'recording:acquire:41', 'service:acquire:41', 'final-delete']);

        rejectFinal(rejection);

        await expect(pending).rejects.toBe(rejection);
        expect(ledger).toEqual([
            'prepare:41:archive',
            'recording:acquire:41',
            'service:acquire:41',
            'final-delete',
            'service:release',
            'recording:release',
        ]);
    });

    it('[AR-4.2] keeps snapshot races authoritative: a prior lease blocks final delete and a prior deletion token blocks queue publication', async () => {
        const DeletionAdapter = loadDefault<DeletionAdapterConstructor>(
            'model/operator/storage/StoragePressureDeletionAdapter.js',
        );
        const ServiceChildRecordedUseRegistry = loadDefault<ServiceChildRegistryConstructor>(
            'model/ServiceChildRecordedUseRegistry.js',
        );
        const peer = Object.freeze({ generation: 'current' });
        const serviceRegistry = new ServiceChildRecordedUseRegistry();
        serviceRegistry.registerPeer(peer);
        const recordingGate = tokenGate([], 'recording');
        const leased = serviceRegistry.acquire({ kind: 'encoding', recordedId: 41, requestId: 1, senderPeer: peer });
        expect(leased).toEqual({ status: 'granted' });
        const leasedFinalDelete = vi.fn(async (): Promise<'deleted'> => 'deleted');
        const leasedDeletion = new DeletionAdapter(
            {
                deletePreparedForStorage: leasedFinalDelete,
                prepareStorageDeletion: vi.fn(async (): Promise<Preparation> => ({ status: 'prepared', token: {} })),
            },
            recordingGate,
            serviceRegistry,
        );

        await expect(leasedDeletion.deleteForStoragePressure(41, 'archive')).resolves.toBe('not-deleted');
        expect(leasedFinalDelete).not.toHaveBeenCalled();
        expect(serviceRegistry.release({ acquisitionRequestId: 1, senderPeer: peer })).toBe('released');

        const queued: number[] = [];
        const deletionFirst = new DeletionAdapter(
            {
                deletePreparedForStorage: vi.fn(async (): Promise<'deleted'> => {
                    const acquire = serviceRegistry.acquire({
                        kind: 'encoding',
                        recordedId: 42,
                        requestId: 2,
                        senderPeer: peer,
                    });
                    if (acquire.status === 'granted') queued.push(42);
                    expect(acquire).toEqual({ status: 'blocked' });
                    return 'deleted';
                }),
                prepareStorageDeletion: vi.fn(async (): Promise<Preparation> => ({ status: 'prepared', token: {} })),
            },
            recordingGate,
            serviceRegistry,
        );

        await expect(deletionFirst.deleteForStoragePressure(42, 'archive')).resolves.toBe('deleted');
        expect(queued).toEqual([]);
    });
});
