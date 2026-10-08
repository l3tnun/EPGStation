import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const ReserveDB = (
    require(join(snapshot, 'model', 'db', 'ReserveDB.js')) as {
        default: new (...args: unknown[]) => {
            findRuleId(option: {
                ruleId: number;
                hasSkip: boolean;
                hasConflict: boolean;
                hasOverlap: boolean;
                hasEventRelay: boolean;
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
 * Real ReserveDB.findRuleId with connection/repository/retry mocked.
 * Call-site harnesses mock findRuleId entirely, leaving L404–412 false-flag branches uncovered.
 */
const makeFixture = (findResult: unknown[] = []) => {
    const find = vi.fn(async () => findResult);
    const getRepository = vi.fn(() => ({ find }));
    const getConnection = vi.fn(async () => ({ getRepository }));
    const retry = { run: vi.fn(async (job: () => Promise<unknown>) => job()) };
    const provider = new ReserveDB({ getConnection }, retry);
    return { find, getConnection, getRepository, provider, retry };
};

describe('ReserveDB.findRuleId option flags (unittest/imp)', () => {
    it('[R2-RESERVEDB-FINDRULEID-FLAGS] applies isSkip/isConflict/isOverlap/isEventRelay false where flags', async () => {
        const rows = [{ id: 11, ruleId: 9001 }];
        const fixture = makeFixture(rows);
        const option = {
            ruleId: 9001,
            hasSkip: false,
            hasConflict: false,
            hasOverlap: false,
            hasEventRelay: false,
        };

        await expect(fixture.provider.findRuleId(option)).resolves.toBe(rows);

        expect(fixture.getConnection).toHaveBeenCalledOnce();
        expect(fixture.getRepository).toHaveBeenCalledExactlyOnceWith(Reserve);
        expect(fixture.retry.run).toHaveBeenCalledOnce();
        expect(fixture.find).toHaveBeenCalledExactlyOnceWith({
            where: {
                ruleId: 9001,
                isSkip: false,
                isConflict: false,
                isOverlap: false,
                isEventRelay: false,
            },
            order: {
                startAt: 'ASC',
            },
        });
    });

    it('[R2-RESERVEDB-FINDRULEID-FLAGS] omits false flags when inclusion options are true', async () => {
        const rows = [{ id: 12, ruleId: 9002 }];
        const fixture = makeFixture(rows);

        await expect(
            fixture.provider.findRuleId({
                ruleId: 9002,
                hasSkip: true,
                hasConflict: true,
                hasOverlap: true,
                hasEventRelay: true,
            }),
        ).resolves.toBe(rows);

        expect(fixture.find).toHaveBeenCalledExactlyOnceWith({
            where: {
                ruleId: 9002,
            },
            order: {
                startAt: 'ASC',
            },
        });
    });
});
