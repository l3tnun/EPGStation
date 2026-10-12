import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import {
    eventually,
    flush,
    Program,
    programRow,
    Recorded,
    RecordedHistory,
    ruleOption,
    settledHookLines,
    withWorld,
    type World,
} from './_real-workflow';

/*
 * 番組情報の更新完了とルールの変更を受けた後続処理を、本物の部品で確かめる。
 * 実 SQLite の DB、本物の ReservationManageModel・RuleManageModel・RecordedManageModel・event・EventSetter、実の子 process の
 * 外部コマンドを繋ぎ、画面向けの通知の送り口（IPC の notifyClient）だけを数える。結果は DB の行で見る。
 */

const DAY = 24 * 60 * 60 * 1000;

const reserveRows = async (world: World) => {
    const [rows] = (await world.reserveDB.findAll({ isHalfWidth: false })) as [Array<Record<string, any>>, number];
    return rows;
};

const ruleSearch = (keyword: string, reserveOption: Record<string, unknown> = {}) =>
    ruleOption({
        searchOption: { keyword, name: true, GR: true },
        reserveOption: { enable: true, allowEndLack: true, avoidDuplicate: false, ...reserveOption },
    });

/** 予約の変更の差分を覗く（EventSetter とは別の購読者として、本物の ReserveEvent に付ける）。 */
const watchReserveDiffs = (world: World) => {
    const diffs: Array<Record<string, any>> = [];
    world.events.reserve.setUpdated((diff: Record<string, any>) => {
        diffs.push(diff);
    });
    return diffs;
};

describe('program information update follow-ups on real components', () => {
    it('[WC-1.1][WC-1.2] cleans old recorded history rows after an EPG update, and still updates reservations when the cleanup fails', async () => {
        await withWorld({}, async world => {
            const now = Date.now();
            const history = (name: string, endAt: number) =>
                Object.assign(new RecordedHistory(), { channelId: 21, endAt, name });
            await world.save(RecordedHistory, [history('old', now - 30 * DAY), history('new', now - DAY)]);
            await world.save(Program, [programRow({ id: 1_101, name: 'synthetic manual' })]);
            const manualId = await world.reservation.add({ programId: 1_101, allowEndLack: true });
            world.setter.set();

            world.events.epg.emitUpdated();
            await eventually(async () => {
                const rows = (await world.recordedHistoryDB.findAll()) as Array<{ name: string }>;
                expect(rows.map(row => row.name)).toEqual(['new']);
            });

            // 履歴の整理が失敗する状態（行の削除を拒む trigger）でも、予約の更新は同じように進む。
            await world.save(RecordedHistory, [history('older', now - 40 * DAY)]);
            await world.query(
                "CREATE TRIGGER refuse_history_delete BEFORE DELETE ON recorded_history BEGIN SELECT RAISE(ABORT, 'refused'); END",
            );
            const changedStart = now + 5_400_000;
            await world.query('UPDATE program SET startAt = ?, endAt = ?, updateTime = updateTime + 1 WHERE id = 1101', [
                changedStart,
                changedStart + 600_000,
            ]);

            world.events.epg.emitUpdated();
            await eventually(async () => {
                expect(await world.reserveDB.findId(manualId)).toMatchObject({ startAt: changedStart });
            });
            const rows = (await world.recordedHistoryDB.findAll()) as Array<{ name: string }>;
            expect(rows.map(row => row.name).sort()).toEqual(['new', 'older']);
            expect(world.log.system.error).toHaveBeenCalled();
        });
    }, 60_000);

    it('[WC-1.3][WC-1.4][WC-1.5] updates manual and relay reservations and re-evaluates only enabled rules, handing over whether it is the first update', async () => {
        await withWorld({}, async world => {
            const now = Date.now();
            await world.save(Program, [
                programRow({ id: 1_201, eventId: 1_201, name: 'synthetic manual', startAt: now + 3_600_000, endAt: now + 4_200_000 }),
                programRow({ id: 1_202, eventId: 1_202, name: 'synthetic relay target', startAt: now + 10_800_000, endAt: now + 11_400_000 }),
                programRow({ id: 1_203, eventId: 1_203, name: 'rulematch drama', startAt: now + 18_000_000, endAt: now + 18_600_000 }),
            ]);
            const manualId = await world.reservation.add({ programId: 1_201, allowEndLack: true });
            const parent = await world.reserveDB.findId(manualId);
            const relayId = await world.reservation.addEventRelay(1_202, { ...parent, ruleId: 77 });
            expect(relayId).not.toBeNull();
            const enabledId = await world.ruleDB.insertOnce(ruleSearch('rulematch'));
            const disabledId = await world.ruleDB.insertOnce(ruleSearch('rulematch', { enable: false }));
            const diffs = watchReserveDiffs(world);
            world.setter.set();

            // 番組の開始時刻を動かしてから、最初の番組情報の更新を流す。
            const movedManual = now + 7_200_000;
            const movedRelay = now + 14_400_000;
            await world.query('UPDATE program SET startAt = ?, endAt = ?, updateTime = updateTime + 1 WHERE id = 1201', [movedManual, movedManual + 600_000]);
            await world.query('UPDATE program SET startAt = ?, endAt = ?, updateTime = updateTime + 1 WHERE id = 1202', [movedRelay, movedRelay + 600_000]);
            world.events.epg.emitUpdated();

            await eventually(async () => {
                const rows = await reserveRows(world);
                expect(rows.find(row => row.id === manualId)).toMatchObject({ startAt: movedManual });
                expect(rows.find(row => row.id === relayId)).toMatchObject({ startAt: movedRelay, isEventRelay: true });
                expect(rows.filter(row => row.ruleId === enabledId)).toHaveLength(1);
            });
            expect((await reserveRows(world)).filter(row => row.ruleId === disabledId)).toEqual([]);
            // 最初の更新だけ、録画側が候補を組み直すための印が付く。
            await eventually(() => expect(diffs.some(diff => diff.isStartupRebuild === true)).toBe(true));
            await new Promise(resolve => setTimeout(resolve, 300));

            diffs.length = 0;
            const movedAgain = now + 9_000_000;
            await world.query('UPDATE program SET startAt = ?, endAt = ?, updateTime = updateTime + 1 WHERE id = 1201', [movedAgain, movedAgain + 600_000]);
            world.events.epg.emitUpdated();
            await eventually(async () => {
                expect(await world.reserveDB.findId(manualId)).toMatchObject({ startAt: movedAgain });
            });
            expect(diffs.some(diff => diff.isStartupRebuild === true)).toBe(false);
        });
    }, 60_000);

    it('[WC-1.6][WC-1.10] recomputes the target rule reservations when a rule is added, changed, disabled, or enabled, and notifies the screen once per rule event', async () => {
        await withWorld({}, async world => {
            const now = Date.now();
            await world.save(Program, [
                programRow({ id: 1_301, eventId: 1_301, name: 'alpha show', startAt: now + 3_600_000, endAt: now + 4_200_000 }),
                programRow({ id: 1_302, eventId: 1_302, name: 'beta show', startAt: now + 7_200_000, endAt: now + 7_800_000 }),
            ]);
            world.setter.set();
            const ruleReserves = async (ruleId: number) =>
                (await reserveRows(world)).filter(row => row.ruleId === ruleId).map(row => row.programId);

            const ruleId = await world.ruleManage.add(ruleSearch('alpha'));
            await eventually(async () => expect(await ruleReserves(ruleId)).toEqual([1_301]));

            await world.ruleManage.update({ id: ruleId, ...ruleSearch('beta') });
            await eventually(async () => expect(await ruleReserves(ruleId)).toEqual([1_302]));

            await world.ruleManage.disable(ruleId);
            await eventually(async () => expect(await ruleReserves(ruleId)).toEqual([]));

            await world.ruleManage.enable(ruleId);
            await eventually(async () => expect(await ruleReserves(ruleId)).toEqual([1_302]));

            // ルールの変更ごとの画面向けの通知は 1 回ずつ。予約管理が出す予約の更新の通知は別に数える。
            await flush();
            await new Promise(resolve => setTimeout(resolve, 500));
            const reserveEvents = watchReserveDiffs(world);
            const idleId = await world.ruleManage.add(ruleSearch('nomatch'));
            await new Promise(resolve => setTimeout(resolve, 500));
            for (const operation of [
                () => world.ruleManage.update({ id: idleId, ...ruleSearch('nomatch-2') }),
                () => world.ruleManage.disable(idleId),
                () => world.ruleManage.enable(idleId),
                () => world.ruleManage.delete(idleId),
            ]) {
                world.ipc.notifyClient.mockClear();
                reserveEvents.length = 0;
                await operation();
                await new Promise(resolve => setTimeout(resolve, 500));
                expect(world.ipc.notifyClient.mock.calls.length - reserveEvents.length).toBe(1);
            }
        });
    }, 60_000);

    it('[WC-1.7][WC-1.8][WC-1.9] on rule deletion recomputes reservations and detaches recorded programs separately, without rolling either back when the other fails', async () => {
        await withWorld({}, async world => {
            const now = Date.now();
            await world.save(Program, [
                programRow({ id: 1_401, eventId: 1_401, name: 'gamma show', startAt: now + 3_600_000, endAt: now + 4_200_000 }),
                programRow({ id: 1_402, eventId: 1_402, name: 'delta show', startAt: now + 7_200_000, endAt: now + 7_800_000 }),
            ]);
            world.setter.set();
            const recordedFor = (ruleId: number, name: string) =>
                Object.assign(new Recorded(), {
                    channelId: 21,
                    duration: 60_000,
                    endAt: now - DAY + 60_000,
                    halfWidthName: name,
                    isProtected: false,
                    isRecording: false,
                    name,
                    ruleId,
                    startAt: now - DAY,
                });

            // 1) 関連付けの解除が失敗する状態でも、将来予約の再計算は進み、ルールの削除は戻らない。
            const gammaRule = await world.ruleManage.add(ruleSearch('gamma'));
            await eventually(async () =>
                expect((await reserveRows(world)).filter(row => row.ruleId === gammaRule)).toHaveLength(1),
            );
            const gammaRecordedId = await world.recordedDB.insertOnce(recordedFor(gammaRule, 'gamma recorded'));
            await world.query(
                "CREATE TRIGGER refuse_detach BEFORE UPDATE ON recorded BEGIN SELECT RAISE(ABORT, 'refused'); END",
            );
            await world.ruleManage.delete(gammaRule);
            await eventually(async () =>
                expect((await reserveRows(world)).filter(row => row.ruleId === gammaRule)).toEqual([]),
            );
            expect(await world.ruleDB.findId(gammaRule)).toBeNull();
            expect(await world.recordedDB.findId(gammaRecordedId)).toMatchObject({ ruleId: gammaRule });
            await world.query('DROP TRIGGER refuse_detach');

            // 2) 予約の再計算が失敗する状態でも、関連付けの解除は進み、ルールの削除は戻らない。
            const deltaRule = await world.ruleManage.add(ruleSearch('delta'));
            await eventually(async () =>
                expect((await reserveRows(world)).filter(row => row.ruleId === deltaRule)).toHaveLength(1),
            );
            const deltaRecordedId = await world.recordedDB.insertOnce(recordedFor(deltaRule, 'delta recorded'));
            await world.query(
                "CREATE TRIGGER refuse_reserve_delete BEFORE DELETE ON reserve BEGIN SELECT RAISE(ABORT, 'refused'); END",
            );
            await world.ruleManage.delete(deltaRule);
            await eventually(async () => {
                expect(await world.recordedDB.findId(deltaRecordedId)).toMatchObject({ ruleId: null });
            });
            expect(await world.ruleDB.findId(deltaRule)).toBeNull();
            expect((await reserveRows(world)).filter(row => row.ruleId === deltaRule)).toHaveLength(1);
        });
    }, 60_000);

    it('[WC-1.11] leaves candidate acceptance, conflict, and duplicate decisions to the reservation side', async () => {
        await withWorld({ tuners: [{ types: ['GR'] }] }, async world => {
            const now = Date.now();
            const start = now + 3_600_000;
            await world.save(Program, [
                programRow({ id: 1_501, eventId: 1_501, name: 'epsilon first', channelId: 21, startAt: start, endAt: start + 1_800_000 }),
                programRow({ id: 1_502, eventId: 1_502, serviceId: 22, channelId: 22, channel: 'synthetic-channel-2', name: 'epsilon second', startAt: start + 600_000, endAt: start + 2_400_000 }),
                programRow({ id: 1_503, eventId: 1_503, name: 'epsilon rerun', shortName: 'epsilon rerun', startAt: start + 7_200_000, endAt: start + 9_000_000 }),
            ]);
            await world.save(RecordedHistory, [
                Object.assign(new RecordedHistory(), { channelId: 21, endAt: now - 1_000, name: 'epsilon rerun' }),
            ]);
            world.setter.set();

            const ruleId = await world.ruleManage.add(ruleSearch('epsilon', { avoidDuplicate: true }));
            await eventually(async () => expect((await reserveRows(world)).filter(row => row.ruleId === ruleId)).toHaveLength(3));
            const rows = (await reserveRows(world)).filter(row => row.ruleId === ruleId);
            const byProgram = (programId: number) => rows.find(row => row.programId === programId)!;

            // 同時に受信できるのは 1 本なので、重なる 2 件のうち片方だけが競合になる。録画済みの履歴と同じ番組は重複になる。
            expect([byProgram(1_501).isConflict, byProgram(1_502).isConflict].filter(Boolean)).toHaveLength(1);
            expect(byProgram(1_503)).toMatchObject({ isOverlap: true, isConflict: false });
            // 連携機能は、判断された予約を取り消しも書き換えもしない（削除の外部コマンドも出ない）。
            await new Promise(resolve => setTimeout(resolve, 600));
            expect(await settledHookLines(world.hookLog, 3)).not.toContainEqual(expect.stringMatching(/^reserve-deleted/u));
            expect(world.log.system.error).not.toHaveBeenCalled();
        });
    }, 60_000);
});
