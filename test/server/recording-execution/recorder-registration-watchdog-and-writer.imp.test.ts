import 'reflect-metadata';

import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deferred, flushImmediate, load, makeRecorder, makeRecordingSessionBinding, makeReserve } from './_harness';

const FileUtil = load<{ unlink(filePath: string): Promise<void> }>('util', 'FileUtil.js');

const RECORDING_PATH = 'synthetic-root/synthetic.ts';
const REGISTRATION_WATCHDOG_MS = 600_000;
const FAKE_TIMERS = { toFake: ['setTimeout', 'clearTimeout', 'Date'] } as const;

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
    videoDelete?: () => Promise<void>;
    onTryRegisterUse?: (model: any) => string;
};

let unlink: ReturnType<typeof vi.spyOn>;
const cleanups: Array<() => void> = [];

beforeEach(() => {
    unlink = vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);
});

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.useRealTimers();
    unlink.mockRestore();
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
    const session =
        options.session === false
            ? null
            : makeRecordingSessionBinding(reserve, { generation: 1n, phase: 'Recording', sessionToken: 7n });
    const videoInsert = deferred<number>();
    const provider =
        options.onTryRegisterUse === undefined
            ? undefined
            : {
                  tryRegisterSessionUse: vi.fn(() => options.onTryRegisterUse!(harness.model)),
                  releaseSessionUse: vi.fn(),
              };
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
            deleteOnce: vi.fn(options.videoDelete ?? (async () => undefined)),
        },
        recordingUtil: {
            getRecPath: vi.fn(async () => ({
                fileHandle: { close: vi.fn(async () => undefined), createWriteStream: vi.fn(() => writer) },
                parendDir: { name: 'synthetic-root', path: 'synthetic-root' },
                subDir: '',
                fileName: 'synthetic.ts',
                fullPath: RECORDING_PATH,
            })),
            movingFromTmp: vi.fn(),
            updateVideoFileSize: vi.fn(async () => undefined),
        },
        recordedUseProvider: provider,
    });
    const fixture = { harness, provider, reserve, sessionBinding: session, stream, videoInsert, writer };
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

const prepareModel = (fixture: Fixture) => {
    const { harness, reserve, sessionBinding: session, stream } = fixture;
    harness.model.reserve = reserve;
    if (session !== null) harness.model.bindScheduleSession(session.binding);
    harness.model.stream = stream;
    harness.model.setEndProcess = vi.fn();
    harness.model.setEventRelayTimer = vi.fn();
};

const start = async (fixture: Fixture, scheduled?: any): Promise<Outcome> => {
    prepareModel(fixture);
    const outcome = track(
        scheduled === undefined ? fixture.harness.model.doRecord() : fixture.harness.model.doRecord(scheduled),
    );
    await waitUntil(() => fixture.harness.model.firstDataWait !== null, 'the first-data gate');
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

describe('RecorderModel.bindScheduleSession replacement intent (unittest/imp)', () => {
    it('[RE-9.2] records a replacement only when the bound session actually changed', () => {
        const { model } = makeRecorder();
        const reserve = makeReserve();
        const first = makeRecordingSessionBinding(reserve, { generation: 1n, sessionToken: 1n });
        const sameAgain = makeRecordingSessionBinding(reserve, { generation: 1n, sessionToken: 1n });
        const advanced = makeRecordingSessionBinding(reserve, { generation: 2n, sessionToken: 1n });
        const owner = { reservationId: reserve.id, generation: 1n, sessionToken: 1n, intent: 'None' };
        model.registrationOwners.add(owner);
        model.scheduleBinding = first.binding;

        model.bindScheduleSession(sameAgain.binding);
        expect(owner.intent).toBe('None');

        model.bindScheduleSession(advanced.binding);
        expect(owner.intent).toBe('Replacement');
        expect(model.scheduleBinding).toBe(advanced.binding);
    });

    it('[RE-9.2] never weakens a stronger termination intent', () => {
        const { model } = makeRecorder();
        const owner = { reservationId: 1, generation: 1n, sessionToken: 1n, intent: 'None' };

        const promote = (intent: string): string => {
            model.promoteRegistrationTerminationIntent(owner, intent);
            return owner.intent;
        };

        expect(promote('Cancel')).toBe('Cancel');
        expect(promote('Replacement')).toBe('Replacement');
        expect(promote('Cancel')).toBe('Replacement');
        expect(promote('Replacement')).toBe('Replacement');
        expect(promote('Deletion')).toBe('Deletion');
        expect(promote('Replacement')).toBe('Deletion');
        expect(promote('Cancel')).toBe('Deletion');
        expect(promote('Deletion')).toBe('Deletion');
    });
});

describe('RecorderModel.destroyStream drop checker stop (unittest/imp)', () => {
    it('[RE-5.1] hands the drop checker stop itself to the running deletion latch', () => {
        const { model } = makeRecorder();
        const dropStop = Promise.resolve();
        const observe = vi.fn();
        const trackFinalizationContinuation = vi.fn();
        model.stream = null;
        model.recFile = null;
        model.deletionStop = { latch: { observe } };
        model.stopDropChecker = vi.fn(() => dropStop);
        model.trackFinalizationContinuation = trackFinalizationContinuation;

        model.destroyStream();

        // stream と writer が無くても latch には終了待ちが 1 件ずつ渡り、drop checker の停止は最後に渡る
        expect(observe).toHaveBeenCalledTimes(3);
        expect(observe.mock.calls[2][0]).toBe(dropStop);
        expect(trackFinalizationContinuation).not.toHaveBeenCalled();
    });
});

describe('RecorderModel.doRecord writer ownership (unittest/imp)', () => {
    it('[RE-4.7] waits for no open event of a writer that was opened by the path selection', async () => {
        const fixture = makeFixture({ session: false });

        await start(fixture);

        expect(fixture.writer.listenerCount('open')).toBe(0);
    });
});

describe('RecorderModel.doRecord first data (unittest/imp)', () => {
    it('[RE-4.7] leaves no recording start timer behind once the first data arrived', async () => {
        vi.useFakeTimers(FAKE_TIMERS);
        const fixture = makeFixture({ session: false });
        await registerPending(fixture);

        expect(vi.getTimerCount()).toBe(0);
    });

    it('[RE-4.8] ends the wait without registering when the session differs from the bound one by reservation', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const other = makeRecordingSessionBinding(makeReserve({ id: 2 }), {
            generation: 1n,
            phase: 'Recording',
            sessionToken: 7n,
        });
        const outcome = await start(fixture, other.binding);

        fixture.stream.write('synthetic first packet');
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(harness.recordedDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.sessionBinding!.state.phase).toBe('AwaitingFirstData');
        expect(fixture.sessionBinding!.binding.tryTransition).not.toHaveBeenCalledWith(
            'AwaitingFirstData',
            'Registering',
        );
        expect(harness.model.registrationOwners.size).toBe(0);
    });

    it('[RE-4.7] registers normally when the registration watchdog timer object cannot be unref-ed', async () => {
        const fixture = makeFixture();
        const bare = {};
        const realSetTimeout = globalThis.setTimeout;
        vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: any, delay?: number, ...rest: any[]) =>
            delay === REGISTRATION_WATCHDOG_MS ? bare : realSetTimeout(callback, delay, ...rest)) as any);
        const outcome = await registerPending(fixture);

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(fixture.sessionBinding!.state.phase).toBe('Recording');
        expect(fixture.harness.model.registrationOwners.size).toBe(0);
    });
});

describe('RecorderModel.doRecord registration watchdog (unittest/imp)', () => {
    it('[RE-4.8] moves a registration that stays unfinished to RegistrationOverdue', async () => {
        vi.useFakeTimers(FAKE_TIMERS);
        const fixture = makeFixture();
        await registerPending(fixture);

        await vi.advanceTimersByTimeAsync(REGISTRATION_WATCHDOG_MS - 1);
        expect(fixture.sessionBinding!.state.phase).toBe('Registering');
        await vi.advanceTimersByTimeAsync(1);

        expect(fixture.sessionBinding!.state.phase).toBe('RegistrationOverdue');
    });

    it('[RE-4.8] leaves a newer generation of the session alone when the registration stays unfinished', async () => {
        vi.useFakeTimers(FAKE_TIMERS);
        const fixture = makeFixture();
        await registerPending(fixture);
        const newer = makeRecordingSessionBinding(fixture.reserve, {
            generation: 2n,
            phase: 'Registering',
            sessionToken: 7n,
        });
        fixture.harness.model.scheduleBinding = newer.binding;

        await vi.advanceTimersByTimeAsync(REGISTRATION_WATCHDOG_MS);

        expect(newer.binding.tryTransition).not.toHaveBeenCalled();
        expect(newer.state.phase).toBe('Registering');
        expect(fixture.sessionBinding!.state.phase).toBe('Registering');
    });

    it('[RE-4.8] stops the watchdog as soon as the registration failed', async () => {
        vi.useFakeTimers(FAKE_TIMERS);
        const cleanupGate = deferred<void>();
        const fixture = makeFixture({ recordedDelete: () => cleanupGate.promise });
        const outcome = await registerPending(fixture);

        fixture.videoInsert.reject(new Error('synthetic video-file rejection'));
        await waitUntil(() => fixture.harness.recordedDB.deleteOnce.mock.calls.length === 1, 'the recorded cleanup');

        // 失敗の後始末が終わるのを待っている間も、watchdog の timer は残っていない
        expect(vi.getTimerCount()).toBe(0);
        cleanupGate.resolve();
        await settle(outcome);
        expect(outcome.state).toBe('rejected');
    });

    it('[RE-4.8] stops the watchdog as soon as a registration that was already abandoned completed', async () => {
        vi.useFakeTimers(FAKE_TIMERS);
        const cleanupGate = deferred<void>();
        const fixture = makeFixture({ videoDelete: () => cleanupGate.promise });
        const { harness } = fixture;
        const outcome = await registerPending(fixture);

        fixture.stream.emit('error', new Error('synthetic stream failure'));
        await settle(outcome);
        expect(outcome.state).toBe('rejected');
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);

        fixture.videoInsert.resolve(31);
        await waitUntil(() => harness.videoFileDB.deleteOnce.mock.calls.length === 1, 'the video file cleanup');

        // 登録は終わったが録画は放棄済みなので、行は消される。後始末を待つ間も watchdog の timer は残っていない
        expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(31);
        expect(vi.getTimerCount()).toBe(0);
        cleanupGate.resolve();
        await waitUntil(() => harness.model.registrationOwners.size === 0, 'the registration owner release');
        expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
    });
});

describe('RecorderModel.doRecord cancellation during registration (unittest/imp)', () => {
    it('[RE-4.9] settles a pending cancellation only once', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        const cleanup = vi.spyOn(harness.model, 'cleanupPendingRegistration');
        harness.model.recordRegistrationTerminationIntent('Cancel');
        harness.model.cancelFirstDataWait();

        fixture.videoInsert.reject(new Error('synthetic cancelled rejection'));
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(fixture.sessionBinding!.state.phase).toBe('Cancelled');
        // 終了意図に応じた後始末と取消待ちの後始末の 2 回だけで、失敗の後始末の最後にもう一度は走らない
        expect(cleanup).toHaveBeenCalledTimes(2);
    });

    it('[RE-4.9] does not look for registration resources that were never registered when the failure was cancelled', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await start(fixture);
        harness.model.addRecorded = vi.fn(async () => {
            harness.model.recordRegistrationTerminationIntent('Cancel');
            throw new Error('synthetic registration failure');
        });

        fixture.stream.write('synthetic first packet');
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(fixture.sessionBinding!.state.phase).toBe('Cancelled');
        expect(harness.model.registrationOwners.size).toBe(0);
    });

    it('[RE-4.9] does not look for registration resources that were never registered when a cancellation is pending', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await start(fixture);
        harness.model.addRecorded = vi.fn(async () => {
            harness.model.cancelFirstDataWait();
            throw new Error('synthetic registration failure');
        });

        fixture.stream.write('synthetic first packet');
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(harness.model.registrationOwners.size).toBe(0);
    });

    it('[RE-4.9] does not look for registration resources that were never registered when the wait was cancelled', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await start(fixture);
        harness.model.addRecorded = vi.fn(async () => {
            harness.model.cancelFirstDataWait();
            return { id: 21, videoFiles: [] };
        });

        fixture.stream.write('synthetic first packet');
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        expect(harness.model.registrationOwners.size).toBe(0);
    });
});

describe('RecorderModel.doRecord registration completion without a usable session (unittest/imp)', () => {
    it('[RE-4.9] gives the recorded use back and removes the rows when the session binding is gone', async () => {
        const fixture = makeFixture({ onTryRegisterUse: () => 'registered' });
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        harness.model.scheduleBinding = null;

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(fixture.provider!.releaseSessionUse).toHaveBeenCalledOnce();
        expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(31);
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
        expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        expect(harness.model.registrationOwners.size).toBe(0);
    });

    it('[RE-4.9] does not try to leave a phase that is not a registering one', async () => {
        const fixture = makeFixture({ onTryRegisterUse: () => 'registered' });
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        fixture.sessionBinding!.state.phase = 'Cancelled';

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(fixture.provider!.releaseSessionUse).toHaveBeenCalledOnce();
        expect(fixture.sessionBinding!.binding.tryTransition).not.toHaveBeenCalledWith(null, 'Recording');
        expect(fixture.sessionBinding!.state.phase).toBe('Cancelled');
        expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(31);
    });
});
