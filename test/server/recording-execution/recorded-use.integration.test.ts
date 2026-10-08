import { describe, expect, it, vi } from 'vitest';
import { deferred, flushImmediate, load } from './_harness';

const RecordingRecordedUseProvider = load<new () => any>(
    'model',
    'operator',
    'recording',
    'RecordingRecordedUseProvider.js',
);

type DeletionResult = 'deleted' | 'not-deleted';

interface FakeSnapshotProvider {
    getActiveRecordedIds(): unknown | Promise<unknown>;
}

interface FakeRecordedUseGate {
    tryAcquireDeletion(recordedId: number): { readonly token: object } | { readonly status: string };
    releaseDeletion(token: object): void;
}

// 容量削除の手順（snapshot → 候補 → gate → 削除）を手書きした複製。ここは録画側の RecordingRecordedUseProvider が
// 返す snapshot と gate の契約だけを見るために残す。本物の StorageManageModel の容量削除につないだ確認は
// recorded-use-capacity.integration.test.ts にある。
const runFakeCapacityDeletion = async (
    snapshotProvider: FakeSnapshotProvider,
    gate: FakeRecordedUseGate,
    queryCandidate: (excludedRecordedIds: ReadonlySet<number>) => Promise<number | null>,
    deleteCandidate: (recordedId: number) => Promise<DeletionResult>,
): Promise<DeletionResult> => {
    let snapshot: any;
    try {
        snapshot = await snapshotProvider.getActiveRecordedIds();
    } catch {
        return 'not-deleted';
    }
    if (snapshot.status !== 'known') return 'not-deleted';

    const candidate = await queryCandidate(snapshot.recordedIds);
    if (candidate === null) return 'not-deleted';

    const acquired = gate.tryAcquireDeletion(candidate);
    if (!('token' in acquired)) return 'not-deleted';
    try {
        return await deleteCandidate(candidate);
    } finally {
        gate.releaseDeletion(acquired.token);
    }
};

const makeSessionEffects = () => ({
    cancel: vi.fn(),
    closeWriter: vi.fn(),
    destroyStream: vi.fn(),
    stop: vi.fn(),
    stopDropCheck: vi.fn(),
});

const expectNoSessionEffects = (...effects: ReturnType<typeof makeSessionEffects>[]): void => {
    for (const effect of effects) {
        expect(effect.cancel).not.toHaveBeenCalled();
        expect(effect.closeWriter).not.toHaveBeenCalled();
        expect(effect.destroyStream).not.toHaveBeenCalled();
        expect(effect.stop).not.toHaveBeenCalled();
        expect(effect.stopDropCheck).not.toHaveBeenCalled();
    }
};

describe('recording recorded-use fake capacity consumer', () => {
    it('[Task 2.8] passes a known snapshot only as candidate exclusion and releases the selected ID gate', async () => {
        const provider = new RecordingRecordedUseProvider();
        const first = makeSessionEffects();
        const duplicate = makeSessionEffects();
        provider.tryRegisterSessionUse(first, { status: 'active', recordedId: 901 });
        provider.tryRegisterSessionUse(duplicate, { status: 'active', recordedId: 901 });
        const queryCandidate = vi.fn(async (excluded: ReadonlySet<number>) => {
            expect([...excluded]).toEqual([901]);
            return 902;
        });
        const deleteCandidate = vi.fn(async () => 'deleted' as const);

        await expect(runFakeCapacityDeletion(provider, provider, queryCandidate, deleteCandidate)).resolves.toBe(
            'deleted',
        );

        expect(queryCandidate).toHaveBeenCalledOnce();
        expect(deleteCandidate).toHaveBeenCalledExactlyOnceWith(902);
        const afterDeletion = makeSessionEffects();
        expect(provider.tryRegisterSessionUse(afterDeletion, { status: 'active', recordedId: 902 })).toBe('registered');
        expectNoSessionEffects(first, duplicate, afterDeletion);
    });

    it.each(['unknown', 'rejected'] as const)(
        '[Task 2.8] stops before candidate query and deletion when snapshot acquisition is %s',
        async outcome => {
            const provider = new RecordingRecordedUseProvider();
            const indeterminate = makeSessionEffects();
            provider.tryRegisterSessionUse(indeterminate, { status: 'unknown' });
            const failure = new Error('synthetic snapshot rejection');
            const snapshotProvider =
                outcome === 'unknown' ? provider : { getActiveRecordedIds: vi.fn(async () => Promise.reject(failure)) };
            const queryCandidate = vi.fn(async () => 912);
            const deleteCandidate = vi.fn(async () => 'deleted' as const);

            await expect(
                runFakeCapacityDeletion(snapshotProvider, provider, queryCandidate, deleteCandidate),
            ).resolves.toBe('not-deleted');

            expect(queryCandidate).not.toHaveBeenCalled();
            expect(deleteCandidate).not.toHaveBeenCalled();
            expectNoSessionEffects(indeterminate);
        },
    );

    it.each(['busy', 'unknown'] as const)(
        '[Task 2.8] maps a deletion-time %s gate to not-deleted without invoking delete',
        async gateResult => {
            const provider = new RecordingRecordedUseProvider();
            const changed = makeSessionEffects();
            const queryCandidate = vi.fn(async () => {
                provider.tryRegisterSessionUse(
                    changed,
                    gateResult === 'busy' ? { status: 'active', recordedId: 922 } : { status: 'unknown' },
                );
                return 922;
            });
            const deleteCandidate = vi.fn(async () => 'deleted' as const);

            await expect(runFakeCapacityDeletion(provider, provider, queryCandidate, deleteCandidate)).resolves.toBe(
                'not-deleted',
            );

            expect(queryCandidate).toHaveBeenCalledOnce();
            expect(deleteCandidate).not.toHaveBeenCalled();
            expectNoSessionEffects(changed);
            provider.releaseSessionUse(changed);
            const afterGuard = provider.tryAcquireDeletion(922);
            expect('token' in afterGuard).toBe(true);
            if ('token' in afterGuard) provider.releaseDeletion(afterGuard.token);
        },
    );

    it.each(['deleted', 'not-deleted', 'rejected'] as const)(
        '[Task 2.8] releases the exact acquired token after a %s deletion result',
        async outcome => {
            const provider = new RecordingRecordedUseProvider();
            const existing = makeSessionEffects();
            const sameId = makeSessionEffects();
            const differentId = makeSessionEffects();
            provider.tryRegisterSessionUse(existing, { status: 'active', recordedId: 931 });
            const deletion = deferred<DeletionResult>();
            const releaseDeletion = vi.spyOn(provider, 'releaseDeletion');
            const queryCandidate = vi.fn(async (excluded: ReadonlySet<number>) => {
                expect([...excluded]).toEqual([931]);
                return 932;
            });
            const deleteCandidate = vi.fn(() => deletion.promise);
            const operation = runFakeCapacityDeletion(provider, provider, queryCandidate, deleteCandidate);
            await flushImmediate();

            expect(deleteCandidate).toHaveBeenCalledExactlyOnceWith(932);
            expect(releaseDeletion).not.toHaveBeenCalled();
            expect(provider.tryRegisterSessionUse(sameId, { status: 'active', recordedId: 932 })).toBe('blocked');
            expect(provider.tryRegisterSessionUse(differentId, { status: 'active', recordedId: 933 })).toBe(
                'registered',
            );
            expect([...provider.getActiveRecordedIds().recordedIds]).toEqual([931, 933]);
            expectNoSessionEffects(existing, sameId, differentId);

            if (outcome === 'rejected') {
                const failure = new Error('synthetic capacity deletion rejection');
                deletion.reject(failure);
                await expect(operation).rejects.toBe(failure);
            } else {
                deletion.resolve(outcome);
                await expect(operation).resolves.toBe(outcome);
            }

            expect(releaseDeletion).toHaveBeenCalledOnce();
            const releasedToken = releaseDeletion.mock.calls[0][0];
            expect(Object.keys(releasedToken)).toEqual([]);
            expect(provider.tryRegisterSessionUse(sameId, { status: 'active', recordedId: 932 })).toBe('registered');
            expectNoSessionEffects(existing, sameId, differentId);
            provider.releaseSessionUse(existing);
            provider.releaseSessionUse(sameId);
            provider.releaseSessionUse(differentId);
            releaseDeletion.mockRestore();
            const finalGate = provider.tryAcquireDeletion(932);
            expect('token' in finalGate).toBe(true);
            if ('token' in finalGate) provider.releaseDeletion(finalGate.token);
        },
    );
});
