import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const ScheduleApiModel = (
    require(join(snapshot, 'model', 'api', 'schedule', 'ScheduleApiModel.js')) as {
        default: new (...args: unknown[]) => {
            getSchedules(option: Record<string, unknown>): Promise<unknown[]>;
        };
    }
).default;

/**
 * residual-4236 G1: public getSchedules CS/SKY type push (L47–52).
 * GR/BS and GetScheduleTypesError are already covered elsewhere.
 * Real ScheduleApiModel; stub channel/program DB only.
 */
afterEach(() => {
    vi.restoreAllMocks();
});

describe('ScheduleApiModel.getSchedules CS/SKY types (unittest/imp)', () => {
    it('[R2-SCHEDULEAPI-CS-SKY-TYPES] passes CS and SKY into channel and program lookups', async () => {
        const findChannleTypes = vi.fn(async () => []);
        const findSchedule = vi.fn(async () => []);
        const model = new ScheduleApiModel({ findChannleTypes }, { findSchedule });

        await model.getSchedules({
            CS: true,
            SKY: true,
            startAt: 1_000,
            endAt: 2_000,
            isHalfWidth: false,
            isFree: false,
        });

        expect(findChannleTypes).toHaveBeenCalledExactlyOnceWith(['CS', 'SKY'], true);
        expect(findSchedule).toHaveBeenCalledExactlyOnceWith({
            startAt: 1_000,
            endAt: 2_000,
            isHalfWidth: false,
            types: ['CS', 'SKY'],
            isFree: false,
        });
    });

    // BS4KはGR/BS/CS/SKYと対等な5つ目のtype。option.BS4K === trueのときだけtypesへ加わる
    // （L47-56相当）。既存のGR/BS/CS/SKYは無条件（BS4Kを渡さない呼び出しでも、BS4K対応前と同じtypesになることを確認する）。
    it('[R2-SCHEDULEAPI-BS4K-TYPE] passes BS4K into channel and program lookups when option.BS4K is true', async () => {
        const findChannleTypes = vi.fn(async () => []);
        const findSchedule = vi.fn(async () => []);
        const model = new ScheduleApiModel({ findChannleTypes }, { findSchedule });

        await model.getSchedules({
            GR: false,
            BS: false,
            CS: false,
            SKY: false,
            BS4K: true,
            startAt: 1_000,
            endAt: 2_000,
            isHalfWidth: false,
            isFree: false,
        });

        expect(findChannleTypes).toHaveBeenCalledExactlyOnceWith(['BS4K'], true);
        expect(findSchedule).toHaveBeenCalledExactlyOnceWith({
            startAt: 1_000,
            endAt: 2_000,
            isHalfWidth: false,
            types: ['BS4K'],
            isFree: false,
        });
    });

    it('[R2-SCHEDULEAPI-BS4K-OMITTED-UNCHANGED] omitting option.BS4K keeps the existing GR/BS/CS/SKY-only behavior unchanged', async () => {
        const findChannleTypes = vi.fn(async () => []);
        const findSchedule = vi.fn(async () => []);
        const model = new ScheduleApiModel({ findChannleTypes }, { findSchedule });

        await model.getSchedules({
            GR: true,
            BS: false,
            CS: true,
            SKY: false,
            startAt: 1_000,
            endAt: 2_000,
            isHalfWidth: false,
            isFree: false,
        });

        expect(findChannleTypes).toHaveBeenCalledExactlyOnceWith(['GR', 'CS'], true);
        expect(findSchedule).toHaveBeenCalledExactlyOnceWith({
            startAt: 1_000,
            endAt: 2_000,
            isHalfWidth: false,
            types: ['GR', 'CS'],
            isFree: false,
        });
    });
});
