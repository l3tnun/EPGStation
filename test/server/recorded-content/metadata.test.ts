import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const load = <T>(path: string): T => (require(join(snapshot, path)) as { default: T }).default;
const RecordedManageModel = load<{ prototype: Record<string, unknown> }>(
    'model/operator/recorded/RecordedManageModel.js',
);
const RecordedTagManadeModel = load<new (...args: any[]) => any>(
    'model/operator/recordedTag/RecordedTagManadeModel.js',
);
const RecordedTagDB = load<new (...args: any[]) => any>('model/db/RecordedTagDB.js');
const RecordedHistoryDB = load<new (...args: any[]) => any>('model/db/RecordedHistoryDB.js');
const ProgramDB = load<{ prototype: Record<string, unknown> }>('model/db/ProgramDB.js');

afterEach(() => vi.restoreAllMocks());

describe('recorded metadata implementation characterization', () => {
    it('[RC-5.1-SEARCH] normalizes multi-term tag search and applies exclusions and paging', async () => {
        const query: any = {
            andWhere: vi.fn(function () {
                return this;
            }),
            skip: vi.fn(function () {
                return this;
            }),
            take: vi.fn(function () {
                return this;
            }),
            getManyAndCount: vi.fn(async () => [[], 0]),
        };
        const op = {
            getConnection: vi.fn(async () => ({
                getRepository: () => ({ createQueryBuilder: () => query }),
            })),
            getLikeStr: vi.fn(() => 'like'),
        };
        const retry = { run: vi.fn((callback: () => unknown) => callback()) };
        const db = new RecordedTagDB(op, retry);

        await expect(db.findAll({ excludeTagId: [521, 522], name: 'Ａ　Ｂ', offset: 3, limit: 4 })).resolves.toEqual([
            [],
            0,
        ]);

        expect(query.andWhere).toHaveBeenNthCalledWith(1, 'id not in (:...id)', { id: [521, 522] });
        expect(query.andWhere.mock.calls[1][0]).toContain('halfWidthName like :name0');
        expect(query.andWhere.mock.calls[1][0]).toContain('halfWidthName like :name1');
        expect(query.andWhere.mock.calls[1][1]).toEqual({ name0: '%A%', name1: '%B%' });
        expect(query.skip).toHaveBeenCalledWith(3);
        expect(query.take).toHaveBeenCalledWith(4);
    });

    it('[RC-5.1] logs a tag-delete persistence failure with the tag id and rethrows it unmasked', async () => {
        const persistenceFailure = new Error('SYNTHETIC_TAG_DELETE_REJECTION');
        const db = { deleteOnce: vi.fn(async () => Promise.reject(persistenceFailure)) };
        const log = { system: { info: vi.fn(), error: vi.fn() } };
        const manager = new RecordedTagManadeModel({ getLogger: () => log }, db, {});

        const failure = await manager.delete(523).catch((err: unknown) => err);

        expect(failure).toBe(persistenceFailure);
        expect(log.system.error).toHaveBeenCalledWith('delete tag error: 523');
    });

    it('[RC-6.2/6.3] builds duplicate detection from name, channel, completion time, and the configured period', () => {
        vi.spyOn(Date.prototype, 'getTime').mockReturnValue(1_000_000_000);
        const db: any = Object.create(ProgramDB.prototype);

        const sql = db.createOverlapQueryStr(2);

        expect(sql).toContain('P.shortName = R.name');
        expect(sql).toContain('P.channelId = R.channelId');
        expect(sql).toContain(`R.endAt >= ${1_000_000_000 - 2 * 24 * 60 * 60 * 1000}`);
        expect(sql).toContain('R.endAt <= 1000000000');
        expect(sql).toContain(`P.endAt <= (R.endAt + ${2 * 24 * 60 * 60 * 1000})`);
    });

    it('[RC-6.4] computes the retention cutoff from the current clock and configured days', async () => {
        vi.spyOn(Date.prototype, 'getTime').mockReturnValue(2_000_000_000);
        const target: any = Object.create(RecordedManageModel.prototype);
        target.config = { recordedHistoryRetentionPeriodDays: 7 };
        target.log = { system: { error: vi.fn() } };
        target.recordedHistoryDB = { delete: vi.fn(async () => undefined) };

        await target.historyCleanup();

        expect(target.recordedHistoryDB.delete).toHaveBeenCalledWith(2_000_000_000 - 7 * 24 * 60 * 60 * 1000);
    });

    it('[RC-6.4-BOUNDARY] deletes only history strictly older than the retention cutoff', async () => {
        const query: any = {
            delete: vi.fn(function () {
                return this;
            }),
            from: vi.fn(function () {
                return this;
            }),
            where: vi.fn(function () {
                return this;
            }),
            execute: vi.fn(async () => undefined),
        };
        const op = { getConnection: vi.fn(async () => ({ createQueryBuilder: () => query })) };
        const retry = { run: vi.fn((callback: () => unknown) => callback()) };
        const db = new RecordedHistoryDB(op, retry);

        await db.delete(524_000);

        expect(query.where).toHaveBeenCalledWith('endAt < :time', { time: 524_000 });
    });

    it('[RC-6.4-FAILURE] propagates a retention delete query failure', async () => {
        const persistenceFailure = new Error('SYNTHETIC_HISTORY_DELETE_REJECTION');
        const query: any = {
            delete: vi.fn(function () {
                return this;
            }),
            from: vi.fn(function () {
                return this;
            }),
            where: vi.fn(function () {
                return this;
            }),
            execute: vi.fn(async () => Promise.reject(persistenceFailure)),
        };
        const op = { getConnection: vi.fn(async () => ({ createQueryBuilder: () => query })) };
        const retry = { run: vi.fn((callback: () => unknown) => callback()) };
        const db = new RecordedHistoryDB(op, retry);

        await expect(db.delete(525_000)).rejects.toBe(persistenceFailure);
        expect(retry.run).toHaveBeenCalledOnce();
        expect(query.execute).toHaveBeenCalledOnce();
    });
});
