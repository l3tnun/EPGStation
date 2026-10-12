import 'reflect-metadata';

import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createRealEncode } from './_real-encode';
import {
    eventually,
    Recorded,
    startRecording,
    VideoFile,
    withWorld,
    type World,
} from './_real-workflow';
import { load } from '../recording-execution/_harness';
import { chunk } from '../recording-execution/_real-tuner-wiring';

/*
 * 利用者による録画済み番組の削除を、本物の部品で確かめる。
 * 実 SQLite と実 file system、本物の RecordedApiModel（service 側）・ParentUserDeletionCoordinator（親側）・RecordedManageModel・
 * RecordingManageModel・RecorderModel（実 HTTP の tuner server の放送を受信中）・EncodeManageModel（実の子 process のエンコード）を繋ぐ。
 * service の子 process と親の間の IPC の経路だけは、同じ process 内の呼び出しで繋ぐ。
 */

const ParentUserDeletionCoordinator = load<new (...args: any[]) => { deleteFromRequest(id: number): Promise<void> }>(
    'model',
    'workflow',
    'ParentUserDeletionCoordinator.js',
);
const RecordedApiModel = load<new (...args: any[]) => { delete(id: number): Promise<void> }>(
    'model',
    'api',
    'recorded',
    'RecordedApiModel.js',
);
const StoragePressureDeletionAdapter = load<new (...args: any[]) => any>(
    'model',
    'operator',
    'storage',
    'StoragePressureDeletionAdapter.js',
);
const RecordingRecordedUseProvider = load<new () => any>(
    'model',
    'operator',
    'recording',
    'RecordingRecordedUseProvider.js',
);
const DropLogFile = load<new () => Record<string, any>>('db', 'entities', 'DropLogFile.js');
const Thumbnail = load<new () => Record<string, any>>('db', 'entities', 'Thumbnail.js');

const thumbnailRow = (fileName: string, recordedId: number) =>
    Object.assign(new Thumbnail(), { filePath: fileName, recordedId });

const wireDeletion = async (world: World) => {
    const encode = await createRealEncode(world);
    const parent = new ParentUserDeletionCoordinator(world.recorded, {
        hasReservation: (reserveId: number) => world.wired.manager.hasReserve(reserveId),
        requestCancellationForDeletion: (reserveId: number) => world.wired.manager.cancelForDeletion(reserveId),
    });
    const api = new RecordedApiModel(
        { recorded: { delete: (recordedId: number) => parent.deleteFromRequest(recordedId) } },
        world.recordedDB,
        encode.manage,
        {},
    );
    return { api, encode };
};

const recordedRootOf = (world: World) => (world.config.recorded as Array<{ path: string }>)[0].path;

/** 録画済み番組（録画 file・サムネイル・ドロップログ付き）を、実 DB と実 file system に作る。 */
const addRecordedWithFiles = async (
    world: World,
    options: { files?: string[]; overrides?: Record<string, unknown>; withMetadata?: boolean } = {},
) => {
    const files = options.files ?? ['source.ts'];
    const dropLogFileId =
        options.withMetadata === false
            ? null
            : await (async () => {
                  await mkdir(world.config.dropLog as string, { recursive: true });
                  await writeFile(join(world.config.dropLog as string, 'drop.log'), 'drop');
                  return world.dropLogFileDB.insertOnce(
                      Object.assign(new DropLogFile(), { dropCnt: 0, errorCnt: 0, filePath: 'drop.log', scramblingCnt: 0 }),
                  );
              })();
    const recordedId = await world.recordedDB.insertOnce(
        Object.assign(new Recorded(), {
            channelId: 21,
            dropLogFileId,
            duration: 60_000,
            endAt: Date.now() - 86_400_000 + 60_000,
            halfWidthName: 'synthetic recorded',
            isProtected: false,
            isRecording: false,
            name: 'synthetic recorded',
            startAt: Date.now() - 86_400_000,
            ...options.overrides,
        }),
    );
    await mkdir(recordedRootOf(world), { recursive: true });
    const videoFileIds: number[] = [];
    for (const name of files) {
        await writeFile(join(recordedRootOf(world), name), 'synthetic-video');
        videoFileIds.push(
            await world.videoFileDB.insertOnce(
                Object.assign(new VideoFile(), {
                    filePath: name,
                    name,
                    parentDirectoryName: 'synthetic-root',
                    recordedId,
                    size: 15,
                    type: 'ts',
                }),
            ),
        );
    }
    if (options.withMetadata !== false) {
        await mkdir(world.config.thumbnail as string, { recursive: true });
        await writeFile(join(world.config.thumbnail as string, `${recordedId}.jpg`), 'jpeg');
        await world.thumbnailDB.insertOnce(thumbnailRow(`${recordedId}.jpg`, recordedId));
    }
    return { dropLogFileId, recordedId, videoFileIds };
};

const rowCounts = async (world: World, recordedId: number) => ({
    recorded: await world.recordedDB.findId(recordedId),
    thumbnails: (await world.thumbnailDB.findAll()) as unknown[],
    videoFiles: ((await world.videoFileDB.findAll()) as Array<{ recordedId: number }>).filter(
        row => row.recordedId === recordedId,
    ),
});

/** エンコードの子 process が動き、出力 file を書き始めるまで待つ。 */
const waitForEncodeProcess = async (world: World, encode: Awaited<ReturnType<typeof createRealEncode>>) => {
    await eventually(() => expect(encode.encoders[0]?.childProcess ?? null).not.toBeNull());
    await eventually(() => expect(existsSync(join(recordedRootOf(world), 'encode-out'))).toBe(true));
    return encode.encoders[0].childProcess as { exitCode: number | null; killed: boolean; signalCode: string | null };
};

describe('user deletion of a recorded program on real components', () => {
    it('[WC-5.1][WC-5.2][WC-5.6] stops the queued and running encodes of the target first, then deletes the thumbnail, files, drop log, and the recorded program', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const { api, encode } = await wireDeletion(world);
            try {
                const target = await addRecordedWithFiles(world);
                await encode.push(target.recordedId, target.videoFileIds[0]);
                await encode.push(target.recordedId, target.videoFileIds[0]);
                const child = await waitForEncodeProcess(world, encode);
                const outputPath = join(recordedRootOf(world), 'encode-out');
                expect(existsSync(outputPath)).toBe(true);
                expect(encode.manage.getEncodeInfo()).toMatchObject({
                    runningQueue: [expect.anything()],
                    waitQueue: [expect.anything()],
                });

                const order: string[] = [];
                const prepare = world.recorded.prepareUserDeletion.bind(world.recorded);
                let atPrepare: { signaled: boolean; waiting: number } | undefined;
                vi.spyOn(world.recorded, 'prepareUserDeletion').mockImplementation(async (recordedId: number) => {
                    order.push('prepare');
                    atPrepare = {
                        signaled: child.killed,
                        waiting: encode.manage.getEncodeInfo().waitQueue.length,
                    };
                    return prepare(recordedId);
                });
                const deletePrepared = world.recorded.deletePrepared.bind(world.recorded);
                vi.spyOn(world.recorded, 'deletePrepared').mockImplementation(async (token: object) => {
                    order.push('deletePrepared');
                    return deletePrepared(token);
                });

                await api.delete(target.recordedId);

                // エンコードの取消が終わってから、削除の準備・実行に進む。
                expect(order).toEqual(['prepare', 'deletePrepared']);
                // 待機中のエンコードは取り消され、実行中のエンコードの process には停止（SIGINT）を送り終えている。
                expect(atPrepare).toEqual({ signaled: true, waiting: 0 });
                await eventually(() => expect(encode.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] }));
                const after = await rowCounts(world, target.recordedId);
                expect(after.recorded).toBeNull();
                expect(after.videoFiles).toEqual([]);
                expect(after.thumbnails).toEqual([]);
                expect(await world.dropLogFileDB.findId(target.dropLogFileId)).toBeNull();
                expect(existsSync(join(recordedRootOf(world), 'source.ts'))).toBe(false);
                expect(existsSync(join(world.config.thumbnail as string, `${target.recordedId}.jpg`))).toBe(false);
                expect(existsSync(join(world.config.dropLog as string, 'drop.log'))).toBe(false);
            } finally {
                await encode.dispose();
            }
        });
    }, 60_000);

    it('[WC-5.3][WC-5.7] leaves the existence and protection judgement to the recorded side, and does not resume the cancelled encodes after such a failure', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const { api, encode } = await wireDeletion(world);
            try {
                const protectedRecorded = await addRecordedWithFiles(world, { overrides: { isProtected: true } });
                await encode.push(protectedRecorded.recordedId, protectedRecorded.videoFileIds[0]);
                const child = await waitForEncodeProcess(world, encode);
                const providerCalls = encode.encoders.length;

                await expect(api.delete(protectedRecorded.recordedId)).rejects.toThrow('RecordedIsProtected');
                await expect(api.delete(protectedRecorded.recordedId + 1_000)).rejects.toThrow('RecordedIdIsNotFound');

                // エンコードは取り消されたまま（再開しない）。保護された番組と file は残る。
                await eventually(() => expect(child.exitCode !== null || child.signalCode !== null).toBe(true));
                await eventually(() => expect(encode.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] }));
                await new Promise(resolve => setTimeout(resolve, 500));
                expect(encode.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
                expect(encode.encoders).toHaveLength(providerCalls);
                const after = await rowCounts(world, protectedRecorded.recordedId);
                expect(after.recorded).not.toBeNull();
                expect(existsSync(join(recordedRootOf(world), 'source.ts'))).toBe(true);
            } finally {
                await encode.dispose();
            }
        });
    }, 60_000);

    it('[WC-5.4][WC-5.6][WC-5.12] stops the running recording until its terminal state before deleting, and deletes with the plan read again after the stop', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const { api, encode } = await wireDeletion(world);
            try {
                const { reserve, sender } = await startRecording(world, { id: 1_901, programId: 1_901 });
                await sender.write(chunk(1));
                const [recording] = (await world.recordedDB.findReserveId(reserve.id)) as Array<Record<string, any>>;
                const order: string[] = [];
                let sizeAfterStop = -1;
                const stop = world.wired.manager.cancelForDeletion.bind(world.wired.manager);
                vi.spyOn(world.wired.manager, 'cancelForDeletion').mockImplementation(async (reserveId: number) => {
                    order.push('stop');
                    await stop(reserveId);
                    order.push('stopped');
                    sizeAfterStop = statSync(join(recordedRootOf(world), 'synthetic-session.ts')).size;
                    // 停止の間に、録画済み番組へ録画 file が増えた状態にする（停止前の削除計画には無い）。
                    await writeFile(join(recordedRootOf(world), 'added-during-stop.ts'), 'late');
                    await world.videoFileDB.insertOnce(
                        Object.assign(new VideoFile(), {
                            filePath: 'added-during-stop.ts',
                            name: 'late',
                            parentDirectoryName: 'synthetic-root',
                            recordedId: recording.id,
                            size: 4,
                            type: 'ts',
                        }),
                    );
                });
                const deletePrepared = world.recorded.deletePrepared.bind(world.recorded);
                let atDelete: { closed: boolean; sizeAtDelete: number } | undefined;
                vi.spyOn(world.recorded, 'deletePrepared').mockImplementation(async (token: object) => {
                    order.push('deletePrepared');
                    atDelete = {
                        closed: world.tuner.server.closedAt.has('program:1901'),
                        sizeAtDelete: statSync(join(recordedRootOf(world), 'synthetic-session.ts')).size,
                    };
                    return deletePrepared(token);
                });

                await api.delete(recording.id);

                // 録画が終端状態になってから削除に進む。停止の間に増えた録画 file も、読み直した計画で消える。
                expect(order).toEqual(['stop', 'stopped', 'deletePrepared']);
                // 停止が終わった後は、録画 file へ書き込まれない（削除の時点の大きさが、停止直後と同じ）。
                expect(sizeAfterStop).toBeGreaterThan(0);
                expect(atDelete).toEqual({ closed: true, sizeAtDelete: sizeAfterStop });
                expect(world.wired.manager.hasReserve(reserve.id)).toBe(false);
                const after = await rowCounts(world, recording.id);
                expect(after.recorded).toBeNull();
                expect(after.videoFiles).toEqual([]);
                expect(existsSync(join(recordedRootOf(world), 'added-during-stop.ts'))).toBe(false);
                const files = await readdir(recordedRootOf(world));
                expect(files.filter(name => name.endsWith('.ts'))).toEqual([]);
                sender.end();
            } finally {
                await encode.dispose();
            }
        });
    }, 60_000);

    it('[WC-5.5] does not stop another recording when the target says it is recording but no reservation or recording process can be confirmed', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const { api, encode } = await wireDeletion(world);
            try {
                const other = await startRecording(world, { id: 1_911, programId: 1_911 });
                await other.sender.write(chunk(1));
                const stop = vi.spyOn(world.wired.manager, 'cancelForDeletion');
                const orphan = await addRecordedWithFiles(world, { overrides: { isRecording: true, reserveId: 4_242 } });
                expect(world.wired.manager.hasReserve(4_242)).toBe(false);

                await api.delete(orphan.recordedId);

                expect(stop).not.toHaveBeenCalled();
                expect((await rowCounts(world, orphan.recordedId)).recorded).toBeNull();
                // 別の録画は録画を続けている。
                const [row] = (await world.recordedDB.findReserveId(other.reserve.id)) as Array<Record<string, any>>;
                expect(row.isRecording).toBe(true);
                expect(world.tuner.server.closedAt.has('program:1911')).toBe(false);
                other.sender.end();
            } finally {
                await encode.dispose();
            }
        });
    }, 60_000);

    it('[WC-5.8] does not restart a stopped recording when the deletion fails afterwards', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const { api, encode } = await wireDeletion(world);
            try {
                const { reserve, sender } = await startRecording(world, { id: 1_921, programId: 1_921 });
                await sender.write(chunk(1));
                const [recording] = (await world.recordedDB.findReserveId(reserve.id)) as Array<Record<string, any>>;
                await world.query("CREATE TRIGGER refuse_delete BEFORE DELETE ON recorded BEGIN SELECT RAISE(ABORT, 'refused'); END");
                const streamRequests = () => world.tuner.server.requests.filter(request => request.url.includes('/stream')).length;
                const providerCalls = world.wired.provider.mock.calls.length;
                const streams = streamRequests();

                await expect(api.delete(recording.id)).rejects.toThrow();
                await new Promise(resolve => setTimeout(resolve, 600));

                // 録画は止まったまま。再開（新しい録画の準備・stream 要求）はしない。
                const [after] = (await world.recordedDB.findReserveId(reserve.id)) as Array<Record<string, any>>;
                expect(after).toBeDefined();
                expect(world.tuner.server.closedAt.has('program:1921')).toBe(true);
                expect(world.wired.provider.mock.calls.length).toBe(providerCalls);
                expect(streamRequests()).toBe(streams);
                sender.end();
            } finally {
                await encode.dispose();
            }
        });
    }, 60_000);

    it('[WC-5.9] does not roll back the files already deleted when another file of the same recorded program cannot be deleted', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const { api, encode } = await wireDeletion(world);
            try {
                const target = await addRecordedWithFiles(world, { files: ['first.ts', 'stuck.ts', 'third.ts'], withMetadata: false });
                // 2 番目の録画 file は、同じ名前の空でない directory に置き換えて、削除できない状態にする。
                await rm(join(recordedRootOf(world), 'stuck.ts'));
                await mkdir(join(recordedRootOf(world), 'stuck.ts'));
                await writeFile(join(recordedRootOf(world), 'stuck.ts', 'inner'), 'x');

                await api.delete(target.recordedId).catch(() => undefined);

                // 削除できた file は戻らず、削除できなかった file は残る。
                expect(existsSync(join(recordedRootOf(world), 'first.ts'))).toBe(false);
                expect(existsSync(join(recordedRootOf(world), 'stuck.ts', 'inner'))).toBe(true);
                expect(world.log.system.error).toHaveBeenCalled();
            } finally {
                await encode.dispose();
            }
        });
    }, 60_000);

    it('[WC-5.10] leaves the protection judgement, file selection, and concurrency control to the recorded side', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const { api, encode } = await wireDeletion(world);
            try {
                const target = await addRecordedWithFiles(world, { withMetadata: false });
                const tagId = await world.tags.create('related tag', '#707070');
                await world.tags.setRelation(tagId, target.recordedId);

                // 同時に 2 件の削除要求。連携機能は自分で排他せず、後の要求は録画済み番組管理の判定（存在しない）で失敗する。
                const results = await Promise.allSettled([api.delete(target.recordedId), api.delete(target.recordedId)]);

                expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
                const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
                expect(rejected).toHaveLength(1);
                expect(String(rejected[0].reason)).toMatch(/RecordedIdIsNotFound|Recorded/u);
                expect((await rowCounts(world, target.recordedId)).recorded).toBeNull();
                // タグの関連付けは録画済み番組管理が解く。タグ自体は残る。
                expect(await world.recordedTagDB.findId(tagId)).not.toBeNull();
            } finally {
                await encode.dispose();
            }
        });
    }, 60_000);

    it('[WC-5.11] does not take the user deletion path for an automatic deletion by storage pressure', async () => {
        await withWorld({}, async world => {
            world.setter.set();
            const { encode } = await wireDeletion(world);
            try {
                const target = await addRecordedWithFiles(world, { withMetadata: false });
                await encode.push(target.recordedId, target.videoFileIds[0]);
                const child = await waitForEncodeProcess(world, encode);
                const cancelEncode = vi.spyOn(encode.manage, 'cancelEncodeByRecordedId');
                const prepareUser = vi.spyOn(world.recorded, 'prepareUserDeletion');
                const adapter = new StoragePressureDeletionAdapter(
                    world.recorded,
                    new RecordingRecordedUseProvider(),
                    { releaseDeletion: vi.fn(), tryAcquireDeletion: vi.fn(() => ({ token: {} })) },
                );

                const outcome = await adapter.deleteForStoragePressure(target.recordedId, 'synthetic-root');

                expect(outcome).toBe('deleted');
                expect((await rowCounts(world, target.recordedId)).recorded).toBeNull();
                // 利用者の削除の経路（エンコードの取消の依頼、削除の準備）は呼ばれない。エンコードの process は動いたまま。
                expect(cancelEncode).not.toHaveBeenCalled();
                expect(prepareUser).not.toHaveBeenCalled();
                expect(child.exitCode).toBeNull();
                expect(child.signalCode).toBeNull();
            } finally {
                await encode.dispose();
            }
        });
    }, 60_000);
});
