import 'reflect-metadata';

import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { Reserve } from './_harness';
import { createRealTuner, insertReserve, withSqlite, wireRecording } from './_real-tuner-wiring';

/*
 * 放送ストリームを取得できない録画の準備の再試行を、本物の部品の上で確かめる。tuner server は実 HTTP の代わりで、
 * stream の要求を 503 で失敗させ続ける。要求の間隔・回数・終わる時刻は server が受け取った実測、
 * 準備失敗の通知と運用 log の内容は録画の経路が出した実物で見る。時計は実時計（再試行の間隔は 5 秒）。
 */

const PREPARATION_LEAD_MS = 15_000;
const createLog = () => ({
    system: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
    stream: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
});

/** 並行して流す test が互いの後始末を巻き込まないよう、後始末は test ごとに持つ。 */
const withSetup = async (operation: (context: Awaited<ReturnType<typeof setup>>) => Promise<void>): Promise<void> =>
    withSqlite(async (source, root) => {
        const context = await setup(source, root);
        try {
            await operation(context);
        } finally {
            await context.dispose();
        }
    });

const setup = async (source: DataSource, root: string) => {
    const tuner = await createRealTuner({ establishmentTimeoutMs: 5_000 });
    tuner.server.autoData = true;
    const log = createLog();
    const wired = wireRecording(source, root, tuner, { log, tuners: [{ types: ['GR'] }] });
    const dispose = async (): Promise<void> => {
        await wired.shutdown();
        await tuner.close();
    };
    return { dispose, log, server: tuner.server, source, wired };
};

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const messages = (calls: unknown[][]): string[] => calls.map(([message]) => String(message));
const gaps = (times: readonly number[]): number[] => times.slice(1).map((time, index) => time - times[index]);

describe('retrying the stream request of a preparation that keeps failing', () => {
    it.concurrent(
        '[RE-REAL-RETRY-PROGRAM] retries a program reservation every five seconds until its end time, then reports the preparation failure once, with one log line per failure and a summary',
        async () => {
            await withSetup(async ({ log, server, source, wired }) => {
                server.behave('program', 101, { kind: 'status', status: 503 });
                const now = Date.now();
                const startAt = now + PREPARATION_LEAD_MS + 500;
                const endAt = startAt + 24_000;
                await insertReserve(source, { id: 1, programId: 101, channelId: 11, channel: 'a', startAt, endAt });
                await wired.manager.rebuildCandidatesAndStart();

                await vi.waitFor(() => expect(wired.prepFailed).toHaveBeenCalledOnce(), {
                    interval: 100,
                    timeout: 50_000,
                });
                const failedAt = Date.now();
                const attempts = server.streamRequests('program', 101).map(request => request.at);

                // 初回と 3 回の再試行を超えて、終了時刻まで 5 秒間隔で続く。
                expect(attempts.length).toBeGreaterThanOrEqual(5);
                for (const gap of gaps(attempts)) {
                    expect(gap).toBeGreaterThanOrEqual(4_900);
                    expect(gap).toBeLessThan(9_000);
                }
                // 失敗の通知は、終了時刻に達した後に 1 回だけ。その後は要求しない。
                expect(failedAt).toBeGreaterThanOrEqual(endAt);
                // 再試行は、失敗した時点で終了時刻の前であれば続く。最後の要求だけは終了時刻の後（5 秒以内）に出る。
                expect(attempts[attempts.length - 2]).toBeLessThan(endAt);
                expect(attempts[attempts.length - 1]).toBeGreaterThanOrEqual(endAt - 200);
                expect(attempts[attempts.length - 1]).toBeLessThan(endAt + 9_000);
                await delay(6_000);
                expect(server.streamRequests('program', 101)).toHaveLength(attempts.length);
                expect(wired.prepFailed).toHaveBeenCalledOnce();
                expect(wired.started).not.toHaveBeenCalled();

                // 運用 log: 最初の 4 回は 1 回ごと、それ以降は通知の前に 1 回にまとめる（回数と最後のエラー）。
                const errors = messages(log.system.error.mock.calls);
                expect(errors.filter(message => message === 'preprec failed: 1')).toHaveLength(4);
                const summaries = errors.filter(message => message.startsWith('preprec failed: 1 ('));
                expect(summaries).toEqual([
                    `preprec failed: 1 (${attempts.length - 4} failures since the last log, ${attempts.length} in total)`,
                ]);
                const lastError = log.system.error.mock.calls[log.system.error.mock.calls.length - 1][0];
                expect(lastError).toBeInstanceOf(Error);
                expect((lastError as Error).message).toBe('Tuner request failed with status 503');
            });
        },
        90_000,
    );

    it.concurrent(
        '[RE-REAL-RETRY-TIME-SPECIFIED] retries a time-specified reservation three times at five-second intervals, then reports the preparation failure immediately',
        async () => {
            await withSetup(async ({ log, server, source, wired }) => {
                server.behave('service', 12, { kind: 'status', status: 503 });
                const startAt = Date.now() + PREPARATION_LEAD_MS + 500;
                await insertReserve(source, {
                    id: 2,
                    programId: null,
                    isTimeSpecified: true,
                    channelId: 12,
                    channel: 'b',
                    startAt,
                    endAt: startAt + 120_000,
                });
                await wired.manager.rebuildCandidatesAndStart();

                await vi.waitFor(() => expect(wired.prepFailed).toHaveBeenCalledOnce(), {
                    interval: 100,
                    timeout: 40_000,
                });
                const failedAt = Date.now();
                const attempts = server.streamRequests('service', 12).map(request => request.at);

                expect(attempts).toHaveLength(4);
                for (const gap of gaps(attempts)) {
                    expect(gap).toBeGreaterThanOrEqual(4_900);
                    expect(gap).toBeLessThan(9_000);
                }
                // 終了時刻はずっと先だが、回数に達した時点で直ちに通知する。
                expect(failedAt - attempts[3]).toBeLessThan(4_000);
                await delay(6_000);
                expect(server.streamRequests('service', 12)).toHaveLength(4);
                expect(wired.prepFailed).toHaveBeenCalledOnce();
                // 4 回の失敗はどれも 1 回ごとの記録で、まとめの記録は無い。
                const errors = messages(log.system.error.mock.calls);
                expect(errors.filter(message => message === 'preprec failed: 2')).toHaveLength(4);
                expect(errors.some(message => message.startsWith('preprec failed: 2 ('))).toBe(false);
            });
        },
        90_000,
    );

    it.concurrent(
        '[RE-REAL-RETRY-RECOVERED] logs the unlogged failures once when the stream is finally obtained and the recording starts',
        async () => {
            await withSetup(async ({ log, server, source, wired }) => {
                server.behave('program', 103, { kind: 'status', status: 503 });
                const startAt = Date.now() + PREPARATION_LEAD_MS + 500;
                await insertReserve(source, {
                    id: 3,
                    programId: 103,
                    channelId: 13,
                    channel: 'c',
                    startAt,
                    endAt: startAt + 120_000,
                });
                await wired.manager.rebuildCandidatesAndStart();

                // 5 回目の要求まで失敗させ、6 回目から成功させる。
                await vi.waitFor(() => expect(server.streamRequests('program', 103)).toHaveLength(5), {
                    interval: 100,
                    timeout: 40_000,
                });
                server.behave('program', 103, { kind: 'stream' });
                await vi.waitFor(() => expect(wired.started).toHaveBeenCalledOnce(), {
                    interval: 100,
                    timeout: 15_000,
                });

                const warnings = messages(log.system.warn.mock.calls);
                expect(warnings.filter(message => message.startsWith('preprec recovered: 3'))).toEqual([
                    'preprec recovered: 3 (1 failures since the last log, 5 in total)',
                ]);
                expect(wired.prepFailed).not.toHaveBeenCalled();
            });
        },
        90_000,
    );

    it.concurrent(
        '[RE-REAL-RETRY-CANCELED] logs the unlogged failures once when the preparation is canceled by deleting the reservation',
        async () => {
            await withSetup(async ({ log, server, source, wired }) => {
                server.behave('program', 104, { kind: 'status', status: 503 });
                const startAt = Date.now() + PREPARATION_LEAD_MS + 500;
                const reservation = await insertReserve(source, {
                    id: 4,
                    programId: 104,
                    channelId: 14,
                    channel: 'd',
                    startAt,
                    endAt: startAt + 120_000,
                });
                await wired.manager.rebuildCandidatesAndStart();

                // 6 回目の要求が server に届いた時点では、その失敗の応答が準備側へ戻って数えられたとは限らない。
                // 要求の到着を待つだけで予約を消すと、応答の途中の要求が取り消しで中断され、数に入らないことがある。
                // そこで 6 回目の後の要求は応答しない（7 回目が届いた時点で、6 回目までの失敗は必ず数え済み）。
                // 7 回目は応答の途中で取り消されるので、失敗としては数えられない。
                await vi.waitFor(() => expect(server.streamRequests('program', 104)).toHaveLength(6), {
                    interval: 100,
                    timeout: 45_000,
                });
                server.behave('program', 104, { kind: 'status', status: 503, delayMs: 60_000 });
                await vi.waitFor(() => expect(server.streamRequests('program', 104)).toHaveLength(7), {
                    interval: 100,
                    timeout: 15_000,
                });
                await source.getRepository(Reserve).delete(4);
                await wired.manager.update({ delete: [reservation], isSuppressLog: false });
                await delay(6_000);

                // 取り消した後は要求しない。
                expect(server.streamRequests('program', 104)).toHaveLength(7);
                const warnings = messages(log.system.warn.mock.calls);
                expect(warnings.filter(message => message.startsWith('preprec canceled: 4'))).toEqual([
                    'preprec canceled: 4 (2 failures since the last log, 6 in total)',
                ]);
                expect(wired.prepFailed).not.toHaveBeenCalled();
            });
        },
        90_000,
    );
});
