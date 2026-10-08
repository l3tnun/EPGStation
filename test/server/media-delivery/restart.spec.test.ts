import { describe, expect, it, vi } from 'vitest';

import { compiled, executionManager, fakeIdAllocator, fakeStream, logger } from './_media-harness';

const StreamManageModel = compiled<any>('model', 'service', 'stream', 'manager', 'StreamManageModel.js').default;
const StreamApiModel = compiled<any>('model', 'api', 'stream', 'StreamApiModel.js').default;

describe('restart compatibility boundary', () => {
    it('[PRIMARY R8.2] constructs after a restart with no restored stream list or lifecycle state', () => {
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), {
            notifyClient: () => undefined,
        });
        expect(manager.getStreamInfos()).toEqual([]);
        expect(manager.restore).toBeUndefined();
    });

    it('[PRIMARY R8.1] keeps newly accepted HLS stream identifiers and list entries in the running manager', async () => {
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });
        const stream = fakeStream({ isEnable: false, type: 'LiveHLS' });

        await expect(manager.start(stream)).resolves.toBe(0);

        expect(manager.getStreamInfos()).toEqual([{ info: stream.getInfo(), streamId: 0 }]);
        expect(stream.start).toHaveBeenCalledWith(0);
    });

    it('[PRIMARY R8.3] reserves residual HLS artifact identifiers before accepting a new HLS stream after restart', async () => {
        const artifactIndex = {
            listExact: vi.fn(async () => []),
            scanAtStartup: vi.fn(async () => new Set([0])),
            scanCurrent: vi.fn(async () => new Set<number>()),
        };
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            fakeIdAllocator({ getLogger: logger }, { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) }, artifactIndex),
        );
        const stream = fakeStream({ isEnable: false, type: 'LiveHLS' });

        await expect(manager.start(stream)).resolves.toBe(1);

        expect(stream.start).toHaveBeenCalledWith(1);
    });

    it('[PRIMARY R8.4] exposes no server-wide drain path that waits for every delivery to finish', () => {
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), {
            notifyClient: () => undefined,
        });

        expect(manager.drain).toBeUndefined();
    });

    it('[MD-4.9] preserves the public recorded stream field typo viodeFileId', async () => {
        const api = new StreamApiModel(
            {},
            async () => ({}),
            async () => ({}),
            async () => ({}),
            async () => ({}),
            {
                getStreamInfos: () => [
                    {
                        info: { isEnable: true, mode: 0, type: 'RecordedHLS', videoFileId: 31 },
                        streamId: 7,
                    },
                ],
            },
            {},
            { findId: async () => null },
            {},
            {},
            {},
        );
        await expect(api.getStreamInfos(false)).resolves.toEqual({
            items: [
                {
                    channelId: 0,
                    endAt: 0,
                    isEnable: true,
                    mode: 0,
                    name: '',
                    recordedId: 0,
                    startAt: 0,
                    streamId: 7,
                    type: 'RecordedHLS',
                    viodeFileId: 31,
                },
            ],
        });
    });

    it('hydrates live and recorded stream infos from program and recorded sources', async () => {
        // RED baseline: null program/video/recorded mocks leave empty names (existing MD-4.9 shape).
        // GREEN: non-null DBs exercise getStreamInfos Live L408–440 and Recorded L456–478 hydrate.
        const program = {
            name: 'synthetic-live-full-name',
            halfWidthName: 'synthetic-live-half-name',
            startAt: 1_000,
            endAt: 2_000,
            description: 'synthetic-live-full-description',
            halfWidthDescription: 'synthetic-live-half-description',
            extended: 'synthetic-live-full-extended',
            halfWidthExtended: 'synthetic-live-half-extended',
            rawExtended: '{"key":"synthetic-live-full"}',
            rawHalfWidthExtended: '{"key":"synthetic-live-half"}',
        };
        const recorded = {
            channelId: 42,
            name: 'synthetic-recorded-name',
            startAt: 3_000,
            endAt: 4_000,
            description: 'synthetic-recorded-full-description',
            halfWidthDescription: 'synthetic-recorded-half-description',
            extended: 'synthetic-recorded-full-extended',
            halfWidthExtended: 'synthetic-recorded-half-extended',
            rawExtended: '{"key":"synthetic-recorded-full"}',
            rawHalfWidthExtended: '{"key":"synthetic-recorded-half"}',
        };
        const findChannelIdAndTime = vi.fn(async () => program);
        const findVideoFileId = vi.fn(async () => ({ id: 31, recordedId: 99 }));
        const findRecordedId = vi.fn(async () => recorded);
        const api = new StreamApiModel(
            {},
            async () => ({}),
            async () => ({}),
            async () => ({}),
            async () => ({}),
            {
                getStreamInfos: () => [
                    {
                        info: { channelId: 10, isEnable: true, mode: 0, type: 'LiveStream' },
                        streamId: 1,
                    },
                    {
                        info: { isEnable: true, mode: 1, type: 'RecordedHLS', videoFileId: 31 },
                        streamId: 2,
                    },
                ],
            },
            { findChannelIdAndTime },
            { findId: findVideoFileId },
            { findId: findRecordedId },
            {},
            {},
        );

        await expect(api.getStreamInfos(false)).resolves.toEqual({
            items: [
                {
                    channelId: 10,
                    description: 'synthetic-live-full-description',
                    endAt: 2_000,
                    extended: 'synthetic-live-full-extended',
                    isEnable: true,
                    mode: 0,
                    name: 'synthetic-live-full-name',
                    rawExtended: { key: 'synthetic-live-full' },
                    startAt: 1_000,
                    streamId: 1,
                    type: 'LiveStream',
                },
                {
                    channelId: 42,
                    description: 'synthetic-recorded-full-description',
                    endAt: 4_000,
                    extended: 'synthetic-recorded-full-extended',
                    isEnable: true,
                    mode: 1,
                    name: 'synthetic-recorded-name',
                    rawExtended: { key: 'synthetic-recorded-full' },
                    recordedId: 99,
                    startAt: 3_000,
                    streamId: 2,
                    type: 'RecordedHLS',
                    viodeFileId: 31,
                },
            ],
        });
        await expect(api.getStreamInfos(true)).resolves.toEqual({
            items: [
                {
                    channelId: 10,
                    description: 'synthetic-live-half-description',
                    endAt: 2_000,
                    extended: 'synthetic-live-half-extended',
                    isEnable: true,
                    mode: 0,
                    name: 'synthetic-live-half-name',
                    rawExtended: { key: 'synthetic-live-half' },
                    startAt: 1_000,
                    streamId: 1,
                    type: 'LiveStream',
                },
                {
                    channelId: 42,
                    description: 'synthetic-recorded-half-description',
                    endAt: 4_000,
                    extended: 'synthetic-recorded-half-extended',
                    isEnable: true,
                    mode: 1,
                    name: 'synthetic-recorded-name',
                    rawExtended: { key: 'synthetic-recorded-half' },
                    recordedId: 99,
                    startAt: 3_000,
                    streamId: 2,
                    type: 'RecordedHLS',
                    viodeFileId: 31,
                },
            ],
        });
        expect(findChannelIdAndTime).toHaveBeenCalled();
        expect(findVideoFileId).toHaveBeenCalledWith(31);
        expect(findRecordedId).toHaveBeenCalledWith(99);
    });
});
