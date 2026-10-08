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
            findLists(option?: { startAt: number; endAt: number }): Promise<unknown[]>;
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
 * Real ReserveDB.findLists(option) with connection/repository/retry mocked.
 * Call-site harnesses mock findLists entirely, leaving L268–279 uncovered.
 */
const makeFixture = (findResult: unknown[] = []) => {
    const find = vi.fn(async () => findResult);
    const getRepository = vi.fn(() => ({ find }));
    const getConnection = vi.fn(async () => ({ getRepository }));
    const retry = { run: vi.fn(async (job: () => Promise<unknown>) => job()) };
    const provider = new ReserveDB(silentLoggerModel, { getConnection }, retry);
    return { find, getConnection, getRepository, provider, retry };
};

type FindOperatorShape = { _type: string; _value: number };

describe('ReserveDB.findLists option (unittest/imp)', () => {
    it('[R2-RESERVEDB-FINDLISTS-OPTION] passes createFindListOption where to repository.find', async () => {
        const rows = [{ id: 42, name: 'synthetic-list' }];
        const fixture = makeFixture(rows);
        const option = { startAt: 1_700_000_000_000, endAt: 1_700_003_600_000 };

        await expect(fixture.provider.findLists(option)).resolves.toBe(rows);

        expect(fixture.getConnection).toHaveBeenCalledOnce();
        // Exact entity repository oracle (not call-count alone).
        expect(fixture.getRepository).toHaveBeenCalledExactlyOnceWith(Reserve);
        expect(fixture.retry.run).toHaveBeenCalledOnce();
        expect(fixture.find).toHaveBeenCalledOnce();
        const findArg = fixture.find.mock.calls[0]?.[0] as {
            where: { startAt: FindOperatorShape; endAt: FindOperatorShape };
        };
        expect(findArg.where.startAt._type).toBe('lessThanOrEqual');
        expect(findArg.where.startAt._value).toBe(option.endAt);
        expect(findArg.where.endAt._type).toBe('moreThanOrEqual');
        expect(findArg.where.endAt._value).toBe(option.startAt);
    });

    it('[R2-RESERVEDB-FINDLISTS-OPTION] no-option branch calls repository.find without arguments', async () => {
        const rows = [{ id: 7 }];
        const fixture = makeFixture(rows);

        await expect(fixture.provider.findLists()).resolves.toBe(rows);

        expect(fixture.getConnection).toHaveBeenCalledOnce();
        expect(fixture.getRepository).toHaveBeenCalledExactlyOnceWith(Reserve);
        expect(fixture.retry.run).toHaveBeenCalledOnce();
        expect(fixture.find).toHaveBeenCalledExactlyOnceWith();
    });
});
