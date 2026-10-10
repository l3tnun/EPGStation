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
 * ChannelDB の並び順と RecordedTagDB の検索・関連付けを、実 DB の SQLite・MySQL 9.7・MariaDB 12.3 で確かめる。
 * MariaDB は operator の mysql の分岐を通る。
 */

let mysqlRuntime: MySqlRuntime | undefined;
let mariaDbRuntime: MySqlRuntime | undefined;

beforeAll(async () => {
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
        const fixture = await createRepositoryPersistence(dialect, runtime);
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

const channelDbWith = (fixture: RepositoryPersistence, config: Record<string, unknown>) => {
    const ChannelDB = loadCompiledDefault<
        new (...arguments_: any[]) => RepositoryPersistence['db']['ChannelDB']
    >('model/db/ChannelDB.js');
    return new ChannelDB(fixture.loggerModel, { getConfig: () => config }, fixture.operator, fixture.retry);
};

const service = (id: number, serviceId: number, type: string, remoteControlKeyId?: number) => ({
    id,
    serviceId,
    networkId: 1,
    name: `synthetic-channel-${id}`,
    remoteControlKeyId,
    hasLogoData: false,
    channel: { type, channel: `synthetic-${id}` },
    type: 1,
});

describe('ChannelDB orders channels through real drivers', () => {
    it('[PERSIST-2.1-CHANNEL-ORDER] orders by type, remote control key and service id, then by the configured order only when asked', async () => {
        await withDialects(async fixture => {
            const plain = channelDbWith(fixture, {});
            await plain.insert([
                service(11, 1, 'GR', 3),
                service(12, 2, 'GR', 1),
                service(13, 3, 'BS', 2),
                service(14, 4, 'GR'),
            ]);

            // remoteControlKeyId を持たない channel は null で保存される。
            await expect(plain.findId(14)).resolves.toMatchObject({ remoteControlKeyId: null });
            await expect(plain.findId(11)).resolves.toMatchObject({ remoteControlKeyId: 3 });

            // 種別 → リモコン番号 → サービス ID（null は先頭）
            const natural = [14, 12, 11, 13];
            expect(ids(await plain.findAll())).toEqual(natural);
            expect(ids(await plain.findChannleTypes(['GR', 'BS']))).toEqual(natural);
            expect(ids(await plain.findChannleTypes(['GR']))).toEqual([14, 12, 11]);

            // 設定が無ければ並べ替えても変わらない。
            expect(ids(await plain.findAll(true))).toEqual(natural);

            // channelOrder は id、sidOrder は serviceId で並べる。無い id は無視する。
            const byChannel = channelDbWith(fixture, { channelOrder: [13, 99, 11] });
            expect(ids(await byChannel.findAll(true))).toEqual([13, 11, 14, 12]);
            expect(ids(await byChannel.findChannleTypes(['GR', 'BS'], true))).toEqual([13, 11, 14, 12]);
            // 並べ替えを求めなければ、設定があっても自然順。
            expect(ids(await byChannel.findAll())).toEqual(natural);
            expect(ids(await byChannel.findAll(false))).toEqual(natural);
            expect(ids(await byChannel.findChannleTypes(['GR', 'BS']))).toEqual(natural);

            const bySid = channelDbWith(fixture, { sidOrder: [3, 2] });
            expect(ids(await bySid.findAll(true))).toEqual([13, 12, 14, 11]);
            expect(ids(await bySid.findChannleTypes(['GR', 'BS'], true))).toEqual([13, 12, 14, 11]);
        });
    });
});

describe('RecordedTagDB searches tags and relates them to recorded programs through real drivers', () => {
    const recorded = (name: string) => ({
        reserveId: null,
        ruleId: null,
        programId: null,
        channelId: 10,
        isProtected: false,
        startAt: 1_000,
        endAt: 2_000,
        duration: 1_000,
        name,
        halfWidthName: name,
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
    });

    it('[PERSIST-2.5-TAG-SEARCH] filters by name (case-insensitive, all words) and by excluded ids, and pages', async () => {
        await withDialects(async ({ db }) => {
            const add = (name: string, halfWidthName: string) =>
                db.RecordedTagDB.insertOnce({ name, halfWidthName, color: '#000000' });
            const alphaBeta = await add('Alpha Beta', 'Alpha Beta');
            const alpha = await add('Ａlpha', 'Alpha');
            const gamma = await add('gamma', 'gamma');

            const names = async (option: Record<string, unknown>) => {
                const [rows, total] = await db.RecordedTagDB.findAll(option);
                return [ids(rows), total];
            };
            expect(await names({})).toEqual([[alphaBeta, alpha, gamma], 3]);
            expect(await names({ name: 'ALPHA' })).toEqual([[alphaBeta, alpha], 2]);
            expect(await names({ name: 'alpha beta' })).toEqual([[alphaBeta], 1]);
            expect(await names({ name: 'Ａlpha' })).toEqual([[alphaBeta, alpha], 2]);
            expect(await names({ name: 'delta' })).toEqual([[], 0]);
            expect(await names({ excludeTagId: [alpha] })).toEqual([[alphaBeta, gamma], 2]);
            expect(await names({ excludeTagId: [alphaBeta, gamma] })).toEqual([[alpha], 1]);
            expect(await names({ name: 'alpha', excludeTagId: [alphaBeta] })).toEqual([[alpha], 1]);
            expect(await names({ offset: 1, limit: 1 })).toEqual([[alpha], 3]);
        });
    });

    it('[PERSIST-2.5-TAG-RELATION] relates, unrelates and clears tags of a recorded program, and rejects an unknown recorded program', async () => {
        await withDialects(async ({ db }) => {
            const first = await db.RecordedDB.insertOnce(recorded('first'));
            const second = await db.RecordedDB.insertOnce(recorded('second'));
            const tagA = await db.RecordedTagDB.insertOnce({ name: 'a', halfWidthName: 'a', color: '#111111' });
            const tagB = await db.RecordedTagDB.insertOnce({ name: 'b', halfWidthName: 'b', color: '#222222' });

            await db.RecordedTagDB.setRelation(tagA, first);
            await db.RecordedTagDB.setRelation(tagB, first);
            await db.RecordedTagDB.setRelation(tagA, second);
            const tagIds = async (recordedId: number) =>
                ids(((await db.RecordedDB.findId(recordedId)) as { tags: Array<{ id: number }> }).tags).sort();
            expect(await tagIds(first)).toEqual([tagA, tagB]);
            expect(await tagIds(second)).toEqual([tagA]);

            await db.RecordedTagDB.deleteRelation(tagA, first);
            expect(await tagIds(first)).toEqual([tagB]);
            expect(await tagIds(second)).toEqual([tagA]);

            await db.RecordedTagDB.deleteAllRelation(first);
            expect(await tagIds(first)).toEqual([]);
            expect(await tagIds(second)).toEqual([tagA]);

            await expect(db.RecordedTagDB.setRelation(tagA, 404)).rejects.toThrow('RecordedIsUndefined');
            await expect(db.RecordedTagDB.deleteRelation(tagA, 404)).rejects.toThrow('RecordedIsUndefined');
            await expect(db.RecordedTagDB.deleteAllRelation(404)).rejects.toThrow('RecordedIsUndefined');
        });
    });
});
