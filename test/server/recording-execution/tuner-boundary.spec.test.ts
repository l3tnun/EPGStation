import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    deferred,
    flushImmediate,
    logger,
    makeRecorded,
    makeRecorder,
    makeRecordingSessionBinding,
    makeReserve,
    makeScheduleHarness,
    makeStreamCreator,
    RecordingEvent,
    RecordingManageModel,
} from './_harness';

const makeLifecycleManager = (recordingEvent: any, overrides: Record<string, any> = {}) => {
    const recorder = {
        bindScheduleSession: vi.fn(),
        cancel: vi.fn(async () => undefined),
        resetTimer: vi.fn(() => true),
        setTimer: vi.fn(() => true),
        startPreparation: vi.fn(),
        update: vi.fn(async () => undefined),
        ...overrides.recorder,
    };
    const provider = vi.fn(async () => recorder);
    const recordedDB = {
        findAll: vi.fn(async () => [[], 0]),
        findId: vi.fn(async () => null),
        findReserveId: vi.fn(async () => []),
        removeRecording: vi.fn(async () => undefined),
        ...overrides.recordedDB,
    };
    const reserveDB = { findId: vi.fn(async () => null), ...overrides.reserveDB };
    const manager = new RecordingManageModel(
        { getLogger: () => logger },
        { getConfig: () => ({ recordedTmp: '/synthetic-tmp' }) },
        provider,
        recordingEvent,
        { setTuner: vi.fn() },
        recordedDB,
        reserveDB,
        {
            movingFromTmp: vi.fn(async () => '/synthetic-root/synthetic.ts'),
            updateVideoFileSize: vi.fn(async () => undefined),
        },
    );
    manager.candidateStartupState = 'Started';
    return { manager, provider, recordedDB, recorder, reserveDB };
};

const createLifecycleLedger = () => {
    const event = new RecordingEvent({ getLogger: () => logger });
    const ledger: unknown[][] = [];
    event.setStartPrepRecording((reserve: unknown) => ledger.push(['prepare-start', reserve]));
    event.setCancelPrepRecording((reserve: unknown) => ledger.push(['prepare-cancel', reserve]));
    event.setPrepRecordingFailed((reserve: unknown) => ledger.push(['prepare-failed', reserve]));
    event.setStartRecording((reserve: unknown, recorded: unknown) =>
        ledger.push(['recording-start', reserve, recorded]),
    );
    event.setRecordingFailed((reserve: unknown, recorded: unknown, failure: unknown) =>
        ledger.push(['recording-failed', reserve, recorded, failure]),
    );
    event.setRecordingRetryOver((reserve: unknown) => ledger.push(['retry-over', reserve]));
    event.setFinishRecording((reserve: unknown, recorded: unknown, needsReservationRemoval: unknown) =>
        ledger.push(['recording-finish', reserve, recorded, needsReservationRemoval]),
    );
    event.setEventRelay((programs: unknown) => ledger.push(['relay', programs]));
    return { event, ledger };
};

afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('recording execution module boundary', () => {
    const recordingSourceDirectory = join(process.cwd(), 'src', 'model', 'operator', 'recording');
    const collectImportSpecifiers = (source: string): string[] => {
        const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        const patterns = [
            /\bimport\s+(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g,
            /\bexport\s+[^'";]*?\sfrom\s+['"]([^'"]+)['"]/g,
            /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
            /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        ];
        return patterns.flatMap(pattern => [...withoutComments.matchAll(pattern)].map(match => match[1]));
    };

    it('[RE-8.1] recording execution sources import only the common tuner types and no product-specific client', async () => {
        const files = (await readdir(recordingSourceDirectory)).filter(name => name.endsWith('.ts')).sort();
        expect(files).toHaveLength(13);

        const specifiers: { file: string; specifier: string }[] = [];
        for (const file of files) {
            const source = await readFile(join(recordingSourceDirectory, file), 'utf8');
            for (const specifier of collectImportSpecifiers(source)) {
                specifiers.push({ file, specifier });
            }
        }
        expect(specifiers.length).toBeGreaterThan(0);

        expect(specifiers.filter(({ specifier }) => /mirakurun|mirakc/i.test(specifier))).toEqual([]);
        expect([
            ...new Set(
                specifiers
                    .filter(({ specifier }) => /(^|\/)tuner(\/|$)/.test(specifier))
                    .map(({ specifier }) => specifier),
            ),
        ]).toEqual(['../../tuner/types.js']);
    });

    it('[RE-8.1] the import collector reads multi-line, re-export, dynamic and require specifiers and skips comments', () => {
        const source = [
            'import {',
            '    A,',
            "} from '../../tuner/types.js';",
            "import 'side-effect';",
            "export { B } from './b.js';",
            "const c = await import('./c.js');",
            "const d = require('d');",
            "// import { E } from 'mirakurun';",
            "/* import { F } from 'mirakc'; */",
        ].join('\n');
        expect(collectImportSpecifiers(source)).toEqual([
            '../../tuner/types.js',
            'side-effect',
            './b.js',
            './c.js',
            'd',
        ]);
    });
});

describe('recording lifecycle publisher boundary', () => {
    it.each(['end', 'close', 'error'] as const)(
        '[Task 8.2][RE-8.1][RE-8.2] closes a shared tuner handle exactly once after %s and duplicate terminals',
        async terminal => {
            const stream = new PassThrough();
            const close = vi.fn();
            const harness = makeStreamCreator({
                tunerServerAccess: { openProgramStream: vi.fn(async () => ({ close, stream })) },
            });

            await expect(harness.model.create(makeReserve({ id: 90, isConflict: true }))).resolves.toBe(stream);
            if (terminal === 'end') {
                const ended = once(stream, 'end');
                stream.resume();
                stream.end();
                await ended;
            } else if (terminal === 'close') {
                stream.emit('close');
            } else {
                stream.destroy(new Error('synthetic shared tuner terminal failure'));
            }
            await flushImmediate();

            expect(close).toHaveBeenCalledOnce();
            stream.emit('close');
            stream.emit('end');
            await flushImmediate();
            expect(close).toHaveBeenCalledOnce();
        },
    );

    it('[Task 8.2][RE-8.2] preserves the common tuner open failure', async () => {
        const failure = new Error('synthetic shared tuner open failure');
        const rejected = makeStreamCreator({
            tunerServerAccess: { openProgramStream: vi.fn(async () => Promise.reject(failure)) },
        });
        await expect(rejected.model.create(makeReserve({ id: 91, isConflict: true }))).rejects.toBe(failure);
    });

    it('[Task 8.2] treats an actual writer error before first data as one start failure without a later timeout', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-writer-before-data-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const reserve = makeReserve({ id: 91, startAt: 1_060_000, endAt: 1_120_000 });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        const harness = makeRecorder({
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'synthetic.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn().mockResolvedValue(undefined),
            },
            reserveDB: { findId: vi.fn(async () => reserve) },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);

        try {
            const preparation = harness.model.startPreparation();
            await vi.waitFor(() => expect(harness.model.recFile).not.toBeNull());
            const writer = harness.model.recFile;
            const writerEnd = vi.spyOn(writer, 'end');
            const writerClosed = vi.fn();
            writer.on('close', writerClosed);
            const streamDestroy = vi.spyOn(stream, 'destroy');

            expect(session.state.phase).toBe('AwaitingFirstData');
            writer.emit('error', new Error('synthetic writer failure before first data'));
            await preparation;
            await vi.waitFor(() => expect(writerClosed).toHaveBeenCalledOnce());

            expect(session.state.phase).toBe('RetryWaiting');
            expect(vi.getTimerCount()).toBe(1);
            expect(writerEnd).toHaveBeenCalledOnce();
            expect(streamDestroy).toHaveBeenCalledOnce();
            expect(stream.destroyed).toBe(true);
            expect(writer.closed).toBe(true);
            expect(harness.recordedDB.insertOnce).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitRecordingFailed).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });

            await harness.model.cancel(false);
            expect(session.state.phase).toBe('Cancelled');
            expect(vi.getTimerCount()).toBe(0);
            await vi.advanceTimersByTimeAsync(5_000);
            expect(harness.streamCreator.create).toHaveBeenCalledOnce();
            expect(streamDestroy).toHaveBeenCalledOnce();
            expect(writerEnd).toHaveBeenCalledOnce();
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitRecordingFailed).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
            expect(logger.system.error).not.toHaveBeenCalledWith(`recording failed: ${reserve.id}`);
        } finally {
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            vi.useRealTimers();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 8.2] maps an actual writer error after first data through failure notification and one retry', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-writer-after-data-'));
        const fullPath = join(root, 'synthetic.ts');
        const reserve = makeReserve({ id: 92, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000 });
        const stream = new PassThrough();
        const event = new RecordingEvent({ getLogger: () => logger });
        const startNotifications = vi.fn();
        const failureNotifications = vi.fn();
        event.setStartRecording(startNotifications);
        event.setRecordingFailed(failureNotifications);
        const recorder = makeRecorder({
            recordingEvent: event,
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'synthetic.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn().mockResolvedValue(undefined),
            },
            reserveDB: { findId: vi.fn(async () => reserve) },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
        });
        const replacement = {
            bindScheduleSession: vi.fn(),
            cancel: vi.fn(async () => undefined),
            resetTimer: vi.fn(() => true),
            setTimer: vi.fn(() => true),
            startPreparation: vi.fn(),
            update: vi.fn(async () => undefined),
        };
        const provider = vi.fn().mockResolvedValueOnce(recorder.model).mockResolvedValueOnce(replacement);
        const manager = new RecordingManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ recordedTmp: undefined, timeSpecifiedEndMargin: 0 }) },
            provider,
            event,
            { setTuner: vi.fn() },
            {
                findAll: vi.fn(async () => [[], 0]),
                findId: vi.fn(async () => makeRecorded({ reserveId: reserve.id, isRecording: false })),
                findReserveId: vi.fn(async () => []),
                removeRecording: vi.fn(async () => undefined),
            },
            { findId: vi.fn(async () => reserve) },
            { movingFromTmp: vi.fn(), updateVideoFileSize: vi.fn().mockResolvedValue(undefined) },
        );
        manager.candidateStartupState = 'Started';

        try {
            await manager.update({ insert: [reserve], isSuppressLog: false });
            const waiting = manager.scheduleController.getSessionSnapshot(reserve.id);
            expect(
                manager.scheduleController.tryTransitionSession(
                    reserve.id,
                    waiting.generation,
                    waiting.sessionToken,
                    'Waiting',
                    'Preparing',
                ),
            ).toBe(true);
            const recording = manager.scheduleController.getSessionSnapshot(reserve.id);
            manager.bindRecorder(recorder.model, recording);
            const started = recorder.model.startPreparation();
            await vi.waitFor(() => expect(recorder.model.recFile).not.toBeNull());
            const writer = recorder.model.recFile;
            const writerEnd = vi.spyOn(writer, 'end');
            const writerClosed = vi.fn();
            writer.on('close', writerClosed);
            const streamDestroy = vi.spyOn(stream, 'destroy');
            stream.write('synthetic first data');
            await started;
            await vi.waitFor(() => expect(startNotifications).toHaveBeenCalledOnce());
            expect(manager.scheduleController.getSessionSnapshot(reserve.id)).toMatchObject({ phase: 'Recording' });

            const failure = new Error('synthetic writer failure after first data');
            writer.emit('error', failure);
            await vi.waitFor(() => expect(failureNotifications).toHaveBeenCalledOnce());
            await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2));
            await vi.waitFor(() => expect(writerClosed).toHaveBeenCalledOnce());

            expect(writer.end).toHaveBeenCalledOnce();
            expect(writer.closed).toBe(true);
            expect(streamDestroy).toHaveBeenCalledOnce();
            expect(stream.destroyed).toBe(true);
            expect(recorder.recordedDB.removeRecording).toHaveBeenCalledExactlyOnceWith(21);
            await expect(readFile(fullPath, 'utf8')).resolves.toBe('synthetic first data');
            expect(failureNotifications).toHaveBeenCalledWith(
                expect.objectContaining({ id: reserve.id }),
                expect.objectContaining({ id: 21 }),
                expect.objectContaining({ reservationId: reserve.id }),
            );
            expect(manager.recordingIndex[reserve.id]).toBe(replacement);
            expect(manager.scheduleController.getSessionSnapshot(reserve.id)).toMatchObject({ phase: 'Waiting' });
        } finally {
            recorder.model.isCanceledCallingFinished = true;
            recorder.model.destroyStream();
            manager.scheduleController.stop();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 8.2] replaces an old time-specified end and dispatches the new exact deadline once', async () => {
        const reserve = makeReserve({
            id: 92,
            isTimeSpecified: true,
            programId: null,
            startAt: 900_000,
            endAt: 1_006_000,
        });
        const harness = makeScheduleHarness({ now: 1_000_000, reservations: [reserve] });
        const waiting = harness.controller.getSessionSnapshot(reserve.id);
        expect(
            harness.controller.tryTransitionSession(
                reserve.id,
                waiting.generation,
                waiting.sessionToken,
                'Waiting',
                'Recording',
            ),
        ).toBe(true);
        const recording = harness.controller.getSessionSnapshot(reserve.id);
        harness.controller.registerTimeSpecifiedEnd({ ...recording, dueAt: 1_005_000 });
        harness.controller.registerTimeSpecifiedEnd({ ...recording, dueAt: reserve.endAt });

        await harness.controller.start();
        harness.now.value = 1_005_000;
        harness.fakeScheduler.fire();
        expect(harness.dispatchTimeSpecifiedEnd).not.toHaveBeenCalled();

        harness.now.value = reserve.endAt - 1;
        harness.fakeScheduler.fire();
        expect(harness.dispatchTimeSpecifiedEnd).not.toHaveBeenCalled();

        harness.now.value = reserve.endAt;
        harness.fakeScheduler.fire();
        expect(harness.dispatchTimeSpecifiedEnd).toHaveBeenCalledOnce();
        expect(harness.dispatchTimeSpecifiedEnd).toHaveBeenCalledWith(
            expect.objectContaining({ dueAt: reserve.endAt, reservationId: reserve.id }),
        );
        expect(harness.registry.get(reserve.id)).toMatchObject({ phase: 'Finishing' });
        expect(harness.controller.timeSpecifiedEnds.size).toBe(0);

        harness.controller.wake();
        expect(harness.dispatchTimeSpecifiedEnd).toHaveBeenCalledOnce();
        harness.controller.stop();
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(0);
    });

    it('[Task 8.1] records synchronous throws and returned promise rejections locally without stopping another consumer', async () => {
        const event = new RecordingEvent({ getLogger: () => logger });
        const reserve = makeReserve({ id: 84 });
        const synchronousFailure = new Error('synthetic synchronous listener failure');
        const rejectedFailure = new Error('synthetic rejected listener failure');
        const delivered = vi.fn();

        event.setStartPrepRecording(() => {
            throw synchronousFailure;
        });
        event.setStartPrepRecording(delivered);
        event.setCancelPrepRecording(async () => Promise.reject(rejectedFailure));
        event.setCancelPrepRecording(delivered);

        expect(() => event.emitStartPrepRecording(reserve)).not.toThrow();
        expect(() => event.emitCancelPrepRecording(reserve)).not.toThrow();
        await flushImmediate();

        expect(delivered).toHaveBeenCalledTimes(2);
        expect(delivered).toHaveBeenNthCalledWith(1, reserve);
        expect(delivered).toHaveBeenNthCalledWith(2, reserve);
        expect(logger.system.error).toHaveBeenCalledTimes(2);
        expect(logger.system.error).toHaveBeenNthCalledWith(1, synchronousFailure);
        expect(logger.system.error).toHaveBeenNthCalledWith(2, rejectedFailure);
    });

    it('[Task 8.1] publishes preparation start only for attempt zero, then publishes cancellation and terminal preparation failure for a reservation past its end time', async () => {
        const reserve = makeReserve({ id: 85 });
        const started = createLifecycleLedger();
        const startedHarness = makeRecorder({ recordingEvent: started.event });
        startedHarness.model.reserve = reserve;
        startedHarness.model.doRecord = vi.fn(async () => undefined);

        await startedHarness.model.startPreparation();
        await startedHarness.model.prepRecord(1);
        await flushImmediate();

        expect(started.ledger).toEqual([['prepare-start', reserve]]);
        startedHarness.model.destroyStream();

        const cancelled = createLifecycleLedger();
        const streamAcquire = deferred<PassThrough>();
        const cancellationHarness = makeRecorder({
            recordingEvent: cancelled.event,
            streamCreator: { create: vi.fn(() => streamAcquire.promise), changeEndAt: vi.fn() },
        });
        cancellationHarness.model.reserve = reserve;

        const preparation = cancellationHarness.model.startPreparation();
        await vi.waitFor(() => expect(cancellationHarness.streamCreator.create).toHaveBeenCalledOnce());
        const cancellation = cancellationHarness.model.cancel(false);
        streamAcquire.reject(new Error('synthetic cancelled stream acquisition'));
        await Promise.all([preparation, cancellation]);
        await flushImmediate();

        expect(cancelled.ledger).toEqual([
            ['prepare-start', reserve],
            ['prepare-cancel', reserve],
        ]);

        const failed = createLifecycleLedger();
        const failureHarness = makeRecorder({
            recordingEvent: failed.event,
            streamCreator: {
                create: vi.fn(async () => Promise.reject(new Error('synthetic terminal preparation failure'))),
                changeEndAt: vi.fn(),
            },
        });
        const endedReserve = makeReserve({ id: 85, endAt: Date.now() - 1 });
        failureHarness.model.reserve = endedReserve;

        await failureHarness.model.prepRecord(3);
        await flushImmediate();

        expect(failed.ledger).toEqual([['prepare-failed', endedReserve]]);
    });

    it('[Task 8.1] publishes recording start after first data and both persistence registrations, and preserves failure payloads', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-lifecycle-boundary-'));
        const fullPath = join(root, 'synthetic.ts');
        const reserve = makeReserve({ id: 86 });
        const persistenceLedger: string[] = [];
        const recordedInsert = deferred<number>();
        const videoFileInsert = deferred<number>();
        const lifecycle = createLifecycleLedger();
        lifecycle.event.setStartRecording(() => persistenceLedger.push('recording-start'));
        const stream = new PassThrough();
        const startHarness = makeRecorder({
            recordingEvent: lifecycle.event,
            recordedDB: {
                findId: vi.fn(),
                insertOnce: vi.fn(() => (persistenceLedger.push('recorded-row'), recordedInsert.promise)),
                removeRecording: vi.fn(async () => undefined),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    fileName: 'synthetic.ts',
                    fullPath,
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn().mockResolvedValue(undefined),
            },
            videoFileDB: {
                insertOnce: vi.fn(() => (persistenceLedger.push('video-file-row'), videoFileInsert.promise)),
            },
        });
        startHarness.model.reserve = reserve;
        startHarness.model.stream = stream;
        const addRecorded = vi.spyOn(startHarness.model, 'addRecorded');

        try {
            let doRecordCompleted = false;
            const started = startHarness.model.doRecord().then(() => {
                doRecordCompleted = true;
            });
            await vi.waitFor(() => expect(startHarness.recordingUtil.getRecPath).toHaveBeenCalledOnce());
            await flushImmediate();
            expect(lifecycle.ledger).toEqual([]);
            expect(doRecordCompleted).toBe(false);
            stream.write(Buffer.from('synthetic-first-data'));
            await flushImmediate();

            expect(lifecycle.ledger).toEqual([]);
            expect(doRecordCompleted).toBe(false);
            await vi.waitFor(() => expect(startHarness.recordedDB.insertOnce).toHaveBeenCalledOnce());
            expect(lifecycle.ledger).toEqual([]);
            expect(doRecordCompleted).toBe(false);

            recordedInsert.resolve(21);
            await vi.waitFor(() => expect(startHarness.videoFileDB.insertOnce).toHaveBeenCalledOnce());
            expect(lifecycle.ledger).toEqual([]);
            expect(doRecordCompleted).toBe(false);

            videoFileInsert.resolve(31);
            await started;
            await flushImmediate();
            expect(addRecorded).toHaveBeenCalledOnce();
            const registered = await addRecorded.mock.results[0]?.value;

            expect(persistenceLedger).toEqual(['recorded-row', 'video-file-row', 'recording-start']);
            expect(lifecycle.ledger).toEqual([['recording-start', reserve, registered]]);

            const writer = startHarness.model.recFile;
            const closed = once(writer, 'close');
            startHarness.model.isCanceledCallingFinished = true;
            startHarness.model.destroyStream();
            await closed;
        } finally {
            startHarness.model.isCanceledCallingFinished = true;
            startHarness.model.destroyStream();
            await rm(root, { force: true, recursive: true });
        }

        const failureLifecycle = createLifecycleLedger();
        const failureHarness = makeRecorder({ recordingEvent: failureLifecycle.event });
        failureHarness.model.reserve = reserve;

        await failureHarness.model.recFailed(new Error('synthetic recording failure'));
        await flushImmediate();

        expect(failureLifecycle.ledger).toEqual([['recording-failed', reserve, null, undefined]]);
    });

    it('[Task 8.1] emits startup completion with needsReservationRemoval and retry-over only at the retry limit', async () => {
        const reserve = makeReserve({ id: 87, endAt: Date.now() + 120_000, startAt: Date.now() + 60_000 });
        const recorded = makeRecorded({ id: 88, isRecording: true, reserveId: reserve.id });
        const completionLifecycle = createLifecycleLedger();
        const startup = makeLifecycleManager(completionLifecycle.event, {
            recordedDB: {
                findAll: vi.fn(async () => [[recorded], 1]),
                findId: vi.fn(async () => recorded),
                removeRecording: vi.fn(async () => undefined),
            },
            reserveDB: { findId: vi.fn(async () => reserve) },
        });

        await startup.manager.cleanup();
        await flushImmediate();

        expect(completionLifecycle.ledger).toEqual([['recording-finish', reserve, recorded, true]]);

        const retryLifecycle = createLifecycleLedger();
        const retry = makeLifecycleManager(retryLifecycle.event, {
            recordedDB: { findReserveId: vi.fn(async () => [{}, {}, {}]) },
        });
        try {
            await retry.manager.update({ insert: [reserve], isSuppressLog: false });
            const failureIdentity = retry.recorder.bindScheduleSession.mock.calls.at(-1)?.[0];
            expect(failureIdentity).toBeDefined();

            retryLifecycle.event.emitRecordingFailed(reserve, null, failureIdentity);
            await vi.waitFor(() =>
                expect(retryLifecycle.ledger).toEqual([
                    ['recording-failed', reserve, null, failureIdentity],
                    ['retry-over', reserve],
                ]),
            );

            expect(retry.recordedDB.findReserveId).toHaveBeenCalledOnce();
            expect(retry.recordedDB.findReserveId).toHaveBeenCalledWith(reserve.id);
        } finally {
            retry.manager.scheduleController.stop();
        }
    });

    it('[Task 8.1] publishes one relay candidate with a shallow parent reservation copy, and none when no candidate resolves', async () => {
        const reserve = makeReserve({ id: 89, programId: 890, extended: { marker: 'shared' } });
        const lifecycle = createLifecycleLedger();
        const harness = makeRecorder({
            recordingEvent: lifecycle.event,
            programDB: {
                findEventRelayProgram: vi.fn(async () => ({ id: 891 })),
                findId: vi.fn(async () => reserve),
            },
            tunerServerAccess: {
                getProgram: vi.fn(async () => ({
                    networkId: 1,
                    relatedItems: [{ eventId: 3, networkId: 1, serviceId: 2, type: 'relay' }],
                })),
            },
        });
        harness.model.reserve = reserve;

        await harness.model.checkEventRelay();
        await flushImmediate();

        expect(harness.programDB.findEventRelayProgram).toHaveBeenCalledWith(1, 2, 3);
        expect(lifecycle.ledger).toEqual([['relay', [{ parentReserve: expect.any(Object), programId: 891 }]]]);
        const parentReserve = (lifecycle.ledger[0]?.[1] as any[])[0].parentReserve;
        expect(parentReserve).toEqual(reserve);
        expect(parentReserve).not.toBe(reserve);
        expect(parentReserve.extended).toBe(reserve.extended);

        const noCandidateLifecycle = createLifecycleLedger();
        const noCandidateHarness = makeRecorder({
            recordingEvent: noCandidateLifecycle.event,
            programDB: {
                findEventRelayProgram: vi.fn(async () => null),
                findId: vi.fn(async () => reserve),
            },
            tunerServerAccess: {
                getProgram: vi.fn(async () => ({
                    networkId: 1,
                    relatedItems: [{ eventId: 3, networkId: 1, serviceId: 2, type: 'relay' }],
                })),
            },
        });
        noCandidateHarness.model.reserve = reserve;

        await noCandidateHarness.model.checkEventRelay();
        await flushImmediate();

        expect(noCandidateLifecycle.ledger).toEqual([]);
    });
});
