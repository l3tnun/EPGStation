import { describe, expect, it, vi } from 'vitest';

import { compiled } from './_media-harness';

describe('recorded delivery lease consumer contract', () => {
    it('[MD-2.5] resolves the recorded ID before acquiring the delivery lease and adopting the revalidated source', async () => {
        const RecordedDeliveryLeaseConsumer = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'RecordedDeliveryLeaseConsumer.js',
        ).default;
        const calls: string[] = [];
        const source = {
            inputPath: 'synthetic/encoded.m2ts',
            kind: 'encoded-direct',
            playPosition: 12,
            recordedId: 41,
            videoFileId: 31,
            videoInfo: { bitRate: 8, duration: 60, size: 480 },
        };
        const provider = {
            open: vi.fn(async (videoFileId: number, recordedId: number, playPosition: number) => {
                calls.push(`open:${videoFileId}:${recordedId}:${playPosition}`);
                return {
                    adopt: () => {
                        calls.push('adopt');
                        return { source, status: 'adopted' };
                    },
                };
            }),
            resolveRecordedId: vi.fn(async (videoFileId: number) => {
                calls.push(`resolve:${videoFileId}`);
                return 41;
            }),
        };
        const usePort = {
            acquire: vi.fn(async (recordedId: number, kind: string) => {
                calls.push(`acquire:${recordedId}:${kind}`);
                return { release: vi.fn(async () => undefined) };
            }),
        };
        const consumer = new RecordedDeliveryLeaseConsumer(provider, usePort);

        await expect(consumer.acquireAndOpen(31, 12)).resolves.toMatchObject({ recordedId: 41, source });

        expect(calls).toEqual(['resolve:31', 'acquire:41:delivery', 'open:31:41:12', 'adopt']);
    });

    it('[MD-2.5] releases the exact acquired lease once when concurrent terminals join', async () => {
        const RecordedDeliveryLeaseConsumer = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'RecordedDeliveryLeaseConsumer.js',
        ).default;
        const release = vi.fn(async () => undefined);
        const consumer = new RecordedDeliveryLeaseConsumer(
            {
                open: async () => ({
                    adopt: () => ({
                        source: {
                            inputPath: 'synthetic/encoded.m2ts',
                            kind: 'encoded-direct',
                            playPosition: 12,
                            recordedId: 41,
                            videoFileId: 31,
                            videoInfo: { bitRate: 8, duration: 60, size: 480 },
                        },
                        status: 'adopted',
                    }),
                }),
                resolveRecordedId: async () => 41,
            },
            { acquire: async () => ({ release }) },
        );
        const delivery = await consumer.acquireAndOpen(31, 12);

        await expect(Promise.all([delivery.release(), delivery.release()])).resolves.toEqual([undefined, undefined]);

        expect(release).toHaveBeenCalledOnce();
    });

    it('[MD-2.5] rejects a revalidated source whose recorded ID changed and releases its acquired lease', async () => {
        const RecordedDeliveryLeaseConsumer = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'RecordedDeliveryLeaseConsumer.js',
        ).default;
        const release = vi.fn(async () => undefined);
        const consumer = new RecordedDeliveryLeaseConsumer(
            {
                open: async () => ({
                    adopt: () => ({
                        source: {
                            inputPath: 'synthetic/encoded.m2ts',
                            kind: 'encoded-direct',
                            playPosition: 12,
                            recordedId: 99,
                            videoFileId: 31,
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

        expect(release).toHaveBeenCalledOnce();
    });

    it('[MD-2.5] closes an adopted reader source when source revalidation fails before delivery activation', async () => {
        const RecordedDeliveryLeaseConsumer = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'RecordedDeliveryLeaseConsumer.js',
        ).default;
        const close = vi.fn(async () => undefined);
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
                            videoFileId: 32,
                            videoInfo: { bitRate: 8, duration: 60, size: 480 },
                        },
                        status: 'adopted',
                    }),
                }),
                resolveRecordedId: async () => 41,
            },
            { acquire: async () => ({ release: async () => undefined }) },
        );

        await expect(consumer.acquireAndOpen(31, 12)).rejects.toThrow('RecordedPlaybackSourceMismatch');

        expect(close).toHaveBeenCalledOnce();
    });

    it('[MD-2.5] rejects a stale source adoption and releases the lease without exposing a source', async () => {
        const RecordedDeliveryLeaseConsumer = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'RecordedDeliveryLeaseConsumer.js',
        ).default;
        const release = vi.fn(async () => undefined);
        const consumer = new RecordedDeliveryLeaseConsumer(
            {
                open: async () => ({ adopt: () => ({ status: 'stale' }) }),
                resolveRecordedId: async () => 41,
            },
            { acquire: async () => ({ release }) },
        );

        await expect(consumer.acquireAndOpen(31, 12)).rejects.toThrow('RecordedPlaybackSourceAdoptionStale');

        expect(release).toHaveBeenCalledOnce();
    });

    it('[MD-2.5] rejects a revalidated source whose play position changed and releases its acquired lease', async () => {
        const RecordedDeliveryLeaseConsumer = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'RecordedDeliveryLeaseConsumer.js',
        ).default;
        const release = vi.fn(async () => undefined);
        const consumer = new RecordedDeliveryLeaseConsumer(
            {
                open: async () => ({
                    adopt: () => ({
                        source: {
                            inputPath: 'synthetic/encoded.m2ts',
                            kind: 'encoded-direct',
                            playPosition: 13,
                            recordedId: 41,
                            videoFileId: 31,
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

        expect(release).toHaveBeenCalledOnce();
    });

    it('[MD-2.5] does not inspect a direct source as a reader while rejecting a revalidation mismatch', async () => {
        const RecordedDeliveryLeaseConsumer = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'RecordedDeliveryLeaseConsumer.js',
        ).default;
        const release = vi.fn(async () => undefined);
        let readerAccesses = 0;
        const directSource = {
            inputPath: 'synthetic/encoded.m2ts',
            kind: 'encoded-direct',
            playPosition: 12,
            recordedId: 99,
            videoFileId: 31,
            videoInfo: { bitRate: 8, duration: 60, size: 480 },
            get reader() {
                readerAccesses += 1;
                throw new Error('encoded source must not be treated as a reader');
            },
        };
        const consumer = new RecordedDeliveryLeaseConsumer(
            {
                open: async () => ({ adopt: () => ({ source: directSource, status: 'adopted' }) }),
                resolveRecordedId: async () => 41,
            },
            { acquire: async () => ({ release }) },
        );

        await expect(consumer.acquireAndOpen(31, 12)).rejects.toThrow('RecordedPlaybackSourceMismatch');

        expect(readerAccesses).toBe(0);
        expect(release).toHaveBeenCalledOnce();
    });
});
