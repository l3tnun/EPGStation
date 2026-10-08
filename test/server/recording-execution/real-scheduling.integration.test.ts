import 'reflect-metadata';

import { readdir } from 'node:fs/promises';
import type { DataSource } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeReserve, Reserve } from './_harness';
import { createRealTuner, insertReserve, withSqlite, wireRecording } from './_real-tuner-wiring';

/*
 * 予約が録画の対象になり、録画の準備が始まる時点を、本物の部品の上で確かめる。予約は実 SQLite の行、
 * 録画の経路（`RecordingManageModel` の scheduler・`RecorderModel`・`RecordingStreamCreator`・
 * `TunerServerAccessModel`）は本物、tuner server は実 HTTP の代わり。準備の開始は、tuner server に stream の
 * request が届くかどうかとその時刻で見る。時計は実時計（準備は開始の 15 秒前、scheduler は 3 秒ごとに見直す）。
 */

const PREPARATION_LEAD_MS = 15_000;
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
});

const setup = async (source: DataSource, root: string, config: Record<string, unknown> = {}) => {
    const tuner = await createRealTuner({ establishmentTimeoutMs: 5_000 });
    // 本物の tuner server は stream を開くとすぐ放送の data を送り始める。
    tuner.server.autoData = true;
    const wired = wireRecording(source, root, tuner, { config, tuners: [{ types: ['GR'] }, { types: ['GR'] }] });
    cleanups.push(async () => {
        await wired.shutdown();
        await tuner.close();
    });
    return { server: tuner.server, wired };
};

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

/** 準備が始まる時刻の `leadMs` 後が、開始時刻になる予約の時刻。 */
const startIn = (preparationInMs: number) => {
    const now = Date.now();
    return {
        startAt: now + PREPARATION_LEAD_MS + preparationInMs,
        endAt: now + PREPARATION_LEAD_MS + preparationInMs + 60_000,
    };
};

describe('which reservations the real scheduler prepares, and with which priority', () => {
    it('[RE-REAL-CANDIDATES] requests the stream of normal and conflict reservations at their own priority, and never requests skip or overlap reservations', async () => {
        await withSqlite(async (source, root) => {
            const { server, wired } = await setup(source, root);
            const window = startIn(2_000);
            await insertReserve(source, { id: 1, programId: 101, channelId: 11, channel: 'a', ...window });
            await insertReserve(source, {
                id: 2,
                programId: 102,
                channelId: 12,
                channel: 'b',
                isConflict: true,
                ...window,
            });
            await insertReserve(source, {
                id: 3,
                programId: 103,
                channelId: 13,
                channel: 'c',
                isSkip: true,
                ...window,
            });
            await insertReserve(source, {
                id: 4,
                programId: 104,
                channelId: 14,
                channel: 'd',
                isOverlap: true,
                ...window,
            });
            await wired.manager.rebuildCandidatesAndStart();

            // 準備の時刻になるまでは、どの予約の stream も要求されない。
            expect(server.streamRequests('program')).toEqual([]);
            await vi.waitFor(() => expect(server.streamRequests('program', 101)).toHaveLength(1), {
                interval: 50,
                timeout: 8_000,
            });
            await vi.waitFor(() => expect(server.streamRequests('program', 102)).toHaveLength(1), {
                interval: 50,
                timeout: 8_000,
            });
            expect(server.streamRequests('program', 101)[0].headers['x-mirakurun-priority']).toBe('2');
            expect(server.streamRequests('program', 102)[0].headers['x-mirakurun-priority']).toBe('9');

            // 除外・重複の予約は、開始時刻を過ぎても要求されない。
            await delay(Math.max(0, window.startAt + 500 - Date.now()));
            expect(server.streamRequests('program', 103)).toEqual([]);
            expect(server.streamRequests('program', 104)).toEqual([]);
            expect(
                server
                    .streamRequests('program')
                    .map(request => request.url)
                    .sort(),
            ).toEqual(['/api/programs/101/stream?decode=1', '/api/programs/102/stream?decode=1']);
        });
    }, 60_000);
});

describe('a reservation that becomes due is dispatched exactly once by the real scheduler', () => {
    it('[RE-REAL-DISPATCH-ONCE] requests the stream when the real clock reaches the preparation time, and not before or again after', async () => {
        await withSqlite(async (source, root) => {
            const { server, wired } = await setup(source, root);
            const registeredAt = Date.now();
            const window = startIn(4_000);
            await insertReserve(source, { id: 1, programId: 101, channelId: 11, channel: 'a', ...window });
            await wired.manager.rebuildCandidatesAndStart();

            expect(server.streamRequests('program')).toEqual([]);
            await vi.waitFor(() => expect(server.streamRequests('program', 101)).toHaveLength(1), {
                interval: 50,
                timeout: 20_000,
            });
            // The lower bound is deterministic: the preparation time is `window.startAt - 15 s`, which is 4 s
            // after the reservation was written. The scheduler can only be late, never early.
            expect(Date.now() - registeredAt).toBeGreaterThanOrEqual(3_900);

            // Two further 3 s scheduler scans pass: the same reservation must not be dispatched again.
            await delay(7_000);
            expect(server.streamRequests('program')).toHaveLength(1);
        });
    }, 60_000);
});

describe('re-evaluating the preparation time when reservations change before it starts', () => {
    it('[RE-REAL-MUTATION] follows a changed start time, a deleted reservation, and an added reservation by the time and the presence of the stream request', async () => {
        await withSqlite(async (source, root) => {
            const { server, wired } = await setup(source, root);
            const soon = startIn(4_000);
            const moved = await insertReserve(source, { id: 1, programId: 101, channelId: 11, channel: 'a', ...soon });
            const deleted = await insertReserve(source, {
                id: 2,
                programId: 102,
                channelId: 12,
                channel: 'b',
                ...soon,
            });
            const advanced = await insertReserve(source, {
                id: 3,
                programId: 103,
                channelId: 13,
                channel: 'c',
                ...startIn(600_000),
            });
            await wired.manager.rebuildCandidatesAndStart();

            // 1 は遅い時刻へ、3 は近い時刻へ変更し、2 は削除する。
            const startedAt = Date.now();
            const later = startIn(600_000);
            const nearer = startIn(1_500);
            await source.getRepository(Reserve).update(1, later);
            await source.getRepository(Reserve).update(3, nearer);
            await source.getRepository(Reserve).delete(2);
            await wired.manager.update({
                update: [Object.assign(moved, later), Object.assign(advanced, nearer)],
                delete: [deleted],
                isSuppressLog: false,
            });

            await vi.waitFor(() => expect(server.streamRequests('program', 103)).toHaveLength(1), {
                interval: 50,
                timeout: 9_000,
            });
            const requestedAfter = server.streamRequests('program', 103)[0].at - startedAt;
            expect(requestedAfter).toBeGreaterThanOrEqual(1_000);
            expect(requestedAfter).toBeLessThan(8_000);

            // もとの準備の時刻（4 秒後）を過ぎても、1 と 2 は要求されない。
            await delay(Math.max(0, startedAt + 4_000 + 3_500 - Date.now()));
            expect(server.streamRequests('program', 101)).toEqual([]);
            expect(server.streamRequests('program', 102)).toEqual([]);
        });
    }, 60_000);

    it('[RE-REAL-REPLACED-ID] prepares only the latest reservation after a reservation id is deleted and added again many times in a row', async () => {
        await withSqlite(async (source, root) => {
            const { server, wired } = await setup(source, root);
            const window = startIn(3_000);
            let current = await insertReserve(source, {
                id: 1,
                programId: 200,
                channelId: 11,
                channel: 'a',
                ...window,
            });
            await wired.manager.rebuildCandidatesAndStart();

            for (let round = 1; round <= 30; round++) {
                const previous = current;
                await source.getRepository(Reserve).delete(1);
                await wired.manager.update({ delete: [previous], isSuppressLog: true });
                current = await insertReserve(source, {
                    id: 1,
                    programId: 200 + round,
                    channelId: 11,
                    channel: 'a',
                    ...window,
                });
                await wired.manager.update({ insert: [current], isSuppressLog: true });
            }

            await vi.waitFor(() => expect(server.streamRequests('program', 230)).toHaveLength(1), {
                interval: 50,
                timeout: 10_000,
            });
            await delay(3_500);
            expect(server.streamRequests('program').map(request => request.url)).toEqual([
                '/api/programs/230/stream?decode=1',
            ]);
        });
    }, 60_000);
});

describe('how many timers the real scheduler holds for far-future reservations', () => {
    it('[RE-REAL-TIMER-COUNT] holds a bounded number of timers for hundreds of reservations that start far in the future', async () => {
        await withSqlite(async (source, root) => {
            const { wired } = await setup(source, root);
            const farFuture = startIn(10 * 24 * 60 * 60 * 1_000);
            const rows = Array.from({ length: 600 }, (_unused, index) =>
                makeReserve({
                    id: 1_000 + index,
                    programId: 5_000 + index,
                    channelId: 11,
                    channel: 'a',
                    updateTime: Date.now(),
                    ...farFuture,
                }),
            );
            await source.getRepository(Reserve).insert(rows);
            const timers = () => process.getActiveResourcesInfo().filter(resource => resource === 'Timeout').length;
            const before = timers();

            await wired.manager.rebuildCandidatesAndStart();
            await vi.waitFor(() => expect(wired.provider).toHaveBeenCalledTimes(600), { timeout: 20_000 });

            expect(timers() - before).toBeLessThan(10);
        });
    }, 90_000);
});

describe('a reservation that is deleted or skipped while its stream is still being opened', () => {
    const files = async (root: string) => (await readdir(root)).filter(name => name.endsWith('.ts'));

    it.each(['deleted', 'skipped'] as const)(
        '[RE-REAL-RECHECK] creates no recording file and records nothing when the reservation is %s during the stream request',
        async change => {
            await withSqlite(async (source, root) => {
                const { server, wired } = await setup(source, root);
                server.behave('program', 101, { kind: 'stream', headerDelayMs: 1_500 });
                const reservation = await insertReserve(source, {
                    id: 1,
                    programId: 101,
                    channelId: 11,
                    channel: 'a',
                    ...startIn(1_500),
                });
                await wired.manager.rebuildCandidatesAndStart();
                await vi.waitFor(() => expect(server.streamRequests('program', 101)).toHaveLength(1), {
                    interval: 50,
                    timeout: 8_000,
                });

                if (change === 'deleted') {
                    await source.getRepository(Reserve).delete(1);
                    await wired.manager.update({ delete: [reservation], isSuppressLog: false });
                } else {
                    await source.getRepository(Reserve).update(1, { isSkip: true });
                    await wired.manager.update({
                        update: [Object.assign(reservation, { isSkip: true })],
                        isSuppressLog: false,
                    });
                }

                // 応答が届いても、録画は始まらない。
                await delay(2_500);
                expect(wired.started).not.toHaveBeenCalled();
                expect(await files(root)).toEqual([]);
                expect(await wired.recordedDB.findReserveId(1)).toEqual([]);
                await vi.waitFor(() => expect(server.closedAt.has('program:101')).toBe(true));
            });
        },
        60_000,
    );
});
