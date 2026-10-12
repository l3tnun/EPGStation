import { describe, expect, it, vi } from 'vitest';

import { compiled } from './_media-harness';

const RecordedDeliveryLeaseConsumer = compiled<any>(
    'model',
    'service',
    'stream',
    'recorded',
    'RecordedDeliveryLeaseConsumer.js',
).default;

/**
 * Real RecordedDeliveryLeaseConsumer disposal-failure catch paths:
 * - disposeBeforeAdoption (L178–180): the opened-but-not-yet-adopted source's own cleanup throws
 *   while a request goes stale right after `open()` resolves.
 * - disposeUnconsumedSource (L189–191): a reader source's `reader.close()` throws while unwinding
 *   after adoption revalidation fails.
 * Both diagnostics must not replace the original staleness/mismatch error the caller sees.
 */
describe('RecordedDeliveryLeaseConsumer disposal diagnostics catch (unittest/imp)', () => {
    it('[R2-RECORDEDDELIVERY-DISPOSEBEFOREADOPTION-CATCH] surfaces staleness even when disposeBeforeAdoption itself throws', async () => {
        const release = vi.fn(async () => undefined);
        const disposeBeforeAdoption = vi.fn(async () => {
            throw new Error('synthetic-dispose-before-adoption-failure');
        });
        let activeCalls = 0;
        const consumer = new RecordedDeliveryLeaseConsumer(
            {
                open: vi.fn(async () => ({
                    adopt: () => {
                        throw new Error('adopt must not run once the request already went stale');
                    },
                    disposeBeforeAdoption,
                })),
                resolveRecordedId: vi.fn(async () => 41),
            },
            { acquire: vi.fn(async () => ({ release })) },
        );
        const isActive = () => {
            activeCalls += 1;
            // Stay active through resolve + acquire, go stale right after open() resolves.
            return activeCalls <= 2;
        };

        await expect(consumer.acquireAndOpen(31, 12, isActive)).rejects.toThrow(
            'RecordedDeliveryLeaseAcquisitionStale',
        );

        expect(disposeBeforeAdoption).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledOnce();
    });

    it('[R2-RECORDEDDELIVERY-DISPOSEUNCONSUMEDSOURCE-CATCH] surfaces the mismatch error even when reader.close() itself throws', async () => {
        const release = vi.fn(async () => undefined);
        const close = vi.fn(async () => {
            throw new Error('synthetic-reader-close-failure');
        });
        const consumer = new RecordedDeliveryLeaseConsumer(
            {
                open: async () => ({
                    adopt: () => ({
                        source: {
                            inputPath: 'synthetic/recording.ts',
                            kind: 'recording-tail-reader',
                            playPosition: 12,
                            reader: { close, readable: {} },
                            recordedId: 41,
                            // videoFileId mismatch forces RecordedPlaybackSourceMismatch after adoption.
                            videoFileId: 999,
                            videoInfo: { bitRate: 8, duration: 60, size: 480 },
                        },
                        status: 'adopted',
                    }),
                }),
                resolveRecordedId: async () => 41,
            },
            { acquire: async () => ({ release }) },
        );

        await expect(consumer.acquireAndOpen(31, 12)).rejects.toThrow('RecordedPlaybackSourceMismatch');

        expect(close).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledOnce();
    });
});
