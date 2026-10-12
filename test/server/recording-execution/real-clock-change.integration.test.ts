import 'reflect-metadata';

import type { DataSource } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeReserve, RecordingStreamCreator } from './_harness';
import { createRealTuner, insertReserve, withSqlite, wireRecording } from './_real-tuner-wiring';

/*
 * 時計が変わったときの録画の経路を、本物の部品の上で確かめる。予約は実 SQLite の行、`RecordingManageModel` の scheduler・
 * `RecorderModel`・`RecordingStreamCreator`・`TunerServerAccessModel` は本物、tuner server は実 HTTP の代わり。
 * 時計だけを時計の部品（vitest の fake timer と偽の `Date`）に差し替え、timer を進めずに `setSystemTime` で
 * システム時計を進める・戻す。この環境には faketime も root も無いので、OS の時計そのものは変えられない。
 */

const START = Date.UTC(2030, 0, 1);
const HOUR = 3_600_000;
const SCAN = 3_000;
const PREPARATION_LEAD_MS = 15_000;
const realSetTimeout = setTimeout;
const realNow = Date.now.bind(Date);
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
    vi.useRealTimers();
    while (cleanups.length > 0) await cleanups.pop()!();
});

const installClock = (): void => {
    vi.useFakeTimers({ now: START, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
};

/** 実時間で条件が成り立つのを待つ（fake timer を入れている間も使える）。 */
const until = async (predicate: () => boolean, timeoutMs = 10_000): Promise<void> => {
    const deadline = realNow() + timeoutMs;
    while (!predicate()) {
        if (realNow() > deadline) throw new Error('until: the condition did not become true in time');
        await new Promise<void>(resolve => realSetTimeout(resolve, 10));
    }
};
const settle = (ms = 100): Promise<void> => new Promise(resolve => realSetTimeout(resolve, ms));

const setup = async (source: DataSource, root: string) => {
    const tuner = await createRealTuner({ establishmentTimeoutMs: 5_000 });
    tuner.server.autoData = true;
    const wired = wireRecording(source, root, tuner, { tuners: [{ types: ['GR'] }, { types: ['GR'] }] });
    cleanups.push(async () => {
        await wired.shutdown();
        await tuner.close();
    });
    return { server: tuner.server, wired };
};

describe('the real scheduler when the system clock changes', () => {
    it('[RE-REAL-CLOCK-FORWARD] starts the preparation within one scan after the system clock jumps to just before it, without any timer having elapsed', async () => {
        await withSqlite(async (source, root) => {
            installClock();
            const { server, wired } = await setup(source, root);
            await insertReserve(source, {
                id: 1,
                programId: 101,
                channelId: 11,
                channel: 'a',
                startAt: START + HOUR,
                endAt: START + HOUR + 60_000,
            });
            await wired.manager.rebuildCandidatesAndStart();
            await vi.advanceTimersByTimeAsync(SCAN);
            await settle();
            expect(server.streamRequests('program', 101)).toEqual([]);

            // timer は進めずに、システム時計だけを準備の 10 秒前（開始の 25 秒前）から 5 秒後へ進める
            vi.setSystemTime(START + HOUR - PREPARATION_LEAD_MS + 5_000);
            await vi.advanceTimersByTimeAsync(SCAN);
            await until(() => server.streamRequests('program', 101).length === 1);
            expect(server.streamRequests('program', 101)).toHaveLength(1);
        });
    }, 30_000);

    it('[RE-REAL-CLOCK-BACKWARD] does not start a preparation while the clock is set back, and follows the clock again when it moves forward', async () => {
        await withSqlite(async (source, root) => {
            installClock();
            const { server, wired } = await setup(source, root);
            await insertReserve(source, {
                id: 2,
                programId: 102,
                channelId: 12,
                channel: 'b',
                startAt: START + 2 * HOUR,
                endAt: START + 2 * HOUR + 60_000,
            });
            await wired.manager.rebuildCandidatesAndStart();

            // 準備の直前まで進めた時計を、1 時間前へ戻す。戻した間は、timer が何周しても準備は始まらない
            vi.setSystemTime(START + 2 * HOUR - PREPARATION_LEAD_MS - 5_000);
            await vi.advanceTimersByTimeAsync(SCAN);
            await settle();
            expect(server.streamRequests('program', 102)).toEqual([]);
            vi.setSystemTime(START + HOUR);
            for (let scan = 0; scan < 5; scan += 1) await vi.advanceTimersByTimeAsync(SCAN);
            await settle();
            expect(server.streamRequests('program', 102)).toEqual([]);

            // 戻した時計が準備の時刻に着くと、次の確認で準備が始まる
            vi.setSystemTime(START + 2 * HOUR - PREPARATION_LEAD_MS + 1_000);
            await vi.advanceTimersByTimeAsync(SCAN);
            await until(() => server.streamRequests('program', 102).length === 1);
        });
    }, 30_000);

    it('[RE-REAL-CLOCK-END] finishes a time-specified recording within one scan after the system clock jumps past its end', async () => {
        await withSqlite(async (source, root) => {
            installClock();
            const { server, wired } = await setup(source, root);
            const startAt = START + 30_000;
            const endAt = START + 10 * HOUR;
            await insertReserve(source, {
                id: 3,
                programId: null,
                isTimeSpecified: true,
                channelId: 13,
                channel: 'c',
                startAt,
                endAt,
            });
            await wired.manager.rebuildCandidatesAndStart();
            await vi.advanceTimersByTimeAsync(startAt - START - PREPARATION_LEAD_MS + SCAN);
            await until(() => server.streamRequests('service', 13).length === 1);
            // 録画は開始時刻になってから始まる。stream の応答（実 I/O）が届く時刻は読めないので、時計を少しずつ進めて待つ
            for (let step = 0; step < 100 && wired.started.mock.calls.length === 0; step += 1) {
                await vi.advanceTimersByTimeAsync(1_000);
                await settle(30);
            }
            expect(wired.started).toHaveBeenCalledTimes(1);
            expect(wired.finished).not.toHaveBeenCalled();

            // timer は進めずに、システム時計だけを終了時刻の後へ進める
            vi.setSystemTime(endAt + 1_000);
            await vi.advanceTimersByTimeAsync(SCAN);
            await until(() => wired.finished.mock.calls.length === 1, 15_000);
            expect(wired.finished).toHaveBeenCalledTimes(1);
        });
    }, 40_000);
});

describe('the tuner occupancy table of the recording stream creator', () => {
    it('[REC-026] drops an occupancy whose end was never notified only after twelve hours past its end, at the next half-hour sweep', async () => {
        installClock();
        const tuner = await createRealTuner({ establishmentTimeoutMs: 5_000 });
        cleanups.push(() => tuner.close());
        const log = {
            system: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
            stream: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
        };
        const creator = new RecordingStreamCreator(
            { getLogger: () => log },
            { getConfig: () => ({ conflictPriority: 9, recPriority: 2, timeSpecifiedEndMargin: 0 }) },
            tuner.access,
        );
        creator.setTuner([{ types: ['GR'] }]);
        const warnings = (): number =>
            log.system.warn.mock.calls.filter(([message]) => String(message).startsWith('TunerAssignmentError')).length;
        const open = async (id: number) => {
            const stream = await creator.create(
                makeReserve({ id, programId: id, channel: `ch-${id}`, startAt: START - 60_000, endAt: START + 60_000 }),
            );
            cleanups.push(() => stream.destroy());
            return stream;
        };

        // 1 本目の stream は開いたまま終わらない（終了の通知が来ない）。tuner はその予約に占有されている
        await open(31);
        await open(32);
        expect(warnings()).toBe(1);

        // 終了時刻の 12 時間後の直前までは、占有は残る（30 分ごとの掃除は走るが、12 時間未満は消さない）
        await vi.advanceTimersByTimeAsync(12 * HOUR);
        await open(33);
        expect(warnings()).toBe(2);

        // 12 時間を過ぎた次の掃除で占有が消え、次の予約は tuner を占有できる（占有できない警告が増えない）
        await vi.advanceTimersByTimeAsync(HOUR / 2);
        await open(34);
        expect(warnings()).toBe(2);
        // 占有した予約が台帳に載っているので、その次の別の局は占有できない
        await open(35);
        expect(warnings()).toBe(3);
        // 掃除は台帳の記録を消すだけで、最初の予約の stream を閉じない
        expect(tuner.server.closedAt.has('program:31')).toBe(false);
    }, 30_000);
});
