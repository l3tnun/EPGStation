import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const ScheduleApiModel = (require(join(compiledSnapshot, 'model', 'api', 'schedule', 'ScheduleApiModel.js')) as any)
    .default;

const channel = (id: number, overrides: Record<string, unknown> = {}) => ({
    id,
    serviceId: id + 100,
    networkId: 10,
    name: `synthetic-channel-${id}`,
    halfWidthName: `synthetic-half-channel-${id}`,
    remoteControlKeyId: id,
    hasLogoData: true,
    channelTypeId: 0,
    channelType: 'GR',
    channel: `${id}`,
    type: 1,
    ...overrides,
});

const program = (id: number, channelId: number, overrides: Record<string, unknown> = {}) => ({
    id,
    channelId,
    startAt: 1_000 + id,
    endAt: 2_000 + id,
    isFree: true,
    name: `synthetic-program-${id}`,
    halfWidthName: `synthetic-half-program-${id}`,
    description: `synthetic-description-${id}`,
    halfWidthDescription: `synthetic-half-description-${id}`,
    extended: `synthetic-extended-${id}`,
    halfWidthExtended: `synthetic-half-extended-${id}`,
    rawExtended: JSON.stringify({ synthetic: id }),
    rawHalfWidthExtended: JSON.stringify({ syntheticHalf: id }),
    genre1: null,
    subGenre1: null,
    genre2: null,
    subGenre2: null,
    genre3: null,
    subGenre3: null,
    videoType: null,
    videoResolution: null,
    videoComponentType: null,
    videoStreamContent: null,
    audioSamplingRate: null,
    audioComponentType: null,
    ...overrides,
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('program guide Tasks 2.1-2.3 internal query characterization', () => {
    it('[PG-T2.1] projects detail absence and normal/half-width representations without a freshness gate', async () => {
        const stored = program(201, 1);
        const programDB = { findId: vi.fn().mockResolvedValue(stored) };
        const model = new ScheduleApiModel({}, programDB);

        await expect(model.getSchedule(201, false)).resolves.toMatchObject({
            id: 201,
            name: 'synthetic-program-201',
            description: 'synthetic-description-201',
            rawExtended: { synthetic: 201 },
        });
        await expect(model.getSchedule(201, true)).resolves.toMatchObject({
            id: 201,
            name: 'synthetic-half-program-201',
            description: 'synthetic-half-description-201',
            rawExtended: { syntheticHalf: 201 },
        });
        programDB.findId.mockResolvedValueOnce(null);
        await expect(model.getSchedule(999, false)).resolves.toBeNull();
        expect(programDB.findId).toHaveBeenNthCalledWith(3, 999);
    });

    it('[PG-T2.1] partitions channel schedules into inclusive 24-hour queries and keeps the first broadcasting row', async () => {
        const first = program(211, 1);
        const second = program(212, 1);
        const channelDB = {
            findAll: vi.fn().mockResolvedValue([channel(1)]),
            findId: vi.fn().mockResolvedValue(channel(1)),
        };
        const programDB = {
            findBroadcasting: vi.fn().mockResolvedValue([first, second]),
            findSchedule: vi.fn().mockResolvedValueOnce([first]).mockResolvedValueOnce([second]),
        };
        const model = new ScheduleApiModel(channelDB, programDB);

        const days = await model.getChannelSchedule({
            channelId: 1,
            startAt: 10_000,
            days: 2,
            isHalfWidth: false,
        });
        expect(programDB.findSchedule.mock.calls).toEqual([
            [{ startAt: 10_000, endAt: 86_410_000, isHalfWidth: false, channelId: 1, isFree: undefined }],
            [{ startAt: 86_410_000, endAt: 172_810_000, isHalfWidth: false, channelId: 1, isFree: undefined }],
        ]);
        expect(days.map((day: { programs: Array<{ id: number }> }) => day.programs.map(value => value.id))).toEqual([
            [211],
            [212],
        ]);
        await expect(model.getBroadcastingSchedule({ isHalfWidth: false })).resolves.toMatchObject([
            { programs: [{ id: 211 }] },
        ]);
    });

    it('[PG-T2.2][PG-T2.3] forwards the complete search option and limit and preserves repository order', async () => {
        const searchOption = {
            keyword: 'synthetic alpha beta',
            ignoreKeyword: 'synthetic excluded',
            name: true,
            description: true,
            extended: true,
            keyRegExp: true,
            channelIds: [1],
            GR: false,
            genres: [{ genre: 1 }],
            isFree: true,
            durationMin: 60,
            durationMax: 120,
        };
        const programDB = { findRule: vi.fn().mockResolvedValue([program(221, 1), program(222, 1)]) };
        const model = new ScheduleApiModel({}, programDB);

        const result = await model.search(searchOption, false, 2);

        expect(programDB.findRule).toHaveBeenCalledWith({ searchOption, limit: 2 });
        expect(result.map((value: { id: number }) => value.id)).toEqual([221, 222]);
    });
});
