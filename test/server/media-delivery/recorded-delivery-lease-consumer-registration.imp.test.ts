import { describe, expect, it, vi } from 'vitest';

import { compiled } from './_media-harness';

const consumerModule = compiled<any>('model', 'service', 'stream', 'recorded', 'RecordedDeliveryLeaseConsumer.js');
const RecordedDeliveryLeaseConsumer = consumerModule.default;
const toLegacyRecordedDeliveryError = consumerModule.toLegacyRecordedDeliveryError as (error: unknown) => Error;

const encodedSource = {
    inputPath: 'synthetic/encoded.m2ts',
    kind: 'encoded-direct',
    playPosition: 12,
    recordedId: 41,
    videoFileId: 31,
    videoInfo: { bitRate: 8, duration: 60, size: 480 },
};

const makeSubject = (leaseRelease: () => Promise<void> = async () => undefined) => {
    const lease = { release: vi.fn(leaseRelease) };
    const registration = { release: vi.fn() };
    const provider = {
        open: vi.fn(async () => ({ adopt: () => ({ source: encodedSource, status: 'adopted' }) })),
        resolveRecordedId: vi.fn(async () => 41),
    };
    const usePort = { acquire: vi.fn(async () => lease) };
    const registry = { register: vi.fn(() => registration) };
    const consumer = new RecordedDeliveryLeaseConsumer(provider, usePort, registry);
    return { consumer, lease, provider, registration, registry, usePort };
};

/**
 * RecordedDeliveryLeaseConsumer の中断・解放の分岐。取得の途中で要求が不要になったら
 * 取得済みの lease と配信中の登録を返し、後続の処理へ進まない。
 */
describe('RecordedDeliveryLeaseConsumer staleness and registration release (unittest/imp)', () => {
    it.each([
        'RecordedPlaybackVideoFileNotFound',
        'RecordedPlaybackRecordedIdMismatch',
        'RecordedPlaybackSourceMismatch',
    ])('[MD-10.2] maps provider failure %s to the legacy VideoIsNull error', message => {
        expect(toLegacyRecordedDeliveryError(new Error(message)).message).toBe('VideoIsNull');
    });

    it('[MD-10.2] rejects as stale right after resolving the recorded id without acquiring a lease', async () => {
        const { consumer, provider, registry, usePort } = makeSubject();

        await expect(consumer.acquireAndOpen(31, 12, () => false)).rejects.toThrow(
            'RecordedDeliveryLeaseAcquisitionStale',
        );

        expect(provider.resolveRecordedId).toHaveBeenCalledExactlyOnceWith(31);
        expect(usePort.acquire).not.toHaveBeenCalled();
        expect(registry.register).not.toHaveBeenCalled();
        expect(provider.open).not.toHaveBeenCalled();
    });

    it('[MD-10.2] releases the lease and the active registration when the request became stale after acquiring', async () => {
        const { consumer, lease, provider, registration, registry } = makeSubject();
        const isActive = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);

        await expect(consumer.acquireAndOpen(31, 12, isActive)).rejects.toThrow(
            'RecordedDeliveryLeaseAcquisitionStale',
        );

        expect(registry.register).toHaveBeenCalledExactlyOnceWith(41);
        expect(lease.release).toHaveBeenCalledOnce();
        expect(registration.release).toHaveBeenCalledOnce();
        expect(provider.open).not.toHaveBeenCalled();
    });

    it('[MD-10.2] keeps the registration and still reports the stale error when the lease release itself fails', async () => {
        const { consumer, lease, registration } = makeSubject(async () => {
            throw new Error('lease release failed');
        });
        const isActive = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);

        await expect(consumer.acquireAndOpen(31, 12, isActive)).rejects.toThrow(
            'RecordedDeliveryLeaseAcquisitionStale',
        );

        expect(lease.release).toHaveBeenCalledOnce();
        expect(registration.release).not.toHaveBeenCalled();
    });

    it('[MD-10.2] release returns the lease first, then the registration, and only once', async () => {
        const { consumer, lease, registration } = makeSubject();

        const acquired = await consumer.acquireAndOpen(31, 12);
        expect(registration.release).not.toHaveBeenCalled();
        await Promise.all([acquired.release(), acquired.release()]);
        await acquired.release();

        expect(lease.release).toHaveBeenCalledOnce();
        expect(registration.release).toHaveBeenCalledOnce();
        expect(lease.release.mock.invocationCallOrder[0]).toBeLessThan(
            registration.release.mock.invocationCallOrder[0],
        );
    });
});
