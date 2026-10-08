import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDialectPersistence, type DatabaseDialect, makeProgram } from '../fixtures/reservation-rules/runtime';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const ScheduleApiModel = (require(join(compiledSnapshot, 'model', 'api', 'schedule', 'ScheduleApiModel.js')) as any)
    .default;

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('program guide Tasks 2.1-2.3 database query characterization', () => {
    // Each of the 4 cases below recorded up to ~3.9-5.0s across three canonical coverage runs, so
    // they get an explicit larger timeout budget.
    it('[PG-T6.3] projects tuner programs through persistence into public schedule queries in both dialects', async () => {
        const baseTime = 1_900_000_000_000;
        const channels = [
            {
                id: 1,
                serviceId: 101,
                networkId: 10,
                name: 'synthetic-channel-１',
                halfWidthName: 'synthetic-channel-1',
                remoteControlKeyId: null,
                hasLogoData: false,
                channelType: 'GR',
                type: 1,
            },
            {
                id: 2,
                serviceId: 102,
                networkId: 10,
                name: 'synthetic-channel-２',
                halfWidthName: 'synthetic-channel-2',
                remoteControlKeyId: null,
                hasLogoData: false,
                channelType: 'GR',
                type: 1,
            },
            {
                id: 3,
                serviceId: 103,
                networkId: 10,
                name: 'synthetic-channel-３',
                halfWidthName: 'synthetic-channel-3',
                remoteControlKeyId: null,
                hasLogoData: false,
                channelType: 'GR',
                type: 1,
            },
        ];
        const channelIndex = {
            10: {
                101: { id: 1, type: 'GR', channel: '1' },
                102: { id: 2, type: 'GR', channel: '2' },
                103: { id: 3, type: 'GR', channel: '3' },
            },
        };

        for (const dialect of ['sqlite', 'mysql'] as DatabaseDialect[]) {
            const fixture = await createDialectPersistence(dialect);
            try {
                await fixture.programDB.insert(channelIndex, [
                    {
                        id: 430,
                        eventId: 430,
                        serviceId: 101,
                        networkId: 10,
                        startAt: baseTime - 60_000,
                        duration: 60_000,
                        isFree: true,
                        name: 'synthetic-projection before',
                        genres: [{ lv1: 1, lv2: 2 }],
                    },
                    {
                        id: 431,
                        eventId: 431,
                        serviceId: 102,
                        networkId: 10,
                        startAt: baseTime,
                        duration: 60_000,
                        isFree: true,
                        name: 'synthetic-projection ２０１[新]',
                        description: 'synthetic description Ａ',
                        extended: { heading: 'synthetic extended Ｂ' },
                        genres: [
                            { lv1: 1, lv2: 2 },
                            { lv1: 3, lv2: 4 },
                            { lv1: 5, lv2: 6 },
                            { lv1: 7, lv2: 8 },
                        ],
                        video: { type: 'mpeg2', resolution: '1080i', streamContent: 1, componentType: 179 },
                        audios: [
                            { isMain: false, samplingRate: 24_000, componentType: 1, langs: ['jpn'] },
                            { isMain: true, samplingRate: 48_000, componentType: 3, langs: ['jpn'] },
                        ],
                    },
                    {
                        id: 432,
                        eventId: 432,
                        serviceId: 103,
                        networkId: 10,
                        startAt: baseTime + 60_000,
                        duration: 60_000,
                        isFree: true,
                        name: 'synthetic-projection after',
                        genres: [{ lv1: 1, lv2: 2 }],
                    },
                    {
                        id: 433,
                        eventId: 433,
                        serviceId: 103,
                        networkId: 10,
                        startAt: baseTime + 180_000,
                        duration: 60_000,
                        isFree: true,
                        name: 'synthetic-empty genres',
                        genres: [],
                    },
                ]);

                const stored = await fixture.programDB.findId(431);
                expect(stored).toMatchObject({
                    name: 'synthetic-projection ２０１[新]',
                    halfWidthName: 'synthetic-projection 201[新]',
                    shortName: 'synthetic-projection 201',
                    description: 'synthetic description Ａ',
                    halfWidthDescription: 'synthetic description A',
                    extended: '◇heading\nsynthetic extended Ｂ',
                    halfWidthExtended: '◇heading\nsynthetic extended B',
                    rawExtended: JSON.stringify({ heading: 'synthetic extended Ｂ' }),
                    rawHalfWidthExtended: JSON.stringify({ heading: 'synthetic extended B' }),
                    genre1: 1,
                    subGenre1: 2,
                    genre2: 3,
                    subGenre2: 4,
                    genre3: 5,
                    subGenre3: 6,
                    videoType: 'mpeg2',
                    videoResolution: '1080i',
                    videoStreamContent: 1,
                    videoComponentType: 179,
                    audioSamplingRate: 48_000,
                    audioComponentType: 3,
                });
                await expect(fixture.programDB.findId(433)).resolves.toMatchObject({
                    genre1: null,
                    subGenre1: null,
                    genre2: null,
                    subGenre2: null,
                    genre3: null,
                    subGenre3: null,
                });

                const channelDB = {
                    findAll: async () => channels,
                    findChannleTypes: async () => channels,
                };
                const scheduleApi = new ScheduleApiModel(channelDB, fixture.programDB);
                const schedule = await scheduleApi.getSchedules({
                    GR: true,
                    startAt: baseTime,
                    endAt: baseTime + 60_000,
                    isHalfWidth: false,
                    needsRawExtended: true,
                });
                expect(
                    schedule.flatMap((value: { programs: Array<{ id: number }> }) => value.programs.map(p => p.id)),
                ).toEqual([430, 431, 432]);

                await expect(scheduleApi.getSchedule(431, false)).resolves.toMatchObject({
                    name: 'synthetic-projection ２０１[新]',
                    description: 'synthetic description Ａ',
                    extended: '◇heading\nsynthetic extended Ｂ',
                    rawExtended: { heading: 'synthetic extended Ｂ' },
                    genre1: 1,
                    subGenre1: 2,
                    genre2: 3,
                    subGenre2: 4,
                    genre3: 5,
                    subGenre3: 6,
                    videoType: 'mpeg2',
                    videoResolution: '1080i',
                    videoStreamContent: 1,
                    videoComponentType: 179,
                    audioSamplingRate: 48_000,
                    audioComponentType: 3,
                });
                await expect(scheduleApi.getSchedule(431, true)).resolves.toMatchObject({
                    name: 'synthetic-projection 201[新]',
                    description: 'synthetic description A',
                    extended: '◇heading\nsynthetic extended B',
                    rawExtended: { heading: 'synthetic extended B' },
                });
                await expect(scheduleApi.getSchedule(999, false)).resolves.toBeNull();

                vi.useFakeTimers();
                vi.setSystemTime(baseTime);
                const atStart = await scheduleApi.getBroadcastingSchedule({ isHalfWidth: false });
                expect(
                    atStart.flatMap((value: { programs: Array<{ id: number }> }) => value.programs.map(p => p.id)),
                ).toEqual([430, 431]);
                vi.setSystemTime(baseTime + 60_000);
                const atEnd = await scheduleApi.getBroadcastingSchedule({ isHalfWidth: false });
                expect(
                    atEnd.flatMap((value: { programs: Array<{ id: number }> }) => value.programs.map(p => p.id)),
                ).toEqual([431, 432]);
                vi.setSystemTime(baseTime - 120_000);

                const search = await scheduleApi.search(
                    {
                        keyword: 'synthetic-projection',
                        name: true,
                        channelIds: [1, 2, 3],
                        genres: [{ genre: 1, subGenre: 2 }],
                        isFree: true,
                        durationMin: 60,
                        durationMax: 60,
                        searchPeriods: [{ startAt: baseTime - 60_000, endAt: baseTime + 120_000 }],
                    },
                    true,
                    2,
                );
                expect(search.map((value: { id: number }) => value.id)).toEqual([430, 431]);
                expect(search[1]).toMatchObject({
                    name: 'synthetic-projection 201[新]',
                    description: 'synthetic description A',
                    extended: '◇heading\nsynthetic extended B',
                    rawExtended: { heading: 'synthetic extended B' },
                });
            } finally {
                vi.useRealTimers();
                await fixture.cleanup();
            }
        }
    }, 30_000);

    it('[PG-T2.1] keeps inclusive schedule and broadcasting endpoints, free filtering, and start order in both dialects', async () => {
        for (const dialect of ['sqlite', 'mysql'] as DatabaseDialect[]) {
            const fixture = await createDialectPersistence(dialect);
            try {
                await fixture.source.getRepository(fixture.Program).insert([
                    makeProgram({
                        id: 401,
                        channelId: 11,
                        channelType: 'GR',
                        startAt: 1_000,
                        endAt: 2_000,
                        name: 'synthetic-normal-Ａ',
                        halfWidthName: 'synthetic-half-A',
                        description: 'synthetic-normal-description-Ｂ',
                        halfWidthDescription: 'synthetic-half-description-B',
                        extended: 'synthetic-normal-extended-Ｃ',
                        halfWidthExtended: 'synthetic-half-extended-C',
                        rawExtended: JSON.stringify({ representation: 'normal-Ｄ' }),
                        rawHalfWidthExtended: JSON.stringify({ representation: 'half-D' }),
                    }),
                    makeProgram({ id: 402, channelId: 11, channelType: 'GR', startAt: 2_000, endAt: 3_000 }),
                    makeProgram({ id: 403, channelId: 11, channelType: 'GR', startAt: 500, endAt: 1_000 }),
                    makeProgram({
                        id: 404,
                        channelId: 11,
                        channelType: 'GR',
                        startAt: 1_500,
                        endAt: 2_500,
                        isFree: false,
                    }),
                    makeProgram({ id: 405, channelId: 12, channelType: 'BS', startAt: 1_600, endAt: 2_500 }),
                ]);

                const byChannel = await fixture.programDB.findSchedule({
                    channelId: 11,
                    startAt: 1_000,
                    endAt: 2_000,
                    isHalfWidth: false,
                    isFree: true,
                });
                expect(byChannel.map((value: { id: number }) => value.id)).toEqual([403, 401, 402]);

                const byWave = await fixture.programDB.findSchedule({
                    types: ['BS'],
                    startAt: 1_000,
                    endAt: 2_000,
                    isHalfWidth: false,
                });
                expect(byWave.map((value: { id: number }) => value.id)).toEqual([405]);

                // types option と isFree を併用する経路（各 type ごとの検索条件に isFree を積む分岐）。
                const byWaveWithFree = await fixture.programDB.findSchedule({
                    types: ['BS'],
                    startAt: 1_000,
                    endAt: 2_000,
                    isHalfWidth: false,
                    isFree: true,
                });
                expect(byWaveWithFree.map((value: { id: number }) => value.id)).toEqual([405]);

                // channelId も types も指定しない場合は FindScheduleOptionError を投げる。
                await expect(
                    fixture.programDB.findSchedule({ startAt: 1_000, endAt: 2_000, isHalfWidth: false }),
                ).rejects.toThrow('FindScheduleOptionError');

                // 対象時刻に重なる番組が存在しない channel では null を返す。
                await expect(fixture.programDB.findChannelIdAndTime(999, 1_000)).resolves.toBeNull();

                const scheduleApi = new ScheduleApiModel({}, fixture.programDB);
                await expect(scheduleApi.getSchedule(401, false)).resolves.toMatchObject({
                    name: 'synthetic-normal-Ａ',
                    description: 'synthetic-normal-description-Ｂ',
                    extended: 'synthetic-normal-extended-Ｃ',
                    rawExtended: { representation: 'normal-Ｄ' },
                });
                await expect(scheduleApi.getSchedule(401, true)).resolves.toMatchObject({
                    name: 'synthetic-half-A',
                    description: 'synthetic-half-description-B',
                    extended: 'synthetic-half-extended-C',
                    rawExtended: { representation: 'half-D' },
                });

                vi.useFakeTimers();
                vi.setSystemTime(2_000);
                const broadcasting = await fixture.programDB.findBroadcasting({ isHalfWidth: false });
                expect(broadcasting.map((value: { id: number }) => value.id)).toEqual([401, 404, 405, 402]);

                // option.time で基準時刻をずらす経路（現在時刻 2_000 の 500ms 前 = 1_500 時点）。
                const shifted = await fixture.programDB.findBroadcasting({ isHalfWidth: false, time: -500 });
                expect(shifted.map((value: { id: number }) => value.id)).toEqual([401, 404]);
                vi.useRealTimers();
            } finally {
                vi.useRealTimers();
                await fixture.cleanup();
            }
        }
    }, 30_000);

    it('[PG-T2.2] preserves field AND/OR, exclusion, regexp capability, and SQLite fallback differences', async () => {
        for (const dialect of ['sqlite', 'mysql'] as DatabaseDialect[]) {
            const fixture = await createDialectPersistence(dialect);
            try {
                vi.useFakeTimers();
                vi.setSystemTime(1_000);
                await fixture.source.getRepository(fixture.Program).insert([
                    makeProgram({
                        id: 411,
                        channelId: 11,
                        name: 'synthetic-Alpha Beta',
                        halfWidthName: 'Alpha Beta',
                        description: 'synthetic excluded',
                        halfWidthDescription: 'synthetic excluded',
                        startAt: 2_000,
                        endAt: 3_000,
                    }),
                    makeProgram({
                        id: 412,
                        channelId: 11,
                        name: 'synthetic-Alpha X Beta',
                        halfWidthName: 'Alpha X Beta',
                        description: 'synthetic accepted',
                        halfWidthDescription: 'synthetic accepted',
                        startAt: 3_000,
                        endAt: 4_000,
                    }),
                    makeProgram({
                        id: 413,
                        channelId: 11,
                        name: 'synthetic-unrelated',
                        halfWidthName: 'unrelated',
                        description: 'Alpha Beta accepted',
                        halfWidthDescription: 'Alpha Beta accepted',
                        startAt: 4_000,
                        endAt: 5_000,
                    }),
                ]);

                const ordinary = await fixture.programDB.findRule({
                    searchOption: {
                        keyword: 'Alpha Beta',
                        ignoreKeyword: 'excluded',
                        name: true,
                        description: true,
                        ignoreDescription: true,
                        channelIds: [11],
                    },
                });
                expect(ordinary.map((value: { id: number }) => value.id)).toEqual([412, 413]);

                const regexp = await fixture.programDB.findRule({
                    searchOption: {
                        keyword: '^Alpha.*Beta$',
                        keyCS: true,
                        keyRegExp: true,
                        name: true,
                        channelIds: [11],
                    },
                });
                expect(regexp.map((value: { id: number }) => value.id)).toEqual(dialect === 'sqlite' ? [] : [411, 412]);
                vi.useRealTimers();
            } finally {
                vi.useRealTimers();
                await fixture.cleanup();
            }
        }
    }, 30_000);

    it('[PG-T2.2] converts full-width characters of a regexp keyword and matches full-width symbols literally in both dialects', async () => {
        for (const dialect of ['sqlite', 'mysql'] as DatabaseDialect[]) {
            const fixture = await createDialectPersistence(dialect, { sqliteRegexp: true });
            try {
                vi.useFakeTimers();
                vi.setSystemTime(1_000);
                const names = [
                    [801, 'ABC 123'],
                    [802, 'なぜ?'],
                    [803, 'な'],
                    [804, 'なぜ'],
                    [805, '(再)'],
                    [806, '再'],
                    [807, 'a\\b'],
                    [808, 'ab'],
                ] as const;
                await fixture.source.getRepository(fixture.Program).insert(
                    names.map(([id, halfWidthName]) =>
                        makeProgram({
                            id,
                            channelId: 11,
                            name: `synthetic-${halfWidthName}`,
                            halfWidthName,
                            startAt: 2_000 + id,
                            endAt: 3_000 + id,
                        }),
                    ),
                );
                const find = async (searchOption: Record<string, unknown>): Promise<number[]> => {
                    const programs = await fixture.programDB.findRule({
                        searchOption: { keyRegExp: true, name: true, channelIds: [11], ...searchOption },
                    });
                    return programs.map((value: { id: number }) => value.id);
                };

                // Full-width alphanumerics and the full-width space match the half-width name.
                await expect(find({ keyword: 'ＡＢＣ　１２３' })).resolves.toEqual([801]);
                await expect(find({ keyword: '^ＡＢＣ　１２３$', keyCS: true })).resolves.toEqual([801]);
                // A full-width symbol is the character itself, not a regexp symbol.
                await expect(find({ keyword: 'なぜ？' })).resolves.toEqual([802]);
                await expect(find({ keyword: 'なぜ？', keyCS: true })).resolves.toEqual([802]);
                await expect(find({ keyword: '（再）' })).resolves.toEqual([805]);
                await expect(find({ keyword: 'ａ￥ｂ' })).resolves.toEqual([807]);
                // Half-width regexp symbols keep working as regexp symbols.
                await expect(find({ keyword: 'な.' })).resolves.toEqual([802, 804]);
                await expect(find({ keyword: '^な(ぜ)?$' })).resolves.toEqual([803, 804]);
                await expect(find({ keyword: 'a.?b$' })).resolves.toEqual([807, 808]);
                // The exclusion keyword is converted the same way.
                await expect(
                    find({ keyword: 'な.', ignoreKeyword: 'ぜ？', ignoreKeyRegExp: true, ignoreName: true }),
                ).resolves.toEqual([804]);
                vi.useRealTimers();
            } finally {
                vi.useRealTimers();
                await fixture.cleanup();
            }
        }
    }, 30_000);

    it('[PG-T2.3] gives channel IDs precedence over waves, combines structured filters, sorts, and limits', async () => {
        for (const dialect of ['sqlite', 'mysql'] as DatabaseDialect[]) {
            const fixture = await createDialectPersistence(dialect);
            try {
                vi.useFakeTimers();
                vi.setSystemTime(1_000);
                await fixture.source.getRepository(fixture.Program).insert([
                    makeProgram({
                        id: 421,
                        channelId: 21,
                        channelType: 'BS',
                        name: 'synthetic-structured',
                        halfWidthName: 'synthetic structured',
                        genre1: 1,
                        subGenre1: 2,
                        duration: 60_000,
                        isFree: true,
                        startAt: 3_000,
                        endAt: 63_000,
                        startHour: 4,
                        week: 1,
                    }),
                    makeProgram({
                        id: 422,
                        channelId: 21,
                        channelType: 'BS',
                        name: 'synthetic-structured',
                        halfWidthName: 'synthetic structured',
                        genre1: 1,
                        subGenre1: 2,
                        duration: 90_000,
                        isFree: true,
                        startAt: 2_000,
                        endAt: 92_000,
                        startHour: 5,
                        week: 2,
                    }),
                    makeProgram({
                        id: 423,
                        channelId: 22,
                        channelType: 'GR',
                        name: 'synthetic-structured',
                        halfWidthName: 'synthetic structured',
                        genre1: 1,
                        subGenre1: 2,
                        duration: 60_000,
                        isFree: true,
                        startAt: 1_500,
                        endAt: 61_500,
                        startHour: 5,
                        week: 2,
                    }),
                    makeProgram({
                        id: 424,
                        channelId: 21,
                        channelType: 'BS',
                        name: 'synthetic-structured',
                        halfWidthName: 'synthetic structured',
                        genre1: 9,
                        subGenre1: 2,
                        duration: 60_000,
                        isFree: true,
                        startAt: 4_000,
                        endAt: 64_000,
                    }),
                    makeProgram({
                        id: 425,
                        channelId: 21,
                        channelType: 'BS',
                        name: 'synthetic-structured',
                        halfWidthName: 'synthetic structured',
                        genre1: 1,
                        subGenre1: 2,
                        duration: 60_000,
                        isFree: false,
                        startAt: 5_000,
                        endAt: 65_000,
                    }),
                    makeProgram({
                        id: 426,
                        channelId: 21,
                        channelType: 'BS',
                        name: 'synthetic-structured',
                        halfWidthName: 'synthetic structured',
                        genre1: 1,
                        subGenre1: 2,
                        duration: 30_000,
                        isFree: true,
                        startAt: 6_000,
                        endAt: 36_000,
                    }),
                    makeProgram({
                        id: 427,
                        channelId: 21,
                        channelType: 'BS',
                        name: 'synthetic-structured',
                        halfWidthName: 'synthetic structured',
                        genre1: 1,
                        subGenre1: 2,
                        duration: 120_000,
                        isFree: true,
                        startAt: 7_000,
                        endAt: 127_000,
                    }),
                ]);

                const result = await fixture.programDB.findRule({
                    searchOption: {
                        keyword: 'synthetic',
                        name: true,
                        channelIds: [21, 21],
                        GR: true,
                        genres: [{ genre: 1, subGenre: 2 }],
                        isFree: true,
                        durationMin: 60,
                        durationMax: 90,
                        times: [{ week: 0x04, start: 5, range: 1 }],
                        searchPeriods: [{ startAt: 1_900, endAt: 2_100 }],
                    },
                    limit: 1,
                });

                expect(result.map((value: { id: number }) => value.id)).toEqual([422]);

                const byWave = await fixture.programDB.findRule({
                    searchOption: { keyword: 'synthetic', name: true, GR: true },
                });
                expect(byWave.map((value: { id: number }) => value.id)).toEqual([423]);

                const byWaveWithEmptyIds = await fixture.programDB.findRule({
                    searchOption: { keyword: 'synthetic', name: true, channelIds: [], GR: true },
                });
                expect(byWaveWithEmptyIds.map((value: { id: number }) => value.id)).toEqual([423]);

                const byBothWavesWithEmptyIds = await fixture.programDB.findRule({
                    searchOption: { keyword: 'synthetic', name: true, channelIds: [], GR: true, BS: true },
                });
                expect(byBothWavesWithEmptyIds.map((value: { id: number }) => value.id)).toEqual([
                    423, 422, 421, 424, 425, 426, 427,
                ]);

                const byTime = await fixture.programDB.findRule({
                    searchOption: {
                        keyword: 'synthetic',
                        name: true,
                        BS: true,
                        times: [{ week: 0x04, start: 5, range: 1 }],
                    },
                });
                expect(byTime.map((value: { id: number }) => value.id)).toEqual([422]);

                const byPeriod = await fixture.programDB.findRule({
                    searchOption: {
                        keyword: 'synthetic',
                        name: true,
                        BS: true,
                        searchPeriods: [{ startAt: 2_900, endAt: 3_100 }],
                    },
                });
                expect(byPeriod.map((value: { id: number }) => value.id)).toEqual([421]);

                const byGenre = await fixture.programDB.findRule({
                    searchOption: {
                        keyword: 'synthetic',
                        name: true,
                        BS: true,
                        genres: [{ genre: 1, subGenre: 2 }],
                    },
                });
                expect.soft(byGenre.map((value: { id: number }) => value.id)).toEqual([422, 421, 425, 426, 427]);

                const byFree = await fixture.programDB.findRule({
                    searchOption: { keyword: 'synthetic', name: true, BS: true, isFree: true },
                });
                expect.soft(byFree.map((value: { id: number }) => value.id)).toEqual([422, 421, 424, 426, 427]);

                const byDurationMin = await fixture.programDB.findRule({
                    searchOption: { keyword: 'synthetic', name: true, BS: true, durationMin: 60 },
                });
                expect.soft(byDurationMin.map((value: { id: number }) => value.id)).toEqual([422, 421, 424, 425, 427]);

                const byDurationMax = await fixture.programDB.findRule({
                    searchOption: { keyword: 'synthetic', name: true, BS: true, durationMax: 90 },
                });
                expect.soft(byDurationMax.map((value: { id: number }) => value.id)).toEqual([422, 421, 424, 425, 426]);

                const limited = await fixture.programDB.findRule({
                    searchOption: { keyword: 'synthetic', name: true, channelIds: [21] },
                    limit: 2,
                });
                expect.soft(limited.map((value: { id: number }) => value.id)).toEqual([422, 421]);
            } finally {
                vi.useRealTimers();
                await fixture.cleanup();
            }
        }
    }, 30_000);
});
