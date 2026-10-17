import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushImmediate, makeRecorder, makeRecordingSessionBinding, makeReserve } from './_harness';

let root = '';

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'epgstation-recorder-cancel-cleanup-'));
});

afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
});

const until = async (predicate: () => boolean): Promise<void> => {
    for (let i = 0; i < 2_000 && !predicate(); i += 1) await flushImmediate();
    if (!predicate()) throw new Error('the awaited condition was not reached');
};

/** drop 検査の偽物。ログの path は method の戻り値で返す（object literal の key にしない）。 */
class FakeDropChecker {
    public prepare = vi.fn(async () => undefined);
    public attach = vi.fn();
    public stop = vi.fn(async () => undefined);
    public getResult = vi.fn(async () => ({}));

    public getFilePath(): string {
        return 'synthetic-drop.log';
    }
}

const makeWriter = (): Writable =>
    new Writable({
        write(_chunk, _encoding, callback) {
            callback();
        },
    });

describe('[RE-9.2] recorder cancel event releases the schedule session', () => {
    const emitCancel = (phase: string, isPlanToDelete: boolean) => {
        const harness = makeRecorder();
        const reservation = makeReserve({ id: 71 });
        const session = makeRecordingSessionBinding(reservation, { phase });
        harness.model.reserve = reservation;
        harness.model.scheduleBinding = session.binding;
        harness.model.isPlanToDelete = isPlanToDelete;

        harness.model.emitCancelEvent();

        return session;
    };

    it.each([
        'Waiting',
        'Preparing',
        'RetryWaiting',
        'Recording',
        'AwaitingFirstData',
        'Registering',
        'RegistrationOverdue',
    ])('moves a session in the %s phase to Cancelled', phase => {
        const session = emitCancel(phase, false);

        expect(session.state.phase).toBe('Cancelled');
    });

    it('leaves the session phase alone when the recording is planned for deletion', () => {
        const session = emitCancel('Recording', true);

        expect(session.state.phase).toBe('Recording');
        expect(session.binding.tryTransition).not.toHaveBeenCalled();
    });
});

describe('[RE-9.2] recorder acquired stream cleanup', () => {
    it('stops the held resources when no stream was acquired and none is held', () => {
        const harness = makeRecorder();
        harness.model.stream = null;
        harness.model.destroyStream = vi.fn();

        harness.model.destroyAcquiredStream(null);

        expect(harness.model.destroyStream).toHaveBeenCalledTimes(1);
    });

    it('delegates to the normal stream teardown while the acquired stream is still the held stream', () => {
        const harness = makeRecorder();
        const stream = new PassThrough();
        harness.model.stream = stream;
        harness.model.destroyStream = vi.fn();

        harness.model.destroyAcquiredStream(stream);

        expect(harness.model.destroyStream).toHaveBeenCalledTimes(1);
        expect(stream.destroyed).toBe(false);
        stream.destroy();
    });

    it('tears down only the acquired stream and hands its termination to the deletion latch when it was replaced', () => {
        const harness = makeRecorder();
        const newer = new PassThrough();
        const acquired = new PassThrough();
        acquired.on('data', () => undefined);
        const observe = vi.fn();
        harness.model.stream = newer;
        harness.model.deletionStop = { latch: { observe } };
        const unpipe = vi.spyOn(acquired, 'unpipe');
        const push = vi.spyOn(acquired, 'push');

        harness.model.destroyAcquiredStream(acquired);

        expect(observe).toHaveBeenCalledTimes(1);
        expect(unpipe).toHaveBeenCalledTimes(1);
        expect(push).toHaveBeenCalledWith(null);
        expect(acquired.destroyed).toBe(true);
        expect(acquired.listenerCount('data')).toBe(0);
        expect(newer.destroyed).toBe(false);
        expect(harness.model.stream).toBe(newer);
        newer.destroy();
    });

    it('leaves an already destroyed acquired stream alone when it was replaced', () => {
        const harness = makeRecorder();
        const newer = new PassThrough();
        const acquired = new PassThrough();
        acquired.destroy();
        const observe = vi.fn();
        harness.model.stream = newer;
        harness.model.deletionStop = { latch: { observe } };

        harness.model.destroyAcquiredStream(acquired);

        expect(observe).not.toHaveBeenCalled();
        newer.destroy();
    });
});

describe('[RE-9.2] recorder termination tracking', () => {
    it('hands an open stream to the deletion latch instead of the finalization continuations', () => {
        const harness = makeRecorder();
        const stream = new PassThrough();
        const observe = vi.fn();
        harness.model.deletionStop = { latch: { observe } };
        harness.model.trackFinalizationContinuation = vi.fn();

        harness.model.observeStreamTermination(stream);

        expect(observe).toHaveBeenCalledTimes(1);
        expect(harness.model.trackFinalizationContinuation).not.toHaveBeenCalled();
        stream.destroy();
    });

    it('tracks an open stream as a finalization continuation when no deletion is running', () => {
        const harness = makeRecorder();
        const stream = new PassThrough();
        harness.model.trackFinalizationContinuation = vi.fn();

        harness.model.observeStreamTermination(stream);

        expect(harness.model.trackFinalizationContinuation).toHaveBeenCalledTimes(1);
        stream.destroy();
    });

    it('does not track a missing stream', () => {
        const harness = makeRecorder();
        harness.model.trackFinalizationContinuation = vi.fn();

        harness.model.observeStreamTermination(null);

        expect(harness.model.trackFinalizationContinuation).not.toHaveBeenCalled();
    });

    it('does not track a stream that already ended', async () => {
        const harness = makeRecorder();
        const stream = new PassThrough();
        stream.resume();
        stream.end();
        await once(stream, 'end');
        harness.model.trackFinalizationContinuation = vi.fn();

        harness.model.observeStreamTermination(stream);

        expect(harness.model.trackFinalizationContinuation).not.toHaveBeenCalled();
    });

    it('hands an open writer to the deletion latch instead of the finalization continuations', () => {
        const harness = makeRecorder();
        const writer = makeWriter();
        const observe = vi.fn();
        harness.model.deletionStop = { latch: { observe } };
        harness.model.trackFinalizationContinuation = vi.fn();

        harness.model.observeWriterTermination(writer);

        expect(observe).toHaveBeenCalledTimes(1);
        expect(harness.model.trackFinalizationContinuation).not.toHaveBeenCalled();
        expect(harness.model.recFileCloseTerminal).toBeInstanceOf(Promise);
        writer.destroy();
    });

    it('tracks an open writer as a finalization continuation when no deletion is running', () => {
        const harness = makeRecorder();
        const writer = makeWriter();
        harness.model.trackFinalizationContinuation = vi.fn();

        harness.model.observeWriterTermination(writer);

        expect(harness.model.trackFinalizationContinuation).toHaveBeenCalledTimes(1);
        writer.destroy();
    });

    it('does not track a missing writer and keeps the earlier close promise', () => {
        const harness = makeRecorder();
        const earlier = Promise.resolve();
        harness.model.recFileCloseTerminal = earlier;
        harness.model.trackFinalizationContinuation = vi.fn();

        harness.model.observeWriterTermination(null);

        expect(harness.model.trackFinalizationContinuation).not.toHaveBeenCalled();
        expect(harness.model.recFileCloseTerminal).toBe(earlier);
    });

    it('does not track a writer that is already closed', async () => {
        const harness = makeRecorder();
        const writer = makeWriter();
        writer.destroy();
        await once(writer, 'close');
        harness.model.trackFinalizationContinuation = vi.fn();

        harness.model.observeWriterTermination(writer);

        expect(harness.model.trackFinalizationContinuation).not.toHaveBeenCalled();
    });
});

describe('[RE-9.2] recorder stream teardown options', () => {
    it('unpipes the stream by default and skips the unpipe when asked not to', () => {
        const harness = makeRecorder();
        const first = new PassThrough();
        const second = new PassThrough();
        const firstUnpipe = vi.spyOn(first, 'unpipe');
        const secondUnpipe = vi.spyOn(second, 'unpipe');

        harness.model.stream = first;
        harness.model.destroyStream();
        harness.model.stream = second;
        harness.model.destroyStream(false);

        expect(firstUnpipe).toHaveBeenCalledTimes(1);
        expect(secondUnpipe).not.toHaveBeenCalled();
        expect(first.destroyed).toBe(true);
        expect(second.destroyed).toBe(true);
        expect(harness.model.stream).toBeNull();
    });

    it('does not stop the drop checker when the caller keeps it running', () => {
        const harness = makeRecorder();
        harness.model.stream = new PassThrough();
        harness.model.stopDropChecker = vi.fn(() => null);

        harness.model.destroyStream(true, false);

        expect(harness.model.stopDropChecker).not.toHaveBeenCalled();
    });

    it('stops the drop checker by default', () => {
        const harness = makeRecorder();
        harness.model.stream = new PassThrough();
        harness.model.stopDropChecker = vi.fn(() => null);

        harness.model.destroyStream();

        expect(harness.model.stopDropChecker).toHaveBeenCalledTimes(1);
    });

    it('hands the drop checker stop to the deletion latch when a deletion is running', () => {
        const harness = makeRecorder();
        const dropStop = Promise.resolve();
        const observe = vi.fn();
        harness.model.stream = new PassThrough();
        harness.model.deletionStop = { latch: { observe } };
        harness.model.stopDropChecker = vi.fn(() => dropStop);
        harness.model.trackFinalizationContinuation = vi.fn();

        harness.model.destroyStream();

        expect(observe).toHaveBeenCalledWith(dropStop);
        expect(harness.model.trackFinalizationContinuation).not.toHaveBeenCalledWith(dropStop);
    });

    it('tracks the drop checker stop as a finalization continuation when no deletion is running', () => {
        const harness = makeRecorder();
        const dropStop = Promise.resolve();
        harness.model.stream = new PassThrough();
        harness.model.stopDropChecker = vi.fn(() => dropStop);
        harness.model.trackFinalizationContinuation = vi.fn();

        harness.model.destroyStream();

        expect(harness.model.trackFinalizationContinuation).toHaveBeenCalledWith(dropStop);
    });
});

describe('[RE-9.2] recorder file start in doRecord', () => {
    const prepare = (overrides: Record<string, any> = {}, recPathExtra: Record<string, any> = {}) => {
        const fullPath = join(root, 'synthetic.ts');
        const harness = makeRecorder({
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'synthetic.ts',
                    fullPath,
                    ...recPathExtra,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            ...overrides,
        });
        harness.model.reserve = makeReserve();
        return { fullPath, harness };
    };

    const finish = async (harness: ReturnType<typeof makeRecorder>, started: Promise<void>): Promise<void> => {
        harness.model.cancelFirstDataWait();
        await started;
        harness.model.isCanceledCallingFinished = true;
        harness.model.destroyStream();
        await harness.model.recFileCloseTerminal;
    };

    it('stops without touching a file it does not own when the stream was destroyed before the file was chosen', async () => {
        const { fullPath, harness } = prepare();
        await writeFile(fullPath, 'owned by another recording');
        const stream = new PassThrough();
        stream.destroy();
        harness.model.stream = stream;
        harness.model.emitCancelEvent = vi.fn();

        await harness.model.doRecord();

        expect(existsSync(fullPath)).toBe(true);
        expect(harness.model.stream).toBeNull();
        expect(harness.model.emitCancelEvent).not.toHaveBeenCalled();
        expect(harness.model.recFile).toBeNull();
    });

    it('closes and removes the file it opened when the stream was destroyed before recording started', async () => {
        const fullPath = join(root, 'synthetic.ts');
        const fileHandle = await open(fullPath, 'wx');
        const { harness } = prepare({}, { fileHandle });
        const stream = new PassThrough();
        stream.destroy();
        harness.model.stream = stream;
        harness.model.emitCancelEvent = vi.fn();

        await harness.model.doRecord();

        expect(existsSync(fullPath)).toBe(false);
        expect(harness.model.emitCancelEvent).not.toHaveBeenCalled();
    });

    it('announces the cancellation when preparation was stopped while the file was being chosen', async () => {
        const { fullPath, harness } = prepare();
        harness.model.recordingUtil.getRecPath.mockImplementation(async () => {
            harness.model.isStopPrepRec = true;
            return { parendDir: { name: 'synthetic-root', path: root }, subDir: '', fileName: 'x.ts', fullPath };
        });
        harness.model.stream = new PassThrough();
        harness.model.emitCancelEvent = vi.fn();

        await harness.model.doRecord();

        expect(harness.model.emitCancelEvent).toHaveBeenCalledTimes(1);
        expect(existsSync(fullPath)).toBe(false);
        expect(harness.model.stream).toBeNull();
    });

    it.each(['path', 'fileHandle'] as const)('uses a 1 MiB real writer for the %s path', async pathKind => {
        const fullPath = join(root, 'synthetic.ts');
        const fileHandle = pathKind === 'fileHandle' ? await open(fullPath, 'wx') : undefined;
        const { harness } = prepare({}, fileHandle === undefined ? {} : { fileHandle });
        const stream = new PassThrough();
        harness.model.stream = stream;

        const started = harness.model.doRecord();
        await until(() => harness.model.firstDataWait !== null);
        const writer = harness.model.recFile;
        if (writer.pending) await once(writer, 'open');
        expect(writer.writableHighWaterMark).toBe(1024 * 1024);
        expect(existsSync(fullPath)).toBe(true);
        await finish(harness, started);
    });

    it('releases the opened writer and its error listeners when the stream cannot be piped into it', async () => {
        const writer = makeWriter();
        const fileHandle = { createWriteStream: vi.fn(() => writer), close: vi.fn(async () => undefined) };
        const { harness } = prepare({}, { fileHandle });
        const stream = new PassThrough();
        stream.pipe = (() => {
            throw new Error('synthetic-pipe-failure');
        }) as any;
        harness.model.stream = stream;

        await expect(harness.model.doRecord()).rejects.toThrow('synthetic-pipe-failure');

        expect(harness.model.recFile).toBeNull();
        expect(fileHandle.createWriteStream).toHaveBeenCalledWith({ highWaterMark: 1024 * 1024 });
        expect(writer.destroyed).toBe(true);
        // 破棄の最中に遅れて届く error を吸収する listener だけが残る
        expect(writer.listenerCount('error')).toBe(1);
        stream.destroy();
    });

    it('removes the unstarted file when the writer fails after the first data gate opened', async () => {
        const { fullPath, harness } = prepare();
        const stream = new PassThrough();
        harness.model.stream = stream;
        const recFailed = vi.fn(async () => undefined);
        harness.model.recFailed = recFailed;

        const started = harness.model.doRecord();
        await until(() => harness.model.firstDataWait !== null);
        const writer = harness.model.recFile;
        if (writer.pending) await once(writer, 'open');
        expect(existsSync(fullPath)).toBe(true);
        harness.model.cancelFirstDataWait();
        await started;

        writer.emit('error', new Error('synthetic-write-failure'));
        await until(() => recFailed.mock.calls.length > 0);

        expect(existsSync(fullPath)).toBe(false);
        expect(harness.model.isCanceledCallingFinished).toBe(true);
        stream.destroy();
    });

    it('marks the drop checker active once it is attached and records its log file', async () => {
        const dropChecker = new FakeDropChecker();
        const { harness } = prepare({ config: { isEnabledDropCheck: true, dropLog: root }, dropChecker });
        harness.model.stream = new PassThrough();
        harness.model.dropCheckerStopLifetime = Promise.resolve();

        const started = harness.model.doRecord();
        await until(() => harness.model.firstDataWait !== null);

        expect(dropChecker.attach).toHaveBeenCalledTimes(1);
        expect(harness.model.isDropCheckerActive).toBe(true);
        expect(harness.model.dropCheckerStopLifetime).toBeNull();
        expect(harness.model.dropLogFileId).toBe(41);
        await finish(harness, started);
    });

    it('forgets an earlier drop log file id when registering the new drop log file fails', async () => {
        const dropChecker = new FakeDropChecker();
        const dropLogFileDB = {
            deleteOnce: vi.fn(async () => true),
            insertOnce: vi.fn(async () => {
                throw new Error('synthetic-db-failure');
            }),
            updateCnt: vi.fn(async () => undefined),
        };
        const { harness } = prepare({
            config: { isEnabledDropCheck: true, dropLog: root },
            dropChecker,
            dropLogFileDB,
        });
        harness.model.stream = new PassThrough();
        harness.model.dropLogFileId = 99;

        const started = harness.model.doRecord();
        await until(() => harness.model.firstDataWait !== null);

        expect(dropLogFileDB.insertOnce).toHaveBeenCalledTimes(1);
        expect(harness.model.dropLogFileId).toBeNull();
        await finish(harness, started);
    });

    it('stops the stream and resolves when the bound session is gone before the first data wait', async () => {
        const { harness } = prepare();
        const stream = new PassThrough();
        harness.model.stream = stream;
        const { binding } = makeRecordingSessionBinding(makeReserve(), { phase: 'Recording' });
        harness.model.scheduleBinding = null;

        await expect(harness.model.doRecord(binding)).resolves.toBeUndefined();

        expect(harness.model.stream).toBeNull();
        expect(stream.destroyed).toBe(true);
        expect(binding.tryTransition).not.toHaveBeenCalled();
        await harness.model.recFileCloseTerminal;
    });
});
