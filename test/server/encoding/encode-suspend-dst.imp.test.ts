import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required');
}

interface Step {
    atMinutes: number;
    action: 'push' | 'observe';
}

interface Scenario {
    start: [number, number, number, number, number];
    ranges: Array<{ start: string; end: string }>;
    concurrentEncodeNum: number;
    steps: Step[];
}

// America/New_York の 2026 年のサマータイムは、3 月 8 日 02:00 に 03:00 へ進み、11 月 1 日 02:00 に 01:00 へ戻る。
const SCENARIOS: Record<string, Scenario> = {
    // 時計が進む日。01:30 から 04:00 までは実時間で 90 分しかない
    springEndAfterGap: {
        start: [2026, 2, 8, 1, 30],
        ranges: [{ start: '01:00', end: '04:00' }],
        concurrentEncodeNum: 1,
        steps: [
            { atMinutes: 0, action: 'push' },
            { atMinutes: 89, action: 'observe' },
            { atMinutes: 91, action: 'observe' },
        ],
    },
    // 時計が進む日に、終了時刻が飛ばされる 1 時間の中にある。03:00 になった時点で時間帯の外になる
    springEndInsideGap: {
        start: [2026, 2, 8, 1, 50],
        ranges: [{ start: '01:45', end: '02:30' }],
        concurrentEncodeNum: 1,
        steps: [
            { atMinutes: 0, action: 'push' },
            { atMinutes: 9, action: 'observe' },
            { atMinutes: 11, action: 'observe' },
        ],
    },
    // 時計が戻る日。00:30 から 2 度目の 02:00 までは実時間で 150 分ある
    fallEndAfterRepeat: {
        start: [2026, 10, 1, 0, 30],
        ranges: [{ start: '00:00', end: '02:00' }],
        concurrentEncodeNum: 1,
        steps: [
            { atMinutes: 0, action: 'push' },
            { atMinutes: 149, action: 'observe' },
            { atMinutes: 151, action: 'observe' },
        ],
    },
    // 時計が戻る日。繰り返される 01:00〜01:30 は、1 度目も 2 度目も時間帯に含まれる
    fallRepeatedHour: {
        start: [2026, 10, 1, 1, 10],
        ranges: [{ start: '01:00', end: '01:30' }],
        concurrentEncodeNum: 2,
        steps: [
            { atMinutes: 0, action: 'push' },
            { atMinutes: 19, action: 'observe' },
            { atMinutes: 21, action: 'observe' },
            { atMinutes: 60, action: 'push' },
            { atMinutes: 79, action: 'observe' },
            { atMinutes: 81, action: 'observe' },
        ],
    },
};

const runInTimeZone = async (timeZone: string): Promise<unknown> => {
    const { stdout } = await promisify(execFile)(
        process.execPath,
        [join(import.meta.dirname, 'fixtures', 'suspend-dst-child.mjs')],
        {
            env: {
                ...process.env,
                TZ: timeZone,
                ENCODE_MANAGE_MODEL_URL: pathToFileURL(
                    join(compiledSnapshot, 'model', 'service', 'encode', 'EncodeManageModel.js'),
                ).href,
                ENCODE_EVENT_URL: pathToFileURL(join(compiledSnapshot, 'model', 'event', 'EncodeEvent.js')).href,
                SUSPEND_DST_SCENARIOS: JSON.stringify(SCENARIOS),
            },
        },
    );

    return JSON.parse(stdout);
};

describe('encode suspend times across daylight saving time', () => {
    it('[EN-IMP-SUSPEND-TIMES-DST] judges by the local wall clock and resumes within a minute of the end across both transitions', async () => {
        const results = await runInTimeZone('America/New_York');

        expect(results).toEqual({
            springEndAfterGap: [
                { atMinutes: 89, wallClock: '03:59', started: [false] },
                { atMinutes: 91, wallClock: '04:01', started: [true] },
            ],
            springEndInsideGap: [
                { atMinutes: 9, wallClock: '01:59', started: [false] },
                { atMinutes: 11, wallClock: '03:01', started: [true] },
            ],
            fallEndAfterRepeat: [
                { atMinutes: 149, wallClock: '01:59', started: [false] },
                { atMinutes: 151, wallClock: '02:01', started: [true] },
            ],
            fallRepeatedHour: [
                { atMinutes: 19, wallClock: '01:29', started: [false] },
                { atMinutes: 21, wallClock: '01:31', started: [true] },
                { atMinutes: 79, wallClock: '01:29', started: [true, false] },
                { atMinutes: 81, wallClock: '01:31', started: [true, true] },
            ],
        });
    });
});
