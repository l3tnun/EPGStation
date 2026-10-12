import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const ChannelDB = (require(join(compiledSnapshot, 'model', 'db', 'ChannelDB.js')) as any).default;
const ProgramDB = (require(join(compiledSnapshot, 'model', 'db', 'ProgramDB.js')) as any).default;

const logger = () => ({ system: { debug: vi.fn(), error: vi.fn(), info: vi.fn() } });
// TypeORM 1.x rejects manager.delete(Entity, {}) with an empty criteria object, so ChannelDB.insert's
// full-table wipe now goes through manager.createQueryBuilder().delete().from(Entity).execute() instead.
// The mock manager needs that chain so it does not hit `queryRunner.manager.createQueryBuilder is not
// a function`.
const deleteQueryBuilder = () => {
    const builder = {
        delete: vi.fn(),
        execute: vi.fn().mockResolvedValue(undefined),
        from: vi.fn(),
    };
    builder.delete.mockReturnValue(builder);
    builder.from.mockReturnValue(builder);
    return builder;
};
const queryRunner = () => {
    // 1 runner につき 1 つの builder を返す。全件削除が何回実行されたかを execute の
    // 呼び出し回数で数えられるようにする。
    const deleteBuilder = deleteQueryBuilder();
    return {
        startTransaction: vi.fn().mockResolvedValue(undefined),
        commitTransaction: vi.fn().mockResolvedValue(undefined),
        rollbackTransaction: vi.fn().mockResolvedValue(undefined),
        release: vi.fn().mockResolvedValue(undefined),
        deleteBuilder,
        manager: {
            createQueryBuilder: vi.fn(() => deleteBuilder),
            delete: vi.fn().mockResolvedValue(undefined),
            insert: vi.fn().mockResolvedValue(undefined),
            update: vi.fn().mockResolvedValue(undefined),
        },
    };
};
const program = (overrides: Record<string, unknown> = {}) =>
    Object.assign(
        { id: 201, serviceId: 101, networkId: 10, startAt: 0, duration: 60_000, isFree: true },
        { eventId: 201, name: 'synthetic-program-２０１[新]' },
        overrides,
    );
const channelIndex = { 10: { 101: { id: 1, type: 'GR', channel: '27' } } };

const projectProgram = async (
    overrides: Record<string, unknown>,
    needToReplaceEnclosingCharacters: boolean = false,
) => {
    const runner = queryRunner();
    const db = new ProgramDB(
        { getLogger: logger },
        { getConfig: () => ({ needToReplaceEnclosingCharacters }) },
        { getConnection: async () => ({ createQueryRunner: () => runner }) },
        { run: (operation: () => unknown) => operation() },
    );
    await db.insert(channelIndex, [program(overrides)]);
    return runner.manager.insert.mock.calls[0][1];
};

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('program guide projection characterization', () => {
    it('[PG-MP-channel] persists every available channel field and normalizes optional values', async () => {
        const runner = queryRunner();
        const db = new ChannelDB(
            { getLogger: logger },
            { getConfig: () => ({}) },
            { getConnection: async () => ({ createQueryRunner: () => runner }) },
            { run: (operation: () => unknown) => operation() },
        );
        const input = {
            id: 1,
            serviceId: 101,
            networkId: 10,
            name: 'synthetic-service-１',
            remoteControlKeyId: 1,
            hasLogoData: true,
            channel: { type: 'GR', channel: '27' },
            type: 1,
        };

        await db.insert([input]);

        expect(runner.manager.insert).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({
                id: 1,
                serviceId: 101,
                networkId: 10,
                name: 'synthetic-service-１',
                halfWidthName: 'synthetic-service-1',
                remoteControlKeyId: 1,
                hasLogoData: true,
                channelTypeId: 0,
                channelType: 'GR',
                channel: '27',
                type: 1,
            }),
        );
        expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
        expect(runner.release).toHaveBeenCalledTimes(1);
    });

    it('[PG-MP-program] derives text, extended, first three genres, video, and main audio from one projection', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(123_456);
        const runner = queryRunner();
        const db = new ProgramDB(
            { getLogger: logger },
            { getConfig: () => ({ needToReplaceEnclosingCharacters: true }) },
            { getConnection: async () => ({ createQueryRunner: () => runner }) },
            { run: (operation: () => unknown) => operation() },
        );
        const input = program({
            description: 'synthetic-description-Ａ',
            extended: { heading: 'synthetic-extended-Ｂ' },
            genres: [
                { lv1: 1, lv2: 2 },
                { lv1: 3, lv2: 4 },
                { lv1: 5, lv2: 6 },
                { lv1: 7, lv2: 8 },
            ],
            video: { type: 'mpeg2', resolution: '1080i', streamContent: 1, componentType: 179 },
            audios: [
                { isMain: false, samplingRate: 24_000, componentType: 1 },
                { isMain: true, samplingRate: 48_000, componentType: 3 },
            ],
        });

        await db.insert(channelIndex, [input]);

        const saved = runner.manager.insert.mock.calls[0][1];
        expect(saved).toMatchObject({
            id: 201,
            channelId: 1,
            startAt: 0,
            endAt: 60_000,
            isFree: true,
            name: 'synthetic-program-２０１[新]',
            halfWidthName: 'synthetic-program-201[新]',
            shortName: 'synthetic-program-201',
            description: 'synthetic-description-Ａ',
            halfWidthDescription: 'synthetic-description-A',
            extended: '◇heading\nsynthetic-extended-Ｂ',
            halfWidthExtended: '◇heading\nsynthetic-extended-B',
            rawExtended: JSON.stringify({ heading: 'synthetic-extended-Ｂ' }),
            rawHalfWidthExtended: JSON.stringify({ heading: 'synthetic-extended-B' }),
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
        expect(saved).not.toMatchObject({ genre3: 7, subGenre3: 8 });
    });

    it('[PG-MP-value-range] preserves zero, one, and maximum safe identity/time values at the projection boundary', async () => {
        const zero = await projectProgram({ id: 0, eventId: 0, startAt: 0, duration: 1 });
        const maximumId = Number.MAX_SAFE_INTEGER;
        const maximumDate = 8_639_999_900_000_000;
        const maximum = await projectProgram({
            id: maximumId,
            eventId: maximumId,
            startAt: maximumDate,
            duration: 999,
        });

        expect(zero).toMatchObject({ id: 0, eventId: 0, startAt: 0, endAt: 1, duration: 1 });
        expect(maximum).toMatchObject({
            id: maximumId,
            eventId: maximumId,
            startAt: maximumDate,
            endAt: maximumDate + 999,
            duration: 999,
        });
    });

    it('[PG-MP-value-range] keeps duplicate genres in separate slots and leaves empty media collections unset', async () => {
        const saved = await projectProgram({
            genres: [
                { lv1: 1, lv2: 2 },
                { lv1: 1, lv2: 2 },
            ],
            audios: [],
        });

        expect(saved).toMatchObject({
            genre1: 1,
            subGenre1: 2,
            genre2: 1,
            subGenre2: 2,
            genre3: null,
            subGenre3: null,
        });
        expect(saved).not.toHaveProperty('videoType');
        expect(saved).not.toHaveProperty('audioSamplingRate');
    });

    it.each([
        {
            enabled: true,
            expected: {
                description: 'synthetic-description-[字]Ａ',
                extended: '◇heading\nsynthetic-extended-[字]Ｂ',
                halfWidthDescription: 'synthetic-description-[字]A',
                halfWidthExtended: '◇heading\nsynthetic-extended-[字]B',
                halfWidthName: 'synthetic-program-[字]A',
                name: 'synthetic-program-[字]Ａ',
            },
        },
        {
            enabled: false,
            expected: {
                description: 'synthetic-description-🈑Ａ',
                extended: '◇heading\nsynthetic-extended-🈑Ｂ',
                halfWidthDescription: 'synthetic-description-🈑A',
                halfWidthExtended: '◇heading\nsynthetic-extended-🈑B',
                halfWidthName: 'synthetic-program-🈑A',
                name: 'synthetic-program-🈑Ａ',
            },
        },
    ])('[PG-MP-text] applies enclosing-character conversion when enabled=$enabled', async ({ enabled, expected }) => {
        const saved = await projectProgram(
            {
                name: 'synthetic-program-🈑Ａ',
                description: 'synthetic-description-🈑Ａ',
                extended: { heading: 'synthetic-extended-🈑Ｂ' },
            },
            enabled,
        );

        expect(saved).toMatchObject(expected);
    });

    it.each([
        {
            source: { audio: { samplingRate: 44_100, componentType: 2 } },
            expected: { audioSamplingRate: 44_100, audioComponentType: 2 },
            variant: 'single audio',
        },
        {
            source: {
                audios: [
                    { isMain: false, samplingRate: 24_000, componentType: 1 },
                    { isMain: true, samplingRate: 48_000, componentType: 3 },
                ],
            },
            expected: { audioSamplingRate: 48_000, audioComponentType: 3 },
            variant: 'multiple audios',
        },
    ])('[PG-MP-audio] selects one main audio from $variant input', async ({ source, expected }) => {
        await expect(projectProgram(source)).resolves.toMatchObject(expected);
    });

    it.each([
        {
            genres: undefined,
            expected: {
                genre1: null,
                subGenre1: null,
                genre2: null,
                subGenre2: null,
                genre3: null,
                subGenre3: null,
            },
            variant: 'missing genres',
        },
        {
            genres: [],
            expected: {
                genre1: null,
                subGenre1: null,
                genre2: null,
                subGenre2: null,
                genre3: null,
                subGenre3: null,
            },
            variant: 'empty genres',
        },
        {
            genres: [{ lv1: 1, lv2: 2 }],
            expected: {
                genre1: 1,
                subGenre1: 2,
                genre2: null,
                subGenre2: null,
                genre3: null,
                subGenre3: null,
            },
            variant: 'one genre',
        },
        {
            genres: [
                { lv1: 1, lv2: 2 },
                { lv1: 3, lv2: 4 },
                { lv1: 5, lv2: 6 },
            ],
            expected: {
                genre1: 1,
                subGenre1: 2,
                genre2: 3,
                subGenre2: 4,
                genre3: 5,
                subGenre3: 6,
            },
            variant: 'three genres',
        },
        {
            genres: [
                { lv1: 1, lv2: 2 },
                { lv1: 3, lv2: 4 },
                { lv1: 5, lv2: 6 },
                { lv1: 7, lv2: 8 },
            ],
            expected: {
                genre1: 1,
                subGenre1: 2,
                genre2: 3,
                subGenre2: 4,
                genre3: 5,
                subGenre3: 6,
            },
            variant: 'four genres',
        },
        {
            genres: [
                { lv1: 14, lv2: 1 },
                { lv1: 3, lv2: 4 },
                { lv1: 15, lv2: 2 },
            ],
            expected: {
                genre1: null,
                subGenre1: null,
                genre2: 3,
                subGenre2: 4,
                genre3: null,
                subGenre3: null,
            },
            variant: 'non-standard slots',
        },
        {
            genres: [
                { lv1: 1, lv2: undefined },
                { lv1: 3, lv2: undefined },
                { lv1: 5, lv2: undefined },
            ],
            expected: {
                genre1: 1,
                subGenre1: null,
                genre2: 3,
                subGenre2: null,
                genre3: 5,
                subGenre3: null,
            },
            variant: 'lv2 missing on every slot',
        },
    ])('[PG-MP-genre] projects $variant without compacting positions', async ({ genres, expected }) => {
        await expect(projectProgram({ genres })).resolves.toMatchObject(expected);
    });

    it('[PG-MP-extended] leaves an already ◇-prefixed extended key untouched while still prefixing plain keys', async () => {
        const saved = await projectProgram({
            extended: { '◇already-prefixed': 'value-A', 'plain-key': 'value-B' },
        });

        expect(saved).toMatchObject({
            extended: '◇already-prefixed\nvalue-A\n◇plain-key\nvalue-B',
            halfWidthExtended: '◇already-prefixed\nvalue-A\n◇plain-key\nvalue-B',
        });
    });

    it('[PG-MP-empty] stores missing and empty descriptions as null and leaves missing extended/media unset', async () => {
        for (const description of [undefined, '']) {
            const runner = queryRunner();
            const db = new ProgramDB(
                { getLogger: logger },
                { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) },
                { getConnection: async () => ({ createQueryRunner: () => runner }) },
                { run: (operation: () => unknown) => operation() },
            );
            await db.insert(channelIndex, [program({ description })]);
            expect(runner.manager.insert.mock.calls[0][1]).toMatchObject({
                description: null,
                halfWidthDescription: null,
                extended: null,
                halfWidthExtended: null,
                rawExtended: null,
                rawHalfWidthExtended: null,
            });
        }
    });

    it('[PG-MP-required] skips nameless programs and programs absent from the channel index', async () => {
        const runner = queryRunner();
        const db = new ProgramDB(
            { getLogger: logger },
            { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) },
            { getConnection: async () => ({ createQueryRunner: () => runner }) },
            { run: (operation: () => unknown) => operation() },
        );
        await db.insert(channelIndex, [program({ name: undefined }), program({ serviceId: 999 })]);
        expect(runner.manager.insert).not.toHaveBeenCalled();
        // 削除対象の channel が指定されない全件差し替えは query builder を通る。
        expect(runner.deleteBuilder.execute).toHaveBeenCalledTimes(1);
        expect(runner.manager.delete).not.toHaveBeenCalled();
    });
});
