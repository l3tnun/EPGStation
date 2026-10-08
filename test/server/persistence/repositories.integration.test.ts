import { createRequire } from 'node:module';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { makeProgram, makeRule } from '../fixtures/reservation-rules/runtime';
import { makeReserve } from '../reservation-management/_harness';
import { cleanupInOrder, compiledSnapshot } from './harness';
import { MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS, provisionMySql, type MySqlRuntime } from './mysql-runtime';
import { createRepositoryPersistence, type RepositoryDialect, type RepositoryPersistence } from './repository-harness';

let mysqlRuntime: MySqlRuntime | undefined;
let sqliteRegexpExtension: string;

const require = createRequire(join(process.cwd(), 'package.json'));
const { getLoadablePath } = require('sqlite-regex') as { getLoadablePath(): string };
const { normalizeTunerService } = require(join(compiledSnapshot, 'model', 'tuner', 'TunerServerAccessModel.js')) as {
    normalizeTunerService(value: unknown): Record<string, unknown>;
};

beforeAll(async () => {
    sqliteRegexpExtension = getLoadablePath();
    mysqlRuntime = await provisionMySql();
}, MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS);

afterAll(async () => {
    await cleanupInOrder([async () => mysqlRuntime?.cleanup()]);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const withDialects = async (run: (fixture: RepositoryPersistence, dialect: RepositoryDialect) => Promise<void>) => {
    for (const dialect of ['sqlite', 'mysql'] as const) {
        const fixture = await createRepositoryPersistence(dialect, mysqlRuntime, {
            ...(dialect === 'sqlite' ? { sqliteRegexpExtension } : {}),
        });
        try {
            await run(fixture, dialect);
        } finally {
            await fixture.cleanup();
        }
    }
};

const channel = (id: number, name = `synthetic-channel-${id}`) => ({
    id,
    serviceId: id,
    networkId: 1,
    name,
    remoteControlKeyId: id,
    hasLogoData: false,
    channel: { type: 'GR', channel: `synthetic-${id}` },
    type: 1,
});

const tunerProgram = (id: number, channelId: number, overrides: Record<string, unknown> = {}) => ({
    id,
    eventId: id,
    serviceId: channelId,
    networkId: 1,
    startAt: id * 1_000,
    duration: 1_000,
    isFree: true,
    name: `synthetic-program-${id}`,
    extended: { synthetic: `raw-${id}` },
    ...overrides,
});

const recorded = (overrides: Record<string, unknown> = {}) => ({
    reserveId: null,
    ruleId: null,
    programId: null,
    channelId: 10,
    isProtected: false,
    startAt: 1_000,
    endAt: 2_000,
    duration: 1_000,
    name: 'synthetic-recorded',
    halfWidthName: 'synthetic-recorded',
    description: null,
    halfWidthDescription: null,
    extended: null,
    halfWidthExtended: null,
    rawExtended: null,
    rawHalfWidthExtended: null,
    genre1: null,
    subGenre1: null,
    genre2: null,
    subGenre2: null,
    genre3: null,
    subGenre3: null,
    videoType: null,
    videoResolution: null,
    videoStreamContent: null,
    videoComponentType: null,
    audioSamplingRate: null,
    audioComponentType: null,
    isRecording: false,
    dropLogFileId: null,
    ...overrides,
});

describe('repository contracts through real SQLite and MySQL drivers', () => {
    it('[PERSIST-2.1] characterizes channel/program CRUD, time search, ordering, empty values, and raw text', async () => {
        await withDialects(async ({ db }, dialect) => {
            await db.ChannelDB.insert([channel(12), channel(11)]);
            await expect(db.ChannelDB.findId(404)).resolves.toBeNull();
            expect((await db.ChannelDB.findAll()).map((row: { id: number }) => Number(row.id))).toEqual([11, 12]);

            await db.ChannelDB.update({ insert: [], update: [channel(11, 'synthetic-updated')] });
            await expect(db.ChannelDB.findId(11)).resolves.toMatchObject({ name: 'synthetic-updated' });
            await db.ChannelDB.insert([channel(11, 'synthetic-replaced')]);
            await expect(db.ChannelDB.findId(12)).resolves.toBeNull();
            await expect(db.ChannelDB.findChannleTypes(['GR'], true)).resolves.toMatchObject([
                { id: 11, name: 'synthetic-replaced' },
            ]);

            const index = { 1: { 11: { id: 11, type: 'GR', channel: 'synthetic-11' } } };
            await db.ProgramDB.insert(index, [tunerProgram(101, 11), tunerProgram(102, 11)], [11]);
            await expect(db.ProgramDB.findId(404)).resolves.toBeNull();
            await expect(db.ProgramDB.findChannelIdAndTime(11, 101_000)).resolves.toMatchObject({ id: 101 });
            const schedule = await db.ProgramDB.findSchedule({
                channelId: 11,
                startAt: 100_000,
                endAt: 103_000,
                isHalfWidth: false,
            });
            expect(schedule.map((row: { id: number }) => Number(row.id))).toEqual([101, 102]);
            expect(schedule[0].rawExtended).toBe(JSON.stringify({ synthetic: 'raw-101' }));
            await db.ProgramDB.deleteOld(102_001);
            expect((await db.ProgramDB.findAll()).map((row: { id: number }) => Number(row.id))).toEqual([102]);
            expect(dialect).toMatch(/^(sqlite|mysql)$/u);
        });
    });

    it('[PERSIST-2.1-CHANNEL-INSERT-GUARD] insert() abandons the whole batch when one service has no receivable channel', async () => {
        await withDialects(async ({ db }) => {
            await db.ChannelDB.insert([channel(21)]);
            await expect(db.ChannelDB.findId(21)).resolves.not.toBeNull();

            const withoutChannel = { ...channel(22), channel: undefined } as unknown as ReturnType<typeof channel>;
            await db.ChannelDB.insert([withoutChannel, channel(23)], false);

            // ChannelDB.insert's per-service guard (ChannelDB.ts:46-48) `return`s out of the whole
            // method instead of `continue`ing its loop, so one channel-less service in the batch means
            // neither it nor any later service in that same call is written, and (needesDeleted=false)
            // channel 21 from the earlier call is left untouched.
            await expect(db.ChannelDB.findId(23)).resolves.toBeNull();
            await expect(db.ChannelDB.findId(21)).resolves.not.toBeNull();
        });
    });

    // .kiro/specs/server-tuner-access/design.md's正規化規則: チューナーサーバーがGR/BS/CS/SKY以外の
    // channel.type（mirakcのBS4K、Mirakurunがchannels.ymlに書かれた任意の文字列をそのまま返す場合）を
    // 返しても、TunerServerAccessModel.getServices()相当のnormalizeTunerServiceはservice配列全体を
    // 解析失敗にしない。ここではその正規化済みTunerService[]をChannelDB.insert()へそのまま渡し、
    // v2のChannelDB（getChannelTypeIdのdefault: return 4）と同じく未知種別をchannelTypeId 4・
    // channelType文字列そのままで全件保存することを確認する。既知5種（GR/BS/CS/SKY/BS4K）の
    // channelTypeIdは従来どおり0/1/2/3/5。BS4Kは既知種別のため、ここでは別の任意文字列（'CATV'）を
    // 未知種別の例として使う（BS4K自体は[PERSIST-2.1-CHANNEL-BS4K-TYPE]で確認する）。
    it('[PERSIST-2.1-CHANNEL-UNKNOWN-TYPE] persists services with an unknown channel.type (any string outside GR/BS/CS/SKY/BS4K) as channelTypeId 4 alongside known services', async () => {
        await withDialects(async ({ db }) => {
            const rawServices = [
                {
                    id: 31,
                    serviceId: 31,
                    networkId: 1,
                    name: 'synthetic-gr',
                    type: 1,
                    channel: { type: 'GR', channel: 'gr-31' },
                },
                {
                    id: 32,
                    serviceId: 32,
                    networkId: 1,
                    name: 'synthetic-bs',
                    type: 1,
                    channel: { type: 'BS', channel: 'bs-32' },
                },
                {
                    id: 33,
                    serviceId: 33,
                    networkId: 1,
                    name: 'synthetic-cs',
                    type: 1,
                    channel: { type: 'CS', channel: 'cs-33' },
                },
                {
                    id: 34,
                    serviceId: 34,
                    networkId: 1,
                    name: 'synthetic-sky',
                    type: 1,
                    channel: { type: 'SKY', channel: 'sky-34' },
                },
                {
                    id: 35,
                    serviceId: 35,
                    networkId: 1,
                    name: 'synthetic-catv',
                    type: 1,
                    channel: { type: 'CATV', channel: 'catv-35' },
                },
                {
                    id: 36,
                    serviceId: 36,
                    networkId: 1,
                    name: 'synthetic-arbitrary',
                    type: 1,
                    channel: { type: 'WOWOW-4K', channel: 'arb-36' },
                },
            ];
            const normalized = rawServices.map(service => normalizeTunerService(service));

            await db.ChannelDB.insert(normalized);

            await expect(db.ChannelDB.findId(31)).resolves.toMatchObject({ channelType: 'GR', channelTypeId: 0 });
            await expect(db.ChannelDB.findId(32)).resolves.toMatchObject({ channelType: 'BS', channelTypeId: 1 });
            await expect(db.ChannelDB.findId(33)).resolves.toMatchObject({ channelType: 'CS', channelTypeId: 2 });
            await expect(db.ChannelDB.findId(34)).resolves.toMatchObject({ channelType: 'SKY', channelTypeId: 3 });
            await expect(db.ChannelDB.findId(35)).resolves.toMatchObject({ channelType: 'CATV', channelTypeId: 4 });
            await expect(db.ChannelDB.findId(36)).resolves.toMatchObject({
                channelType: 'WOWOW-4K',
                channelTypeId: 4,
            });
        });
    });

    // BS4Kは`BroadcastType`の既知5値目であり、GR/BS/CS/SKYと対等に自分専用のchannelTypeId（5）を持つ
    // ことを確認する（`ChannelDB.getChannelTypeId`のcase 'BS4K'）。既存の4種のchannelTypeId(0-3)や
    // 未知種別のchannelTypeId(4)とは重複しない。
    it('[PERSIST-2.1-CHANNEL-BS4K-TYPE] persists a BS4K service as channelTypeId 5, distinct from the other known types and from unknown types', async () => {
        await withDialects(async ({ db }) => {
            const rawServices = [
                {
                    id: 41,
                    serviceId: 41,
                    networkId: 1,
                    name: 'synthetic-bs4k',
                    type: 1,
                    channel: { type: 'BS4K', channel: 'bs4k-41' },
                },
            ];
            const normalized = rawServices.map(service => normalizeTunerService(service));

            await db.ChannelDB.insert(normalized);

            await expect(db.ChannelDB.findId(41)).resolves.toMatchObject({ channelType: 'BS4K', channelTypeId: 5 });
        });
    });

    it('[PERSIST-2.2] characterizes reserve/rule CRUD, pagination, enable state, JSON round-trip, and corrupt JSON', async () => {
        await withDialects(async ({ db, entities, source }) => {
            const firstId = await db.ReserveDB.insertOnce(makeReserve({ id: undefined, ruleId: 3, startAt: 20 }));
            await db.ReserveDB.insertOnce(makeReserve({ id: undefined, ruleId: 4, startAt: 10, isConflict: true }));
            await db.ReserveDB.updateOnce(makeReserve({ id: firstId, ruleId: 3, startAt: 30, isSkip: true }));
            const [reserves, reserveCount] = await db.ReserveDB.findAll({ offset: 0, limit: 1, isHalfWidth: false });
            expect(reserves).toHaveLength(1);
            expect(reserveCount).toBe(2);
            await db.ReserveDB.updateMany({ delete: [makeReserve({ id: firstId })] });
            await expect(db.ReserveDB.findId(firstId)).resolves.toBeNull();
            await expect(
                db.ReserveDB.findTimeSpecification({ channelId: 999, startAt: 999, endAt: 999 }),
            ).resolves.toBeNull();

            const ruleId = await db.RuleDB.insertOnce(
                makeRule({
                    id: undefined,
                    searchOption: {
                        keyword: 'synthetic',
                        name: true,
                        channelIds: [11, 12],
                        genres: [{ genre: 1, subGenre: 2 }],
                        times: [{ week: 1, start: 10, range: 20 }],
                        searchPeriods: [{ startAt: 100, endAt: 200 }],
                    },
                    reserveOption: { enable: true, allowEndLack: false, avoidDuplicate: false, tags: [7] },
                }),
            );
            await expect(db.RuleDB.findId(ruleId)).resolves.toMatchObject({
                searchOption: { channelIds: [11, 12], genres: [{ genre: 1, subGenre: 2 }] },
                reserveOption: { enable: true, tags: [7] },
            });
            await db.RuleDB.disableOnce(ruleId);
            await expect(db.RuleDB.findId(ruleId)).resolves.toMatchObject({ reserveOption: { enable: false } });
            await db.RuleDB.enableOnce(ruleId);
            const currentRule = await db.RuleDB.findId(ruleId);
            await db.RuleDB.updateOnce({
                ...currentRule,
                id: ruleId,
                searchOption: { ...currentRule.searchOption, keyword: 'synthetic-updated' },
            });
            await db.RuleDB.insertOnce(makeRule({ id: undefined, searchOption: { keyword: 'unrelated', name: true } }));
            const [rules, ruleCount] = await db.RuleDB.findAll(
                { keyword: 'synthetic-updated', offset: 0, limit: 1 },
                true,
            );
            expect(rules).toMatchObject([
                { id: ruleId, searchOption: { keyword: 'synthetic-updated' }, reserveOption: { enable: true } },
            ]);
            expect(ruleCount).toBe(1);
            await expect(db.RuleDB.findKeyword({ keyword: 'synthetic-updated' })).resolves.toEqual([
                { id: ruleId, keyword: 'synthetic-updated' },
            ]);
            await source.getRepository(entities.Rule).update(ruleId, { channelIds: '{broken-json' });
            await expect(db.RuleDB.findId(ruleId)).rejects.toBeInstanceOf(SyntaxError);
            await db.RuleDB.deleteOnce(ruleId);
            await expect(db.RuleDB.findId(ruleId)).resolves.toBeNull();
        });
    });

    // GR/BS/CS/SKYと対等な5つ目の対象種別としてBS4Kを保存・復元できることを確認する
    // （RuleDB.convertRuleToDBRule/convertDBRuleToRuleのBS4K経路）。既定は false で、
    // 指定しなかった場合も false として保存・復元される（既存の4種別と同じ扱い）。
    it('[PERSIST-2.2-RULE-BS4K] persists and restores a rule search option BS4K flag, defaulting to false when unspecified', async () => {
        await withDialects(async ({ db }) => {
            const bs4kRuleId = await db.RuleDB.insertOnce(
                makeRule({
                    id: undefined,
                    searchOption: { keyword: 'synthetic-bs4k', name: true, GR: false, BS4K: true },
                }),
            );
            await expect(db.RuleDB.findId(bs4kRuleId)).resolves.toMatchObject({
                searchOption: { GR: false, BS4K: true },
            });

            const unspecifiedRuleId = await db.RuleDB.insertOnce(
                makeRule({ id: undefined, searchOption: { keyword: 'synthetic-no-bs4k', name: true } }),
            );
            await expect(db.RuleDB.findId(unspecifiedRuleId)).resolves.toMatchObject({
                searchOption: { BS4K: false },
            });
        });
    });

    it('[PERSIST-2.3] characterizes recorded/history CRUD, filters, totals, empty IDs, and selective relations', async () => {
        await withDialects(async ({ db }) => {
            const firstId = await db.RecordedDB.insertOnce(
                recorded({ reserveId: 31, channelId: 7, genre1: 1, startAt: 100, name: 'synthetic-first' }),
            );
            const secondId = await db.RecordedDB.insertOnce(
                recorded({ reserveId: 32, channelId: 8, genre1: 2, startAt: 200, name: 'synthetic-second' }),
            );
            await db.RecordedDB.changeProtect(firstId, true);
            await expect(db.RecordedDB.findId(firstId)).resolves.toMatchObject({ isProtected: true });
            const [rows, count] = await db.RecordedDB.findAll(
                { channelId: 7, offset: 0, limit: 10, isHalfWidth: false },
                { isNeedVideoFiles: false, isNeedThumbnails: false, isNeedsDropLog: false, isNeedTags: false },
            );
            expect(rows.map((row: { id: number }) => row.id)).toEqual([firstId]);
            expect(count).toBe(1);
            await expect(db.RecordedDB.findIds([], {})).resolves.toEqual([]);
            const dropLogFileId = await db.DropLogFileDB.insertOnce({
                errorCnt: 1,
                dropCnt: 2,
                scramblingCnt: 3,
                filePath: 'synthetic-drop-log',
            });
            await db.RecordedDB.updateOnce(
                recorded({ id: firstId, reserveId: 31, channelId: 7, genre1: 1, startAt: 100, dropLogFileId }),
            );
            await db.VideoFileDB.insertOnce({
                parentDirectoryName: 'synthetic',
                filePath: 'synthetic-video',
                type: 'ts',
                name: 'synthetic-video',
                size: 10,
                recordedId: firstId,
            });
            await db.ThumbnailDB.insertOnce({ filePath: 'synthetic-thumbnail', recordedId: firstId });
            const tagId = await db.RecordedTagDB.insertOnce({
                name: 'synthetic-relation',
                halfWidthName: 'synthetic-relation',
                color: '#123456',
            });
            await db.RecordedTagDB.setRelation(tagId, firstId);
            const related = await db.RecordedDB.findIds([secondId, firstId], {
                isNeedVideoFiles: true,
                isNeedThumbnails: true,
                isNeedsDropLog: true,
                isNeedTags: true,
            });
            expect(related.map((row: { id: number }) => row.id)).toEqual([secondId, firstId]);
            expect(related[0]).toMatchObject({ videoFiles: [], thumbnails: [], dropLogFile: null, tags: [] });
            expect(related[1]).toMatchObject({
                videoFiles: [{ recordedId: firstId }],
                thumbnails: [{ recordedId: firstId }],
                dropLogFile: { id: dropLogFileId },
                tags: [{ id: tagId }],
            });
            const unrelated = await db.RecordedDB.findIds([firstId], {
                isNeedVideoFiles: false,
                isNeedThumbnails: false,
                isNeedsDropLog: false,
                isNeedTags: false,
            });
            expect(unrelated[0].videoFiles).toBeUndefined();
            expect(unrelated[0].thumbnails).toBeUndefined();
            expect(unrelated[0].dropLogFile).toBeUndefined();
            expect(unrelated[0].tags).toBeUndefined();
            const reversedById = await db.RecordedDB.findIds([secondId, firstId], {}, true);
            expect(reversedById.map((row: { id: number }) => row.id)).toEqual([firstId, secondId]);
            await expect(db.RecordedDB.findReserveId(32)).resolves.toMatchObject([{ id: secondId }]);
            await db.RecordedDB.deleteOnce(secondId);
            await expect(db.RecordedDB.findId(secondId)).resolves.toBeNull();

            const oldId = await db.RecordedHistoryDB.insertOnce({ name: 'old', channelId: 7, endAt: 100 });
            await db.RecordedHistoryDB.insertOnce({ name: 'new', channelId: 7, endAt: 200 });
            await db.RecordedHistoryDB.delete(150);
            expect((await db.RecordedHistoryDB.findAll()).map((row: { id: number }) => row.id)).not.toContain(oldId);
        });
    });

    it('[PERSIST-2.3] finds reverse-ordered recorded rows with tag relations in one findAll', async () => {
        await withDialects(async ({ db }) => {
            // Insert later startAt first so generated recorded.id order is anti-correlated
            // with expected startAt ASC order ([earlierId, laterId]).
            const laterId = await db.RecordedDB.insertOnce(
                recorded({
                    reserveId: 42,
                    channelId: 21,
                    startAt: 300,
                    endAt: 400,
                    name: 'reverse-later',
                    halfWidthName: 'reverse-later',
                }),
            );
            const earlierId = await db.RecordedDB.insertOnce(
                recorded({
                    reserveId: 41,
                    channelId: 21,
                    startAt: 100,
                    endAt: 200,
                    name: 'reverse-earlier',
                    halfWidthName: 'reverse-earlier',
                }),
            );
            const earlierTagId = await db.RecordedTagDB.insertOnce({
                name: 'reverse-tag-earlier',
                halfWidthName: 'reverse-tag-earlier',
                color: '#aaaaaa',
            });
            const laterTagId = await db.RecordedTagDB.insertOnce({
                name: 'reverse-tag-later',
                halfWidthName: 'reverse-tag-later',
                color: '#bbbbbb',
            });
            await db.RecordedTagDB.setRelation(earlierTagId, earlierId);
            await db.RecordedTagDB.setRelation(laterTagId, laterId);

            const [items, total] = await db.RecordedDB.findAll(
                {
                    channelId: 21,
                    offset: 0,
                    limit: 10,
                    isHalfWidth: false,
                    isReverse: true,
                    hasOriginalFile: false,
                },
                {
                    isNeedVideoFiles: false,
                    isNeedThumbnails: false,
                    isNeedsDropLog: false,
                    isNeedTags: true,
                },
            );

            expect(total).toBe(2);
            expect(items.map((row: { id: number }) => row.id)).toEqual([earlierId, laterId]);
            expect(items[0]).toMatchObject({
                id: earlierId,
                tags: [{ id: earlierTagId }],
            });
            expect(items[1]).toMatchObject({
                id: laterId,
                tags: [{ id: laterTagId }],
            });
            expect(items[0].videoFiles).toBeUndefined();
            expect(items[0].thumbnails).toBeUndefined();
            expect(items[0].dropLogFile).toBeUndefined();
        });
    });

    it('[PERSIST-2.4] characterizes file metadata CRUD and proves zero filesystem side effects', async () => {
        await withDialects(async ({ db }) => {
            const directory = await mkdtemp(join(tmpdir(), 'epgstation-persistence-marker-'));
            const marker = join(directory, 'synthetic-media-marker');
            await writeFile(marker, 'unchanged', 'utf8');
            try {
                const recordedId = await db.RecordedDB.insertOnce(recorded());
                const videoId = await db.VideoFileDB.insertOnce({
                    parentDirectoryName: 'synthetic-parent',
                    filePath: marker,
                    type: 'ts',
                    name: 'synthetic-video',
                    size: 10,
                    recordedId,
                });
                const dropId = await db.DropLogFileDB.insertOnce({
                    errorCnt: 1,
                    dropCnt: 2,
                    scramblingCnt: 3,
                    filePath: marker,
                });
                const thumbnailId = await db.ThumbnailDB.insertOnce({ filePath: marker, recordedId });
                await db.VideoFileDB.updateSize(videoId, 99);
                await db.VideoFileDB.updateFilePath({
                    videoFileId: videoId,
                    parentDirectoryName: 'synthetic-updated-parent',
                    filePath: marker,
                });
                await db.DropLogFileDB.updateCnt({ id: dropId, errorCnt: 4, dropCnt: 5, scramblingCnt: 6 });
                await expect(db.VideoFileDB.findId(videoId)).resolves.toMatchObject({
                    size: 99,
                    filePath: marker,
                    parentDirectoryName: 'synthetic-updated-parent',
                });
                await expect(db.DropLogFileDB.findId(dropId)).resolves.toMatchObject({ dropCnt: 5 });
                await expect(db.ThumbnailDB.findId(thumbnailId)).resolves.toMatchObject({ recordedId });
                expect(await readFile(marker, 'utf8')).toBe('unchanged');
                const bulkVideoId = await db.VideoFileDB.insertOnce({
                    parentDirectoryName: 'synthetic-parent',
                    filePath: marker,
                    type: 'encoded',
                    name: 'synthetic-bulk-video',
                    size: 1,
                    recordedId,
                });
                const bulkThumbnailId = await db.ThumbnailDB.insertOnce({ filePath: marker, recordedId });
                await db.VideoFileDB.deleteOnce(videoId);
                await db.ThumbnailDB.deleteOnce(thumbnailId);
                await expect(db.VideoFileDB.findId(videoId)).resolves.toBeNull();
                await expect(db.ThumbnailDB.findId(thumbnailId)).resolves.toBeNull();
                await db.VideoFileDB.deleteRecordedId(recordedId);
                await db.ThumbnailDB.deleteRecordedId(recordedId);
                await expect(db.VideoFileDB.findId(bulkVideoId)).resolves.toBeNull();
                await expect(db.ThumbnailDB.findId(bulkThumbnailId)).resolves.toBeNull();
                await db.DropLogFileDB.deleteOnce(dropId);
                await expect(access(marker)).resolves.toBeUndefined();
                await expect(db.VideoFileDB.findAll()).resolves.toEqual([]);
                await expect(db.ThumbnailDB.findAll()).resolves.toEqual([]);
                await expect(db.DropLogFileDB.findAll()).resolves.toEqual([]);
            } finally {
                await rm(directory, { force: true, recursive: true });
            }
        });
    });

    it('[PERSIST-2.5] characterizes tag CRUD, pagination, relation isolation, removal, and empty results', async () => {
        await withDialects(async ({ db }) => {
            const firstRecorded = await db.RecordedDB.insertOnce(recorded({ name: 'first' }));
            const secondRecorded = await db.RecordedDB.insertOnce(recorded({ name: 'second' }));
            const firstTag = await db.RecordedTagDB.insertOnce({
                name: 'tag-a',
                halfWidthName: 'tag-a',
                color: '#111111',
            });
            const secondTag = await db.RecordedTagDB.insertOnce({
                name: 'tag-b',
                halfWidthName: 'tag-b',
                color: '#222222',
            });
            await db.RecordedTagDB.setRelation(firstTag, firstRecorded);
            await db.RecordedTagDB.setRelation(secondTag, secondRecorded);
            await db.RecordedTagDB.updateOnce(firstTag, 'tag-a-updated', '#333333');
            const [page, count] = await db.RecordedTagDB.findAll({ offset: 0, limit: 1 });
            expect(page).toHaveLength(1);
            expect(count).toBe(2);
            await expect(db.RecordedDB.findId(firstRecorded)).resolves.toMatchObject({
                tags: [{ id: firstTag, name: 'tag-a-updated' }],
            });
            await expect(db.RecordedDB.findId(secondRecorded)).resolves.toMatchObject({ tags: [{ id: secondTag }] });
            await db.RecordedTagDB.deleteRelation(firstTag, firstRecorded);
            await expect(db.RecordedDB.findId(firstRecorded)).resolves.toMatchObject({ tags: [] });
            await expect(db.RecordedDB.findId(secondRecorded)).resolves.toMatchObject({ tags: [{ id: secondTag }] });
            await db.RecordedTagDB.deleteOnce(firstTag);
            await expect(db.RecordedTagDB.findId(firstTag)).resolves.toBeNull();
        });
    });

    it('[PERSIST-2.6] preserves backend-specific LIKE, binary LIKE, regexp, and boolean results', async () => {
        await withDialects(async ({ db, entities, source }, dialect) => {
            vi.useFakeTimers();
            vi.setSystemTime(1_000);
            await source.getRepository(entities.Program).insert([
                makeProgram({
                    id: 701,
                    name: 'Alpha Beta',
                    halfWidthName: 'Alpha Beta',
                    startAt: 2_000,
                    endAt: 3_000,
                }),
                makeProgram({
                    id: 702,
                    name: 'alpha beta',
                    halfWidthName: 'alpha beta',
                    startAt: 3_000,
                    endAt: 4_000,
                }),
                makeProgram({
                    id: 703,
                    name: 'Alpha X Beta',
                    halfWidthName: 'Alpha X Beta',
                    startAt: 4_000,
                    endAt: 5_000,
                }),
            ]);
            const truthTable = [
                { keyCS: false, keyRegExp: false, expected: [701, 702, 703] },
                { keyCS: true, keyRegExp: false, expected: dialect === 'mysql' ? [701, 703] : [701, 702, 703] },
                { keyCS: false, keyRegExp: true, expected: dialect === 'mysql' ? [701, 702, 703] : [701, 703] },
                { keyCS: true, keyRegExp: true, expected: [701, 703] },
            ];
            for (const cell of truthTable) {
                const keyword = cell.keyRegExp ? '^Alpha.*Beta$' : 'Alpha Beta';
                const result = await db.ProgramDB.findRule({
                    searchOption: {
                        keyword,
                        keyCS: cell.keyCS,
                        keyRegExp: cell.keyRegExp,
                        name: true,
                        channelIds: [101],
                    },
                });
                expect(result.map((row: { id: number }) => Number(row.id))).toEqual(cell.expected);
            }
            const booleans = await source.getRepository(entities.Program).find({ order: { id: 'ASC' } });
            expect(booleans.map(row => row.isFree)).toEqual([true, true, true]);
            vi.useRealTimers();
        });
    });
});

// The container is removed here, in a test of its own with the budget its provisioning has, rather than in
// `afterAll`: the Docker daemon answers `docker rm --force` late while it is busy (an image export holds
// it for tens of seconds), and a hook only has Vitest's default 10 s. The `afterAll` above confirms the
// container is gone and removes it itself only when this test did not run (a filtered or aborted file).
it(
    'releases the isolated MySQL fixture container after every case of the file',
    async () => {
        await mysqlRuntime?.cleanup();
    },
    MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS,
);
