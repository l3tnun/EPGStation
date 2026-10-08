import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { Container } from 'inversify';
import { describe, expect, it, vi } from 'vitest';
import { deferred, load, makeRecorder, makeRecordingSessionBinding, makeReserve } from './_harness';

const RecordingRecordedUseProvider = load<new () => any>(
    'model',
    'operator',
    'recording',
    'RecordingRecordedUseProvider.js',
);
const FileUtil = load<{ unlink(filePath: string): Promise<void> }>('util', 'FileUtil.js');

const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const compiledRequire = createRequire(join(process.cwd(), 'package.json'));
const setModelContainer = (
    compiledRequire(join(compiledSnapshot, 'model', 'ModelContainerSetter.js')) as { set(container: Container): void }
).set;

const recordedIds = (snapshot: any): number[] => {
    expect(snapshot.status).toBe('known');
    return [...snapshot.recordedIds].sort((left, right) => left - right);
};

const makeSessionEffects = () => ({
    cancel: vi.fn(),
    closeWriter: vi.fn(),
    destroyStream: vi.fn(),
    stop: vi.fn(),
    stopDropCheck: vi.fn(),
});

const expectNoSessionEffects = (...effects: ReturnType<typeof makeSessionEffects>[]): void => {
    for (const effect of effects) {
        expect(effect.cancel).not.toHaveBeenCalled();
        expect(effect.closeWriter).not.toHaveBeenCalled();
        expect(effect.destroyStream).not.toHaveBeenCalled();
        expect(effect.stop).not.toHaveBeenCalled();
        expect(effect.stopDropCheck).not.toHaveBeenCalled();
    }
};

describe('recording recorded-use provider contract', () => {
    it('[Task 2.7] snapshots deduplicated active recorded IDs and excludes preparing and terminal sessions', () => {
        const provider = new RecordingRecordedUseProvider();
        const preparing = makeSessionEffects();
        const first = makeSessionEffects();
        const duplicate = makeSessionEffects();
        const second = makeSessionEffects();
        const terminal = makeSessionEffects();

        expect(provider.tryRegisterSessionUse(preparing, { status: 'preparing' })).toBe('registered');
        expect(provider.tryRegisterSessionUse(first, { status: 'active', recordedId: 701 })).toBe('registered');
        expect(provider.tryRegisterSessionUse(duplicate, { status: 'active', recordedId: 701 })).toBe('registered');
        expect(provider.tryRegisterSessionUse(second, { status: 'active', recordedId: 702 })).toBe('registered');
        expect(provider.tryRegisterSessionUse(terminal, { status: 'active', recordedId: 703 })).toBe('registered');
        provider.releaseSessionUse(terminal);

        const snapshot = provider.getActiveRecordedIds();
        expect(recordedIds(snapshot)).toEqual([701, 702]);
        (snapshot.recordedIds as Set<number>).add(799);
        expect(recordedIds(provider.getActiveRecordedIds())).toEqual([701, 702]);
        expectNoSessionEffects(preparing, first, duplicate, second, terminal);
    });

    it('[Task 2.7] returns a known empty snapshot when only no-ID preparation and terminal sessions exist', () => {
        const provider = new RecordingRecordedUseProvider();
        const preparing = makeSessionEffects();
        const terminal = makeSessionEffects();

        provider.tryRegisterSessionUse(preparing, { status: 'preparing' });
        provider.tryRegisterSessionUse(terminal, { status: 'active', recordedId: 711 });
        provider.releaseSessionUse(terminal);

        expect(recordedIds(provider.getActiveRecordedIds())).toEqual([]);
        expectNoSessionEffects(preparing, terminal);
    });

    it('[Task 2.7] removes a prior active projection when the same session returns to preparation', () => {
        const provider = new RecordingRecordedUseProvider();
        const session = makeSessionEffects();

        expect(provider.tryRegisterSessionUse(session, { status: 'active', recordedId: 712 })).toBe('registered');
        expect(recordedIds(provider.getActiveRecordedIds())).toEqual([712]);
        expect(provider.tryRegisterSessionUse(session, { status: 'preparing' })).toBe('registered');
        expect(recordedIds(provider.getActiveRecordedIds())).toEqual([]);
        expectNoSessionEffects(session);
    });

    it('[Task 2.7] returns unknown instead of a known subset while any session mapping is indeterminate', () => {
        const provider = new RecordingRecordedUseProvider();
        const known = makeSessionEffects();
        const indeterminate = makeSessionEffects();

        provider.tryRegisterSessionUse(known, { status: 'active', recordedId: 721 });
        provider.tryRegisterSessionUse(indeterminate, { status: 'unknown' });

        expect(provider.getActiveRecordedIds()).toEqual({ status: 'unknown' });
        expect(provider.tryAcquireDeletion(721)).toEqual({ status: 'unknown' });
        expect(provider.tryAcquireDeletion(722)).toEqual({ status: 'unknown' });

        provider.releaseSessionUse(indeterminate);
        expect(recordedIds(provider.getActiveRecordedIds())).toEqual([721]);
        expectNoSessionEffects(known, indeterminate);
    });

    it('[Task 2.7] blocks only a same-ID new session while one opaque deletion token is held', () => {
        const provider = new RecordingRecordedUseProvider();
        const existing = makeSessionEffects();
        const sameId = makeSessionEffects();
        const differentId = makeSessionEffects();

        provider.tryRegisterSessionUse(existing, { status: 'active', recordedId: 731 });
        const acquired = provider.tryAcquireDeletion(732);
        expect('token' in acquired).toBe(true);
        if (!('token' in acquired)) throw new Error('Expected a deletion token');
        expect(Object.keys(acquired.token)).toEqual([]);
        expect(Object.isFrozen(acquired.token)).toBe(true);

        expect(provider.tryRegisterSessionUse(sameId, { status: 'active', recordedId: 732 })).toBe('blocked');
        expect(provider.tryRegisterSessionUse(differentId, { status: 'active', recordedId: 733 })).toBe('registered');
        expect(recordedIds(provider.getActiveRecordedIds())).toEqual([731, 733]);
        expectNoSessionEffects(existing, sameId, differentId);

        provider.releaseDeletion(acquired.token);
        expect(provider.tryRegisterSessionUse(sameId, { status: 'active', recordedId: 732 })).toBe('registered');
        expect(recordedIds(provider.getActiveRecordedIds())).toEqual([731, 732, 733]);
        expectNoSessionEffects(existing, sameId, differentId);
    });

    it('[Task 2.7] blocks an indeterminate session while any deletion token is held', () => {
        const provider = new RecordingRecordedUseProvider();
        const indeterminate = makeSessionEffects();
        const acquired = provider.tryAcquireDeletion(734);
        if (!('token' in acquired)) throw new Error('Expected a deletion token');

        expect(provider.tryRegisterSessionUse(indeterminate, { status: 'unknown' })).toBe('blocked');
        expect(recordedIds(provider.getActiveRecordedIds())).toEqual([]);
        provider.releaseDeletion(acquired.token);

        expect(provider.tryRegisterSessionUse(indeterminate, { status: 'unknown' })).toBe('registered');
        expect(provider.getActiveRecordedIds()).toEqual({ status: 'unknown' });
        expectNoSessionEffects(indeterminate);
    });

    it('[Task 2.7] reports busy for active use without cancelling or stopping that session', () => {
        const provider = new RecordingRecordedUseProvider();
        const active = makeSessionEffects();
        provider.tryRegisterSessionUse(active, { status: 'active', recordedId: 741 });

        expect(provider.tryAcquireDeletion(741)).toEqual({ status: 'busy' });
        expectNoSessionEffects(active);
    });

    it('[Task 2.7] rejects a token-held recorded ID before active lifecycle publication and cleans its registration', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recorded-use-admission-'));
        const fullPath = join(root, 'blocked.ts');
        const unlink = vi.spyOn(FileUtil, 'unlink');
        const provider = new RecordingRecordedUseProvider();
        const existing = makeSessionEffects();
        const differentId = makeSessionEffects();
        const held = provider.tryAcquireDeletion(752);
        if (!('token' in held)) throw new Error('Expected a deletion token');
        provider.tryRegisterSessionUse(existing, { status: 'active', recordedId: 751 });
        provider.tryRegisterSessionUse(differentId, { status: 'active', recordedId: 753 });

        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        const stream = new PassThrough();
        const harness = makeRecorder({
            config: { isEnabledDropCheck: true },
            dropChecker: {
                getFilePath: vi.fn(() => '/synthetic-drop/754.log'),
                getResult: vi.fn(async () => ({})),
                prepare: vi.fn(async () => undefined),
                attach: vi.fn(),
                stop: vi.fn(async () => undefined),
            },
            dropLogFileDB: {
                deleteOnce: vi.fn(async () => true),
                insertOnce: vi.fn(async () => 754),
                updateCnt: vi.fn(async () => undefined),
            },
            recordedDB: {
                deleteOnce: vi.fn(async () => undefined),
                findId: vi.fn(),
                insertOnce: vi.fn(async () => 752),
                removeRecording: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    fileName: 'blocked.ts',
                    fullPath,
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn().mockResolvedValue(undefined),
            },
            recordedUseProvider: provider,
            videoFileDB: { deleteOnce: vi.fn(async () => undefined), insertOnce: vi.fn(async () => 752) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.setEndProcess = vi.fn();
        harness.model.setEventRelayTimer = vi.fn();
        harness.model.stream = stream;

        try {
            const recording = harness.model.doRecord();
            await new Promise(resolve => setImmediate(resolve));
            stream.write('synthetic-first-data');
            await recording;

            expect(session.state.phase).toBe('Cancelled');
            expect(harness.model.setEndProcess).not.toHaveBeenCalled();
            expect(harness.model.setEventRelayTimer).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitRecordingFailed).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitCancelPrepRecording).toHaveBeenCalledExactlyOnceWith(reserve);
            expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(752);
            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(752);
            expect(harness.dropLogFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(754);
            expect(harness.dropChecker.stop).toHaveBeenCalledOnce();
            expect(unlink).toHaveBeenCalledExactlyOnceWith(fullPath);
            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
            expect(stream.destroyed).toBe(true);
            expect(recordedIds(provider.getActiveRecordedIds())).toEqual([751, 753]);
            expectNoSessionEffects(existing, differentId);
        } finally {
            provider.releaseDeletion(held.token);
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            unlink.mockRestore();
            await rm(root, { force: true, recursive: true });
        }
    });

    it('[Task 2.7 review] registers an active use before the activation CAS and releases only that registration when it rejects', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recorded-use-admission-'));
        const fullPath = join(root, 'cas-rejected.ts');
        const provider = new RecordingRecordedUseProvider();
        const existing = makeSessionEffects();
        provider.tryRegisterSessionUse(existing, { status: 'active', recordedId: 771 });

        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        const originalTransition = session.binding.tryTransition;
        const activeIdsDuringCas: number[][] = [];
        session.binding.tryTransition = vi.fn((expectedPhase: string, nextPhase: string) => {
            if (expectedPhase === 'Registering' && nextPhase === 'Recording') {
                activeIdsDuringCas.push(recordedIds(provider.getActiveRecordedIds()));
                return false;
            }
            return originalTransition(expectedPhase, nextPhase);
        });
        const stream = new PassThrough();
        const harness = makeRecorder({
            recordedDB: {
                deleteOnce: vi.fn(async () => undefined),
                findId: vi.fn(),
                insertOnce: vi.fn(async () => 772),
                removeRecording: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    fileName: 'cas-rejected.ts',
                    fullPath,
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn().mockResolvedValue(undefined),
            },
            recordedUseProvider: provider,
            videoFileDB: { deleteOnce: vi.fn(async () => undefined), insertOnce: vi.fn(async () => 772) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.setEndProcess = vi.fn();
        harness.model.setEventRelayTimer = vi.fn();
        harness.model.stream = stream;

        try {
            const recording = harness.model.doRecord();
            await new Promise(resolve => setImmediate(resolve));
            stream.write('synthetic-first-data');
            await recording;

            expect(activeIdsDuringCas).toEqual([[771, 772]]);
            expect(harness.model.setEndProcess).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            expect(harness.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(772);
            expect(harness.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(772);
            expect(recordedIds(provider.getActiveRecordedIds())).toEqual([771]);
            expectNoSessionEffects(existing);
        } finally {
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await rm(root, { force: true, recursive: true });
        }
    });

    it('[Task 2.7] publishes a token-released recorded ID without cancellation or registration cleanup', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recorded-use-admission-'));
        const fullPath = join(root, 'released.ts');
        const provider = new RecordingRecordedUseProvider();
        const existing = makeSessionEffects();
        const differentId = makeSessionEffects();
        const held = provider.tryAcquireDeletion(762);
        if (!('token' in held)) throw new Error('Expected a deletion token');
        provider.releaseDeletion(held.token);
        provider.tryRegisterSessionUse(existing, { status: 'active', recordedId: 761 });
        provider.tryRegisterSessionUse(differentId, { status: 'active', recordedId: 763 });

        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        const stream = new PassThrough();
        const harness = makeRecorder({
            recordedDB: {
                deleteOnce: vi.fn(async () => undefined),
                findId: vi.fn(),
                insertOnce: vi.fn(async () => 762),
                removeRecording: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    fileName: 'released.ts',
                    fullPath,
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn().mockResolvedValue(undefined),
            },
            recordedUseProvider: provider,
            videoFileDB: { deleteOnce: vi.fn(async () => undefined), insertOnce: vi.fn(async () => 762) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.setEndProcess = vi.fn();
        harness.model.setEventRelayTimer = vi.fn();
        harness.model.stream = stream;

        try {
            const recording = harness.model.doRecord();
            await new Promise(resolve => setImmediate(resolve));
            stream.write('synthetic-first-data');
            await recording;

            expect(session.state.phase).toBe('Recording');
            expect(harness.model.setEndProcess).toHaveBeenCalledExactlyOnceWith(stream, session.binding);
            expect(harness.model.setEventRelayTimer).toHaveBeenCalledExactlyOnceWith(reserve);
            expect(harness.recordingEvent.emitStartRecording).toHaveBeenCalledExactlyOnceWith(
                reserve,
                expect.objectContaining({ id: 762 }),
            );
            expect(harness.recordingEvent.emitCancelPrepRecording).not.toHaveBeenCalled();
            expect(harness.videoFileDB.deleteOnce).not.toHaveBeenCalled();
            expect(harness.recordedDB.deleteOnce).not.toHaveBeenCalled();
            // `fs.createWriteStream(fullPath, { flags: 'wx' })` opens asynchronously -- the file
            // does not exist when the constructor returns, and the recorder's own `open` listener
            // is what marks it owned. A single stat here reads whichever side of that open the
            // host happens to be on, so wait for the condition instead of sampling it once.
            await vi.waitFor(async () => expect((await stat(fullPath)).isFile()).toBe(true));
            expect(stream.destroyed).toBe(false);
            expect(recordedIds(provider.getActiveRecordedIds())).toEqual([761, 762, 763]);
            expectNoSessionEffects(existing, differentId);
        } finally {
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await rm(root, { force: true, recursive: true });
        }
    });
});

describe('recording manager recorded-use lifecycle binding', () => {
    it('[Task 2.7] projects preparing, active, unknown, terminal, and replacement sessions into the shared provider', async () => {
        const first = makeSessionEffects();
        const replacement = makeSessionEffects();
        const terminalOnly = makeSessionEffects();
        const deletionTerminal = deferred<void>();
        const replacementTerminal = deferred<void>();
        const terminalOnlyTerminal = deferred<void>();
        first.cancel.mockResolvedValue(undefined);
        first.whenDeletionTerminal = vi.fn(() => deletionTerminal.promise);
        replacement.whenNormalRecordingTerminal = vi.fn(() => replacementTerminal.promise);
        terminalOnly.whenNormalRecordingTerminal = vi.fn(() => terminalOnlyTerminal.promise);
        const callbacks: Record<string, (...args: any[]) => unknown> = {};
        const container = new Container();
        setModelContainer(container);
        container
            .rebind('ILoggerModel')
            .toConstantValue({ getLogger: () => ({ system: { debug: vi.fn(), error: vi.fn(), info: vi.fn() } }) });
        container.rebind('IConfiguration').toConstantValue({ getConfig: () => ({}) });
        container.rebind('RecorderModelProvider').toConstantValue(vi.fn(async () => first));
        container.rebind('IRecordingStreamCreator').toConstantValue({ setTuner: vi.fn() });
        container.rebind('IRecordedDB').toConstantValue({});
        container.rebind('IReserveDB').toConstantValue({});
        container.rebind('IRecordingUtilModel').toConstantValue({});
        container.rebind('IRecordingEvent').toConstantValue({
            setCancelPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.cancelPrep = callback),
            setFinishRecording: (callback: (...args: any[]) => unknown) => (callbacks.finish = callback),
            setPrepRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.prepFailed = callback),
            setRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.failed = callback),
            setStartPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.preparing = callback),
            setStartRecording: (callback: (...args: any[]) => unknown) => (callbacks.started = callback),
        });
        const manager: any = container.get('IRecordingManageModel');
        const provider = container.get('RecordingRecordedUseProvider') as any;
        manager.recordingIndex = { 901: first };
        manager.deleteRecording = vi.fn();
        manager.candidateStartupState = 'Failed';

        callbacks.preparing({ id: 901 });
        expect(recordedIds(provider.getActiveRecordedIds())).toEqual([]);

        callbacks.started({ id: 901 }, { id: 1901 });
        expect(recordedIds(provider.getActiveRecordedIds())).toEqual([1901]);
        expect(provider.tryAcquireDeletion(1901)).toEqual({ status: 'busy' });

        await manager.cancel(901, true);
        expect(provider.tryAcquireDeletion(1901)).toEqual({ status: 'busy' });
        deletionTerminal.resolve();
        await deletionTerminal.promise;
        await Promise.resolve();
        const releasedAfterDeletionTerminal = provider.tryAcquireDeletion(1901);
        expect('token' in releasedAfterDeletionTerminal).toBe(true);
        if ('token' in releasedAfterDeletionTerminal) provider.releaseDeletion(releasedAfterDeletionTerminal.token);

        callbacks.started({ id: 901 }, { id: undefined });
        expect(provider.getActiveRecordedIds()).toEqual({ status: 'unknown' });

        manager.recordingIndex[901] = replacement;
        callbacks.started({ id: 901 }, { id: 1902 });
        expect(recordedIds(provider.getActiveRecordedIds())).toEqual([1902]);
        callbacks.finish({ id: 901 }, { id: 1901 }, false);
        expect(recordedIds(provider.getActiveRecordedIds())).toEqual([1902]);
        callbacks.finish({ id: 901 }, { id: 1902 }, false);
        expect(provider.tryAcquireDeletion(1902)).toEqual({ status: 'busy' });
        replacementTerminal.resolve();
        await replacementTerminal.promise;
        await Promise.resolve();
        expect(recordedIds(provider.getActiveRecordedIds())).toEqual([]);

        manager.recordingIndex[903] = terminalOnly;
        callbacks.started({ id: 903 }, { id: 1903 });
        expect(provider.tryAcquireDeletion(1903)).toEqual({ status: 'busy' });
        terminalOnlyTerminal.resolve();
        await terminalOnlyTerminal.promise;
        await Promise.resolve();
        const releasedAfterNormalTerminal = provider.tryAcquireDeletion(1903);
        expect('token' in releasedAfterNormalTerminal).toBe(true);
        if ('token' in releasedAfterNormalTerminal) provider.releaseDeletion(releasedAfterNormalTerminal.token);

        manager.recordingIndex[902] = makeSessionEffects();
        callbacks.started({ id: 902 }, { id: undefined });
        expect(provider.getActiveRecordedIds()).toEqual({ status: 'unknown' });
        expect(provider.tryAcquireDeletion(1999)).toEqual({ status: 'unknown' });
        callbacks.prepFailed({ id: 902 });
        expect(recordedIds(provider.getActiveRecordedIds())).toEqual([]);
        expect(first.cancel).toHaveBeenCalledExactlyOnceWith(true);
        expect(first.closeWriter).not.toHaveBeenCalled();
        expect(first.destroyStream).not.toHaveBeenCalled();
        expect(first.stop).not.toHaveBeenCalled();
        expect(first.stopDropCheck).not.toHaveBeenCalled();
        expectNoSessionEffects(replacement, terminalOnly);
    });
});
