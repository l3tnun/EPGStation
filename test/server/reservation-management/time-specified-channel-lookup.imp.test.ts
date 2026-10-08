import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeModel } from './_harness';

afterEach(() => vi.useRealTimers());

describe('[RM-9.2] time-specified rule reservations skip channels that cannot be resolved', () => {
    it('logs a channel lookup failure and an unknown channel, and reserves only the resolvable channel', async () => {
        vi.useFakeTimers();
        const baseTime = new Date('2026-09-24T00:00:00+09:00').getTime();
        vi.setSystemTime(baseTime);
        const ruleId = 31;
        const lookupFailure = new Error('synthetic-channel-lookup-failure');
        const channel = { id: 12, channel: 'synthetic-resolved-channel', channelType: 'GR' };
        const findId = vi.fn(async (id: number) => {
            if (id === 10) throw lookupFailure;
            return id === 12 ? channel : null;
        });
        const harness = makeModel({
            channelDB: { findId },
            ruleDB: {
                findId: vi.fn(async () => ({
                    id: ruleId,
                    updateCnt: 1,
                    isTimeSpecification: true,
                    searchOption: {
                        keyword: 'synthetic-keyword',
                        channelIds: [10, 11, 12],
                        times: [{ week: 0x10, start: 3600, range: 3600 }],
                    },
                    reserveOption: { enable: true, allowEndLack: false },
                })),
                getIds: vi.fn(async () => []),
            },
        });

        await harness.model.updateRule(ruleId);

        expect(findId.mock.calls).toEqual([[10], [11], [12]]);
        expect(harness.log.system.error).toHaveBeenCalledWith('get channel id error: 10');
        expect(harness.log.system.error).toHaveBeenCalledWith('channel id is not found: 11');
        expect(harness.reserveDB.updateMany).toHaveBeenCalledTimes(1);
        const arg = harness.reserveDB.updateMany.mock.calls[0][0] as { insert: Array<Record<string, unknown>> };
        // 1週間分（8日）のうち該当する曜日は2回あり、どちらも解決できた局の予約だけになる。
        const week = 7 * 24 * 3_600_000;
        expect(arg.insert).toHaveLength(2);
        expect(arg.insert).toEqual([
            expect.objectContaining({
                channel: 'synthetic-resolved-channel',
                channelId: 12,
                channelType: 'GR',
                endAt: baseTime + 7_200_000,
                isTimeSpecified: true,
                startAt: baseTime + 3_600_000,
            }),
            expect.objectContaining({
                channelId: 12,
                endAt: baseTime + week + 7_200_000,
                startAt: baseTime + week + 3_600_000,
            }),
        ]);
    });
});
