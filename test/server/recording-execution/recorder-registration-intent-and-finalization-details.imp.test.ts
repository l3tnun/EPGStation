import 'reflect-metadata';

import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const RECORDING_PATH = '/synthetic-root/synthetic.ts';
const NOW = 1_700_000_000_000;

const waitUntil = async (condition: () => boolean, description: string): Promise<void> => {
    for (let turn = 0; turn < 2000; turn += 1) {
        if (condition()) return;
        await flushImmediate();
    }
    throw new Error(`Timed out waiting for ${description}`);
};

type Outcome = { state: 'pending' | 'resolved' | 'rejected'; error: any };

const track = (promise: Promise<unknown>): Outcome => {
    const outcome: Outcome = { state: 'pending', error: undefined };
    promise.then(
        () => {
            outcome.state = 'resolved';
        },
        error => {
            outcome.state = 'rejected';
            outcome.error = error;
        },
    );
    return outcome;
};

type FixtureOptions = {
    session?: boolean;
    recordedDelete?: () => Promise<void>;
};

let unlink: ReturnType<typeof vi.spyOn>;
const cleanups: Array<() => void> = [];

beforeEach(() => {
    unlink = vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);
});

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/**
 * 録画開始（doRecord）の最初の data から DB 登録までを、実ファイルを使わずに動かす部品。
 * 録画ファイルの writer は fileHandle の差し替えで渡す偽の Writable で、VideoFile の登録は test が解決を決める。
 */
const makeFixture = (options: FixtureOptions = {}) => {
    const stream = new PassThrough();
    const writer = new Writable({
        write(_chunk, _encoding, callback) {
            callback();
        },
    });
    const reserve = makeReserve();
    const sessionBinding =
        options.session === false
            ? null
            : makeRecordingSessionBinding(reserve, { generation: 1n, phase: 'Recording', sessionToken: 7n });
    const videoInsert = deferred<number>();
    const harness = makeRecorder({
        recordedDB: {
            insertOnce: vi.fn(async () => 21),
            deleteOnce: vi.fn(options.recordedDelete ?? (async () => undefined)),
            removeRecording: vi.fn(async () => undefined),
            findId: vi.fn(),
            updateOnce: vi.fn(),
        },
        videoFileDB: {
            insertOnce: vi.fn(() => videoInsert.promise),
            deleteOnce: vi.fn(async () => undefined),
        },
        recordingUtil: {
            getRecPath: vi.fn(async () => ({
                fileHandle: { close: vi.fn(async () => undefined), createWriteStream: vi.fn(() => writer) },
                parendDir: { name: 'synthetic-root', path: '/synthetic-root' },
                subDir: '',
                fileName: 'synthetic.ts',
                fullPath: RECORDING_PATH,
            })),
            movingFromTmp: vi.fn(),
            updateVideoFileSize: vi.fn(async () => undefined),
        },
    });
    const fixture = { harness, reserve, sessionBinding, stream, videoInsert, writer };
    cleanups.push(() => {
        harness.model.cancelFirstDataWait();
        harness.model.isCanceledCallingFinished = true;
        harness.model.destroyStream();
        stream.destroy();
        writer.destroy();
    });
    return fixture;
};

type Fixture = ReturnType<typeof makeFixture>;

const start = async (fixture: Fixture): Promise<Outcome> => {
    const { harness, reserve, sessionBinding, stream } = fixture;
    harness.model.reserve = reserve;
    if (sessionBinding !== null) harness.model.bindScheduleSession(sessionBinding.binding);
    harness.model.stream = stream;
    harness.model.setEndProcess = vi.fn();
    harness.model.setEventRelayTimer = vi.fn();
    const outcome = track(harness.model.doRecord());
    await waitUntil(() => harness.model.firstDataWait !== null, 'the first-data gate');
    return outcome;
};

const registerPending = async (fixture: Fixture): Promise<Outcome> => {
    const outcome = await start(fixture);
    fixture.stream.write('synthetic first packet');
    await waitUntil(() => fixture.harness.videoFileDB.insertOnce.mock.calls.length === 1, 'the VideoFile insert');
    return outcome;
};

const settle = async (outcome: Outcome): Promise<void> => {
    await waitUntil(() => outcome.state !== 'pending', 'the first-data outcome');
};

const bindSameTokenReplacement = (fixture: Fixture) => {
    const replacement = makeRecordingSessionBinding(fixture.reserve, {
        generation: 2n,
        phase: 'Preparing',
        sessionToken: 7n,
    });
    fixture.sessionBinding!.state.current = false;
    fixture.harness.model.bindScheduleSession(replacement.binding);
    return replacement;
};

describe('RecorderModel registration termination intent priority (unittest/imp)', () => {
    // [現在の意図, 新しく届いた意図, 残るはずの意図]。強さは None < Cancel < Replacement < Deletion。
    const cases: Array<[string, string, string]> = [
        ['None', 'Cancel', 'Cancel'],
        ['None', 'Replacement', 'Replacement'],
        ['None', 'Deletion', 'Deletion'],
        ['Cancel', 'Cancel', 'Cancel'],
        ['Cancel', 'Replacement', 'Replacement'],
        ['Cancel', 'Deletion', 'Deletion'],
        ['Replacement', 'Cancel', 'Replacement'],
        ['Replacement', 'Replacement', 'Replacement'],
        ['Replacement', 'Deletion', 'Deletion'],
        ['Deletion', 'Cancel', 'Deletion'],
        ['Deletion', 'Replacement', 'Deletion'],
        ['Deletion', 'Deletion', 'Deletion'],
    ];

    it.each(cases)(
        '[RE-9.2] a registration owner holding %s that receives %s ends up holding %s',
        (current, requested, expected) => {
            const { model } = makeRecorder();
            const reserve = makeReserve();
            const { binding } = makeRecordingSessionBinding(reserve, { phase: 'Registering' });
            model.scheduleBinding = binding;
            const owner = {
                reservationId: binding.reservationId,
                generation: binding.generation,
                sessionToken: binding.sessionToken,
                intent: current,
            };
            model.registrationOwners.add(owner);

            model.recordRegistrationTerminationIntent(requested);

            expect(owner.intent).toBe(expected);
        },
    );

    it('[RE-9.2] an owner of another session is left alone', () => {
        const { model } = makeRecorder();
        const { binding } = makeRecordingSessionBinding(makeReserve(), { phase: 'Registering', sessionToken: 3n });
        model.scheduleBinding = binding;
        const owner = { reservationId: binding.reservationId, generation: 1n, sessionToken: 4n, intent: 'None' };
        model.registrationOwners.add(owner);

        model.recordRegistrationTerminationIntent('Deletion');

        expect(owner.intent).toBe('None');
    });
});

describe('RecorderModel first-data registration hand-off (unittest/imp)', () => {
    it('[RE-9.2] does not try to move a replaced session into Recording', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        const replacement = bindSameTokenReplacement(fixture);

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(replacement.binding.tryTransition).not.toHaveBeenCalled();
        expect(replacement.state.phase).toBe('Preparing');
        expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        expect(harness.model.registrationOwners.size).toBe(0);
    });

    it('[RE-9.2] cleans up the registration when another session took over while it was being registered', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        const other = makeRecordingSessionBinding(fixture.reserve, {
            generation: 1n,
            phase: 'Recording',
            sessionToken: 8n,
        });
        harness.model.bindScheduleSession(other.binding);

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(other.binding.tryTransition).not.toHaveBeenCalled();
        expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(31);
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
        expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        expect(harness.model.registrationOwners.size).toBe(0);
    });

    it('[RE-9.2] leaves the file writer alone when a replaced registration has no pending resources of its own', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await start(fixture);
        const registered = deferred<{ id: number }>();
        harness.model.addRecorded = vi.fn(() => registered.promise);
        fixture.stream.write('synthetic first packet');
        await waitUntil(() => harness.model.addRecorded.mock.calls.length === 1, 'the registration');
        bindSameTokenReplacement(fixture);

        registered.resolve({ id: 21 });
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(fixture.writer.destroyed).toBe(false);
        expect(harness.recordedDB.deleteOnce).not.toHaveBeenCalled();
        expect(harness.model.registrationOwners.size).toBe(0);
    });
});

describe('RecorderModel first-data timeout (unittest/imp)', () => {
    it('[RE-9.2] a timeout that fires after the first data arrived does not fail the registration', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
        const fixture = makeFixture({ session: false });
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        const timeoutCall = setTimeoutSpy.mock.calls.find(call => call[1] === 5_000);
        expect(timeoutCall).toBeDefined();

        await (timeoutCall![0] as () => Promise<void>)();
        await flushImmediate();

        expect(outcome.state).toBe('pending');
        expect(harness.model.stream).toBe(fixture.stream);
        expect(fixture.stream.destroyed).toBe(false);

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(harness.recordingEvent.emitStartRecording).toHaveBeenCalledOnce();
    });
});

describe('RecorderModel unexpected first-data failure (unittest/imp)', () => {
    it('[RE-9.2] destroys a stream that was put in place while the failed registration was being cleaned up', async () => {
        const cleanupGate = deferred<void>();
        const fixture = makeFixture({ session: false, recordedDelete: () => cleanupGate.promise });
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        const later = new PassThrough();

        fixture.videoInsert.reject(new Error('synthetic video-file rejection'));
        await waitUntil(() => harness.recordedDB.deleteOnce.mock.calls.length === 1, 'the recorded row cleanup');
        harness.model.stream = later;
        cleanupGate.resolve();
        await settle(outcome);

        expect(outcome.state).toBe('rejected');
        expect(outcome.error.message).toBe('AddRecordedDBError');
        expect(later.destroyed).toBe(true);
        expect(harness.model.stream).toBeNull();
        later.destroy();
    });

    it('[RE-9.2] has no stream to destroy when the failure already released it', async () => {
        const fixture = makeFixture({ session: false });
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        const destroyStream = vi.spyOn(harness.model, 'destroyStream');

        fixture.videoInsert.reject(new Error('synthetic video-file rejection'));
        await settle(outcome);

        expect(outcome.state).toBe('rejected');
        expect(destroyStream).toHaveBeenCalledTimes(1);
        expect(harness.model.stream).toBeNull();
    });
});

describe('RecorderModel.cleanupPendingRegistration (unittest/imp)', () => {
    const makeCleanupRecorder = () =>
        makeRecorder({
            recordedDB: { insertOnce: vi.fn(async () => 21), deleteOnce: vi.fn(async () => undefined) },
            videoFileDB: { insertOnce: vi.fn(async () => 31), deleteOnce: vi.fn(async () => undefined) },
        });

    const makeResources = (overrides: Record<string, any> = {}) => ({
        cleanupLifetime: null as Promise<void> | null,
        dropLogFileId: null as number | null,
        filePath: 'synthetic-root/a.ts',
        recordedId: null as number | null,
        videoFileId: null as number | null,
        ...overrides,
    });

    it.each([
        ['video file', { videoFileId: 31 }, { videoFileId: null, recordedId: 98, dropLogFileId: 97 }],
        ['recorded', { recordedId: 21 }, { videoFileId: 99, recordedId: null, dropLogFileId: 97 }],
        ['drop log file', { dropLogFileId: 41 }, { videoFileId: 99, recordedId: 98, dropLogFileId: null }],
    ])(
        '[RE-9.2] clears only the %s id of the recorder when only that row was registered',
        async (_label, registered, expected) => {
            const harness = makeCleanupRecorder();
            harness.model.reserve = makeReserve();
            const resources = makeResources(registered);
            harness.model.videoFileId = registered.videoFileId ?? 99;
            harness.model.recordedId = registered.recordedId ?? 98;
            harness.model.dropLogFileId = registered.dropLogFileId ?? 97;

            await harness.model.cleanupPendingRegistration(resources);

            expect(harness.model.videoFileId).toBe(expected.videoFileId);
            expect(harness.model.recordedId).toBe(expected.recordedId);
            expect(harness.model.dropLogFileId).toBe(expected.dropLogFileId);
        },
    );

    it('[RE-9.2] keeps going and logs each failure when a row or the file cannot be removed', async () => {
        const videoError = new Error('synthetic video file deletion failure');
        const recordedError = new Error('synthetic recorded deletion failure');
        const dropLogError = new Error('synthetic drop log deletion failure');
        const unlinkError = new Error('synthetic unlink failure');
        const harness = makeRecorder({
            recordedDB: {
                insertOnce: vi.fn(async () => 21),
                deleteOnce: vi.fn(async () => {
                    throw recordedError;
                }),
            },
            videoFileDB: {
                insertOnce: vi.fn(async () => 31),
                deleteOnce: vi.fn(async () => {
                    throw videoError;
                }),
            },
            dropLogFileDB: {
                insertOnce: vi.fn(async () => 41),
                deleteOnce: vi.fn(async () => {
                    throw dropLogError;
                }),
            },
        });
        harness.model.reserve = makeReserve();
        unlink.mockRejectedValueOnce(unlinkError);
        const resources = makeResources({ videoFileId: 31, recordedId: 21, dropLogFileId: 41 });
        harness.model.videoFileId = 31;
        harness.model.recordedId = 21;
        harness.model.dropLogFileId = 41;
        harness.model.videoFileFulPath = resources.filePath;
        harness.model.pendingRegistrationResources = resources;
        logger.system.error.mockClear();

        await harness.model.cleanupPendingRegistration(resources);

        expect(logger.system.error.mock.calls.map(call => call[0])).toEqual([
            'delete video file error: 31',
            videoError,
            'delete recorded error: 21',
            recordedError,
            'delete drop log file error: 41',
            dropLogError,
            'delete error: 1 synthetic-root/a.ts',
            unlinkError,
        ]);
        expect(harness.model.videoFileId).toBeNull();
        expect(harness.model.recordedId).toBeNull();
        expect(harness.model.dropLogFileId).toBeNull();
        expect(harness.model.videoFileFulPath).toBeNull();
        expect(harness.model.pendingRegistrationResources).toBeNull();
    });
});

describe('RecorderModel finalization details (unittest/imp)', () => {
    it('[RE-9.2] does not clear an event relay timer when there is none', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        const clear = vi.spyOn(globalThis, 'clearTimeout');

        await harness.model.recEnd();

        expect(clear).not.toHaveBeenCalledWith(null);
    });

    it('[RE-9.2] adds no recorded history and gives no finish notice when the recorded row is gone', async () => {
        const harness = makeRecorder({
            recordedDB: {
                removeRecording: vi.fn(async () => undefined),
                findId: vi.fn(async () => null),
                updateOnce: vi.fn(),
            },
        });
        harness.model.reserve = makeReserve({ ruleId: 5, isTimeSpecified: false, isEventRelay: false });
        harness.model.recordedId = 21;
        logger.system.error.mockClear();

        await harness.model.recEnd();

        expect(harness.recordedHistoryDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.recordingEvent.emitFinishRecording).not.toHaveBeenCalled();
        const logged = logger.system.error.mock.calls.map(call => String(call[0]));
        expect(logged.some(message => message.includes('add recorded history error'))).toBe(false);
    });

    it('[RE-9.2] adds the recorded history of a rule reservation and gives the finish notice', async () => {
        const recorded = { id: 21, halfWidthName: 'synthetic-program', channelId: 10, endAt: 2_000 };
        const harness = makeRecorder({
            recordedDB: {
                removeRecording: vi.fn(async () => undefined),
                findId: vi.fn(async () => recorded),
                updateOnce: vi.fn(),
            },
        });
        const reserve = makeReserve({ ruleId: 5, isTimeSpecified: false, isEventRelay: false });
        harness.model.reserve = reserve;
        harness.model.recordedId = 21;

        await harness.model.recEnd();

        expect(harness.recordedHistoryDB.insertOnce).toHaveBeenCalledOnce();
        expect(harness.recordedHistoryDB.insertOnce.mock.calls[0][0]).toMatchObject({
            name: 'synthetic-program',
            channelId: 10,
            endAt: 2_000,
        });
        expect(harness.recordingEvent.emitFinishRecording).toHaveBeenCalledExactlyOnceWith(reserve, recorded, true);
    });

    it('[RE-9.2] a recording without a recorded id only notes the failure', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        logger.system.info.mockClear();

        await harness.model.recEnd();

        expect(logger.system.info).toHaveBeenCalledWith('failed to recording: recorded id is null');
        expect(harness.recordedDB.removeRecording).not.toHaveBeenCalled();
        expect(harness.recordingEvent.emitFinishRecording).not.toHaveBeenCalled();
    });

    it('[RE-9.2] waiting for a deletion does not wait on a finalization that never started', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        const allSettled = vi.spyOn(Promise, 'allSettled');

        await harness.model.awaitFinalizationForDeletion(false);

        expect(allSettled).not.toHaveBeenCalled();
    });

    it('[RE-9.2] waiting for a deletion waits on the running finalization', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        const running = deferred<void>();
        harness.model.finalizationLifetime = running.promise;
        const allSettled = vi.spyOn(Promise, 'allSettled');

        const waiting = harness.model.awaitFinalizationForDeletion(false);
        running.resolve();
        await waiting;

        expect(allSettled).toHaveBeenCalledWith([running.promise]);
    });
});

describe('RecorderModel.cancel from a retry wait (unittest/imp)', () => {
    it('[RE-9.2] cancels a session that is waiting for a retry', async () => {
        const harness = makeRecorder();
        const reserve = makeReserve();
        const { binding, state } = makeRecordingSessionBinding(reserve, { phase: 'RetryWaiting' });
        harness.model.reserve = reserve;
        harness.model.scheduleBinding = binding;

        await harness.model.cancel(false);

        expect(state.phase).toBe('Cancelled');
        expect(binding.removeTimeSpecifiedEnd).toHaveBeenCalled();
    });
});

describe('RecorderModel.setEventRelayTimer replacement (unittest/imp)', () => {
    it('[RE-9.2] clears nothing for the first timer and replaces the previous timer afterwards', () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        const { model } = makeRecorder();
        const clear = vi.spyOn(globalThis, 'clearTimeout');

        model.setEventRelayTimer(makeReserve({ endAt: NOW + 60_000 }));
        expect(clear).not.toHaveBeenCalledWith(null);
        const first = model.eventRelayTimerId;
        expect(first).not.toBeNull();

        model.setEventRelayTimer(makeReserve({ endAt: NOW + 90_000 }));

        expect(clear).toHaveBeenCalledExactlyOnceWith(first);
        expect(model.eventRelayTimerId).not.toBe(first);
        expect(vi.getTimerCount()).toBe(1);
    });
});

describe('RecorderModel.stopForDeletion details (unittest/imp)', () => {
    const setup = () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        harness.model.awaitFinalizationForDeletion = vi.fn(async () => undefined);
        return harness;
    };

    it('[RE-9.2] clears no start timer when there is none', async () => {
        const { model } = setup();
        const clear = vi.spyOn(globalThis, 'clearTimeout');

        await model.stopForDeletion();

        expect(clear).not.toHaveBeenCalledWith(null);
    });

    it('[RE-9.2] clears a pending start timer', async () => {
        vi.useFakeTimers();
        const { model } = setup();
        const started = vi.fn();
        model.timerId = setTimeout(started, 1_000);

        const stopping = model.stopForDeletion();
        expect(model.timerId).toBeNull();
        await stopping;
        await vi.advanceTimersByTimeAsync(2_000);

        expect(started).not.toHaveBeenCalled();
    });

    it.each(['Completed', 'Cancelled'])('[RE-9.2] does not move a %s session to StoppingForDeletion', async phase => {
        const { model } = setup();
        const { binding, state } = makeRecordingSessionBinding(model.reserve, { phase });
        model.scheduleBinding = binding;

        await model.stopForDeletion();

        expect(binding.tryTransition).not.toHaveBeenCalledWith(null, 'StoppingForDeletion');
        expect(binding.tryTransition).not.toHaveBeenCalledWith(phase, 'StoppingForDeletion');
        expect(state.phase).toBe(phase);
    });
});
