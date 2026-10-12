import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, flushImmediate, load, makeRecorder, makeRecordingSessionBinding, makeReserve } from './_harness';

const FileUtil = load<{ unlink(filePath: string): Promise<void> }>('util', 'FileUtil.js');

const RECORDING_PATH = '/synthetic-root/synthetic.ts';

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
    reserve?: Record<string, any>;
    recordedInsert?: () => Promise<number>;
    recordedDelete?: () => Promise<void>;
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
    const reserve = makeReserve(options.reserve);
    const session =
        options.session === false
            ? null
            : makeRecordingSessionBinding(reserve, { generation: 1n, phase: 'Recording', sessionToken: 7n });
    const videoInsert = deferred<number>();
    const hooks = { beforeVideoInsert: null as null | (() => void) };
    const provider =
        options.onTryRegisterUse === undefined
            ? undefined
            : {
                  tryRegisterSessionUse: vi.fn(() => options.onTryRegisterUse!(harness.model)),
                  releaseSessionUse: vi.fn(),
              };
    const harness = makeRecorder({
        recordedDB: {
            insertOnce: vi.fn(options.recordedInsert ?? (async () => 21)),
            deleteOnce: vi.fn(options.recordedDelete ?? (async () => undefined)),
            removeRecording: vi.fn(async () => undefined),
            findId: vi.fn(),
            updateOnce: vi.fn(),
        },
        videoFileDB: {
            insertOnce: vi.fn(() => {
                hooks.beforeVideoInsert?.();
                return videoInsert.promise;
            }),
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
        recordedUseProvider: provider,
    });
    const fixture = { harness, hooks, provider, reserve, sessionBinding: session, stream, videoInsert, writer };
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
    const { harness, reserve, sessionBinding: session, stream } = fixture;
    harness.model.reserve = reserve;
    if (session !== null) harness.model.bindScheduleSession(session.binding);
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

const bindReplacement = (fixture: Fixture) => {
    const replacement = makeRecordingSessionBinding(fixture.reserve, {
        generation: 2n,
        phase: 'Preparing',
        sessionToken: 7n,
    });
    fixture.sessionBinding!.state.current = false;
    fixture.harness.model.bindScheduleSession(replacement.binding);
    return replacement;
};

const spyStreamTeardown = (stream: PassThrough) => ({
    destroy: vi.spyOn(stream, 'destroy'),
    push: vi.spyOn(stream, 'push'),
    removeAllListeners: vi.spyOn(stream, 'removeAllListeners'),
    unpipe: vi.spyOn(stream, 'unpipe'),
});

describe('recorder first-data wait', () => {
    it('[RE-4.7] fails the wait exactly 5 seconds after it starts and detaches its own listeners', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        const fixture = makeFixture({ session: false });
        const removeListener = vi.spyOn(fixture.stream, 'removeListener');
        const outcome = await start(fixture);
        const onData = fixture.stream.listeners('data').find(listener => listener.name === 'onData');
        const onStreamError = fixture.stream.listeners('error').find(listener => listener.name === 'onStreamError');
        expect(onData).toBeDefined();
        expect(onStreamError).toBeDefined();

        await vi.advanceTimersByTimeAsync(4_999);
        expect(outcome.state).toBe('pending');
        await vi.advanceTimersByTimeAsync(1);
        await settle(outcome);

        expect(outcome.state).toBe('rejected');
        expect(outcome.error).toMatchObject({ message: 'recordingStartError' });
        expect(removeListener).toHaveBeenCalledWith('data', onData);
        expect(removeListener).toHaveBeenCalledWith('error', onStreamError);
        expect(fixture.stream.listeners('error')).not.toContain(onStreamError);
        expect(fixture.harness.model.stream).toBeNull();
    });

    it('[RE-4.7] ignores a second delivery of the first-data handler while the registration is in progress', async () => {
        const fixture = makeFixture({ session: false });
        const outcome = await start(fixture);
        const onData = fixture.stream.listeners('data').find(listener => listener.name === 'onData') as () => unknown;
        expect(onData).toBeDefined();

        fixture.stream.write('synthetic first packet');
        await waitUntil(() => fixture.harness.videoFileDB.insertOnce.mock.calls.length === 1, 'the VideoFile insert');
        void onData();
        for (let turn = 0; turn < 5; turn += 1) await flushImmediate();

        expect(fixture.harness.recordedDB.insertOnce).toHaveBeenCalledOnce();
        expect(outcome.state).toBe('pending');
    });

    it('[RE-4.8] ends the wait without a registration when the session was replaced before the first data', async () => {
        const fixture = makeFixture();
        const outcome = await start(fixture);
        const other = makeRecordingSessionBinding(fixture.reserve, {
            generation: 1n,
            phase: 'Recording',
            sessionToken: 8n,
        });
        fixture.harness.model.bindScheduleSession(other.binding);

        fixture.stream.write('synthetic first packet');
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(fixture.harness.recordedDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        expect(fixture.harness.model.registrationOwners.size).toBe(0);
    });

    it.each([
        ['another session is bound', 8n, 'Recording'],
        ['the session left the Recording phase', 7n, 'Cancelled'],
    ])('[RE-4.8] stops before waiting for data when %s while the writer is prepared', async (_name, token, phase) => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const current = makeRecordingSessionBinding(fixture.reserve, {
            generation: 1n,
            phase,
            sessionToken: token,
        });
        harness.model.reserve = fixture.reserve;
        harness.model.bindScheduleSession(current.binding);
        harness.model.stream = fixture.stream;

        const outcome = track(harness.model.doRecord(fixture.sessionBinding!.binding));
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(harness.model.stream).toBeNull();
        expect(harness.model.firstDataWait).toBeNull();
        expect(harness.recordedDB.insertOnce).not.toHaveBeenCalled();
    });

    it('[RE-4.7] rejects with AddRecordedDBError when the registration fails with a non-Error value', async () => {
        const fixture = makeFixture({ session: false });
        const outcome = await start(fixture);
        fixture.harness.model.addRecorded = vi.fn(async () => {
            throw 'synthetic non-error rejection';
        });

        fixture.stream.write('synthetic first packet');
        await settle(outcome);

        expect(outcome.state).toBe('rejected');
        expect(outcome.error).toBeInstanceOf(Error);
        expect(outcome.error.message).toBe('AddRecordedDBError');
    });
});

describe('recorder registration failure', () => {
    it('[RE-4.7] rejects with the database error as cause and releases every registration owner', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        const resources = harness.model.pendingRegistrationResources;
        const databaseError = new Error('synthetic video-file rejection');

        fixture.videoInsert.reject(databaseError);
        await settle(outcome);

        expect(outcome.state).toBe('rejected');
        expect(outcome.error.message).toBe('AddRecordedDBError');
        expect(outcome.error.cause).toBe(databaseError);
        expect(harness.model.registrationOwners.size).toBe(0);
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
        expect(resources.recordedId).toBeNull();
        expect(harness.model.recordedId).toBeNull();
        expect(harness.model.pendingRegistrationResources).toBeNull();
        expect(fixture.writer.destroyed).toBe(true);
        expect(unlink).toHaveBeenCalledExactlyOnceWith(RECORDING_PATH);
    });

    it('[RE-4.7] does not delete a recorded program that was never inserted', async () => {
        const fixture = makeFixture({
            recordedInsert: async () => {
                throw new Error('synthetic recorded rejection');
            },
        });
        const outcome = await start(fixture);
        fixture.stream.write('synthetic first packet');
        await settle(outcome);

        expect(outcome.state).toBe('rejected');
        expect(fixture.harness.recordedDB.deleteOnce).not.toHaveBeenCalled();
        expect(fixture.harness.videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(fixture.harness.model.registrationOwners.size).toBe(0);
    });

    it('[RE-4.7] keeps the recorded id for the later cleanup when its deletion fails, and leaves a newer pending registration alone', async () => {
        const fixture = makeFixture({
            recordedDelete: async () => {
                throw new Error('synthetic recorded deletion failure');
            },
        });
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        const resources = harness.model.pendingRegistrationResources;
        const newerPending = { recordedId: 77 };
        harness.model.pendingRegistrationResources = newerPending;

        fixture.videoInsert.reject(new Error('synthetic video-file rejection'));
        await settle(outcome);

        expect(outcome.state).toBe('rejected');
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
        expect(resources.recordedId).toBe(21);
        expect(harness.model.recordedId).toBeNull();
        expect(harness.model.pendingRegistrationResources).toBe(newerPending);
    });

    it('[RE-4.9] settles a registration failure as cancelled, not failed, once the session left the registering phases', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        fixture.sessionBinding!.state.phase = 'Cancelled';

        fixture.videoInsert.reject(new Error('synthetic stale rejection'));
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(harness.model.registrationOwners.size).toBe(0);
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
        expect(fixture.writer.destroyed).toBe(true);
    });

    it('[RE-4.9] leaves cleanup to the pending cancellation when a stale registration failure arrives after the wait was cancelled', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        fixture.sessionBinding!.state.phase = 'Cancelled';
        harness.model.cancelFirstDataWait();

        fixture.videoInsert.reject(new Error('synthetic stale rejection'));
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
        expect(unlink).toHaveBeenCalledExactlyOnceWith(RECORDING_PATH);
        expect(fixture.writer.destroyed).toBe(false);
        expect(harness.model.registrationOwners.size).toBe(0);
    });

    it('[RE-4.9] keeps the file writer and the session phase for a deletion that is still in progress', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        const teardown = spyStreamTeardown(fixture.stream);
        harness.model.recordRegistrationTerminationIntent('Deletion');

        fixture.videoInsert.reject(new Error('synthetic deletion-time rejection'));
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(fixture.sessionBinding!.state.phase).toBe('Registering');
        expect(fixture.writer.destroyed).toBe(false);
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
        expect(unlink).toHaveBeenCalledExactlyOnceWith(RECORDING_PATH);
        expect(fixture.stream.destroyed).toBe(false);
        expect(teardown.push).not.toHaveBeenCalledWith(null);
        expect(harness.model.registrationOwners.size).toBe(0);
    });

    it('[RE-4.9] cancels the session and discards the writer when a cancelled registration fails', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        harness.model.recordRegistrationTerminationIntent('Cancel');

        fixture.videoInsert.reject(new Error('synthetic cancelled rejection'));
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(fixture.sessionBinding!.state.phase).toBe('Cancelled');
        expect(fixture.writer.destroyed).toBe(true);
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
        expect(harness.model.registrationOwners.size).toBe(0);
    });

    it('[RE-4.8] discards the replaced stream and the writer, but not the new session, when a replaced registration fails', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        const teardown = spyStreamTeardown(fixture.stream);
        const replacement = bindReplacement(fixture);

        fixture.videoInsert.reject(new Error('synthetic replaced rejection'));
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(fixture.stream.destroyed).toBe(true);
        expect(teardown.push).toHaveBeenCalledWith(null);
        expect(fixture.writer.destroyed).toBe(true);
        expect(replacement.state.phase).toBe('Preparing');
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
        expect(harness.model.registrationOwners.size).toBe(0);
    });
});

describe('recorder registration outcome after the wait was cancelled', () => {
    it('[RE-4.9] cleans up the completed registration without touching the receiving stream when there is no session', async () => {
        const fixture = makeFixture({ session: false });
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        const teardown = spyStreamTeardown(fixture.stream);
        harness.model.cancelFirstDataWait();

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(fixture.stream.destroyed).toBe(false);
        expect(teardown.push).not.toHaveBeenCalledWith(null);
        expect(fixture.writer.destroyed).toBe(true);
        expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(31);
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
        expect(harness.videoFileDB.deleteOnce.mock.invocationCallOrder[0]).toBeLessThan(
            harness.recordedDB.deleteOnce.mock.invocationCallOrder[0],
        );
        expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
    });

    it('[RE-4.9] keeps the session phase when the cancelled registration has no termination intent', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        const teardown = spyStreamTeardown(fixture.stream);
        harness.model.cancelFirstDataWait();

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(fixture.sessionBinding!.state.phase).toBe('Registering');
        expect(fixture.stream.destroyed).toBe(false);
        expect(teardown.push).not.toHaveBeenCalledWith(null);
        expect(fixture.writer.destroyed).toBe(true);
        expect(harness.model.registrationOwners.size).toBe(0);
    });

    it('[RE-4.9] cancels the session when the completed registration was cancelled', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        harness.model.recordRegistrationTerminationIntent('Cancel');
        harness.model.cancelFirstDataWait();

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(fixture.sessionBinding!.state.phase).toBe('Cancelled');
        expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(31);
        expect(harness.model.registrationOwners.size).toBe(0);
    });

    it('[RE-4.9] leaves the writer and the session phase to the deletion that cancelled the registration', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        harness.model.recordRegistrationTerminationIntent('Deletion');
        harness.model.cancelFirstDataWait();

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(fixture.sessionBinding!.state.phase).toBe('Registering');
        expect(fixture.writer.destroyed).toBe(false);
        expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(31);
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
        expect(unlink).toHaveBeenCalledExactlyOnceWith(RECORDING_PATH);
    });

    it('[RE-4.8] discards the replaced stream when the replaced registration completes after the wait was cancelled', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        const teardown = spyStreamTeardown(fixture.stream);
        const replacement = bindReplacement(fixture);
        harness.model.cancelFirstDataWait();

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(fixture.stream.destroyed).toBe(true);
        expect(teardown.push).toHaveBeenCalledWith(null);
        expect(replacement.state.phase).toBe('Preparing');
        expect(harness.model.registrationOwners.size).toBe(0);
    });

    it('[RE-4.9] cleans up a registration that was cancelled before the database error arrived', async () => {
        const fixture = makeFixture({ session: false });
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        harness.model.cancelFirstDataWait();

        fixture.videoInsert.reject(new Error('synthetic late rejection'));
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
        expect(unlink).toHaveBeenCalledExactlyOnceWith(RECORDING_PATH);
    });
});

describe('recorder registration completion', () => {
    it('[RE-4.8] discards the replaced stream and every registered row when a replacement took over before completion', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        const teardown = spyStreamTeardown(fixture.stream);
        const replacement = bindReplacement(fixture);

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(teardown.unpipe).toHaveBeenCalledWith();
        expect(teardown.destroy).toHaveBeenCalled();
        expect(teardown.push).toHaveBeenCalledWith(null);
        expect(teardown.removeAllListeners).toHaveBeenCalledWith('data');
        expect(fixture.writer.destroyed).toBe(true);
        expect(unlink).toHaveBeenCalledExactlyOnceWith(RECORDING_PATH);
        expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(31);
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
        expect(replacement.state.phase).toBe('Preparing');
        expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        expect(harness.model.registrationOwners.size).toBe(0);
    });

    it('[RE-4.8] does not touch a replaced stream that is already closed', async () => {
        const fixture = makeFixture();
        const outcome = await registerPending(fixture);
        const teardown = spyStreamTeardown(fixture.stream);
        bindReplacement(fixture);
        Object.defineProperty(fixture.stream, 'closed', { configurable: true, value: true });

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(fixture.stream.destroyed).toBe(false);
        expect(teardown.unpipe).not.toHaveBeenCalledWith();
        expect(teardown.push).not.toHaveBeenCalledWith(null);
        expect(teardown.removeAllListeners).not.toHaveBeenCalledWith('data');
    });

    it('[RE-4.9] cleans up the registration without discarding the receiving stream when the session left the registering phases', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        const teardown = spyStreamTeardown(fixture.stream);
        fixture.sessionBinding!.state.phase = 'Cancelled';

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(fixture.stream.destroyed).toBe(false);
        expect(teardown.push).not.toHaveBeenCalledWith(null);
        expect(fixture.writer.destroyed).toBe(true);
        expect(unlink).toHaveBeenCalledExactlyOnceWith(RECORDING_PATH);
        expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(31);
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
        expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        expect(harness.model.registrationOwners.size).toBe(0);
    });

    it('[RE-4.9] leaves the writer to the deletion when the session left the registering phases during a planned deletion', async () => {
        const fixture = makeFixture({
            onTryRegisterUse: model => {
                model.isPlanToDelete = true;
                return 'registered';
            },
        });
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        fixture.sessionBinding!.state.phase = 'Cancelled';

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(fixture.writer.destroyed).toBe(false);
        expect(fixture.provider!.releaseSessionUse).toHaveBeenCalledOnce();
        expect(unlink).toHaveBeenCalledExactlyOnceWith(RECORDING_PATH);
        expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(31);
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
        expect(harness.model.registrationOwners.size).toBe(0);
    });

    it('[RE-4.9] resolves as cancelled and releases the owner when a planned deletion removes the program during registration', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        fixture.hooks.beforeVideoInsert = () => {
            harness.model.isPlanToDelete = true;
        };
        const outcome = await registerPending(fixture);

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(31);
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
        expect(harness.model.registrationOwners.size).toBe(0);
        expect(fixture.sessionBinding!.state.phase).toBe('Registering');
    });

    it('[RE-4.9] cancels the preparation and releases the owner when the recorded use is refused', async () => {
        const fixture = makeFixture({ onTryRegisterUse: () => 'rejected' });
        const { harness } = fixture;
        const outcome = await registerPending(fixture);

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(harness.recordingEvent.emitCancelPrepRecording).toHaveBeenCalledExactlyOnceWith(fixture.reserve);
        expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        expect(harness.model.registrationOwners.size).toBe(0);
    });

    it('[RE-4.9] gives the recorded use back when the wait is cancelled while the use is being registered', async () => {
        const fixture = makeFixture({
            onTryRegisterUse: model => {
                model.cancelFirstDataWait();
                return 'registered';
            },
        });
        const { harness } = fixture;
        const outcome = await registerPending(fixture);

        fixture.videoInsert.resolve(31);
        await waitUntil(() => fixture.provider!.releaseSessionUse.mock.calls.length > 0, 'the recorded use release');

        expect(fixture.provider!.releaseSessionUse).toHaveBeenCalledExactlyOnceWith(harness.model, {
            recordedId: 21,
            status: 'active',
        });
        expect(harness.model.activeRecordedUse).toBeNull();
        expect(harness.model.setEndProcess).not.toHaveBeenCalled();
        expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();

        // 取り消された録画の開始は取りやめられ、doRecord の promise が決まる
        await settle(outcome);
        expect(outcome.state).toBe('resolved');
        expect(fixture.writer.destroyed).toBe(true);
        expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(31);
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
        expect(harness.model.registrationOwners.size).toBe(0);
        expect(harness.model.pendingRegistrationResources).toBeNull();
    });

    it('[RE-4.9] settles the wait and cancels the session when a cancellation arrives while the use is being registered', async () => {
        const fixture = makeFixture({
            onTryRegisterUse: model => {
                model.recordRegistrationTerminationIntent('Cancel');
                model.cancelFirstDataWait();
                return 'registered';
            },
        });
        const { harness } = fixture;
        const outcome = await registerPending(fixture);

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(fixture.provider!.releaseSessionUse).toHaveBeenCalledOnce();
        expect(fixture.sessionBinding!.state.phase).toBe('Cancelled');
        expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(31);
        expect(harness.model.registrationOwners.size).toBe(0);
        expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
    });

    it('[RE-4.7] publishes the started recording and clears its registration bookkeeping', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await registerPending(fixture);

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(fixture.sessionBinding!.state.phase).toBe('Recording');
        expect(harness.model.pendingRegistrationResources).toBeNull();
        expect(harness.model.registrationOwners.size).toBe(0);
        expect(harness.model.activeRecordedUse).toEqual({ recordedId: 21, status: 'active' });
        expect(harness.recordingEvent.emitStartRecording).toHaveBeenCalledOnce();
        expect(harness.model.setEventRelayTimer).toHaveBeenCalledExactlyOnceWith(fixture.reserve);
    });

    it('[RE-4.7] keeps a newer pending registration when the started recording completes', async () => {
        const fixture = makeFixture();
        const { harness } = fixture;
        const outcome = await registerPending(fixture);
        const newerPending = { recordedId: 77 };
        harness.model.pendingRegistrationResources = newerPending;

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(harness.model.pendingRegistrationResources).toBe(newerPending);
    });

    it('[RE-4.7] does not arm the event relay check for a recording without a program id', async () => {
        const fixture = makeFixture({ reserve: { programId: null } });
        const { harness } = fixture;
        const outcome = await registerPending(fixture);

        fixture.videoInsert.resolve(31);
        await settle(outcome);

        expect(outcome.state).toBe('resolved');
        expect(harness.recordingEvent.emitStartRecording).toHaveBeenCalledOnce();
        expect(harness.model.setEventRelayTimer).not.toHaveBeenCalled();
    });
});

describe('recorder addRecorded', () => {
    const recPath = {
        parendDir: { name: 'synthetic-root', path: '/synthetic-root' },
        subDir: '',
        fileName: 'a.ts',
        fullPath: 'synthetic-root/a.ts',
    };

    it.each([
        ['Registering', true],
        ['RegistrationOverdue', true],
        ['Preparing', false],
    ])('[RE-4.9] records the ids on the recorder only while the session is registering (%s)', async (phase, owned) => {
        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase });
        const harness = makeRecorder();
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);

        const recorded = await harness.model.addRecorded(recPath, true, session.binding);

        expect(recorded.id).toBe(21);
        expect(recorded.videoFiles[0]).toMatchObject({ filePath: 'a.ts', recordedId: 21 });
        expect(harness.model.recordedId).toBe(owned ? 21 : null);
        expect(harness.model.videoFileId).toBe(owned ? 31 : null);
        expect(harness.model.videoFileFulPath).toBe(owned ? recPath.fullPath : null);
    });

    it('[RE-4.7] keeps the database error as the cause of AddRecordedDBError', async () => {
        const reserve = makeReserve();
        const databaseError = new Error('synthetic insert rejection');
        const harness = makeRecorder({
            recordedDB: {
                insertOnce: vi.fn(async () => {
                    throw databaseError;
                }),
                deleteOnce: vi.fn(async () => undefined),
            },
        });
        harness.model.reserve = reserve;

        const failure = await harness.model.addRecorded(recPath).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toBe('AddRecordedDBError');
        expect((failure as Error).cause).toBe(databaseError);
    });

    it('[RE-4.9] returns null instead of failing when a planned deletion started while the registration failed', async () => {
        const reserve = makeReserve();
        const harness = makeRecorder();
        harness.model.reserve = reserve;
        harness.recordedDB.insertOnce.mockImplementation(async () => {
            harness.model.isPlanToDelete = true;
            throw new Error('synthetic insert rejection');
        });

        await expect(harness.model.addRecorded(recPath)).resolves.toBeNull();
        expect(harness.recordedDB.deleteOnce).not.toHaveBeenCalled();
        expect(unlink).toHaveBeenCalledExactlyOnceWith(recPath.fullPath);
    });
});

describe('recorder cleanupPendingRegistration', () => {
    const makeCleanupRecorder = () =>
        makeRecorder({
            recordedDB: { insertOnce: vi.fn(async () => 21), deleteOnce: vi.fn(async () => undefined) },
            videoFileDB: { insertOnce: vi.fn(async () => 31), deleteOnce: vi.fn(async () => undefined) },
        });

    const makeResources = () => ({
        cleanupLifetime: null as Promise<void> | null,
        dropLogFileId: 41 as number | null,
        filePath: 'synthetic-root/a.ts',
        recordedId: 21 as number | null,
        videoFileId: 31 as number | null,
    });

    it('[RE-4.9] deletes every registered row in order, clears the recorder state it owns, and runs once', async () => {
        const harness = makeCleanupRecorder();
        const resources = makeResources();
        harness.model.videoFileId = 31;
        harness.model.recordedId = 21;
        harness.model.dropLogFileId = 41;
        harness.model.videoFileFulPath = resources.filePath;
        harness.model.pendingRegistrationResources = resources;

        const first = harness.model.cleanupPendingRegistration(resources);
        await first;
        const second = harness.model.cleanupPendingRegistration(resources);
        await second;

        expect(second).toBe(first);
        expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(31);
        expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(21);
        expect(harness.dropLogFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(41);
        expect(unlink).toHaveBeenCalledExactlyOnceWith(resources.filePath);
        expect(harness.videoFileDB.deleteOnce.mock.invocationCallOrder[0]).toBeLessThan(
            harness.recordedDB.deleteOnce.mock.invocationCallOrder[0],
        );
        expect(harness.recordedDB.deleteOnce.mock.invocationCallOrder[0]).toBeLessThan(
            harness.dropLogFileDB.deleteOnce.mock.invocationCallOrder[0],
        );
        expect(harness.model.videoFileId).toBeNull();
        expect(harness.model.recordedId).toBeNull();
        expect(harness.model.dropLogFileId).toBeNull();
        expect(harness.model.videoFileFulPath).toBeNull();
        expect(harness.model.pendingRegistrationResources).toBeNull();
    });

    it('[RE-4.8] leaves the recorder state that belongs to another registration untouched', async () => {
        const harness = makeCleanupRecorder();
        const resources = makeResources();
        const otherPending = makeResources();
        harness.model.videoFileId = 99;
        harness.model.recordedId = 98;
        harness.model.dropLogFileId = 97;
        harness.model.videoFileFulPath = '/synthetic-root/other.ts';
        harness.model.pendingRegistrationResources = otherPending;

        await harness.model.cleanupPendingRegistration(resources);

        expect(harness.model.videoFileId).toBe(99);
        expect(harness.model.recordedId).toBe(98);
        expect(harness.model.dropLogFileId).toBe(97);
        expect(harness.model.videoFileFulPath).toBe('/synthetic-root/other.ts');
        expect(harness.model.pendingRegistrationResources).toBe(otherPending);
    });

    it('[RE-4.9] only removes the file when no row was registered', async () => {
        const harness = makeCleanupRecorder();
        const resources = makeResources();
        resources.dropLogFileId = null;
        resources.recordedId = null;
        resources.videoFileId = null;
        harness.model.videoFileId = 99;
        harness.model.recordedId = 98;
        harness.model.dropLogFileId = 97;

        await harness.model.cleanupPendingRegistration(resources);

        expect(harness.videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(harness.recordedDB.deleteOnce).not.toHaveBeenCalled();
        expect(harness.dropLogFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(unlink).toHaveBeenCalledExactlyOnceWith(resources.filePath);
        expect(harness.model.videoFileId).toBe(99);
        expect(harness.model.recordedId).toBe(98);
        expect(harness.model.dropLogFileId).toBe(97);
    });
});

describe('recorder recFailed', () => {
    const prepare = (phase: string) => {
        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase });
        const harness = makeRecorder();
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.recEnd = vi.fn(async () => undefined);
        return { harness, reserve, sessionBinding: session };
    };

    it.each(['Recording', 'PathSelectionOverdue', 'AwaitingFirstData', 'Registering', 'RegistrationOverdue'])(
        '[RE-4.7] publishes the failure of a session in the %s phase',
        async phase => {
            const { harness, reserve, sessionBinding: session } = prepare(phase);

            await harness.model.recFailed(new Error('synthetic stream failure'), session.binding);

            expect(harness.recordingEvent.emitRecordingFailed).toHaveBeenCalledExactlyOnceWith(
                reserve,
                null,
                session.binding,
            );
        },
    );

    it.each(['Finishing', 'Completed'])(
        '[RE-4.7] publishes the failure of a session that the finalization moved to %s',
        async phase => {
            const { harness, reserve, sessionBinding: session } = prepare('Recording');
            harness.model.recEnd = vi.fn(async () => {
                session.state.phase = phase;
            });

            await harness.model.recFailed(new Error('synthetic stream failure'), session.binding);

            expect(harness.recordingEvent.emitRecordingFailed).toHaveBeenCalledExactlyOnceWith(
                reserve,
                null,
                session.binding,
            );
        },
    );

    it('[RE-4.7] does not publish the failure of a session that the finalization cancelled', async () => {
        const { harness, sessionBinding: session } = prepare('Recording');
        harness.model.recEnd = vi.fn(async () => {
            session.state.phase = 'Cancelled';
        });

        await harness.model.recFailed(new Error('synthetic stream failure'), session.binding);

        expect(harness.recordingEvent.emitRecordingFailed).not.toHaveBeenCalled();
    });

    it('[RE-4.8] does not publish the failure of a session that was replaced, and does not throw', async () => {
        const { harness, reserve, sessionBinding: session } = prepare('Recording');
        const replacement = makeRecordingSessionBinding(reserve, {
            generation: 1n,
            phase: 'Recording',
            sessionToken: 8n,
        });
        harness.model.bindScheduleSession(replacement.binding);

        await expect(
            harness.model.recFailed(new Error('synthetic stream failure'), session.binding),
        ).resolves.toBeUndefined();

        expect(harness.recordingEvent.emitRecordingFailed).not.toHaveBeenCalled();
    });

    it.each([
        [false, true],
        [true, false],
    ])(
        '[RE-4.7] stops the drop check on failure only when no deletion is planned (planned: %s)',
        async (isPlanToDelete, stopsDropCheck) => {
            const { harness, reserve } = prepare('Recording');
            harness.model.isPlanToDelete = isPlanToDelete;
            harness.model.isNeedDeleteReservation = true;
            const destroyStream = vi.spyOn(harness.model, 'destroyStream');

            await harness.model.recFailed(new Error('synthetic stream failure'), null);

            expect(destroyStream).toHaveBeenCalledExactlyOnceWith(true, stopsDropCheck);
            expect(harness.model.isNeedDeleteReservation).toBe(false);
            expect(harness.recordingEvent.emitRecordingFailed).toHaveBeenCalledExactlyOnceWith(reserve, null);
        },
    );
});
