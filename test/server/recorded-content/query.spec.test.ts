import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const load = <T>(path: string): T => (require(join(snapshot, path)) as { default: T }).default;
const RecordedApiModel = load<new (...args: any[]) => any>('model/api/recorded/RecordedApiModel.js');
const RecordedItemUtil = load<new () => any>('model/api/RecordedItemUtil.js');
const EncodeManageModel = load<{ prototype: { getRecordedIndex(): Record<number, unknown[]> } }>(
    'model/service/encode/EncodeManageModel.js',
);

const recorded = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    ruleId: null,
    programId: null,
    channelId: 100 + id,
    startAt: 10_000 - id,
    endAt: 20_000 - id,
    name: `Synthetic ${id}`,
    halfWidthName: `Synthetic ${id}`,
    description: null,
    extended: null,
    rawExtended: null,
    genre1: null,
    genre2: null,
    genre3: null,
    subGenre1: null,
    subGenre2: null,
    subGenre3: null,
    videoType: null,
    videoResolution: null,
    videoStreamContent: null,
    videoComponentType: null,
    audioSamplingRate: null,
    audioComponentType: null,
    isRecording: false,
    isProtected: false,
    ...extra,
});

describe('recorded content query specification', () => {
    it('[RC-2.1] forwards keyword, channel, genre, rule, and file filters while returning only matching records', async () => {
        const records = [recorded(1), recorded(2)];
        const recordedDB = { findAll: vi.fn(async () => [records, records.length]) };
        const model = new RecordedApiModel(
            {},
            recordedDB,
            { getRecordedIndex: vi.fn(() => ({})) },
            new RecordedItemUtil(),
        );
        const option: any = {
            channelId: 101,
            genre1: 3,
            hasVideoFiles: true,
            isHalfWidth: false,
            keyword: 'Synthetic',
            ruleId: 31,
        };

        await expect(model.gets(option)).resolves.toMatchObject({ records: [{ id: 1 }, { id: 2 }], total: 2 });

        expect(recordedDB.findAll).toHaveBeenCalledWith(
            expect.objectContaining({
                channelId: 101,
                genre1: 3,
                hasVideoFiles: true,
                isRecording: false,
                keyword: 'Synthetic',
                ruleId: 31,
            }),
            {
                isNeedTags: false,
                isNeedThumbnails: true,
                isNeedVideoFiles: true,
                isNeedsDropLog: true,
            },
        );
    });

    it('[RC-2.2] returns the filtered page and its total count as separate results', async () => {
        const model = new RecordedApiModel(
            {},
            { findAll: vi.fn(async () => [[recorded(3)], 8]) },
            { getRecordedIndex: vi.fn(() => ({})) },
            new RecordedItemUtil(),
        );

        await expect(model.gets({ isHalfWidth: false } as any)).resolves.toEqual({
            records: [expect.objectContaining({ id: 3 })],
            total: 8,
        });
    });

    it('[RC-2.3] returns the requested recorded item with its video, thumbnail, drop-log, and tag relations', async () => {
        const model = new RecordedApiModel(
            {},
            {
                findId: vi.fn(async () =>
                    recorded(4, {
                        dropLogFile: { dropCnt: 2, errorCnt: 1, id: 41, scramblingCnt: 3 },
                        tags: [{ color: '#040506', id: 42, name: 'Synthetic tag' }],
                        thumbnails: [{ id: 43 }],
                        videoFiles: [
                            {
                                filePath: 'nested/synthetic.ts',
                                id: 44,
                                name: 'Synthetic recording',
                                size: 4_096,
                                type: 'ts',
                            },
                        ],
                    }),
                ),
            },
            { getRecordedIndex: vi.fn(() => ({})) },
            new RecordedItemUtil(),
        );

        await expect(model.get(4, false)).resolves.toMatchObject({
            dropLogFile: { dropCnt: 2, errorCnt: 1, id: 41, scramblingCnt: 3 },
            id: 4,
            tags: [{ color: '#040506', id: 42, name: 'Synthetic tag' }],
            thumbnails: [43],
            videoFiles: [{ filename: 'synthetic.ts', id: 44, name: 'Synthetic recording', size: 4_096, type: 'ts' }],
        });
    });

    it('[RC-2.4] returns configured channel and genre candidates for search controls', async () => {
        const channels = [{ id: 61, name: 'Synthetic channel' }];
        const genres = [{ genre1: 2, genre2: 3 }];
        const recordedDB = {
            findChannelList: vi.fn(async () => channels),
            findGenreList: vi.fn(async () => genres),
        };
        const model = new RecordedApiModel(
            {},
            recordedDB,
            { getRecordedIndex: vi.fn(() => ({})) },
            new RecordedItemUtil(),
        );

        await expect(model.getSearchOptionList()).resolves.toEqual({ channels, genres });
        expect(recordedDB.findChannelList).toHaveBeenCalledOnce();
        expect(recordedDB.findGenreList).toHaveBeenCalledOnce();
    });

    it('[RC-2.5] projects waiting and running encode queue entries as public isEncoding=true', async () => {
        for (const state of ['waiting', 'running'] as const) {
            const encode = Object.create(EncodeManageModel.prototype) as any;
            const job = {
                getEncodeOption: () => ({ recordedId: 5, encodeId: state === 'running' ? 51 : 52, mode: state }),
            };
            encode.runningQueue = state === 'running' ? [job] : [];
            encode.waitQueue = state === 'waiting' ? [job] : [];
            const model = new RecordedApiModel(
                {},
                { findId: vi.fn(async () => recorded(5)) },
                encode,
                new RecordedItemUtil(),
            );

            await expect(model.get(5, false)).resolves.toMatchObject({ id: 5, isEncoding: true });
        }
    });

    it('[RC-2.5-NONE] projects a recorded item with no queued encode as isEncoding=false', async () => {
        const encode = Object.create(EncodeManageModel.prototype) as any;
        encode.runningQueue = [];
        encode.waitQueue = [];
        const model = new RecordedApiModel(
            {},
            { findId: vi.fn(async () => recorded(6)) },
            encode,
            new RecordedItemUtil(),
        );

        await expect(model.get(6, false)).resolves.toMatchObject({ id: 6, isEncoding: false });
    });

    it('[RC-2.6] returns no item when the requested recorded id does not exist', async () => {
        const recordedDB = { findId: vi.fn(async () => null) };
        const encode = { getRecordedIndex: vi.fn(() => ({})) };
        const model = new RecordedApiModel({}, recordedDB, encode, new RecordedItemUtil());

        await expect(model.get(999, false)).resolves.toBeNull();
        expect(recordedDB.findId).toHaveBeenCalledWith(999);
        expect(encode.getRecordedIndex).toHaveBeenCalledOnce();
    });
});
