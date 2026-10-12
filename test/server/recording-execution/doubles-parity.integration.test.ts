import 'reflect-metadata';

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS, provisionMySql, type MySqlRuntime } from '../persistence/mysql-runtime';
import { Reserve } from './_harness';
import {
    CHUNK_SIZE,
    chunk,
    createRealTuner,
    insertReserve,
    TunerServerAccessModel,
    type TunerFixture,
    wireRecording,
    write,
} from './_real-tuner-wiring';

/*
 * 録画の test が使う偽物（`new Reserve()` の instance の予約、socket を持たない `PassThrough` の tuner stream、
 * microtask だけで解決する DB）が、本番の部品（DB から読んだ予約を録画の経路が凍結して渡す写し、tuner server の
 * HTTP 応答の `IncomingMessage`、同期の better-sqlite3）と同じに振る舞うことを確かめる。録画の経路
 * （`RecordingManageModel` → `RecorderModel` → `RecordingStreamCreator` → `TunerServerAccessModel`）は本物で、
 * 本物の DB の上で流す。
 */

const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT!;

let mysqlRuntime: MySqlRuntime | undefined;

beforeAll(async () => {
    mysqlRuntime = await provisionMySql();
}, MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS);

afterAll(async () => {
    await mysqlRuntime?.cleanup();
}, MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS);

const withDatabase = async (
    dialect: 'sqlite' | 'mysql',
    operation: (source: DataSource, root: string) => Promise<void>,
): Promise<void> => {
    const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-parity-'));
    const cleanups: Array<() => Promise<void>> = [() => rm(root, { force: true, recursive: true })];
    try {
        const common = { entities: [join(snapshot, 'db', 'entities', '*.js')], logging: false, synchronize: true };
        let options: DataSourceOptions;
        if (dialect === 'sqlite') {
            options = { ...common, type: 'better-sqlite3', database: join(root, 'recording.db') };
        } else {
            const schema = await mysqlRuntime!.createSchema();
            cleanups.push(() => schema.cleanup());
            // fixture の接続情報（host・port・user・database と認証の値）をそのまま渡す。
            const { user: username, ...connection } = schema.config;
            options = {
                ...common,
                ...connection,
                type: 'mysql',
                username,
                charset: 'utf8mb4',
                bigNumberStrings: false,
            };
        }
        const source = new DataSource(options);
        cleanups.push(async () => {
            if (source.isInitialized) await source.destroy();
        });
        await source.initialize();
        await operation(source, root);
    } finally {
        const failures: unknown[] = [];
        while (cleanups.length > 0) {
            try {
                await cleanups.pop()!();
            } catch (error) {
                failures.push(error);
            }
        }
        if (failures.length > 0) throw new AggregateError(failures, 'recording parity cleanup failed');
    }
};

type TunerKind = 'passthrough-double' | 'real-http';

const createTuner = async (kind: TunerKind): Promise<TunerFixture> => {
    if (kind === 'passthrough-double') {
        const streams = new Map<number, PassThrough>();
        const opened = new Map<number, () => void>();
        const streamFor = (programId: number): PassThrough => {
            let stream = streams.get(programId);
            if (stream === undefined) {
                stream = new PassThrough();
                streams.set(programId, stream);
            }
            return stream;
        };
        const open = vi.fn(async ({ programId }: { programId: number }) => {
            const stream = streamFor(programId);
            opened.get(programId)?.();
            return { close: vi.fn(() => stream.destroy()), stream };
        });
        return {
            access: { getProgram: vi.fn(), openProgramStream: open, openServiceStream: open },
            sender: async programId => {
                await vi.waitFor(() =>
                    expect(open.mock.calls.some(([request]) => request.programId === programId)).toBe(true),
                );
                const stream = streamFor(programId);
                return { write: data => write(stream, data), end: () => stream.end() };
            },
            close: async () => {
                for (const stream of streams.values()) stream.destroy();
            },
        };
    }
    return createRealTuner();
};

describe('reservation instance double against the frozen copy the recording path passes', () => {
    it.each(['sqlite', 'mysql'] as const)(
        '[RE-DOUBLE-PARITY-SNAPSHOT] names the recording file from the frozen copy of a reservation read from real %s the same way as from the instance double',
        async dialect => {
            await withDatabase(dialect, async (source, root) => {
                const tuner = await createTuner('passthrough-double');
                const format = '%ID%-%TITLE%-%CHID%-%YEAR%%MONTH%%DAY%';
                const wired = wireRecording(source, root, tuner, { config: { recordedFormat: format } });
                try {
                    const reserve = await insertReserve(source, {
                        id: 8_301,
                        programId: 8_311,
                        channelId: 8_321,
                        name: 'synthetic-番組 第1話',
                        halfWidthName: 'synthetic-番組 第1話',
                    });
                    const recorders = await wired.startAll([reserve.id]);
                    const recorder = recorders.get(reserve.id);

                    // 録画の経路が渡す予約は、DB から読んだ行を凍結した写しで、Reserve の instance ではない。
                    const passed = (manager => manager.candidateRegistry.list()[0].reservation)(wired.manager as any);
                    expect(passed).not.toBeInstanceOf(Reserve);
                    expect(Object.isFrozen(passed)).toBe(true);
                    expect(recorder.reserve).toBe(passed);

                    const fromCopy = await wired.recordingUtil.getRecPath(passed, true);
                    const fromInstance = await wired.recordingUtil.getRecPath(
                        Object.assign(new Reserve(), { ...passed }),
                        true,
                    );
                    expect(fromInstance).toEqual(fromCopy);
                    expect(fromCopy.fileName).toMatch(/^8301-synthetic-番組 第1話-8321-\d{8}\.ts$/u);

                    // 録画を最後まで流し、DB に登録される file 名も同じ写しから作られる。
                    const preparation = recorder.startPreparation();
                    const sender = await tuner.sender(reserve.programId);
                    await sender.write(chunk(0));
                    await preparation;
                    await vi.waitFor(() => expect(wired.started).toHaveBeenCalledOnce());
                    sender.end();
                    await vi.waitFor(() => expect(wired.finished).toHaveBeenCalledOnce());
                    const [videoFile] = await wired.videoFileDB.findAll();
                    expect(videoFile.filePath).toBe(fromCopy.fileName);
                    await expect(readFile(join(root, videoFile.filePath))).resolves.toEqual(chunk(0));
                } finally {
                    wired.stop();
                    await tuner.close();
                }
            });
        },
        120_000,
    );
});

describe('PassThrough tuner stream double against a real HTTP IncomingMessage', () => {
    const recordAndEnd = async (kind: TunerKind): Promise<{ file: Buffer; sent: Buffer }> => {
        let result!: { file: Buffer; sent: Buffer };
        await withDatabase('sqlite', async (source, root) => {
            const tuner = await createTuner(kind);
            const wired = wireRecording(source, root, tuner);
            try {
                const reserve = await insertReserve(source, { id: 8_401, programId: 8_411 });
                const recorder = (await wired.startAll([reserve.id])).get(reserve.id);
                const preparation = recorder.startPreparation();
                const sender = await tuner.sender(reserve.programId);
                const sent: Buffer[] = [];
                for (let index = 0; index < 20; index++) {
                    sent.push(chunk(index));
                    await sender.write(sent[index]);
                    if (index === 0) await preparation;
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
                sender.end();
                await vi.waitFor(() => expect(wired.finished).toHaveBeenCalledOnce(), { timeout: 30_000 });
                // 完了通知は非同期の file size 更新より先に届く。DB に終端のサイズが反映される状態を待つ。
                await vi.waitFor(async () => {
                    const [row] = await wired.videoFileDB.findAll();
                    expect(row.size).toBe(sent.length * CHUNK_SIZE);
                });
                const [videoFile] = await wired.videoFileDB.findAll();
                expect(videoFile.size).toBe(sent.length * CHUNK_SIZE);
                expect(wired.failed).not.toHaveBeenCalled();
                result = { file: await readFile(join(root, videoFile.filePath)), sent: Buffer.concat(sent) };
            } finally {
                wired.stop();
                await tuner.close();
            }
        });
        return result;
    };

    it('[RE-DOUBLE-PARITY-STREAM] records every byte to the end of the stream the same way from the PassThrough double and from a real HTTP response', async () => {
        const doubled = await recordAndEnd('passthrough-double');
        const real = await recordAndEnd('real-http');

        expect(doubled.file.equals(doubled.sent)).toBe(true);
        expect(real.file.equals(real.sent)).toBe(true);
        expect(real.file.equals(doubled.file)).toBe(true);
    }, 120_000);

    const recordAndCancel = async (kind: TunerKind): Promise<{ fileLength: number; sentLength: number }> => {
        let result!: { fileLength: number; sentLength: number };
        await withDatabase('sqlite', async (source, root) => {
            const tuner = await createTuner(kind);
            const wired = wireRecording(source, root, tuner);
            try {
                const reserve = await insertReserve(source, { id: 8_501, programId: 8_511 });
                const recorder = (await wired.startAll([reserve.id])).get(reserve.id);
                const preparation = recorder.startPreparation();
                const sender = await tuner.sender(reserve.programId);
                await sender.write(chunk(0));
                await preparation;
                await vi.waitFor(() => expect(wired.started).toHaveBeenCalledOnce());
                let sentLength = CHUNK_SIZE;
                for (let index = 1; index < 10; index++) {
                    await sender.write(chunk(index));
                    sentLength += CHUNK_SIZE;
                }
                // 送った直後（録画側がまだ読んでいない間）に取り消す。
                await recorder.cancel(false);
                await vi.waitFor(async () =>
                    expect(await wired.recordedDB.findReserveId(reserve.id)).toEqual([
                        expect.objectContaining({ isRecording: false }),
                    ]),
                );
                const [videoFile] = await wired.videoFileDB.findAll();
                const file = await readFile(join(root, videoFile.filePath));
                result = { fileLength: file.length, sentLength };
            } finally {
                wired.stop();
                await tuner.close();
            }
        });
        return result;
    };

    it('[RE-DOUBLE-PARITY-STREAM] keeps the data that arrived before a cancel the same way from the PassThrough double and from a real HTTP response', async () => {
        const doubled = await recordAndCancel('passthrough-double');
        const real = await recordAndCancel('real-http');

        expect(real).toEqual({ fileLength: real.sentLength, sentLength: 10 * CHUNK_SIZE });
        expect(doubled).toEqual(real);
    }, 120_000);
});

describe('microtask DB doubles against the synchronous better-sqlite3 when recordings end together', () => {
    it('[RE-DOUBLE-PARITY-SYNC-DB] finishes four recordings whose real HTTP streams end in the same turn on real sqlite without losing data', async () => {
        await withDatabase('sqlite', async (source, root) => {
            const tuner = await createTuner('real-http');
            const wired = wireRecording(source, root, tuner, { config: { recordedFormat: '%ID%' } });
            try {
                const reservations = [];
                for (let index = 0; index < 4; index++) {
                    reservations.push(await insertReserve(source, { id: 8_601 + index, programId: 8_611 + index }));
                }
                const recorders = await wired.startAll(reservations.map(reserve => reserve.id));
                const senders = [];
                for (const reserve of reservations) {
                    const preparation = recorders.get(reserve.id).startPreparation();
                    const sender = await tuner.sender(reserve.programId);
                    await sender.write(chunk(0));
                    await preparation;
                    senders.push(sender);
                }
                await vi.waitFor(() => expect(wired.started).toHaveBeenCalledTimes(4));
                for (let index = 1; index < 30; index++) {
                    await Promise.all(senders.map(sender => sender.write(chunk(index))));
                }
                // 4 本の stream の最後の data と終わりを、同じ turn に送る。
                for (const sender of senders) {
                    void sender.write(chunk(30));
                    sender.end();
                }
                await vi.waitFor(() => expect(wired.finished).toHaveBeenCalledTimes(4), { timeout: 30_000 });

                const recordeds = (
                    await Promise.all(reservations.map(reserve => wired.recordedDB.findReserveId(reserve.id)))
                ).flat();
                expect(recordeds).toHaveLength(4);
                expect(recordeds.every((recorded: { isRecording: boolean }) => recorded.isRecording === false)).toBe(
                    true,
                );
                const videoFiles = await wired.videoFileDB.findAll();
                expect(videoFiles.map((videoFile: { filePath: string }) => videoFile.filePath).sort()).toEqual([
                    '8601.ts',
                    '8602.ts',
                    '8603.ts',
                    '8604.ts',
                ]);
                for (const videoFile of videoFiles) {
                    expect({
                        file: videoFile.filePath,
                        size: (await readFile(join(root, videoFile.filePath))).length,
                    }).toEqual({
                        file: videoFile.filePath,
                        size: 31 * CHUNK_SIZE,
                    });
                }
                expect(wired.failed).not.toHaveBeenCalled();
            } finally {
                wired.stop();
                await tuner.close();
            }
        });
    }, 120_000);
});

describe('fake recording scheduler and clock against the real scheduler and clock', () => {
    it('[RE-DOUBLE-PARITY-CLOCK] starts the preparation once from the real scheduler when the real clock reaches the preparation time', async () => {
        await withDatabase('sqlite', async (source, root) => {
            const tuner = await createTuner('passthrough-double');
            const wired = wireRecording(source, root, tuner);
            try {
                // 準備は開始の 15 秒前。本物の scheduler は 3 秒ごとに見直すので、準備の時刻から 3 秒以内に動く。
                const prepareIn = 2_000;
                const now = Date.now();
                await insertReserve(source, {
                    id: 8_701,
                    programId: 8_711,
                    startAt: now + 15_000 + prepareIn,
                    endAt: now + 15_000 + prepareIn + 60_000,
                });
                await wired.manager.rebuildCandidatesAndStart();
                await vi.waitFor(() => expect(wired.provider).toHaveBeenCalledOnce());
                expect(wired.prepStarted).not.toHaveBeenCalled();

                await vi.waitFor(() => expect(wired.prepStarted).toHaveBeenCalledOnce(), {
                    timeout: prepareIn + 6_000,
                    interval: 50,
                });
                const elapsed = Date.now() - now;
                expect(elapsed).toBeGreaterThanOrEqual(prepareIn - 50);
                expect(elapsed).toBeLessThan(prepareIn + 4_500);
                expect(wired.prepStarted.mock.calls[0][0]).toMatchObject({ id: 8_701 });
                await new Promise(resolve => setTimeout(resolve, 3_500));
                expect(wired.prepStarted).toHaveBeenCalledOnce();
            } finally {
                wired.stop();
                await tuner.close();
            }
        });
    }, 60_000);
});
