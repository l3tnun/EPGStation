import { mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { deferred, makeRecorder, makeRecordingSessionBinding, makeReserve, Recorded } from './_harness';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

describe('recording start persistence', () => {
    it('[RE-4.3][Task 5.1] registers the recorded row before its video file', async () => {
        const ledger: string[] = [];
        const harness = makeRecorder({
            recordedDB: {
                insertOnce: vi.fn(async () => (ledger.push('recorded'), 21)),
                removeRecording: vi.fn(),
                findId: vi.fn(),
            },
            videoFileDB: { insertOnce: vi.fn(async () => (ledger.push('video'), 31)) },
        });
        harness.model.reserve = makeReserve();
        harness.model.createRecorded = vi.fn(async () => Object.assign(new Recorded(), { id: 0 }));
        const result = await harness.model.addRecorded({
            parendDir: { name: 'synthetic-root', path: '/synthetic-root' },
            subDir: 'synthetic-subdir',
            fileName: 'synthetic.ts',
            fullPath: '/synthetic-root/synthetic.ts',
        });
        expect(ledger).toEqual(['recorded', 'video']);
        expect(result.videoFiles[0]).toMatchObject({ recordedId: 21, filePath: 'synthetic-subdir/synthetic.ts' });
    });

    it('[RE-4.4][Task 5.1] pipes once and publishes start only after first-data persistence', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-start-'));
        const fullPath = join(root, 'synthetic.ts');
        const ledger: string[] = [];
        const stream = new PassThrough();
        const harness = makeRecorder({
            config: { isEnabledDropCheck: true },
            recordedDB: {
                insertOnce: vi.fn(async () => (ledger.push('recorded'), 21)),
                removeRecording: vi.fn(),
                findId: vi.fn(),
            },
            videoFileDB: { insertOnce: vi.fn(async () => (ledger.push('video'), 31)) },
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
        });
        harness.recordingEvent.emitStartRecording.mockImplementation(() => ledger.push('event'));
        harness.model.reserve = makeReserve();
        harness.model.stream = stream;
        const pipe = vi.spyOn(stream, 'pipe');
        try {
            const started = harness.model.doRecord();
            await new Promise(resolve => setImmediate(resolve));
            stream.write(Buffer.from('synthetic-first-'));
            await started;
            stream.write(Buffer.from('synthetic-second'));
            expect(ledger).toEqual(['recorded', 'video', 'event']);
            expect(pipe).toHaveBeenCalledOnce();
            expect(harness.dropChecker.prepare).toHaveBeenCalledWith('/synthetic-drop', fullPath);
            expect(harness.dropChecker.attach).toHaveBeenCalledWith(fullPath, stream);
            expect(harness.recordingEvent.emitStartRecording).toHaveBeenCalledOnce();
            const writer = harness.model.recFile;
            const finished = once(writer, 'finish');
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await finished;
            expect(await readFile(fullPath, 'utf8')).toBe('synthetic-first-synthetic-second');
        } finally {
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 4.3] writes through the exclusively reserved handle without reopening the path for append', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-handle-'));
        const fullPath = join(root, 'synthetic.ts');
        const fileHandle = await open(fullPath, 'wx');
        const stream = new PassThrough();
        const reservation = vi.fn(async () => ({
            parendDir: { name: 'synthetic-root', path: root },
            subDir: '',
            fileName: 'synthetic.ts',
            fullPath,
            fileHandle,
        }));
        const harness = makeRecorder({ recordingUtil: { getRecPath: reservation } });
        harness.model.reserve = makeReserve();
        harness.model.stream = stream;
        const createWriteStream = vi.spyOn(fileHandle, 'createWriteStream');
        try {
            const started = harness.model.doRecord();
            await new Promise(resolve => setImmediate(resolve));
            stream.write('synthetic-data');
            await started;
            const writer = harness.model.recFile;
            const closed = once(writer, 'close');
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await closed;

            expect(reservation).toHaveBeenCalledWith(harness.model.reserve, true, true);
            expect(createWriteStream).toHaveBeenCalledOnce();
            expect(await readFile(fullPath, 'utf8')).toBe('synthetic-data');
            await expect(fileHandle.writeFile('late write')).rejects.toThrow();
        } finally {
            createWriteStream.mockRestore();
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 4.3] retains the exclusive-create fallback for legacy path-only consumers', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-exclusive-fallback-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const reservation = vi.fn(async () => ({
            parendDir: { name: 'synthetic-root', path: root },
            subDir: '',
            fileName: 'synthetic.ts',
            fullPath,
        }));
        // `RecorderModel.js` (a compiled ES module) does `import * as fs from 'fs'` and calls
        // `fs.createWriteStream(...)` directly. That binding resolves once, the first time this
        // builtin's ES module facade is created for the whole process -- which already happened
        // (via something else entirely, before this suite's own code even runs) by the time this
        // test executes -- so neither `vi.spyOn(require('fs'), 'createWriteStream')` nor a plain
        // property reassignment on `require('fs')` is ever seen by RecorderModel's own binding.
        // `vi.doMock` + `vi.resetModules()` + a dynamic `import()` of the compiled model is the
        // mechanism that actually lands a replacement (same pattern as
        // `media-delivery/_media-harness.ts`'s `prepareRecordedDeliveryFsMocks` and
        // `service-interface/imp/upload-lifecycle.test.ts`), so this test reloads its own private
        // copy of `RecorderModel` under a mocked `fs` instead.
        const realFs = require('fs') as typeof import('fs');
        const createWriteStream = vi.fn((...args: Parameters<typeof realFs.createWriteStream>) =>
            realFs.createWriteStream(...args),
        );
        const fsMock = { ...realFs, createWriteStream };
        vi.doMock('fs', () => fsMock);
        vi.doMock('node:fs', () => fsMock);
        let harness: ReturnType<typeof makeRecorder>;
        try {
            vi.resetModules();
            const { default: RecorderModelClass } = (await import(
                pathToFileURL(join(compiledSnapshot, 'model', 'operator', 'recording', 'RecorderModel.js')).href
            )) as { default: new (...args: any[]) => any };
            harness = makeRecorder({ RecorderModelClass, recordingUtil: { getRecPath: reservation } });
        } finally {
            vi.doUnmock('fs');
            vi.doUnmock('node:fs');
        }
        harness.model.reserve = makeReserve();
        harness.model.stream = stream;
        try {
            const started = harness.model.doRecord();
            await new Promise(resolve => setImmediate(resolve));
            stream.write('synthetic-data');
            await started;
            const writer = harness.model.recFile;
            const closed = once(writer, 'close');
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await closed;

            expect(reservation).toHaveBeenCalledWith(harness.model.reserve, true, true);
            expect(createWriteStream).toHaveBeenCalledWith(fullPath, { flags: 'wx' });
            expect(await readFile(fullPath, 'utf8')).toBe('synthetic-data');
        } finally {
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[RE-4.1][Task 5.1] preserves the exact doRecord first-data milestone order', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-order-'));
        const fullPath = join(root, 'synthetic.ts');
        const ledger: string[] = [];
        const stream = new PassThrough();
        const harness = makeRecorder({
            config: { isEnabledDropCheck: true },
            recordedDB: {
                insertOnce: vi.fn(async () => (ledger.push('recorded-row'), 21)),
                removeRecording: vi.fn(),
                findId: vi.fn(),
            },
            videoFileDB: { insertOnce: vi.fn(async () => (ledger.push('video-file-row'), 31)) },
            dropChecker: {
                prepare: vi.fn(async () => {
                    ledger.push('drop-check');
                }),
                attach: vi.fn(),
                stop: vi.fn(async () => undefined),
                getFilePath: vi.fn(() => null),
                getResult: vi.fn(async () => ({})),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => {
                    ledger.push('path');
                    return {
                        parendDir: { name: 'synthetic-root', path: root },
                        subDir: '',
                        fileName: 'synthetic.ts',
                        fullPath,
                    };
                }),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn().mockResolvedValue(undefined),
            },
        });
        harness.model.reserve = makeReserve();
        harness.model.stream = stream;
        harness.model.eventEmitter.once('StartRecordingEvent', () => ledger.push('internal-start'));
        const originalPipe = stream.pipe.bind(stream);
        vi.spyOn(stream, 'pipe').mockImplementation((destination: any, options?: any) => {
            ledger.push('writer');
            ledger.push('pipe');
            return originalPipe(destination, options);
        });
        harness.model.setEndProcess = vi.fn(() => ledger.push('end-listener'));
        harness.recordingEvent.emitStartRecording.mockImplementation(() => ledger.push('external-start'));
        harness.model.setEventRelayTimer = vi.fn(() => ledger.push('relay-timer'));
        try {
            const started = harness.model.doRecord();
            await new Promise(resolve => setImmediate(resolve));
            expect(ledger).toEqual(['internal-start', 'path', 'drop-check', 'writer', 'pipe']);
            stream.write('synthetic-first-data');
            await started;
            expect(ledger).toEqual([
                'internal-start',
                'path',
                'drop-check',
                'writer',
                'pipe',
                'recorded-row',
                'video-file-row',
                'end-listener',
                'external-start',
                'relay-timer',
            ]);
        } finally {
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[RE-4.2][Task 5.1] removes the partial file after the five-second first-data timeout', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-timeout-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
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
        });
        harness.model.reserve = makeReserve();
        harness.model.stream = stream;
        try {
            const started = harness.model.doRecord();
            const rejected = expect(started).rejects.toThrow('recordingStartError');
            await vi.advanceTimersByTimeAsync(4_999);
            expect(harness.recordedDB.insertOnce).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            await rejected;
            await vi.waitFor(() => expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' }));
            stream.write('synthetic-late-data');
            await Promise.resolve();
            expect(harness.recordedDB.insertOnce).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 5.3][RE-4.7] settles the start and deletes the recorded row when video-file registration rejects after the recorded row exists', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-registration-reject-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const failure = new Error('synthetic video-file registration rejection');
        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
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
                updateVideoFileSize: vi.fn().mockResolvedValue(undefined),
            },
            videoFileDB: { insertOnce: vi.fn(async () => Promise.reject(failure)) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.stream = stream;
        harness.model.setEndProcess = vi.fn();
        harness.model.setEventRelayTimer = vi.fn();
        const once = vi.spyOn(stream, 'once');
        const destroyStream = vi.spyOn(harness.model, 'destroyStream');
        try {
            const started = harness.model.doRecord();
            await new Promise(resolve => setImmediate(resolve));
            const dataListener = once.mock.calls.find(([event]) => event === 'data')?.[1] as
                | (() => Promise<void>)
                | undefined;

            expect(dataListener).toBeTypeOf('function');
            await expect(dataListener!()).resolves.toBeUndefined();
            await expect(started).rejects.toThrow('AddRecordedDBError');

            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
            expect(harness.recordedDB.removeRecording).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            expect(harness.model.setEndProcess).not.toHaveBeenCalled();
            expect(harness.model.setEventRelayTimer).not.toHaveBeenCalled();
            expect(destroyStream).toHaveBeenCalledOnce();
            expect(stream.destroyed).toBe(true);
            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            destroyStream.mockRestore();
            once.mockRestore();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 5.5][RE-4.9] keeps one pending registration owned through 600 seconds and settles its late success once', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-registration-overdue-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const videoInsert = deferred<number>();
        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        const harness = makeRecorder({
            recordedDB: { insertOnce: vi.fn(async () => 21), removeRecording: vi.fn(), findId: vi.fn() },
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
            videoFileDB: { insertOnce: vi.fn(() => videoInsert.promise) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
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
            expect(harness.videoFileDB.insertOnce).toHaveBeenCalledOnce();

            await vi.advanceTimersByTimeAsync(599_999);
            expect(session.state.phase).toBe('Registering');
            expect(harness.model.stream).toBe(stream);
            expect(harness.model.recFile).not.toBeNull();
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1);
            expect(session.state.phase).toBe('RegistrationOverdue');
            expect(harness.videoFileDB.insertOnce).toHaveBeenCalledOnce();
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();

            videoInsert.resolve(31);
            await started;

            expect(session.state.phase).toBe('Recording');
            expect(harness.videoFileDB.insertOnce).toHaveBeenCalledOnce();
            expect(harness.model.setEndProcess).toHaveBeenCalledOnce();
            expect(harness.recordingEvent.emitStartRecording).toHaveBeenCalledOnce();
        } finally {
            videoInsert.resolve(31);
            await started.catch(() => undefined);
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            vi.useRealTimers();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 5.5][RE-4.9][RE-4.10] settles before the deadline and does not apply the watchdog to the active stream body', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-registration-before-deadline-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const videoInsert = deferred<number>();
        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        const harness = makeRecorder({
            recordedDB: { insertOnce: vi.fn(async () => 21), removeRecording: vi.fn(), findId: vi.fn() },
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
            videoFileDB: { insertOnce: vi.fn(() => videoInsert.promise) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.stream = stream;
        harness.model.setEndProcess = vi.fn();
        harness.model.setEventRelayTimer = vi.fn();
        const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

        const started = harness.model.doRecord();
        try {
            await vi.waitFor(() => expect(harness.model.recFile).not.toBeNull());
            stream.write('synthetic first packet');
            for (let turn = 0; turn < 5 && harness.videoFileDB.insertOnce.mock.calls.length === 0; turn += 1) {
                await Promise.resolve();
            }
            expect(harness.videoFileDB.insertOnce).toHaveBeenCalledOnce();

            clearTimeoutSpy.mockClear();
            await vi.advanceTimersByTimeAsync(599_999);
            videoInsert.resolve(31);
            await started;

            expect(session.state.phase).toBe('Recording');
            expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);
            expect(harness.model.setEndProcess).toHaveBeenCalledOnce();
            expect(harness.recordingEvent.emitStartRecording).toHaveBeenCalledOnce();

            await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
            expect(session.state.phase).toBe('Recording');
            expect(harness.model.stream).toBe(stream);
            expect(harness.model.recFile).not.toBeNull();
            expect(harness.recordingEvent.emitStartRecording).toHaveBeenCalledOnce();
        } finally {
            videoInsert.resolve(31);
            await started.catch(() => undefined);
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            clearTimeoutSpy.mockRestore();
            vi.useRealTimers();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 5.3][RE-4.8] makes a pre-data stream error the only start outcome', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-stream-error-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const failure = new Error('synthetic stream failure');
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
        });
        harness.model.reserve = makeReserve();
        harness.model.stream = stream;
        try {
            const started = harness.model.doRecord();
            await new Promise(resolve => setImmediate(resolve));
            stream.emit('error', failure);
            await expect(started).rejects.toBe(failure);

            expect(harness.recordedDB.insertOnce).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });

            stream.write('synthetic late data');
            expect(harness.recordedDB.insertOnce).not.toHaveBeenCalled();
        } finally {
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 5.3][RE-4.8] lets a writer error win while drop-check setup is still pending', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-writer-before-gate-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const dropStart = deferred<void>();
        const failure = new Error('synthetic writer failure before first-data gate');
        const harness = makeRecorder({
            config: { isEnabledDropCheck: true },
            dropChecker: {
                prepare: vi.fn(() => dropStart.promise),
                attach: vi.fn(),
                stop: vi.fn(async () => undefined),
                getFilePath: vi.fn(() => null),
                getResult: vi.fn(async () => ({})),
            },
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
        });
        harness.model.reserve = makeReserve();
        harness.model.stream = stream;
        const recFailed = vi.spyOn(harness.model, 'recFailed');
        try {
            const started = harness.model.doRecord();
            await vi.waitFor(() => expect(harness.dropChecker.prepare).toHaveBeenCalledOnce());
            harness.model.recFile.emit('error', failure);
            dropStart.resolve();

            await expect(started).rejects.toBe(failure);
            expect(recFailed).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            recFailed.mockRestore();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 5.1/6.1] routes a writer error into failure finalization exactly once', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-writer-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
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
        });
        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.stream = stream;
        harness.model.recFailed = vi.fn(async () => {
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
        });
        try {
            const started = harness.model.doRecord();
            await new Promise(resolve => setImmediate(resolve));
            stream.write('synthetic-data');
            await started;
            const failure = new Error('synthetic writer failure');
            harness.model.recFile.emit('error', failure);
            await new Promise(resolve => setImmediate(resolve));
            expect(harness.model.recFailed).toHaveBeenCalledOnce();
            expect(harness.model.recFailed).toHaveBeenCalledWith(failure, session.binding);
        } finally {
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await rm(root, { recursive: true, force: true });
        }
    });

    it.each(['recorded', 'video'])(
        '[Task 5.1] cleans the exact partial file when %s persistence rejects',
        async failedPort => {
            const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-registration-'));
            const fullPath = join(root, 'synthetic.ts');
            const failure = new Error(`synthetic ${failedPort} registration failure`);
            await writeFile(fullPath, 'synthetic-partial', 'utf8');
            const stream = new PassThrough();
            const harness = makeRecorder(
                failedPort === 'recorded'
                    ? { recordedDB: { insertOnce: vi.fn(async () => Promise.reject(failure)) } }
                    : { videoFileDB: { insertOnce: vi.fn(async () => Promise.reject(failure)) } },
            );
            harness.model.reserve = makeReserve();
            harness.model.stream = stream;
            await expect(
                harness.model.addRecorded({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'synthetic.ts',
                    fullPath,
                }),
            ).rejects.toThrow('AddRecordedDBError');
            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
            expect(stream.destroyed).toBe(true);
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            expect(harness.videoFileDB.insertOnce).toHaveBeenCalledTimes(failedPort === 'video' ? 1 : 0);
            await rm(root, { recursive: true, force: true });
        },
    );

    it('[Task 5.1] uses no drop resources when disabled and contains checker/log registration failures when enabled', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-drop-'));
        const pathFor = (name: string) => ({
            parendDir: { name: 'synthetic-root', path: root },
            subDir: '',
            fileName: name,
            fullPath: join(root, name),
        });
        const disabledStream = new PassThrough();
        const disabled = makeRecorder({ recordingUtil: { getRecPath: vi.fn(async () => pathFor('disabled.ts')) } });
        disabled.model.reserve = makeReserve();
        disabled.model.stream = disabledStream;
        const disabledStart = disabled.model.doRecord();
        await new Promise(resolve => setImmediate(resolve));
        disabledStream.write('synthetic-disabled');
        await disabledStart;
        expect(disabled.dropChecker.prepare).not.toHaveBeenCalled();
        expect(disabled.dropChecker.attach).not.toHaveBeenCalled();
        expect(disabled.dropLogFileDB.insertOnce).not.toHaveBeenCalled();
        disabled.model.isCanceledCallingFinished = true;
        disabled.model.destroyStream();
        expect(disabled.dropChecker.stop).not.toHaveBeenCalled();

        const checkerStream = new PassThrough();
        const checkerFailure = makeRecorder({
            config: { isEnabledDropCheck: true },
            dropChecker: {
                prepare: vi.fn(async () => Promise.reject(new Error('synthetic checker failure'))),
                attach: vi.fn(),
                stop: vi.fn(async () => undefined),
                getFilePath: vi.fn(() => null),
                getResult: vi.fn(async () => ({})),
            },
            recordingUtil: { getRecPath: vi.fn(async () => pathFor('checker-failure.ts')) },
        });
        checkerFailure.model.reserve = makeReserve();
        checkerFailure.model.stream = checkerStream;
        const checkerStart = checkerFailure.model.doRecord();
        await new Promise(resolve => setImmediate(resolve));
        checkerStream.write('synthetic-checker-failure');
        await checkerStart;
        expect(checkerFailure.dropChecker.prepare).toHaveBeenCalledOnce();
        expect(checkerFailure.dropChecker.attach).not.toHaveBeenCalled();
        expect(checkerFailure.dropLogFileDB.insertOnce).not.toHaveBeenCalled();
        checkerFailure.model.isCanceledCallingFinished = true;
        checkerFailure.model.destroyStream();

        const attachStream = new PassThrough();
        const attachFailure = makeRecorder({
            config: { isEnabledDropCheck: true },
            dropChecker: {
                prepare: vi.fn(async () => undefined),
                attach: vi.fn(() => {
                    throw new Error('synthetic attach failure');
                }),
                stop: vi.fn(async () => undefined),
                getFilePath: vi.fn(() => '/synthetic-drop/synthetic.log'),
                getResult: vi.fn(async () => ({})),
            },
            recordingUtil: { getRecPath: vi.fn(async () => pathFor('attach-failure.ts')) },
        });
        attachFailure.model.reserve = makeReserve();
        attachFailure.model.stream = attachStream;
        const attachStart = attachFailure.model.doRecord();
        await new Promise(resolve => setImmediate(resolve));
        attachStream.write('synthetic-attach-failure');
        await attachStart;
        expect(attachFailure.dropChecker.attach).toHaveBeenCalledOnce();
        expect(attachFailure.dropLogFileDB.insertOnce).not.toHaveBeenCalled();
        expect(attachFailure.model.isDropCheckerActive).toBe(false);
        attachFailure.model.isCanceledCallingFinished = true;
        attachFailure.model.destroyStream();

        const logStream = new PassThrough();
        const logFailure = makeRecorder({
            config: { isEnabledDropCheck: true },
            dropChecker: {
                prepare: vi.fn(async () => undefined),
                attach: vi.fn(),
                stop: vi.fn(async () => undefined),
                getFilePath: vi.fn(() => '/synthetic-drop/synthetic.log'),
                getResult: vi.fn(async () => ({})),
            },
            dropLogFileDB: { insertOnce: vi.fn(async () => Promise.reject(new Error('synthetic log failure'))) },
            recordingUtil: { getRecPath: vi.fn(async () => pathFor('log-failure.ts')) },
        });
        logFailure.model.reserve = makeReserve();
        logFailure.model.stream = logStream;
        const logStart = logFailure.model.doRecord();
        await new Promise(resolve => setImmediate(resolve));
        logStream.write('synthetic-log-failure');
        await logStart;
        expect(logFailure.dropChecker.prepare).toHaveBeenCalledOnce();
        expect(logFailure.dropChecker.attach).toHaveBeenCalledOnce();
        expect(logFailure.dropLogFileDB.insertOnce).toHaveBeenCalledOnce();
        expect(logFailure.model.dropLogFileId).toBeNull();
        logFailure.model.isCanceledCallingFinished = true;
        logFailure.model.destroyStream();
        await rm(root, { recursive: true, force: true });
    });

    it('[RE-4.6][Task 5.1] forwards only relay metadata and a shallow parent reservation copy', async () => {
        const reserve = makeReserve({ id: 91, programId: 901 });
        const harness = makeRecorder({
            tunerServerAccess: {
                getProgram: vi.fn(async () => ({
                    networkId: 1,
                    relatedItems: [
                        { type: 'shared', serviceId: 2, eventId: 3 },
                        { type: 'relay', networkId: null, serviceId: 4, eventId: 5 },
                    ],
                })),
            },
            programDB: {
                findId: vi.fn(),
                findChannelIdAndTime: vi.fn(),
                findEventRelayProgram: vi.fn(async () => ({ id: 902 })),
            },
        });
        harness.model.reserve = reserve;
        await harness.model.checkEventRelay();
        expect(harness.programDB.findEventRelayProgram).toHaveBeenCalledWith(1, 4, 5);
        const payload = harness.recordingEvent.emitEventRelay.mock.calls[0][0];
        expect(payload).toEqual([{ programId: 902, parentReserve: expect.objectContaining({ id: 91 }) }]);
        expect(payload[0].parentReserve).not.toBe(reserve);
    });

    it('[Task 2.1/4.5 known characteristic] resolves the reservation update before a rejected recorded update settles', async () => {
        const failure = new Error('synthetic recorded update rejection');
        const updateResult = deferred<void>();
        const observed = updateResult.promise.catch(error => error);
        const harness = makeRecorder({ recordedDB: { updateOnce: vi.fn(() => updateResult.promise) } });
        harness.model.reserve = makeReserve();
        harness.model.recordedId = 21;
        harness.model.isRecording = true;
        await expect(
            harness.model.update(makeReserve({ name: 'synthetic-rejected-update' }), false),
        ).resolves.toBeUndefined();
        updateResult.reject(failure);
        await expect(observed).resolves.toBe(failure);
    });

    it('[RE-4.5][Task 2.1] requests the changed program information for the recorded row and keeps receiving after the request rejects', async () => {
        const failure = new Error('synthetic recorded update rejection');
        const stream = new PassThrough();
        const firstResult = deferred<void>();
        const updateOnce = vi
            .fn(async (_recorded: any): Promise<void> => Promise.reject(failure))
            .mockImplementationOnce(() => firstResult.promise);
        const harness = makeRecorder({ recordedDB: { updateOnce } });
        harness.model.reserve = makeReserve();
        harness.model.recordedId = 21;
        harness.model.isRecording = true;
        harness.model.stream = stream;
        const systemLog = (harness.model as any).log.system;
        systemLog.error.mockClear();
        const unhandledRejections: unknown[] = [];
        const recordUnhandled = (reason: unknown) => unhandledRejections.push(reason);
        process.prependListener('unhandledRejection', recordUnhandled);
        try {
            await expect(
                harness.model.update(makeReserve({ name: 'synthetic-first-update' }), false),
            ).resolves.toBeUndefined();
            expect(updateOnce).toHaveBeenCalledOnce();
            expect(updateOnce.mock.calls[0][0]).toMatchObject({ id: 21, name: 'synthetic-first-update' });
            // 要求を出した後・reject の前に recordedId が変わっても、要求時点の録画 ID で記録される
            harness.model.recordedId = null;
            firstResult.reject(failure);
            await new Promise(resolve => setImmediate(resolve));
            expect(systemLog.error.mock.calls).toEqual([['update recorded error: 21'], [failure]]);
            expect(unhandledRejections).toEqual([]);
            expect(stream.destroyed).toBe(false);
            expect(harness.model.stream).toBe(stream);
            expect(harness.streamCreator.create).not.toHaveBeenCalled();

            harness.model.recordedId = 21;
            await expect(
                harness.model.update(makeReserve({ name: 'synthetic-second-update' }), false),
            ).resolves.toBeUndefined();
            expect(updateOnce).toHaveBeenCalledTimes(2);
            expect(updateOnce.mock.calls[1][0]).toMatchObject({ id: 21, name: 'synthetic-second-update' });
            await new Promise(resolve => setImmediate(resolve));
            expect(systemLog.error.mock.calls).toEqual([
                ['update recorded error: 21'],
                [failure],
                ['update recorded error: 21'],
                [failure],
            ]);
            expect(unhandledRejections).toEqual([]);
            expect(stream.destroyed).toBe(false);
        } finally {
            process.off('unhandledRejection', recordUnhandled);
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
        }
    });
});
