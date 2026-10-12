import { EventEmitter } from 'node:events';
import { mkdtemp, open, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    deferred,
    flushImmediate,
    load,
    logger,
    makeRecorder,
    makeRecordingSessionBinding,
    makeReserve,
} from './_harness';

const FileUtil = load<{ unlink(filePath: string): Promise<void> }>('util', 'FileUtil.js');
const nodeRequire = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT!;

const waitUntil = async (condition: () => boolean | Promise<boolean>, description: string): Promise<void> => {
    for (let turn = 0; turn < 100; turn += 1) {
        if (await condition()) return;
        await flushImmediate();
    }
    throw new Error(`Timed out waiting for ${description}`);
};

const fileExists = async (filePath: string): Promise<boolean> => {
    try {
        await stat(filePath);
        return true;
    } catch {
        return false;
    }
};

afterEach(() => vi.useRealTimers());

describe('recorder phase compatibility', () => {
    const beginRealRegistration = async (
        harness: ReturnType<typeof makeRecorder>,
        session: ReturnType<typeof makeRecordingSessionBinding>,
        stream: PassThrough,
        fullPath: string,
    ): Promise<{ preparation: Promise<void> }> => {
        harness.model.reserve = session.binding.reservation;
        harness.model.bindScheduleSession(session.binding);
        const preparation = harness.model.startPreparation();
        await waitUntil(
            () => session.state.phase === 'AwaitingFirstData' && harness.model.recFile !== null,
            'the real first-data listener',
        );
        await waitUntil(() => fileExists(fullPath), 'the real recording file');
        stream.write(Buffer.from('synthetic first packet'));
        await waitUntil(() => session.state.phase === 'Registering', 'the real registration phase');
        return { preparation };
    };

    const expectNoNormalRecordingCompletion = (harness: ReturnType<typeof makeRecorder>): void => {
        expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        expect(harness.recordingEvent.emitFinishRecording).not.toHaveBeenCalled();
        expect(harness.recordingEvent.emitRecordingFailed).not.toHaveBeenCalled();
        expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
        expect(harness.recordedDB.removeRecording).not.toHaveBeenCalled();
        expect(harness.recordedHistoryDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.streamCreator.create).toHaveBeenCalledOnce();
        expect(harness.model.retryAttempt).toBeNull();
        expect(harness.model.retryTimerId).toBeNull();
    };

    const makePendingWriter = () => {
        const writer = new EventEmitter() as EventEmitter & {
            closed: boolean;
            end: ReturnType<typeof vi.fn>;
        };
        writer.closed = false;
        writer.end = vi.fn();
        return writer;
    };

    const makePendingStream = () => {
        const pendingStream = new EventEmitter() as EventEmitter & {
            closed: boolean;
            readableEnded: boolean;
            destroy: ReturnType<typeof vi.fn>;
            push: ReturnType<typeof vi.fn>;
            unpipe: ReturnType<typeof vi.fn>;
        };
        pendingStream.closed = false;
        pendingStream.readableEnded = false;
        pendingStream.destroy = vi.fn();
        pendingStream.push = vi.fn();
        pendingStream.unpipe = vi.fn();
        return pendingStream;
    };

    it('[Task 5.3][RE-4.7] moves the same session to one retry after video-file registration rejection', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-registration-retry-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        const harness = makeRecorder({
            recordedDB: {
                insertOnce: vi.fn(async () => 21),
                deleteOnce: vi.fn(async () => undefined),
                removeRecording: vi.fn(async () => undefined),
                findId: vi.fn(),
                updateOnce: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'synthetic.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
            videoFileDB: { insertOnce: vi.fn(async () => Promise.reject(new Error('synthetic video-file rejection'))) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        try {
            const preparation = harness.model.startPreparation();
            // Wall-clock wait: the 100×setImmediate waitUntil budget flakes under coverage
            // load (Timed out waiting for the registration failure retry @ ~17ms).
            await vi.waitFor(() => {
                expect(session.state.phase).toBe('AwaitingFirstData');
                expect(harness.model.recFile).not.toBeNull();
            });
            stream.write('synthetic first packet');
            await vi.waitFor(() => {
                expect(session.state.phase).toBe('RetryWaiting');
            });
            await preparation;

            expect(harness.model.retryAttempt).toBe(1);
            expect(harness.model.retryTimerId).not.toBeNull();
            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });

            stream.write('synthetic late packet');
            await flushImmediate();
            expect(harness.videoFileDB.insertOnce).toHaveBeenCalledOnce();
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        } finally {
            await harness.model.cancel(false);
            stream.destroy();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 5.3][RE-4.8] keeps a replacement generation inert when an old registration rejects late', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-registration-stale-reject-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const rejection = deferred<number>();
        const reserve = makeReserve();
        const original = makeRecordingSessionBinding(reserve, { generation: 1n, phase: 'Preparing', sessionToken: 7n });
        const replacement = makeRecordingSessionBinding(reserve, {
            generation: 2n,
            phase: 'Preparing',
            sessionToken: 7n,
        });
        const harness = makeRecorder({
            recordedDB: {
                insertOnce: vi.fn(async () => 21),
                deleteOnce: vi.fn(async () => undefined),
                removeRecording: vi.fn(async () => undefined),
                findId: vi.fn(),
                updateOnce: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'synthetic.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
            videoFileDB: { insertOnce: vi.fn(() => rejection.promise) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(original.binding);
        try {
            const preparation = harness.model.startPreparation();
            await waitUntil(() => original.state.phase === 'AwaitingFirstData', 'the old first-data gate');
            stream.write('synthetic first packet');
            await waitUntil(() => original.state.phase === 'Registering', 'the old registration phase');
            await waitUntil(() => harness.videoFileDB.insertOnce.mock.calls.length === 1, 'the old VideoFile insert');

            original.state.current = false;
            harness.model.bindScheduleSession(replacement.binding);
            rejection.reject(new Error('synthetic stale registration rejection'));
            await preparation;

            expect(replacement.state.phase).toBe('Preparing');
            expect(harness.model.retryAttempt).toBeNull();
            expect(harness.model.retryTimerId).toBeNull();
            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await harness.model.cancel(false);
            stream.destroy();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 5.3][RE-4.8] isolates replacement resources when an old registration rejects late', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-registration-stale-resources-'));
        const fullPath = join(root, 'old-synthetic.ts');
        const replacementPath = join(root, 'replacement-synthetic.ts');
        const stream = new PassThrough();
        const rejection = deferred<number>();
        const reserve = makeReserve();
        const original = makeRecordingSessionBinding(reserve, { generation: 1n, phase: 'Preparing', sessionToken: 7n });
        const replacement = makeRecordingSessionBinding(reserve, {
            generation: 2n,
            phase: 'Preparing',
            sessionToken: 7n,
        });
        const harness = makeRecorder({
            recordedDB: {
                insertOnce: vi.fn(async () => 21),
                deleteOnce: vi.fn(async () => undefined),
                removeRecording: vi.fn(async () => undefined),
                findId: vi.fn(),
                updateOnce: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'old-synthetic.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
            videoFileDB: { insertOnce: vi.fn(() => rejection.promise) },
        });
        const replacementStream = new PassThrough();
        const replacementWriter = new PassThrough();
        const replacementFirstDataWait = { cancel: vi.fn() };
        const replacementDataListener = vi.fn();
        const retryTimer = setTimeout(() => undefined, 5_000);
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(original.binding);
        try {
            const preparation = harness.model.startPreparation();
            await waitUntil(() => original.state.phase === 'AwaitingFirstData', 'the old first-data gate');
            stream.write('synthetic first packet');
            await waitUntil(() => original.state.phase === 'Registering', 'the old registration phase');
            await waitUntil(() => harness.videoFileDB.insertOnce.mock.calls.length === 1, 'the old VideoFile insert');

            original.state.current = false;
            harness.model.bindScheduleSession(replacement.binding);
            replacementStream.on('data', replacementDataListener);
            harness.model.stream = replacementStream;
            harness.model.recFile = replacementWriter;
            harness.model.firstDataWait = replacementFirstDataWait;
            harness.model.isRecording = true;
            harness.model.isPrepRecording = false;
            harness.model.isPlanToDelete = false;
            harness.model.recordedId = 99;
            harness.model.videoFileId = 199;
            harness.model.videoFileFulPath = replacementPath;
            harness.model.retryAttempt = 2;
            harness.model.retryTimerId = retryTimer;

            rejection.reject(new Error('synthetic stale registration rejection'));
            await preparation;

            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
            expect(harness.model.stream).toBe(replacementStream);
            expect(replacementStream.destroyed).toBe(false);
            expect(replacementStream.listenerCount('data')).toBe(1);
            expect(harness.model.recFile).toBe(replacementWriter);
            expect(replacementWriter.writableEnded).toBe(false);
            expect(harness.model.firstDataWait).toBe(replacementFirstDataWait);
            expect(replacementFirstDataWait.cancel).not.toHaveBeenCalled();
            expect(replacement.state.phase).toBe('Preparing');
            expect(harness.model.isRecording).toBe(true);
            expect(harness.model.isPrepRecording).toBe(false);
            expect(harness.model.isPlanToDelete).toBe(false);
            expect(harness.model.recordedId).toBe(99);
            expect(harness.model.videoFileId).toBe(199);
            expect(harness.model.videoFileFulPath).toBe(replacementPath);
            expect(harness.model.retryAttempt).toBe(2);
            expect(harness.model.retryTimerId).toBe(retryTimer);
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        } finally {
            clearTimeout(retryTimer);
            replacementStream.destroy();
            replacementWriter.destroy();
            stream.destroy();
            await rm(root, { recursive: true, force: true });
        }
    });

    // The 600_000 (600s) advances to `RegistrationOverdue` in this and the later [RE-4.9] cases
    // below are RecorderModel.REGISTRATION_OWNER_WATCHDOG_TIMEOUT_MS
    // (src/model/operator/recording/RecorderModel.ts:35), a v3-only registration owner watchdog
    // with no v2 counterpart -- approved in
    // .kiro/specs/server-recording-execution/design.md (5.1 recording session state, 5.5 cancellation bounds,
    // 5.6 overdue operation intent and late settlement) and requirements.md 4.7-4.9.
    it('[Task 5.5][RE-4.9] returns a registration rejection after the deadline through the existing one-retry path', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-registration-overdue-retry-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const videoInsert = deferred<number>();
        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        const harness = makeRecorder({
            recordedDB: {
                insertOnce: vi.fn(async () => 21),
                deleteOnce: vi.fn(async () => undefined),
                removeRecording: vi.fn(async () => undefined),
                findId: vi.fn(),
                updateOnce: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'synthetic.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
            videoFileDB: { insertOnce: vi.fn(() => videoInsert.promise) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);

        const preparation = harness.model.startPreparation();
        try {
            await vi.waitFor(() => expect(session.state.phase).toBe('AwaitingFirstData'));
            stream.write('synthetic first packet');
            for (let turn = 0; turn < 5 && harness.videoFileDB.insertOnce.mock.calls.length === 0; turn += 1) {
                await Promise.resolve();
            }
            expect(harness.videoFileDB.insertOnce).toHaveBeenCalledOnce();

            await vi.advanceTimersByTimeAsync(600_000);
            expect(session.state.phase).toBe('RegistrationOverdue');
            expect(harness.model.retryTimerId).toBeNull();

            videoInsert.reject(new Error('synthetic late video registration rejection'));
            await preparation;

            expect(session.state.phase).toBe('RetryWaiting');
            expect(harness.model.retryAttempt).toBe(1);
            expect(harness.model.retryTimerId).not.toBeNull();
            expect(harness.videoFileDB.insertOnce).toHaveBeenCalledOnce();
            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            videoInsert.reject(new Error('synthetic late video registration cleanup'));
            await preparation.catch(() => undefined);
            await harness.model.cancel(false);
            stream.destroy();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 5.5][RE-4.9] keeps a replacement session isolated from a late successful registration', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-registration-overdue-replacement-'));
        const fullPath = join(root, 'old.ts');
        const replacementPath = join(root, 'replacement.ts');
        const stream = new PassThrough();
        const videoInsert = deferred<number>();
        const reserve = makeReserve();
        const original = makeRecordingSessionBinding(reserve, { generation: 1n, phase: 'Recording', sessionToken: 7n });
        const replacement = makeRecordingSessionBinding(reserve, {
            generation: 2n,
            phase: 'Preparing',
            sessionToken: 7n,
        });
        const harness = makeRecorder({
            recordedDB: {
                deleteOnce: vi.fn(async () => undefined),
                insertOnce: vi.fn(async () => 21),
                removeRecording: vi.fn(async () => undefined),
                findId: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'old.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            videoFileDB: { deleteOnce: vi.fn(async () => undefined), insertOnce: vi.fn(() => videoInsert.promise) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(original.binding);
        harness.model.stream = stream;
        harness.model.setEndProcess = vi.fn();
        harness.model.setEventRelayTimer = vi.fn();

        const started = harness.model.doRecord();
        try {
            await vi.waitFor(() => expect(harness.model.recFile).not.toBeNull());
            stream.write('synthetic first packet');
            for (let turn = 0; turn < 5 && harness.videoFileDB.insertOnce.mock.calls.length === 0; turn += 1) {
                await Promise.resolve();
            }
            await vi.advanceTimersByTimeAsync(600_000);
            expect(original.state.phase).toBe('RegistrationOverdue');

            const replacementStream = new PassThrough();
            const replacementWriter = new PassThrough();
            const replacementFirstDataWait = { cancel: vi.fn() };
            const replacementDataListener = vi.fn();
            original.state.current = false;
            harness.model.bindScheduleSession(replacement.binding);
            replacementStream.on('data', replacementDataListener);
            harness.model.stream = replacementStream;
            harness.model.recFile = replacementWriter;
            harness.model.firstDataWait = replacementFirstDataWait;
            harness.model.recordedId = 99;
            harness.model.videoFileId = 199;
            harness.model.videoFileFulPath = replacementPath;

            videoInsert.resolve(31);
            await started;

            expect(replacement.state.phase).toBe('Preparing');
            expect(stream.destroyed).toBe(true);
            expect(replacementStream.destroyed).toBe(false);
            expect(replacementStream.listenerCount('data')).toBe(1);
            expect(replacementWriter.writableEnded).toBe(false);
            expect(replacementFirstDataWait.cancel).not.toHaveBeenCalled();
            expect(harness.model.recordedId).toBe(99);
            expect(harness.model.videoFileId).toBe(199);
            expect(harness.model.videoFileFulPath).toBe(replacementPath);
            expect(harness.videoFileDB.insertOnce).toHaveBeenCalledOnce();
            expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(31);
            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });

            replacementWriter.destroy();
            replacementStream.destroy();
        } finally {
            videoInsert.resolve(31);
            await started.catch(() => undefined);
            stream.destroy();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 5.5][RE-4.9] keeps a cancelled registration under the owner watchdog until its original DB rejection settles', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-registration-overdue-cancel-'));
        const fullPath = join(root, 'cancelled.ts');
        const stream = new PassThrough();
        const videoInsert = deferred<number>();
        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        const harness = makeRecorder({
            recordedDB: {
                deleteOnce: vi.fn(async () => undefined),
                insertOnce: vi.fn(async () => 21),
                removeRecording: vi.fn(async () => undefined),
                findId: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'cancelled.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            videoFileDB: { deleteOnce: vi.fn(async () => undefined), insertOnce: vi.fn(() => videoInsert.promise) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.stream = stream;

        const started = harness.model.doRecord();
        try {
            await vi.waitFor(() => expect(harness.model.recFile).not.toBeNull());
            stream.write('synthetic first packet');
            for (let turn = 0; turn < 5 && harness.videoFileDB.insertOnce.mock.calls.length === 0; turn += 1) {
                await Promise.resolve();
            }
            await vi.advanceTimersByTimeAsync(599_999);
            expect(session.state.phase).toBe('Registering');

            await harness.model.cancel(false);
            expect(session.state.phase).toBe('Registering');
            expect(harness.videoFileDB.deleteOnce).not.toHaveBeenCalled();
            expect(harness.recordedDB.deleteOnce).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1);
            expect(session.state.phase).toBe('RegistrationOverdue');

            videoInsert.reject(new Error('synthetic cancelled registration rejection'));
            await started;

            expect(harness.videoFileDB.insertOnce).toHaveBeenCalledOnce();
            expect(harness.videoFileDB.deleteOnce).not.toHaveBeenCalled();
            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
            expect(session.state.phase).toBe('Cancelled');
            expect(harness.model.retryAttempt).toBeNull();
            expect(harness.model.retryTimerId).toBeNull();
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            videoInsert.resolve(31);
            await started.catch(() => undefined);
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 5.5][RE-4.9] settles a cancelled pre-deadline registration rejection from Registering', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-registration-pre-deadline-cancel-'));
        const fullPath = join(root, 'pre-deadline-cancelled.ts');
        const stream = new PassThrough();
        const videoInsert = deferred<number>();
        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        const harness = makeRecorder({
            recordedDB: {
                deleteOnce: vi.fn(async () => undefined),
                insertOnce: vi.fn(async () => 21),
                removeRecording: vi.fn(async () => undefined),
                findId: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'pre-deadline-cancelled.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            videoFileDB: { insertOnce: vi.fn(() => videoInsert.promise) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.stream = stream;

        const started = harness.model.doRecord();
        try {
            await vi.waitFor(() => expect(harness.model.recFile).not.toBeNull());
            stream.write('synthetic first packet');
            for (let turn = 0; turn < 5 && harness.videoFileDB.insertOnce.mock.calls.length === 0; turn += 1) {
                await Promise.resolve();
            }
            await vi.advanceTimersByTimeAsync(599_999);
            await harness.model.cancel(false);
            expect(session.state.phase).toBe('Registering');

            videoInsert.reject(new Error('synthetic pre-deadline cancellation rejection'));
            await started;

            expect(session.state.phase).toBe('Cancelled');
            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        } finally {
            videoInsert.resolve(31);
            await started.catch(() => undefined);
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await rm(root, { recursive: true, force: true });
        }
    });

    // `cleanupUnstartedRecFile` strips recFile's 'error' listener and destroys it during
    // registration-cancel cleanup on this same RE-4.9 path. In production the destroyed writer is a
    // real fs.WriteStream whose in-flight low-level write completion can arrive after that teardown
    // and surface as an 'error' with zero listeners. This case makes that late-arrival
    // deterministic by driving the identical public-API path with a controllable writer (the
    // established fileHandle.createWriteStream() fake from the case above) and manually emitting
    // the late completion only after cleanup has fully settled, instead of depending on real fs
    // timing.
    it('[Task 5.5][RE-4.9] absorbs a late write-completion error on a writer already destroyed by registration-cancel cleanup', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-registration-cancel-late-completion-'));
        const fullPath = join(root, 'late-completion.ts');
        const stream = new PassThrough();
        const recFileFake = new PassThrough();
        const videoInsert = deferred<number>();
        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        const harness = makeRecorder({
            recordedDB: {
                deleteOnce: vi.fn(async () => undefined),
                insertOnce: vi.fn(async () => 21),
                removeRecording: vi.fn(async () => undefined),
                findId: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    fileHandle: {
                        close: vi.fn(async () => undefined),
                        createWriteStream: vi.fn(() => recFileFake),
                    },
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'late-completion.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            videoFileDB: { insertOnce: vi.fn(() => videoInsert.promise) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.stream = stream;

        const started = harness.model.doRecord();
        try {
            await vi.waitFor(() => expect(harness.model.recFile).not.toBeNull());
            stream.write('synthetic first packet');
            for (let turn = 0; turn < 5 && harness.videoFileDB.insertOnce.mock.calls.length === 0; turn += 1) {
                await Promise.resolve();
            }
            await vi.advanceTimersByTimeAsync(599_999);
            await harness.model.cancel(false);
            expect(session.state.phase).toBe('Registering');

            videoInsert.reject(new Error('synthetic pre-deadline cancellation rejection'));
            await started;

            // By this point cleanupUnstartedRecFile has already stripped recFileFake's 'error'
            // listener and destroyed it (awaited above via `started`), matching the real race window.
            expect(session.state.phase).toBe('Cancelled');
            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();

            expect(() =>
                recFileFake.emit('error', new Error('synthetic late write-completion after teardown destroy')),
            ).not.toThrow();
        } finally {
            videoInsert.resolve(31);
            await started.catch(() => undefined);
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 5.5][RE-4.9] retains cancellation ownership when the same session is rebound as a new binding object', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-registration-overdue-rebind-'));
        const fullPath = join(root, 'rebound.ts');
        const stream = new PassThrough();
        const videoInsert = deferred<number>();
        const reserve = makeReserve();
        const original = makeRecordingSessionBinding(reserve, { generation: 1n, phase: 'Recording', sessionToken: 7n });
        const rebound = makeRecordingSessionBinding(reserve, {
            generation: 1n,
            phase: 'RegistrationOverdue',
            sessionToken: 7n,
        });
        const afterSettlement = makeRecordingSessionBinding(reserve, {
            generation: 1n,
            phase: 'Registering',
            sessionToken: 7n,
        });
        const harness = makeRecorder({
            recordedDB: {
                deleteOnce: vi.fn(async () => undefined),
                insertOnce: vi.fn(async () => 21),
                removeRecording: vi.fn(async () => undefined),
                findId: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'rebound.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            videoFileDB: { deleteOnce: vi.fn(async () => undefined), insertOnce: vi.fn(() => videoInsert.promise) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(original.binding);
        harness.model.stream = stream;

        const started = harness.model.doRecord();
        try {
            await vi.waitFor(() => expect(harness.model.recFile).not.toBeNull());
            stream.write('synthetic first packet');
            for (let turn = 0; turn < 5 && harness.videoFileDB.insertOnce.mock.calls.length === 0; turn += 1) {
                await Promise.resolve();
            }
            await vi.advanceTimersByTimeAsync(600_000);
            expect(original.state.phase).toBe('RegistrationOverdue');

            original.state.current = false;
            harness.model.bindScheduleSession(rebound.binding);
            const cancellationStream = new PassThrough();
            const cancellationWriter = new PassThrough();
            stream.unpipe();
            harness.model.stream = cancellationStream;
            harness.model.recFile = cancellationWriter;
            await harness.model.cancel(false);
            expect(rebound.state.phase).toBe('RegistrationOverdue');

            videoInsert.resolve(31);
            await started;

            expect(rebound.state.phase).toBe('Cancelled');
            expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(31);
            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            expect(stream.destroyed).toBe(false);

            rebound.state.current = false;
            harness.model.bindScheduleSession(afterSettlement.binding);
            await harness.model.cancel(false);
            expect(afterSettlement.state.phase).toBe('Cancelled');
        } finally {
            videoInsert.resolve(31);
            await started.catch(() => undefined);
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 5.5][RE-4.9] does not retain an old owner for any replacement session identity field', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-registration-overdue-replacement-owner-'));
        const fullPath = join(root, 'replacement-owner.ts');
        const stream = new PassThrough();
        const originalWriter = new PassThrough();
        const videoInsert = deferred<number>();
        const reserve = makeReserve();
        const original = makeRecordingSessionBinding(reserve, { generation: 1n, phase: 'Recording', sessionToken: 7n });
        const reservationReplacement = makeRecordingSessionBinding(makeReserve({ id: 2 }), {
            generation: 1n,
            phase: 'Registering',
            sessionToken: 7n,
        });
        const generationReplacement = makeRecordingSessionBinding(reserve, {
            generation: 2n,
            phase: 'Registering',
            sessionToken: 7n,
        });
        const tokenReplacement = makeRecordingSessionBinding(reserve, {
            generation: 1n,
            phase: 'Registering',
            sessionToken: 8n,
        });
        const harness = makeRecorder({
            recordedDB: {
                deleteOnce: vi.fn(async () => undefined),
                insertOnce: vi.fn(async () => 21),
                removeRecording: vi.fn(async () => undefined),
                findId: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    fileHandle: {
                        close: vi.fn(async () => undefined),
                        createWriteStream: vi.fn(() => originalWriter),
                    },
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'replacement-owner.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            videoFileDB: { deleteOnce: vi.fn(async () => undefined), insertOnce: vi.fn(() => videoInsert.promise) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(original.binding);
        harness.model.stream = stream;

        const started = harness.model.doRecord();
        try {
            await vi.waitFor(() => expect(harness.model.recFile).not.toBeNull());
            stream.write('synthetic first packet');
            for (let turn = 0; turn < 5 && harness.videoFileDB.insertOnce.mock.calls.length === 0; turn += 1) {
                await Promise.resolve();
            }

            stream.unpipe();
            original.state.current = false;
            const replacementStream = new PassThrough();
            const replacementWriter = new PassThrough();
            harness.model.stream = replacementStream;
            harness.model.recFile = replacementWriter;

            harness.model.bindScheduleSession(reservationReplacement.binding);
            await harness.model.cancel(false);
            expect(reservationReplacement.state.phase).toBe('Cancelled');

            reservationReplacement.state.current = false;
            harness.model.bindScheduleSession(generationReplacement.binding);
            await harness.model.cancel(false);
            expect(generationReplacement.state.phase).toBe('Cancelled');

            generationReplacement.state.current = false;
            harness.model.bindScheduleSession(tokenReplacement.binding);
            await harness.model.cancel(false);
            expect(tokenReplacement.state.phase).toBe('Cancelled');

            videoInsert.resolve(31);
            await started;

            expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(31);
            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            replacementStream.destroy();
            replacementWriter.destroy();
        } finally {
            videoInsert.resolve(31);
            await started.catch(() => undefined);
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 5.5][RE-4.9] keeps deletion pending until the overdue registration and its cleanup are terminal', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-registration-overdue-delete-'));
        const fullPath = join(root, 'deleted.ts');
        const stream = new PassThrough();
        const videoInsert = deferred<number>();
        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        const harness = makeRecorder({
            recordedDB: {
                deleteOnce: vi.fn(async () => undefined),
                insertOnce: vi.fn(async () => 21),
                removeRecording: vi.fn(async () => undefined),
                findId: vi.fn(),
                updateOnce: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'deleted.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
            videoFileDB: { deleteOnce: vi.fn(async () => undefined), insertOnce: vi.fn(() => videoInsert.promise) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);

        const preparation = harness.model.startPreparation();
        try {
            await vi.waitFor(() => expect(session.state.phase).toBe('AwaitingFirstData'));
            stream.write('synthetic first packet');
            for (let turn = 0; turn < 5 && harness.videoFileDB.insertOnce.mock.calls.length === 0; turn += 1) {
                await Promise.resolve();
            }
            await vi.advanceTimersByTimeAsync(600_000);
            expect(session.state.phase).toBe('RegistrationOverdue');

            let deletionSettled = false;
            const deletion = harness.model.cancel(true).then(() => {
                deletionSettled = true;
            });
            await Promise.resolve();
            expect(session.state.phase).toBe('StoppingForDeletion');
            expect(deletionSettled).toBe(false);

            videoInsert.resolve(31);
            await Promise.all([preparation, deletion]);

            expect(session.state.phase).toBe('Cancelled');
            expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(31);
            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            videoInsert.resolve(31);
            await preparation.catch(() => undefined);
            stream.destroy();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[retry-first-data-cancel][Task 5.3][RE-4.8] lets cancellation settle the first-data gate before it can retry', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-cancel-first-data-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const reserve = makeReserve();
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
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        try {
            const preparation = harness.model.startPreparation();
            await waitUntil(() => session.state.phase === 'AwaitingFirstData', 'the first-data gate');
            expect(harness.model.isRecording).toBe(true);
            expect(harness.model.isPrepRecording).toBe(false);
            await harness.model.cancel(false);
            expect(harness.model.firstDataWait).toBeNull();
            await preparation;

            expect(session.state.phase).toBe('Cancelled');
            expect(harness.model.retryAttempt).toBeNull();
            expect(harness.model.retryTimerId).toBeNull();
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        } finally {
            harness.model.cancelFirstDataWait();
            stream.destroy();
            await rm(root, { recursive: true, force: true });
        }
    });

    it.each(['Waiting', 'RetryWaiting', 'Preparing', 'AwaitingFirstData'])(
        '[Task 2.5] reaches deletion terminal from %s without normal finalization',
        async phase => {
            vi.useFakeTimers();
            const reserve = makeReserve();
            const harness = makeRecorder();
            const session = makeRecordingSessionBinding(reserve, { phase });
            harness.model.reserve = reserve;
            harness.model.bindScheduleSession(session.binding);
            const abort = vi.fn();
            if (phase === 'RetryWaiting') {
                harness.model.isPrepRecording = true;
                harness.model.retryAttempt = 1;
                harness.model.retryTimerId = setTimeout(() => undefined, 5_000);
            } else if (phase === 'Preparing') {
                harness.model.isPrepRecording = true;
                harness.model.abortController = { abort };
            } else if (phase === 'AwaitingFirstData') {
                harness.model.isRecording = true;
                harness.model.firstDataWait = { cancel: vi.fn() };
            }

            const cancellation = harness.model.cancel(true);
            expect(session.state.phase).toBe('StoppingForDeletion');
            await Promise.resolve();
            if (phase === 'Preparing') {
                expect(abort).toHaveBeenCalledOnce();
                harness.model.emitCancelEvent();
            }
            await cancellation;

            expect(session.state.phase).toBe('Cancelled');
            expect(harness.recordedDB.removeRecording).not.toHaveBeenCalled();
            expect(harness.recordingUtil.movingFromTmp).not.toHaveBeenCalled();
            expect(harness.recordingUtil.updateVideoFileSize).not.toHaveBeenCalled();
            expect(harness.dropChecker.getResult).not.toHaveBeenCalled();
            expect(harness.recordedHistoryDB.insertOnce).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitFinishRecording).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitCancelPrepRecording).not.toHaveBeenCalled();
        },
    );

    it('[Task 2.5 mutation gap] releases the deletion latch when an observed preparation rejects', async () => {
        vi.useFakeTimers();
        const reserve = makeReserve();
        const preparation = deferred<void>();
        const harness = makeRecorder();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        const abort = vi.fn();
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.isPrepRecording = true;
        harness.model.abortController = { abort };
        harness.model.preparationLifetime = preparation.promise;

        const cancellation = harness.model.cancel(true);
        expect(session.state.phase).toBe('StoppingForDeletion');
        expect(abort).toHaveBeenCalledOnce();

        preparation.reject(new Error('synthetic rejected preparation terminal'));
        await expect(cancellation).resolves.toBeUndefined();

        expect(session.state.phase).toBe('Cancelled');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 2.5 mutation gap] preserves one writer terminal for a later planned deletion', async () => {
        vi.useFakeTimers();
        const reserve = makeReserve();
        const writer = makePendingWriter();
        const removeWriterListeners = vi.spyOn(writer, 'removeAllListeners');
        const harness = makeRecorder();
        harness.model.reserve = reserve;
        harness.model.recFile = writer;

        harness.model.destroyStream();
        let deletionSettled = false;
        const deletion = harness.model.cancel(true).then(() => {
            deletionSettled = true;
        });
        for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
        const settledBeforeWriterClose = deletionSettled;
        writer.closed = true;
        writer.emit('close');
        await deletion;
        harness.model.destroyStream();

        expect(settledBeforeWriterClose).toBe(false);
        expect(removeWriterListeners).toHaveBeenCalledOnce();
        expect(removeWriterListeners).toHaveBeenCalledWith('error');
        expect(writer.end).toHaveBeenCalledOnce();
        expect(harness.model.recFile).toBeNull();
        expect(harness.model.finalizationContinuations.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 2.5 mutation gap] preserves one stream terminal and removes its data listener before later deletion', async () => {
        vi.useFakeTimers();
        const reserve = makeReserve();
        const pendingStream = makePendingStream();
        pendingStream.on('data', vi.fn());
        const harness = makeRecorder();
        harness.model.reserve = reserve;
        harness.model.stream = pendingStream;

        harness.model.destroyStream();
        let deletionSettled = false;
        const deletion = harness.model.cancel(true).then(() => {
            deletionSettled = true;
        });
        for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
        const settledBeforeStreamClose = deletionSettled;
        pendingStream.closed = true;
        pendingStream.emit('close');
        await deletion;
        harness.model.destroyStream();

        expect(settledBeforeStreamClose).toBe(false);
        expect(pendingStream.unpipe).toHaveBeenCalledOnce();
        expect(pendingStream.destroy).toHaveBeenCalledOnce();
        expect(pendingStream.push).toHaveBeenCalledOnce();
        expect(pendingStream.push).toHaveBeenCalledWith(null);
        expect(pendingStream.listenerCount('data')).toBe(0);
        expect(harness.model.stream).toBeNull();
        expect(harness.model.finalizationContinuations.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 2.5 mutation gap] preserves one drop-check terminal for a later planned deletion', async () => {
        vi.useFakeTimers();
        const reserve = makeReserve();
        const dropTerminal = deferred<void>();
        const harness = makeRecorder();
        harness.dropChecker.stop.mockReturnValue(dropTerminal.promise);
        harness.model.reserve = reserve;
        harness.model.isDropCheckerActive = true;

        harness.model.destroyStream();
        let deletionSettled = false;
        const deletion = harness.model.cancel(true).then(() => {
            deletionSettled = true;
        });
        for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
        const settledBeforeDropStop = deletionSettled;
        dropTerminal.resolve();
        await deletion;
        harness.model.destroyStream();

        expect(settledBeforeDropStop).toBe(false);
        expect(harness.dropChecker.stop).toHaveBeenCalledOnce();
        expect(harness.model.finalizationContinuations.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 2.5] joins repeated recording deletion stops until stream, writer, and drop are terminal', async () => {
        vi.useFakeTimers();
        const reserve = makeReserve();
        const dropTerminal = deferred<void>();
        const writer = makePendingWriter();
        const stream = new PassThrough();
        const harness = makeRecorder();
        harness.dropChecker.stop.mockImplementation(() => dropTerminal.promise);
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.stream = stream;
        harness.model.recFile = writer;
        harness.model.dropLogFileId = 41;
        harness.model.recordedId = 21;
        harness.model.videoFileId = 31;
        harness.model.videoFileFulPath = '/synthetic-root/synthetic.ts';
        harness.model.isRecording = true;

        let settled = 0;
        const first = harness.model.cancel(true).then(() => (settled += 1));
        const second = harness.model.cancel(true).then(() => (settled += 1));
        await Promise.resolve();

        expect(session.state.phase).toBe('StoppingForDeletion');
        expect(stream.destroyed).toBe(true);
        expect(writer.end).toHaveBeenCalledOnce();
        expect(harness.dropChecker.stop).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(1);
        expect(settled).toBe(0);
        dropTerminal.resolve();
        await Promise.resolve();
        expect(settled).toBe(0);
        writer.emit('finish');
        await Promise.resolve();
        expect(settled).toBe(0);
        writer.closed = true;
        writer.emit('close');
        await Promise.all([first, second]);

        expect(settled).toBe(2);
        expect(session.state.phase).toBe('Cancelled');
        expect(vi.getTimerCount()).toBe(0);
        expect(harness.recordedDB.removeRecording).not.toHaveBeenCalled();
        expect(harness.recordingUtil.movingFromTmp).not.toHaveBeenCalled();
        expect(harness.recordingUtil.updateVideoFileSize).not.toHaveBeenCalled();
        expect(harness.dropChecker.getResult).not.toHaveBeenCalled();
        expect(harness.recordedHistoryDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.recordingEvent.emitFinishRecording).not.toHaveBeenCalled();
    });

    it('[Task 2.5] rejects at exactly sixty seconds and keeps observing the late deletion terminal', async () => {
        vi.useFakeTimers();
        const reserve = makeReserve();
        const writer = makePendingWriter();
        const stream = new PassThrough();
        const harness = makeRecorder();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.stream = stream;
        harness.model.recFile = writer;
        harness.model.isRecording = true;

        const cancellation = harness.model.cancel(true);
        const observed = cancellation.catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(59_999);
        expect(session.state.phase).toBe('StoppingForDeletion');
        await vi.advanceTimersByTimeAsync(1);
        await expect(observed).resolves.toMatchObject({ message: 'DeletionStopTimeoutError' });
        expect(session.state.phase).toBe('StoppingForDeletion');

        writer.closed = true;
        writer.emit('close');
        await harness.model.whenDeletionTerminal();
        expect(session.state.phase).toBe('Cancelled');
        expect(harness.recordedDB.removeRecording).not.toHaveBeenCalled();
        expect(harness.recordingEvent.emitFinishRecording).not.toHaveBeenCalled();
    });

    it('[Task 2.5] waits for close when a stream was already marked destroyed before deletion stop', async () => {
        vi.useFakeTimers();
        const reserve = makeReserve();
        const stream = Object.assign(new EventEmitter(), {
            closed: false,
            destroy: vi.fn(),
            destroyed: true,
            push: vi.fn(),
            readableEnded: false,
            unpipe: vi.fn(),
        });
        const harness = makeRecorder();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.stream = stream;
        harness.model.isRecording = true;

        let settled = false;
        const cancellation = harness.model.cancel(true).then(() => {
            settled = true;
        });
        for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
        expect(settled).toBe(false);

        stream.closed = true;
        stream.emit('close');
        await cancellation;
        expect(session.state.phase).toBe('Cancelled');
    });

    it('[Task 2.5] joins resources exposed by a late preparation continuation before deletion terminal', async () => {
        vi.useFakeTimers();
        const reserve = makeReserve();
        const latePreparation = deferred<void>();
        const writer = makePendingWriter();
        const stream = new PassThrough();
        const harness = makeRecorder();
        const dropTerminal = deferred<void>();
        harness.dropChecker.stop.mockImplementation(() => dropTerminal.promise);
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.isPrepRecording = true;
        harness.model.abortController = { abort: vi.fn() };
        harness.model.preparationLifetime = latePreparation.promise;

        let settled = false;
        const cancellation = harness.model.cancel(true).then(() => {
            settled = true;
        });
        harness.model.stream = stream;
        harness.model.recFile = writer;
        harness.model.isDropCheckerActive = true;
        harness.model.destroyStream();
        harness.model.emitCancelEvent();
        latePreparation.resolve();
        await Promise.resolve();

        expect(stream.destroyed).toBe(true);
        expect(writer.end).toHaveBeenCalledOnce();
        expect(settled).toBe(false);
        writer.closed = true;
        writer.emit('close');
        await Promise.resolve();
        expect(settled).toBe(false);
        dropTerminal.resolve();
        await cancellation;
        expect(session.state.phase).toBe('Cancelled');
    });

    it('[Task 2.5] fences preparation before stream I/O and joins its lifetime without requiring a cancel event', async () => {
        vi.useFakeTimers();
        const reserve = makeReserve();
        const program = deferred<ReturnType<typeof makeReserve>>();
        const harness = makeRecorder({ programDB: { findId: vi.fn(() => program.promise) } });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);

        const preparation = harness.model.startPreparation();
        const cancellation = harness.model.cancel(true);
        program.resolve(reserve);
        await Promise.all([preparation, cancellation]);

        expect(harness.streamCreator.create).not.toHaveBeenCalled();
        expect(session.state.phase).toBe('Cancelled');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 2.5 review] joins one in-flight normal finalization and all of its deferred effects', async () => {
        vi.useFakeTimers();
        const clearRecording = deferred<void>();
        const move = deferred<string>();
        const size = deferred<void>();
        const drop = deferred<Record<string, never>>();
        const dropStop = deferred<void>();
        const writer = makePendingWriter();
        const reserve = makeReserve();
        const harness = makeRecorder({
            config: { recordedTmp: '/synthetic-tmp' },
            recordedDB: {
                findId: vi.fn(async () => null),
                removeRecording: vi.fn(() => clearRecording.promise),
            },
            recordingUtil: {
                movingFromTmp: vi.fn(() => move.promise),
                updateVideoFileSize: vi.fn(() => size.promise),
            },
            dropChecker: {
                getFilePath: vi.fn(() => '/synthetic-drop/41.log'),
                getResult: vi.fn(() => drop.promise),
                start: vi.fn(async () => undefined),
                stop: vi.fn(() => dropStop.promise),
            },
        });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.recordedId = 21;
        harness.model.videoFileId = 31;
        harness.model.videoFileFulPath = '/synthetic-tmp/synthetic.ts';
        harness.model.dropLogFileId = 41;
        harness.model.recFile = writer;
        harness.model.isRecording = true;

        const normalFinalization = harness.model.recEnd();
        expect(harness.recordedDB.removeRecording).toHaveBeenCalledOnce();
        let deletionSettled = false;
        const deletion = harness.model.cancel(true).then(() => {
            deletionSettled = true;
        });
        for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
        expect(deletionSettled).toBe(false);
        expect(harness.recordedDB.removeRecording).toHaveBeenCalledOnce();

        clearRecording.resolve();
        await Promise.resolve();
        expect(harness.recordingUtil.movingFromTmp).toHaveBeenCalledOnce();
        expect(deletionSettled).toBe(false);

        move.resolve('/synthetic-root/synthetic.ts');
        await Promise.resolve();
        // The size update must not start yet: the writer (recFile) has not closed, so stat()-ing
        // the file here could still observe an unflushed write.
        expect(harness.recordingUtil.updateVideoFileSize).not.toHaveBeenCalled();
        expect(harness.dropChecker.getResult).toHaveBeenCalledOnce();
        expect(deletionSettled).toBe(false);

        drop.resolve({});
        await normalFinalization;
        expect(deletionSettled).toBe(false);
        size.resolve();
        for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
        expect(deletionSettled).toBe(false);
        // updateVideoFileSize is still deferred: only the writer's own 'close' releases it.
        expect(harness.recordingUtil.updateVideoFileSize).not.toHaveBeenCalled();
        writer.closed = true;
        writer.emit('close');
        await Promise.resolve();
        expect(harness.recordingUtil.updateVideoFileSize).toHaveBeenCalledOnce();
        expect(deletionSettled).toBe(false);
        dropStop.resolve();
        await deletion;

        expect(session.state.phase).toBe('Cancelled');
        expect(harness.recordedDB.removeRecording).toHaveBeenCalledOnce();
        expect(harness.recordingUtil.movingFromTmp).toHaveBeenCalledOnce();
        expect(harness.recordingUtil.updateVideoFileSize).toHaveBeenCalledOnce();
        expect(harness.dropChecker.getResult).toHaveBeenCalledOnce();
        expect(harness.dropChecker.stop).toHaveBeenCalledOnce();
        expect(writer.end).toHaveBeenCalledOnce();
    });

    it('[Task 2.5 review] cleans late two-stage registration resources before the real deletion stop resolves', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-register-delete-'));
        const fullPath = join(root, 'late.ts');
        await writeFile(fullPath, 'late recording');
        const recordedInsert = deferred<number>();
        const videoInsert = deferred<number>();
        const recordedDelete = deferred<void>();
        const videoDelete = deferred<void>();
        const reserve = makeReserve();
        const harness = makeRecorder({
            recordedDB: {
                deleteOnce: vi.fn(() => recordedDelete.promise),
                findId: vi.fn(async () => null),
                insertOnce: vi.fn(() => recordedInsert.promise),
                removeRecording: vi.fn(async () => undefined),
            },
            videoFileDB: {
                deleteOnce: vi.fn(() => videoDelete.promise),
                insertOnce: vi.fn(() => videoInsert.promise),
            },
        });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Registering' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);

        try {
            const registration = harness.model.addRecorded({
                parendDir: { name: 'synthetic-root', path: root },
                subDir: '',
                fileName: 'late.ts',
                fullPath,
            });
            harness.model.preparationLifetime = registration.then(() => undefined);
            recordedInsert.resolve(21);
            for (let turn = 0; turn < 5 && harness.videoFileDB.insertOnce.mock.calls.length === 0; turn += 1) {
                await Promise.resolve();
            }
            expect(harness.videoFileDB.insertOnce).toHaveBeenCalledOnce();

            let deletionSettled = false;
            const deletion = harness.model.cancel(true).then(() => {
                deletionSettled = true;
            });
            videoInsert.resolve(31);
            for (let turn = 0; turn < 5 && harness.videoFileDB.deleteOnce.mock.calls.length === 0; turn += 1) {
                await Promise.resolve();
            }

            expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledWith(31);
            expect(deletionSettled).toBe(false);
            videoDelete.resolve();
            await Promise.resolve();
            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledWith(21);
            expect(deletionSettled).toBe(false);
            recordedDelete.resolve();

            await expect(registration).resolves.toBeNull();
            await deletion;
            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
            expect(session.state.phase).toBe('Cancelled');
            expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledOnce();
            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledOnce();
            expect(harness.recordedDB.removeRecording).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitFinishRecording).not.toHaveBeenCalled();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 2.5 second review] cleans both inserted rows and the file when deletion wins the activation CAS', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-register-cas-delete-'));
        const fullPath = join(root, 'cas.ts');
        const stream = new PassThrough();
        const recordedInsert = deferred<number>();
        const videoInsert = deferred<number>();
        const recordedDelete = deferred<void>();
        const videoDelete = deferred<void>();
        const unlinkRelease = deferred<void>();
        const cleanupOrder: string[] = [];
        const originalUnlink = FileUtil.unlink;
        const unlink = vi.spyOn(FileUtil, 'unlink').mockImplementation(async filePath => {
            cleanupOrder.push(`file:${filePath}`);
            await originalUnlink(filePath);
            await unlinkRelease.promise;
        });
        const reserve = makeReserve();
        const harness = makeRecorder({
            recordedDB: {
                deleteOnce: vi.fn(async (recordedId: number) => {
                    cleanupOrder.push(`recorded:${recordedId}`);
                    await recordedDelete.promise;
                }),
                findId: vi.fn(async () => null),
                insertOnce: vi.fn(() => recordedInsert.promise),
                removeRecording: vi.fn(async () => undefined),
                updateOnce: vi.fn(async () => undefined),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'cas.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(async () => fullPath),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
            videoFileDB: {
                deleteOnce: vi.fn(async (videoFileId: number) => {
                    cleanupOrder.push(`video:${videoFileId}`);
                    await videoDelete.promise;
                }),
                insertOnce: vi.fn(() => videoInsert.promise),
            },
        });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        let deletion: Promise<void> | null = null;
        let deletionSettled = false;

        try {
            const originalTransition = session.binding.tryTransition;
            session.binding.tryTransition = vi.fn((expectedPhase: string, nextPhase: string) => {
                if (expectedPhase === 'Registering' && nextPhase === 'Recording') {
                    deletion = harness.model.cancel(true).then(() => {
                        deletionSettled = true;
                    });
                }
                return originalTransition(expectedPhase, nextPhase);
            });
            const { preparation } = await beginRealRegistration(harness, session, stream, fullPath);
            await waitUntil(() => harness.recordedDB.insertOnce.mock.calls.length === 1, 'the Recorded insert');
            recordedInsert.resolve(21);
            await waitUntil(() => harness.videoFileDB.insertOnce.mock.calls.length === 1, 'the VideoFile insert');
            videoInsert.resolve(31);
            await waitUntil(
                () => deletion !== null && harness.videoFileDB.deleteOnce.mock.calls.length === 1,
                'deletion at the activation CAS',
            );

            expect(session.binding.tryTransition).toHaveBeenCalledWith('Registering', 'Recording');
            expect(session.state.phase).toBe('StoppingForDeletion');
            expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledWith(31);
            expect(cleanupOrder).toEqual(['video:31']);
            expect(deletionSettled).toBe(false);

            videoDelete.resolve();
            await waitUntil(() => harness.recordedDB.deleteOnce.mock.calls.length === 1, 'the Recorded cleanup');
            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledWith(21);
            expect(cleanupOrder).toEqual(['video:31', 'recorded:21']);
            expect(unlink).not.toHaveBeenCalled();
            expect(deletionSettled).toBe(false);

            recordedDelete.resolve();
            await waitUntil(
                () => unlink.mock.calls.length === 1 && fileExists(fullPath).then(exists => !exists),
                'unlink',
            );
            expect(cleanupOrder).toEqual(['video:31', 'recorded:21', `file:${fullPath}`]);
            expect(deletionSettled).toBe(false);

            unlinkRelease.resolve();
            if (deletion === null) throw new Error('Deletion was not started at the activation CAS');
            await Promise.all([preparation, deletion]);

            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
            expect(session.state.phase).toBe('Cancelled');
            expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledOnce();
            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledOnce();
            expect(unlink).toHaveBeenCalledOnce();
            expectNoNormalRecordingCompletion(harness);
        } finally {
            videoDelete.resolve();
            recordedDelete.resolve();
            unlinkRelease.resolve();
            unlink.mockRestore();
            stream.destroy();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 2.5 second review] deletes only the file when a planned deletion observes Recorded insert rejection', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recorded-reject-delete-'));
        const fullPath = join(root, 'recorded-reject.ts');
        const stream = new PassThrough();
        const recordedInsert = deferred<number>();
        const unlinkRelease = deferred<void>();
        const cleanupOrder: string[] = [];
        const originalUnlink = FileUtil.unlink;
        const unlink = vi.spyOn(FileUtil, 'unlink').mockImplementation(async filePath => {
            cleanupOrder.push(`file:${filePath}`);
            await originalUnlink(filePath);
            await unlinkRelease.promise;
        });
        const reserve = makeReserve();
        const harness = makeRecorder({
            recordedDB: {
                deleteOnce: vi.fn(async () => undefined),
                findId: vi.fn(async () => null),
                insertOnce: vi.fn(() => recordedInsert.promise),
                removeRecording: vi.fn(async () => undefined),
                updateOnce: vi.fn(async () => undefined),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'recorded-reject.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(async () => fullPath),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
            videoFileDB: {
                deleteOnce: vi.fn(async () => undefined),
                insertOnce: vi.fn(async () => 31),
            },
        });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        let deletionSettled = false;

        try {
            const { preparation } = await beginRealRegistration(harness, session, stream, fullPath);
            await waitUntil(() => harness.recordedDB.insertOnce.mock.calls.length === 1, 'the pending Recorded insert');
            const deletion = harness.model.cancel(true).then(() => {
                deletionSettled = true;
            });

            expect(session.state.phase).toBe('StoppingForDeletion');
            expect(deletionSettled).toBe(false);
            expect(harness.recordedDB.deleteOnce).not.toHaveBeenCalled();
            expect(harness.videoFileDB.deleteOnce).not.toHaveBeenCalled();
            expect(await fileExists(fullPath)).toBe(true);

            recordedInsert.reject(new Error('synthetic Recorded insert rejection'));
            await waitUntil(
                () => unlink.mock.calls.length === 1 && fileExists(fullPath).then(exists => !exists),
                'unlink',
            );
            expect(cleanupOrder).toEqual([`file:${fullPath}`]);
            expect(harness.videoFileDB.insertOnce).not.toHaveBeenCalled();
            expect(harness.recordedDB.deleteOnce).not.toHaveBeenCalled();
            expect(harness.videoFileDB.deleteOnce).not.toHaveBeenCalled();
            expect(deletionSettled).toBe(false);

            unlinkRelease.resolve();
            await Promise.all([preparation, deletion]);

            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
            expect(session.state.phase).toBe('Cancelled');
            expect(unlink).toHaveBeenCalledOnce();
            expectNoNormalRecordingCompletion(harness);
        } finally {
            unlinkRelease.resolve();
            unlink.mockRestore();
            stream.destroy();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 2.5 second review] deletes the inserted Recorded row and file before VideoFile rejection deletion settles', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-video-reject-delete-'));
        const fullPath = join(root, 'video-reject.ts');
        const stream = new PassThrough();
        const recordedInsert = deferred<number>();
        const videoInsert = deferred<number>();
        const recordedDelete = deferred<void>();
        const unlinkRelease = deferred<void>();
        const cleanupOrder: string[] = [];
        const originalUnlink = FileUtil.unlink;
        const unlink = vi.spyOn(FileUtil, 'unlink').mockImplementation(async filePath => {
            cleanupOrder.push(`file:${filePath}`);
            await originalUnlink(filePath);
            await unlinkRelease.promise;
        });
        const reserve = makeReserve();
        const harness = makeRecorder({
            recordedDB: {
                deleteOnce: vi.fn(async (recordedId: number) => {
                    cleanupOrder.push(`recorded:${recordedId}`);
                    await recordedDelete.promise;
                }),
                findId: vi.fn(async () => null),
                insertOnce: vi.fn(() => recordedInsert.promise),
                removeRecording: vi.fn(async () => undefined),
                updateOnce: vi.fn(async () => undefined),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'video-reject.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(async () => fullPath),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
            videoFileDB: {
                deleteOnce: vi.fn(async () => undefined),
                insertOnce: vi.fn(() => videoInsert.promise),
            },
        });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        let deletionSettled = false;

        try {
            const { preparation } = await beginRealRegistration(harness, session, stream, fullPath);
            await waitUntil(() => harness.recordedDB.insertOnce.mock.calls.length === 1, 'the Recorded insert');
            recordedInsert.resolve(21);
            await waitUntil(
                () => harness.videoFileDB.insertOnce.mock.calls.length === 1,
                'the pending VideoFile insert',
            );
            const deletion = harness.model.cancel(true).then(() => {
                deletionSettled = true;
            });

            expect(session.state.phase).toBe('StoppingForDeletion');
            expect(deletionSettled).toBe(false);
            videoInsert.reject(new Error('synthetic VideoFile insert rejection'));
            await waitUntil(() => harness.recordedDB.deleteOnce.mock.calls.length === 1, 'the exact Recorded cleanup');

            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledWith(21);
            expect(harness.videoFileDB.deleteOnce).not.toHaveBeenCalled();
            expect(cleanupOrder).toEqual(['recorded:21']);
            expect(unlink).not.toHaveBeenCalled();
            expect(deletionSettled).toBe(false);

            recordedDelete.resolve();
            await waitUntil(
                () => unlink.mock.calls.length === 1 && fileExists(fullPath).then(exists => !exists),
                'unlink',
            );
            expect(cleanupOrder).toEqual(['recorded:21', `file:${fullPath}`]);
            expect(deletionSettled).toBe(false);

            unlinkRelease.resolve();
            await Promise.all([preparation, deletion]);

            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
            expect(session.state.phase).toBe('Cancelled');
            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledOnce();
            expect(unlink).toHaveBeenCalledOnce();
            expectNoNormalRecordingCompletion(harness);
        } finally {
            recordedDelete.resolve();
            unlinkRelease.resolve();
            unlink.mockRestore();
            stream.destroy();
            await rm(root, { recursive: true, force: true });
        }
    });

    // 4 total attempts (0-3) at a 5_000ms interval matches src/model/operator/recording/
    // RecorderModel.ts:445 (`if (retry < 3)`) and :2064 (`setTimeout(..., 5_000)`), which are the
    // same bound and interval as v2's RecorderModel.ts:206-209 (`if (retry < 3) { setTimeout(...,
    // 1000 * 5) }` inside `prepRecord`).
    it('[Task 2.3] owns one five-second retry and performs attempts zero through three with phase CAS', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const timeout = vi.spyOn(globalThis, 'setTimeout');
        const reserve = makeReserve({ endAt: 999_000 });
        const harness = makeRecorder({
            streamCreator: {
                create: vi.fn(async () => Promise.reject(new Error('synthetic session stream failure'))),
                changeEndAt: vi.fn(),
            },
        });
        const session = makeRecordingSessionBinding(reserve);
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);

        await harness.model.startPreparation();
        expect(session.state.phase).toBe('RetryWaiting');
        expect(harness.model.retryAttempt).toBe(1);
        expect(vi.getTimerCount()).toBe(1);
        expect(timeout.mock.calls.at(-1)?.[1]).toBe(5_000);

        for (let expectedAttempts = 2; expectedAttempts <= 4; expectedAttempts += 1) {
            await vi.advanceTimersByTimeAsync(5_000);
            expect(harness.streamCreator.create).toHaveBeenCalledTimes(expectedAttempts);
            expect(session.state.phase).toBe(expectedAttempts === 4 ? 'Completed' : 'RetryWaiting');
            expect(vi.getTimerCount()).toBe(expectedAttempts === 4 ? 0 : 1);
        }

        expect(harness.programDB.findId).toHaveBeenCalledTimes(4);
        expect(harness.recordingEvent.emitStartPrepRecording).toHaveBeenCalledOnce();
        expect(harness.recordingEvent.emitPrepRecordingFailed).toHaveBeenCalledOnce();
        expect(session.binding.tryTransition.mock.calls).toEqual([
            ['Preparing', 'RetryWaiting'],
            ['RetryWaiting', 'Preparing'],
            ['Preparing', 'RetryWaiting'],
            ['RetryWaiting', 'Preparing'],
            ['Preparing', 'RetryWaiting'],
            ['RetryWaiting', 'Preparing'],
            ['Preparing', 'Completed'],
        ]);
    });

    it('[Task 2.3] clears retry ownership on cancellation and makes a forced late callback inert', async () => {
        vi.useFakeTimers();
        const timeout = vi.spyOn(globalThis, 'setTimeout');
        const reserve = makeReserve();
        const harness = makeRecorder({
            streamCreator: {
                create: vi.fn(async () => Promise.reject(new Error('synthetic cancelled retry'))),
                changeEndAt: vi.fn(),
            },
        });
        const session = makeRecordingSessionBinding(reserve);
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        await harness.model.startPreparation();
        const retryCallback = timeout.mock.calls.find(([, delay]) => delay === 5_000)?.[0] as () => void;
        const clear = vi.spyOn(globalThis, 'clearTimeout');

        const cancellation = harness.model.cancel(false);
        await Promise.resolve();
        const clearCountBeforeAdvancing = clear.mock.calls.length;
        await vi.advanceTimersByTimeAsync(5_000);
        await cancellation;
        expect(clearCountBeforeAdvancing).toBe(1);
        expect(harness.model.retryTimerId).toBeNull();
        expect(session.state.phase).toBe('Cancelled');
        retryCallback();
        await Promise.resolve();

        expect(harness.streamCreator.create).toHaveBeenCalledOnce();
        expect(harness.recordingEvent.emitStartPrepRecording).toHaveBeenCalledOnce();
        expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['Completed', 'Cancelled'])(
        '[Task 2.3] rejects a retry callback after the session is externally %s',
        async terminalPhase => {
            vi.useFakeTimers();
            const timeout = vi.spyOn(globalThis, 'setTimeout');
            const reserve = makeReserve();
            const harness = makeRecorder({
                streamCreator: {
                    create: vi.fn(async () => Promise.reject(new Error('synthetic terminal retry'))),
                    changeEndAt: vi.fn(),
                },
            });
            const session = makeRecordingSessionBinding(reserve);
            harness.model.reserve = reserve;
            harness.model.bindScheduleSession(session.binding);
            await harness.model.startPreparation();
            const retryCallback = timeout.mock.calls.find(([, delay]) => delay === 5_000)?.[0] as () => void;

            session.state.phase = terminalPhase;
            retryCallback();
            await Promise.resolve();
            await vi.advanceTimersByTimeAsync(5_000);

            expect(harness.streamCreator.create).toHaveBeenCalledOnce();
            expect(harness.recordingEvent.emitStartPrepRecording).toHaveBeenCalledOnce();
            expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
            expect(harness.model.retryTimerId).toBeNull();
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it.each(['session-token replacement', 'skip', 'overlap', 'remove', 'recEnd cleanup'] as const)(
        '[Task 2.3 review] leaves the replacement or terminal phase untouched by a late retry after %s',
        async scenario => {
            vi.useFakeTimers();
            const timeout = vi.spyOn(globalThis, 'setTimeout');
            const reserve = makeReserve();
            const harness = makeRecorder({
                streamCreator: {
                    create: vi.fn(async () => Promise.reject(new Error('synthetic stale retry matrix'))),
                    changeEndAt: vi.fn(),
                },
            });
            const original = makeRecordingSessionBinding(reserve, { generation: 1n, sessionToken: 11n });
            harness.model.reserve = reserve;
            harness.model.bindScheduleSession(original.binding);
            await harness.model.startPreparation();
            const retryCallback = timeout.mock.calls.find(([, delay]) => delay === 5_000)?.[0] as () => void;
            let observed = original.state;
            let expectedPhase = 'Cancelled';

            if (scenario === 'session-token replacement') {
                original.state.current = false;
                const replacement = makeRecordingSessionBinding(reserve, {
                    generation: 2n,
                    phase: 'RetryWaiting',
                    sessionToken: 12n,
                });
                harness.model.bindScheduleSession(replacement.binding);
                observed = replacement.state;
                expectedPhase = 'RetryWaiting';
            } else if (scenario === 'skip' || scenario === 'overlap') {
                const update = harness.model.update(
                    makeReserve({
                        ...reserve,
                        isOverlap: scenario === 'overlap',
                        isSkip: scenario === 'skip',
                    }),
                    false,
                );
                await vi.runAllTimersAsync();
                await update;
            } else if (scenario === 'remove') {
                await harness.model.cancel(false);
            } else {
                original.state.phase = 'Recording';
                harness.model.isPrepRecording = false;
                harness.model.isRecording = true;
                await harness.model.recEnd();
                expectedPhase = 'Completed';
            }

            const effectsBeforeLateCallback = {
                failure: harness.recordingEvent.emitPrepRecordingFailed.mock.calls.length,
                preparation: harness.recordingEvent.emitStartPrepRecording.mock.calls.length,
                stream: harness.streamCreator.create.mock.calls.length,
            };
            expect(harness.model.retryTimerId).toBeNull();
            expect(vi.getTimerCount()).toBe(0);
            expect(observed.phase).toBe(expectedPhase);

            retryCallback();
            await vi.advanceTimersByTimeAsync(5_000);

            expect(harness.streamCreator.create).toHaveBeenCalledTimes(effectsBeforeLateCallback.stream);
            expect(harness.recordingEvent.emitStartPrepRecording).toHaveBeenCalledTimes(
                effectsBeforeLateCallback.preparation,
            );
            expect(harness.recordingEvent.emitPrepRecordingFailed).toHaveBeenCalledTimes(
                effectsBeforeLateCallback.failure,
            );
            expect(harness.model.retryTimerId).toBeNull();
            expect(vi.getTimerCount()).toBe(0);
            expect(observed.phase).toBe(expectedPhase);
        },
    );

    it('[Task 2.1] cancels a waiting timer without emitting preparation cancellation', async () => {
        const harness = makeRecorder();
        harness.model.setTimer(makeReserve(), false);
        await harness.model.cancel(false);
        expect(harness.recordingEvent.emitCancelPrepRecording).not.toHaveBeenCalled();
    });

    it('[Task 2.1] waits for the preparation cancel event after abort and clears the sixty-second deadline', async () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        harness.model.isPrepRecording = true;
        const abort = vi.fn();
        harness.model.abortController = { abort };
        let release!: () => void;
        harness.model.eventEmitter.once = vi.fn((_event: string, callback: () => void) => {
            release = callback;
        });
        const pending = harness.model.cancel(false);
        await Promise.resolve();
        expect(abort).toHaveBeenCalledOnce();
        expect(harness.recordingEvent.emitCancelPrepRecording).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(1);
        release();
        await pending;
        expect(vi.getTimerCount()).toBe(0);
        expect(harness.recordingEvent.emitCancelPrepRecording).toHaveBeenCalledOnce();
    });

    it.each([
        ['clean terminal', null],
        ['errored terminal', new Error('synthetic stream terminal failure')],
    ])('[Task 2.1/6.1] finalizes an active stream exactly once for %s', async (_case, failure) => {
        const harness = makeRecorder();
        const stream = new PassThrough();
        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.recEnd = vi.fn(async () => undefined);
        harness.model.recFailed = vi.fn(async () => undefined);
        await harness.model.setEndProcess(stream);
        if (failure === null) {
            stream.resume();
            stream.end();
        } else stream.destroy(failure);
        await new Promise(resolve => setImmediate(resolve));
        expect(harness.model.recEnd).toHaveBeenCalledTimes(failure === null ? 1 : 0);
        expect(harness.model.recFailed).toHaveBeenCalledTimes(failure === null ? 0 : 1);
        if (failure !== null) expect(harness.model.recFailed).toHaveBeenCalledWith(failure, session.binding);
    });

    it('[P1 review][RE-6.1] publishes the recorder-captured session identity with a recording failure', async () => {
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 528 });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        const failure = new Error('synthetic identity-carrying recording failure');
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.recEnd = vi.fn(async () => undefined);

        await harness.model.recFailed(failure, session.binding);

        expect(harness.recordingEvent.emitRecordingFailed).toHaveBeenCalledOnce();
        expect(harness.recordingEvent.emitRecordingFailed).toHaveBeenCalledWith(reserve, null, session.binding);
    });

    // Coverage gap sweep (src/model/operator/recording/RecorderModel.ts): defensive catch/guard
    // branches that the choreographed race-condition suites above do not happen to exercise. Each
    // case asserts the real side effect of the branch (a log call, a state change, or a resolved
    // value), not merely that the line executes.
    it('setTimer refuses to schedule a skipped or overlapping reservation', () => {
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4001, isSkip: true });
        expect(harness.model.setTimer(reserve, true)).toBe(false);
        expect(harness.model.timerId).toBeNull();
    });

    it('setTimer clears a stale local timer once central scheduling owns the reservation', () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4002 });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Waiting' });
        harness.model.bindScheduleSession(session.binding);
        const staleTimer = setTimeout(() => {}, 100_000);
        harness.model.timerId = staleTimer;
        expect(harness.model.setTimer(reserve, false)).toBe(true);
        expect(harness.model.timerId).toBeNull();
        expect(logger.system.info).toHaveBeenCalledWith(`set central schedule: ${reserve.id}`);
    });

    it('setTimer clamps an overdue preparation lead time to zero and still fires', async () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        const now = Date.now();
        const reserve = makeReserve({ id: 4003, startAt: now, endAt: now + 120_000 });
        const runPreparationSpy = vi.spyOn(harness.model, 'runPreparation').mockImplementation(() => Promise.resolve());
        expect(harness.model.setTimer(reserve, true)).toBe(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(runPreparationSpy).toHaveBeenCalledOnce();
    });

    it('setTimer logs and swallows a preparation failure raised inside its own timer callback', async () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4004, startAt: Date.now() + 30_000, endAt: Date.now() + 90_000 });
        harness.model.runPreparation = vi.fn(() => Promise.reject(new Error('synthetic prep failure 4004')));
        expect(harness.model.setTimer(reserve, true)).toBe(true);
        await vi.advanceTimersByTimeAsync(120_000);
        expect(logger.system.error).toHaveBeenCalledWith(`failed prep record: ${reserve.id}`);
    });

    it('bindScheduleSession clears a still-pending waiting timer for the previous binding', async () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4000, startAt: Date.now() + 50_000, endAt: Date.now() + 90_000 });
        const runPreparationSpy = vi.spyOn(harness.model, 'runPreparation').mockImplementation(() => Promise.resolve());
        harness.model.setTimer(reserve, true);
        expect(harness.model.timerId).not.toBeNull();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Waiting' });
        harness.model.bindScheduleSession(session.binding);
        expect(harness.model.timerId).toBeNull();
        await vi.advanceTimersByTimeAsync(200_000);
        expect(runPreparationSpy).not.toHaveBeenCalled();
    });

    it('matchesRegistrationOwner treats a null binding as never matching', () => {
        const harness = makeRecorder();
        const owner = { generation: 1n, intent: 'None' as const, reservationId: 1, sessionToken: 1n };
        expect(harness.model.matchesRegistrationOwner(owner, null)).toBe(false);
    });

    it('promoteRegistrationTerminationIntent never downgrades an already-stronger intent', () => {
        const harness = makeRecorder();
        const owner = { generation: 1n, intent: 'Deletion' as const, reservationId: 1, sessionToken: 1n };
        harness.model.promoteRegistrationTerminationIntent(owner, 'Cancel');
        expect(owner.intent).toBe('Deletion');
    });

    it('prepRecord honors a pending stop request before opening any stream', async () => {
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4031 });
        harness.model.reserve = reserve;
        harness.model.isStopPrepRec = true;
        await harness.model.prepRecord(0, null);
        expect(harness.model.isStopPrepRec).toBe(false);
        expect(harness.streamCreator.create).not.toHaveBeenCalled();
        expect(harness.recordingEvent.emitStartPrepRecording).not.toHaveBeenCalled();
    });

    it('prepRecord stops retrying once the exhausted session of a reservation past its end time can no longer transition to Completed', async () => {
        const harness = makeRecorder({
            streamCreator: {
                changeEndAt: vi.fn(),
                create: vi.fn(async () => {
                    throw new Error('synthetic stream open failure 4032');
                }),
            },
        });
        const reserve = makeReserve({ id: 4032, endAt: Date.now() - 1 });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        session.binding.tryTransition = vi.fn(() => false);
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        await harness.model.prepRecord(3, session.binding);
        expect(harness.model.isPrepRecording).toBe(false);
        expect(session.binding.tryTransition).toHaveBeenCalledWith('Preparing', 'Completed');
        expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
    });

    it('doRecord returns immediately once the stream has already been torn down', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve({ id: 4033 });
        harness.model.stream = null;
        await expect(harness.model.doRecord(null)).resolves.toBeUndefined();
        expect(harness.recordingUtil.getRecPath).not.toHaveBeenCalled();
    });

    it('doRecord destroys the stream and cancels when a stop was requested just before recording starts', async () => {
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4034 });
        harness.model.reserve = reserve;
        harness.model.stream = new PassThrough();
        harness.model.isStopPrepRec = true;
        const destroySpy = vi.spyOn(harness.model, 'destroyStream');
        const cancelEventSpy = vi.spyOn(harness.model, 'emitCancelEvent');
        await harness.model.doRecord(null);
        expect(destroySpy).toHaveBeenCalledOnce();
        expect(cancelEventSpy).toHaveBeenCalledOnce();
        expect(harness.recordingUtil.getRecPath).not.toHaveBeenCalled();
    });

    it('doRecord cancels a preparation that is stopped while it is choosing the recording path', async () => {
        const harness = makeRecorder({
            recordingUtil: {
                getRecPath: vi.fn(async () => {
                    harness.model.isStopPrepRec = true;
                    return {
                        fileName: 'x.ts',
                        fullPath: '/synthetic-root-4035/x.ts',
                        parendDir: { name: 'synthetic-root-4035', path: '/synthetic-root-4035' },
                        subDir: '',
                    };
                }),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
        });
        const reserve = makeReserve({ id: 4035 });
        harness.model.reserve = reserve;
        harness.model.stream = new PassThrough();
        const destroySpy = vi.spyOn(harness.model, 'destroyStream');
        const cancelEventSpy = vi.spyOn(harness.model, 'emitCancelEvent');
        await harness.model.doRecord(null);
        expect(destroySpy).toHaveBeenCalledOnce();
        expect(cancelEventSpy).toHaveBeenCalledOnce();
    });

    it('destroyStream logs and keeps the stream reference when destroying it throws', () => {
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4005 });
        harness.model.reserve = reserve;
        const throwingStream = makePendingStream();
        throwingStream.destroy = vi.fn(() => {
            throw new Error('synthetic destroy failure 4005');
        });
        harness.model.stream = throwingStream;
        harness.model.destroyStream();
        expect(logger.system.error).toHaveBeenCalledWith(`destroy stream error: ${reserve.id}`);
        expect(harness.model.stream).toBe(throwingStream);
    });

    it('destroyStream logs when ending the record file throws after detaching it', () => {
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4006 });
        harness.model.reserve = reserve;
        const throwingWriter = makePendingWriter();
        throwingWriter.end = vi.fn(() => {
            throw new Error('synthetic end failure 4006');
        });
        harness.model.recFile = throwingWriter;
        harness.model.destroyStream();
        expect(logger.system.error).toHaveBeenCalledWith(`end recFile error: ${reserve.id}`);
        expect(harness.model.recFile).toBeNull();
    });

    it('destroyStream logs when the drop checker fails to stop', async () => {
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4007 });
        harness.model.reserve = reserve;
        harness.model.isDropCheckerActive = true;
        harness.dropChecker.stop = vi.fn(() => Promise.reject(new Error('synthetic drop stop failure 4007')));
        harness.model.destroyStream();
        await flushImmediate();
        expect(logger.system.error).toHaveBeenCalledWith(`dropChecker stop error: ${reserve.id}`);
    });

    it('destroyAcquiredStream logs when tearing down a superseded stream throws', () => {
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4008 });
        harness.model.reserve = reserve;
        harness.model.stream = null;
        const acquiredStream = makePendingStream();
        acquiredStream.destroy = vi.fn(() => {
            throw new Error('synthetic acquired destroy failure 4008');
        });
        harness.model.destroyAcquiredStream(acquiredStream);
        expect(logger.system.error).toHaveBeenCalledWith(`destroy acquired stream error: ${reserve.id}`);
    });

    it('checkEventRelay does nothing for a reservation without a linked program', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve({ id: 4009, programId: null });
        await harness.model.checkEventRelay();
        expect(harness.tunerServerAccess.getProgram).not.toHaveBeenCalled();
        expect(harness.recordingEvent.emitEventRelay).not.toHaveBeenCalled();
    });

    it('checkEventRelay logs and stops when fetching the parent program fails', async () => {
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4010, programId: 777 });
        harness.model.reserve = reserve;
        harness.tunerServerAccess.getProgram = vi.fn(async () => {
            throw new Error('synthetic get program failure 4010');
        });
        await harness.model.checkEventRelay();
        expect(logger.system.error).toHaveBeenCalledWith(
            `failed to get event relay info. reserveId: ${reserve.id}, programId: ${reserve.programId}`,
        );
        expect(harness.recordingEvent.emitEventRelay).not.toHaveBeenCalled();
    });

    it('checkEventRelay stops when the parent program carries no related items', async () => {
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4011, programId: 778 });
        harness.model.reserve = reserve;
        harness.tunerServerAccess.getProgram = vi.fn(async () => ({
            eventId: 3,
            id: 778,
            networkId: 1,
            serviceId: 2,
        }));
        await harness.model.checkEventRelay();
        expect(harness.recordingEvent.emitEventRelay).not.toHaveBeenCalled();
    });

    it('setEventRelayTimer does not arm a check timer for a skipped or overlapping reservation', () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4012, isSkip: true });
        harness.model.eventRelayTimerId = null;
        harness.model.setEventRelayTimer(reserve);
        expect(harness.model.eventRelayTimerId).toBeNull();
    });

    it('setEventRelayTimer clamps an already-passed check time to zero and still runs the check', async () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4013, endAt: Date.now() - 1_000 });
        const checkEventRelaySpy = vi.spyOn(harness.model, 'checkEventRelay').mockImplementation(() => Promise.resolve());
        harness.model.setEventRelayTimer(reserve);
        expect(harness.model.eventRelayTimerId).not.toBeNull();
        await vi.advanceTimersByTimeAsync(0);
        expect(checkEventRelaySpy).toHaveBeenCalledOnce();
    });

    it('scheduleRetry does nothing when no phase is available to retry from', () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4014 });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Waiting' });
        harness.model.scheduleRetry(1, session.binding, null);
        expect(harness.model.retryTimerId).toBeNull();
        expect(session.binding.tryTransition).not.toHaveBeenCalled();
    });

    it('scheduleRetry refuses to re-arm a retry wait for a session it no longer owns', () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4015 });
        const session = makeRecordingSessionBinding(reserve, { phase: 'RetryWaiting' });
        harness.model.scheduleRetry(1, session.binding, 'RetryWaiting');
        expect(harness.model.retryTimerId).toBeNull();
        expect(harness.model.retryAttempt).toBeNull();
        expect(session.binding.tryTransition).not.toHaveBeenCalled();
    });

    it('scheduleRetry refuses to re-arm when the session already left the expected phase', () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4016 });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        session.binding.tryTransition = vi.fn(() => false);
        harness.model.scheduleRetry(1, session.binding, 'Preparing');
        expect(harness.model.retryTimerId).toBeNull();
        expect(session.binding.tryTransition).toHaveBeenCalledWith('Preparing', 'RetryWaiting');
    });

    it('boundDeletionStop rejects with the underlying deletion failure', async () => {
        const harness = makeRecorder();
        const failure = new Error('synthetic deletion terminal failure 4017');
        await expect(harness.model.boundDeletionStop(Promise.reject(failure))).rejects.toThrow(failure);
    });

    it('whenDeletionTerminal resolves immediately when no deletion is in progress', async () => {
        const harness = makeRecorder();
        harness.model.deletionStop = null;
        await expect(harness.model.whenDeletionTerminal()).resolves.toBeUndefined();
    });

    it('cancel joins an already in-flight deletion stop instead of starting a second one', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve({ id: 4018 });
        const boundedDeferred = deferred<void>();
        harness.model.deletionStop = { bounded: boundedDeferred.promise, latch: null, terminal: null };
        const cancelSpy = vi.spyOn(harness.model, '_cancel');
        const result = harness.model.cancel(false);
        boundedDeferred.resolve();
        await expect(result).resolves.toBeUndefined();
        expect(cancelSpy).not.toHaveBeenCalled();
    });

    it('stopForDeletion clears a still-pending waiting timer', async () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4019, startAt: Date.now() + 50_000, endAt: Date.now() + 90_000 });
        harness.model.setTimer(reserve, true);
        expect(harness.model.timerId).not.toBeNull();
        const bounded = harness.model.cancel(true);
        expect(harness.model.timerId).toBeNull();
        await expect(bounded).resolves.toBeUndefined();
    });

    it('recEnd returns the same finalization lifetime for a concurrent second call', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve({ id: 4020 });
        const finalizeSpy = vi.spyOn(harness.model, 'finalizeRecording').mockImplementation(() => Promise.resolve());
        const first = harness.model.recEnd();
        const second = harness.model.recEnd();
        expect(second).toBe(first);
        await first;
        expect(finalizeSpy).toHaveBeenCalledOnce();
    });

    it('createRecorded refuses to synthesize a row without any name for a non-time-specified reservation', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve({ id: 4021, halfWidthName: null, isTimeSpecified: false, name: null });
        await expect(harness.model.createRecorded()).rejects.toThrow('CreateRecordedError');
    });

    it('addRecorded cleans up and yields no row when a deletion was requested mid-registration', async () => {
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4022 });
        harness.model.reserve = reserve;
        harness.model.isPlanToDelete = true;
        const recPath = {
            fileName: 'x.ts',
            fullPath: '/synthetic-root-4022/x.ts',
            parendDir: { name: 'synthetic-root-4022', path: '/synthetic-root-4022' },
            subDir: '',
        };
        const result = await harness.model.addRecorded(recPath);
        expect(result).toBeNull();
        expect(harness.recordedDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.videoFileDB.insertOnce).not.toHaveBeenCalled();
    });

    it('addRecorded logs when deleting the orphaned file fails after a DB registration error', async () => {
        const harness = makeRecorder({
            recordedDB: {
                insertOnce: vi.fn(async () => {
                    throw new Error('synthetic insert failure 4023');
                }),
            },
        });
        const reserve = makeReserve({ id: 4023 });
        harness.model.reserve = reserve;
        const recPath = {
            fileName: 'missing.ts',
            fullPath: '/nonexistent-root-4023/missing.ts',
            parendDir: { name: 'root', path: '/nonexistent-root-4023' },
            subDir: '',
        };
        await expect(harness.model.addRecorded(recPath, false)).rejects.toThrow('AddRecordedDBError');
        expect(logger.system.error).toHaveBeenCalledWith(`delete error: ${reserve.id} ${recPath.fullPath}`);
    });

    it('[RE-4.7] addRecorded deletes the created recorded row and the file when video-file registration fails', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-add-recorded-video-fail-'));
        const fullPath = join(root, 'x.ts');
        await writeFile(fullPath, 'synthetic');
        try {
            const harness = makeRecorder({
                recordedDB: {
                    deleteOnce: vi.fn(async () => undefined),
                    insertOnce: vi.fn(async () => 4030),
                },
                videoFileDB: {
                    insertOnce: vi.fn(async () => {
                        throw new Error('synthetic video file insert failure 4030');
                    }),
                },
            });
            harness.model.reserve = makeReserve({ id: 4030 });
            const recPath = {
                fileName: 'x.ts',
                fullPath,
                parendDir: { name: 'root', path: root },
                subDir: '',
            };
            await expect(harness.model.addRecorded(recPath, false)).rejects.toThrow('AddRecordedDBError');
            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(4030);
            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('cleanupPendingRegistration logs when deleting the drop log file row fails', async () => {
        const harness = makeRecorder({
            dropLogFileDB: {
                deleteOnce: vi.fn(async () => {
                    throw new Error('synthetic drop log delete failure 4024');
                }),
            },
        });
        harness.model.reserve = makeReserve({ id: 4024 });
        await harness.model.cleanupPendingRegistration({
            cleanupLifetime: null,
            dropLogFileId: 91,
            filePath: join(tmpdir(), 'epgstation-d5-nonexistent-4024', 'x.ts'),
            recordedId: null,
            videoFileId: null,
        });
        expect(logger.system.error).toHaveBeenCalledWith('delete drop log file error: 91');
    });

    it('setEndProcess logs fatally when the success-path recEnd itself rejects', async () => {
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4025 });
        harness.model.reserve = reserve;
        harness.model.recEnd = vi.fn(() => Promise.reject(new Error('synthetic recEnd failure 4025')));
        const stream = new PassThrough();
        await harness.model.setEndProcess(stream);
        stream.resume();
        stream.end();
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
        expect(logger.system.fatal).toHaveBeenCalledWith(`unexpected recEnd error: reserveId: ${reserve.id} recordedId: null`);
    });

    it('recFailed logs and still notifies recording failure when its own recEnd rejects', async () => {
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4029 });
        harness.model.reserve = reserve;
        harness.model.recEnd = vi.fn(() => Promise.reject(new Error('synthetic recFailed recEnd failure 4029')));
        const failure = new Error('synthetic recording failure 4029');
        await harness.model.recFailed(failure, null);
        expect(logger.system.error).toHaveBeenCalledWith(`recEnd error reserveId: ${reserve.id} recordedId: null`);
        expect(harness.recordingEvent.emitRecordingFailed).toHaveBeenCalledWith(reserve, null);
    });

    it('recFailed treats a recorded lookup failure during failure reporting as no recorded row', async () => {
        const harness = makeRecorder({
            recordedDB: {
                findId: vi.fn(async () => {
                    throw new Error('synthetic find failure 4026');
                }),
            },
        });
        const reserve = makeReserve({ id: 4026 });
        harness.model.reserve = reserve;
        harness.model.recordedId = 55;
        harness.model.recEnd = vi.fn(async () => undefined);
        const failure = new Error('synthetic recording failure 4026');
        await harness.model.recFailed(failure, null);
        expect(logger.system.error).toHaveBeenCalledWith('reocrded is deleted: 55');
        expect(harness.recordingEvent.emitRecordingFailed).toHaveBeenCalledWith(reserve, null);
    });

    it('finishAtTimeSpecifiedEnd logs when the finalization it triggers rejects', async () => {
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4027 });
        harness.model.reserve = reserve;
        harness.model.recEnd = vi.fn(() => Promise.reject(new Error('synthetic time specified recEnd failure 4027')));
        await harness.model.finishAtTimeSpecifiedEnd();
        await flushImmediate();
        expect(logger.system.error).toHaveBeenCalledWith(`time specified recEnd error reserveId: ${reserve.id}`);
    });

    it('_cancel rejects a stalled preparation cancellation after sixty seconds', async () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        harness.model.reserve = makeReserve({ id: 4028 });
        harness.model.isPrepRecording = true;
        const cancelPromise = harness.model._cancel();
        const assertion = expect(cancelPromise).rejects.toThrow('PrepRecCancelTimeoutError');
        await vi.advanceTimersByTimeAsync(60_000);
        await assertion;
    });

    it('update logs when the skip/overlap cancellation it issues rejects', async () => {
        const harness = makeRecorder();
        const reserve = makeReserve({ id: 4029 });
        harness.model.reserve = reserve;
        harness.model.cancel = vi.fn(() => Promise.reject(new Error('synthetic cancel failure 4029')));
        const newReserve = makeReserve({ id: 4029, isSkip: true });
        await harness.model.update(newReserve, true);
        expect(logger.system.error).toHaveBeenCalledWith(`cancel recording error: ${newReserve.id}`);
        expect(harness.model.reserve).toBe(newReserve);
    });

    it('update releases the tuner-held time-specified end when central scheduling owns the session', async () => {
        const releaseTimeSpecifiedEnd = vi.fn();
        const harness = makeRecorder({
            config: { timeSpecifiedEndMargin: 0 },
            streamCreator: { changeEndAt: vi.fn(), create: vi.fn(), releaseTimeSpecifiedEnd },
        });
        const reserve = makeReserve({ id: 4030, endAt: 2_000, programId: null, startAt: 1_000 });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        harness.model.reserve = reserve;
        harness.model.isPrepRecording = false;
        harness.model.isRecording = true;
        harness.model.bindScheduleSession(session.binding);
        const newReserve = makeReserve({ id: 4030, endAt: 5_000, programId: null, startAt: 1_000 });
        await harness.model.update(newReserve, true);
        expect(session.binding.registerTimeSpecifiedEnd).toHaveBeenCalledWith(newReserve.endAt);
        expect(releaseTimeSpecifiedEnd).toHaveBeenCalledWith(newReserve.id);
    });

    it('update logs when applying a time-specified end change directly to the stream creator throws', async () => {
        const changeEndAt = vi.fn(() => {
            throw new Error('synthetic changeEndAt failure 4036');
        });
        const harness = makeRecorder({ streamCreator: { changeEndAt, create: vi.fn() } });
        const reserve = makeReserve({ id: 4036, endAt: 2_000, programId: null, startAt: 1_000 });
        harness.model.reserve = reserve;
        harness.model.isPrepRecording = false;
        harness.model.isRecording = true;
        const newReserve = makeReserve({ id: 4036, endAt: 6_000, programId: null, startAt: 1_000 });
        await harness.model.update(newReserve, true);
        expect(changeEndAt).toHaveBeenCalledWith(newReserve);
        expect(logger.system.error).toHaveBeenCalledWith(`change recording endAt: ${newReserve.id}`);
    });

    it('update logs when cancelling to reschedule an earlier program-id preparation rejects', async () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        const reserve = makeReserve({ endAt: 20_000, id: 4037, programId: 55, startAt: 10_000 });
        harness.model.reserve = reserve;
        harness.model.isPrepRecording = true;
        harness.model.isRecording = false;
        harness.model._cancel = vi.fn(() => Promise.reject(new Error('synthetic cancel failure 4037')));
        const newReserve = makeReserve({ endAt: 20_000, id: 4037, programId: 55, startAt: 15_000 });
        await harness.model.update(newReserve, true);
        expect(logger.system.error).toHaveBeenCalledWith(
            `cancel recording error: (reserveId: ${newReserve.id}, programId: ${reserve.programId})`,
        );
    });

    it('finalizeRecording logs when stopping the drop checker fails during a planned deletion', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve({ id: 4038 });
        harness.model.isPlanToDelete = true;
        harness.model.isDropCheckerActive = true;
        harness.model.dropLogFileId = 92;
        harness.dropChecker.stop = vi.fn(() => Promise.reject(new Error('synthetic drop checker stop failure 4038')));
        await harness.model.finalizeRecording(false);
        expect(logger.system.error).toHaveBeenCalledWith('stop drop checker error: 92');
    });

    it('updateDropFileLog stops the drop checker without throwing when reading its result fails', async () => {
        const harness = makeRecorder();
        harness.model.dropLogFileId = 93;
        harness.dropChecker.getResult = vi.fn(async () => {
            throw new Error('synthetic get result failure 4039');
        });
        const stopSpy = vi.fn(() => Promise.reject(new Error('synthetic stop failure 4039')));
        harness.dropChecker.stop = stopSpy;
        await expect(harness.model.updateDropFileLog()).resolves.toBeUndefined();
        expect(stopSpy).toHaveBeenCalledOnce();
        expect(logger.system.error).toHaveBeenCalledWith('get drop result error: 93');
    });

    it('doRecord tears down the unstarted record file and rethrows when piping the stream throws', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-doRecord-pipe-throw-'));
        const fullPath = join(root, 'synthetic.ts');
        const harness = makeRecorder({
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    fileName: 'synthetic.ts',
                    fullPath,
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
        });
        const reserve = makeReserve({ id: 4040 });
        harness.model.reserve = reserve;
        const stream = new PassThrough();
        stream.pipe = vi.fn(() => {
            throw new Error('synthetic pipe failure 4040');
        }) as typeof stream.pipe;
        harness.model.stream = stream;
        try {
            await expect(harness.model.doRecord(null)).rejects.toThrow('synthetic pipe failure 4040');
            expect(harness.model.recFile).toBeNull();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('doRecord tears down and rethrows when opening the record file for exclusive create throws', async () => {
        // `RecorderModel.js` does `import * as fs from 'fs'` and calls `fs.createWriteStream(...)`
        // directly, so only a fresh `vi.doMock` + `vi.resetModules()` + dynamic `import()` of the
        // compiled module lands a replacement for its own binding (same mechanism used by
        // recording-start.spec.test.ts's "retains the exclusive-create fallback" case).
        const realFs = nodeRequire('fs') as typeof import('fs');
        const createWriteStream = vi.fn(() => {
            throw new Error('synthetic createWriteStream failure 4041');
        });
        const fsMock = { ...realFs, createWriteStream };
        vi.doMock('fs', () => fsMock);
        vi.doMock('node:fs', () => fsMock);
        let harness: ReturnType<typeof makeRecorder>;
        try {
            vi.resetModules();
            const { default: RecorderModelClass } = (await import(
                pathToFileURL(join(compiledSnapshot, 'model', 'operator', 'recording', 'RecorderModel.js')).href
            )) as { default: new (...args: any[]) => any };
            harness = makeRecorder({ RecorderModelClass });
        } finally {
            vi.doUnmock('fs');
            vi.doUnmock('node:fs');
        }
        const reserve = makeReserve({ id: 4041 });
        harness.model.reserve = reserve;
        harness.model.stream = new PassThrough();
        await expect(harness.model.doRecord(null)).rejects.toThrow('synthetic createWriteStream failure 4041');
        expect(harness.model.recFile).toBeNull();
        expect(createWriteStream).toHaveBeenCalledOnce();
    });

    it('doRecord destroys the stream and stops when the session cannot enter AwaitingFirstData', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-doRecord-awaiting-first-data-'));
        const fullPath = join(root, 'synthetic.ts');
        const harness = makeRecorder({
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    fileName: 'synthetic.ts',
                    fullPath,
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
        });
        const reserve = makeReserve({ id: 4042 });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        session.binding.tryTransition = vi.fn(() => false);
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.stream = new PassThrough();
        const destroySpy = vi.spyOn(harness.model, 'destroyStream');
        try {
            await harness.model.doRecord(session.binding);
            expect(destroySpy).toHaveBeenCalledOnce();
            expect(session.binding.tryTransition).toHaveBeenCalledWith('Recording', 'AwaitingFirstData');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('doRecord logs when destroying the record file during a stream-failure cleanup throws', async () => {
        // Same `vi.doMock` + `vi.resetModules()` + dynamic `import()` mechanism as the
        // exclusive-create-throws case above, but this time the mocked `fs.createWriteStream`
        // returns a fully synthetic (non-Node) writable so that overriding its `destroy()` cannot
        // be re-entered by Node's own autoDestroy machinery (which a real fs.WriteStream would
        // trigger, crashing the process from an uncatchable internal tick).
        const realFs = nodeRequire('fs') as typeof import('fs');
        const fakeRecFile = Object.assign(new EventEmitter(), {
            cork: vi.fn(),
            end: vi.fn((cb?: () => void) => cb?.()),
            uncork: vi.fn(),
            writable: true,
            write: vi.fn((_chunk: unknown, encOrCb?: unknown, cb?: () => void) => {
                const callback = typeof encOrCb === 'function' ? (encOrCb as () => void) : cb;
                callback?.();
                return true;
            }),
        });
        fakeRecFile.destroy = vi.fn(() => {
            fakeRecFile.emit('close');
            throw new Error('synthetic recFile destroy failure 4043');
        });
        const createWriteStream = vi.fn(() => fakeRecFile as unknown as ReturnType<typeof realFs.createWriteStream>);
        const fsMock = { ...realFs, createWriteStream };
        vi.doMock('fs', () => fsMock);
        vi.doMock('node:fs', () => fsMock);
        let harness: ReturnType<typeof makeRecorder>;
        try {
            vi.resetModules();
            const { default: RecorderModelClass } = (await import(
                pathToFileURL(join(compiledSnapshot, 'model', 'operator', 'recording', 'RecorderModel.js')).href
            )) as { default: new (...args: any[]) => any };
            harness = makeRecorder({ RecorderModelClass });
        } finally {
            vi.doUnmock('fs');
            vi.doUnmock('node:fs');
        }
        const reserve = makeReserve({ id: 4043 });
        harness.model.reserve = reserve;
        const stream = new PassThrough();
        harness.model.stream = stream;
        const started = harness.model.doRecord(null);
        await new Promise(resolve => setImmediate(resolve));
        expect(harness.model.recFile).toBe(fakeRecFile);
        stream.destroy(new Error('synthetic stream failure 4043'));
        await expect(started).rejects.toThrow('synthetic stream failure 4043');
        expect(logger.system.error).toHaveBeenCalledWith(`close recFile error: ${reserve.id}`);
    });

    it('doRecord logs when closing the reserved file handle fails while cancelling before recording starts', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-doRecord-filehandle-close-throw-'));
        const fullPath = join(root, 'synthetic.ts');
        const fileHandle = await open(fullPath, 'wx');
        const closeSpy = vi
            .spyOn(fileHandle, 'close')
            .mockRejectedValue(new Error('synthetic filehandle close failure 4044'));
        const harness = makeRecorder({
            recordingUtil: {
                getRecPath: vi.fn(async () => {
                    harness.model.isStopPrepRec = true;
                    return {
                        fileHandle,
                        fileName: 'synthetic.ts',
                        fullPath,
                        parendDir: { name: 'synthetic-root', path: root },
                        subDir: '',
                    };
                }),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
        });
        const reserve = makeReserve({ id: 4044 });
        harness.model.reserve = reserve;
        harness.model.stream = new PassThrough();
        try {
            await harness.model.doRecord(null);
            expect(logger.system.error).toHaveBeenCalledWith(`close recFile error: ${reserve.id}`);
            expect(closeSpy).toHaveBeenCalledOnce();
        } finally {
            // Restore the spy and remove the temporary root even if an assertion above throws, so
            // a failure here does not leak the mocked FileHandle.close or the temp directory into
            // later tests.
            closeSpy.mockRestore();
            await fileHandle.close().catch(() => {});
            await rm(root, { recursive: true, force: true });
        }
    });

    it('doRecord marks a late write-completion error as an unmanaged failure once cancellation already resolved the start', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-doRecord-late-write-after-cancel-'));
        const fullPath = join(root, 'synthetic.ts');
        const harness = makeRecorder({
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    fileName: 'synthetic.ts',
                    fullPath,
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
        });
        const reserve = makeReserve({ id: 4045 });
        harness.model.reserve = reserve;
        const stream = new PassThrough();
        harness.model.stream = stream;
        harness.model.recFailed = vi.fn(async () => undefined);
        const started = harness.model.doRecord(null);
        await new Promise(resolve => setImmediate(resolve));
        expect(harness.model.firstDataWait).not.toBeNull();

        await harness.model._cancel();
        await expect(started).resolves.toBeUndefined();
        expect(harness.model.videoFileFulPath).toBeNull();

        harness.model.recFile.emit('error', new Error('synthetic late write-completion 4045'));
        // The handler awaits the real recFile's own 'close' terminal (via cleanupUnstartedRecFile)
        // before reaching the isCanceledCallingFinished/recFailed branch, which real fs I/O can take
        // more than one microtask turn to settle. vi.waitFor is a time-bounded poll (unlike the
        // fixed 100x setImmediate cap in waitUntil, which flakes under load once real fs I/O takes
        // longer than that many microtask turns).
        await vi.waitFor(() => {
            expect(harness.model.recFailed).toHaveBeenCalledTimes(1);
        });

        expect(logger.system.error).toHaveBeenCalledWith(
            `recFile error reserveId: ${reserve.id}, recordedId: ${harness.model.recordedId}`,
        );
        expect(harness.model.isCanceledCallingFinished).toBe(true);
        expect(harness.model.recFailed).toHaveBeenCalledWith(expect.any(Error), null);
        await rm(root, { recursive: true, force: true });
    });

    it('doRecord falls back to cancel when a late write-completion error finds no stream to fail', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-doRecord-late-write-no-stream-'));
        const fullPath = join(root, 'synthetic.ts');
        const harness = makeRecorder({
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    fileName: 'synthetic.ts',
                    fullPath,
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
        });
        const reserve = makeReserve({ id: 4057 });
        harness.model.reserve = reserve;
        const stream = new PassThrough();
        harness.model.stream = stream;
        const started = harness.model.doRecord(null);
        await new Promise(resolve => setImmediate(resolve));
        expect(harness.model.firstDataWait).not.toBeNull();

        await harness.model._cancel();
        await expect(started).resolves.toBeUndefined();
        // Unlike the sibling case above, the stream reference itself is cleared directly (not just
        // destroyed) so the late error handler's own `this.stream === null` branch is the one hit.
        harness.model.stream = null;
        const cancelSpy = vi.spyOn(harness.model, 'cancel').mockResolvedValue(undefined);

        harness.model.recFile.emit('error', new Error('synthetic late write-completion 4057'));
        // Time-bounded poll instead of the fixed 100x setImmediate cap: the handler awaits the
        // real recFile's own 'close' terminal, whose real fs I/O timing is not a fixed tick count.
        await vi.waitFor(() => {
            expect(cancelSpy).toHaveBeenCalledTimes(1);
        });

        expect(cancelSpy).toHaveBeenCalledWith(false);
        expect(harness.model.isCanceledCallingFinished).toBe(false);
        await rm(root, { recursive: true, force: true });
    });

    it('doRecord fatally logs when the recFailed it dispatches for a late write-completion error itself rejects', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-doRecord-late-write-recfailed-throw-'));
        const fullPath = join(root, 'synthetic.ts');
        const harness = makeRecorder({
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    fileName: 'synthetic.ts',
                    fullPath,
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
        });
        const reserve = makeReserve({ id: 4058 });
        harness.model.reserve = reserve;
        const stream = new PassThrough();
        harness.model.stream = stream;
        harness.model.recFailed = vi.fn(async () => {
            throw new Error('synthetic recFailed failure 4058');
        });
        const started = harness.model.doRecord(null);
        await new Promise(resolve => setImmediate(resolve));

        await harness.model._cancel();
        await expect(started).resolves.toBeUndefined();

        harness.model.recFile.emit('error', new Error('synthetic late write-completion 4058'));
        // Time-bounded poll instead of the fixed 100x setImmediate cap: the handler awaits the
        // real recFile's own 'close' terminal, whose real fs I/O timing is not a fixed tick count.
        await vi.waitFor(() => {
            expect(logger.system.fatal).toHaveBeenCalledWith(
                `Unexpected recFailed error: reserveId: ${reserve.id}, recordedId: ${harness.model.recordedId}`,
            );
        });
        await rm(root, { recursive: true, force: true });
    });

    it('doRecord rejects with StreamIsNull when the stream is torn down while the drop checker starts', async () => {
        const dropCheckerGate = deferred<void>();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-doRecord-stream-null-dropcheck-'));
        const fullPath = join(root, 'synthetic.ts');
        const harness = makeRecorder({
            config: { isEnabledDropCheck: true },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    fileName: 'synthetic.ts',
                    fullPath,
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
        });
        harness.dropChecker.prepare = vi.fn(() => dropCheckerGate.promise);
        const reserve = makeReserve({ id: 4046 });
        harness.model.reserve = reserve;
        const stream = new PassThrough();
        harness.model.stream = stream;
        const started = harness.model.doRecord(null);
        await new Promise(resolve => setImmediate(resolve));
        harness.model.destroyStream();
        dropCheckerGate.resolve();
        await expect(started).rejects.toThrow('StreamIsNull');
        await rm(root, { recursive: true, force: true });
    });

    it('doRecord skips already-closed waiting-stream teardown for a stale replaced registration', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-registration-stale-closed-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const rejection = deferred<number>();
        const reserve = makeReserve();
        const original = makeRecordingSessionBinding(reserve, { generation: 1n, phase: 'Preparing', sessionToken: 7n });
        const replacement = makeRecordingSessionBinding(reserve, {
            generation: 2n,
            phase: 'Preparing',
            sessionToken: 7n,
        });
        const harness = makeRecorder({
            recordedDB: {
                insertOnce: vi.fn(async () => 21),
                deleteOnce: vi.fn(async () => undefined),
                removeRecording: vi.fn(async () => undefined),
                findId: vi.fn(),
                updateOnce: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'synthetic.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
            videoFileDB: { insertOnce: vi.fn(() => rejection.promise) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(original.binding);
        try {
            const preparation = harness.model.startPreparation();
            await waitUntil(() => original.state.phase === 'AwaitingFirstData', 'the old first-data gate');
            stream.write('synthetic first packet');
            await waitUntil(() => original.state.phase === 'Registering', 'the old registration phase');
            await waitUntil(() => harness.videoFileDB.insertOnce.mock.calls.length === 1, 'the old VideoFile insert');

            original.state.current = false;
            harness.model.bindScheduleSession(replacement.binding);
            stream.destroy();
            await waitUntil(() => stream.closed, 'the original stream to close');
            rejection.reject(new Error('synthetic stale registration rejection'));
            await preparation;

            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        } finally {
            await harness.model.cancel(false);
            await rm(root, { recursive: true, force: true });
        }
    });

    it('doRecord logs when tearing down a stale replaced waiting stream throws', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-registration-stale-teardown-throw-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const rejection = deferred<number>();
        const reserve = makeReserve();
        const original = makeRecordingSessionBinding(reserve, { generation: 1n, phase: 'Preparing', sessionToken: 7n });
        const replacement = makeRecordingSessionBinding(reserve, {
            generation: 2n,
            phase: 'Preparing',
            sessionToken: 7n,
        });
        const harness = makeRecorder({
            recordedDB: {
                insertOnce: vi.fn(async () => 21),
                deleteOnce: vi.fn(async () => undefined),
                removeRecording: vi.fn(async () => undefined),
                findId: vi.fn(),
                updateOnce: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'synthetic.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
            videoFileDB: { insertOnce: vi.fn(() => rejection.promise) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(original.binding);
        try {
            const preparation = harness.model.startPreparation();
            await waitUntil(() => original.state.phase === 'AwaitingFirstData', 'the old first-data gate');
            stream.write('synthetic first packet');
            await waitUntil(() => original.state.phase === 'Registering', 'the old registration phase');
            await waitUntil(() => harness.videoFileDB.insertOnce.mock.calls.length === 1, 'the old VideoFile insert');

            original.state.current = false;
            harness.model.bindScheduleSession(replacement.binding);
            stream.destroy = vi.fn(() => {
                throw new Error('synthetic destroy replaced stream failure 4053');
            });
            rejection.reject(new Error('synthetic stale registration rejection'));
            await preparation;

            expect(logger.system.error).toHaveBeenCalledWith(`destroy replaced stream error: ${reserve.id}`);
        } finally {
            // Restore a well-behaved destroy() before the shared cleanup below calls cancel(false),
            // which drives _cancel()'s isRecording branch to call stream.destroy() again for real
            // teardown; the poisoned mock above must not leak into that unrelated cleanup step.
            stream.destroy = vi.fn();
            await harness.model.cancel(false);
            await rm(root, { recursive: true, force: true });
        }
    });

    it('doRecord treats a registration as stale once the session leaves Registering without a replacement or cancel', async () => {
        // registrationOwner.intent only ever becomes non-'None' through _cancel()/stopForDeletion()
        // (recordRegistrationTerminationIntent) or bindScheduleSession's replacement promotion; none
        // of those run here. This drives the schedule phase away from Registering the way the real
        // RecordingScheduleController would for an unrelated reason (e.g. a due time-specified-end
        // milestone: `dispatchDueTimeSpecifiedEnds` transitions `session.phase -> 'Finishing'`
        // regardless of the session's current phase), by calling the fake binding's own
        // `tryTransition` directly -- so the registration's DB write completes for a session whose
        // phase moved on for a reason RecorderModel never recorded an intent for.
        const root = await mkdtemp(join(tmpdir(), 'epgstation-doRecord-stale-registration-no-intent-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const rejection = deferred<number>();
        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        const harness = makeRecorder({
            recordedDB: {
                insertOnce: vi.fn(async () => 21),
                removeRecording: vi.fn(async () => undefined),
                deleteOnce: vi.fn(async () => undefined),
                findId: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'synthetic.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
            videoFileDB: { insertOnce: vi.fn(() => rejection.promise), deleteOnce: vi.fn(async () => undefined) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        try {
            const preparation = harness.model.startPreparation();
            await waitUntil(() => session.state.phase === 'AwaitingFirstData', 'the first-data gate');
            stream.write('synthetic first packet');
            await waitUntil(() => session.state.phase === 'Registering', 'the registering phase');
            await waitUntil(() => harness.videoFileDB.insertOnce.mock.calls.length === 1, 'the pending VideoFile insert');

            session.binding.tryTransition('Registering', 'Finishing');
            rejection.reject(new Error('synthetic stale registration rejection (no intent)'));
            await preparation;

            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
            expect(harness.recordingEvent.emitRecordingFailed).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
            expect(session.state.phase).toBe('Finishing');
        } finally {
            await harness.model.cancel(false);
            stream.destroy();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('doRecord ignores a stale-registration settlement once a stream failure already resolved the start', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-doRecord-stale-registration-reentrant-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const rejection = deferred<number>();
        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        const harness = makeRecorder({
            recordedDB: {
                insertOnce: vi.fn(async () => 21),
                removeRecording: vi.fn(async () => undefined),
                deleteOnce: vi.fn(async () => undefined),
                findId: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'synthetic.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
            videoFileDB: { insertOnce: vi.fn(() => rejection.promise), deleteOnce: vi.fn(async () => undefined) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        try {
            const preparation = harness.model.startPreparation();
            await waitUntil(() => session.state.phase === 'AwaitingFirstData', 'the first-data gate');
            stream.write('synthetic first packet');
            await waitUntil(() => session.state.phase === 'Registering', 'the registering phase');
            await waitUntil(() => harness.videoFileDB.insertOnce.mock.calls.length === 1, 'the pending VideoFile insert');

            // A stream failure settles the outcome (outcomeSettled=true) while the registration is
            // still in flight; the still-pending registration's own eventual "stale, no intent"
            // rejection must then find takeOutcome() already consumed and quietly no-op.
            stream.destroy(new Error('synthetic stream failure during registration'));
            await waitUntil(() => harness.model.stream === null, 'the stream failure settlement');

            session.binding.tryTransition('Registering', 'Finishing');
            rejection.reject(new Error('synthetic stale registration rejection (reentrant)'));
            await preparation.catch(() => undefined);

            // The stream failure's own settleFailure() already ran cleanupRegistrationFailureResources
            // once (recordedId set, videoFileId still null at that moment), calling deleteOnce(21).
            // If settleStaleRegistrationFailure's takeOutcome() guard did not no-op here, it would run
            // that same cleanup a second time; asserting exactly one call proves it did not.
            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledTimes(1);
            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledWith(21);
        } finally {
            await harness.model.cancel(false);
            await rm(root, { recursive: true, force: true });
        }
    });

    it('doRecord discards a no-schedule registration that completes after cancellation while awaiting it', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-doRecord-no-schedule-late-registration-'));
        const fullPath = join(root, 'synthetic.ts');
        const videoInsert = deferred<number>();
        const harness = makeRecorder({
            recordedDB: {
                insertOnce: vi.fn(async () => 21),
                removeRecording: vi.fn(async () => undefined),
                deleteOnce: vi.fn(async () => undefined),
                findId: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    fileName: 'synthetic.ts',
                    fullPath,
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            videoFileDB: { deleteOnce: vi.fn(async () => undefined), insertOnce: vi.fn(() => videoInsert.promise) },
        });
        const reserve = makeReserve({ id: 4048 });
        harness.model.reserve = reserve;
        const stream = new PassThrough();
        harness.model.stream = stream;
        const started = harness.model.doRecord(null);
        await waitUntil(() => harness.model.recFile !== null, 'the record file');
        stream.write('synthetic first packet');
        await waitUntil(() => harness.recordedDB.insertOnce.mock.calls.length === 1, 'the recorded row insert');

        await harness.model._cancel();

        videoInsert.resolve(31);
        await expect(started).resolves.toBeUndefined();

        expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledWith(31);
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledWith(21);
        expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        await rm(root, { recursive: true, force: true });
    });

    it('doRecord logs when deleting the recorded row fails while unwinding a stream failure during registration', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-doRecord-remove-recording-flag-throw-'));
        const fullPath = join(root, 'synthetic.ts');
        const videoInsert = deferred<number>();
        const harness = makeRecorder({
            recordedDB: {
                insertOnce: vi.fn(async () => 21),
                deleteOnce: vi.fn(async () => {
                    throw new Error('synthetic recorded row delete failure 4054');
                }),
                findId: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    fileName: 'synthetic.ts',
                    fullPath,
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            videoFileDB: { deleteOnce: vi.fn(async () => undefined), insertOnce: vi.fn(() => videoInsert.promise) },
        });
        const reserve = makeReserve({ id: 4054 });
        harness.model.reserve = reserve;
        const stream = new PassThrough();
        harness.model.stream = stream;
        const started = harness.model.doRecord(null);
        await waitUntil(() => harness.model.recFile !== null, 'the record file');
        stream.write('synthetic first packet');
        // At this point the recorded row insert has resolved (id 21) but the VideoFile insert is
        // still pending on `videoInsert`, so `resources.videoFileId` is still null -- exactly the
        // condition `cleanupRegistrationFailureResources` checks before calling deleteOnce.
        await waitUntil(() => harness.videoFileDB.insertOnce.mock.calls.length === 1, 'the pending VideoFile insert');

        stream.destroy(new Error('synthetic stream failure 4054'));
        await expect(started).rejects.toThrow('synthetic stream failure 4054');

        expect(logger.system.error).toHaveBeenCalledWith('delete recorded error: 21');
        videoInsert.resolve(31);
        await rm(root, { recursive: true, force: true });
    });

    it('doRecord cancels quietly when the session cannot enter Registering on first data', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-doRecord-registering-transition-fails-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        const harness = makeRecorder({
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    fileName: 'synthetic.ts',
                    fullPath,
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        try {
            const preparation = harness.model.startPreparation();
            await waitUntil(() => session.state.phase === 'AwaitingFirstData', 'the first-data gate');
            session.binding.tryTransition = vi.fn(() => false);
            stream.write('synthetic first packet');
            await preparation;
            expect(harness.recordedDB.insertOnce).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        } finally {
            await harness.model.cancel(false);
            stream.destroy();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('doRecord fails the start when the stream is torn down directly while a no-schedule registration is pending', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-doRecord-stream-nulled-mid-registration-'));
        const fullPath = join(root, 'synthetic.ts');
        const insertGate = deferred<number>();
        const harness = makeRecorder({
            recordedDB: {
                insertOnce: vi.fn(() => insertGate.promise),
                removeRecording: vi.fn(async () => undefined),
                deleteOnce: vi.fn(async () => undefined),
                findId: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    fileName: 'synthetic.ts',
                    fullPath,
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
        });
        const reserve = makeReserve({ id: 4055 });
        harness.model.reserve = reserve;
        const stream = new PassThrough();
        harness.model.stream = stream;
        const started = harness.model.doRecord(null);
        await waitUntil(() => harness.model.recFile !== null, 'the record file');
        stream.write('synthetic first packet');
        await waitUntil(() => harness.recordedDB.insertOnce.mock.calls.length === 1, 'the recorded row insert');

        harness.model.stream = null;
        insertGate.resolve(56);
        await expect(started).rejects.toThrow('StreamIsNull');
        await rm(root, { recursive: true, force: true });
    });

    it('doRecord destroys a still-referenced stream from its own outer catch when destroyStream fails during settlement', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-doRecord-outer-catch-destroy-throw-'));
        const fullPath = join(root, 'synthetic.ts');
        const harness = makeRecorder({
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    fileName: 'synthetic.ts',
                    fullPath,
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
        });
        const reserve = makeReserve({ id: 4056 });
        harness.model.reserve = reserve;
        const stream = new PassThrough();
        harness.model.stream = stream;
        const started = harness.model.doRecord(null);
        await vi.advanceTimersByTimeAsync(0);
        stream.destroy = vi.fn(() => {
            throw new Error('synthetic stream destroy failure 4056');
        });
        await vi.advanceTimersByTimeAsync(5_000);
        await expect(started).rejects.toThrow('recordingStartError');
        expect(harness.model.stream).toBe(stream);
        expect(logger.system.error).toHaveBeenCalledWith(`destroy stream error: ${reserve.id}`);
        await rm(root, { recursive: true, force: true });
    });

    it('addRecorded cleans up and yields no row when deletion is requested right after the recorded row insert', async () => {
        const insertGate = deferred<number>();
        const harness = makeRecorder({
            recordedDB: {
                insertOnce: vi.fn(() => insertGate.promise),
                deleteOnce: vi.fn(async () => undefined),
            },
            videoFileDB: { deleteOnce: vi.fn(async () => undefined), insertOnce: vi.fn(async () => 31) },
        });
        const reserve = makeReserve({ id: 4052 });
        harness.model.reserve = reserve;
        const recPath = {
            fileName: 'x.ts',
            fullPath: '/synthetic-root-4052/x.ts',
            parendDir: { name: 'synthetic-root-4052', path: '/synthetic-root-4052' },
            subDir: '',
        };
        const addRecordedPromise = harness.model.addRecorded(recPath);
        await new Promise(resolve => setImmediate(resolve));
        harness.model.isPlanToDelete = true;
        insertGate.resolve(52);
        const result = await addRecordedPromise;
        expect(result).toBeNull();
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledWith(52);
        expect(harness.videoFileDB.insertOnce).not.toHaveBeenCalled();
    });

    it('settleFailure ignores a second failure trigger once the first has already taken the outcome', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-doRecord-settleFailure-reentrant-'));
        const fullPath = join(root, 'synthetic.ts');
        const registrationGate = deferred<number>();
        const harness = makeRecorder({
            recordedDB: {
                insertOnce: vi.fn(() => registrationGate.promise),
                deleteOnce: vi.fn(async () => undefined),
                removeRecording: vi.fn(async () => undefined),
                findId: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    fileName: 'synthetic.ts',
                    fullPath,
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
        });
        const reserve = makeReserve({ id: 4059 });
        harness.model.reserve = reserve;
        const stream = new PassThrough();
        harness.model.stream = stream;
        const destroyStreamSpy = vi.spyOn(harness.model, 'destroyStream');
        const started = harness.model.doRecord(null);
        await waitUntil(() => harness.model.recFile !== null, 'the record file');
        stream.write('synthetic first packet');
        await waitUntil(() => harness.recordedDB.insertOnce.mock.calls.length === 1, 'the pending recorded row insert');

        // First settlement: the underlying stream fails while onData's `await registration` (L1061)
        // is still pending. onStreamError -> settleFailure takes the outcome (takeOutcome() succeeds,
        // synchronously clearing this.stream's listeners/timer and calling destroyStream()).
        stream.destroy(new Error('synthetic first settlement failure 4059'));
        await waitUntil(() => destroyStreamSpy.mock.calls.length === 1, 'the first settleFailure to run destroyStream');

        // Second trigger: the still-pending registration now rejects. Since scheduledSession is null
        // here, registrationOwner stays null throughout, so onData's catch falls through to the
        // `else` branch (L1074-1077) and calls settleFailure a second time with the registration's
        // own error. That second call's own `if (!takeOutcome()) return;` (L965) must find the
        // outcome already taken and return immediately, touching nothing else.
        registrationGate.reject(new Error('synthetic registration failure 4059 (should be ignored)'));

        await expect(started).rejects.toThrow('synthetic first settlement failure 4059');
        expect(destroyStreamSpy).toHaveBeenCalledTimes(1);
        await rm(root, { recursive: true, force: true });
    });

    it('the registration watchdog is a no-op once its tracked owner no longer matches the (replaced) current schedule', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-doRecord-watchdog-replaced-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const reserve = makeReserve();
        const original = makeRecordingSessionBinding(reserve, { generation: 1n, phase: 'Preparing', sessionToken: 7n });
        const replacement = makeRecordingSessionBinding(reserve, {
            generation: 2n,
            phase: 'Preparing',
            sessionToken: 7n,
        });
        const harness = makeRecorder({
            recordedDB: {
                insertOnce: vi.fn(async () => 21),
                deleteOnce: vi.fn(async () => undefined),
                removeRecording: vi.fn(async () => undefined),
                findId: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'synthetic.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
            // Never resolves: the registration stays pending past the ten-minute watchdog deadline.
            videoFileDB: { insertOnce: vi.fn(() => new Promise<number>(() => {})) },
        });
        // The shared waitUntil()/flushImmediate() helpers poll via a real setImmediate, which fake
        // timers intercept too, so this test polls by advancing the fake clock by zero instead.
        const pollFakeUntil = async (condition: () => boolean, description: string): Promise<void> => {
            for (let turn = 0; turn < 200; turn += 1) {
                if (condition()) return;
                await vi.advanceTimersByTimeAsync(0);
            }
            throw new Error(`Timed out waiting for ${description}`);
        };
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(original.binding);
        try {
            harness.model.startPreparation();
            await pollFakeUntil(() => original.state.phase === 'AwaitingFirstData', 'the first-data gate');
            stream.write('synthetic first packet');
            await pollFakeUntil(() => original.state.phase === 'Registering', 'the registering phase');
            await pollFakeUntil(() => harness.videoFileDB.insertOnce.mock.calls.length === 1, 'the pending VideoFile insert');

            // Replace the session (same reservation/token, new generation) while the registration is
            // still in flight. This promotes the tracked registrationOwner's intent to 'Replacement'
            // (bindScheduleSession's own promotion logic) and, more importantly for this branch,
            // means the *current* schedule's generation (2n) no longer matches the generation (1n)
            // captured by registrationOwner when it was created -- matchesRegistrationOwner will
            // return false once the watchdog checks it.
            harness.model.bindScheduleSession(replacement.binding);
            const originalTryTransitionSpy = vi.spyOn(original.binding, 'tryTransition');
            const replacementTryTransitionSpy = vi.spyOn(replacement.binding, 'tryTransition');
            const matchesRegistrationOwnerSpy = vi.spyOn(harness.model, 'matchesRegistrationOwner');

            await vi.advanceTimersByTimeAsync(600_000);

            // Prove the watchdog actually reached and evaluated matchesRegistrationOwner (rather
            // than returning early for an unrelated reason) and that it returned false -- the
            // specific outcome this test's title claims -- not just that tryTransition was never
            // called, which could also happen if the watchdog callback never ran at all.
            expect(matchesRegistrationOwnerSpy).toHaveBeenCalledTimes(1);
            expect(matchesRegistrationOwnerSpy).toHaveReturnedWith(false);
            expect(originalTryTransitionSpy).not.toHaveBeenCalledWith('Registering', 'RegistrationOverdue');
            expect(replacementTryTransitionSpy).not.toHaveBeenCalledWith('Registering', 'RegistrationOverdue');
            expect(replacement.state.phase).toBe('Preparing');
            expect(original.state.phase).toBe('Registering');
        } finally {
            await harness.model.cancel(false);
            stream.destroy();
            await rm(root, { recursive: true, force: true });
        }
    });
});
