import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { silentLoggerModel } from '../harness/silent-logger-model';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const ReserveDB = (
    require(join(snapshot, 'model', 'db', 'ReserveDB.js')) as {
        default: new (...args: unknown[]) => {
            findTimeRanges(option: {
                times: Array<{ startAt: number; endAt: number }>;
                hasSkip: boolean;
                hasConflict: boolean;
                hasOverlap: boolean;
                excludeRuleId?: number;
                excludeReserveId?: number;
            }): Promise<unknown[]>;
        };
    }
).default;
const Reserve = (
    require(join(snapshot, 'db', 'entities', 'Reserve.js')) as {
        default: new () => Record<string, unknown>;
    }
).default;

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Real ReserveDB.findTimeRanges with connection/repository/queryBuilder/retry mocked.
 * Reservation harnesses mock findTimeRanges entirely, leaving residual option branches uncovered.
 */
const makeFixture = (findResult: unknown[] = []) => {
    const builder = {
        andWhere: vi.fn(),
        getMany: vi.fn(async () => findResult),
        orderBy: vi.fn(),
        where: vi.fn(),
    };
    for (const method of ['andWhere', 'orderBy', 'where'] as const) {
        builder[method].mockReturnValue(builder);
    }
    const createQueryBuilder = vi.fn(() => builder);
    const getRepository = vi.fn(() => ({ createQueryBuilder }));
    const getConnection = vi.fn(async () => ({ getRepository }));
    const retry = { run: vi.fn(async (job: () => Promise<unknown>) => job()) };
    const provider = new ReserveDB(silentLoggerModel, { getConnection }, retry);
    return { builder, createQueryBuilder, getConnection, getRepository, provider, retry };
};

describe('ReserveDB.findTimeRanges (unittest/imp)', () => {
    it('[R2-RESERVEDB-FINDTIMERANGES] empty times returns [] without touching the repository', async () => {
        const fixture = makeFixture([{ id: 1 }]);

        await expect(
            fixture.provider.findTimeRanges({
                times: [],
                hasSkip: true,
                hasConflict: true,
                hasOverlap: true,
            }),
        ).resolves.toEqual([]);

        expect(fixture.getConnection).not.toHaveBeenCalled();
        expect(fixture.createQueryBuilder).not.toHaveBeenCalled();
        expect(fixture.retry.run).not.toHaveBeenCalled();
    });

    it('[R2-RESERVEDB-FINDTIMERANGES] merges contiguous times and applies hasSkip/hasConflict/excludeReserveId filters', async () => {
        const rows = [{ id: 99, startAt: 1000 }];
        const fixture = makeFixture(rows);
        const option = {
            // contiguous: first endAt === second startAt → reduce merges to one range
            times: [
                { startAt: 1000, endAt: 2000 },
                { startAt: 2000, endAt: 3000 },
                // duplicate of first segment (deduped before merge)
                { startAt: 1000, endAt: 2000 },
            ],
            hasSkip: false,
            hasConflict: false,
            hasOverlap: true,
            excludeReserveId: 77,
        };

        await expect(fixture.provider.findTimeRanges(option)).resolves.toBe(rows);

        expect(fixture.getConnection).toHaveBeenCalledOnce();
        expect(fixture.getRepository).toHaveBeenCalledExactlyOnceWith(Reserve);
        expect(fixture.createQueryBuilder).toHaveBeenCalledExactlyOnceWith('reserve');
        expect(fixture.retry.run).toHaveBeenCalledOnce();
        expect(fixture.builder.where).toHaveBeenCalledOnce();
        const [timesSql, timesValues] = fixture.builder.where.mock.calls[0] as [string, Record<string, number>];
        // single merged range 1000-3000 → one predicate, no OR
        expect(timesSql).toBe('((reserve.endAt >= :startAt0 and reserve.startAt < :endAt0))');
        expect(timesValues).toEqual({ startAt0: 1000, endAt0: 3000 });
        // hasConflict:false must exercise isConflict andWhere between skip and reserve-ID exclusion.
        expect(fixture.builder.andWhere.mock.calls).toEqual([
            ['reserve.isSkip = :isSkip', { isSkip: false }],
            ['reserve.isConflict = :isConflict', { isConflict: false }],
            ['reserve.id <> :reserveId', { reserveId: 77 }],
        ]);
        expect(fixture.builder.orderBy).toHaveBeenCalledExactlyOnceWith('reserve.startAt', 'ASC');
        expect(fixture.builder.getMany).toHaveBeenCalledOnce();
    });

    it('[R2-RESERVEDB-FINDTIMERANGES] non-contiguous times join with OR in the where clause', async () => {
        const rows = [{ id: 3 }];
        const fixture = makeFixture(rows);

        await expect(
            fixture.provider.findTimeRanges({
                times: [
                    { startAt: 1000, endAt: 2000 },
                    { startAt: 2500, endAt: 3000 },
                ],
                hasSkip: true,
                hasConflict: true,
                hasOverlap: true,
            }),
        ).resolves.toBe(rows);

        const [timesSql, timesValues] = fixture.builder.where.mock.calls[0] as [string, Record<string, number>];
        expect(timesSql).toBe(
            '((reserve.endAt >= :startAt0 and reserve.startAt < :endAt0) or (reserve.endAt >= :startAt1 and reserve.startAt < :endAt1))',
        );
        expect(timesValues).toEqual({
            startAt0: 1000,
            endAt0: 2000,
            startAt1: 2500,
            endAt1: 3000,
        });
        // hasSkip true → no isSkip andWhere
        expect(fixture.builder.andWhere).not.toHaveBeenCalled();
        expect(fixture.builder.orderBy).toHaveBeenCalledExactlyOnceWith('reserve.startAt', 'ASC');
        expect(fixture.builder.getMany).toHaveBeenCalledOnce();
    });
});
