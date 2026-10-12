import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    deferred,
    makeRecorder,
    makeRecordingSessionBinding,
    makeReserve,
    makeStreamCreator,
    RecordingEvent,
    RecordingManageModel,
    RecordingUtilModel,
    logger,
} from './_harness';

describe('[source-contract-differences] isolated recording preparation characteristics', () => {
    it('[Task 3.1 known characteristic] only checks persisted existence after stream acquisition', async () => {
        const harness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => makeReserve({ isSkip: true, endAt: 0 })) },
        });
        harness.model.reserve = makeReserve();
        harness.model.doRecord = vi.fn(async () => undefined);
        await harness.model.prepRecord();
        expect(harness.model.doRecord).toHaveBeenCalledOnce();
    });

    it('[Task 5.3][RE-4.7] settles the actual data listener registration rejection without publishing start', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-registration-characteristic-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const failure = new Error('synthetic recorded registration failure');
        const harness = makeRecorder({
            recordedDB: {
                insertOnce: vi.fn(async () => Promise.reject(failure)),
                removeRecording: vi.fn(),
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
        });
        harness.model.reserve = makeReserve();
        harness.model.stream = stream;
        const once = vi.spyOn(stream, 'once');
        try {
            const started = harness.model.doRecord();
            await new Promise(resolve => setImmediate(resolve));
            const dataListener = once.mock.calls.find(([event]) => event === 'data')?.[1] as
                | (() => Promise<void>)
                | undefined;
            expect(dataListener).toBeTypeOf('function');
            await expect(dataListener!()).resolves.toBeUndefined();
            await expect(started).rejects.toThrow('AddRecordedDBError');
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
            expect(stream.destroyed).toBe(true);
        } finally {
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await rm(root, { recursive: true, force: true });
        }
    });

    it.each(['late success', 'late failure'] as const)(
        '[Task 8.2] fences an overdue path selection until its actual %s terminal',
        async outcome => {
            vi.useFakeTimers();
            const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-path-overdue-process-'));
            const stream = new PassThrough();
            const channel = deferred<any>();
            const execution = { getExecution: vi.fn(async () => 821), unLockExecution: vi.fn() };
            const reserve = makeReserve({ id: outcome === 'late success' ? 821 : 822 });
            const recordingUtil = new RecordingUtilModel(
                { getLogger: () => logger },
                {
                    getConfig: () => ({
                        recorded: [{ name: 'synthetic-root', path: root }],
                        recordedFileExtension: '.ts',
                        recordedFormat: 'synthetic',
                    }),
                },
                execution,
                { findId: vi.fn(() => channel.promise) },
                { findChannelIdAndTime: vi.fn(async () => null) },
                {},
                {},
            );
            const harness = makeRecorder({
                recordingUtil,
                reserveDB: { findId: vi.fn(async () => reserve) },
                streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
            });
            const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
            const cancelled = vi.fn();
            harness.model.reserve = reserve;
            harness.model.bindScheduleSession(session.binding);
            harness.model.eventEmitter.on('RecordingCancelEvent', cancelled);
            await writeFile(join(root, 'other.ts'), 'other session', 'utf8');

            try {
                const preparation = harness.model.startPreparation();
                await vi.waitFor(() => expect(execution.getExecution).toHaveBeenCalledOnce());
                await vi.advanceTimersByTimeAsync(600_000);
                await preparation;

                expect(session.state.phase).toBe('PathSelectionOverdue');
                expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
                expect(execution.unLockExecution).not.toHaveBeenCalled();
                expect(stream.destroyed).toBe(true);

                if (outcome === 'late success') {
                    channel.resolve({
                        channel: 'synthetic-channel',
                        channelType: 'GR',
                        halfWidthName: 'synthetic-channel',
                        name: 'synthetic-channel',
                        serviceId: 1,
                    });
                } else {
                    channel.reject(new Error('synthetic late channel lookup failure'));
                }

                await vi.waitFor(() => expect(execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(821));
                await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
                expect(session.state.phase).toBe('Cancelled');
                expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
                await expect(stat(join(root, 'synthetic.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
                await expect(readFile(join(root, 'other.ts'), 'utf8')).resolves.toBe('other session');
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                vi.useRealTimers();
                harness.model.isCanceledCallingFinished = true;
                harness.model.destroyStream();
                await rm(root, { recursive: true, force: true });
            }
        },
    );

    it('[Task 8.2] keeps a same-manager session observable while an overdue registration deletion waits for its actual terminal', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-overdue-isolation-'));
        const firstStream = new PassThrough();
        const secondStream = new PassThrough();
        const firstVideoInsert = deferred<number>();
        const firstReserve = makeReserve({ id: 82, startAt: 2_000_000, endAt: 3_000_000 });
        const secondReserve = makeReserve({ id: 83, startAt: 2_000_000, endAt: 3_000_000 });
        const event = new RecordingEvent({ getLogger: () => logger });
        const first = makeRecorder({
            recordingEvent: event,
            recordedDB: { findId: vi.fn(), insertOnce: vi.fn(async () => 21), removeRecording: vi.fn() },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'first.ts',
                    fullPath: join(root, 'first.ts'),
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn().mockResolvedValue(undefined),
            },
            reserveDB: { findId: vi.fn(async () => firstReserve) },
            streamCreator: { create: vi.fn(async () => firstStream), changeEndAt: vi.fn() },
            videoFileDB: { insertOnce: vi.fn(() => firstVideoInsert.promise) },
        });
        const second = makeRecorder({
            recordingEvent: event,
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'second.ts',
                    fullPath: join(root, 'second.ts'),
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn().mockResolvedValue(undefined),
            },
            reserveDB: { findId: vi.fn(async () => secondReserve) },
            streamCreator: { create: vi.fn(async () => secondStream), changeEndAt: vi.fn() },
        });
        const provider = vi.fn().mockResolvedValueOnce(first.model).mockResolvedValueOnce(second.model);
        const manager = new RecordingManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ recordedTmp: undefined, timeSpecifiedEndMargin: 0 }) },
            provider,
            event,
            { setTuner: vi.fn() },
            {
                findAll: vi.fn(async () => [[], 0]),
                findId: vi.fn(async () => null),
                findReserveId: vi.fn(async () => []),
            },
            { findId: vi.fn(async id => (id === firstReserve.id ? firstReserve : secondReserve)) },
            { movingFromTmp: vi.fn(), updateVideoFileSize: vi.fn().mockResolvedValue(undefined) },
        );
        manager.candidateStartupState = 'Started';
        const begin = (reserve: any, recorder: any): Promise<void> => {
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
            manager.bindRecorder(recorder, manager.scheduleController.getSessionSnapshot(reserve.id));
            return recorder.startPreparation();
        };
        try {
            await manager.update({ insert: [firstReserve, secondReserve], isSuppressLog: false });
            expect(provider).toHaveBeenCalledTimes(2);

            const firstStarted = begin(firstReserve, first.model);
            await vi.waitFor(() => expect(first.model.recFile).not.toBeNull());
            firstStream.write('synthetic first packet');
            for (let turn = 0; turn < 5 && first.videoFileDB.insertOnce.mock.calls.length === 0; turn += 1) {
                await Promise.resolve();
            }
            expect(first.videoFileDB.insertOnce).toHaveBeenCalledOnce();
            await vi.advanceTimersByTimeAsync(600_000);
            expect(manager.scheduleController.getSessionSnapshot(firstReserve.id)).toMatchObject({
                phase: 'RegistrationOverdue',
            });

            const domainProbe = vi.fn();
            event.setStartPrepRecording(domainProbe);
            const secondStarted = begin(secondReserve, second.model);
            await vi.waitFor(() => expect(second.model.recFile).not.toBeNull());
            secondStream.write('synthetic second packet');
            await secondStarted;
            await vi.waitFor(() => expect(domainProbe).toHaveBeenCalledExactlyOnceWith(secondReserve));

            let deletionSettled = false;
            const deletion = manager.cancelForDeletion(firstReserve.id).then(() => {
                deletionSettled = true;
            });
            await Promise.resolve();
            expect(deletionSettled).toBe(false);
            expect(manager.hasReserve(firstReserve.id)).toBe(true);
            expect(manager.hasReserve(secondReserve.id)).toBe(true);
            expect(manager.scheduleController.getSessionSnapshot(firstReserve.id)).toMatchObject({
                phase: 'StoppingForDeletion',
            });

            firstVideoInsert.resolve(31);
            await firstStarted;
            await deletion;
            expect(deletionSettled).toBe(true);
            expect(manager.hasReserve(firstReserve.id)).toBe(false);
            expect(manager.hasReserve(secondReserve.id)).toBe(true);
        } finally {
            firstVideoInsert.resolve(31);
            first.model.isCanceledCallingFinished = true;
            second.model.isCanceledCallingFinished = true;
            first.model.destroyStream();
            second.model.destroyStream();
            manager.scheduleController.stop();
            vi.useRealTimers();
            await rm(root, { recursive: true, force: true });
        }
    });
});
