import 'reflect-metadata';

import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
    eventually,
    Program,
    programRow,
    ruleOption,
    settledHookLines,
    startRecording,
    withWorld,
    type World,
} from './_real-workflow';
import { chunk } from '../recording-execution/_real-tuner-wiring';

/*
 * 録画が完了したあとの後続処理を、本物の部品で確かめる。
 * 実 SQLite、実 HTTP の tuner server の放送が終わるまで流す本物の RecorderModel、本物の ReservationManageModel・
 * RecordingManageModel・ThumbnailManageModel・RecordedTagManadeModel・event・EventSetter、実の子 process の外部コマンドを繋ぎ、
 * 画面向けの通知（IPC の notifyClient）とエンコード依頼の送り口（IPC の setEncode）だけを境界として数える。
 */

const encodeRequests = (world: World) =>
    world.ipc.setEncode.mock.calls.map(([option]: [Record<string, any>]) => ({
        directory: option.directory,
        mode: option.mode,
        parentDir: option.parentDir,
        recordedId: option.recordedId,
        removeOriginal: option.removeOriginal,
        sourceVideoFileId: option.sourceVideoFileId,
    }));

const thumbnailFiles = (world: World) => readdir(world.config.thumbnail as string);

/** 録画を開始し、`beforeEnd`（開始の後続処理の記録を消すなど）を流してから、放送の終わりまで流す。 */
const finishRecording = async (
    world: World,
    options: Parameters<typeof startRecording>[1],
    beforeEnd: () => Promise<void> | void = () => undefined,
) => {
    const started = await startRecording(world, options);
    await new Promise(resolve => setTimeout(resolve, 600));
    await beforeEnd();
    started.sender.end();
    await eventually(() => expect(world.wired.finished).toHaveBeenCalledOnce());
    return started;
};

describe('recording finish follow-ups on real components', () => {
    it('[WC-3.1][WC-3.3][WC-3.4][WC-3.5][WC-3.8] cancels the manual reservation, requests the thumbnail and up to three encodes, relates the tags, then selects the command and the notification', async () => {
        await withWorld({}, async world => {
            const first = await world.tags.create('finish first', '#111111');
            const second = await world.tags.create('finish second', '#222222');
            world.setter.set();
            const order: string[] = [];
            const cancel = world.reservation.cancel.bind(world.reservation);
            vi.spyOn(world.reservation, 'cancel').mockImplementation(async (reserveId: number) => {
                order.push('cancel');
                return cancel(reserveId);
            });
            const addThumbnail = world.thumbnail.add.bind(world.thumbnail);
            vi.spyOn(world.thumbnail, 'add').mockImplementation((videoFileId: number) => {
                order.push('thumbnail');
                return addThumbnail(videoFileId);
            });
            world.ipc.setEncode.mockImplementation((option: Record<string, any>) => order.push(`encode:${option.mode}`));
            const setRelation = world.tags.setRelation.bind(world.tags);
            vi.spyOn(world.tags, 'setRelation').mockImplementation(async (tagId: number, recordedId: number) => {
                order.push(`tag:${tagId}`);
                return setRelation(tagId, recordedId);
            });
            const addFinish = world.hooks.addRecordingFinishCmd.bind(world.hooks);
            vi.spyOn(world.hooks, 'addRecordingFinishCmd').mockImplementation((recorded: unknown) => {
                order.push('hook');
                return addFinish(recorded);
            });
            world.ipc.notifyClient.mockImplementation(() => order.push('notify'));

            const { reserve } = await finishRecording(
                world,
                {
                    id: 1_701,
                    programId: 1_701,
                    reserve: {
                        encodeDirectory2: 'sub',
                        encodeMode1: 'mode-one',
                        encodeMode2: 'mode-two',
                        encodeMode3: 'mode-three',
                        encodeParentDirectoryName3: 'other-root',
                        isDeleteOriginalAfterEncode: true,
                        tags: JSON.stringify([first, second]),
                    },
                },
                () => {
                    // 録画開始の後続処理（タグ・通知）の記録を消し、完了後の記録だけを見る。
                    order.length = 0;
                },
            );
            await eventually(() => expect(order).toContain('notify'));

            // 手動予約は、録画が完了すると削除される。
            expect(await world.reserveDB.findId(reserve.id)).toBeNull();
            const [recorded] = (await world.recordedDB.findReserveId(reserve.id)) as Array<Record<string, any>>;
            const [videoFile] = (await world.videoFileDB.findAll()) as Array<Record<string, any>>;
            // 他の機能が出す画面向けの通知（予約の削除・タグの関連付け・サムネイル）は順序の対象外にして、依頼の順序を見る。
            expect(order.filter(entry => entry !== 'notify')).toEqual([
                'cancel',
                'thumbnail',
                'encode:mode-one',
                'encode:mode-two',
                'encode:mode-three',
                `tag:${first}`,
                `tag:${second}`,
                'hook',
            ]);
            // 外部コマンドの後に、録画完了の画面向けの通知が続く。
            expect(order[order.indexOf('hook') + 1]).toBe('notify');
            // エンコードは最初の録画ファイルを変換元に、指定順に 3 件。保存先の指定がなければ最初の録画先。
            expect(encodeRequests(world)).toEqual([
                { directory: undefined, mode: 'mode-one', parentDir: 'synthetic-root', recordedId: recorded.id, removeOriginal: true, sourceVideoFileId: videoFile.id },
                { directory: 'sub', mode: 'mode-two', parentDir: 'synthetic-root', recordedId: recorded.id, removeOriginal: true, sourceVideoFileId: videoFile.id },
                { directory: undefined, mode: 'mode-three', parentDir: 'other-root', recordedId: recorded.id, removeOriginal: true, sourceVideoFileId: videoFile.id },
            ]);
            // サムネイルは本物の生成処理を通り、行と file ができる。
            await eventually(async () => {
                expect(await world.thumbnailDB.findAll()).toEqual([expect.objectContaining({ recordedId: recorded.id })]);
            });
            expect(await thumbnailFiles(world)).toHaveLength(1);
            const stored = (await world.recordedDB.findId(recorded.id)) as Record<string, any>;
            expect((stored.tags as Array<{ id: number }>).map(tag => tag.id).sort()).toEqual([first, second].sort());
            expect((await settledHookLines(world.hookLog, 3)).filter(line => line.startsWith('finish:'))).toEqual([
                expect.stringMatching(new RegExp(`^finish::${recorded.id}:`, 'u')),
            ]);
        });
    }, 60_000);

    it('[WC-3.2] re-evaluates the rule instead of deleting the reservation when a rule recording completes', async () => {
        await withWorld({}, async world => {
            const now = Date.now();
            await world.save(Program, [
                programRow({ id: 1_711, eventId: 1_711, name: 'serial drama', startAt: now + 120_000, endAt: now + 180_000 }),
                programRow({ id: 1_712, eventId: 1_712, name: 'serial drama', startAt: now + 7_200_000, endAt: now + 7_260_000 }),
            ]);
            world.setter.set();
            const ruleId = await world.ruleManage.add(
                ruleOption({ searchOption: { keyword: 'serial', name: true, GR: true } }),
            );
            await eventually(async () => {
                const [rows] = (await world.reserveDB.findAll({ isHalfWidth: false })) as [Array<Record<string, any>>, number];
                expect(rows.filter(row => row.ruleId === ruleId)).toHaveLength(2);
            });
            const [rows] = (await world.reserveDB.findAll({ isHalfWidth: false })) as [Array<Record<string, any>>, number];
            const firstReserve = rows.find(row => row.programId === 1_711)!;
            const secondReserve = rows.find(row => row.programId === 1_712)!;
            const updateRule = vi.spyOn(world.reservation, 'updateRule');
            const cancel = vi.spyOn(world.reservation, 'cancel');
            // 番組表から 2 件目の番組が無くなった状態にする（予約の再計算が走ると、その予約が消える）。
            await world.query('DELETE FROM program WHERE id = 1712');

            const recorder = (await world.wired.startAll([firstReserve.id, secondReserve.id])).get(firstReserve.id);
            const preparation = recorder.startPreparation();
            const sender = await world.tuner.sender(1_711);
            await sender.write(chunk(0));
            await preparation;
            sender.end();
            await eventually(() => expect(world.wired.finished).toHaveBeenCalledOnce());

            // 録画の完了で、そのルールの予約が再計算される。録画した予約自身は削除されない（予約の削除ではなく再計算）。
            await eventually(async () => expect(await world.reserveDB.findId(secondReserve.id)).toBeNull());
            expect(updateRule.mock.calls.map(([id]) => id)).toContain(ruleId);
            expect(cancel).not.toHaveBeenCalledWith(firstReserve.id);
            expect(await world.reserveDB.findId(firstReserve.id)).not.toBeNull();
            expect((await world.recordedHistoryDB.findAll()) as Array<{ name: string }>).toEqual([
                expect.objectContaining({ name: 'serial drama' }),
            ]);
        });
    }, 60_000);

    it('[WC-3.6][WC-3.8] relates the tags and selects the command and the notification without waiting for the thumbnail or the encode requests to finish', async () => {
        await withWorld({}, async world => {
            const slowScript = join(world.root, 'slow-thumbnail.cjs');
            await writeFile(
                slowScript,
                "setTimeout(() => require('node:fs').writeFileSync(process.argv[3], 'synthetic-jpeg'), 2500);\n",
            );
            world.config.thumbnailCmd = `%FFMPEG% ${slowScript} %INPUT% %OUTPUT%`;
            const tag = await world.tags.create('not waiting', '#333333');
            world.setter.set();
            // エンコードの依頼は完了しない（返らない）。
            world.ipc.setEncode.mockReturnValue(new Promise(() => undefined));

            const { reserve } = await finishRecording(world, {
                id: 1_721,
                programId: 1_721,
                reserve: { encodeMode1: 'mode-one', tags: JSON.stringify([tag]) },
            });
            await eventually(async () => {
                expect(world.ipc.notifyClient).toHaveBeenCalled();
                expect((await settledHookLines(world.hookLog, 1)).some(line => line.startsWith('finish:'))).toBe(true);
            });

            const [recorded] = (await world.recordedDB.findReserveId(reserve.id)) as Array<Record<string, any>>;
            const stored = (await world.recordedDB.findId(recorded.id)) as Record<string, any>;
            expect(stored.tags).toEqual([expect.objectContaining({ id: tag })]);
            // サムネイルの生成はまだ終わっていないが、後続は進んでいる。
            expect(await world.thumbnailDB.findAll()).toEqual([]);
            await eventually(async () => expect(await world.thumbnailDB.findAll()).toHaveLength(1));
        });
    }, 60_000);

    it('[WC-3.7][WC-3.8] records a broken stored tag list, and still selects the command and the notification', async () => {
        await withWorld({}, async world => {
            world.setter.set();

            const { reserve } = await finishRecording(world, { id: 1_731, programId: 1_731, reserve: { tags: 'not json' } });
            await eventually(() => expect(world.ipc.notifyClient).toHaveBeenCalled());

            expect(world.log.system.error).toHaveBeenCalled();
            const [recorded] = (await world.recordedDB.findReserveId(reserve.id)) as Array<Record<string, any>>;
            expect(((await world.recordedDB.findId(recorded.id)) as Record<string, any>).tags).toEqual([]);
            expect((await settledHookLines(world.hookLog, 3)).filter(line => line.startsWith('finish:'))).toHaveLength(1);
        });
    }, 60_000);

    it('[WC-3.7][WC-3.8] records one failing tag relation, continues with the remaining tags, and still selects the command and the notification', async () => {
        await withWorld({}, async world => {
            const good = await world.tags.create('after failure', '#444444');
            const later = await world.tags.create('later tag', '#666666');
            const missing = later + 1_000;
            world.setter.set();

            const { reserve } = await finishRecording(
                world,
                { id: 1_732, programId: 1_732, reserve: { tags: JSON.stringify([good, missing, later]) } },
                () => {
                    world.log.system.error.mockClear();
                    world.ipc.notifyClient.mockClear();
                },
            );
            await eventually(() => expect(world.ipc.notifyClient).toHaveBeenCalled());

            const [recorded] = (await world.recordedDB.findReserveId(reserve.id)) as Array<Record<string, any>>;
            const tags = ((await world.recordedDB.findId(recorded.id)) as Record<string, any>).tags as Array<{ id: number }>;
            expect(tags.map(tag => tag.id).sort()).toEqual([good, later].sort());
            expect(world.log.system.error).toHaveBeenCalled();
            expect((await settledHookLines(world.hookLog, 3)).filter(line => line.startsWith('finish:'))).toHaveLength(1);
        });
    }, 60_000);

    it.each([
        ['thumbnail request', 'thumbnail'],
        ['encode request', 'encode'],
    ] as const)(
        '[WC-3.9][WC-3.10][WC-7.3][WC-7.7] keeps the work already started and the finished recording when the %s fails synchronously, and stops the later follow-ups',
        async (_label, failing) => {
            await withWorld({}, async world => {
                const tag = await world.tags.create('never related', '#555555');
                world.setter.set();
                const failure = new Error(`synthetic ${failing} failure`);
                const unhandled: unknown[] = [];
                const recordUnhandled = (reason: unknown): void => void unhandled.push(reason);
                process.prependListener('unhandledRejection', recordUnhandled);
                const addThumbnail = world.thumbnail.add.bind(world.thumbnail);
                vi.spyOn(world.thumbnail, 'add').mockImplementation((videoFileId: number) => {
                    if (failing === 'thumbnail') throw failure;
                    return addThumbnail(videoFileId);
                });
                world.ipc.setEncode.mockImplementation(() => {
                    if (failing === 'encode') throw failure;
                });
                const setRelation = vi.spyOn(world.tags, 'setRelation');
                const addFinish = vi.spyOn(world.hooks, 'addRecordingFinishCmd');

                try {
                    const { reserve } = await finishRecording(
                        world,
                        {
                            id: failing === 'thumbnail' ? 1_741 : 1_742,
                            programId: failing === 'thumbnail' ? 1_741 : 1_742,
                            reserve: { encodeMode1: 'mode-one', tags: JSON.stringify([tag]) },
                        },
                        () => {
                            // 録画開始の後続処理（タグ）の記録を消し、完了後の記録だけを見る。
                            setRelation.mockClear();
                        },
                    );
                    await eventually(() => expect(world.log.system.error).toHaveBeenCalledWith(failure));
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // それより前に始めた予約の削除は取り消されず、録画の完了も取り消されない。
                    expect(await world.reserveDB.findId(reserve.id)).toBeNull();
                    const [recorded] = (await world.recordedDB.findReserveId(reserve.id)) as Array<Record<string, any>>;
                    expect(recorded.isRecording).toBe(false);
                    expect(await world.videoFileDB.findAll()).toHaveLength(1);
                    // 失敗した位置で後続の依頼は終わる。
                    expect(setRelation).not.toHaveBeenCalled();
                    expect(addFinish).not.toHaveBeenCalled();
                    if (failing === 'encode') {
                        // サムネイルの依頼は、失敗より前に始まっているので取り消されない。
                        await eventually(async () => expect(await world.thumbnailDB.findAll()).toHaveLength(1));
                    }
                    expect(unhandled).toEqual([]);
                } finally {
                    process.removeListener('unhandledRejection', recordUnhandled);
                }
            });
        },
        60_000,
    );
});
