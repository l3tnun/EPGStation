import 'reflect-metadata';

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
    addWaitingReserve,
    eventually,
    Program,
    programRow,
    Recorded,
    ruleOption,
    settledHookLines,
    startRecording,
    VideoFile,
    withWorld,
    type World,
} from './_real-workflow';
import { load } from '../recording-execution/_harness';
import { chunk } from '../recording-execution/_real-tuner-wiring';

/*
 * 画面通知と外部コマンドの境界、後続処理の部分進行・再実行・起動時の失敗を、本物の部品で確かめる。
 * 実 SQLite、実 HTTP の tuner server、本物の ReservationManageModel・RecordingManageModel・RecorderModel・
 * RecordedManageModel・ThumbnailManageModel・RecordedTagManadeModel・event・EventSetter、実の子 process の外部コマンドを繋ぎ、
 * 画面向けの通知の送り口（IPC の notifyClient）とエンコード依頼の送り口（IPC の setEncode）だけを境界として扱う。
 */

const StartupContinuationCoordinator = load<
    new () => {
        runAfterServiceSupervisionAccepted(input: Record<string, () => Promise<void>>): Promise<Record<string, unknown>>;
    }
>('model', 'workflow', 'StartupContinuationCoordinator.js');

const quiet = (milliseconds = 400) => new Promise(resolve => setTimeout(resolve, milliseconds));

const finishLines = async (world: World, expected: number) =>
    (await settledHookLines(world.hookLog, expected)).filter(line => line.startsWith('finish:'));

describe('screen notification and external command boundary on real components', () => {
    it('[WC-6.1] selects the screen refresh notification for reservation and recording state changes, and none for an encode completion', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const { sender } = await startRecording(world, { id: 2_002, programId: 2_002 });
            await eventually(() => expect(world.ipc.notifyClient).toHaveBeenCalled());
            sender.end();
            await eventually(() => expect(world.wired.finished).toHaveBeenCalledOnce());
            const afterRecording = world.ipc.notifyClient.mock.calls.length;
            const now = Date.now();
            await world.save(Program, [programRow({ id: 2_001, eventId: 2_001, startAt: now + 3_600_000, endAt: now + 4_200_000 })]);
            const reserveId = await world.reservation.add({ programId: 2_001, allowEndLack: false });
            await eventually(() => expect(world.ipc.notifyClient.mock.calls.length).toBeGreaterThan(afterRecording));
            await quiet();

            // どの状態変化でも、本文を持たない再取得の通知を 1 種類だけ選ぶ。
            expect(world.ipc.notifyClient.mock.calls.every((call: unknown[]) => call.length === 0)).toBe(true);
            expect(await world.reserveDB.findId(reserveId)).not.toBeNull();

            // エンコード完了は、外部コマンドだけを選び、再取得の通知は選ばない。
            world.ipc.notifyClient.mockClear();
            world.events.encode.accept({ mode: 'mode-one', recordedId: 1, videoFileId: 1 });
            await settledHookLines(world.hookLog, 1);
            await quiet();
            expect(world.ipc.notifyClient).not.toHaveBeenCalled();
        });
    }, 60_000);

    it('[WC-6.3] sends one notification request per change without aggregating, delaying, or retrying it', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const failure = new Error('synthetic notification failure');
            world.ipc.notifyClient.mockImplementationOnce(() => {
                throw failure;
            });

            // 10 回の変更を続けて起こす。通知の要求は変更ごとに 1 回で、まとめず、遅らせず、失敗しても再送しない。
            const requested: number[] = [];
            for (let index = 0; index < 10; index += 1) {
                await world.tags.create(`burst ${index}`, '#010101');
                requested.push(world.ipc.notifyClient.mock.calls.length);
            }
            await quiet();

            expect(requested).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
            expect(world.ipc.notifyClient).toHaveBeenCalledTimes(10);
            expect(world.log.system.error).toHaveBeenCalledWith(failure);
        });
    }, 60_000);

    it('[WC-6.4] hands the reservation and recorded program through to the external commands as they are, and leaves a failing command to the delivery side', async () => {
        await withWorld(
            { config: { recordingPreStartCommand: '/nonexistent-hook-command/run' } },
            async world => {
                world.setter.set();
                const preStart = vi.spyOn(world.hooks, 'addRecordingPrepStartCmd');
                const start = vi.spyOn(world.hooks, 'addRecordingStartCmd');
                const finish = vi.spyOn(world.hooks, 'addRecordingFinishCmd');
                const { reserve, sender } = await startRecording(world, { id: 2_011, programId: 2_011 });
                sender.end();
                await eventually(() => expect(world.wired.finished).toHaveBeenCalledOnce());
                const [recorded] = (await world.recordedDB.findReserveId(reserve.id)) as Array<Record<string, any>>;

                // 受け取った予約・録画済み番組をそのまま渡す（項目の選択や加工をしない）。
                expect(preStart).toHaveBeenCalledOnce();
                expect(preStart.mock.calls[0][0]).toMatchObject({ id: reserve.id, programId: 2_011 });
                expect(start.mock.calls[0][0]).toMatchObject({ id: recorded.id });
                expect(finish.mock.calls[0][0]).toMatchObject({ id: recorded.id });
                // 準備開始の command は実行できない（配信側が失敗を扱う）が、後続の command は順に実行される。
                const lines = (await settledHookLines(world.hookLog, 2)).filter(line => !line.startsWith('reserve-'));
                expect(lines.map(line => line.split(':')[0])).toEqual(['start', 'finish']);
            },
        );
    }, 60_000);

    it('[WC-6.5] keeps the follow-ups going while the screen notification never completes', async () => {
        await withWorld({}, async world => {
            const tag = await world.tags.create('notification pending', '#121212');
            world.setter.set();
            world.ipc.notifyClient.mockReturnValue(new Promise(() => undefined));

            const { reserve, sender } = await startRecording(world, {
                id: 2_021,
                programId: 2_021,
                reserve: { tags: JSON.stringify([tag]) },
            });
            sender.end();
            await eventually(() => expect(world.wired.finished).toHaveBeenCalledOnce());

            // 通知の受付が終わらなくても、サムネイル・タグ・外部コマンドの後続は進む。
            await eventually(async () => expect(await world.thumbnailDB.findAll()).toHaveLength(1));
            const [recorded] = (await world.recordedDB.findReserveId(reserve.id)) as Array<Record<string, any>>;
            expect(((await world.recordedDB.findId(recorded.id)) as Record<string, any>).tags).toEqual([
                expect.objectContaining({ id: tag }),
            ]);
            expect(await finishLines(world, 1)).toHaveLength(1);
        });
    }, 60_000);

    it('[WC-6.6] keeps the follow-ups going while a long running external command has not finished', async () => {
        await withWorld({}, async world => {
            const slowScript = join(world.root, 'slow-hook.cjs');
            await writeFile(
                slowScript,
                `setTimeout(() => require('node:fs').appendFileSync(${JSON.stringify(world.hookLog)}, 'finish-done\\n'), 2500);\n`,
            );
            world.config.recordingFinishCommand = `%NODE% ${slowScript}`;
            const tag = await world.tags.create('command pending', '#131313');
            world.setter.set();

            const { reserve, sender } = await startRecording(world, {
                id: 2_031,
                programId: 2_031,
                reserve: { tags: JSON.stringify([tag]) },
            });
            sender.end();
            await eventually(() => expect(world.wired.finished).toHaveBeenCalledOnce());
            await eventually(async () => expect(await world.thumbnailDB.findAll()).toHaveLength(1));

            // command は終わっていないが、予約の整理・タグ・画面通知は終わっている。
            expect(await world.reserveDB.findId(reserve.id)).toBeNull();
            const [recorded] = (await world.recordedDB.findReserveId(reserve.id)) as Array<Record<string, any>>;
            expect(((await world.recordedDB.findId(recorded.id)) as Record<string, any>).tags).toEqual([
                expect.objectContaining({ id: tag }),
            ]);
            expect(world.ipc.notifyClient).toHaveBeenCalled();
            expect((await settledHookLines(world.hookLog, 0)).includes('finish-done')).toBe(false);
            await eventually(async () => expect(await settledHookLines(world.hookLog, 1)).toContain('finish-done'));
        });
    }, 60_000);

    it('[WC-6.7] keeps the confirmed reservation and recording state when the notification and every external command fail', async () => {
        await withWorld(
            {
                config: {
                    recordingFailedCommand: '/nonexistent-hook-command/run',
                    recordingFinishCommand: '/nonexistent-hook-command/run',
                    recordingPrepRecFailedCommand: '/nonexistent-hook-command/run',
                    recordingPreStartCommand: '/nonexistent-hook-command/run',
                    recordingStartCommand: '/nonexistent-hook-command/run',
                    reserveNewAddtionCommand: '/nonexistent-hook-command/run',
                },
            },
            async world => {
                world.setter.set();
                world.ipc.notifyClient.mockImplementation(() => {
                    throw new Error('synthetic client disconnected');
                });

                // 録画の確定は、通知と command の失敗で巻き戻らない。
                const { reserve, sender } = await startRecording(world, { id: 2_042, programId: 2_042 });
                sender.write(chunk(1));
                sender.end();
                await eventually(() => expect(world.wired.finished).toHaveBeenCalledOnce());
                await quiet(600);
                const [recorded] = (await world.recordedDB.findReserveId(reserve.id)) as Array<Record<string, any>>;
                expect(recorded.isRecording).toBe(false);
                expect(await world.videoFileDB.findAll()).toHaveLength(1);

                // 予約の確定も同じ。
                const now = Date.now();
                await world.save(Program, [programRow({ id: 2_041, eventId: 2_041, startAt: now + 3_600_000, endAt: now + 4_200_000 })]);
                const reserveId = await world.reservation.add({ programId: 2_041, allowEndLack: false });
                await quiet();
                expect(await world.reserveDB.findId(reserveId)).toMatchObject({ programId: 2_041 });
                expect(world.log.system.error).toHaveBeenCalled();
            },
        );
    }, 60_000);
});

describe('partial progress and re-execution on real components', () => {
    it('[WC-7.1][WC-7.2][WC-7.3] does not commit the follow-ups as one transaction and returns no result list to the caller', async () => {
        await withWorld({}, async world => {
            const tag = await world.tags.create('relation refused', '#141414');
            const [{ name: relationTable }] = (await world.query(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'recorded_tags%'",
            )) as Array<{ name: string }>;
            await world.query(
                `CREATE TRIGGER refuse_relation BEFORE INSERT ON ${relationTable} BEGIN SELECT RAISE(ABORT, 'refused'); END`,
            );
            world.setter.set();

            const { reserve, sender } = await startRecording(world, {
                id: 2_101,
                programId: 2_101,
                reserve: { tags: JSON.stringify([tag]) },
            });
            sender.end();
            await eventually(() => expect(world.wired.finished).toHaveBeenCalledOnce());
            await eventually(async () => expect(await world.thumbnailDB.findAll()).toHaveLength(1));
            await finishLines(world, 1);

            // タグの関連付けは失敗したが、予約の整理・サムネイル・外部コマンドは別々に確定している（巻き戻らない）。
            expect(await world.reserveDB.findId(reserve.id)).toBeNull();
            const [recorded] = (await world.recordedDB.findReserveId(reserve.id)) as Array<Record<string, any>>;
            expect(((await world.recordedDB.findId(recorded.id)) as Record<string, any>).tags).toEqual([]);
            expect(world.log.system.error).toHaveBeenCalled();

            // 操作の呼び出し元へは、後続処理の結果一覧を返さない（予約の追加は id、取消は何も返さない）。
            await world.save(Program, [programRow({ id: 2_102, eventId: 2_102, startAt: Date.now() + 3_600_000, endAt: Date.now() + 4_200_000 })]);
            world.ipc.notifyClient.mockImplementation(() => {
                throw new Error('synthetic notification failure');
            });
            const reserveId = await world.reservation.add({ programId: 2_102, allowEndLack: false });
            expect(typeof reserveId).toBe('number');
            await expect(world.reservation.cancel(reserveId)).resolves.toBeUndefined();
            await expect(world.ruleManage.add(ruleOption({ searchOption: { keyword: 'nothing', name: true, GR: true } }))).resolves.toEqual(
                expect.any(Number),
            );
            // 連携機能は、後続処理の完了状態・結果一覧を保持する窓口を持たない。
            const publicNames = [...Object.getOwnPropertyNames(Object.getPrototypeOf(world.setter)), ...Object.keys(world.setter)];
            expect(publicNames.filter(name => /result|status|completion|progress/iu.test(name))).toEqual([]);
        });
    }, 60_000);

    it('[WC-7.4] requests the follow-ups again, without de-duplication, when the same state change is received again', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const { reserve, sender } = await startRecording(world, {
                id: 2_111,
                programId: 2_111,
                reserve: { encodeMode1: 'mode-one' },
            });
            sender.end();
            await eventually(() => expect(world.wired.finished).toHaveBeenCalledOnce());
            await finishLines(world, 1);
            const [recorded] = (await world.recordedDB.findReserveId(reserve.id)) as Array<Record<string, any>>;
            const finishedRecorded = (await world.recordedDB.findId(recorded.id)) as Record<string, any>;
            const thumbnailAdd = vi.spyOn(world.thumbnail, 'add');
            world.ipc.setEncode.mockClear();
            const before = world.ipc.notifyClient.mock.calls.length;

            // 同じ録画完了を、もう一度受け付ける。
            world.events.recording.emitFinishRecording(reserve, finishedRecorded, true);

            await eventually(async () => expect(await finishLines(world, 2)).toHaveLength(2));
            expect(world.ipc.setEncode).toHaveBeenCalledTimes(1);
            expect(thumbnailAdd).toHaveBeenCalledTimes(1);
            expect(world.ipc.notifyClient.mock.calls.length).toBeGreaterThan(before);
        });
    }, 60_000);

    it('[WC-7.6] does not retry a failed follow-up by itself', async () => {
        await withWorld({}, async world => {
            const tag = await world.tags.create('fails once', '#151515');
            const [{ name: relationTable }] = (await world.query(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'recorded_tags%'",
            )) as Array<{ name: string }>;
            await world.query(
                `CREATE TRIGGER refuse_relation BEFORE INSERT ON ${relationTable} BEGIN SELECT RAISE(ABORT, 'refused'); END`,
            );
            world.setter.set();
            const failure = new Error('synthetic thumbnail failure');
            const add = vi.spyOn(world.thumbnail, 'add').mockImplementation(() => {
                throw failure;
            });
            const setRelation = vi.spyOn(world.tags, 'setRelation');

            const { sender } = await startRecording(world, {
                id: 2_121,
                programId: 2_121,
                reserve: { tags: JSON.stringify([tag]) },
            });
            // 録画開始のタグの関連付けは失敗する（関連付けの行を作れない）。完了のサムネイルの依頼も失敗する。
            const startCalls = setRelation.mock.calls.length;
            expect(startCalls).toBe(1);
            sender.end();
            await eventually(() => expect(world.wired.finished).toHaveBeenCalledOnce());
            await eventually(() => expect(add).toHaveBeenCalledOnce());
            await quiet(1_500);

            expect(add).toHaveBeenCalledTimes(1);
            expect(setRelation).toHaveBeenCalledTimes(1);
            expect(world.log.system.error).toHaveBeenCalledWith(failure);
        });
    }, 60_000);
});

describe('startup recording reconciliation on real components', () => {
    const interrupted = async (world: World, options: { name: string; reserveId: number | null; file: string | null; recordedId?: number }) => {
        const recordedId = await world.recordedDB.insertOnce(
            Object.assign(new Recorded(), {
                channelId: 21,
                duration: 60_000,
                endAt: Date.now() + 30_000,
                halfWidthName: options.name,
                isProtected: false,
                isRecording: true,
                name: options.name,
                reserveId: options.reserveId,
                startAt: Date.now() - 30_000,
            }),
        );
        if (options.file !== null) {
            await world.videoFileDB.insertOnce(
                Object.assign(new VideoFile(), {
                    filePath: options.file,
                    name: options.file,
                    parentDirectoryName: 'synthetic-root',
                    recordedId,
                    size: 0,
                    type: 'ts',
                }),
            );
        }
        return recordedId;
    };

    it('[WC-7.8] records a failure for one interrupted recording without turning it into an extra screen notification, and continues with the remaining items', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            // 録画中状態の解除が失敗する録画（その項目は進まない）と、予約を取得できない録画。
            const stuck = await interrupted(world, { name: 'cannot clear', reserveId: 7_001, file: null });
            const lost = await interrupted(world, { name: 'reservation lookup fails', reserveId: 7_002, file: null });
            await world.query(
                `CREATE TRIGGER refuse_clear BEFORE UPDATE ON recorded WHEN NEW.id = ${stuck} AND NEW.isRecording = 0 BEGIN SELECT RAISE(ABORT, 'refused'); END`,
            );
            const findId = world.wired.reserveDB.findId.bind(world.wired.reserveDB);
            vi.spyOn(world.wired.reserveDB, 'findId').mockImplementation(async (id: number) => {
                if (id === 7_002) throw new Error('synthetic reservation lookup failure');
                return findId(id);
            });

            await world.wired.manager.cleanup();
            await quiet(600);

            // 失敗は録画実行機能の記録（運用 log）だけで、画面向けの通知も外部コマンドも追加で起こさない。
            expect(world.log.system.error).toHaveBeenCalled();
            expect(world.ipc.notifyClient).not.toHaveBeenCalled();
            expect(await settledHookLines(world.hookLog, 0)).toEqual([]);
            expect(await world.recordedDB.findId(stuck)).toMatchObject({ isRecording: true });
            expect(await world.recordedDB.findId(lost)).toMatchObject({ isRecording: false });

            // 録画 file の処理に失敗した録画（file が無い）は、同じ項目の残りの file と終了処理を続ける。
            const reserve = await addWaitingReserve(world, { id: 7_003, programId: 7_003 });
            const missingFile = await interrupted(world, { name: 'file missing', reserveId: reserve.id, file: 'missing.ts' });
            const present = await interrupted(world, { name: 'normal', reserveId: null, file: null });
            await world.wired.manager.cleanup();
            await eventually(async () => expect(await finishLines(world, 1)).toHaveLength(1));
            expect(await world.recordedDB.findId(missingFile)).toMatchObject({ isRecording: false });
            expect(await world.recordedDB.findId(present)).toMatchObject({ isRecording: false });
            // 手動予約は、録画完了の後続処理で取り消される。
            await eventually(async () => expect(await world.reserveDB.findId(reserve.id)).toBeNull());
        });
    }, 60_000);

    const coordinate = (world: World, overrides: Record<string, () => Promise<void>> = {}) => {
        const order: string[] = [];
        const stages = {
            runRecordingReconciliation: async () => {
                order.push('reconcile');
                await world.wired.manager.cleanup();
            },
            runRecordingCandidatesAndStart: async () => {
                order.push('candidates');
                await world.wired.manager.rebuildCandidatesAndStart();
            },
            runExpiredReservationCleanup: async () => {
                order.push('expired');
                await world.reservation.cleanup();
            },
            startEpgSupervisor: async () => {
                order.push('epg');
            },
            ...overrides,
        };
        return { order, run: () => new StartupContinuationCoordinator().runAfterServiceSupervisionAccepted(stages) };
    };

    it.each([
        ['the interrupted recordings cannot be listed', 'recording-reconciliation', ['reconcile']],
        ['the saved reservations cannot be listed', 'recording-candidates-and-start', ['reconcile', 'candidates']],
    ] as const)(
        '[WC-7.9] returns the startup stage as failed and starts no 3-second check, reservation cleanup, program update, or retry when %s',
        async (_label, stage, expectedOrder) => {
            await withWorld({}, async world => {
                world.setter.set();
                const failure = new Error(`synthetic ${stage} failure`);
                const listing =
                    stage === 'recording-reconciliation'
                        ? vi.spyOn(world.wired.recordedDB, 'findAll').mockRejectedValue(failure)
                        : vi.spyOn(world.wired.reserveDB, 'findLists').mockRejectedValue(failure);
                // 3 秒周期の確認が走るなら録画の準備を始める、開始間近の予約。
                const imminent = await addWaitingReserve(world, {
                    id: 7_101,
                    programId: 7_101,
                    reserve: { startAt: Date.now() + 1_000, endAt: Date.now() + 61_000 },
                });
                const { order, run } = coordinate(world);

                const outcome = await run();

                expect(outcome).toMatchObject({ kind: 'Failed', stage });
                expect(order).toEqual(expectedOrder);
                // 3 秒の周期（2 周期分）待っても、確認・再試行・録画の準備は始まらない。
                await quiet(6_500);
                expect(listing).toHaveBeenCalledTimes(1);
                expect(world.wired.provider).not.toHaveBeenCalled();
                expect(world.wired.manager.hasReserve(imminent.id)).toBe(false);
                expect(await world.reserveDB.findId(imminent.id)).not.toBeNull();
            });
        },
        60_000,
    );

    it('[WC-7.10] starts the 3-second recording check after both recording stages succeed, and the program update only after the reservation cleanup succeeds', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const imminent = await addWaitingReserve(world, {
                id: 7_201,
                programId: 7_201,
                reserve: { startAt: Date.now() + 1_000, endAt: Date.now() + 61_000 },
            });
            const { order, run } = coordinate(world);

            expect(world.wired.provider).not.toHaveBeenCalled();
            const outcome = await run();

            expect(outcome).toMatchObject({ kind: 'Succeeded', stage: 'epg-supervisor-start' });
            expect(order).toEqual(['reconcile', 'candidates', 'expired', 'epg']);
            // 開始間近の予約は、周期の確認によって録画の準備が始まる（周期の 3 秒の数倍の余裕で待つ）。
            await eventually(() => expect(world.wired.provider).toHaveBeenCalledOnce());
            expect(world.wired.manager.hasReserve(imminent.id)).toBe(true);

            // 予約の整理が失敗すると、番組情報の更新は始まらない。
            const failing = await withFailedExpiredCleanup(world);
            expect(failing.order).toEqual(['reconcile', 'candidates', 'expired']);
        });
    }, 60_000);

    const withFailedExpiredCleanup = async (world: World) => {
        const { order, run } = coordinate(world, {
            runExpiredReservationCleanup: async () => {
                order.push('expired');
                throw new Error('synthetic cleanup failure');
            },
        });
        const outcome = await run();
        expect(outcome).toMatchObject({ kind: 'Failed', stage: 'expired-reservation-cleanup' });
        return { order };
    };
});
