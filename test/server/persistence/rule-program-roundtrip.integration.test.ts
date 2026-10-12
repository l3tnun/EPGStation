import { createRequire } from 'node:module';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cleanupInOrder } from './harness';
import {
    MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS,
    provisionMariaDb,
    provisionMySql,
    type MySqlRuntime,
} from './mysql-runtime';
import {
    createRepositoryPersistence,
    loadCompiledDefault,
    type RepositoryDialect,
    type RepositoryPersistence,
} from './repository-harness';

/*
 * RuleDB と ProgramDB が、保存する値と読み戻す値を列ごとに過不足なく変換することを、実 DB の
 * SQLite・MySQL 9.7・MariaDB 12.3 で確かめる。MariaDB は operator の mysql の分岐を通る。
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

type Db = RepositoryPersistence['db'];

// ---------------------------------------------------------------------------------------------
// RuleDB
// ---------------------------------------------------------------------------------------------

const baseSearchOption = {
    keyCS: false,
    keyRegExp: false,
    name: false,
    description: false,
    extended: false,
    ignoreKeyCS: false,
    ignoreKeyRegExp: false,
    ignoreName: false,
    ignoreDescription: false,
    ignoreExtended: false,
    GR: false,
    BS: false,
    CS: false,
    SKY: false,
    BS4K: false,
    isFree: false,
};
const baseReserveOption = { enable: false, allowEndLack: false, avoidDuplicate: false };

/** 省略できる項目を全部持つルール。 */
const fullRule = () => ({
    isTimeSpecification: true,
    searchOption: {
        keyword: 'ｋｅｙ word',
        ignoreKeyword: 'ｉｇｎｏｒｅ word',
        keyCS: true,
        keyRegExp: true,
        name: true,
        description: true,
        extended: true,
        ignoreKeyCS: true,
        ignoreKeyRegExp: true,
        ignoreName: true,
        ignoreDescription: true,
        ignoreExtended: true,
        GR: true,
        BS: true,
        CS: true,
        SKY: true,
        BS4K: true,
        channelIds: [1, 2],
        genres: [{ genre: 1, subGenre: 2 }],
        times: [{ start: 3, range: 4, week: 5 }],
        isFree: true,
        durationMin: 6,
        durationMax: 7,
        searchPeriods: [{ startAt: 8, endAt: 9 }],
    },
    reserveOption: {
        enable: true,
        allowEndLack: true,
        avoidDuplicate: true,
        periodToAvoidDuplicate: 10,
        tags: [11],
    },
    saveOption: { parentDirectoryName: 'save-parent', directory: 'save-dir', recordedFormat: 'save-format' },
    encodeOption: {
        mode1: 'mode-one',
        encodeParentDirectoryName1: 'enc-parent1',
        directory1: 'enc-dir1',
        mode2: 'mode-two',
        encodeParentDirectoryName2: 'enc-parent2',
        directory2: 'enc-dir2',
        mode3: 'mode-three',
        encodeParentDirectoryName3: 'enc-parent3',
        directory3: 'enc-dir3',
        isDeleteOriginalAfterEncode: true,
    },
});

const sparseRule = () => ({
    isTimeSpecification: false,
    searchOption: { ...baseSearchOption },
    reserveOption: { ...baseReserveOption },
});

describe('RuleDB stores and restores every column of a rule through real drivers', () => {
    it('[PERSIST-2.2-RULE-FULL] round-trips a rule that has every optional item, including the half-width columns', async () => {
        await withDialects(async ({ db, entities, source }) => {
            const rule = fullRule();
            const id = await db.RuleDB.insertOnce(rule);

            expect(await db.RuleDB.findId(id, true)).toStrictEqual({ id, updateCnt: 0, ...rule });
            const noCnt = (await db.RuleDB.findId(id)) as Record<string, unknown>;
            expect(Object.keys(noCnt)).not.toContain('updateCnt');
            expect(noCnt).toStrictEqual({ id, ...rule });

            const row = (await source.getRepository(entities.Rule).findOneBy({ id })) as Record<string, unknown>;
            expect(row).toMatchObject({
                keyword: 'ｋｅｙ word',
                halfWidthKeyword: 'key word',
                ignoreKeyword: 'ｉｇｎｏｒｅ word',
                halfWidthIgnoreKeyword: 'ignore word',
                channelIds: '[1,2]',
                genres: '[{"genre":1,"subGenre":2}]',
                times: '[{"start":3,"range":4,"week":5}]',
                searchPeriods: '[{"startAt":8,"endAt":9}]',
                tags: '[11]',
            });
        });
    });

    it('[PERSIST-2.2-RULE-SPARSE] round-trips a rule without optional items as false flags and absent keys', async () => {
        await withDialects(async ({ db, entities, source }) => {
            const rule = sparseRule();
            const id = await db.RuleDB.insertOnce(rule);

            expect(await db.RuleDB.findId(id, true)).toStrictEqual({ id, updateCnt: 0, ...rule });
            const row = (await source.getRepository(entities.Rule).findOneBy({ id })) as Record<string, unknown>;
            expect(row).toMatchObject({
                keyword: null,
                halfWidthKeyword: null,
                ignoreKeyword: null,
                halfWidthIgnoreKeyword: null,
                channelIds: null,
                genres: null,
                times: null,
                durationMin: null,
                durationMax: null,
                searchPeriods: null,
                periodToAvoidDuplicate: null,
                tags: null,
                parentDirectoryName: null,
                directory: null,
                recordedFormat: null,
                mode1: null,
                parentDirectoryName1: null,
                directory1: null,
                mode2: null,
                parentDirectoryName2: null,
                directory2: null,
                mode3: null,
                parentDirectoryName3: null,
                directory3: null,
                isDeleteOriginalAfterEncode: false,
            });
        });
    });

    it('[PERSIST-2.2-RULE-ONE-ITEM] restores exactly the one optional item that was stored, for every optional item', async () => {
        const searchItems: Array<Record<string, unknown>> = [
            { keyword: 'only keyword' },
            { ignoreKeyword: 'only ignore' },
            { channelIds: [4] },
            { genres: [{ genre: 5 }] },
            { times: [{ week: 6 }] },
            { durationMin: 0 },
            { durationMax: 0 },
            { searchPeriods: [{ startAt: 1, endAt: 2 }] },
        ];
        const reserveItems: Array<Record<string, unknown>> = [{ periodToAvoidDuplicate: 0 }, { tags: [] }];
        const saveItems: Array<Record<string, unknown>> = [
            { parentDirectoryName: 'p' },
            { directory: 'd' },
            { recordedFormat: 'f' },
        ];
        const encodeItems: Array<Record<string, unknown>> = [
            { mode1: 'mode-one' },
            { encodeParentDirectoryName1: 'p1' },
            { directory1: 'd1' },
            { mode2: 'mode-two' },
            { encodeParentDirectoryName2: 'p2' },
            { directory2: 'd2' },
            { mode3: 'mode-three' },
            { encodeParentDirectoryName3: 'p3' },
            { directory3: 'd3' },
        ];

        await withDialects(async ({ db }) => {
            const cases: Array<{ rule: Record<string, any>; expected: Record<string, any> }> = [];
            for (const item of searchItems) {
                const rule = sparseRule();
                cases.push({
                    rule: { ...rule, searchOption: { ...rule.searchOption, ...item } },
                    expected: { ...rule, searchOption: { ...rule.searchOption, ...item } },
                });
            }
            for (const item of reserveItems) {
                const rule = sparseRule();
                cases.push({
                    rule: { ...rule, reserveOption: { ...rule.reserveOption, ...item } },
                    expected: { ...rule, reserveOption: { ...rule.reserveOption, ...item } },
                });
            }
            for (const item of saveItems) {
                const rule = sparseRule();
                cases.push({ rule: { ...rule, saveOption: item }, expected: { ...rule, saveOption: item } });
            }
            for (const item of encodeItems) {
                const rule = sparseRule();
                const keys = Object.keys(item);
                const renamed = Object.fromEntries(keys.map(key => [key, item[key]]));
                cases.push({
                    rule: { ...rule, encodeOption: { ...renamed, isDeleteOriginalAfterEncode: true } },
                    expected: { ...rule, encodeOption: { ...renamed, isDeleteOriginalAfterEncode: true } },
                });
            }

            for (const { rule, expected } of cases) {
                const id = await db.RuleDB.insertOnce(rule);
                expect(await db.RuleDB.findId(id, true)).toStrictEqual({ id, updateCnt: 0, ...expected });
            }

            // 保存オプション・エンコードオプションが空なら、キー自体を返さない。
            const emptyId = await db.RuleDB.insertOnce({
                ...sparseRule(),
                saveOption: {},
                encodeOption: { isDeleteOriginalAfterEncode: false },
            });
            const empty = (await db.RuleDB.findId(emptyId)) as Record<string, unknown>;
            expect(Object.keys(empty)).not.toContain('saveOption');
            expect(Object.keys(empty)).not.toContain('encodeOption');
        });
    });

    it('[PERSIST-2.2-RULE-UPDATE-CNT] raises updateCnt by one per update, enable and disable, and only for the target rule', async () => {
        await withDialects(async ({ db }) => {
            const targetId = await db.RuleDB.insertOnce(sparseRule());
            const otherId = await db.RuleDB.insertOnce(fullRule());
            const other = (await db.RuleDB.findId(otherId, true)) as Record<string, any>;

            await db.RuleDB.updateOnce({ id: targetId, ...fullRule() });
            expect(await db.RuleDB.findId(targetId, true)).toStrictEqual({ id: targetId, updateCnt: 1, ...fullRule() });
            await db.RuleDB.updateOnce({ id: targetId, ...fullRule() });
            expect(((await db.RuleDB.findId(targetId, true)) as Record<string, any>).updateCnt).toBe(2);

            // 有効な rule の enableOnce は何もしない。
            await db.RuleDB.enableOnce(targetId);
            expect(((await db.RuleDB.findId(targetId, true)) as Record<string, any>).updateCnt).toBe(2);
            await db.RuleDB.disableOnce(targetId);
            expect(await db.RuleDB.findId(targetId, true)).toMatchObject({
                updateCnt: 3,
                reserveOption: { enable: false },
            });
            // 無効な rule の disableOnce は何もしない。
            await db.RuleDB.disableOnce(targetId);
            expect(((await db.RuleDB.findId(targetId, true)) as Record<string, any>).updateCnt).toBe(3);
            await db.RuleDB.enableOnce(targetId);
            expect(await db.RuleDB.findId(targetId, true)).toMatchObject({
                updateCnt: 4,
                reserveOption: { enable: true },
            });

            // ほかの rule は変わらない。
            expect(await db.RuleDB.findId(otherId, true)).toStrictEqual(other);
        });
    });

    it('[PERSIST-2.2-RULE-MISSING] rejects update, enable and disable of a rule that does not exist and returns null for find', async () => {
        await withDialects(async ({ db }) => {
            await expect(db.RuleDB.findId(404)).resolves.toBeNull();
            await expect(db.RuleDB.findId(404, true)).resolves.toBeNull();
            await expect(db.RuleDB.updateOnce({ id: 404, ...sparseRule() })).rejects.toThrow('RuleIsNull');
            await expect(db.RuleDB.enableOnce(404)).rejects.toThrow('RuleIsNull');
            await expect(db.RuleDB.disableOnce(404)).rejects.toThrow('RuleIsNull');
        });
    });

    it('[PERSIST-2.2-RULE-DELETE-ONE] deletes only the target rule', async () => {
        await withDialects(async ({ db }) => {
            const firstId = await db.RuleDB.insertOnce(sparseRule());
            const secondId = await db.RuleDB.insertOnce(sparseRule());
            await db.RuleDB.deleteOnce(firstId);
            await expect(db.RuleDB.findId(firstId)).resolves.toBeNull();
            await expect(db.RuleDB.findId(secondId)).resolves.not.toBeNull();
            await expect(db.RuleDB.getIds()).resolves.toEqual([secondId]);
        });
    });

    it('[PERSIST-2.2-RULE-LIST] lists rules by id with or without updateCnt, filters by every keyword, pages, and lists ids', async () => {
        await withDialects(async ({ db }) => {
            const makeKeywordRule = (keyword: string | undefined) => ({
                ...sparseRule(),
                searchOption: { ...baseSearchOption, ...(keyword === undefined ? {} : { keyword }) },
            });
            const alphaBeta = await db.RuleDB.insertOnce(makeKeywordRule('alpha beta'));
            const alpha = await db.RuleDB.insertOnce(makeKeywordRule('Ａlpha'));
            const none = await db.RuleDB.insertOnce(makeKeywordRule(undefined));
            const gamma = await db.RuleDB.insertOnce(makeKeywordRule('gamma'));

            const [all, total] = await db.RuleDB.findAll({});
            expect(all.map((rule: { id: number }) => rule.id)).toEqual([alphaBeta, alpha, none, gamma]);
            expect(total).toBe(4);
            expect(all.every((rule: object) => !('updateCnt' in rule))).toBe(true);
            const [withCnt] = await db.RuleDB.findAll({}, true);
            expect(withCnt.every((rule: { updateCnt: number }) => rule.updateCnt === 0)).toBe(true);

            const [both, bothTotal] = await db.RuleDB.findAll({ keyword: 'alpha beta' });
            expect(both.map((rule: { id: number }) => rule.id)).toEqual([alphaBeta]);
            expect(bothTotal).toBe(1);
            const [half] = await db.RuleDB.findAll({ keyword: 'Ａlpha' });
            expect(half.map((rule: { id: number }) => rule.id)).toEqual([alphaBeta, alpha]);

            const [page, pageTotal] = await db.RuleDB.findAll({ offset: 1, limit: 2 });
            expect(page.map((rule: { id: number }) => rule.id)).toEqual([alpha, none]);
            expect(pageTotal).toBe(4);

            // limit を省いた offset は offset 以降の全件 (MySQL・MariaDB は上限なしの offset を拒むので上限を補う)
            const [fromOffset, fromOffsetTotal] = await db.RuleDB.findAll({ offset: 1 });
            expect(fromOffset.map((rule: { id: number }) => rule.id)).toEqual([alpha, none, gamma]);
            expect(fromOffsetTotal).toBe(4);

            await expect(db.RuleDB.findKeyword({})).resolves.toEqual([
                { id: alphaBeta, keyword: 'alpha beta' },
                { id: alpha, keyword: 'Ａlpha' },
                { id: none, keyword: '' },
                { id: gamma, keyword: 'gamma' },
            ]);
            await expect(db.RuleDB.findKeyword({ keyword: 'alpha beta' })).resolves.toEqual([
                { id: alphaBeta, keyword: 'alpha beta' },
            ]);
            await expect(db.RuleDB.findKeyword({ offset: 2, limit: 1 })).resolves.toEqual([{ id: none, keyword: '' }]);
            await expect(db.RuleDB.getIds()).resolves.toEqual([alphaBeta, alpha, none, gamma]);
        });
    });

    it('[PERSIST-2.2-RULE-RESTORE] restores rules with their own id and updateCnt', async () => {
        await withDialects(async ({ db }) => {
            await db.RuleDB.insertOnce(sparseRule());
            await db.RuleDB.restore([
                { id: 7, updateCnt: 5, ...fullRule() },
                { id: 3, updateCnt: 1, ...sparseRule() },
            ]);
            expect(await db.RuleDB.findId(7, true)).toStrictEqual({ id: 7, updateCnt: 5, ...fullRule() });
            expect(await db.RuleDB.findId(3, true)).toStrictEqual({ id: 3, updateCnt: 1, ...sparseRule() });
            await expect(db.RuleDB.getIds()).resolves.toEqual([3, 7]);
        });
    });
});

// ---------------------------------------------------------------------------------------------
// ProgramDB
// ---------------------------------------------------------------------------------------------

const channelTypes = { 1: { 11: { id: 11, type: 'GR', channel: 'synthetic-11' } } };

const tunerProgram = (id: number, overrides: Record<string, unknown> = {}) => ({
    id,
    eventId: id,
    serviceId: 11,
    networkId: 1,
    startAt: 1_900_000_000_000 + id * 1_000_000,
    duration: 1_000,
    isFree: true,
    name: `synthetic-program-${id}`,
    ...overrides,
});

const loadProgramDb = (fixture: RepositoryPersistence, needToReplaceEnclosingCharacters: boolean): Db['ProgramDB'] => {
    const ProgramDB = loadCompiledDefault<new (...arguments_: any[]) => Db['ProgramDB']>('model/db/ProgramDB.js');
    return new ProgramDB(
        fixture.loggerModel,
        { getConfig: () => ({ needToReplaceEnclosingCharacters }) },
        fixture.operator,
        fixture.retry,
    );
};

const enclosed = '\u{1f210}';

describe('ProgramDB converts a tuner program into stored columns through real drivers', () => {
    it('[PERSIST-2.1-PROGRAM-GENRES] stores up to three genres, skipping a genre whose lv1 is 0xe or more', async () => {
        await withDialects(async ({ db }) => {
            const cases: Array<{ genres: unknown; expected: Record<string, number | null> }> = [
                {
                    genres: [{ lv1: 1, lv2: 2 }, { lv1: 3 }, { lv1: 4, lv2: 5 }, { lv1: 6, lv2: 7 }],
                    expected: { genre1: 1, subGenre1: 2, genre2: 3, subGenre2: null, genre3: 4, subGenre3: 5 },
                },
                {
                    genres: [{ lv1: 0xd, lv2: 1 }, { lv1: 0xe, lv2: 2 }, { lv1: 0xd }],
                    expected: { genre1: 0xd, subGenre1: 1, genre2: null, subGenre2: null, genre3: 0xd, subGenre3: null },
                },
                {
                    genres: [{ lv1: 0xe, lv2: 1 }, { lv1: 2, lv2: 3 }],
                    expected: { genre1: null, subGenre1: null, genre2: 2, subGenre2: 3, genre3: null, subGenre3: null },
                },
                {
                    genres: [{ lv1: 9, lv2: 8 }],
                    expected: { genre1: 9, subGenre1: 8, genre2: null, subGenre2: null, genre3: null, subGenre3: null },
                },
                {
                    genres: [{ lv1: 1 }, { lv1: 2 }, { lv1: 0xe, lv2: 4 }],
                    expected: { genre1: 1, subGenre1: null, genre2: 2, subGenre2: null, genre3: null, subGenre3: null },
                },
                {
                    genres: [{ lv1: 1 }, { lv1: 2 }, { lv1: 0xf, lv2: 4 }],
                    expected: { genre1: 1, subGenre1: null, genre2: 2, subGenre2: null, genre3: null, subGenre3: null },
                },
                {
                    genres: [],
                    expected: { genre1: null, subGenre1: null, genre2: null, subGenre2: null, genre3: null, subGenre3: null },
                },
                {
                    genres: undefined,
                    expected: { genre1: null, subGenre1: null, genre2: null, subGenre2: null, genre3: null, subGenre3: null },
                },
            ];
            for (const [index, { genres, expected }] of cases.entries()) {
                await db.ProgramDB.insert(channelTypes, [tunerProgram(100 + index, { genres })], []);
                expect(await db.ProgramDB.findId(100 + index)).toMatchObject(expected);
            }
        });
    });

    it('[PERSIST-2.1-PROGRAM-TEXT] stores description and extended text, with and without the enclosed-character replacement', async () => {
        await withDialects(async fixture => {
            const extended = { '◇key1': `Ｖ1${enclosed}`, key2: 'v2', 'ｋey3': 'ｖ3' };
            for (const replace of [false, true]) {
                const programDb = loadProgramDb(fixture, replace);
                const mark = replace ? '[手]' : enclosed;
                await programDb.insert(
                    channelTypes,
                    [
                        tunerProgram(201, { name: `name${enclosed}`, description: `desc${enclosed}`, extended }),
                        tunerProgram(202, { description: '' }),
                        tunerProgram(203, { description: 'only description' }),
                    ],
                    [],
                );

                const first = (await programDb.findId(201)) as Record<string, any>;
                const extendedText = `◇key1\nＶ1${mark}\n◇key2\nv2\n◇ｋey3\nｖ3`;
                expect(first).toMatchObject({
                    name: `name${mark}`,
                    halfWidthName: `name${mark}`,
                    shortName: 'name',
                    description: `desc${mark}`,
                    halfWidthDescription: `desc${mark}`,
                    extended: extendedText,
                    halfWidthExtended: extendedText.replace(/[！-～]/g, s =>
                        String.fromCharCode(s.charCodeAt(0) - 0xfee0),
                    ),
                    rawExtended: JSON.stringify(extended),
                });
                expect(JSON.parse(first.rawHalfWidthExtended)).toEqual({
                    '◇key1': `V1${enclosed}`,
                    key2: 'v2',
                    key3: 'v3',
                });
                // replacement is only applied to the text columns, not to the raw copy.
                expect(first.rawExtended).toContain(enclosed);

                expect(await programDb.findId(202)).toMatchObject({ description: null, halfWidthDescription: null });
                expect(await programDb.findId(203)).toMatchObject({
                    description: 'only description',
                    halfWidthDescription: 'only description',
                    extended: null,
                    halfWidthExtended: null,
                    rawExtended: null,
                    rawHalfWidthExtended: null,
                });
            }
        });
    });

    it('[PERSIST-2.1-PROGRAM-MEDIA] stores the video, the legacy audio and the main one of the audios', async () => {
        await withDialects(async ({ db }) => {
            await db.ProgramDB.insert(
                channelTypes,
                [
                    tunerProgram(301),
                    tunerProgram(302, {
                        video: { type: 'mpeg2', resolution: '1080i', streamContent: 1, componentType: 2 },
                        audio: { samplingRate: 48000, componentType: 3 },
                    }),
                    tunerProgram(303, {
                        audios: [
                            { isMain: false, samplingRate: 16000, componentType: 1 },
                            { isMain: true, samplingRate: 32000, componentType: 2 },
                            { isMain: false, samplingRate: 44100, componentType: 3 },
                        ],
                    }),
                    tunerProgram(304, { audios: [{ samplingRate: 22050, componentType: 5 }] }),
                    tunerProgram(305, { audios: [{ isMain: false, samplingRate: 8000, componentType: 6 }] }),
                ],
                [],
            );

            expect(await db.ProgramDB.findId(301)).toMatchObject({
                videoType: null,
                videoResolution: null,
                videoStreamContent: null,
                videoComponentType: null,
                audioSamplingRate: null,
                audioComponentType: null,
            });
            expect(await db.ProgramDB.findId(302)).toMatchObject({
                videoType: 'mpeg2',
                videoResolution: '1080i',
                videoStreamContent: 1,
                videoComponentType: 2,
                audioSamplingRate: 48000,
                audioComponentType: 3,
            });
            expect(await db.ProgramDB.findId(303)).toMatchObject({ audioSamplingRate: 32000, audioComponentType: 2 });
            expect(await db.ProgramDB.findId(304)).toMatchObject({ audioSamplingRate: 22050, audioComponentType: 5 });
            expect(await db.ProgramDB.findId(305)).toMatchObject({ audioSamplingRate: null, audioComponentType: null });
        });
    });

    it('[PERSIST-2.1-PROGRAM-SKIP] does not store a program without a name or whose service is unknown', async () => {
        await withDialects(async ({ db }) => {
            await db.ProgramDB.insert(
                channelTypes,
                [
                    tunerProgram(401),
                    tunerProgram(402, { name: undefined }),
                    tunerProgram(403, { serviceId: 99 }),
                    tunerProgram(404, { networkId: 9 }),
                ],
                [],
            );
            expect((await db.ProgramDB.findAll()).map((row: { id: number }) => row.id)).toEqual([401]);
        });
    });

    it('[PERSIST-2.1-PROGRAM-FIND] finds a program by id and by network, service and event', async () => {
        await withDialects(async ({ db }) => {
            await db.ProgramDB.insert(
                channelTypes,
                [tunerProgram(501, { eventId: 7 }), tunerProgram(502, { eventId: 8 })],
                [],
            );
            expect(await db.ProgramDB.findEventRelayProgram(1, 11, 8)).toMatchObject({ id: 502 });
            expect(await db.ProgramDB.findEventRelayProgram(1, 11, 9)).toBeNull();
            expect(await db.ProgramDB.findEventRelayProgram(1, 12, 8)).toBeNull();
            expect(await db.ProgramDB.findEventRelayProgram(2, 11, 8)).toBeNull();
        });
    });
});
