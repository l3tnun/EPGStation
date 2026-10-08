import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeReservationHarness, makeRule } from '../fixtures/reservation-rules/runtime';

const evaluatedAt = new Date('2030-01-07T00:00:00+09:00').getTime();

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});

const runTimeRule = async (channelIds: number[], times: Array<{ week: number; start: number; range: number }>) => {
    const channelDB = {
        findId: vi.fn(async (id: number) => ({
            id,
            channel: `synthetic-${id}`,
            channelType: 'GR',
            name: `Synthetic ${id}`,
        })),
    };
    const harness = makeReservationHarness({
        channelDB,
        ruleDB: {
            findId: vi.fn(async () =>
                makeRule({
                    isTimeSpecification: true,
                    searchOption: { keyword: 'synthetic time candidate', channelIds, times },
                }),
            ),
            getIds: vi.fn(),
        },
    });
    await harness.model.updateRule(17);
    const diff = harness.reserveDB.updateMany.mock.calls[0][0] as { insert: Array<Record<string, unknown>> };
    return { ...harness, candidates: diff.insert };
};

describe('time rule candidate expansion characterization', () => {
    it.each([
        ['empty channels', [], [{ week: 0x7f, start: 0, range: 60 }]],
        ['empty times', [101], []],
        ['weekday zero', [101], [{ week: 0, start: 0, range: 60 }]],
    ] as const)('produces zero candidates for %s', async (_name, channels, times) => {
        vi.useFakeTimers();
        vi.setSystemTime(evaluatedAt);

        const { candidates } = await runTimeRule([...channels], [...times]);

        expect(candidates).toEqual([]);
    });

    it('[RR-3.1] accepts the required keyword, channel list, and time-list shape', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(evaluatedAt);

        const { candidates } = await runTimeRule([101], [{ week: 0x7f, start: 0, range: 60 }]);

        expect(candidates).toEqual(
            expect.arrayContaining([expect.objectContaining({ name: 'synthetic time candidate' })]),
        );
    });

    it('[RR-3.2] uses a non-negative start and positive range to form a candidate interval', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(evaluatedAt);

        const { candidates } = await runTimeRule([101], [{ week: 0x7f, start: 0, range: 60 }]);

        expect(candidates[0]).toMatchObject({ endAt: evaluatedAt + 60_000, startAt: evaluatedAt });
    });

    it('[RR-3.3] accepts empty time selections while producing no candidates', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(evaluatedAt);

        for (const times of [[], [{ week: 0, start: 0, range: 60 }]]) {
            await expect(runTimeRule([101], times)).resolves.toMatchObject({ candidates: [] });
        }
    });

    it('[RR-3.4] anchors the local evaluation date at JST midnight before expanding weekdays', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(evaluatedAt);

        const { candidates } = await runTimeRule([101], [{ week: 0x7f, start: 0, range: 60 }]);

        expect(candidates[0].startAt).toBe(evaluatedAt);
    });

    it('[RR-3.5] expands today through seven days later, ordered by channel then day', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(evaluatedAt);

        const { candidates, programDB } = await runTimeRule([101], [{ week: 0x7f, start: 0, range: 60 }]);

        expect(candidates).toHaveLength(8);
        expect(candidates.map(candidate => candidate.startAt)).toEqual(
            Array.from({ length: 8 }, (_, day) => evaluatedAt + day * 86_400_000),
        );
        expect(candidates).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    channelId: 101,
                    channel: 'synthetic-101',
                    name: 'synthetic time candidate',
                    isTimeSpecified: true,
                }),
            ]),
        );
        expect(programDB.findRule).not.toHaveBeenCalled();
    });

    it('[RR-3.6] calculates candidate start and end timestamps from the specified seconds', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(evaluatedAt);

        const { candidates } = await runTimeRule([101], [{ week: 0x7f, start: 30, range: 90 }]);

        expect(candidates[0]).toMatchObject({ endAt: evaluatedAt + 120_000, startAt: evaluatedAt + 30_000 });
    });

    it('[RR-3.7] creates a time candidate without a Program lookup', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(evaluatedAt);

        const { candidates, programDB } = await runTimeRule([101], [{ week: 0x7f, start: 0, range: 60 }]);

        expect(candidates).toHaveLength(8);
        expect(programDB.findRule).not.toHaveBeenCalled();
    });

    it('[RR-3.8] applies the weekday selection to the start day of a multi-day range', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(evaluatedAt + 30_000);
        const weekday = new Date(evaluatedAt).getDay();

        const { candidates } = await runTimeRule(
            [202],
            [
                { week: 1 << weekday, start: 0, range: 172_800 },
                { week: 0x7f, start: -120, range: 60 },
            ],
        );

        expect(
            candidates.some(
                candidate => candidate.startAt === evaluatedAt && candidate.endAt === evaluatedAt + 172_800_000,
            ),
        ).toBe(true);
        expect(candidates.every(candidate => candidate.endAt >= evaluatedAt + 30_000)).toBe(true);
    });

    it('retains the exact endAt === evaluatedAt boundary', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(evaluatedAt);

        const { candidates } = await runTimeRule([303], [{ week: 0x7f, start: -60, range: 60 }]);

        expect(candidates).toEqual(
            expect.arrayContaining([expect.objectContaining({ startAt: evaluatedAt - 60_000, endAt: evaluatedAt })]),
        );
    });
});
