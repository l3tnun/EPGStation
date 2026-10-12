import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createRepositoryPersistence, loadCompiledDefault } from '../../persistence/repository-harness';
import { makeLogger, makeRecorded, makeReserve, ProcessUtil } from '../_harness';

const require = createRequire(join(process.cwd(), 'package.json'));
const realChildProcess = require('child_process') as { spawn: (...args: any[]) => any };
const realSpawn = realChildProcess.spawn;
const spawnStub = vi.fn((...args: any[]) => realSpawn(...args));
let ExternalCommandManageModelCtor: (new (...args: any[]) => any) | undefined;

beforeAll(async () => {
    const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
    if (snapshot === undefined || !isAbsolute(snapshot)) throw new Error('The compiled server snapshot is required');
    const modelPath = join(snapshot, 'model', 'operator', 'externalCommand', 'ExternalCommandManageModel.js');
    const childProcessMock = { spawn: spawnStub };
    vi.doMock('child_process', () => childProcessMock);
    vi.doMock('node:child_process', () => childProcessMock);
    try {
        vi.resetModules();
        const imported = (await import(modelPath)) as { default: new (...args: any[]) => any };
        ExternalCommandManageModelCtor = imported.default;
    } finally {
        vi.doUnmock('child_process');
        vi.doUnmock('node:child_process');
    }
});

const VideoUtil = loadCompiledDefault<any>('model/api/video/VideoUtil.js');

const fixture = join(process.cwd(), 'test/server/fixtures/event-and-hook-delivery/capture-command.cjs');
const parentMarker = 'SYNTHETIC_HOOK_PARENT_MARKER';
const fullChannel = {
    channelType: 'BS',
    halfWidthName: 'synthetic-half-channel',
    name: 'synthetic-channel',
};

interface Capture {
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
}

interface RunCaptureOptions {
    readonly channel?: Record<string, unknown> | null;
    readonly commandArguments?: readonly string[];
    readonly commandFixture?: string;
    readonly removeDirectory?: typeof rm;
    readonly observeTimers?: (timers: ReturnType<typeof trackHookTimers>) => void;
    readonly configKey: string;
    readonly info?: Record<string, unknown>;
    readonly invoke: (
        model: any,
        values: {
            readonly info: Record<string, unknown>;
            readonly recorded: Record<string, unknown>;
            readonly reserve: Record<string, unknown>;
        },
    ) => unknown;
    readonly recorded?: Record<string, unknown>;
    readonly reserve?: Record<string, unknown>;
    readonly videoUtil?: { getFullFilePathFromId(videoFileId: number): Promise<string | null> };
}

const fullReserve = () =>
    makeReserve({
        description: 'synthetic-description',
        endAt: 2_500,
        extended: 'synthetic-extended',
        halfWidthDescription: 'synthetic-half-description',
        halfWidthExtended: 'synthetic-half-extended',
        halfWidthName: 'synthetic-half-name',
        startAt: 1_000,
    });

const fullRecorded = () =>
    makeRecorded({
        description: 'synthetic-description',
        dropLogFile: {
            dropCnt: 3,
            errorCnt: 2,
            filePath: 'synthetic-drop.log',
            scramblingCnt: 4,
        },
        endAt: 2_500,
        extended: 'synthetic-extended',
        halfWidthDescription: 'synthetic-half-description',
        halfWidthExtended: 'synthetic-half-extended',
        halfWidthName: 'synthetic-half-name',
        startAt: 1_000,
        videoFiles: [{ id: 41 }],
    });

const fullInfo = () => ({ mode: 'synthetic-mode', recordedId: 31, videoFileId: 41 });

const trackHookTimers = () => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const timerObservations = new Map<
        ReturnType<typeof setTimeout>,
        { delay: unknown; active: boolean; cleared: boolean }
    >();
    const observations: Array<{ delay: unknown; active: boolean; cleared: boolean }> = [];
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    global.setTimeout = ((callback: (...args: any[]) => void, ...args: any[]) => {
        let timer!: ReturnType<typeof setTimeout>;
        const observation = { delay: args[0], active: true, cleared: false };
        observations.push(observation);
        timer = originalSetTimeout(
            (...callbackArgs: any[]) => {
                timers.delete(timer);
                observation.active = false;
                callback(...callbackArgs);
            },
            ...args,
        );
        timers.add(timer);
        timerObservations.set(timer, observation);
        return timer;
    }) as typeof setTimeout;
    global.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
        timers.delete(timer);
        const observation = timerObservations.get(timer);
        if (observation !== undefined) {
            observation.active = false;
            observation.cleared = true;
        }
        return originalClearTimeout(timer);
    }) as typeof clearTimeout;
    return {
        observations,
        assertReleased: () => expect(timers.size).toBe(0),
        restore: () => {
            global.setTimeout = originalSetTimeout;
            global.clearTimeout = originalClearTimeout;
        },
    };
};

const runCapture = async ({
    channel = fullChannel,
    commandArguments = [],
    commandFixture = fixture,
    removeDirectory = rm,
    observeTimers,
    configKey,
    info = fullInfo(),
    invoke,
    recorded = fullRecorded(),
    reserve = fullReserve(),
    videoUtil: providedVideoUtil,
}: RunCaptureOptions) => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-hook-command-'));
    const output = join(temporaryRoot, 'capture.json');
    const previousMarker = process.env[parentMarker];
    process.env[parentMarker] = 'parent-only-value';
    let deadline: NodeJS.Timeout | undefined;
    const hookTimers = trackHookTimers();
    const originalSpawn = spawnStub.getMockImplementation()!;
    const children: Array<{ child: any; closed: boolean }> = [];
    spawnStub.mockImplementation((...args: any[]) => {
        const child = originalSpawn(...args);
        const state = { child, closed: false };
        children.push(state);
        observeTimers?.(hookTimers);
        child.once('close', () => {
            state.closed = true;
        });
        return child;
    });
    const jobs: Array<{ settled: boolean }> = [];
    let observationError: unknown;
    try {
        const command = ['%NODE%', commandFixture, output, ...commandArguments].join(' ');
        const logger = makeLogger();
        const pendingJobs: Promise<unknown>[] = [];
        const queue = {
            add: vi.fn((job: () => Promise<unknown>) => {
                const result = job();
                pendingJobs.push(result);
                const state = { settled: false };
                jobs.push(state);
                void result.then(
                    () => {
                        state.settled = true;
                    },
                    () => {
                        state.settled = true;
                    },
                );
                return result;
            }),
        };
        const channelDB = { findId: vi.fn(async () => channel) };
        const recordedDB = { findId: vi.fn(async () => recorded) };
        const videoUtil = providedVideoUtil ?? {
            getFullFilePathFromId: vi.fn(async (videoFileId: number) => `synthetic-video-${videoFileId}`),
        };
        if (ExternalCommandManageModelCtor === undefined) throw new Error('ExternalCommandManageModelCtor not ready');
        const model = new ExternalCommandManageModelCtor(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    [configKey]: command,
                    dropLog: 'synthetic-drop-root',
                    hookCommandMaxPending: 64,
                    hookCommandTimeoutMs: 300_000,
                }),
            },
            queue,
            channelDB,
            recordedDB,
            videoUtil,
        );
        const result = invoke(model, { info, recorded, reserve });
        const timeout = new Promise<never>((_resolve, reject) => {
            deadline = setTimeout(() => reject(new Error('synthetic hook command timeout')), 2_000);
        });
        await Promise.race([Promise.all(pendingJobs), timeout]);
        const capture = JSON.parse(await readFile(output, 'utf8')) as Capture;
        return { capture, channelDB, logger, queue, recordedDB, result, videoUtil };
    } catch (error) {
        observationError = error;
        throw error;
    } finally {
        if (deadline !== undefined) clearTimeout(deadline);
        try {
            await vi.waitFor(
                () => {
                    for (const { child, closed } of children) {
                        if (!closed && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
                    }
                    expect(children.every(state => state.closed)).toBe(true);
                    expect(jobs.every(job => job.settled)).toBe(true);
                },
                { timeout: 5_000 },
            );
            for (const { child } of children) {
                if (child.pid !== undefined) expect(() => process.kill(child.pid, 0)).toThrow(/ESRCH/u);
                expect(child.listenerCount('exit')).toBe(0);
                expect(child.listenerCount('error')).toBe(0);
            }
            hookTimers.assertReleased();
            await removeDirectory(temporaryRoot, { force: true, recursive: true });
        } catch (cleanupError) {
            if (observationError !== undefined) {
                throw new AggregateError([observationError, cleanupError], 'capture observation and cleanup failed', {
                    cause: observationError,
                });
            }
            throw cleanupError;
        } finally {
            spawnStub.mockImplementation(originalSpawn);
            hookTimers.restore();
            if (previousMarker === undefined) delete process.env[parentMarker];
            else process.env[parentMarker] = previousMarker;
        }
    }
};

// Node forwards the OUTER process's own `NODE_V8_COVERAGE` to every spawned child regardless of an
// explicit `env` option, so under `test:server:coverage` the fixture-captured env of
// `ExternalCommandManageModel`'s fixed-allowlist spawn always carries this one extra key even though
// the allowlist literal itself never names it.
const coverageEnvironmentEntries = (): Record<string, string> =>
    process.env.NODE_V8_COVERAGE === undefined ? {} : { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE };

const reserveEnvironment = (): Record<string, string> => ({
    CHANNELID: '21',
    CHANNELNAME: 'synthetic-channel',
    CHANNELTYPE: 'GR',
    DESCRIPTION: 'synthetic-description',
    DURATION: '1500',
    ENDAT: '2500',
    EXTENDED: 'synthetic-extended',
    HALF_WIDTH_CHANNELNAME: 'synthetic-half-channel',
    HALF_WIDTH_DESCRIPTION: 'synthetic-half-description',
    HALF_WIDTH_EXTENDED: 'synthetic-half-extended',
    HALF_WIDTH_NAME: 'synthetic-half-name',
    NAME: 'synthetic-program',
    PATH: process.env.PATH as string,
    PROGRAMID: '101',
    RESERVEID: '11',
    STARTAT: '1000',
    ...coverageEnvironmentEntries(),
});

const recordedEnvironment = (): Record<string, string> => ({
    CHANNELID: '21',
    CHANNELNAME: 'synthetic-channel',
    CHANNELTYPE: 'BS',
    DESCRIPTION: 'synthetic-description',
    DROP_CNT: '3',
    DURATION: '1500',
    ENDAT: '2500',
    ERROR_CNT: '2',
    EXTENDED: 'synthetic-extended',
    HALF_WIDTH_CHANNELNAME: 'synthetic-half-channel',
    HALF_WIDTH_DESCRIPTION: 'synthetic-half-description',
    HALF_WIDTH_EXTENDED: 'synthetic-half-extended',
    HALF_WIDTH_NAME: 'synthetic-half-name',
    LOGPATH: join('synthetic-drop-root', 'synthetic-drop.log'),
    NAME: 'synthetic-program',
    PATH: process.env.PATH as string,
    PROGRAMID: '101',
    RECORDEDID: '31',
    RECPATH: 'synthetic-video-41',
    SCRAMBLING_CNT: '4',
    STARTAT: '1000',
    ...coverageEnvironmentEntries(),
});

const encodingEnvironment = (): Record<string, string> => ({
    CHANNELID: '21',
    CHANNELNAME: 'synthetic-channel',
    DESCRIPTION: 'synthetic-description',
    EXTENDED: 'synthetic-extended',
    HALF_WIDTH_CHANNELNAME: 'synthetic-half-channel',
    HALF_WIDTH_DESCRIPTION: 'synthetic-half-description',
    HALF_WIDTH_EXTENDED: 'synthetic-half-extended',
    HALF_WIDTH_NAME: 'synthetic-half-name',
    MODE: 'synthetic-mode',
    NAME: 'synthetic-program',
    OUTPUTPATH: 'synthetic-video-41',
    PATH: process.env.PATH as string,
    RECORDEDID: '31',
    VIDEOFILEID: '41',
    ...coverageEnvironmentEntries(),
});

const familyCases = [
    [
        'reservation added',
        'reserveNewAddtionCommand',
        'reserve',
        (model: any, { reserve }: any) => model.addUpdateReseves({ insert: [reserve], isSuppressLog: false }),
    ],
    [
        'reservation updated',
        'reserveUpdateCommand',
        'reserve',
        (model: any, { reserve }: any) => model.addUpdateReseves({ update: [reserve], isSuppressLog: false }),
    ],
    [
        'reservation deleted',
        'reservedeletedCommand',
        'reserve',
        (model: any, { reserve }: any) => model.addUpdateReseves({ delete: [reserve], isSuppressLog: false }),
    ],
    [
        'recording preparation started',
        'recordingPreStartCommand',
        'reserve',
        (model: any, { reserve }: any) => model.addRecordingPrepStartCmd(reserve),
    ],
    [
        'recording preparation cancelled or failed',
        'recordingPrepRecFailedCommand',
        'reserve',
        (model: any, { reserve }: any) => model.addRecordingPrepRecFailedCmd(reserve),
    ],
    [
        'recording started',
        'recordingStartCommand',
        'recorded',
        (model: any, { recorded }: any) => model.addRecordingStartCmd(recorded),
    ],
    [
        'recording failed',
        'recordingFailedCommand',
        'recorded',
        (model: any, { recorded }: any) => model.addRecordingFailedCmd(recorded),
    ],
    [
        'recording finished',
        'recordingFinishCommand',
        'recorded',
        (model: any, { recorded }: any) => model.addRecordingFinishCmd(recorded),
    ],
    [
        'encoding finished',
        'encodingFinishCommand',
        'encoding',
        (model: any, { info }: any) => model.addEncodingFinishCmd(info),
    ],
] as const;

describe('external command process boundary', () => {
    it('[supporting cleanup integration] reclaims a running capture child when observation times out', async () => {
        const fixtureRoot = await mkdtemp(join(tmpdir(), 'epgstation-hook-capture-timeout-'));
        const script = join(fixtureRoot, 'capture-and-wait.cjs');
        const pidFile = join(fixtureRoot, 'child.pid');
        let pid: number | undefined;
        let productTimers: ReturnType<typeof trackHookTimers> | undefined;
        let activeProductDeadlines = 0;
        try {
            await writeFile(
                script,
                [
                    "const fs = require('node:fs');",
                    'fs.writeFileSync(process.argv[2], JSON.stringify({ args: [], env: process.env }));',
                    'fs.writeFileSync(process.argv[3], String(process.pid));',
                    'setInterval(() => undefined, 1_000);',
                ].join('\n'),
            );
            await expect(
                runCapture({
                    commandArguments: [pidFile],
                    commandFixture: script,
                    observeTimers: timers => {
                        productTimers = timers;
                        activeProductDeadlines = timers.observations.filter(
                            timer => timer.delay === 300_000 && timer.active,
                        ).length;
                    },
                    configKey: 'recordingPreStartCommand',
                    invoke: (model, { reserve }) => model.addRecordingPrepStartCmd(reserve),
                }),
            ).rejects.toThrow('synthetic hook command timeout');
            pid = Number(await readFile(pidFile, 'utf8'));
            expect(Number.isSafeInteger(pid)).toBe(true);
            expect(activeProductDeadlines).toBe(1);
            expect(productTimers?.observations.filter(timer => timer.delay === 300_000)).toEqual([
                expect.objectContaining({ active: false, cleared: true }),
            ]);
            expect(() => process.kill(pid!, 0)).toThrow(/ESRCH/u);
        } finally {
            if (pid === undefined) {
                const value = await readFile(pidFile, 'utf8').catch(() => '');
                if (value !== '') pid = Number(value);
            }
            if (pid !== undefined && Number.isSafeInteger(pid) && pid > 0) {
                try {
                    process.kill(pid, 'SIGKILL');
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
                }
                await vi.waitFor(() => expect(() => process.kill(pid!, 0)).toThrow(/ESRCH/u), { timeout: 2_000 });
            }
            await rm(fixtureRoot, { force: true, recursive: true });
        }
    }, 10_000);

    it('[supporting cleanup integration] preserves capture observation and directory removal errors together', async () => {
        const observationError = new Error('synthetic capture observation error');
        const removalError = new Error('synthetic capture directory removal error');
        let directory: string | undefined;
        try {
            const result = await runCapture({
                configKey: 'recordingPreStartCommand',
                invoke: () => {
                    throw observationError;
                },
                removeDirectory: async path => {
                    directory = String(path);
                    throw removalError;
                },
            }).catch(error => error);
            expect(result).toBeInstanceOf(AggregateError);
            expect(result.cause).toBe(observationError);
            expect(result.errors).toEqual([observationError, removalError]);
        } finally {
            if (directory !== undefined) await rm(directory, { force: true, recursive: true });
        }
    }, 10_000);

    it('[supporting environment integration] launches without a shell and passes only PATH plus the event allowlist', async () => {
        const result = await runCapture({
            commandArguments: [
                '%ROOT%',
                '"synthetic%SPACE%quoted"',
                '$SYNTHETIC_HOOK_PARENT_MARKER',
                '|',
                '>',
                'synthetic%SPACE%space',
            ],
            configKey: 'recordingPreStartCommand',
            invoke: (model, { reserve }) => model.addRecordingPrepStartCmd(reserve),
        });

        expect(result.capture.args).toEqual([
            ProcessUtil.ROOT_PATH,
            '"synthetic quoted"',
            '$SYNTHETIC_HOOK_PARENT_MARKER',
            '|',
            '>',
            'synthetic space',
        ]);
        expect(result.capture.env).toEqual(reserveEnvironment());
        expect(result.capture.env).not.toHaveProperty(parentMarker);
        expect(result.queue.add).toHaveBeenCalledOnce();
        expect(result.logger.system.error).not.toHaveBeenCalled();
    });

    it.each(familyCases)(
        '[supporting environment integration] passes the exact environment for %s',
        async (_label, configKey, profile, invoke) => {
            const result = await runCapture({ configKey, invoke });
            const expected =
                profile === 'reserve'
                    ? reserveEnvironment()
                    : profile === 'recorded'
                      ? recordedEnvironment()
                      : encodingEnvironment();

            expect(result.result).toBeUndefined();
            expect(result.capture.args).toEqual([]);
            expect(result.capture.env).toEqual(expected);
            expect(result.capture.env).not.toHaveProperty(parentMarker);
            expect(result.queue.add).toHaveBeenCalledOnce();
            expect(result.logger.system.error).not.toHaveBeenCalled();
        },
    );

    it('[supporting environment integration] preserves profile-specific null, empty, and unset representations', async () => {
        const nullableReserve = await runCapture({
            channel: null,
            configKey: 'recordingPreStartCommand',
            invoke: (model, { reserve }) => model.addRecordingPrepStartCmd(reserve),
            reserve: Object.assign(fullReserve(), {
                description: null,
                extended: undefined,
                halfWidthDescription: '',
                halfWidthExtended: null,
            }),
        });
        const expectedReserve: Record<string, string> = {
            ...reserveEnvironment(),
            CHANNELNAME: 'null',
            DESCRIPTION: 'null',
            HALF_WIDTH_CHANNELNAME: 'null',
            HALF_WIDTH_DESCRIPTION: '',
            HALF_WIDTH_EXTENDED: 'null',
        };
        delete expectedReserve.EXTENDED;

        const nullableRecordedEntity = Object.assign(fullRecorded(), {
            description: null,
            dropLogFile: null,
            extended: undefined,
            halfWidthDescription: '',
            halfWidthExtended: null,
            videoFiles: undefined,
        });
        const nullableRecorded = await runCapture({
            channel: null,
            configKey: 'recordingStartCommand',
            invoke: (model, { recorded }) => model.addRecordingStartCmd(recorded),
            recorded: nullableRecordedEntity,
        });
        const expectedRecorded: Record<string, string> = {
            ...recordedEnvironment(),
            CHANNELNAME: 'null',
            CHANNELTYPE: 'null',
            DESCRIPTION: 'null',
            DROP_CNT: 'null',
            ERROR_CNT: 'null',
            HALF_WIDTH_CHANNELNAME: 'null',
            HALF_WIDTH_DESCRIPTION: '',
            HALF_WIDTH_EXTENDED: 'null',
            LOGPATH: 'null',
            RECPATH: 'null',
            SCRAMBLING_CNT: 'null',
        };
        delete expectedRecorded.EXTENDED;

        const nullableEncodingEntity = Object.assign(fullRecorded(), {
            channelId: undefined,
            description: undefined,
            extended: null,
            halfWidthDescription: '',
            halfWidthExtended: undefined,
        });
        const nullableEncoding = await runCapture({
            channel: { halfWidthName: undefined, name: undefined },
            configKey: 'encodingFinishCommand',
            info: { mode: 'synthetic-mode', recordedId: 31, videoFileId: null },
            invoke: (model, { info }) => model.addEncodingFinishCmd(info),
            recorded: nullableEncodingEntity,
        });
        const expectedEncoding: Record<string, string> = {
            ...encodingEnvironment(),
            CHANNELID: '',
            CHANNELNAME: '',
            DESCRIPTION: '',
            EXTENDED: '',
            HALF_WIDTH_CHANNELNAME: '',
            HALF_WIDTH_DESCRIPTION: '',
            HALF_WIDTH_EXTENDED: '',
            OUTPUTPATH: 'null',
            VIDEOFILEID: '',
        };

        expect(nullableReserve.capture.env).toEqual(expectedReserve);
        expect(nullableRecorded.capture.env).toEqual(expectedRecorded);
        expect(nullableEncoding.capture.env).toEqual(expectedEncoding);
        for (const result of [nullableReserve, nullableRecorded, nullableEncoding]) {
            expect(result.capture.env).not.toHaveProperty(parentMarker);
            expect(result.queue.add).toHaveBeenCalledOnce();
            expect(result.logger.system.error).not.toHaveBeenCalled();
        }
    });
});

// hook の test の予約・録画済みは Reserve・Recorded の instance（書き換えられる、prototype あり）。録画の経路が hook に
// 渡すのは、DB から読んだ値を凍結した写し（prototype なし）。同じ hook を写しで動かし、子 process が受ける引数と
// 環境変数が instance のときと同じになることを確かめる。保存先からの path の解決は本物の VideoUtil でも確かめる。
describe('hook payload doubles against the frozen copies the recording path passes', () => {
    it.each(familyCases)(
        '[supporting environment integration] gives the %s command the same environment from a frozen copy as from the entity instance',
        async (_label, configKey, _profile, invoke) => {
            const fromInstance = await runCapture({ configKey, invoke });
            const reserveCopy = Object.freeze({ ...fullReserve() });
            const recordedCopy = Object.freeze({ ...fullRecorded() });
            const fromCopy = await runCapture({ configKey, invoke, recorded: recordedCopy, reserve: reserveCopy });

            expect(reserveCopy).not.toBeInstanceOf(fullReserve().constructor);
            expect(fromCopy.capture).toEqual(fromInstance.capture);
            expect(fromCopy.logger.system.error).not.toHaveBeenCalled();
        },
    );

    it('[supporting environment integration] resolves the recorded file path with the real VideoUtil and a real video file row', async () => {
        const storageRoot = await mkdtemp(join(tmpdir(), 'epgstation-hook-storage-'));
        const persistence = await createRepositoryPersistence('sqlite');
        try {
            const recordedId = Number(
                await persistence.db.RecordedDB.insertOnce({
                    reserveId: null,
                    ruleId: null,
                    programId: null,
                    channelId: 21,
                    isProtected: false,
                    startAt: 1_000,
                    endAt: 2_500,
                    duration: 1_500,
                    name: 'synthetic-program',
                    halfWidthName: 'synthetic-half-name',
                    isRecording: false,
                    dropLogFileId: null,
                }),
            );
            const videoFileId = Number(
                await persistence.db.VideoFileDB.insertOnce({
                    recordedId,
                    parentDirectoryName: 'synthetic-storage',
                    filePath: join('synthetic-sub', 'synthetic-recorded.ts'),
                    type: 'ts',
                    name: 'TS',
                    size: 0,
                }),
            );
            const videoUtil = new VideoUtil(
                { getConfig: () => ({ recorded: [{ name: 'synthetic-storage', path: storageRoot }] }) },
                persistence.db.VideoFileDB,
            );
            const result = await runCapture({
                configKey: 'recordingFinishCommand',
                invoke: (model, { recorded }) => model.addRecordingFinishCmd(recorded),
                recorded: { ...fullRecorded(), videoFiles: [{ id: videoFileId }] },
                videoUtil,
            });

            expect(result.capture.env.RECPATH).toBe(join(storageRoot, 'synthetic-sub', 'synthetic-recorded.ts'));
            expect(result.capture.env).toEqual({
                ...recordedEnvironment(),
                RECPATH: join(storageRoot, 'synthetic-sub', 'synthetic-recorded.ts'),
            });
        } finally {
            await persistence.cleanup();
            await rm(storageRoot, { force: true, recursive: true });
        }
    });
});
