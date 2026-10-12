import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import {
    addWaitingReserve,
    eventually,
    Program,
    programRow,
    settledHookLines,
    startRecording,
    withWorld,
    type World,
} from './_real-workflow';
import { chunk } from '../recording-execution/_real-tuner-wiring';

/*
 * 予約の変更と録画の準備・開始・失敗を受けた後続処理を、本物の部品で確かめる。
 * 実 SQLite、実 HTTP の tuner server、本物の ReservationManageModel・RecordingManageModel・RecorderModel・
 * RecordedTagManadeModel・event・EventSetter、実の子 process の外部コマンドを繋ぎ、画面向けの通知の送り口
 * （IPC の notifyClient）だけを数える。
 */

const candidateOf = (world: World, reserveId: number) =>
    ((world.wired.manager as any).candidateRegistry.list() as Array<{ reservation: Record<string, any> }>).find(
        candidate => candidate.reservation.id === reserveId,
    )?.reservation;

const quiet = () => new Promise(resolve => setTimeout(resolve, 400));

describe('reservation changes and recording preparation on real components', () => {
    it('[WC-2.1][WC-2.2][WC-2.4] registers an added reservation as a recording candidate, reflects a change into it, and selects the screen notification and command each time', async () => {
        await withWorld({}, async world => {
            const now = Date.now();
            await world.save(Program, [
                programRow({ id: 1_601, eventId: 1_601, startAt: now + 3_600_000, endAt: now + 4_200_000 }),
            ]);
            await world.wired.manager.rebuildCandidatesAndStart();
            world.setter.set();

            const reserveId = await world.reservation.add({ programId: 1_601, allowEndLack: false });
            await eventually(() => expect(world.wired.manager.hasReserve(reserveId)).toBe(true));
            expect(candidateOf(world, reserveId)).toMatchObject({ allowEndLack: false, programId: 1_601 });
            expect((await settledHookLines(world.hookLog, 1))[0]).toMatch(new RegExp(`^reserve-added:${reserveId}:`, 'u'));
            await quiet();
            expect(world.ipc.notifyClient).toHaveBeenCalledTimes(1);

            await world.reservation.edit(reserveId, { allowEndLack: true, tags: [3] });
            await eventually(() => expect(candidateOf(world, reserveId)).toMatchObject({ allowEndLack: true, tags: '[3]' }));
            const lines = await settledHookLines(world.hookLog, 2);
            expect(lines.map(line => line.split(':')[0])).toEqual(['reserve-added', 'reserve-updated']);
            await quiet();
            expect(world.ipc.notifyClient).toHaveBeenCalledTimes(2);
        });
    }, 60_000);

    it('[WC-2.3][WC-2.4] cancels the running recording when its reservation is deleted, and selects the notification and command', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const { reserve, sender } = await startRecording(world, { id: 1_611, programId: 1_611 });
            const [recording] = (await world.recordedDB.findReserveId(reserve.id)) as Array<Record<string, any>>;
            expect(recording.isRecording).toBe(true);
            world.ipc.notifyClient.mockClear();

            await world.reservation.cancel(reserve.id);

            await eventually(async () => {
                const [row] = (await world.recordedDB.findReserveId(reserve.id)) as Array<Record<string, any>>;
                expect(row.isRecording).toBe(false);
            });
            expect(await world.reserveDB.findId(reserve.id)).toBeNull();
            expect(world.wired.manager.hasReserve(reserve.id)).toBe(false);
            const lines = await settledHookLines(world.hookLog, 4);
            expect(lines.map(line => line.split(':')[0])).toEqual(
                expect.arrayContaining(['prep-start', 'start', 'reserve-deleted']),
            );
            expect(world.ipc.notifyClient).toHaveBeenCalled();
            sender.end();
        });
    }, 60_000);

    it('[WC-2.2] cancels a running recording of a rule reservation when the reservation is skipped', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const ruleId = await world.ruleDB.insertOnce({
                isTimeSpecification: false,
                searchOption: { keyword: 'synthetic', name: true, GR: true },
                reserveOption: { enable: true, allowEndLack: true, avoidDuplicate: false },
            });
            const { reserve, sender } = await startRecording(world, {
                id: 1_621,
                programId: 1_621,
                reserve: { ruleId },
            });

            await world.reservation.cancel(reserve.id);

            await eventually(async () => {
                const [row] = (await world.recordedDB.findReserveId(reserve.id)) as Array<Record<string, any>>;
                expect(row.isRecording).toBe(false);
            });
            // 除外は予約を削除せず、除外の状態にする。
            expect(await world.reserveDB.findId(reserve.id)).toMatchObject({ isSkip: true });
            sender.end();
        });
    }, 60_000);

    it('[WC-2.5] selects the screen notification and command for a preparation that starts and is cancelled, and for a preparation failure', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const reserve = await addWaitingReserve(world, { id: 1_631, programId: 1_631 });
            const recorder = (await world.wired.startAll([reserve.id])).get(reserve.id);
            world.ipc.notifyClient.mockClear();

            // 準備を始め、data が来る前に取り消す。
            void recorder.startPreparation();
            await world.tuner.server.response(1_631);
            await recorder.cancel(false);
            await eventually(async () => {
                const lines = await settledHookLines(world.hookLog, 2);
                expect(lines.map(line => line.split(':').slice(0, 2).join(':'))).toEqual([
                    `prep-start:${reserve.id}`,
                    `prep-failed:${reserve.id}`,
                ]);
            });
            expect(world.ipc.notifyClient.mock.calls.length).toBeGreaterThanOrEqual(2);
            // 準備の取消は予約を削除しない。
            expect(await world.reserveDB.findId(reserve.id)).not.toBeNull();

            // 準備の失敗は、予約の削除と失敗の外部コマンドを別々に依頼する（予約 1 件につき 1 回ずつ）。
            world.ipc.notifyClient.mockClear();
            world.events.recording.emitPrepRecordingFailed(await world.reserveDB.findId(reserve.id));
            await eventually(async () => expect(await world.reserveDB.findId(reserve.id)).toBeNull());
            const lines = await settledHookLines(world.hookLog, 4);
            expect(lines.map(line => line.split(':').slice(0, 2).join(':'))).toContain(`prep-failed:${reserve.id}`);
            expect(lines.filter(line => line.startsWith('prep-failed'))).toHaveLength(2);
            expect(world.ipc.notifyClient).toHaveBeenCalled();
        });
    }, 60_000);

    it('[WC-2.6] asks to cancel the reservation when a recording reaches its retry limit', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const now = Date.now();
            await world.save(Program, [programRow({ id: 1_641, eventId: 1_641, startAt: now + 3_600_000, endAt: now + 4_200_000 })]);
            const reserveId = await world.reservation.add({ programId: 1_641, allowEndLack: false });
            const reserve = await world.reserveDB.findId(reserveId);

            world.events.recording.emitRecordingRetryOver(reserve);

            await eventually(async () => expect(await world.reserveDB.findId(reserveId)).toBeNull());
            expect(world.log.system.error).not.toHaveBeenCalled();
        });
    }, 60_000);

    it('[WC-2.7][WC-2.8][WC-2.9] relates the reserved tags one by one when a recording starts, keeps going after one fails, and then selects the notification and command', async () => {
        await withWorld({}, async world => {
            const first = await world.tags.create('first tag', '#111111');
            const second = await world.tags.create('second tag', '#222222');
            const missing = second + 1_000;
            world.setter.set();
            const order: string[] = [];
            const setRelation = world.tags.setRelation.bind(world.tags);
            vi.spyOn(world.tags, 'setRelation').mockImplementation(async (tagId: number, recordedId: number) => {
                order.push(`tag:${tagId}`);
                return setRelation(tagId, recordedId);
            });
            const addStart = world.hooks.addRecordingStartCmd.bind(world.hooks);
            vi.spyOn(world.hooks, 'addRecordingStartCmd').mockImplementation((recorded: unknown) => {
                order.push('hook');
                return addStart(recorded);
            });
            world.ipc.notifyClient.mockImplementation(() => order.push('notify'));

            const { reserve, sender } = await startRecording(world, {
                id: 1_651,
                programId: 1_651,
                reserve: { tags: JSON.stringify([first, missing, second]) },
            });
            await eventually(() => expect(order).toContain('hook'));

            const tagOrder = order.slice(0, order.indexOf('hook'));
            expect(tagOrder.filter(entry => entry.startsWith('tag:'))).toEqual([`tag:${first}`, `tag:${missing}`, `tag:${second}`]);
            expect(tagOrder.lastIndexOf('notify')).toBeGreaterThan(tagOrder.lastIndexOf(`tag:${second}`));
            const [recorded] = (await world.recordedDB.findReserveId(reserve.id)) as Array<Record<string, any>>;
            const stored = (await world.recordedDB.findId(recorded.id)) as Record<string, any>;
            expect((stored.tags as Array<{ id: number }>).map(tag => tag.id).sort()).toEqual([first, second].sort());
            expect(world.log.system.error).toHaveBeenCalled();
            expect((await settledHookLines(world.hookLog, 2)).filter(line => line.startsWith('start:'))).toHaveLength(1);
            sender.end();
        });
    }, 60_000);

    it('[WC-2.10][WC-2.11][WC-2.13] selects the screen notification and the failure command when a recording breaks after it started, without judging the recording state itself', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const cancelSpy = vi.spyOn(world.wired.manager, 'cancel');
            const cancelForDeletionSpy = vi.spyOn(world.wired.manager, 'cancelForDeletion');
            const { reserve, sender } = await startRecording(world, { id: 1_661, programId: 1_661 });
            await sender.write(chunk(1));
            world.ipc.notifyClient.mockClear();

            (await world.tuner.server.response(1_661)).socket?.destroy();

            await eventually(() => expect(world.wired.failed).toHaveBeenCalledOnce());
            const [recorded] = (await world.recordedDB.findReserveId(reserve.id)) as Array<Record<string, any>>;
            const lines = await settledHookLines(world.hookLog, 4);
            expect(lines.filter(line => line.startsWith('failed:'))).toEqual([expect.stringMatching(new RegExp(`^failed::${recorded.id}:`, 'u'))]);
            expect(world.ipc.notifyClient).toHaveBeenCalled();
            // 連携機能は録画の取消や削除の調整を呼ばない（録画側が決めた状態をそのまま扱う）。
            expect(cancelSpy).not.toHaveBeenCalled();
            expect(cancelForDeletionSpy).not.toHaveBeenCalled();
        });
    }, 60_000);

    it('[WC-2.10][WC-2.12] selects the screen notification but no failure command when a recording fails after its recorded program row is gone', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const { sender } = await startRecording(world, { id: 1_671, programId: 1_671 });
            await sender.write(chunk(1));
            // 録画済み番組の行が無い状態（録画中に取り除かれた）で、録画が途中で壊れる。
            await world.query('DELETE FROM video_file');
            await world.query('DELETE FROM recorded');
            world.ipc.notifyClient.mockClear();

            (await world.tuner.server.response(1_671)).socket?.destroy();

            await eventually(() => expect(world.wired.failed).toHaveBeenCalledOnce());
            expect(world.wired.failed.mock.calls[0][1]).toBeNull();
            await eventually(() => expect(world.ipc.notifyClient).toHaveBeenCalled());
            const lines = await settledHookLines(world.hookLog, 1);
            expect(lines.filter(line => line.startsWith('failed:'))).toEqual([]);
        });
    }, 60_000);
});
