import 'reflect-metadata';

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { provisionMariaDb } from '../persistence/mysql-runtime';
import {
    deferred,
    DropLogFile,
    DropLogFileDB,
    load,
    logger,
    makeRecordingSessionBinding,
    makeRecorded,
    makeReserve,
    ProgramDB,
    Recorded,
    RecordedDB,
    RecordedHistory,
    RecordedHistoryDB,
    RecorderModel,
    RecordingEvent,
    RecordingManageModel,
    RecordingStreamCreator,
    RecordingUtilModel,
    Reserve,
    ReserveDB,
    VideoFile,
    VideoFileDB,
} from './_harness';

const RecordingApiModel = load<new (...args: any[]) => any>('model', 'api', 'recording', 'RecordingApiModel.js');
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT!;
const retry = { run: <T>(operation: () => Promise<T>): Promise<T> => operation() };

const withDatabase = async (
    dialect: 'sqlite' | 'mysql',
    operation: (source: DataSource, root: string) => Promise<void>,
): Promise<void> => {
    const cleanups: Array<() => Promise<void>> = [];
    const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-persistence-'));
    cleanups.push(() => rm(root, { force: true, recursive: true }));
    try {
        const common = { entities: [join(snapshot, 'db', 'entities', '*.js')], logging: false, synchronize: true };
        let options: DataSourceOptions;
        if (dialect === 'sqlite') {
            options = { ...common, type: 'better-sqlite3', database: join(root, 'recording.db') };
        } else {
            const maria = await provisionMariaDb();
            cleanups.push(() => maria.cleanup());
            const schema = await maria.createSchema();
            cleanups.push(() => schema.cleanup());
            options = {
                ...common,
                type: 'mysql',
                host: schema.config.host,
                port: schema.config.port,
                username: schema.config.user,
                password: schema.config.password,
                database: schema.config.database,
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
        if (failures.length > 0) throw new AggregateError(failures, 'recording persistence cleanup failed');
    }
};

// sqlite の QueryRunner はドライバーに 1 個だけキャッシュされるため、`createQueryRunner()` を
// このセッション内で何度呼んでも同じ instance が返る（`AbstractSqliteQueryRunner.release` のコメント
// どおり複数 connection/query runner を持たない仕様）。Vitest 5 の `vi.spyOn` は対象が既に mock だと
// その mock をそのまま返し呼び出し履歴も引き継ぐため、`vi.spyOn(runner, 'release'/'startTransaction')`
// を呼び出しのたびに繰り返すと、全ての push が同じ mock 参照になり、どれか 1 回でも実際に
// startTransaction が呼ばれると全 push が「transactional」と誤判定される。runner instance ごとに
// 一度だけ true original を捕まえて実装を差し込み、以後は呼び出し回数を数える先の counters
// オブジェクトを呼び出しのたびに差し替えることで、呼び出しごとの回数を独立して観測する。
const instrumentationByRunner = new WeakMap<
    object,
    { current: { release: { value: number }; startTransaction: { value: number } } }
>();

const observeQueryRunnerReleases = (source: DataSource) => {
    const runners: Array<{
        readonly releaseCalls: number;
        readonly runner: any;
        readonly startTransactionCalls: number;
    }> = [];
    const originalCreateQueryRunner = source.createQueryRunner.bind(source);
    const createQueryRunner = vi.spyOn(source, 'createQueryRunner').mockImplementation((mode?: any) => {
        const runner = originalCreateQueryRunner(mode);

        let entry = instrumentationByRunner.get(runner);
        if (entry === undefined) {
            const trueOriginalRelease = runner.release.bind(runner);
            const trueOriginalStart = runner.startTransaction.bind(runner);
            entry = { current: { release: { value: 0 }, startTransaction: { value: 0 } } };
            instrumentationByRunner.set(runner, entry);
            vi.spyOn(runner, 'release').mockImplementation(async (...arguments_: any[]) => {
                entry!.current.release.value += 1;
                return trueOriginalRelease(...arguments_);
            });
            vi.spyOn(runner, 'startTransaction').mockImplementation(async (...arguments_: any[]) => {
                entry!.current.startTransaction.value += 1;
                return trueOriginalStart(...arguments_);
            });
        }
        const counters = { release: { value: 0 }, startTransaction: { value: 0 } };
        entry.current = counters;
        runners.push({
            get releaseCalls() {
                return counters.release.value;
            },
            runner,
            get startTransactionCalls() {
                return counters.startTransaction.value;
            },
        });
        return runner;
    });

    return {
        assertReleased: (): void => {
            expect(createQueryRunner).toHaveBeenCalled();
            const transactionalRunners = runners.filter(({ startTransactionCalls }) => startTransactionCalls > 0);
            expect(transactionalRunners).toHaveLength(1);
            for (const { releaseCalls, runner } of transactionalRunners) {
                expect(releaseCalls).toBe(1);
                expect(runner.isTransactionActive).toBe(false);
            }
        },
        restore: (): void => createQueryRunner.mockRestore(),
    };
};

const makeProgram = (id: number, startAt: number): Record<string, unknown> =>
    Object.assign(
        {},
        {
            id,
            networkId: 11,
            serviceId: 12,
            eventId: 13,
            startAt,
            duration: 60_000,
            isFree: true,
            name: 'Task 9.4 database program',
            description: 'database integration fixture',
        },
    );

const makeDatabaseRecorded = (overrides: Record<string, unknown> = {}): Record<string, unknown> =>
    Object.assign(new Recorded(), {
        channelId: 101,
        description: null,
        dropLogFileId: null,
        duration: 60_000,
        endAt: 1_700_000_060_000,
        extended: null,
        genre1: null,
        genre2: null,
        genre3: null,
        halfWidthDescription: null,
        halfWidthExtended: null,
        halfWidthName: 'Task 9.4 database row',
        isProtected: false,
        isRecording: true,
        name: 'Task 9.4 database row',
        programId: 9_401,
        rawExtended: null,
        rawHalfWidthExtended: null,
        reserveId: null,
        ruleId: null,
        startAt: 1_700_000_000_000,
        subGenre1: null,
        subGenre2: null,
        subGenre3: null,
        videoComponentType: null,
        videoResolution: null,
        videoStreamContent: null,
        videoType: null,
        ...overrides,
    });

describe('recording persistence sequence', () => {
    it.each([
        ['sqlite', 'normal', false, false, 2],
        ['mysql', 'conflict', true, false, 9],
        ['sqlite', 'time-specified', false, true, 2],
    ] as const)(
        '[Task 8.2] persists a synthetic %s %s process from candidate through terminal completion (%s priority)',
        async (dialect, scenario, isConflict, isTimeSpecified, priority) => {
            await withDatabase(dialect, async source => {
                const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-process-'));
                const now = Date.now();
                const reserve = makeReserve({
                    id: isTimeSpecified ? 823 : isConflict ? 822 : 821,
                    isConflict,
                    isTimeSpecified,
                    programId: isTimeSpecified ? null : 101,
                    startAt: now + 120_000,
                    endAt: now + 180_000,
                    updateTime: now,
                });
                const operator = { getConnection: async () => source, getLikeStr: () => 'like' };
                const reserveDB = new ReserveDB(operator, retry);
                const recordedDB = new RecordedDB(operator, retry);
                const videoFileDB = new VideoFileDB(operator, retry);
                const configuration = {
                    getConfig: () => ({
                        conflictPriority: 9,
                        isEnabledDropCheck: false,
                        recPriority: 2,
                        recorded: [{ name: 'synthetic-root', path: root }],
                        recordedFileExtension: '.ts',
                        recordedFormat: 'synthetic-session',
                        timeSpecifiedEndMargin: 0,
                        timeSpecifiedStartMargin: isTimeSpecified ? 180 : 0,
                    }),
                };
                const stream = new PassThrough();
                const close = vi.fn();
                const open = vi.fn(async ({ priority: actualPriority }: { priority: number }) => {
                    expect(actualPriority).toBe(priority);
                    return { close, stream };
                });
                const tunerServerAccess = {
                    getProgram: vi.fn(),
                    openProgramStream: open,
                    openServiceStream: open,
                };
                const streamCreator = new RecordingStreamCreator(
                    { getLogger: () => logger },
                    configuration,
                    tunerServerAccess,
                );
                streamCreator.setTuner([{ types: ['GR'] }]);
                const programDB = {
                    findChannelIdAndTime: vi.fn(async () => null),
                    findEventRelayProgram: vi.fn(async () => null),
                    findId: vi.fn(async () => ({ id: reserve.programId })),
                };
                const recordingUtil = new RecordingUtilModel(
                    { getLogger: () => logger },
                    configuration,
                    { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
                    {
                        findId: vi.fn(async () => ({
                            channel: 'synthetic-channel',
                            channelType: 'GR',
                            halfWidthName: 'synthetic-channel',
                            name: 'synthetic-channel',
                            serviceId: 1,
                        })),
                    },
                    programDB,
                    videoFileDB,
                    {
                        getFullFilePathFromId: vi.fn(async (videoFileId: number) => {
                            const videoFile = await videoFileDB.findId(videoFileId);
                            return videoFile === null ? null : join(root, videoFile.filePath);
                        }),
                    },
                );
                const updateVideoFileSize = vi.spyOn(recordingUtil, 'updateVideoFileSize');
                if (scenario === 'time-specified') {
                    updateVideoFileSize.mockRejectedValueOnce(new Error('synthetic final size failure'));
                }
                const event = new RecordingEvent({ getLogger: () => logger });
                const recorder = new RecorderModel(
                    { getLogger: () => logger },
                    configuration,
                    programDB,
                    reserveDB,
                    recordedDB,
                    { insertOnce: vi.fn(async () => 1) },
                    videoFileDB,
                    { insertOnce: vi.fn(async () => 1), updateCnt: vi.fn(async () => undefined) },
                    streamCreator,
                    {
                        getFilePath: vi.fn(() => null),
                        getResult: vi.fn(async () => ({})),
                        start: vi.fn(async () => undefined),
                        stop: vi.fn(async () => undefined),
                    },
                    recordingUtil,
                    event,
                    tunerServerAccess,
                );
                const provider = vi.fn(async () => recorder);
                const manager = new RecordingManageModel(
                    { getLogger: () => logger },
                    configuration,
                    provider,
                    event,
                    streamCreator,
                    recordedDB,
                    reserveDB,
                    recordingUtil,
                );
                const started = vi.spyOn(event, 'emitStartRecording');
                const finished = vi.spyOn(event, 'emitFinishRecording');

                const sentinel = join(root, 'synthetic-session.ts');
                try {
                    await source.getRepository(Reserve).insert(reserve);
                    await writeFile(sentinel, 'synthetic-existing-file', 'utf8');
                    await manager.rebuildCandidatesAndStart();
                    await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());

                    const waiting = (manager as any).scheduleController.getSessionSnapshot(reserve.id);
                    expect(waiting).toMatchObject({ phase: 'Waiting', reservationId: reserve.id });
                    expect(
                        (manager as any).scheduleController.tryTransitionSession(
                            reserve.id,
                            waiting.generation,
                            waiting.sessionToken,
                            'Waiting',
                            'Preparing',
                        ),
                    ).toBe(true);
                    (manager as any).bindRecorder(
                        recorder,
                        (manager as any).scheduleController.getSessionSnapshot(reserve.id),
                    );

                    const preparation = recorder.startPreparation();
                    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
                    stream.write('synthetic-first-data');
                    await preparation;
                    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());

                    stream.end();
                    await vi.waitFor(() => expect(finished).toHaveBeenCalledOnce());
                    const recordeds = await recordedDB.findReserveId(reserve.id);
                    const videoFiles = await videoFileDB.findAll();

                    expect(recordeds).toHaveLength(1);
                    expect(recordeds[0]).toMatchObject({ isRecording: false, reserveId: reserve.id });
                    expect(videoFiles).toHaveLength(1);
                    expect(videoFiles[0].filePath).toBe('synthetic-session(1).ts');
                    await expect(readFile(join(root, videoFiles[0].filePath), 'utf8')).resolves.toBe(
                        'synthetic-first-data',
                    );
                    await expect(readFile(sentinel, 'utf8')).resolves.toBe('synthetic-existing-file');
                    await vi.waitFor(() => expect(updateVideoFileSize).toHaveBeenCalledOnce());
                    expect(close).toHaveBeenCalledOnce();
                } finally {
                    (manager as any).scheduleController.stop();
                    await rm(root, { force: true, recursive: true });
                }
            });
        },
        120_000,
    );

    it('[Task 7.3] rebuilds future normal and conflict candidates from the real sqlite reservation list', async () => {
        await withDatabase('sqlite', async source => {
            const now = Date.now();
            await source.transaction(async manager => {
                await manager.insert(Reserve, makeReserve({ id: 91, updateTime: 1, endAt: now + 60_000 }));
                await manager.insert(
                    Reserve,
                    makeReserve({ id: 92, updateTime: 1, isConflict: true, endAt: now + 60_000 }),
                );
                await manager.insert(
                    Reserve,
                    makeReserve({ id: 93, updateTime: 1, isSkip: true, endAt: now + 60_000 }),
                );
                await manager.insert(
                    Reserve,
                    makeReserve({ id: 94, updateTime: 1, isOverlap: true, endAt: now + 60_000 }),
                );
                await manager.insert(Reserve, makeReserve({ id: 95, updateTime: 1, endAt: now - 1 }));
            });
            const operator = { getConnection: async () => source, getLikeStr: () => 'like' };
            const reserveDB = new ReserveDB(operator, retry);
            const recordedDB = new RecordedDB(operator, retry);
            const model = new RecordingManageModel(
                { getLogger: () => logger },
                { getConfig: () => ({ recordedTmp: '/synthetic-tmp' }) },
                vi.fn(),
                {
                    setCancelPrepRecording: vi.fn(),
                    setPrepRecordingFailed: vi.fn(),
                    setRecordingFailed: vi.fn(),
                    setFinishRecording: vi.fn(),
                },
                { setTuner: vi.fn() },
                recordedDB,
                reserveDB,
                { movingFromTmp: vi.fn(), updateVideoFileSize: vi.fn().mockResolvedValue(undefined) },
            );

            try {
                await model.rebuildCandidatesAndStart();
                expect(
                    (model as any).candidateRegistry.list().map((candidate: any) => candidate.reservationId),
                ).toEqual([91, 92]);
            } finally {
                (model as any).scheduleController.stop();
            }
        });
    });

    it('[Task 7.1] destroys an initialized persistence backend when setup aborts', async () => {
        const failure = new Error('synthetic persistence setup failure');
        let captured!: DataSource;
        await expect(
            withDatabase('sqlite', async source => {
                captured = source;
                throw failure;
            }),
        ).rejects.toBe(failure);
        expect(captured.isInitialized).toBe(false);
    });

    it.each(['sqlite', 'mysql'] as const)(
        '[Task 5.1/6.1/6.2/7.1] performs startup cleanup through real %s entities, transaction, and repositories',
        async dialect => {
            await withDatabase(dialect, async source => {
                const reserve = makeReserve({ id: 61, updateTime: 1 });
                const recorded = makeRecorded({ id: 71, reserveId: 61, isRecording: true });
                const video = Object.assign(new VideoFile(), {
                    id: 81,
                    recordedId: 71,
                    parentDirectoryName: 'synthetic-root',
                    filePath: 'synthetic.ts',
                    type: 'ts',
                    name: 'TS',
                    size: 0,
                });
                await source.transaction(async manager => {
                    await manager.insert(Reserve, reserve);
                    await manager.insert(Recorded, recorded);
                    await manager.insert(VideoFile, video);
                });
                const operator = { getConnection: async () => source, getLikeStr: () => 'like' };
                const reserveDB = new ReserveDB(operator, retry);
                const recordedDB = new RecordedDB(operator, retry);
                const videoFileDB = new VideoFileDB(operator, retry);
                const event = { emitFinishRecording: vi.fn() };
                const recordingUtil = {
                    movingFromTmp: vi.fn(),
                    updateVideoFileSize: vi.fn(async (id: number) => videoFileDB.updateSize(id, 123)),
                };
                const model = new RecordingManageModel(
                    { getLogger: () => logger },
                    { getConfig: () => ({ recordedTmp: '/synthetic-tmp' }) },
                    vi.fn(),
                    {
                        setCancelPrepRecording: vi.fn(),
                        setPrepRecordingFailed: vi.fn(),
                        setRecordingFailed: vi.fn(),
                        setFinishRecording: vi.fn(),
                        ...event,
                    },
                    { setTuner: vi.fn() },
                    recordedDB,
                    reserveDB,
                    recordingUtil,
                );
                const initialize = vi.spyOn(source, 'initialize');
                try {
                    await model.cleanup();
                    await expect(recordedDB.findId(71)).resolves.toMatchObject({ isRecording: false });
                    await expect(videoFileDB.findId(81)).resolves.toMatchObject({ size: 123 });
                    expect(event.emitFinishRecording).toHaveBeenCalledWith(
                        expect.objectContaining({ id: 61 }),
                        expect.objectContaining({ id: 71, isRecording: false }),
                        true,
                    );
                    expect(initialize).not.toHaveBeenCalled();
                } finally {
                    initialize.mockRestore();
                }
            });
        },
        120_000,
    );
});

describe('recording execution database integration', () => {
    it('[INT-CASES-RE-9.4] rejects an unreleased QueryRunner before fixture teardown', async () => {
        await withDatabase('sqlite', async database => {
            const queryRunners = observeQueryRunnerReleases(database);
            const runner = database.createQueryRunner();
            await runner.startTransaction();

            expect(() => queryRunners.assertReleased()).toThrow();

            await runner.rollbackTransaction();
            await runner.release();
            queryRunners.assertReleased();
            queryRunners.restore();
        });
    });

    it.each(['sqlite', 'mysql'] as const)(
        '[result-file-finalization][INT-CASES-RE-9.4] persists and rereads one exact %s session through reservation, program, recorded, file, drop, and history adapters',
        async dialect => {
            await withDatabase(dialect, async (database, root) => {
                const operator = { getConnection: async () => database, getLikeStr: () => 'like' };
                const queryRunners = observeQueryRunnerReleases(database);
                const config = {
                    getConfig: () => ({
                        conflictPriority: 9,
                        isEnabledDropCheck: true,
                        needToReplaceEnclosingCharacters: false,
                        recPriority: 2,
                        recorded: [{ name: 'synthetic-root', path: root }],
                        recordedFileExtension: '.ts',
                        recordedFormat: 'task-9-4',
                        timeSpecifiedEndMargin: 0,
                        timeSpecifiedStartMargin: 0,
                    }),
                };
                const reserveDB = new ReserveDB(operator, retry);
                const programDB = new ProgramDB({ getLogger: () => logger }, config, operator, retry);
                const recordedDB = new RecordedDB(operator, retry);
                const recordedHistoryDB = new RecordedHistoryDB(operator, retry);
                const videoFileDB = new VideoFileDB(operator, retry);
                const dropLogFileDB = new DropLogFileDB(operator, retry);
                const now = Date.now();
                const programId = 9_401;
                const channelTypes = { 11: { 12: { channel: 'synthetic-channel', id: 101, type: 'GR' } } };
                await programDB.insert(channelTypes, [makeProgram(programId, now)]);
                await expect(programDB.findId(programId)).resolves.toMatchObject({
                    channelId: 101,
                    id: programId,
                    name: 'Task 9.4 database program',
                });

                const reserve = makeReserve({
                    channelId: 101,
                    endAt: now + 60_000,
                    programId,
                    ruleId: 77,
                    startAt: now,
                    updateTime: now,
                });
                reserve.id = await reserveDB.insertOnce(reserve);
                await expect(reserveDB.findId(reserve.id)).resolves.toMatchObject({ id: reserve.id, programId });

                const stream = new PassThrough();
                const close = vi.fn();
                const tunerServerAccess = {
                    getProgram: vi.fn(),
                    openProgramStream: vi.fn(async () => ({ close, stream })),
                    openServiceStream: vi.fn(async () => ({ close, stream })),
                };
                const streamCreator = new RecordingStreamCreator(
                    { getLogger: () => logger },
                    config,
                    tunerServerAccess,
                );
                streamCreator.setTuner([{ types: ['GR'] }]);
                const fullPath = join(root, 'task-9-4.ts');
                // RecorderModel intentionally does not await the video file size update before
                // finalizing (spec: .kiro/specs/server-recording-execution/design.md 完了を待たず),
                // so the test observes completion through this promise instead of racing the event.
                const sizeUpdates: Array<Promise<unknown>> = [];
                const recordingUtil = {
                    getRecPath: vi.fn(async () => ({
                        fileName: 'task-9-4.ts',
                        fullPath,
                        parendDir: { name: 'synthetic-root', path: root },
                        subDir: '',
                    })),
                    movingFromTmp: vi.fn(async () => fullPath),
                    updateVideoFileSize: vi.fn((videoFileId: number) => {
                        const update = (async () => {
                            await videoFileDB.updateSize(videoFileId, (await stat(fullPath)).size);
                        })();
                        sizeUpdates.push(update);
                        return update;
                    }),
                };
                const recordingEvent = {
                    emitCancelPrepRecording: vi.fn(),
                    emitEventRelay: vi.fn(),
                    emitFinishRecording: vi.fn(),
                    emitPrepRecordingFailed: vi.fn(),
                    emitRecordingFailed: vi.fn(),
                    emitStartPrepRecording: vi.fn(),
                    emitStartRecording: vi.fn(),
                };
                const recorder = new RecorderModel(
                    { getLogger: () => logger },
                    config,
                    programDB,
                    reserveDB,
                    recordedDB,
                    recordedHistoryDB,
                    videoFileDB,
                    dropLogFileDB,
                    streamCreator,
                    {
                        attach: vi.fn(),
                        getFilePath: vi.fn(() => join(root, 'task-9-4.drop.log')),
                        getResult: vi.fn(async () => ({ 100: { drop: 3, error: 2, scrambling: 1 } })),
                        prepare: vi.fn(async () => undefined),
                        stop: vi.fn(async () => undefined),
                    },
                    recordingUtil,
                    recordingEvent,
                    tunerServerAccess,
                );
                const session = makeRecordingSessionBinding(reserve, {
                    generation: 9401n,
                    phase: 'Preparing',
                    sessionToken: 9401n,
                });
                recorder.reserve = reserve;
                recorder.bindScheduleSession(session.binding);

                const reread = vi.spyOn(recordedDB, 'findId');
                const preparation = recorder.startPreparation();
                await vi.waitFor(() => expect(tunerServerAccess.openProgramStream).toHaveBeenCalledOnce());
                stream.write('task-9-4 first data');
                await preparation;
                await vi.waitFor(() => expect(recordingEvent.emitStartRecording).toHaveBeenCalledOnce());
                stream.end();
                await vi.waitFor(() => expect(recordingEvent.emitFinishRecording).toHaveBeenCalledOnce());
                // finalizeRecording defers starting the video file size update until the recFile
                // writer's own 'close' (it must not stat() a file that may still be unflushed), so
                // by the time emitFinishRecording fires the update may not have started yet -
                // `sizeUpdates` can still be empty here. Wait for the recorder's own normal-
                // completion signal instead, which only resolves once that deferred update (among
                // this finalization's other continuations) has actually settled.
                await recorder.whenNormalRecordingTerminal();
                await Promise.all(sizeUpdates);

                const rows = await recordedDB.findReserveId(reserve.id);
                expect(rows).toHaveLength(1);
                expect(rows[0]).toMatchObject({ isRecording: false, reserveId: reserve.id });
                const files = await videoFileDB.findAll();
                expect(files).toEqual([
                    expect.objectContaining({ filePath: 'task-9-4.ts', recordedId: rows[0].id, size: 19 }),
                ]);
                await expect(dropLogFileDB.findId(rows[0].dropLogFileId)).resolves.toMatchObject({
                    dropCnt: 3,
                    errorCnt: 2,
                    scramblingCnt: 1,
                });
                expect(await recordedHistoryDB.findAll()).toEqual([
                    expect.objectContaining({ channelId: 101, endAt: reserve.endAt }),
                ]);
                expect(reread).toHaveBeenCalledWith(rows[0].id);
                expect(recordingEvent.emitStartRecording).toHaveBeenCalledExactlyOnceWith(
                    reserve,
                    expect.objectContaining({ id: rows[0].id }),
                );
                expect(recordingEvent.emitFinishRecording).toHaveBeenCalledExactlyOnceWith(
                    reserve,
                    expect.objectContaining({ id: rows[0].id, isRecording: false }),
                    true,
                );
                expect(session.state.phase).toBe('Completed');
                expect(close).toHaveBeenCalledOnce();

                const interruptedRecordedId = await recordedDB.insertOnce(
                    makeDatabaseRecorded({ isRecording: true, reserveId: reserve.id }),
                );
                const interruptedVideoFileId = await videoFileDB.insertOnce(
                    Object.assign(new VideoFile(), {
                        filePath: 'interrupted.ts',
                        name: 'TS',
                        parentDirectoryName: 'synthetic-root',
                        recordedId: interruptedRecordedId,
                        type: 'ts',
                    }),
                );
                const startupEvent = {
                    emitFinishRecording: vi.fn(),
                    setCancelPrepRecording: vi.fn(),
                    setFinishRecording: vi.fn(),
                    setPrepRecordingFailed: vi.fn(),
                    setRecordingFailed: vi.fn(),
                };
                const manager = new RecordingManageModel(
                    { getLogger: () => logger },
                    config,
                    vi.fn(),
                    startupEvent,
                    { setTuner: vi.fn() },
                    recordedDB,
                    reserveDB,
                    {
                        movingFromTmp: vi.fn(),
                        updateVideoFileSize: vi.fn(async (videoFileId: number) =>
                            videoFileDB.updateSize(videoFileId, 23),
                        ),
                    },
                );
                await manager.cleanup();
                await expect(recordedDB.findId(interruptedRecordedId)).resolves.toMatchObject({ isRecording: false });
                await expect(videoFileDB.findId(interruptedVideoFileId)).resolves.toMatchObject({ size: 23 });
                expect(startupEvent.emitFinishRecording).toHaveBeenCalledExactlyOnceWith(
                    reserve,
                    expect.objectContaining({ id: interruptedRecordedId, isRecording: false }),
                    true,
                );
                queryRunners.assertReleased();
                queryRunners.restore();
            });
        },
        120_000,
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[INT-CASES-RE-9.4] contains none, partial, and rejected %s adapter operations without retaining rows or a database handle',
        async dialect => {
            await withDatabase(dialect, async (database, root) => {
                const operator = { getConnection: async () => database, getLikeStr: () => 'like' };
                const recordedDB = new RecordedDB(operator, retry);
                const videoFileDB = new VideoFileDB(operator, retry);
                const dropLogFileDB = new DropLogFileDB(operator, retry);
                const recordedHistoryDB = new RecordedHistoryDB(operator, retry);
                const rejection = new Error('Task 9.4 injected database rejection');
                const rejectRetry = { run: async (): Promise<never> => Promise.reject(rejection) };
                const rejectedRecordedDB = new RecordedDB(operator, rejectRetry);
                const rejectedVideoFileDB = new VideoFileDB(operator, rejectRetry);

                await expect(recordedDB.findId(9_499)).resolves.toBeNull();
                await expect(dropLogFileDB.findId(9_499)).resolves.toBeNull();
                await expect(recordedHistoryDB.findAll()).resolves.toEqual([]);

                const partialRecordedId = await recordedDB.insertOnce(makeDatabaseRecorded({ reserveId: 9_401 }));
                await expect(
                    rejectedVideoFileDB.insertOnce(
                        Object.assign(new VideoFile(), {
                            filePath: 'rejected-partial.ts',
                            name: 'TS',
                            parentDirectoryName: 'synthetic-root',
                            recordedId: partialRecordedId,
                            type: 'ts',
                        }),
                    ),
                ).rejects.toBe(rejection);
                await expect(videoFileDB.findAll()).resolves.toEqual([]);
                await expect(recordedDB.findId(partialRecordedId)).resolves.toMatchObject({
                    id: partialRecordedId,
                    isRecording: true,
                    videoFiles: [],
                });

                await expect(rejectedRecordedDB.findId(partialRecordedId)).rejects.toBe(rejection);
                await expect(
                    rejectedRecordedDB.updateOnce(makeDatabaseRecorded({ id: partialRecordedId })),
                ).rejects.toBe(rejection);
                await expect(rejectedRecordedDB.insertOnce(makeDatabaseRecorded())).rejects.toBe(rejection);
                await expect(recordedDB.findReserveId(9_401)).resolves.toEqual([
                    expect.objectContaining({ id: partialRecordedId }),
                ]);

                const dropLogFileId = await dropLogFileDB.insertOnce(
                    Object.assign(new DropLogFile(), {
                        dropCnt: 0,
                        errorCnt: 0,
                        filePath: join(root, 'partial.drop.log'),
                        scramblingCnt: 0,
                    }),
                );
                await expect(rejectedVideoFileDB.updateSize(9_499, 1)).rejects.toBe(rejection);
                await dropLogFileDB.updateCnt({ dropCnt: 3, errorCnt: 2, id: dropLogFileId, scramblingCnt: 1 });
                await expect(dropLogFileDB.findId(dropLogFileId)).resolves.toMatchObject({
                    dropCnt: 3,
                    errorCnt: 2,
                    scramblingCnt: 1,
                });
                const historyId = await recordedHistoryDB.insertOnce(
                    Object.assign(new RecordedHistory(), {
                        channelId: 101,
                        endAt: 1_700_000_060_000,
                        name: 'Task 9.4 partial history',
                    }),
                );
                await expect(recordedHistoryDB.findAll()).resolves.toEqual([
                    expect.objectContaining({ id: historyId }),
                ]);

                await recordedDB.deleteOnce(partialRecordedId);
                await expect(recordedDB.findId(partialRecordedId)).resolves.toBeNull();
                await expect(videoFileDB.findAll()).resolves.toEqual([]);
            });
        },
        120_000,
    );

    it.each(['cancel', 'replacement', 'deletion'] as const)(
        '[INT-CASES-RE-9.4] fences a 600-second overdue SQLite registration after %s and cleans its exact late rows once',
        async intent => {
            await withDatabase('sqlite', async (database, root) => {
                const operator = { getConnection: async () => database, getLikeStr: () => 'like' };
                const config = {
                    getConfig: () => ({
                        conflictPriority: 9,
                        isEnabledDropCheck: false,
                        needToReplaceEnclosingCharacters: false,
                        recPriority: 2,
                        recorded: [{ name: 'synthetic-root', path: root }],
                        recordedFileExtension: '.ts',
                        recordedFormat: 'task-9-4',
                        timeSpecifiedEndMargin: 0,
                        timeSpecifiedStartMargin: 0,
                    }),
                };
                const reserveDB = new ReserveDB(operator, retry);
                const programDB = new ProgramDB({ getLogger: () => logger }, config, operator, retry);
                const recordedDB = new RecordedDB(operator, retry);
                const videoFileDB = new VideoFileDB(operator, retry);
                const now = Date.now();
                const programId = 9_402;
                await programDB.insert({ 11: { 12: { channel: 'synthetic-channel', id: 101, type: 'GR' } } }, [
                    makeProgram(programId, now),
                ]);
                const reserve = makeReserve({
                    channelId: 101,
                    endAt: now + 60_000,
                    programId,
                    startAt: now,
                    updateTime: now,
                });
                reserve.id = await reserveDB.insertOnce(reserve);

                const stream = new PassThrough();
                const close = vi.fn();
                const tunerServerAccess = {
                    getProgram: vi.fn(),
                    openProgramStream: vi.fn(async () => ({ close, stream })),
                    openServiceStream: vi.fn(async () => ({ close, stream })),
                };
                const streamCreator = new RecordingStreamCreator(
                    { getLogger: () => logger },
                    config,
                    tunerServerAccess,
                );
                streamCreator.setTuner([{ types: ['GR'] }]);
                const fullPath = join(root, `task-9-4-${intent}.ts`);
                const recordingUtil = {
                    getRecPath: vi.fn(async () => ({
                        fileName: `task-9-4-${intent}.ts`,
                        fullPath,
                        parendDir: { name: 'synthetic-root', path: root },
                        subDir: '',
                    })),
                    movingFromTmp: vi.fn(async () => fullPath),
                    updateVideoFileSize: vi.fn(async () => undefined),
                };
                const recordingEvent = {
                    emitCancelPrepRecording: vi.fn(),
                    emitEventRelay: vi.fn(),
                    emitFinishRecording: vi.fn(),
                    emitPrepRecordingFailed: vi.fn(),
                    emitRecordingFailed: vi.fn(),
                    emitStartPrepRecording: vi.fn(),
                    emitStartRecording: vi.fn(),
                };
                const recorder = new RecorderModel(
                    { getLogger: () => logger },
                    config,
                    programDB,
                    reserveDB,
                    recordedDB,
                    { insertOnce: vi.fn() },
                    videoFileDB,
                    { insertOnce: vi.fn(), updateCnt: vi.fn() },
                    streamCreator,
                    { getFilePath: vi.fn(), getResult: vi.fn(), start: vi.fn(), stop: vi.fn(async () => undefined) },
                    recordingUtil,
                    recordingEvent,
                    tunerServerAccess,
                );
                const original = makeRecordingSessionBinding(reserve, {
                    generation: 9402n,
                    phase: 'Preparing',
                    sessionToken: 9402n,
                });
                const lateInsert = deferred<number>();
                const actualInsert = recordedDB.insertOnce.bind(recordedDB);
                const recordedInsert = vi.spyOn(recordedDB, 'insertOnce').mockImplementation(async recorded => {
                    const recordedId = await actualInsert(recorded);
                    return lateInsert.promise.then(() => recordedId);
                });
                const videoInsert = vi.spyOn(videoFileDB, 'insertOnce');
                recorder.reserve = reserve;
                recorder.bindScheduleSession(original.binding);

                vi.useFakeTimers();
                try {
                    const preparation = recorder.startPreparation();
                    await vi.waitFor(() => expect(tunerServerAccess.openProgramStream).toHaveBeenCalledOnce());
                    stream.write('task-9-4 delayed first data');
                    await vi.waitFor(() => expect(recordedInsert).toHaveBeenCalledOnce());
                    await vi.advanceTimersByTimeAsync(600_000);
                    expect(original.state.phase).toBe('RegistrationOverdue');

                    let completion: Promise<void> | undefined;
                    let replacement: ReturnType<typeof makeRecordingSessionBinding> | undefined;
                    if (intent === 'cancel') {
                        completion = recorder.cancel(false);
                    } else if (intent === 'replacement') {
                        original.state.current = false;
                        replacement = makeRecordingSessionBinding(reserve, {
                            generation: 9403n,
                            phase: 'Registering',
                            sessionToken: 9403n,
                        });
                        recorder.bindScheduleSession(replacement.binding);
                    } else {
                        completion = recorder.cancel(true);
                    }

                    lateInsert.resolve(1);
                    await preparation;
                    await completion;

                    expect(recordedInsert).toHaveBeenCalledOnce();
                    expect(videoInsert).toHaveBeenCalledTimes(intent === 'deletion' ? 0 : 1);
                    await expect(recordedDB.findReserveId(reserve.id)).resolves.toEqual([]);
                    await expect(videoFileDB.findAll()).resolves.toEqual([]);
                    await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
                    expect(stream.destroyed).toBe(true);
                    expect(stream.closed).toBe(true);
                    expect(close).toHaveBeenCalledOnce();
                    expect(recordingEvent.emitStartRecording).not.toHaveBeenCalled();
                    expect(recordingEvent.emitFinishRecording).not.toHaveBeenCalled();
                    if (replacement !== undefined) {
                        expect(replacement.state.phase).toBe('Registering');
                    } else {
                        expect(original.state.phase).toBe('Cancelled');
                    }
                } finally {
                    vi.useRealTimers();
                }
            });
        },
        120_000,
    );

    it('[Task 1.5] observes RecordingApiModel.gets return a real sqlite findAll round-trip', async () => {
        await withDatabase('sqlite', async source => {
            const now = Date.now();
            const reserve = makeReserve({ id: 951, updateTime: now, endAt: now + 60_000 });
            const recorded = makeRecorded({ id: 961, reserveId: 951, isRecording: true });
            await source.transaction(async manager => {
                await manager.insert(Reserve, reserve);
                await manager.insert(Recorded, recorded);
            });
            const operator = { getConnection: async () => source, getLikeStr: () => 'like' };
            const recordedDB = new RecordedDB(operator, retry);
            const converted = { id: 961, name: 'synthetic-converted-961' };
            const recordedItemUtil = {
                convertRecordedToRecordedItem: vi.fn((recordedRow: any, isHalfWidth: unknown) => {
                    expect(recordedRow.id).toBe(961);
                    expect(isHalfWidth).toBe(false);
                    return converted;
                }),
            };
            const api = new RecordingApiModel({ recording: { resetTimer: vi.fn() } }, recordedDB, recordedItemUtil);

            const result = await api.gets({ isHalfWidth: false } as any);

            expect(result).toEqual({ records: [converted], total: 1 });
            expect(recordedItemUtil.convertRecordedToRecordedItem).toHaveBeenCalledTimes(1);
        });
    });
});
