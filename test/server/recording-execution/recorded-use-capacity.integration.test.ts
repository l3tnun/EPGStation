import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createStorageManager, deferred } from '../storage-management/_storage-harness';
import { flushImmediate, load } from './_harness';

/*
 * `recorded-use.integration.test.ts` の「fake capacity consumer」は、容量削除の手順（snapshot → 候補 → gate → 削除）を
 * test の中に手書きした複製で、録画側の使用状況の provider の契約だけを見る。ここでは複製の代わりに、本物の
 * StorageManageModel の容量削除を、本物の RecordingRecordedUseProvider と本物の
 * StorageRecordedUseSnapshotAdapter・StoragePressureDeletionAdapter につないで同じ契約を確かめる。
 */

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshotRoot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const loadDefault = <T>(path: string): T => (require(join(snapshotRoot, path)) as { default: T }).default;

const RecordingRecordedUseProvider = load<new () => any>(
    'model',
    'operator',
    'recording',
    'RecordingRecordedUseProvider.js',
);
const SnapshotAdapter = loadDefault<new (recording: unknown, serviceChild: unknown) => any>(
    'model/operator/storage/StorageRecordedUseSnapshotAdapter.js',
);
const DeletionAdapter = loadDefault<new (recorded: unknown, recordingGate: unknown, serviceGate: unknown) => any>(
    'model/operator/storage/StoragePressureDeletionAdapter.js',
);

const makeSessionEffects = () => ({
    cancel: vi.fn(),
    closeWriter: vi.fn(),
    destroyStream: vi.fn(),
    stop: vi.fn(),
    stopDropCheck: vi.fn(),
});

const entry = { action: 'remove' as const, limitThreshold: 1, name: 'archive', path: 'synthetic-storage/archive' };

const compose = (provider: any, options: { findOldest: (excluded: ReadonlySet<number>) => Promise<number | null> }) => {
    const prepareStorageDeletion = vi.fn(async (recordedId: number) => ({
        status: 'prepared' as const,
        token: { recordedId },
    }));
    const finalDeletion = deferred<'deleted' | 'not-deleted'>();
    const deletePreparedForStorage = vi.fn(() => finalDeletion.promise);
    const serviceGate = { releaseDeletion: vi.fn(), tryAcquireDeletion: vi.fn(() => ({ token: {} })) };
    const deletion = new DeletionAdapter({ deletePreparedForStorage, prepareStorageDeletion }, provider, serviceGate);
    const snapshots = new SnapshotAdapter(provider, {
        requestSnapshot: async () => ({ recordedIds: [], status: 'known' }),
    });
    const requests: ReadonlySet<number>[] = [];
    const harness = createStorageManager({
        candidatePort: {
            findOldestUnused: async request => {
                requests.push(request.excludedRecordedIds);
                return options.findOldest(request.excludedRecordedIds);
            },
        },
        deleteForStoragePressure: (recordedId, storageName) =>
            deletion.deleteForStoragePressure(recordedId, storageName),
        entries: [entry],
        getSnapshot: () => snapshots.getSnapshot(),
    });
    const freeSize = vi
        .fn<(path: string) => Promise<number>>()
        .mockResolvedValueOnce(1024 * 1024)
        .mockResolvedValue(2 * 1024 * 1024);
    harness.manager.getFreeSize = freeSize;
    return { deletePreparedForStorage, finalDeletion, harness, prepareStorageDeletion, requests };
};

describe('recorded-use provider against the real storage capacity deletion', () => {
    it('[Task 2.8][SM-6.4] excludes active recordings from the candidate query and holds the deletion gate until the final delete settles', async () => {
        const provider = new RecordingRecordedUseProvider();
        const active = makeSessionEffects();
        const sameIdLater = makeSessionEffects();
        const otherIdLater = makeSessionEffects();
        provider.tryRegisterSessionUse(active, { recordedId: 901, status: 'active' });
        const { deletePreparedForStorage, finalDeletion, harness, prepareStorageDeletion, requests } = compose(
            provider,
            {
                findOldest: async () => 902,
            },
        );

        const check = harness.manager.check([entry]);
        await vi.waitFor(() => expect(deletePreparedForStorage).toHaveBeenCalledOnce());

        expect(requests.map(excluded => [...excluded])).toEqual([[901]]);
        expect(prepareStorageDeletion).toHaveBeenCalledWith(902, 'archive');
        expect(provider.tryRegisterSessionUse(sameIdLater, { recordedId: 902, status: 'active' })).toBe('blocked');
        expect(provider.tryRegisterSessionUse(otherIdLater, { recordedId: 903, status: 'active' })).toBe('registered');

        finalDeletion.resolve('deleted');
        await check;

        expect(provider.tryRegisterSessionUse(sameIdLater, { recordedId: 902, status: 'active' })).toBe('registered');
        for (const effects of [active, sameIdLater, otherIdLater]) {
            expect(effects.cancel).not.toHaveBeenCalled();
            expect(effects.stop).not.toHaveBeenCalled();
            expect(effects.destroyStream).not.toHaveBeenCalled();
        }
    });

    it('[Task 2.8] stops before the candidate query and deletion while an indeterminate recording session exists', async () => {
        const provider = new RecordingRecordedUseProvider();
        const indeterminate = makeSessionEffects();
        provider.tryRegisterSessionUse(indeterminate, { status: 'unknown' });
        const findOldest = vi.fn(async () => 912);
        const { deletePreparedForStorage, harness, prepareStorageDeletion } = compose(provider, { findOldest });

        await harness.manager.check([entry]);

        expect(findOldest).not.toHaveBeenCalled();
        expect(prepareStorageDeletion).not.toHaveBeenCalled();
        expect(deletePreparedForStorage).not.toHaveBeenCalled();
        expect(indeterminate.stop).not.toHaveBeenCalled();
    });

    it('[Task 2.8] does not delete a candidate whose recording started between the snapshot and the deletion gate', async () => {
        const provider = new RecordingRecordedUseProvider();
        const changed = makeSessionEffects();
        const findOldest = vi.fn(async () => {
            provider.tryRegisterSessionUse(changed, { recordedId: 922, status: 'active' });
            return 922;
        });
        const { deletePreparedForStorage, finalDeletion, harness } = compose(provider, { findOldest });

        await harness.manager.check([entry]);
        await flushImmediate();

        expect(findOldest).toHaveBeenCalled();
        expect(deletePreparedForStorage).not.toHaveBeenCalled();
        expect(changed.stop).not.toHaveBeenCalled();
        finalDeletion.resolve('not-deleted');
        provider.releaseSessionUse(changed);
        const afterGuard = provider.tryAcquireDeletion(922);
        expect('token' in afterGuard).toBe(true);
        if ('token' in afterGuard) provider.releaseDeletion(afterGuard.token);
    });
});
