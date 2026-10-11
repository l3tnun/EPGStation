import { createRequire } from 'node:module';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeProgram } from '../fixtures/reservation-rules/runtime';
import { makeReserve } from '../reservation-management/_harness';
import { cleanupInOrder } from './harness';
import {
    MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS,
    provisionMariaDb,
    provisionMySql,
    type MySqlRuntime,
} from './mysql-runtime';
import { createRepositoryPersistence, type RepositoryDialect, type RepositoryPersistence } from './repository-harness';

/*
 * ProgramDB.findRule・RecordedDB.findAll・ReserveDB の検索条件が、条件ごとに行を過不足なく絞り込むことを、
 * 実 DB の SQLite・MySQL 9.7・MariaDB 12.3 で確かめる。MariaDB は operator の mysql の分岐を通る。
 */

const require = createRequire(join(process.cwd(), 'package.json'));
const { getLoadablePath } = require('sqlite-regex') as { getLoadablePath(): string };

let mysqlRuntime: MySqlRuntime | undefined;
let mariaDbRuntime: MySqlRuntime | undefined;
let sqliteRegexpExtension: string;

beforeAll(async () => {
    sqliteRegexpExtension = getLoadablePath();
    [mysqlRuntime, mariaDbRuntime] = await Promise.all([provisionMySql(), provisionMariaDb()]);
}, MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS);

afterAll(async () => {
    await cleanupInOrder([async () => mysqlRuntime?.cleanup(), async () => mariaDbRuntime?.cleanup()]);
});

const withDialects = async (run: (fixture: RepositoryPersistence, dialect: RepositoryDialect) => Promise<void>) => {
    const targets = [
        { label: 'sqlite', dialect: 'sqlite', runtime: undefined },
        { label: 'mysql', dialect: 'mysql', runtime: mysqlRuntime },
        { label: 'mariadb', dialect: 'mysql', runtime: mariaDbRuntime },
    ] as const;
    for (const { label, dialect, runtime } of targets) {
        const fixture = await createRepositoryPersistence(dialect, runtime, {
            ...(dialect === 'sqlite' ? { sqliteRegexpExtension } : {}),
        });
        try {
            await run(fixture, dialect);
        } catch (error) {
            if (error instanceof Error) {
                error.message = `[${label}] ${error.message}`;
            }
            throw error;
        } finally {
            await fixture.cleanup();
        }
    }
};

const ids = (rows: Array<{ id: number }>): number[] => rows.map(row => Number(row.id));

// ---------------------------------------------------------------------------------------------
// ProgramDB.findRule
// ---------------------------------------------------------------------------------------------

const FUTURE = 1_900_000_000_000;
const HOUR = 60 * 60 * 1000;

/**
 * 801 Alpha Show   : GR 101 無料 60 秒   月 9 時   genre 1/2
 * 802 Beta Show    : BS 102 有料 120 秒  火 10 時  genre 3
 * 803 Gamma        : GR 101 無料 180 秒  月 10 時  genre 9 と、2 つ目に 1/5
 */
const seedPrograms = async ({ entities, source }: RepositoryPersistence) => {
    await source.getRepository(entities.Program).insert([
        makeProgram({
            id: 803,
            name: 'Gamma',
            halfWidthName: 'Gamma',
            shortName: 'Gamma',
            description: null,
            halfWidthDescription: null,
            extended: 'cats and mice',
            halfWidthExtended: 'cats and mice',
            channelId: 101,
            channelType: 'GR',
            startAt: FUTURE + 3 * HOUR,
            endAt: FUTURE + 3 * HOUR + 180_000,
            duration: 180_000,
            isFree: true,
            week: 1,
            startHour: 10,
            genre1: 9,
            subGenre1: 0,
            genre2: 1,
            subGenre2: 5,
        }),
        makeProgram({
            id: 802,
            name: 'Beta Show',
            halfWidthName: 'Beta Show',
            shortName: 'Beta Show',
            description: 'about dogs',
            halfWidthDescription: 'about dogs',
            channelId: 102,
            channelType: 'BS',
            startAt: FUTURE + 2 * HOUR,
            endAt: FUTURE + 2 * HOUR + 120_000,
            duration: 120_000,
            isFree: false,
            week: 2,
            startHour: 10,
            genre1: 3,
            subGenre1: 0,
        }),
        makeProgram({
            id: 801,
            name: 'Alpha Show',
            halfWidthName: 'Alpha Show',
            shortName: 'Alpha Show',
            description: 'about cats',
            halfWidthDescription: 'about cats',
            extended: 'mouse',
            halfWidthExtended: 'mouse',
            channelId: 101,
            channelType: 'GR',
            startAt: FUTURE + HOUR,
            endAt: FUTURE + HOUR + 60_000,
            duration: 60_000,
            isFree: true,
            week: 1,
            startHour: 9,
            genre1: 1,
            subGenre1: 2,
        }),
        makeProgram({
            id: 800,
            name: 'Past Show',
            halfWidthName: 'Past Show',
            shortName: 'Past Show',
            channelId: 101,
            channelType: 'GR',
            startAt: 1_000,
            endAt: 2_000,
            duration: 1_000,
            week: 1,
            startHour: 9,
        }),
    ]);
};

const allTypes = { GR: true, BS: true, CS: true, SKY: true, BS4K: true };

const find = (fixture: RepositoryPersistence, searchOption: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    fixture.db.ProgramDB.findRule({ searchOption, ...extra });

describe('ProgramDB.findRule narrows programs by each search condition through real drivers', () => {
    it('[PERSIST-2.6-FIND-RULE-KEYWORD] searches name, description and extended separately, ANDs the words, and excludes the ignore keyword', async () => {
        await withDialects(async fixture => {
            await seedPrograms(fixture);
            const keyword = (value: string, flags: Record<string, unknown>, more: Record<string, unknown> = {}) =>
                find(fixture, { keyword: value, ...allTypes, ...flags, ...more });

            // 大文字小文字を区別しない（cs なし）。過去の番組は対象外。
            expect(ids(await keyword('SHOW', { name: true }))).toEqual([801, 802]);
            expect(ids(await keyword('about', { description: true }))).toEqual([801, 802]);
            expect(ids(await keyword('about', { name: true }))).toEqual([]);
            expect(ids(await keyword('mice', { extended: true }))).toEqual([803]);
            expect(ids(await keyword('mice', { name: true, description: true }))).toEqual([]);
            expect(ids(await keyword('cats', { description: true, extended: true }))).toEqual([801, 803]);
            expect(ids(await keyword('cats', { name: true, extended: true }))).toEqual([803]);
            // 対象に指定していない項目は見ない（語が別の項目にしか無いとき）。
            expect(ids(await keyword('show', { description: true }))).toEqual([]);
            expect(ids(await keyword('show', { extended: true }))).toEqual([]);
            expect(ids(await keyword('show', { description: true, extended: true }))).toEqual([]);
            expect(ids(await keyword('about', { extended: true }))).toEqual([]);
            expect(ids(await keyword('mouse', { description: true }))).toEqual([]);
            // 複数語は AND
            expect(ids(await keyword('alpha show', { name: true }))).toEqual([801]);
            expect(ids(await keyword('alpha beta', { name: true }))).toEqual([]);
            // name・description・extended のどれにも当たらないものは、いずれかの対象を OR で見る。
            expect(ids(await keyword('dogs cats', { name: true, description: true }))).toEqual([]);
            // 除外キーワード
            expect(
                ids(await keyword('show', { name: true }, { ignoreKeyword: 'beta', ignoreName: true })),
            ).toEqual([801]);
            expect(
                ids(await keyword('show', { name: true }, { ignoreKeyword: 'cats', ignoreDescription: true })),
            ).toEqual([802]);
            expect(
                ids(await keyword('show', { name: true }, { ignoreKeyword: 'mouse', ignoreExtended: true })),
            ).toEqual([802]);
        });
    });

    it('[PERSIST-2.6-FIND-RULE-REGEXP] matches a regular expression against only the chosen items, with case sensitivity where the backend supports it', async () => {
        await withDialects(async (fixture, dialect) => {
            await seedPrograms(fixture);
            const regexp = (value: string, flags: Record<string, unknown>, more: Record<string, unknown> = {}) =>
                find(fixture, { keyword: value, keyRegExp: true, ...allTypes, ...flags, ...more });

            expect(ids(await regexp('^Alpha', { name: true }))).toEqual([801]);
            expect(ids(await regexp('Show$', { name: true }))).toEqual([801, 802]);
            expect(ids(await regexp('^about (cats|dogs)$', { description: true }))).toEqual([801, 802]);
            expect(ids(await regexp('mice$', { extended: true }))).toEqual([803]);
            expect(ids(await regexp('^about', { name: true, extended: true }))).toEqual([]);
            expect(ids(await regexp('^about', { name: true, description: true }))).toEqual([801, 802]);
            // 対象に指定していない項目は見ない。
            expect(ids(await regexp('Show$', { description: true }))).toEqual([]);
            expect(ids(await regexp('Show$', { extended: true }))).toEqual([]);
            expect(ids(await regexp('^about', { extended: true }))).toEqual([]);
            expect(ids(await regexp('mice$', { name: true }))).toEqual([]);
            // 大文字小文字を区別する指定は、どの backend でも区別する。区別しない指定は MySQL 系だけが区別しない
            // （SQLite の regexp 拡張は常に区別する）。
            expect(ids(await regexp('^alpha|^beta', { name: true, keyCS: true }))).toEqual([]);
            expect(ids(await regexp('^Alpha|^Beta', { name: true, keyCS: true }))).toEqual([801, 802]);
            expect(ids(await regexp('^ABOUT', { description: true, keyCS: true }))).toEqual([]);
            expect(ids(await regexp('MICE$', { extended: true, keyCS: true }))).toEqual([]);
            expect(ids(await regexp('^alpha', { name: true }))).toEqual(dialect === 'mysql' ? [801] : []);
            // 大文字小文字を区別する指定でも、対象に指定していない項目は見ない。
            expect(ids(await regexp('Show$', { description: true, keyCS: true }))).toEqual([]);
            expect(ids(await regexp('^about', { name: true, keyCS: true }))).toEqual([]);
            expect(ids(await regexp('mice$', { name: true, keyCS: true }))).toEqual([]);
            expect(ids(await regexp('mice$', { description: true, keyCS: true }))).toEqual([]);
            expect(ids(await regexp('^about (cats|dogs)$', { description: true, keyCS: true }))).toEqual([801, 802]);
            expect(ids(await regexp('mice$', { extended: true, keyCS: true }))).toEqual([803]);
            // 除外の正規表現
            expect(
                ids(await regexp('Show$', { name: true }, { ignoreKeyword: '^Beta', ignoreKeyRegExp: true, ignoreName: true })),
            ).toEqual([801]);
            expect(
                ids(
                    await regexp(
                        'Show$',
                        { name: true },
                        { ignoreKeyword: 'dogs$', ignoreKeyRegExp: true, ignoreDescription: true },
                    ),
                ),
            ).toEqual([801]);
        });
    });

    it('[PERSIST-2.6-FIND-RULE-CHANNEL] filters by channel ids, else by channel types, and rejects a rule that filters nothing', async () => {
        await withDialects(async fixture => {
            await seedPrograms(fixture);
            expect(ids(await find(fixture, { channelIds: [102] }))).toEqual([802]);
            expect(ids(await find(fixture, { channelIds: [101, 102] }))).toEqual([801, 802, 803]);
            // channelIds が空なら channel type で絞る。
            expect(ids(await find(fixture, { channelIds: [], GR: true }))).toEqual([801, 803]);
            expect(ids(await find(fixture, { BS: true }))).toEqual([802]);
            expect(ids(await find(fixture, { CS: true }))).toEqual([]);
            expect(ids(await find(fixture, { SKY: true }))).toEqual([]);
            expect(ids(await find(fixture, { BS4K: true }))).toEqual([]);
            expect(ids(await find(fixture, { GR: true, BS: true }))).toEqual([801, 802, 803]);
            // 何も絞らない rule は受け付けない。
            await expect(find(fixture, {})).rejects.toThrow('InvalidFindRuleOption');
            await expect(find(fixture, { channelIds: [] })).rejects.toThrow('InvalidFindRuleOption');
        });
    });

    it('[PERSIST-2.6-FIND-RULE-GENRE] matches a genre in any of the three genre slots, with or without the sub genre', async () => {
        await withDialects(async fixture => {
            await seedPrograms(fixture);
            const genre = (genres: unknown) => find(fixture, { ...allTypes, genres });
            expect(ids(await genre([{ genre: 1 }]))).toEqual([801, 803]);
            expect(ids(await genre([{ genre: 1, subGenre: 2 }]))).toEqual([801]);
            expect(ids(await genre([{ genre: 1, subGenre: 5 }]))).toEqual([803]);
            expect(ids(await genre([{ genre: 1, subGenre: 9 }]))).toEqual([]);
            expect(ids(await genre([{ genre: 9 }]))).toEqual([803]);
            expect(ids(await genre([{ genre: 3 }, { genre: 9, subGenre: 0 }]))).toEqual([802, 803]);
            // 空配列は条件にならない。
            expect(ids(await genre([]))).toEqual([801, 802, 803]);
        });
    });

    it('[PERSIST-2.6-FIND-RULE-TIME] matches week days and hour ranges, ignoring a time without week days or without a range', async () => {
        await withDialects(async fixture => {
            await seedPrograms(fixture);
            const times = (value: unknown) => find(fixture, { ...allTypes, times: value });
            // 月 = 0x02, 火 = 0x04
            expect(ids(await times([{ week: 0x02, start: 9, range: 1 }]))).toEqual([801]);
            expect(ids(await times([{ week: 0x02, start: 9, range: 2 }]))).toEqual([801, 803]);
            expect(ids(await times([{ week: 0x02 | 0x04, start: 10, range: 1 }]))).toEqual([802, 803]);
            expect(ids(await times([{ week: 0x04, start: 9, range: 1 }]))).toEqual([]);
            // 24 時を超える範囲は 24 で折り返す。
            expect(ids(await times([{ week: 0x02, start: 23, range: 12 }]))).toEqual([801, 803]);
            // 時刻を持たない曜日だけの指定は、その曜日のすべて。
            expect(ids(await times([{ week: 0x02 }]))).toEqual([801, 803]);
            expect(ids(await times([{ week: 0x02, start: 9 }]))).toEqual([801, 803]);
            expect(ids(await times([{ week: 0x02, range: 1 }]))).toEqual([801, 803]);
            // 複数の指定は OR。曜日の無い指定は無視する。
            expect(ids(await times([{ week: 0x04, start: 10, range: 1 }, { week: 0x02, start: 9, range: 1 }]))).toEqual([
                801, 802,
            ]);
            expect(ids(await times([{ week: 0 }, { week: 0x04 }]))).toEqual([802]);
            // すべての曜日
            expect(ids(await times([{ week: 0x7f }]))).toEqual([801, 802, 803]);
            expect(ids(await times([{ week: 0x01 }]))).toEqual([]);
            expect(ids(await times([{ week: 0x08 }]))).toEqual([]);
            expect(ids(await times([{ week: 0x10 }]))).toEqual([]);
            expect(ids(await times([{ week: 0x20 }]))).toEqual([]);
            expect(ids(await times([{ week: 0x40 }]))).toEqual([]);
            expect(ids(await times([]))).toEqual([801, 802, 803]);
        });
    });

    it('[PERSIST-2.6-FIND-RULE-RANGE] filters by free broadcast, duration and search periods, and orders by start time', async () => {
        await withDialects(async fixture => {
            await seedPrograms(fixture);
            const option = (more: Record<string, unknown>) => find(fixture, { ...allTypes, ...more });
            expect(ids(await option({ isFree: true }))).toEqual([801, 803]);
            expect(ids(await option({ isFree: false }))).toEqual([801, 802, 803]);
            expect(ids(await option({ durationMin: 120 }))).toEqual([802, 803]);
            expect(ids(await option({ durationMin: 121 }))).toEqual([803]);
            expect(ids(await option({ durationMax: 120 }))).toEqual([801, 802]);
            expect(ids(await option({ durationMax: 119 }))).toEqual([801]);
            expect(ids(await option({ durationMin: 70, durationMax: 130 }))).toEqual([802]);
            expect(ids(await option({ searchPeriods: [{ startAt: FUTURE + HOUR, endAt: FUTURE + HOUR }] }))).toEqual([801]);
            expect(
                ids(
                    await option({
                        searchPeriods: [
                            { startAt: FUTURE + 2 * HOUR, endAt: FUTURE + 2 * HOUR },
                            { startAt: FUTURE + 3 * HOUR, endAt: FUTURE + 4 * HOUR },
                        ],
                    }),
                ),
            ).toEqual([802, 803]);
            expect(ids(await option({ searchPeriods: [{ startAt: FUTURE + 4 * HOUR, endAt: FUTURE + 5 * HOUR }] }))).toEqual(
                [],
            );
            expect(ids(await option({ searchPeriods: [] }))).toEqual([801, 802, 803]);

            // 開始時刻の昇順。limit は先頭から。limit 0 は制限なし。
            expect(ids(await find(fixture, allTypes, { limit: 2 }))).toEqual([801, 802]);
            expect(ids(await find(fixture, allTypes, { limit: 0 }))).toEqual([801, 802, 803]);
            expect(ids(await find(fixture, allTypes))).toEqual([801, 802, 803]);
        });
    });

    it('[PERSIST-2.6-FIND-RULE-OVERLAP] marks a program as overlapping a recorded history within the avoid-duplicate period', async () => {
        await withDialects(async fixture => {
            const now = Date.now();
            const near = (id: number, name: string, channelId: number) =>
                makeProgram({
                    id,
                    name,
                    halfWidthName: name,
                    shortName: name,
                    channelId,
                    channelType: 'GR',
                    startAt: now + HOUR + id,
                    endAt: now + 2 * HOUR + id,
                    duration: HOUR,
                });
            await fixture.source
                .getRepository(fixture.entities.Program)
                .insert([near(901, 'Rerun', 101), near(902, 'Other', 101), near(903, 'Rerun', 102)]);
            const day = 24 * HOUR;

            const overlaps = async (historyEndAt: number | null, reserveOption: Record<string, unknown> | undefined) => {
                await fixture.db.RecordedHistoryDB.delete(Number.MAX_SAFE_INTEGER);
                if (historyEndAt !== null) {
                    await fixture.db.RecordedHistoryDB.insertOnce({ name: 'Rerun', channelId: 101, endAt: historyEndAt });
                }
                const rows = await find(fixture, { GR: true }, { reserveOption });
                return rows.map((row: { id: number; overlap: boolean }) => [Number(row.id), row.overlap]);
            };

            // 履歴の無い間は、どれも重複していない。
            expect(await overlaps(null, { avoidDuplicate: true })).toEqual([
                [901, false],
                [902, false],
                [903, false],
            ]);
            // avoidDuplicate を求めなければ、履歴があっても overlap は付かない。
            expect(await overlaps(now - 2 * day, { avoidDuplicate: false })).toEqual([
                [901, false],
                [902, false],
                [903, false],
            ]);
            expect(await overlaps(now - 2 * day, undefined)).toEqual([
                [901, false],
                [902, false],
                [903, false],
            ]);
            // 期間の指定が無い・0 のときは、過去のすべての履歴が対象。同じ名前・同じ放送局だけ。
            const rerun = [
                [901, true],
                [902, false],
                [903, false],
            ];
            expect(await overlaps(now - 2 * day, { avoidDuplicate: true })).toEqual(rerun);
            expect(await overlaps(now - 2 * day, { avoidDuplicate: true, periodToAvoidDuplicate: 0 })).toEqual(rerun);
            // 期間を指定すると、その期間内の履歴だけが対象。
            expect(await overlaps(now - 2 * day, { avoidDuplicate: true, periodToAvoidDuplicate: 1 })).toEqual([
                [901, false],
                [902, false],
                [903, false],
            ]);
            expect(await overlaps(now - 2 * day, { avoidDuplicate: true, periodToAvoidDuplicate: 3 })).toEqual(rerun);
            // 未来の履歴は対象外。
            expect(await overlaps(now + day, { avoidDuplicate: true })).toEqual([
                [901, false],
                [902, false],
                [903, false],
            ]);
        });
    });
});

// ---------------------------------------------------------------------------------------------
// RecordedDB
// ---------------------------------------------------------------------------------------------

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

const noRelations = { isNeedVideoFiles: false, isNeedThumbnails: false, isNeedsDropLog: false, isNeedTags: false };

describe('RecordedDB searches and updates recorded programs through real drivers', () => {
    it('[PERSIST-2.3-RECORDED-DROP-LOG] clears a drop log id from the recorded programs that use it and reports whether any changed', async () => {
        await withDialects(async ({ db }) => {
            const first = await db.DropLogFileDB.insertOnce({
                errorCnt: 1,
                dropCnt: 2,
                scramblingCnt: 3,
                filePath: 'synthetic-drop-1',
            });
            const second = await db.DropLogFileDB.insertOnce({
                errorCnt: 4,
                dropCnt: 5,
                scramblingCnt: 6,
                filePath: 'synthetic-drop-2',
            });
            const a = await db.RecordedDB.insertOnce(recorded({ dropLogFileId: first, name: 'a' }));
            const b = await db.RecordedDB.insertOnce(recorded({ dropLogFileId: second, name: 'b' }));

            await expect(db.RecordedDB.removeDropLogFileId(first)).resolves.toBe(true);
            await expect(db.RecordedDB.removeDropLogFileId(first)).resolves.toBe(false);
            await expect(db.RecordedDB.removeDropLogFileId(404)).resolves.toBe(false);
            await expect(db.RecordedDB.findId(a)).resolves.toMatchObject({ dropLogFileId: null });
            await expect(db.RecordedDB.findId(b)).resolves.toMatchObject({ dropLogFileId: second });
        });
    });

    it('[PERSIST-2.3-RECORDED-KEYWORD] ignores letter case, ANDs the words, and searches name or description', async () => {
        await withDialects(async ({ db }) => {
            const alpha = await db.RecordedDB.insertOnce(
                recorded({
                    name: 'Alpha Show',
                    halfWidthName: 'Alpha Show',
                    description: 'about cats',
                    halfWidthDescription: 'about cats',
                    startAt: 100,
                }),
            );
            const cats = await db.RecordedDB.insertOnce(
                recorded({ name: 'alpha cats', halfWidthName: 'alpha cats', startAt: 200 }),
            );
            const search = async (keyword: string) => {
                const [rows, total] = await db.RecordedDB.findAll(
                    { keyword, offset: 0, limit: 10, isHalfWidth: false, isReverse: true },
                    noRelations,
                );
                expect(total).toBe(rows.length);
                return ids(rows);
            };

            expect(await search('ALPHA')).toEqual([alpha, cats]);
            expect(await search('alpha show')).toEqual([alpha]);
            expect(await search('alpha cats')).toEqual([cats]);
            expect(await search('about CATS')).toEqual([alpha]);
            expect(await search('dogs')).toEqual([]);
        });
    });

    it('[PERSIST-2.3-RECORDED-ORIGINAL] returns only recorded programs that have an original file when hasOriginalFile is set', async () => {
        await withDialects(async ({ db }) => {
            const video = (recordedId: number, type: string, name: string) => ({
                parentDirectoryName: 'synthetic',
                filePath: `synthetic-${name}`,
                type,
                name,
                size: 1,
                recordedId,
            });
            const withOriginal = await db.RecordedDB.insertOnce(recorded({ name: 'with original', startAt: 100 }));
            const onlyEncoded = await db.RecordedDB.insertOnce(recorded({ name: 'only encoded', startAt: 200 }));
            const both = await db.RecordedDB.insertOnce(recorded({ name: 'both', startAt: 300 }));
            await db.VideoFileDB.insertOnce(video(withOriginal, 'ts', 'o1'));
            await db.VideoFileDB.insertOnce(video(onlyEncoded, 'encoded', 'e2'));
            await db.VideoFileDB.insertOnce(video(both, 'ts', 'o3'));
            await db.VideoFileDB.insertOnce(video(both, 'encoded', 'e3'));

            const [rows, total] = await db.RecordedDB.findAll(
                { offset: 0, limit: 10, isHalfWidth: false, isReverse: true, hasOriginalFile: true },
                { ...noRelations, isNeedVideoFiles: true },
            );
            expect(ids(rows)).toEqual([withOriginal, both]);
            expect(total).toBe(2);
        });
    });
});

// ---------------------------------------------------------------------------------------------
// ReserveDB
// ---------------------------------------------------------------------------------------------

describe('ReserveDB filters, pages and counts reservations through real drivers', () => {
    it('[PERSIST-2.2-RESERVE-LIST] filters by reservation state and rule, and pages by start time', async () => {
        await withDialects(async ({ db }) => {
            const add = (overrides: Record<string, unknown>) =>
                db.ReserveDB.insertOnce(makeReserve({ id: undefined, ...overrides }));
            const normal = await add({ startAt: 10, endAt: 11, ruleId: 1, programId: 1 });
            const conflict = await add({ startAt: 20, endAt: 21, ruleId: 1, programId: 2, isConflict: true });
            const skip = await add({ startAt: 30, endAt: 31, ruleId: 2, programId: 3, isSkip: true });
            const overlap = await add({ startAt: 40, endAt: 41, ruleId: 2, programId: 4, isOverlap: true });
            const manual = await add({ startAt: 50, endAt: 51, ruleId: null, programId: 5 });

            const list = async (option: Record<string, unknown>) => {
                const [rows, total] = await db.ReserveDB.findAll({ isHalfWidth: false, ...option });
                return [ids(rows), total];
            };

            expect(await list({})).toEqual([[normal, conflict, skip, overlap, manual], 5]);
            expect(await list({ type: 'normal' })).toEqual([[normal, manual], 2]);
            expect(await list({ type: 'conflict' })).toEqual([[conflict], 1]);
            expect(await list({ type: 'skip' })).toEqual([[skip], 1]);
            expect(await list({ type: 'overlap' })).toEqual([[overlap], 1]);
            expect(await list({ ruleId: 1 })).toEqual([[normal, conflict], 2]);
            expect(await list({ ruleId: 2, type: 'skip' })).toEqual([[skip], 1]);
            expect(await list({ offset: 1, limit: 2 })).toEqual([[conflict, skip], 5]);
            expect(await list({ limit: 2 })).toEqual([[normal, conflict], 5]);
            expect(await list({ offset: 3, limit: 5 })).toEqual([[overlap, manual], 5]);
            expect(await list({ offset: 0, limit: 0 })).toEqual([[normal, conflict, skip, overlap, manual], 5]);

            expect(ids(await db.ReserveDB.findLists({ startAt: 20, endAt: 40 }))).toEqual([conflict, skip, overlap]);
            expect(ids(await db.ReserveDB.findLists({ startAt: 22, endAt: 29 }))).toEqual([]);
            expect(ids(await db.ReserveDB.findLists())).toEqual([normal, conflict, skip, overlap, manual]);
        });
    });

    it('[PERSIST-2.2-RESERVE-UPDATE-MANY] accepts empty lists and applies each given list', async () => {
        await withDialects(async ({ db }) => {
            const keep = await db.ReserveDB.insertOnce(makeReserve({ id: undefined, programId: 1, startAt: 10, endAt: 11 }));
            await db.ReserveDB.updateMany({ delete: [], insert: [], update: [] });
            await db.ReserveDB.updateMany({});
            expect(ids((await db.ReserveDB.findAll({ isHalfWidth: false }))[0])).toEqual([keep]);

            const stored = (await db.ReserveDB.findId(keep)) as Record<string, any>;
            await db.ReserveDB.updateMany({
                insert: [makeReserve({ id: undefined, programId: 2, startAt: 20, endAt: 21 })],
                update: [Object.assign(makeReserve({ ...stored }), { name: 'synthetic-updated' })],
            });
            const [rows] = await db.ReserveDB.findAll({ isHalfWidth: false });
            expect(rows).toHaveLength(2);
            expect(rows[0]).toMatchObject({ id: keep, name: 'synthetic-updated' });
            await db.ReserveDB.updateMany({ delete: [makeReserve({ id: keep })] });
            expect(ids((await db.ReserveDB.findAll({ isHalfWidth: false }))[0])).toEqual([Number(rows[1].id)]);
        });
    });

    it('[PERSIST-2.2-RESERVE-COUNT] counts reservations per rule for the requested rules and state only', async () => {
        await withDialects(async ({ db }) => {
            const add = (overrides: Record<string, unknown>) =>
                db.ReserveDB.insertOnce(makeReserve({ id: undefined, ...overrides }));
            await add({ startAt: 10, ruleId: 1, programId: 1 });
            await add({ startAt: 20, ruleId: 1, programId: 2 });
            await add({ startAt: 30, ruleId: 1, programId: 3, isConflict: true });
            await add({ startAt: 40, ruleId: 2, programId: 4 });
            await add({ startAt: 50, ruleId: 3, programId: 5 });

            const counts = async (ruleIds: number[], state: string) =>
                (await db.ReserveDB.countByRuleIds(ruleIds, state))
                    .map((row: { ruleId: number; count: number }) => [Number(row.ruleId), row.count])
                    .sort((left: number[], right: number[]) => left[0] - right[0]);
            expect(await counts([1], 'normal')).toEqual([[1, 2]]);
            expect(await counts([1, 2], 'normal')).toEqual([
                [1, 2],
                [2, 1],
            ]);
            expect(await counts([1], 'conflict')).toEqual([[1, 1]]);
            expect(await counts([2], 'conflict')).toEqual([]);
            expect(await counts([], 'normal')).toEqual([]);
            const raw = await db.ReserveDB.countRuleIds([3], 'normal');
            expect(raw.map((row: { ruleId: number; ruleIdCnt: number }) => [Number(row.ruleId), Number(row.ruleIdCnt)])).toEqual([
                [3, 1],
            ]);
        });
    });
});
