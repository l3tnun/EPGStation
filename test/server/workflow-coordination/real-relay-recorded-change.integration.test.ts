import 'reflect-metadata';

import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
    addWaitingReserve,
    eventually,
    Program,
    programRow,
    Recorded,
    settledHookLines,
    startRecording,
    VideoFile,
    withWorld,
    type World,
} from './_real-workflow';

/*
 * 番組リレー、録画済み番組の変更、エンコード完了を受けた後続処理を、本物の部品で確かめる。
 * 実 SQLite、実 HTTP の tuner server、本物の RecorderModel・ReservationManageModel・RecordedManageModel・
 * RecordedTagManadeModel・ThumbnailManageModel・event・EventSetter、実の子 process の外部コマンドを繋ぎ、
 * 画面向けの通知の送り口（IPC の notifyClient）だけを数える。
 */

const quiet = (milliseconds = 400) => new Promise(resolve => setTimeout(resolve, milliseconds));

const reserves = async (world: World) => {
    const [rows] = (await world.reserveDB.findAll({ isHalfWidth: false })) as [Array<Record<string, any>>, number];
    return rows;
};

const addRecorded = async (world: World, overrides: Record<string, unknown> = {}) =>
    world.recordedDB.insertOnce(
        Object.assign(new Recorded(), {
            channelId: 21,
            duration: 60_000,
            endAt: Date.now() - 86_400_000 + 60_000,
            halfWidthName: 'synthetic recorded',
            isProtected: false,
            isRecording: false,
            name: 'synthetic recorded',
            startAt: Date.now() - 86_400_000,
            ...overrides,
        }),
    );

const addVideoFileRow = async (world: World, recordedId: number, fileName: string) => {
    const directory = (world.config.recorded as Array<{ path: string }>)[0].path;
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, fileName), 'synthetic-video');
    return world.videoFileDB.insertOnce(
        Object.assign(new VideoFile(), {
            filePath: fileName,
            name: fileName,
            parentDirectoryName: 'synthetic-root',
            recordedId,
            size: 15,
            type: 'ts',
        }),
    );
};

const relayItem = (eventId: number) => ({ type: 'relay', networkId: 1, serviceId: 21, eventId });

/** tuner server が返す、リレー先を持つ番組情報（`GET /api/programs/{id}` の応答）。 */
const parentProgramResponse = (programId: number, relatedItems: Array<Record<string, unknown>>) => ({
    duration: 60_000,
    eventId: programId,
    id: programId,
    isFree: true,
    networkId: 1,
    relatedItems,
    serviceId: 21,
    startAt: Date.now(),
});

describe('program relay on real components', () => {
    const startRelayParent = async (world: World, relayTargets: number[]) => {
        const now = Date.now();
        await world.save(
            Program,
            relayTargets.map((id, index) =>
                programRow({
                    eventId: id,
                    id,
                    name: `relay target ${id}`,
                    startAt: now + 3_600_000 + index * 3_600_000,
                    endAt: now + 4_200_000 + index * 3_600_000,
                }),
            ),
        );
        const ruleId = await world.ruleDB.insertOnce({
            isTimeSpecification: false,
            searchOption: { keyword: 'parent', name: true, GR: true },
            reserveOption: { enable: true, allowEndLack: true, avoidDuplicate: false },
        });
        const started = await startRecording(world, {
            id: 1_801,
            programId: 1_801,
            program: { name: 'parent program' },
            reserve: {
                allowEndLack: true,
                directory: 'relay-sub',
                encodeDirectory1: 'enc-sub',
                encodeMode1: 'mode-one',
                encodeParentDirectoryName1: 'synthetic-root',
                isDeleteOriginalAfterEncode: true,
                parentDirectoryName: 'synthetic-root',
                recordedFormat: 'relay-%TITLE%',
                ruleId,
                tags: '[]',
            },
        });
        return { ...started, ruleId };
    };

    it('[WC-4.1][WC-4.2] reserves the relay candidates in the received order, each inheriting the relay source reservation settings', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const { recorder, ruleId, sender } = await startRelayParent(world, [1_811, 1_812]);
            world.tuner.server.programs.set(1_801, parentProgramResponse(1_801, [relayItem(1_811), relayItem(1_812)]));

            await (recorder as any).checkEventRelay();
            await eventually(async () => expect((await reserves(world)).filter(row => row.isEventRelay)).toHaveLength(2));
            const relays = (await reserves(world)).filter(row => row.isEventRelay).sort((a, b) => a.id - b.id);
            expect(relays.map(row => row.programId)).toEqual([1_811, 1_812]);
            for (const relay of relays) {
                expect(relay).toMatchObject({
                    allowEndLack: true,
                    directory: 'relay-sub',
                    encodeDirectory1: 'enc-sub',
                    encodeMode1: 'mode-one',
                    encodeParentDirectoryName1: 'synthetic-root',
                    isDeleteOriginalAfterEncode: true,
                    isEventRelay: true,
                    parentDirectoryName: 'synthetic-root',
                    recordedFormat: 'relay-%TITLE%',
                    ruleId,
                });
            }
            sender.end();
        });
    }, 60_000);

    it('[WC-4.3] records a failed or duplicate relay candidate and keeps adding the remaining candidates', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const { recorder, sender } = await startRelayParent(world, [1_821, 1_822, 1_823]);
            // 先頭の候補は予約済み（重複）、2 番目は予約の追加が失敗する状態、3 番目は追加できる。
            await world.reservation.add({ programId: 1_821, allowEndLack: false });
            await world.query(
                "CREATE TRIGGER refuse_relay BEFORE INSERT ON reserve WHEN NEW.programId = 1822 BEGIN SELECT RAISE(ABORT, 'refused'); END",
            );
            world.log.system.error.mockClear();
            world.tuner.server.programs.set(
                1_801,
                parentProgramResponse(1_801, [relayItem(1_821), relayItem(1_822), relayItem(1_823)]),
            );

            await (recorder as any).checkEventRelay();

            await eventually(async () =>
                expect((await reserves(world)).filter(row => row.isEventRelay).map(row => row.programId)).toEqual([1_823]),
            );
            const messages = world.log.system.error.mock.calls.map(([error]: [unknown]) => String((error as Error)?.message ?? error));
            expect(messages).toEqual(
                expect.arrayContaining([expect.stringContaining('event relay duplicate: 1821'), expect.stringContaining('event relay failed: 1822')]),
            );
            sender.end();
        });
    }, 60_000);
});

describe('recorded program changes on real components', () => {
    it('[WC-4.4] requests a thumbnail for an uploaded video file only when the recorded program has none', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const withoutThumbnail = await addRecorded(world, { name: 'no thumbnail' });
            const withThumbnail = await addRecorded(world, { name: 'has thumbnail' });
            const existingFile = 'existing-thumbnail.jpg';
            await mkdir(world.config.thumbnail as string, { recursive: true });
            await writeFile(join(world.config.thumbnail as string, existingFile), 'jpeg');
            await world.thumbnailDB.insertOnce({ filePath: existingFile, recordedId: withThumbnail });
            const add = vi.spyOn(world.thumbnail, 'add');
            const upload = async (recordedId: number, name: string) => {
                const uploadDirectory = join(world.root, 'adopted', name);
                await mkdir(uploadDirectory, { recursive: true });
                await writeFile(join(uploadDirectory, 'payload'), 'synthetic-upload');
                await world.recorded.addUploadedVideoFile({
                    fileName: `${name}.ts`,
                    filePath: join(uploadDirectory, 'payload'),
                    fileType: 'ts',
                    parentDirectoryName: 'synthetic-root',
                    recordedId,
                    viewName: name,
                });
            };

            await upload(withThumbnail, 'second');
            await quiet();
            expect(add).not.toHaveBeenCalled();

            await upload(withoutThumbnail, 'first');
            await eventually(() => expect(add).toHaveBeenCalledOnce());
            await eventually(async () => {
                const thumbnails = (await world.thumbnailDB.findAll()) as Array<{ recordedId: number }>;
                expect(thumbnails.map(row => row.recordedId).sort()).toEqual([withoutThumbnail, withThumbnail].sort());
            });
        });
    }, 60_000);

    it('[WC-4.5] cancels the reservation of a recording program that was deleted without stopping the recording', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const reserve = await addWaitingReserve(world, { id: 1_851, programId: 1_851 });
            const recordedId = await addRecorded(world, { isRecording: true, reserveId: reserve.id });
            const recordingStop = vi.spyOn(world.wired.manager, 'cancel');
            expect(await world.reserveDB.findId(reserve.id)).not.toBeNull();

            // 録画停止を伴わない削除（容量不足の自動削除と同じ、保護を無視した削除）。
            await world.recorded.delete(recordedId, true);

            await eventually(async () => expect(await world.reserveDB.findId(reserve.id)).toBeNull());
            expect(recordingStop).not.toHaveBeenCalled();

            // 録画中でない削除では、予約の取消を依頼しない。
            const another = await addWaitingReserve(world, { id: 1_852, programId: 1_852 });
            const finished = await addRecorded(world, { isRecording: false, reserveId: another.id });
            await world.recorded.delete(finished, true);
            await quiet();
            expect(await world.reserveDB.findId(another.id)).not.toBeNull();
        });
    }, 60_000);

    it('[WC-4.6] selects exactly one screen refresh notification for each recorded program, file, protection, tag, and thumbnail change', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const recordedId = await addRecorded(world);
            const fileId = await addVideoFileRow(world, recordedId, 'first.ts');
            await addVideoFileRow(world, recordedId, 'second.ts');
            await quiet();
            const once = async (label: string, operation: () => Promise<unknown>) => {
                world.ipc.notifyClient.mockClear();
                await operation();
                await quiet(300);
                expect(world.ipc.notifyClient, label).toHaveBeenCalledTimes(1);
            };

            await once('protect', () => world.recorded.changeProtect(recordedId, true));
            await once('unprotect', () => world.recorded.changeProtect(recordedId, false));
            const tagId = await (async () => {
                let id = 0;
                await once('tag create', async () => (id = await world.tags.create('notified tag', '#101010')));
                return id;
            })();
            await once('tag update', () => world.tags.update(tagId, 'notified tag 2', '#202020'));
            await once('tag relate', () => world.tags.setRelation(tagId, recordedId));
            await once('tag unrelate', () => world.tags.deleteRelation(tagId, recordedId));
            await once('tag delete', () => world.tags.delete(tagId));
            await once('video file size', () => world.recorded.updateVideoFileSize(fileId));
            const directory = (world.config.recorded as Array<{ path: string }>)[0].path;
            await writeFile(join(directory, 'third.ts'), 'synthetic-video');
            await once('video file add', () =>
                world.recorded.addVideoFile({
                    filePath: 'third.ts',
                    name: 'third.ts',
                    parentDirectoryName: 'synthetic-root',
                    recordedId,
                    type: 'ts',
                }),
            );
            await once('video file delete', () => world.recorded.deleteVideoFile(fileId));
            await once('thumbnail add', async () => {
                const [{ id }] = (await world.videoFileDB.findAll()) as Array<{ id: number }>;
                world.thumbnail.add(id);
                await eventually(async () => expect(await world.thumbnailDB.findAll()).toHaveLength(1));
            });
            const [thumbnail] = (await world.thumbnailDB.findAll()) as Array<{ id: number }>;
            await once('thumbnail delete', () => world.thumbnail.delete(thumbnail.id));
            await once('recorded delete', () => world.recorded.delete(recordedId));
            expect(await readdir(world.config.thumbnail as string)).toEqual([]);
        });
    }, 60_000);

    it('[WC-4.7][WC-4.8] selects the encode finish command once per finished encode, without changing the encode result, the source file, or the conversion usage itself', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const recordedId = await addRecorded(world);
            const sourceId = await addVideoFileRow(world, recordedId, 'source.ts');
            const encodedId = await addVideoFileRow(world, recordedId, 'encoded.mp4');
            const deleteVideoFile = vi.spyOn(world.recorded, 'deleteVideoFile');
            const addVideoFile = vi.spyOn(world.recorded, 'addVideoFile');
            const updateSize = vi.spyOn(world.recorded, 'updateVideoFileSize');
            const deleteRecorded = vi.spyOn(world.recorded, 'delete');
            const filesBefore = (await world.videoFileDB.findAll()) as Array<{ id: number }>;

            world.events.encode.accept({ mode: 'mode-one', recordedId, videoFileId: encodedId });
            world.events.encode.accept({ mode: 'mode-two', recordedId, videoFileId: null });

            const lines = await settledHookLines(world.hookLog, 2);
            expect(lines.filter(line => line.startsWith('encoded:'))).toEqual([
                `encoded::${recordedId}::${encodedId}:mode-one`,
                `encoded::${recordedId}:::mode-two`,
            ]);
            // 連携機能は、エンコード結果の反映・元ファイルの削除を自分では行わない。
            expect(deleteVideoFile).not.toHaveBeenCalled();
            expect(addVideoFile).not.toHaveBeenCalled();
            expect(updateSize).not.toHaveBeenCalled();
            expect(deleteRecorded).not.toHaveBeenCalled();
            expect(((await world.videoFileDB.findAll()) as Array<{ id: number }>).map(row => row.id)).toEqual(
                filesBefore.map(row => row.id),
            );
            expect(await world.videoFileDB.findId(sourceId)).not.toBeNull();
        });
    }, 60_000);
});
