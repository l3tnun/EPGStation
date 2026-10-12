import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    deferred,
    ExecutionManagementModel,
    logger,
    makeRecorder,
    makeRecordingSessionBinding,
    makeReserve,
    makeStreamCreator,
    RecordingUtilModel,
} from './_harness';

afterEach(() => vi.useRealTimers());

const makePathSelector = (
    root: string,
    options: { execution?: any; channelFindId?: any; findChannelIdAndTime?: any; recordedFormat?: string } = {},
) =>
    new RecordingUtilModel(
        { getLogger: () => logger },
        {
            getConfig: () => ({
                recorded: [{ name: 'synthetic-root', path: root }],
                recordedFormat: options.recordedFormat ?? 'synthetic',
                recordedFileExtension: '.ts',
            }),
        },
        options.execution ?? { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
        { findId: options.channelFindId ?? vi.fn(async () => null) },
        { findChannelIdAndTime: options.findChannelIdAndTime ?? vi.fn(async () => null) },
        {},
        {},
    );

describe('recording preparation', () => {
    const closeRecorderStream = async (
        harness: ReturnType<typeof makeRecorder>,
        recordingStream: PassThrough,
    ): Promise<void> => {
        const terminal = recordingStream.closed
            ? Promise.resolve()
            : new Promise<void>(resolve => recordingStream.once('close', resolve));
        try {
            harness.model.destroyStream();
        } finally {
            if (!recordingStream.destroyed) recordingStream.destroy();
            await terminal;
        }
    };

    it('[Task 3.1 mutation gap] cancels a missing saved program before opening a stream', async () => {
        const reserve = makeReserve();
        const harness = makeRecorder({ programDB: { findId: vi.fn(async () => null) } });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);

        await harness.model.startPreparation();

        expect(harness.streamCreator.create).not.toHaveBeenCalled();
        expect(harness.recordingEvent.emitCancelPrepRecording).not.toHaveBeenCalled();
        expect(session.state.phase).toBe('Cancelled');
        expect(harness.model.retryTimerId).toBeNull();
        expect(harness.model.abortController).toBeNull();
    });

    it('[RE-3.1][Task 3.1] rechecks program and persisted reservation after opening the stream', async () => {
        const stream = new PassThrough();
        const harness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => null) },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
        });
        harness.model.reserve = makeReserve();
        await harness.model.prepRecord();
        expect(harness.programDB.findId).toHaveBeenCalledBefore(harness.streamCreator.create);
        expect(harness.reserveDB.findId).toHaveBeenCalledAfter(harness.streamCreator.create);
        expect(stream.destroyed).toBe(true);
        expect(harness.recordingUtil.getRecPath).not.toHaveBeenCalled();
    });

    it('[RE-3.16][Task 4.3] closes and removes only the reservation-owned file when cancellation wins before pipe', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-prep-cleanup-'));
        const fullPath = join(root, 'owned.ts');
        const otherPath = join(root, 'other.ts');
        const fileHandle = await open(fullPath, 'wx');
        await writeFile(otherPath, 'other recording', 'utf8');
        const selected = deferred<any>();
        const stream = new PassThrough();
        const harness = makeRecorder({ recordingUtil: { getRecPath: vi.fn(() => selected.promise) } });
        harness.model.reserve = makeReserve();
        harness.model.stream = stream;
        const pipe = vi.spyOn(stream, 'pipe');
        try {
            const recording = harness.model.doRecord();
            await vi.waitFor(() => expect(harness.recordingUtil.getRecPath).toHaveBeenCalledOnce());
            harness.model.destroyStream();
            selected.resolve({
                parendDir: { name: 'synthetic-root', path: root },
                subDir: '',
                fileName: 'owned.ts',
                fullPath,
                fileHandle,
            });
            await recording;

            expect(pipe).not.toHaveBeenCalled();
            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(stat(otherPath)).resolves.toMatchObject({});
            await expect(fileHandle.writeFile('late write')).rejects.toThrow();
        } finally {
            pipe.mockRestore();
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[RE-3.17][Task 4.5] fences the overdue recording session without scheduling a second path selection', async () => {
        const stream = new PassThrough();
        const reserve = makeReserve({ id: 417 });
        const lateTerminal = deferred<void>();
        const cancelEvent = vi.fn();
        const overdue = Object.assign(new Error('PathSelectionOverdueError'), {
            name: 'PathSelectionOverdueError',
            terminal: lateTerminal.promise,
        });
        const harness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => reserve) },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
        });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.eventEmitter.on('RecordingCancelEvent', cancelEvent);
        harness.model.doRecord = vi.fn(async () => {
            session.state.phase = 'Recording';
            throw overdue;
        });

        await harness.model.startPreparation();

        expect(stream.destroyed).toBe(true);
        expect(session.state.phase).toBe('PathSelectionOverdue');
        expect(harness.model.retryTimerId).toBeNull();
        expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();

        lateTerminal.resolve();
        await new Promise(resolve => setImmediate(resolve));

        expect(session.state.phase).toBe('Cancelled');
        expect(harness.model.isPrepRecording).toBe(false);
        expect(harness.model.isRecording).toBe(false);
        expect(cancelEvent).toHaveBeenCalledOnce();
    });

    it('[Task 4.5] leaves a session unchanged when its overdue phase transition did not install', async () => {
        const stream = new PassThrough();
        const reserve = makeReserve({ id: 419 });
        const lateTerminal = deferred<void>();
        const cancelEvent = vi.fn();
        const overdue = Object.assign(new Error('PathSelectionOverdueError'), {
            name: 'PathSelectionOverdueError',
            terminal: lateTerminal.promise,
        });
        const harness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => reserve) },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
        });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        session.binding.tryTransition.mockImplementation((expectedPhase: string, nextPhase: string) => {
            if (expectedPhase !== 'Preparing' || nextPhase !== 'Recording') return false;
            session.state.phase = 'Recording';
            return true;
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.eventEmitter.on('RecordingCancelEvent', cancelEvent);
        harness.model.doRecord = vi.fn(async () => {
            session.state.phase = 'PathSelectionOverdue';
            throw overdue;
        });

        await harness.model.startPreparation();
        lateTerminal.resolve();
        await new Promise(resolve => setImmediate(resolve));

        expect(stream.destroyed).toBe(true);
        expect(session.state.phase).toBe('PathSelectionOverdue');
        expect(session.binding.removeTimeSpecifiedEnd).not.toHaveBeenCalled();
        expect(cancelEvent).not.toHaveBeenCalled();
    });

    it('[Task 4.5] never lets a late terminal cancel a replacement recording session', async () => {
        const stream = new PassThrough();
        const reserve = makeReserve({ id: 420 });
        const lateTerminal = deferred<void>();
        const cancelEvent = vi.fn();
        const overdue = Object.assign(new Error('PathSelectionOverdueError'), {
            name: 'PathSelectionOverdueError',
            terminal: lateTerminal.promise,
        });
        const harness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => reserve) },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
        });
        const session = makeRecordingSessionBinding(reserve, {
            phase: 'Preparing',
            generation: 1n,
            sessionToken: 1n,
        });
        const replacement = makeRecordingSessionBinding(reserve, {
            phase: 'Preparing',
            generation: 2n,
            sessionToken: 2n,
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.eventEmitter.on('RecordingCancelEvent', cancelEvent);
        harness.model.doRecord = vi.fn(async () => {
            throw overdue;
        });

        await harness.model.startPreparation();
        expect(session.state.phase).toBe('PathSelectionOverdue');
        harness.model.bindScheduleSession(replacement.binding);
        lateTerminal.resolve();
        await new Promise(resolve => setImmediate(resolve));

        expect(stream.destroyed).toBe(true);
        expect(session.state.phase).toBe('PathSelectionOverdue');
        expect(session.binding.removeTimeSpecifiedEnd).not.toHaveBeenCalled();
        expect(replacement.state.phase).toBe('Preparing');
        expect(cancelEvent).not.toHaveBeenCalled();
    });

    it.each([
        { isPrepRecording: true, isRecording: false, phase: 'Preparing' },
        { isPrepRecording: false, isRecording: true, phase: 'Recording' },
    ] as const)(
        '[Task 4.5] keeps a same-token successor %s untouched when the old terminal settles',
        async successor => {
            const oldStream = new PassThrough();
            const successorStream = new PassThrough();
            const reserve = makeReserve({ id: successor.phase === 'Preparing' ? 421 : 422 });
            const lateTerminal = deferred<void>();
            const cancelEvent = vi.fn();
            const overdue = Object.assign(new Error('PathSelectionOverdueError'), {
                name: 'PathSelectionOverdueError',
                terminal: lateTerminal.promise,
            });
            const harness = makeRecorder({
                reserveDB: { findId: vi.fn(async () => reserve) },
                streamCreator: { create: vi.fn(async () => oldStream), changeEndAt: vi.fn() },
            });
            const oldSession = makeRecordingSessionBinding(reserve, {
                phase: 'Preparing',
                generation: 1n,
                sessionToken: 1n,
            });
            const successorSession = makeRecordingSessionBinding(reserve, {
                phase: successor.phase,
                generation: 2n,
                sessionToken: 1n,
            });
            harness.model.reserve = reserve;
            harness.model.bindScheduleSession(oldSession.binding);
            harness.model.eventEmitter.on('RecordingCancelEvent', cancelEvent);
            harness.model.doRecord = vi.fn(async () => {
                throw overdue;
            });

            await harness.model.startPreparation();
            expect(oldSession.state.phase).toBe('PathSelectionOverdue');
            expect(oldStream.destroyed).toBe(true);

            harness.model.bindScheduleSession(successorSession.binding);
            harness.model.stream = successorStream;
            harness.model.isPrepRecording = successor.isPrepRecording;
            harness.model.isRecording = successor.isRecording;
            lateTerminal.resolve();
            await new Promise(resolve => setImmediate(resolve));

            expect(successorSession.state.phase).toBe(successor.phase);
            expect(harness.model.isPrepRecording).toBe(successor.isPrepRecording);
            expect(harness.model.isRecording).toBe(successor.isRecording);
            expect(harness.model.stream).toBe(successorStream);
            expect(successorStream.destroyed).toBe(false);
            expect(cancelEvent).not.toHaveBeenCalled();
        },
    );

    it.each([
        Object.assign(new Error('wrong overdue name'), {
            name: 'OtherSelectionError',
            terminal: Promise.resolve(),
        }),
        Object.assign(new Error('missing overdue terminal'), { name: 'PathSelectionOverdueError' }),
        Object.assign(new Error('non-promise overdue terminal'), {
            name: 'PathSelectionOverdueError',
            terminal: {},
        }),
    ])('[Task 4.5] leaves a malformed overdue-shaped preparation failure on the normal failure path', async error => {
        const stream = new PassThrough();
        const reserve = makeReserve({ id: 418 });
        const harness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => reserve) },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
        });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.doRecord = vi.fn(async () => {
            session.state.phase = 'Recording';
            throw error;
        });

        await harness.model.startPreparation();

        expect(session.state.phase).toBe('RetryWaiting');
        expect(harness.model.retryTimerId).not.toBeNull();
        harness.model.invalidateRetry();
    });

    it('[Task 3.1 mutation gap] closes an acquired stream before retrying a failed reservation recheck', async () => {
        vi.useFakeTimers();
        const firstStream = new PassThrough();
        const reserve = makeReserve();
        const harness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => Promise.reject(new Error('synthetic reserve read failure'))) },
            streamCreator: {
                create: vi
                    .fn()
                    .mockResolvedValueOnce(firstStream)
                    .mockRejectedValueOnce(new Error('synthetic retry stream failure')),
                changeEndAt: vi.fn(),
            },
        });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);

        await harness.model.startPreparation();

        expect(firstStream.destroyed).toBe(true);
        expect(harness.streamCreator.create).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(4_999);
        expect(harness.streamCreator.create).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(harness.streamCreator.create).toHaveBeenCalledTimes(2);
    });

    it('[Task 3.1 mutation gap] closes a post-acquire stream when cancellation wins during reservation recheck', async () => {
        const stream = new PassThrough();
        const reserveRead = deferred<ReturnType<typeof makeReserve>>();
        const reserve = makeReserve({ id: 43 });
        const harness = makeRecorder({
            reserveDB: { findId: vi.fn(() => reserveRead.promise) },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
        });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.doRecord = vi.fn(async () => undefined);

        const preparation = harness.model.startPreparation();
        await vi.waitFor(() => expect(harness.reserveDB.findId).toHaveBeenCalledOnce());
        const cancellation = harness.model.cancel(false);
        reserveRead.resolve(reserve);
        await Promise.all([preparation, cancellation]);

        expect(stream.destroyed).toBe(true);
        expect(harness.model.doRecord).not.toHaveBeenCalled();
        expect(session.state.phase).toBe('Cancelled');
        expect(harness.model.isPrepRecording).toBe(false);
        expect(harness.model.isRecording).toBe(false);
    });

    it('[Task 3.1 mutation gap] contains cancellation while stream acquisition is pending', async () => {
        const reserve = makeReserve();
        const createStarted = deferred<void>();
        const harness = makeRecorder({
            streamCreator: {
                create: vi.fn((_reserve: unknown, signal: AbortSignal) => {
                    createStarted.resolve();
                    return new Promise((_resolve, reject) => {
                        signal.addEventListener('abort', () => reject(new Error('synthetic acquisition abort')), {
                            once: true,
                        });
                    });
                }),
                changeEndAt: vi.fn(),
            },
        });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);

        const preparation = harness.model.startPreparation();
        await createStarted.promise;
        const cancellation = harness.model.cancel(false);
        await Promise.all([preparation, cancellation]);

        expect(harness.streamCreator.create).toHaveBeenCalledOnce();
        expect(harness.recordingEvent.emitCancelPrepRecording).toHaveBeenCalledOnce();
        expect(session.state.phase).toBe('Cancelled');
        expect(harness.model.retryTimerId).toBeNull();
        expect(harness.model.abortController).toBeNull();
    });

    it('[Task 3.1 mutation gap] destroys a post-acquire continuation after a replacement session is bound', async () => {
        const stream = new PassThrough();
        const reserveRead = deferred<ReturnType<typeof makeReserve>>();
        const original = makeReserve({ id: 41 });
        const replacement = makeReserve({ ...original, startAt: original.startAt + 30_000 });
        const harness = makeRecorder({
            reserveDB: { findId: vi.fn(() => reserveRead.promise) },
            streamCreator: {
                create: vi.fn(async () => stream),
                changeEndAt: vi.fn(),
                releaseTimeSpecifiedEnd: vi.fn(),
            },
        });
        const originalSession = makeRecordingSessionBinding(original, {
            generation: 1n,
            phase: 'Preparing',
            sessionToken: 1n,
        });
        const replacementSession = makeRecordingSessionBinding(replacement, {
            generation: 2n,
            phase: 'Preparing',
            sessionToken: 2n,
        });
        harness.model.reserve = original;
        harness.model.bindScheduleSession(originalSession.binding);
        harness.model.doRecord = vi.fn(async () => undefined);

        const preparation = harness.model.startPreparation();
        await vi.waitFor(() => expect(harness.reserveDB.findId).toHaveBeenCalledOnce());
        harness.model.bindScheduleSession(replacementSession.binding);
        reserveRead.resolve(replacement);
        await preparation;

        expect(stream.destroyed).toBe(true);
        expect(harness.model.doRecord).not.toHaveBeenCalled();
        expect(harness.streamCreator.releaseTimeSpecifiedEnd).not.toHaveBeenCalled();
        expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        expect(replacementSession.state.phase).toBe('Preparing');
    });

    it('[Task 3.1 mutation gap] closes a post-acquire stream when the same session rejects the Preparing handoff', async () => {
        const stream = new PassThrough();
        const reserve = makeReserve({ id: 44 });
        const releaseTimeSpecifiedEnd = vi.fn();
        const harness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => reserve) },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn(), releaseTimeSpecifiedEnd },
        });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        session.binding.tryTransition.mockReturnValueOnce(false);
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.doRecord = vi.fn(async () => undefined);

        await harness.model.startPreparation();

        expect(session.binding.tryTransition).toHaveBeenCalledWith('Preparing', 'Recording');
        expect(stream.destroyed).toBe(true);
        expect(harness.model.doRecord).not.toHaveBeenCalled();
        expect(session.binding.registerTimeSpecifiedEnd).not.toHaveBeenCalled();
        expect(releaseTimeSpecifiedEnd).not.toHaveBeenCalled();
    });

    it('[Task 3.1 mutation gap] does not retry a rejected old preparation after its session is replaced', async () => {
        const stream = new PassThrough();
        const recording = deferred<void>();
        const original = makeReserve({ id: 45 });
        const replacement = makeReserve({ ...original, startAt: original.startAt + 30_000 });
        const harness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => original) },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
        });
        const originalSession = makeRecordingSessionBinding(original, {
            generation: 1n,
            phase: 'Preparing',
            sessionToken: 1n,
        });
        const replacementSession = makeRecordingSessionBinding(replacement, {
            generation: 2n,
            phase: 'Preparing',
            sessionToken: 2n,
        });
        harness.model.reserve = original;
        harness.model.bindScheduleSession(originalSession.binding);
        harness.model.doRecord = vi.fn(() => recording.promise);

        const preparation = harness.model.startPreparation();
        await vi.waitFor(() => expect(harness.model.doRecord).toHaveBeenCalledOnce());
        harness.model.bindScheduleSession(replacementSession.binding);
        recording.reject(new Error('synthetic stale recording handoff failure'));
        await preparation;

        expect(stream.destroyed).toBe(true);
        expect(harness.streamCreator.create).toHaveBeenCalledOnce();
        expect(harness.model.retryTimerId).toBeNull();
        expect(harness.model.retryAttempt).toBeNull();
        expect(replacementSession.state.phase).toBe('Preparing');
        expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
    });

    it('[Task 3.1 mutation gap] hands a time-specified end to both central schedule owners exactly once', async () => {
        const stream = new PassThrough();
        const reserve = makeReserve({ id: 42, isTimeSpecified: true, programId: null });
        const releaseTimeSpecifiedEnd = vi.fn();
        const harness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => reserve) },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn(), releaseTimeSpecifiedEnd },
        });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.doRecord = vi.fn(async () => undefined);

        try {
            await harness.model.startPreparation();

            expect(harness.programDB.findId).not.toHaveBeenCalled();
            expect(session.binding.registerTimeSpecifiedEnd).toHaveBeenCalledOnce();
            expect(session.binding.registerTimeSpecifiedEnd).toHaveBeenCalledWith(
                reserve.endAt + harness.config.timeSpecifiedEndMargin * 1_000,
            );
            expect(releaseTimeSpecifiedEnd).toHaveBeenCalledOnce();
            expect(releaseTimeSpecifiedEnd).toHaveBeenCalledWith(reserve.id);
            expect(harness.model.doRecord).toHaveBeenCalledOnce();
        } finally {
            await closeRecorderStream(harness, stream);
        }
    });

    it('[Task 3.1 mutation gap] keeps a normal program reservation out of the time-specified end owners', async () => {
        const stream = new PassThrough();
        const reserve = makeReserve({ id: 46, isTimeSpecified: false, programId: 101 });
        const releaseTimeSpecifiedEnd = vi.fn();
        const harness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => reserve) },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn(), releaseTimeSpecifiedEnd },
        });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.doRecord = vi.fn(async () => undefined);

        try {
            await harness.model.startPreparation();

            expect(harness.programDB.findId).toHaveBeenCalledWith(reserve.programId);
            expect(session.binding.registerTimeSpecifiedEnd).not.toHaveBeenCalled();
            expect(releaseTimeSpecifiedEnd).not.toHaveBeenCalled();
            expect(harness.model.doRecord).toHaveBeenCalledOnce();
        } finally {
            await closeRecorderStream(harness, stream);
        }
    });

    it('[Task 3.1 mutation gap] leaves legacy time-specified end ownership with the stream creator', async () => {
        const stream = new PassThrough();
        const reserve = makeReserve({ id: 47, isTimeSpecified: false, programId: 101 });
        const harness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => reserve) },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
        });
        harness.model.reserve = reserve;
        harness.model.doRecord = vi.fn(async () => undefined);

        try {
            await harness.model.prepRecord();

            expect(harness.streamCreator.create).toHaveBeenCalledWith(reserve, expect.any(AbortSignal), undefined);
            expect(harness.model.doRecord).toHaveBeenCalledOnce();
        } finally {
            await closeRecorderStream(harness, stream);
        }
    });

    it('[Task 3.1 mutation gap] does not adopt a newly bound session as the owner of a legacy preparation failure', async () => {
        vi.useFakeTimers();
        const reserve = makeReserve({ id: 48 });
        const replacement = makeRecordingSessionBinding(reserve, {
            generation: 2n,
            phase: 'Preparing',
            sessionToken: 2n,
        });
        let harness: ReturnType<typeof makeRecorder>;
        const create = vi.fn(async () => {
            harness.model.bindScheduleSession(replacement.binding);
            throw new Error('synthetic legacy preparation failure');
        });
        harness = makeRecorder({ streamCreator: { create, changeEndAt: vi.fn() } });
        harness.model.reserve = reserve;

        await harness.model.prepRecord();

        expect(replacement.state.phase).toBe('Preparing');
        expect(replacement.binding.tryTransition).not.toHaveBeenCalled();
        expect(harness.model.retryAttempt).toBe(1);
        expect(vi.getTimerCount()).toBe(1);
        harness.model.invalidateRetry();
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['AwaitingFirstData', 'Registering'] as const)(
        '[Task 3.1 mutation gap] retains retry ownership after a %s handoff failure',
        async phase => {
            vi.useFakeTimers();
            const stream = new PassThrough();
            const reserve = makeReserve({ id: phase === 'AwaitingFirstData' ? 49 : 50 });
            const harness = makeRecorder({
                reserveDB: { findId: vi.fn(async () => reserve) },
                streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
            });
            const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
            harness.model.reserve = reserve;
            harness.model.bindScheduleSession(session.binding);
            harness.model.doRecord = vi.fn(async () => {
                session.state.phase = phase;
                throw new Error(`synthetic ${phase} handoff failure`);
            });

            await harness.model.startPreparation();

            expect(session.state.phase).toBe('RetryWaiting');
            expect(session.binding.tryTransition).toHaveBeenLastCalledWith(phase, 'RetryWaiting');
            expect(harness.model.retryAttempt).toBe(1);
            expect(vi.getTimerCount()).toBe(1);
            harness.model.invalidateRetry();
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it('[Task 2.3 mutation gap] transitions a retry-waiting session to Cancelled on preparation cancellation', () => {
        const reserve = makeReserve({ id: 51 });
        const harness = makeRecorder();
        const session = makeRecordingSessionBinding(reserve, { phase: 'RetryWaiting' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);

        harness.model.emitCancelEvent();

        expect(session.binding.tryTransition).toHaveBeenCalledWith('RetryWaiting', 'Cancelled');
        expect(session.state.phase).toBe('Cancelled');
    });

    it('[RE-3.3][RE-3.4][Task 3.2] uses normal and conflict priorities at the common tuner port', async () => {
        const harness = makeStreamCreator();
        await harness.model.create(makeReserve({ id: 1 }));
        await harness.model.create(makeReserve({ id: 2, isConflict: true }));
        expect(
            harness.tunerServerAccess.openProgramStream.mock.calls.map(([option]: any[]) => option.priority),
        ).toEqual([2, 9]);
    });

    it('[Task 3.2] shares a tuner for the same channel and still opens when no logical tuner is available', async () => {
        vi.useFakeTimers();
        const shared = makeStreamCreator();
        const unavailable = makeStreamCreator();
        let first: PassThrough | undefined;
        let second: PassThrough | undefined;
        let fallback: PassThrough | undefined;
        try {
            shared.model.setTuner([{ types: ['GR'] }]);
            first = await shared.model.create(makeReserve({ id: 11, channel: 'synthetic-shared' }));
            second = await shared.model.create(makeReserve({ id: 12, channel: 'synthetic-shared' }));
            expect(shared.model.tuners[0].programs).toHaveLength(2);
            expect(shared.tunerServerAccess.openProgramStream).toHaveBeenCalledTimes(2);

            unavailable.model.setTuner([]);
            fallback = await unavailable.model.create(makeReserve({ id: 13 }));
            expect(unavailable.tunerServerAccess.openProgramStream).toHaveBeenCalledOnce();
        } finally {
            first?.destroy();
            second?.destroy();
            fallback?.destroy();
            vi.clearAllTimers();
            expect(vi.getTimerCount()).toBe(0);
            vi.useRealTimers();
        }
    });

    it.each([
        ['disallowed end lack', false, 1_000, false],
        ['outside fifteen seconds', true, 15_001, false],
        ['at fifteen seconds', true, 15_000, true],
    ])(
        '[RE-3.5][Task 3.2] reassigns only eligible tuner reservations: %s',
        async (_case, allowEndLack, remaining, reassigned) => {
            vi.useFakeTimers();
            vi.setSystemTime(1_000_000);
            const firstStream = new PassThrough();
            const secondStream = new PassThrough();
            const harness = makeStreamCreator({
                tunerServerAccess: {
                    openProgramStream: vi
                        .fn()
                        .mockResolvedValueOnce({ stream: firstStream, close: vi.fn() })
                        .mockResolvedValueOnce({ stream: secondStream, close: vi.fn() }),
                    getProgram: vi.fn(async () => ({ startAt: 900_000, duration: 100_000 })),
                },
            });
            harness.model.setTuner([{ types: ['GR'] }]);
            await harness.model.create(
                makeReserve({ id: 21, channel: 'synthetic-first', allowEndLack, endAt: 1_000_000 + remaining }),
            );
            await harness.model.create(makeReserve({ id: 22, channel: 'synthetic-second' }));
            expect(firstStream.destroyed).toBe(reassigned);
            expect(harness.tunerServerAccess.getProgram).toHaveBeenCalledTimes(reassigned ? 1 : 0);
            secondStream.destroy();
            firstStream.destroy();
        },
    );

    it('[Task 3.2] keeps the current tuner assignment when the latest program metadata extends past preparation', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const currentStream = new PassThrough();
        const fallbackStream = new PassThrough();
        const harness = makeStreamCreator({
            tunerServerAccess: {
                openProgramStream: vi
                    .fn()
                    .mockResolvedValueOnce({ stream: currentStream, close: vi.fn() })
                    .mockResolvedValueOnce({ stream: fallbackStream, close: vi.fn() }),
                getProgram: vi.fn(async () => ({ startAt: 900_000, duration: 120_000 })),
            },
        });
        harness.model.setTuner([{ types: ['GR'] }]);
        await harness.model.create(
            makeReserve({ id: 23, channel: 'synthetic-current', allowEndLack: true, endAt: 1_015_000 }),
        );
        await harness.model.create(makeReserve({ id: 24, channel: 'synthetic-next' }));
        expect(harness.tunerServerAccess.getProgram).toHaveBeenCalledWith(101);
        expect(currentStream.destroyed).toBe(false);
        expect(harness.model.tuners[0].programs.map((entry: any) => entry.reserve.id)).toEqual([23]);
        expect(harness.tunerServerAccess.openProgramStream).toHaveBeenCalledTimes(2);
        currentStream.destroy();
        fallbackStream.destroy();
        vi.clearAllTimers();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[RE-3.6][Task 3.2] treats metadata lookup failure as no extension and reassigns', async () => {
        vi.useFakeTimers();
        const firstStream = new PassThrough();
        const secondStream = new PassThrough();
        const harness = makeStreamCreator({
            tunerServerAccess: {
                openProgramStream: vi
                    .fn()
                    .mockResolvedValueOnce({ stream: firstStream, close: vi.fn() })
                    .mockResolvedValueOnce({ stream: secondStream, close: vi.fn() }),
                getProgram: vi.fn(async () => Promise.reject(new Error('synthetic metadata failure'))),
            },
        });
        try {
            harness.model.setTuner([{ types: ['GR'] }]);
            await harness.model.create(
                makeReserve({ id: 1, channel: 'first', allowEndLack: true, endAt: Date.now() + 1_000 }),
            );
            await harness.model.create(makeReserve({ id: 2, channel: 'second' }));
            expect(harness.tunerServerAccess.getProgram).toHaveBeenCalledOnce();
            expect(firstStream.destroyed).toBe(true);
            expect(harness.tunerServerAccess.openProgramStream).toHaveBeenCalledTimes(2);
        } finally {
            firstStream.destroy();
            secondStream.destroy();
            vi.clearAllTimers();
            expect(vi.getTimerCount()).toBe(0);
            vi.useRealTimers();
        }
    });

    it('[Task 3.2] initializes tuner tracking once and sweeps entries at the thirty-minute/twelve-hour boundary', () => {
        vi.useFakeTimers();
        vi.setSystemTime(20 * 60 * 60 * 1_000);
        const harness = makeStreamCreator();
        harness.model.setTuner([{ types: ['GR'] }]);
        harness.model.setTuner([{ types: ['BS'] }]);
        expect(harness.model.tuners).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(1);
        const sweepAt = Date.now() + 30 * 60 * 1_000;
        harness.model.tuners[0].programs.push(
            { reserve: makeReserve({ id: 31, endAt: sweepAt - 12 * 60 * 60 * 1_000 + 1 }), stream: null },
            { reserve: makeReserve({ id: 32, endAt: sweepAt - 12 * 60 * 60 * 1_000 }), stream: null },
        );
        vi.advanceTimersByTime(30 * 60 * 1_000);
        expect(harness.model.tuners[0].programs.map((entry: any) => entry.reserve.id)).toEqual([31]);
        vi.clearAllTimers();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[RE-3.7][RE-3.9][Task 3.3] performs the initial stream attempt plus three five-second retries for a reservation past its end time', async () => {
        vi.useFakeTimers();
        const reserve = makeReserve({ endAt: Date.now() - 1 });
        const harness = makeRecorder({
            streamCreator: {
                create: vi.fn(async () => Promise.reject(new Error('synthetic stream failure'))),
                changeEndAt: vi.fn(),
            },
        });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        await harness.model.prepRecord();
        expect(harness.streamCreator.create).toHaveBeenCalledOnce();
        for (let expected = 2; expected <= 4; expected++) {
            await vi.advanceTimersByTimeAsync(4_999);
            expect(harness.streamCreator.create).toHaveBeenCalledTimes(expected - 1);
            await vi.advanceTimersByTimeAsync(1);
            expect(harness.streamCreator.create).toHaveBeenCalledTimes(expected);
        }
        expect(harness.streamCreator.create).toHaveBeenCalledTimes(4);
        expect(harness.programDB.findId).toHaveBeenCalledTimes(4);
        expect(harness.reserveDB.findId).not.toHaveBeenCalled();
        expect(session.binding.removeTimeSpecifiedEnd).toHaveBeenCalledOnce();
        expect(session.state.phase).toBe('Completed');
        expect(harness.model.isPrepRecording).toBe(false);
        expect(harness.model.isRecording).toBe(false);
        expect(harness.model.abortController).toBeNull();
        expect(harness.model.retryTimerId).toBeNull();
        expect(harness.recordingEvent.emitPrepRecordingFailed).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(20_000);
        expect(harness.streamCreator.create).toHaveBeenCalledTimes(4);
    });

    it('[RE-3.7][RE-3.9][#724] keeps retrying a program reservation every five seconds until its end time', async () => {
        vi.useFakeTimers();
        const reserve = makeReserve({ endAt: Date.now() + 22_000 });
        const harness = makeRecorder({
            streamCreator: {
                create: vi.fn(async () => Promise.reject(new Error('synthetic stream failure'))),
                changeEndAt: vi.fn(),
            },
        });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        await harness.model.prepRecord();
        await vi.advanceTimersByTimeAsync(15_000);

        // 初回 + 3 回の再試行がすべて失敗しても、終了時刻前なら準備失敗にせず再試行を待つ。
        expect(harness.streamCreator.create).toHaveBeenCalledTimes(4);
        expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
        expect(session.state.phase).toBe('RetryWaiting');
        expect(harness.model.retryTimerId).not.toBeNull();

        await vi.advanceTimersByTimeAsync(4_999);
        expect(harness.streamCreator.create).toHaveBeenCalledTimes(4);
        await vi.advanceTimersByTimeAsync(1);
        expect(harness.streamCreator.create).toHaveBeenCalledTimes(5);
        expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
        expect(session.state.phase).toBe('RetryWaiting');

        // 6 回目の失敗は終了時刻の後なので、ここで初めて準備失敗にする。
        await vi.advanceTimersByTimeAsync(5_000);
        expect(harness.streamCreator.create).toHaveBeenCalledTimes(6);
        expect(harness.recordingEvent.emitPrepRecordingFailed).toHaveBeenCalledOnce();
        expect(session.binding.removeTimeSpecifiedEnd).toHaveBeenCalledOnce();
        expect(session.state.phase).toBe('Completed');
        expect(harness.model.isPrepRecording).toBe(false);
        expect(harness.model.retryTimerId).toBeNull();
        await vi.advanceTimersByTimeAsync(20_000);
        expect(harness.streamCreator.create).toHaveBeenCalledTimes(6);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[RE-3.7][#724] stops the extended program retry when the reservation is cancelled', async () => {
        vi.useFakeTimers();
        const reserve = makeReserve({ endAt: Date.now() + 600_000 });
        const harness = makeRecorder({
            streamCreator: {
                create: vi.fn(async () => Promise.reject(new Error('synthetic stream failure'))),
                changeEndAt: vi.fn(),
            },
        });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        await harness.model.prepRecord();
        await vi.advanceTimersByTimeAsync(40_000);
        expect(harness.streamCreator.create).toHaveBeenCalledTimes(9);
        expect(session.state.phase).toBe('RetryWaiting');

        const cancellation = harness.model.cancel(false);
        await vi.advanceTimersByTimeAsync(5_000);
        await cancellation;

        expect(session.state.phase).toBe('Cancelled');
        expect(harness.model.retryTimerId).toBeNull();
        expect(harness.model.retryAttempt).toBeNull();
        expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(harness.streamCreator.create).toHaveBeenCalledTimes(9);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[RE-3.7][RE-3.9][#724] follows an end time that changes while the program retry is waiting', async () => {
        vi.useFakeTimers();
        const reserve = makeReserve({ endAt: Date.now() + 22_000 });
        const harness = makeRecorder({
            streamCreator: {
                create: vi.fn(async () => Promise.reject(new Error('synthetic stream failure'))),
                changeEndAt: vi.fn(),
            },
        });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        await harness.model.prepRecord();
        await vi.advanceTimersByTimeAsync(15_000);
        expect(harness.streamCreator.create).toHaveBeenCalledTimes(4);

        // 終了時刻が延びたら、元の終了時刻を過ぎても再試行を続ける。
        await harness.model.update(makeReserve({ ...reserve, endAt: Date.now() + 40_000 }), false);
        await vi.advanceTimersByTimeAsync(25_000);
        expect(harness.streamCreator.create).toHaveBeenCalledTimes(9);
        expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
        expect(session.state.phase).toBe('RetryWaiting');

        // 終了時刻が縮んで過ぎたら、次の失敗で準備失敗にする。
        await harness.model.update(makeReserve({ ...reserve, endAt: Date.now() - 1 }), false);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(harness.streamCreator.create).toHaveBeenCalledTimes(10);
        expect(harness.recordingEvent.emitPrepRecordingFailed).toHaveBeenCalledOnce();
        expect(session.state.phase).toBe('Completed');
        expect(harness.model.retryTimerId).toBeNull();
        await vi.advanceTimersByTimeAsync(20_000);
        expect(harness.streamCreator.create).toHaveBeenCalledTimes(10);
    });

    it('[RE-3.7][RE-3.9][#724] keeps the four-attempt limit for a time-specified reservation', async () => {
        vi.useFakeTimers();
        const reserve = makeReserve({ programId: null, isTimeSpecified: true, endAt: Date.now() + 600_000 });
        const harness = makeRecorder({
            streamCreator: {
                create: vi.fn(async () => Promise.reject(new Error('synthetic stream failure'))),
                changeEndAt: vi.fn(),
            },
        });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        await harness.model.prepRecord();
        await vi.advanceTimersByTimeAsync(15_000);

        expect(harness.streamCreator.create).toHaveBeenCalledTimes(4);
        expect(harness.recordingEvent.emitPrepRecordingFailed).toHaveBeenCalledOnce();
        expect(session.state.phase).toBe('Completed');
        await vi.advanceTimersByTimeAsync(20_000);
        expect(harness.streamCreator.create).toHaveBeenCalledTimes(4);
    });

    describe('[RE-3.2][RE-3.7][RE-3.9] recording file path selection failure after the stream is acquired', () => {
        const pathFailure = (): Error => Object.assign(new Error('synthetic ENAMETOOLONG'), { code: 'ENAMETOOLONG' });

        it('retries a program reservation every five seconds and reports the failure once at the end time', async () => {
            vi.useFakeTimers();
            const reserve = makeReserve({ endAt: Date.now() + 22_000 });
            const harness = makeRecorder({
                recordingUtil: { getRecPath: vi.fn(async () => Promise.reject(pathFailure())) },
            });
            const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
            harness.model.reserve = reserve;
            harness.model.bindScheduleSession(session.binding);
            await harness.model.prepRecord();

            expect(logger.system.error).toHaveBeenCalledWith('preprec failed: 1');
            expect(session.state.phase).toBe('RetryWaiting');
            expect(harness.model.retryTimerId).not.toBeNull();
            expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
            expect(harness.model.isPrepRecording).toBe(true);
            expect(harness.model.isRecording).toBe(false);

            await vi.advanceTimersByTimeAsync(5_000);
            expect(harness.streamCreator.create).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(30_000);
            expect(harness.recordingEvent.emitPrepRecordingFailed).toHaveBeenCalledOnce();
            expect(session.state.phase).toBe('Completed');
            expect(harness.model.isPrepRecording).toBe(false);
            expect(harness.model.isRecording).toBe(false);
            const attempts = harness.streamCreator.create.mock.calls.length;
            await vi.advanceTimersByTimeAsync(20_000);
            expect(harness.streamCreator.create).toHaveBeenCalledTimes(attempts);
        });

        it('keeps the four-attempt limit for a time-specified reservation and reports the failure once', async () => {
            vi.useFakeTimers();
            const reserve = makeReserve({ programId: null, isTimeSpecified: true, endAt: Date.now() + 600_000 });
            const harness = makeRecorder({
                recordingUtil: { getRecPath: vi.fn(async () => Promise.reject(pathFailure())) },
            });
            const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
            harness.model.reserve = reserve;
            harness.model.bindScheduleSession(session.binding);
            await harness.model.prepRecord();
            await vi.advanceTimersByTimeAsync(15_000);

            expect(harness.streamCreator.create).toHaveBeenCalledTimes(4);
            expect(harness.recordingUtil.getRecPath).toHaveBeenCalledTimes(4);
            expect(harness.recordingEvent.emitPrepRecordingFailed).toHaveBeenCalledOnce();
            expect(session.state.phase).toBe('Completed');
            await vi.advanceTimersByTimeAsync(20_000);
            expect(harness.streamCreator.create).toHaveBeenCalledTimes(4);
        });
    });

    describe('[RE-3.18] preparation retry log', () => {
        const failedLogCount = (): number =>
            vi.mocked(logger.system.error).mock.calls.filter(([message]) => message === 'preprec failed: 1').length;
        const startLogCount = (): number =>
            vi.mocked(logger.system.info).mock.calls.filter(([message]) => message === 'preprec: 1').length;
        const makeFailingRecorder = (errors: Error[], extra: Record<string, any> = {}) => {
            let attempt = 0;
            return makeRecorder({
                streamCreator: {
                    create: vi.fn(async () => {
                        attempt += 1;
                        const failure = new Error(`synthetic stream failure ${attempt}`);
                        errors.push(failure);
                        return Promise.reject(failure);
                    }),
                    changeEndAt: vi.fn(),
                },
                ...extra,
            });
        };

        it('logs the first four failures one by one and then one summary per minute', async () => {
            vi.useFakeTimers();
            vi.mocked(logger.system.error).mockClear();
            vi.mocked(logger.system.info).mockClear();
            const errors: Error[] = [];
            const reserve = makeReserve({ endAt: Date.now() + 600_000 });
            const harness = makeFailingRecorder(errors);
            const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
            harness.model.reserve = reserve;
            harness.model.bindScheduleSession(session.binding);
            await harness.model.prepRecord();
            await vi.advanceTimersByTimeAsync(15_000);

            // 初回 + 3 回は従来どおり 1 回ごとに記録する。
            expect(harness.streamCreator.create).toHaveBeenCalledTimes(4);
            expect(failedLogCount()).toBe(4);
            expect(startLogCount()).toBe(4);
            const errorCallsAfterFour = vi.mocked(logger.system.error).mock.calls.length;

            // 5 回目以降の失敗は、1 分たつまで記録せず、再試行の開始も記録しない。
            await vi.advanceTimersByTimeAsync(59_999);
            expect(harness.streamCreator.create).toHaveBeenCalledTimes(15);
            expect(vi.mocked(logger.system.error).mock.calls.length).toBe(errorCallsAfterFour);
            expect(startLogCount()).toBe(4);

            // 直前の記録から 60,000 ms たった失敗で、回数と最後のエラーを 1 回にまとめる。
            await vi.advanceTimersByTimeAsync(1);
            expect(harness.streamCreator.create).toHaveBeenCalledTimes(16);
            expect(vi.mocked(logger.system.error).mock.calls.slice(errorCallsAfterFour)).toEqual([
                ['preprec failed: 1 (12 failures since the last log, 16 in total)'],
                [errors[15]],
            ]);

            // 次のまとめも 60 秒後に 1 回だけ書く。
            await vi.advanceTimersByTimeAsync(60_000);
            expect(harness.streamCreator.create).toHaveBeenCalledTimes(28);
            expect(vi.mocked(logger.system.error).mock.calls.slice(errorCallsAfterFour + 2)).toEqual([
                ['preprec failed: 1 (12 failures since the last log, 28 in total)'],
                [errors[27]],
            ]);
            expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
            expect(startLogCount()).toBe(4);

            harness.model.destroyStream();
            await harness.model.cancel(false);
            vi.clearAllTimers();
        });

        it('logs the unlogged failures before notifying the preparation failure at the end time', async () => {
            vi.useFakeTimers();
            vi.mocked(logger.system.error).mockClear();
            const errors: Error[] = [];
            const reserve = makeReserve({ endAt: Date.now() + 22_000 });
            const harness = makeFailingRecorder(errors);
            const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
            harness.model.reserve = reserve;
            harness.model.bindScheduleSession(session.binding);
            await harness.model.prepRecord();
            await vi.advanceTimersByTimeAsync(25_000);

            expect(harness.streamCreator.create).toHaveBeenCalledTimes(6);
            expect(harness.recordingEvent.emitPrepRecordingFailed).toHaveBeenCalledOnce();
            const summary = vi
                .mocked(logger.system.error)
                .mock.calls.findIndex(
                    ([message]) => message === 'preprec failed: 1 (2 failures since the last log, 6 in total)',
                );
            expect(summary).toBeGreaterThanOrEqual(0);
            expect(vi.mocked(logger.system.error).mock.calls[summary + 1]).toEqual([errors[5]]);
            expect(vi.mocked(logger.system.error).mock.invocationCallOrder[summary]).toBeLessThan(
                vi.mocked(harness.recordingEvent.emitPrepRecordingFailed).mock.invocationCallOrder[0],
            );
            expect(failedLogCount()).toBe(4);
        });

        it('logs the unlogged failures when the preparation finally succeeds', async () => {
            vi.useFakeTimers();
            vi.mocked(logger.system.error).mockClear();
            vi.mocked(logger.system.warn).mockClear();
            const errors: Error[] = [];
            const stream = new PassThrough();
            let attempt = 0;
            const harness = makeRecorder({
                streamCreator: {
                    create: vi.fn(async () => {
                        attempt += 1;
                        if (attempt <= 6) {
                            const failure = new Error(`synthetic stream failure ${attempt}`);
                            errors.push(failure);
                            return Promise.reject(failure);
                        }
                        return stream;
                    }),
                    changeEndAt: vi.fn(),
                },
            });
            harness.model.reserve = makeReserve({ endAt: Date.now() + 600_000 });
            harness.model.doRecord = vi.fn(async () => undefined);
            await harness.model.prepRecord();
            await vi.advanceTimersByTimeAsync(30_000);

            expect(harness.streamCreator.create).toHaveBeenCalledTimes(7);
            expect(harness.model.doRecord).toHaveBeenCalledOnce();
            expect(failedLogCount()).toBe(4);
            expect(vi.mocked(logger.system.warn).mock.calls).toEqual([
                ['preprec recovered: 1 (2 failures since the last log, 6 in total)'],
                [errors[5]],
            ]);
            await vi.advanceTimersByTimeAsync(120_000);
            expect(vi.mocked(logger.system.warn)).toHaveBeenCalledTimes(2);
            stream.destroy();
        });

        it('logs the unlogged failures when the reservation is cancelled while the retry is waiting', async () => {
            vi.useFakeTimers();
            vi.mocked(logger.system.error).mockClear();
            vi.mocked(logger.system.warn).mockClear();
            const errors: Error[] = [];
            const reserve = makeReserve({ endAt: Date.now() + 600_000 });
            const harness = makeFailingRecorder(errors);
            const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
            harness.model.reserve = reserve;
            harness.model.bindScheduleSession(session.binding);
            await harness.model.prepRecord();
            await vi.advanceTimersByTimeAsync(25_000);
            expect(harness.streamCreator.create).toHaveBeenCalledTimes(6);
            expect(vi.mocked(logger.system.warn)).not.toHaveBeenCalled();

            const cancellation = harness.model.cancel(false);
            await vi.advanceTimersByTimeAsync(5_000);
            await cancellation;

            expect(session.state.phase).toBe('Cancelled');
            expect(vi.mocked(logger.system.warn).mock.calls).toEqual([
                ['preprec canceled: 1 (2 failures since the last log, 6 in total)'],
                [errors[5]],
            ]);
            await vi.advanceTimersByTimeAsync(120_000);
            expect(vi.mocked(logger.system.warn)).toHaveBeenCalledTimes(2);
            expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
        });

        it('writes no summary on success or cancellation when every failure has already been logged', async () => {
            vi.useFakeTimers();
            vi.mocked(logger.system.error).mockClear();
            vi.mocked(logger.system.warn).mockClear();
            const stream = new PassThrough();
            let attempt = 0;
            const makeRecorderFailingFourTimes = () => {
                attempt = 0;
                return makeRecorder({
                    streamCreator: {
                        create: vi.fn(async () => {
                            attempt += 1;
                            if (attempt <= 4) return Promise.reject(new Error(`synthetic stream failure ${attempt}`));
                            return stream;
                        }),
                        changeEndAt: vi.fn(),
                    },
                });
            };

            // 4 回目の失敗までは 1 回ごとに記録済みなので、5 回目で成功してもまとめは書かない。
            const recovered = makeRecorderFailingFourTimes();
            recovered.model.reserve = makeReserve({ endAt: Date.now() + 600_000 });
            recovered.model.doRecord = vi.fn(async () => undefined);
            await recovered.model.prepRecord();
            await vi.advanceTimersByTimeAsync(20_000);
            expect(recovered.streamCreator.create).toHaveBeenCalledTimes(5);
            expect(recovered.model.doRecord).toHaveBeenCalledOnce();
            expect(vi.mocked(logger.system.warn)).not.toHaveBeenCalled();
            expect(failedLogCount()).toBe(4);

            // 4 回目の失敗の後の再試行待ちで取り消しても、まとめは書かない。
            vi.mocked(logger.system.error).mockClear();
            const cancelled = makeRecorderFailingFourTimes();
            cancelled.model.reserve = makeReserve({ endAt: Date.now() + 600_000 });
            await cancelled.model.prepRecord();
            await vi.advanceTimersByTimeAsync(15_000);
            expect(cancelled.streamCreator.create).toHaveBeenCalledTimes(4);
            const cancellation = cancelled.model.cancel(false);
            await vi.advanceTimersByTimeAsync(5_000);
            await cancellation;
            expect(vi.mocked(logger.system.warn)).not.toHaveBeenCalled();
            expect(failedLogCount()).toBe(4);
            stream.destroy();
        });

        it('does not carry the held failures over to the next preparation after the session is replaced', async () => {
            vi.useFakeTimers();
            vi.mocked(logger.system.error).mockClear();
            vi.mocked(logger.system.warn).mockClear();
            const stream = new PassThrough();
            let attempt = 0;
            const reserve = makeReserve({ endAt: Date.now() + 600_000 });
            const harness = makeRecorder({
                streamCreator: {
                    create: vi.fn(async () => {
                        attempt += 1;
                        if (attempt <= 6) return Promise.reject(new Error(`synthetic stream failure ${attempt}`));
                        return stream;
                    }),
                    changeEndAt: vi.fn(),
                },
            });
            const original = makeRecordingSessionBinding(reserve, {
                generation: 1n,
                phase: 'Preparing',
                sessionToken: 11n,
            });
            harness.model.reserve = reserve;
            harness.model.doRecord = vi.fn(async () => undefined);
            harness.model.bindScheduleSession(original.binding);
            await harness.model.prepRecord();
            await vi.advanceTimersByTimeAsync(25_000);
            expect(harness.streamCreator.create).toHaveBeenCalledTimes(6);

            // 再試行待ちの session が別の session に置き換わり、未記録の 2 件は書かれずに終わる。
            original.state.current = false;
            const replacement = makeRecordingSessionBinding(reserve, {
                generation: 2n,
                phase: 'Preparing',
                sessionToken: 12n,
            });
            harness.model.bindScheduleSession(replacement.binding);
            await harness.model.startPreparation();

            // 次の準備は attempt 0 で成功するので、前の準備の失敗をまとめた log は出ない。
            expect(harness.streamCreator.create).toHaveBeenCalledTimes(7);
            expect(harness.model.doRecord).toHaveBeenCalledOnce();
            expect(vi.mocked(logger.system.warn)).not.toHaveBeenCalled();
            stream.destroy();
            vi.clearAllTimers();
        });

        it('starts aggregating from the first failure when the attempt number is already past the fourth', async () => {
            vi.useFakeTimers();
            vi.mocked(logger.system.error).mockClear();
            const errors: Error[] = [];
            const reserve = makeReserve({ endAt: Date.now() + 600_000 });
            const harness = makeFailingRecorder(errors);
            const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
            harness.model.reserve = reserve;
            harness.model.bindScheduleSession(session.binding);
            await harness.model.prepRecord(4);

            expect(failedLogCount()).toBe(0);
            expect(vi.mocked(logger.system.error)).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(60_000);
            expect(vi.mocked(logger.system.error).mock.calls).toEqual([
                ['preprec failed: 1 (13 failures since the last log, 17 in total)'],
                [errors[12]],
            ]);

            harness.model.destroyStream();
            await harness.model.cancel(false);
            vi.clearAllTimers();
        });

        it('keeps logging every failure of a time-specified reservation', async () => {
            vi.useFakeTimers();
            vi.mocked(logger.system.error).mockClear();
            const reserve = makeReserve({ programId: null, isTimeSpecified: true, endAt: Date.now() + 600_000 });
            const harness = makeFailingRecorder([]);
            const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
            harness.model.reserve = reserve;
            harness.model.bindScheduleSession(session.binding);
            await harness.model.prepRecord();
            await vi.advanceTimersByTimeAsync(15_000);

            expect(harness.recordingEvent.emitPrepRecordingFailed).toHaveBeenCalledOnce();
            expect(failedLogCount()).toBe(4);
            expect(
                vi
                    .mocked(logger.system.error)
                    .mock.calls.some(([message]) => String(message).includes('since the last log')),
            ).toBe(false);
        });
    });

    it('[Task 3.3] stops retrying after the first successful later attempt and rechecks persistence', async () => {
        vi.useFakeTimers();
        const stream = new PassThrough();
        const harness = makeRecorder({
            streamCreator: {
                create: vi
                    .fn()
                    .mockRejectedValueOnce(new Error('synthetic first attempt'))
                    .mockRejectedValueOnce(new Error('synthetic second attempt'))
                    .mockResolvedValueOnce(stream),
                changeEndAt: vi.fn(),
            },
        });
        harness.model.reserve = makeReserve();
        harness.model.doRecord = vi.fn(async () => undefined);
        await harness.model.prepRecord();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(harness.streamCreator.create).toHaveBeenCalledTimes(3);
        expect(harness.reserveDB.findId).toHaveBeenCalledOnce();
        expect(harness.model.doRecord).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(20_000);
        expect(harness.streamCreator.create).toHaveBeenCalledTimes(3);
    });

    it('[Task 3.3] cancels a legacy retry wait without a schedule binding', async () => {
        vi.useFakeTimers();
        const harness = makeRecorder({
            streamCreator: {
                create: vi.fn(async () => Promise.reject(new Error('synthetic legacy retry-wait failure'))),
                changeEndAt: vi.fn(),
            },
        });
        harness.model.reserve = makeReserve();

        await harness.model.prepRecord();
        expect(harness.streamCreator.create).toHaveBeenCalledOnce();
        const cancellation = harness.model.cancel(false);
        await vi.advanceTimersByTimeAsync(5_000);
        await cancellation;

        expect(harness.streamCreator.create).toHaveBeenCalledOnce();
        expect(harness.recordingEvent.emitCancelPrepRecording).toHaveBeenCalledOnce();
        expect(harness.model.retryAttempt).toBeNull();
        expect(harness.model.retryTimerId).toBeNull();
        await vi.advanceTimersByTimeAsync(20_000);
        expect(harness.streamCreator.create).toHaveBeenCalledOnce();
    });

    it('[RE-3.8][Task 3.3] rejects an already-ended time-specified reservation before opening a service stream', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(10_000);
        const harness = makeStreamCreator();
        harness.model.setTuner([{ types: ['GR'] }]);
        await expect(
            harness.model.create(makeReserve({ programId: null, isTimeSpecified: true, endAt: 9_999 })),
        ).rejects.toThrow('TimeSpecifiedStreamTimeoutError');
        expect(harness.tunerServerAccess.openServiceStream).not.toHaveBeenCalled();
    });

    it.each([
        ['equals', 10_000],
        ['follows', 10_001],
    ])('[RE-3.8][Task 3.3] opens the service stream when the time-specified end time %s now', async (_case, endAt) => {
        vi.useFakeTimers();
        vi.setSystemTime(10_000);
        const harness = makeStreamCreator();
        harness.model.setTuner([{ types: ['GR'] }]);

        await expect(
            harness.model.create(makeReserve({ programId: null, isTimeSpecified: true, startAt: 9_000, endAt })),
        ).resolves.toBeDefined();
        expect(harness.tunerServerAccess.openServiceStream).toHaveBeenCalledOnce();
    });

    it('[Task 3.3] stops reopening a time-specified stream after its end passes during retry wait', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const creator = makeStreamCreator({
            tunerServerAccess: {
                openServiceStream: vi.fn(async () => Promise.reject(new Error('synthetic first stream failure'))),
            },
        });
        const harness = makeRecorder({ streamCreator: creator.model });
        harness.model.reserve = makeReserve({
            id: 25,
            programId: null,
            isTimeSpecified: true,
            startAt: 1_000_000,
            endAt: 1_004_000,
        });
        await harness.model.prepRecord();
        expect(creator.tunerServerAccess.openServiceStream).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(15_000);
        expect(creator.tunerServerAccess.openServiceStream).toHaveBeenCalledOnce();
        expect(harness.recordingEvent.emitPrepRecordingFailed).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 3.6] aggregates drop counters and skips the port when no drop log exists', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        await harness.model.updateDropFileLog();
        expect(harness.dropChecker.getResult).not.toHaveBeenCalled();

        harness.model.dropLogFileId = 41;
        harness.dropChecker.getResult.mockResolvedValue({
            100: { error: 1, drop: 2, scrambling: 3 },
            200: { error: 4, drop: 5, scrambling: 6 },
        });
        await harness.model.updateDropFileLog();
        expect(harness.dropLogFileDB.updateCnt).toHaveBeenCalledWith({
            id: 41,
            errorCnt: 5,
            dropCnt: 7,
            scramblingCnt: 9,
        });
    });

    it('[Task 3.6] stops the checker after result failure and contains log-update failure', async () => {
        const resultFailure = makeRecorder();
        resultFailure.model.reserve = makeReserve();
        resultFailure.model.dropLogFileId = 41;
        resultFailure.dropChecker.getResult.mockRejectedValue(new Error('synthetic drop result failure'));
        await resultFailure.model.updateDropFileLog();
        expect(resultFailure.dropChecker.stop).toHaveBeenCalledOnce();
        expect(resultFailure.dropLogFileDB.updateCnt).not.toHaveBeenCalled();

        const updateFailure = makeRecorder();
        updateFailure.model.reserve = makeReserve();
        updateFailure.model.dropLogFileId = 41;
        updateFailure.dropChecker.getResult.mockResolvedValue({ 100: { error: 1, drop: 2, scrambling: 3 } });
        updateFailure.dropLogFileDB.updateCnt.mockRejectedValue(new Error('synthetic drop update failure'));
        await expect(updateFailure.model.updateDropFileLog()).resolves.toBeUndefined();
        expect(logger.system.error).toHaveBeenCalledWith('update drop cnt error: 41');
    });

    it('[RE-3.2][Task 3.2] decides the parent directory, channel, program name, and file name for the recording', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-decision-'));
        const model = makePathSelector(root, {
            recordedFormat: '%CHNAME%-%TITLE%',
            channelFindId: vi.fn(async () => ({
                name: 'synthetic-channel-name',
                halfWidthName: 'synthetic-half',
                serviceId: 7,
                channelType: 'GR',
                channel: '27',
            })),
            findChannelIdAndTime: vi.fn(async () => ({ name: 'synthetic-timed-program' })),
        });
        try {
            await expect(
                model.getRecPath(makeReserve({ programId: null, isTimeSpecified: true }), false),
            ).resolves.toMatchObject({
                parendDir: { name: 'synthetic-root', path: root },
                subDir: '',
                fileName: 'synthetic-channel-name-synthetic-timed-program.ts',
                fullPath: join(root, 'synthetic-channel-name-synthetic-timed-program.ts'),
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[RE-3.10][Task 3.6] starts drop, error, and scrambling aggregation on the recording stream only when drop checking is enabled', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-drop-start-'));
        const started: ReturnType<typeof makeRecorder>[] = [];
        try {
            for (const [isEnabledDropCheck, startFails] of [
                [true, false],
                [false, false],
                [true, true],
            ] as const) {
                const stream = new PassThrough();
                const fullPath = join(root, `synthetic-${isEnabledDropCheck}-${startFails}.ts`);
                const startFailure = new Error('synthetic drop checker start failure');
                // 準備は stream を止めて待ち、録画 file への pipe と同じ tick で attach する。
                const ledger: string[] = [];
                let sameTickAsPipe = false;
                const harness = makeRecorder({
                    config: { isEnabledDropCheck },
                    dropChecker: {
                        prepare: vi.fn(async () => {
                            ledger.push(stream.isPaused() ? 'prepare-paused' : 'prepare-not-paused');
                            if (startFails) throw startFailure;
                        }),
                        attach: vi.fn(() => {
                            ledger.push(sameTickAsPipe ? 'attach-same-tick' : 'attach-later');
                        }),
                        stop: vi.fn(async () => undefined),
                        getFilePath: vi.fn(() => null),
                        getResult: vi.fn(async () => ({})),
                    },
                    recordingUtil: {
                        getRecPath: vi.fn(async () => ({
                            parendDir: { name: 'synthetic-root', path: root },
                            subDir: '',
                            fileName: `synthetic-${isEnabledDropCheck}-${startFails}.ts`,
                            fullPath,
                        })),
                    },
                });
                started.push(harness);
                vi.mocked(logger.system.error).mockClear();
                harness.model.reserve = makeReserve();
                harness.model.stream = stream;
                const originalPipe = stream.pipe.bind(stream);
                vi.spyOn(stream, 'pipe').mockImplementation(((destination: any, options?: any) => {
                    ledger.push('pipe');
                    sameTickAsPipe = true;
                    queueMicrotask(() => (sameTickAsPipe = false));
                    return originalPipe(destination, options);
                }) as any);
                const recording = harness.model.doRecord();
                await new Promise(resolve => setImmediate(resolve));
                stream.write('synthetic-data');
                await recording;
                expect(harness.dropChecker.prepare).toHaveBeenCalledTimes(isEnabledDropCheck ? 1 : 0);
                if (isEnabledDropCheck) {
                    expect(harness.dropChecker.prepare).toHaveBeenCalledWith('/synthetic-drop', fullPath);
                }
                // 有効なとき: 準備（stream は止まっている）→ 録画 file への pipe → 同じ tick の attach。準備に失敗したら attach しない。
                // 無効なとき: 準備も attach もせず、pipe だけを行う。
                expect(harness.dropChecker.attach).toHaveBeenCalledTimes(isEnabledDropCheck && !startFails ? 1 : 0);
                if (isEnabledDropCheck && !startFails) {
                    expect(harness.dropChecker.attach).toHaveBeenCalledWith(fullPath, stream);
                    expect(ledger).toEqual(['prepare-paused', 'pipe', 'attach-same-tick']);
                } else if (isEnabledDropCheck) {
                    expect(ledger).toEqual(['prepare-paused', 'pipe']);
                } else {
                    expect(ledger).toEqual(['pipe']);
                }
                // A failing start is recorded locally: the recording itself still starts and no drop log is registered.
                if (startFails) {
                    expect(logger.system.error).toHaveBeenCalledWith(startFailure);
                } else {
                    expect(logger.system.error).not.toHaveBeenCalled();
                }
                expect(harness.dropLogFileDB.insertOnce).not.toHaveBeenCalled();
                expect(harness.model.stream).toBe(stream);
            }
        } finally {
            for (const harness of started) {
                harness.model.isCanceledCallingFinished = true;
                harness.model.destroyStream();
            }
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[RE-3.11][Task 4.1] acquires the path-selection execution right at priority one with a five-second wait before selecting', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-priority-'));
        const ledger: string[] = [];
        const execution = {
            getExecution: vi.fn(async () => (ledger.push('acquire'), 71)),
            unLockExecution: vi.fn(),
        };
        const model = makePathSelector(root, {
            execution,
            channelFindId: vi.fn(async () => (ledger.push('select'), null)),
        });
        try {
            await model.getRecPath(makeReserve(), false);
            expect(execution.getExecution).toHaveBeenCalledWith(1, 5_000);
            expect(ledger).toEqual(['acquire', 'select']);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[RE-3.12][Task 4.1] checks the program, channel, file name, and existing files in order while holding the execution right', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-read-order-'));
        await writeFile(join(root, 'synthetic.ts'), 'existing recording', 'utf8');
        const ledger: string[] = [];
        const execution = {
            getExecution: vi.fn(async () => (ledger.push('acquire'), 72)),
            unLockExecution: vi.fn(() => ledger.push('release')),
        };
        const model = makePathSelector(root, {
            execution,
            findChannelIdAndTime: vi.fn(async () => (ledger.push('program'), null)),
            channelFindId: vi.fn(async () => (ledger.push('channel'), null)),
        });
        try {
            const selected = await model.getRecPath(makeReserve({ programId: null, isTimeSpecified: true }), false);
            expect(selected.fileName).toBe('synthetic(1).ts');
            expect(ledger).toEqual(['acquire', 'program', 'channel', 'release']);

            // While one selection holds the execution right, another selection through the same manager waits.
            const shared = new ExecutionManagementModel({ getLogger: () => logger });
            const firstChannel = deferred<null>();
            const firstChannelFindId = vi.fn(() => firstChannel.promise);
            const secondChannelFindId = vi.fn(async () => null);
            const first = makePathSelector(root, { execution: shared, channelFindId: firstChannelFindId });
            const second = makePathSelector(root, { execution: shared, channelFindId: secondChannelFindId });
            const pendingFirst = first.getRecPath(makeReserve(), false);
            await vi.waitFor(() => expect(firstChannelFindId).toHaveBeenCalledOnce());
            const pendingSecond = second.getRecPath(makeReserve(), false);
            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setImmediate(resolve));
            expect(secondChannelFindId).not.toHaveBeenCalled();
            firstChannel.resolve(null);
            await pendingFirst;
            await pendingSecond;
            expect(secondChannelFindId).toHaveBeenCalledOnce();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[RE-3.13][Task 4.1] fails the path selection without reading anything when the execution right is not acquired within five seconds', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-lock-timeout-'));
        const failure = new Error('synthetic execution lock timeout');
        const execution = { getExecution: vi.fn(async () => Promise.reject(failure)), unLockExecution: vi.fn() };
        const channelFindId = vi.fn(async () => null);
        const model = makePathSelector(root, { execution, channelFindId });
        try {
            await expect(model.getRecPath(makeReserve(), false)).rejects.toBe(failure);
            expect(execution.getExecution).toHaveBeenCalledWith(1, 5_000);
            expect(channelFindId).not.toHaveBeenCalled();
            expect(execution.unLockExecution).not.toHaveBeenCalled();

            // With the real manager, a request that waited five seconds behind another owner fails and is
            // never granted the right afterwards.
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            const shared = new ExecutionManagementModel({ getLogger: () => logger });
            const owner = await shared.getExecution(1, 600_000);
            const lateChannelFindId = vi.fn(async () => null);
            const late = makePathSelector(root, { execution: shared, channelFindId: lateChannelFindId });
            const lateResult = late.getRecPath(makeReserve(), false).then(
                () => 'selected',
                (error: Error) => error,
            );
            await vi.advanceTimersByTimeAsync(4_999);
            expect(lateChannelFindId).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(await lateResult).toBeInstanceOf(Error);
            shared.unLockExecution(owner);
            await vi.advanceTimersByTimeAsync(0);
            expect(lateChannelFindId).not.toHaveBeenCalled();
            const next = await shared.getExecution(1, 5_000);
            expect(next).not.toBe(owner);
            shared.unLockExecution(next);
        } finally {
            vi.useRealTimers();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[RE-3.14][Task 4.1] releases the execution right only after the path selection settles, on success and on failure', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-release-'));
        const blocker = join(root, 'not-a-directory');
        await writeFile(blocker, 'synthetic', 'utf8');
        const channel = deferred<null>();
        const ledger: string[] = [];
        const execution = {
            getExecution: vi.fn(async () => 73),
            unLockExecution: vi.fn(() => ledger.push('release')),
        };
        const success = makePathSelector(root, {
            execution,
            channelFindId: vi.fn(() => (ledger.push('channel'), channel.promise)),
        });
        const failing = makePathSelector(blocker, { execution });
        try {
            const pending = success.getRecPath(makeReserve(), false);
            await new Promise(resolve => setImmediate(resolve));
            expect(ledger).toEqual(['channel']);
            channel.resolve(null);
            await pending;
            expect(ledger).toEqual(['channel', 'release']);

            await expect(failing.getRecPath(makeReserve({ directory: 'child' }), false)).rejects.toMatchObject({
                code: 'ENOTDIR',
            });
            expect(execution.unLockExecution).toHaveBeenCalledTimes(2);
            expect(execution.unLockExecution).toHaveBeenLastCalledWith(73);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[RE-3.15][Task 4.3] reserves a new file name without overwriting an existing recording while holding the execution right', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-no-clobber-'));
        const existing = join(root, 'synthetic.ts');
        await writeFile(existing, 'existing recording', 'utf8');
        const ledger: string[] = [];
        const execution = {
            getExecution: vi.fn(async () => (ledger.push('acquire'), 74)),
            unLockExecution: vi.fn(() => ledger.push('release')),
        };
        const model = makePathSelector(root, { execution });
        try {
            const selected = await model.getRecPath(makeReserve(), false, true);
            ledger.push('selected');
            try {
                expect(selected.fileName).toBe('synthetic(1).ts');
                expect(selected.fullPath).toBe(join(root, 'synthetic(1).ts'));
                expect(await stat(selected.fullPath)).toMatchObject({ size: 0 });
                expect(await readFile(existing, 'utf8')).toBe('existing recording');
                expect(ledger).toEqual(['acquire', 'release', 'selected']);
            } finally {
                await selected.fileHandle?.close();
            }
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    describe('[RE-3.19] sub directory outside the recording directory', () => {
        // root の兄弟 directory `escaped` は、保存先の外へ出た場合にだけ作られる
        const withRoot = async (
            run: (context: { escaped: string; escapedName: string; root: string }) => Promise<void>,
        ): Promise<void> => {
            const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-sub-directory-'));
            const escapedName = `escaped-${basename(root)}`;
            const escaped = join(root, '..', escapedName);
            try {
                await run({ escaped, escapedName, root });
            } finally {
                await rm(root, { recursive: true, force: true });
                await rm(escaped, { recursive: true, force: true });
            }
        };

        const select = async (root: string, overrides: Record<string, unknown>) => {
            vi.mocked(logger.system.warn).mockClear();
            const reserve = makeReserve(overrides);
            const selected = await makePathSelector(root).getRecPath(reserve, false, true);
            await selected.fileHandle?.close();
            return { reserve, selected };
        };

        it.each([
            ['relative ..', (name: string) => ({ directory: `../${name}` })],
            ['.. after a leading separator', (name: string) => ({ directory: `/../${name}` })],
            ['.. that leaves after descending', (name: string) => ({ directory: `a/../../${name}` })],
            ['a NUL character', () => ({ directory: 'synthetic\0directory' })],
            ['a program name that expands to ..', (name: string) => ({ directory: '%TITLE%', name: `../${name}` })],
        ])(
            'saves directly under the selected parent directory and logs it when the directory has %s',
            async (_case, makeOverrides) => {
                await withRoot(async ({ escaped, escapedName, root }) => {
                    const overrides = makeOverrides(escapedName);
                    const { reserve, selected } = await select(root, overrides);

                    expect(selected.subDir).toBe('');
                    expect(selected.fileName).toBe('synthetic.ts');
                    expect(selected.fullPath).toBe(join(root, 'synthetic.ts'));
                    expect(await stat(selected.fullPath)).toMatchObject({ size: 0 });
                    await expect(stat(escaped)).rejects.toMatchObject({ code: 'ENOENT' });
                    expect(logger.system.warn).toHaveBeenCalledExactlyOnceWith(
                        expect.stringContaining(`reserveId: ${reserve.id}`),
                    );
                });
            },
        );

        it('logs the expanded directory that was not used', async () => {
            await withRoot(async ({ root }) => {
                await select(root, { directory: '%TITLE%', name: '../x' });

                expect(logger.system.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('directory: ../x'));
            });
        });

        it.each([
            ['a/../b', ['b', 'synthetic.ts']],
            ['/anime', ['anime', 'synthetic.ts']],
            ['a/b', ['a', 'b', 'synthetic.ts']],
        ])('keeps using %s, which stays inside the recording directory', async (directory, segments) => {
            await withRoot(async ({ root }) => {
                const { selected } = await select(root, { directory });

                expect(selected.subDir).toBe(directory);
                expect(selected.fullPath).toBe(join(root, ...segments));
                expect(await stat(selected.fullPath)).toMatchObject({ size: 0 });
                expect(logger.system.warn).not.toHaveBeenCalled();
            });
        });

        it('does not look at the sub directory when the temporary directory is used', async () => {
            await withRoot(async ({ root }) => {
                const tmp = join(root, 'tmp');
                await mkdir(tmp);
                vi.mocked(logger.system.warn).mockClear();
                const model = new RecordingUtilModel(
                    { getLogger: () => logger },
                    {
                        getConfig: () => ({
                            recorded: [{ name: 'synthetic-root', path: root }],
                            recordedTmp: tmp,
                            recordedFormat: 'synthetic',
                            recordedFileExtension: '.ts',
                        }),
                    },
                    { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
                    { findId: vi.fn(async () => null) },
                    { findChannelIdAndTime: vi.fn(async () => null) },
                    {},
                    {},
                );

                const selected = await model.getRecPath(makeReserve({ directory: '../outside' }), true);

                expect(selected.subDir).toBe('');
                expect(selected.fullPath).toBe(join(tmp, 'synthetic.ts'));
                expect(logger.system.warn).not.toHaveBeenCalled();
            });
        });
    });
});
