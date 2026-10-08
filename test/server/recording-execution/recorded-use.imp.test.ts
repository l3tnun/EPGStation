import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { deferred, flushImmediate, load, makeRecorder, makeRecordingSessionBinding, makeReserve } from './_harness';

const RecordingRecordedUseProvider = load<new () => any>(
    'model',
    'operator',
    'recording',
    'RecordingRecordedUseProvider.js',
);

const RecordingManageModel = load<{ prototype: Record<string, unknown> }>(
    'model',
    'operator',
    'recording',
    'RecordingManageModel.js',
);

const acquireToken = (provider: any, recordedId: number): object => {
    const acquired = provider.tryAcquireDeletion(recordedId);
    expect('token' in acquired).toBe(true);
    if (!('token' in acquired)) throw new Error('Expected a deletion token');
    return acquired.token;
};

const expectBlocked = (provider: any, recordedId: number): void => {
    expect(provider.tryRegisterSessionUse(Object.freeze({}), { status: 'active', recordedId })).toBe('blocked');
};

const expectCanStart = (provider: any, recordedId: number): void => {
    const identity = Object.freeze({});
    expect(provider.tryRegisterSessionUse(identity, { status: 'active', recordedId })).toBe('registered');
    provider.releaseSessionUse(identity);
};

describe('recording recorded-use provider internals', () => {
    it.each(['double-and-stale', 'foreign', 'other-recorded-id'] as const)(
        '[Task 2.7] keeps the current gate fenced for a %s release',
        releaseCase => {
            const provider = new RecordingRecordedUseProvider();

            if (releaseCase === 'double-and-stale') {
                const stale = acquireToken(provider, 801);
                provider.releaseDeletion(stale);
                const current = acquireToken(provider, 801);
                provider.releaseDeletion(stale);
                provider.releaseDeletion(stale);
                expectBlocked(provider, 801);
                provider.releaseDeletion(current);
                expectCanStart(provider, 801);
                return;
            }

            if (releaseCase === 'foreign') {
                const other = new RecordingRecordedUseProvider();
                const current = acquireToken(provider, 811);
                const foreign = acquireToken(other, 811);
                provider.releaseDeletion(foreign);
                expectBlocked(provider, 811);
                provider.releaseDeletion(current);
                expectCanStart(provider, 811);
                other.releaseDeletion(foreign);
                return;
            }

            const released = acquireToken(provider, 821);
            const current = acquireToken(provider, 822);
            provider.releaseDeletion(released);
            expectCanStart(provider, 821);
            expectBlocked(provider, 822);
            provider.releaseDeletion(current);
            expectCanStart(provider, 822);
        },
    );

    it('[Task 2.7] preserves the prior active projection when a gated-ID replacement is rejected', () => {
        const provider = new RecordingRecordedUseProvider();
        const identity = Object.freeze({});
        provider.tryRegisterSessionUse(identity, { status: 'active', recordedId: 831 });
        const deletion = acquireToken(provider, 832);

        expect(provider.tryRegisterSessionUse(identity, { status: 'active', recordedId: 832 })).toBe('blocked');
        expect([...provider.getActiveRecordedIds().recordedIds]).toEqual([831]);

        provider.releaseDeletion(deletion);
        expect(provider.tryRegisterSessionUse(identity, { status: 'active', recordedId: 832 })).toBe('registered');
        expect([...provider.getActiveRecordedIds().recordedIds]).toEqual([832]);
    });

    it('[Task 2.7] keeps snapshot reads side-effect free and leaves a held gate unchanged', () => {
        vi.useFakeTimers();
        try {
            const provider = new RecordingRecordedUseProvider();
            const active = Object.freeze({
                cancel: vi.fn(),
                closeWriter: vi.fn(),
                destroyStream: vi.fn(),
                stop: vi.fn(),
                stopDropCheck: vi.fn(),
            });
            provider.tryRegisterSessionUse(active, { status: 'active', recordedId: 841 });
            const deletion = acquireToken(provider, 842);

            expect([...provider.getActiveRecordedIds().recordedIds]).toEqual([841]);
            expectBlocked(provider, 842);
            expect(active.cancel).not.toHaveBeenCalled();
            expect(active.closeWriter).not.toHaveBeenCalled();
            expect(active.destroyStream).not.toHaveBeenCalled();
            expect(active.stop).not.toHaveBeenCalled();
            expect(active.stopDropCheck).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);

            provider.releaseDeletion(deletion);
        } finally {
            vi.useRealTimers();
        }
    });

    it('[Task 2.7] reports the same recorded ID busy until the exact deletion token is released', () => {
        const provider = new RecordingRecordedUseProvider();
        const token = acquireToken(provider, 851);

        expect(provider.tryAcquireDeletion(851)).toEqual({ status: 'busy' });
        const different = acquireToken(provider, 852);
        provider.releaseDeletion(different);
        expect(provider.tryAcquireDeletion(851)).toEqual({ status: 'busy' });

        provider.releaseDeletion(token);
        const replacement = acquireToken(provider, 851);
        provider.releaseDeletion(replacement);
    });

    it('[Task 2.7 review] leaves a newer or different active registration intact when a stale registration releases', () => {
        const provider = new RecordingRecordedUseProvider();
        const identity = Object.freeze({});
        const first = Object.freeze({ recordedId: 861, status: 'active' as const });
        const current = Object.freeze({ recordedId: 862, status: 'active' as const });
        const different = Object.freeze({ recordedId: 863, status: 'active' as const });

        expect(provider.tryRegisterSessionUse(identity, first)).toBe('registered');
        expect(provider.tryRegisterSessionUse(identity, current)).toBe('registered');
        provider.releaseSessionUse(identity, first);
        provider.releaseSessionUse(identity, different);

        expect([...provider.getActiveRecordedIds().recordedIds]).toEqual([862]);
        expect(provider.tryAcquireDeletion(862)).toEqual({ status: 'busy' });

        provider.releaseSessionUse(identity, current);
        const acquired = provider.tryAcquireDeletion(862);
        expect('token' in acquired).toBe(true);
        if ('token' in acquired) provider.releaseDeletion(acquired.token);
    });
});

describe('recording manager recorded-use lifecycle internals', () => {
    it('[Task 2.7] releases only the terminal session projection without cancellation or timer side effects', () => {
        vi.useFakeTimers();
        try {
            const provider = new RecordingRecordedUseProvider();
            const recorder = Object.freeze({
                cancel: vi.fn(),
                closeWriter: vi.fn(),
                destroyStream: vi.fn(),
                stop: vi.fn(),
                stopDropCheck: vi.fn(),
            });
            const callbacks: Record<string, (...args: any[]) => unknown> = {};
            const manager: any = Object.create(RecordingManageModel.prototype);
            manager.activeRecordedUseSessions = new Map();
            manager.candidateStartupState = 'Failed';
            manager.deleteRecording = vi.fn();
            manager.normalRecordedUseTerminals = new Map();
            manager.recordedUseProvider = provider;
            manager.recordingIndex = { 911: recorder };
            manager.unknownRecordedUseSessions = new Map();
            manager.recordingEvent = {
                setCancelPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.cancelPrep = callback),
                setFinishRecording: (callback: (...args: any[]) => unknown) => (callbacks.finish = callback),
                setPrepRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.prepFailed = callback),
                setRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.failed = callback),
                setStartPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.preparing = callback),
                setStartRecording: (callback: (...args: any[]) => unknown) => (callbacks.started = callback),
            };

            (manager.setEvents as () => void)();
            callbacks.started({ id: 911 }, { id: 1911 });
            expect(provider.tryAcquireDeletion(1911)).toEqual({ status: 'busy' });
            callbacks.finish({ id: 911 }, { id: 1911 }, false);

            const released = provider.tryAcquireDeletion(1911);
            expect('token' in released).toBe(true);
            if ('token' in released) provider.releaseDeletion(released.token);
            expect(recorder.cancel).not.toHaveBeenCalled();
            expect(recorder.closeWriter).not.toHaveBeenCalled();
            expect(recorder.destroyStream).not.toHaveBeenCalled();
            expect(recorder.stop).not.toHaveBeenCalled();
            expect(recorder.stopDropCheck).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('[Task 2.7] releases an active projection only after its planned-deletion terminal settles', async () => {
        const provider = new RecordingRecordedUseProvider();
        const terminal = deferred<void>();
        const recorder = {
            cancel: vi.fn(async () => undefined),
            whenDeletionTerminal: vi.fn(() => terminal.promise),
        };
        const recordedUse = Object.freeze({ recordedId: 1912, status: 'active' as const });
        const manager: any = Object.create(RecordingManageModel.prototype);
        manager.activeRecordedUseSessions = new Map([
            [recorder, { recordedId: 1912, recordedUse, recorder, reservationId: 912 }],
        ]);
        manager.deletionStops = new Map();
        manager.deleteRecording = vi.fn();
        manager.log = { system: { error: vi.fn(), info: vi.fn() } };
        manager.normalRecordedUseTerminals = new Map();
        manager.recordedUseProvider = provider;
        manager.recordingIndex = { 912: recorder };
        manager.unknownRecordedUseSessions = new Map();
        provider.tryRegisterSessionUse(recorder, recordedUse);

        await manager.cancel(912, true);
        expect(provider.tryAcquireDeletion(1912)).toEqual({ status: 'busy' });

        terminal.resolve();
        await terminal.promise;
        await Promise.resolve();

        const released = provider.tryAcquireDeletion(1912);
        expect('token' in released).toBe(true);
        if ('token' in released) provider.releaseDeletion(released.token);
        expect(manager.deleteRecording).toHaveBeenCalledWith(912);
    });

    it('[Task 2.7] settles the normal recorder terminal without a finish event and consumes finalization rejection', async () => {
        const harness = makeRecorder({
            recordedDB: { removeRecording: vi.fn(), findId: vi.fn(async () => null) },
        });
        harness.model.reserve = makeReserve();
        harness.model.recordedId = 1913;
        let settled = false;
        const terminal = harness.model.whenNormalRecordingTerminal();
        void terminal.then(() => {
            settled = true;
        });

        await Promise.resolve();
        expect(settled).toBe(false);
        await harness.model.recEnd();
        await terminal;

        expect(harness.recordingEvent.emitFinishRecording).not.toHaveBeenCalled();
        expect(settled).toBe(true);

        const planned = makeRecorder();
        planned.model.reserve = makeReserve();
        planned.model.isPlanToDelete = true;
        planned.model.recordedId = 1915;
        let plannedTerminalSettled = false;
        void planned.model.whenNormalRecordingTerminal().then(() => {
            plannedTerminalSettled = true;
        });

        await planned.model.recEnd();
        await Promise.resolve();

        expect(plannedTerminalSettled).toBe(false);
        expect(planned.recordingEvent.emitFinishRecording).not.toHaveBeenCalled();

        const failure = new Error('synthetic final requery rejection');
        const rejected = makeRecorder({
            recordedDB: { removeRecording: vi.fn(), findId: vi.fn(async () => Promise.reject(failure)) },
        });
        rejected.model.reserve = makeReserve();
        rejected.model.recordedId = 1914;
        let rejectedTerminalSettled = false;
        void rejected.model.whenNormalRecordingTerminal().then(() => {
            rejectedTerminalSettled = true;
        });

        await expect(rejected.model.recEnd()).rejects.toBe(failure);
        await Promise.resolve();
        await Promise.resolve();

        expect(rejectedTerminalSettled).toBe(true);
        expect(rejected.recordingEvent.emitFinishRecording).not.toHaveBeenCalled();
    });

    it('[Task 2.7 review] keeps a normal recorded use busy until writer, stream, drop, and size terminals settle', async () => {
        const provider = new RecordingRecordedUseProvider();
        const size = deferred<void>();
        const dropStop = deferred<void>();
        const stream = Object.assign(new EventEmitter(), {
            closed: false,
            destroy: vi.fn(),
            push: vi.fn(),
            readableEnded: false,
            unpipe: vi.fn(),
        });
        const writer = Object.assign(new EventEmitter(), { closed: false, end: vi.fn() });
        const reserve = makeReserve({ id: 914 });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        const harness = makeRecorder({
            dropChecker: {
                getFilePath: vi.fn(() => null),
                getResult: vi.fn(async () => ({})),
                prepare: vi.fn(async () => undefined),
                attach: vi.fn(),
                stop: vi.fn(() => dropStop.promise),
            },
            recordedDB: {
                findId: vi.fn(async () => null),
                removeRecording: vi.fn(async () => undefined),
            },
            recordedUseProvider: provider,
            recordingUtil: { updateVideoFileSize: vi.fn(() => size.promise) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.dropLogFileId = null;
        harness.model.isDropCheckerActive = true;
        harness.model.isRecording = true;
        harness.model.recordedId = 1916;
        harness.model.recFile = writer;
        harness.model.stream = stream;
        harness.model.videoFileFulPath = '/synthetic-root/1916.ts';
        harness.model.videoFileId = 1917;

        const callbacks: Record<string, (...args: any[]) => unknown> = {};
        const manager: any = Object.create(RecordingManageModel.prototype);
        manager.activeRecordedUseSessions = new Map();
        manager.candidateStartupState = 'Failed';
        manager.deleteRecording = vi.fn();
        manager.normalRecordedUseTerminals = new Map();
        manager.recordedUseProvider = provider;
        manager.recordingIndex = { 914: harness.model };
        manager.unknownRecordedUseSessions = new Map();
        manager.recordingEvent = {
            setCancelPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.cancelPrep = callback),
            setFinishRecording: (callback: (...args: any[]) => unknown) => (callbacks.finish = callback),
            setPrepRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.prepFailed = callback),
            setRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.failed = callback),
            setStartPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.preparing = callback),
            setStartRecording: (callback: (...args: any[]) => unknown) => (callbacks.started = callback),
        };
        (manager.setEvents as () => void)();
        callbacks.started(reserve, { id: 1916 });

        const terminal = harness.model.whenNormalRecordingTerminal();
        const finalization = harness.model.recEnd();
        try {
            await finalization;
            await Promise.resolve();

            expect(provider.tryAcquireDeletion(1916)).toEqual({ status: 'busy' });

            size.resolve();
            stream.emit('close');
            writer.closed = true;
            writer.emit('close');
            dropStop.resolve();
            await terminal;
            await Promise.resolve();

            const acquired = provider.tryAcquireDeletion(1916);
            expect('token' in acquired).toBe(true);
            if ('token' in acquired) provider.releaseDeletion(acquired.token);
        } finally {
            size.resolve();
            stream.emit('close');
            writer.closed = true;
            writer.emit('close');
            dropStop.resolve();
            await Promise.allSettled([finalization, terminal]);
        }
    });

    it('[Task 2.7 review] does not release a failed recorded use before its recorder terminal settles', async () => {
        const provider = new RecordingRecordedUseProvider();
        const terminal = deferred<void>();
        const recorder = { whenNormalRecordingTerminal: vi.fn(() => terminal.promise) };
        const reserve = makeReserve({ id: 915 });
        const callbacks: Record<string, (...args: any[]) => unknown> = {};
        const manager: any = Object.create(RecordingManageModel.prototype);
        manager.activeRecordedUseSessions = new Map();
        manager.candidateStartupState = 'Starting';
        manager.deleteRecording = vi.fn();
        manager.normalRecordedUseTerminals = new Map();
        manager.pendingStartupRecordingFailures = [];
        manager.recordedUseProvider = provider;
        manager.recordingIndex = { 915: recorder };
        manager.unknownRecordedUseSessions = new Map();
        manager.recordingEvent = {
            setCancelPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.cancelPrep = callback),
            setFinishRecording: (callback: (...args: any[]) => unknown) => (callbacks.finish = callback),
            setPrepRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.prepFailed = callback),
            setRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.failed = callback),
            setStartPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.preparing = callback),
            setStartRecording: (callback: (...args: any[]) => unknown) => (callbacks.started = callback),
        };
        (manager.setEvents as () => void)();
        callbacks.started(reserve, { id: 1918 });
        await callbacks.failed(reserve, { id: 1918 });

        expect(provider.tryAcquireDeletion(1918)).toEqual({ status: 'busy' });

        terminal.resolve();
        await terminal.promise;
        await Promise.resolve();

        const acquired = provider.tryAcquireDeletion(1918);
        expect('token' in acquired).toBe(true);
        if ('token' in acquired) provider.releaseDeletion(acquired.token);
    });

    it('[Task 2.7 review] releases each same-ID session only when that session finishes', () => {
        const provider = new RecordingRecordedUseProvider();
        const first = Object.freeze({});
        const second = Object.freeze({});
        const callbacks: Record<string, (...args: any[]) => unknown> = {};
        const manager: any = Object.create(RecordingManageModel.prototype);
        manager.activeRecordedUseSessions = new Map();
        manager.candidateStartupState = 'Failed';
        manager.deleteRecording = vi.fn();
        manager.normalRecordedUseTerminals = new Map();
        manager.recordedUseProvider = provider;
        manager.recordingIndex = { 916: first, 917: second };
        manager.unknownRecordedUseSessions = new Map();
        manager.recordingEvent = {
            setCancelPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.cancelPrep = callback),
            setFinishRecording: (callback: (...args: any[]) => unknown) => (callbacks.finish = callback),
            setPrepRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.prepFailed = callback),
            setRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.failed = callback),
            setStartPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.preparing = callback),
            setStartRecording: (callback: (...args: any[]) => unknown) => (callbacks.started = callback),
        };
        (manager.setEvents as () => void)();
        callbacks.started({ id: 916 }, { id: 1919 });
        callbacks.started({ id: 917 }, { id: 1919 });

        callbacks.finish({ id: 916 }, { id: 1919 }, false);
        expect(provider.tryAcquireDeletion(1919)).toEqual({ status: 'busy' });

        callbacks.finish({ id: 917 }, { id: 1919 }, false);
        const acquired = provider.tryAcquireDeletion(1919);
        expect('token' in acquired).toBe(true);
        if ('token' in acquired) provider.releaseDeletion(acquired.token);
    });

    it('[Task 2.7 review] releases the correct same-ID session when the later session finishes first', () => {
        const provider = new RecordingRecordedUseProvider();
        const first = Object.freeze({});
        const second = Object.freeze({});
        const callbacks: Record<string, (...args: any[]) => unknown> = {};
        const manager: any = Object.create(RecordingManageModel.prototype);
        manager.activeRecordedUseSessions = new Map();
        manager.candidateStartupState = 'Failed';
        manager.deleteRecording = vi.fn();
        manager.normalRecordedUseTerminals = new Map();
        manager.recordedUseProvider = provider;
        manager.recordingIndex = { 916: first, 917: second };
        manager.unknownRecordedUseSessions = new Map();
        manager.recordingEvent = {
            setCancelPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.cancelPrep = callback),
            setFinishRecording: (callback: (...args: any[]) => unknown) => (callbacks.finish = callback),
            setPrepRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.prepFailed = callback),
            setRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.failed = callback),
            setStartPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.preparing = callback),
            setStartRecording: (callback: (...args: any[]) => unknown) => (callbacks.started = callback),
        };
        (manager.setEvents as () => void)();
        callbacks.started({ id: 916 }, { id: 1920 });
        callbacks.started({ id: 917 }, { id: 1920 });

        callbacks.finish({ id: 917 }, { id: 1920 }, false);
        expect(provider.tryAcquireDeletion(1920)).toEqual({ status: 'busy' });

        callbacks.finish({ id: 916 }, { id: 1920 }, false);
        const acquired = provider.tryAcquireDeletion(1920);
        expect('token' in acquired).toBe(true);
        if ('token' in acquired) provider.releaseDeletion(acquired.token);
    });

    it('[Task 2.7 review] keeps a duplicate preparing event from releasing an active recorder use', () => {
        const provider = new RecordingRecordedUseProvider();
        const recorder = Object.freeze({});
        const callbacks: Record<string, (...args: any[]) => unknown> = {};
        const manager: any = Object.create(RecordingManageModel.prototype);
        manager.activeRecordedUseSessions = new Map();
        manager.candidateStartupState = 'Failed';
        manager.deleteRecording = vi.fn();
        manager.normalRecordedUseTerminals = new Map();
        manager.recordedUseProvider = provider;
        manager.recordingIndex = { 918: recorder };
        manager.unknownRecordedUseSessions = new Map();
        manager.recordingEvent = {
            setCancelPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.cancelPrep = callback),
            setFinishRecording: (callback: (...args: any[]) => unknown) => (callbacks.finish = callback),
            setPrepRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.prepFailed = callback),
            setRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.failed = callback),
            setStartPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.preparing = callback),
            setStartRecording: (callback: (...args: any[]) => unknown) => (callbacks.started = callback),
        };
        (manager.setEvents as () => void)();
        callbacks.started({ id: 918 }, { id: 1921 });
        callbacks.preparing({ id: 918 });

        expect(provider.tryAcquireDeletion(1921)).toEqual({ status: 'busy' });

        callbacks.finish({ id: 918 }, { id: 1921 }, false);
        const acquired = provider.tryAcquireDeletion(1921);
        expect('token' in acquired).toBe(true);
        if ('token' in acquired) provider.releaseDeletion(acquired.token);
    });

    it('[Task 2.7 review] defers finish-event release until its normal recorder terminal settles', async () => {
        const provider = new RecordingRecordedUseProvider();
        const terminal = deferred<void>();
        const recorder = { whenNormalRecordingTerminal: vi.fn(() => terminal.promise) };
        const callbacks: Record<string, (...args: any[]) => unknown> = {};
        const manager: any = Object.create(RecordingManageModel.prototype);
        manager.activeRecordedUseSessions = new Map();
        manager.candidateStartupState = 'Failed';
        manager.deleteRecording = vi.fn();
        manager.normalRecordedUseTerminals = new Map();
        manager.recordedUseProvider = provider;
        manager.recordingIndex = { 919: recorder };
        manager.unknownRecordedUseSessions = new Map();
        manager.recordingEvent = {
            setCancelPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.cancelPrep = callback),
            setFinishRecording: (callback: (...args: any[]) => unknown) => (callbacks.finish = callback),
            setPrepRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.prepFailed = callback),
            setRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.failed = callback),
            setStartPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.preparing = callback),
            setStartRecording: (callback: (...args: any[]) => unknown) => (callbacks.started = callback),
        };
        (manager.setEvents as () => void)();
        callbacks.started({ id: 919 }, { id: 1922 });
        callbacks.finish({ id: 919 }, { id: 1922 }, false);

        expect(provider.tryAcquireDeletion(1922)).toEqual({ status: 'busy' });

        terminal.resolve();
        await terminal.promise;
        await Promise.resolve();
        const acquired = provider.tryAcquireDeletion(1922);
        expect('token' in acquired).toBe(true);
        if ('token' in acquired) provider.releaseDeletion(acquired.token);
    });

    it('[Task 2.7 review] keeps a same-ID re-registration busy when its older terminal settles', async () => {
        const provider = new RecordingRecordedUseProvider();
        const firstTerminal = deferred<void>();
        const recorder = {
            whenNormalRecordingTerminal: vi
                .fn<() => Promise<void> | undefined>()
                .mockReturnValueOnce(firstTerminal.promise)
                .mockReturnValueOnce(undefined),
        };
        const callbacks: Record<string, (...args: any[]) => unknown> = {};
        const manager: any = Object.create(RecordingManageModel.prototype);
        manager.activeRecordedUseSessions = new Map();
        manager.candidateStartupState = 'Failed';
        manager.deleteRecording = vi.fn();
        manager.normalRecordedUseTerminals = new Map();
        manager.recordedUseProvider = provider;
        manager.recordingIndex = { 920: recorder };
        manager.unknownRecordedUseSessions = new Map();
        manager.recordingEvent = {
            setCancelPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.cancelPrep = callback),
            setFinishRecording: (callback: (...args: any[]) => unknown) => (callbacks.finish = callback),
            setPrepRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.prepFailed = callback),
            setRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.failed = callback),
            setStartPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.preparing = callback),
            setStartRecording: (callback: (...args: any[]) => unknown) => (callbacks.started = callback),
        };
        (manager.setEvents as () => void)();
        callbacks.started({ id: 920 }, { id: 1924 });
        callbacks.started({ id: 920 }, { id: 1924 });

        firstTerminal.resolve();
        await firstTerminal.promise;
        await Promise.resolve();
        expect(provider.tryAcquireDeletion(1924)).toEqual({ status: 'busy' });

        callbacks.finish({ id: 920 }, { id: 1924 }, false);
        const acquired = provider.tryAcquireDeletion(1924);
        expect('token' in acquired).toBe(true);
        if ('token' in acquired) provider.releaseDeletion(acquired.token);
    });

    it('consumes an old terminal after its same-recorder successor finishes', async () => {
        const provider = new RecordingRecordedUseProvider();
        const oldTerminal = deferred<void>();
        const recorder = {
            whenNormalRecordingTerminal: vi
                .fn<() => Promise<void> | undefined>()
                .mockReturnValueOnce(oldTerminal.promise)
                .mockReturnValueOnce(undefined),
        };
        const callbacks: Record<string, (...args: any[]) => unknown> = {};
        const manager: any = Object.create(RecordingManageModel.prototype);
        manager.activeRecordedUseSessions = new Map();
        manager.candidateStartupState = 'Failed';
        manager.deleteRecording = vi.fn();
        manager.normalRecordedUseTerminals = new Map();
        manager.recordedUseProvider = provider;
        manager.recordingIndex = { 925: recorder };
        manager.unknownRecordedUseSessions = new Map();
        manager.recordingEvent = {
            setCancelPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.cancelPrep = callback),
            setFinishRecording: (callback: (...args: any[]) => unknown) => (callbacks.finish = callback),
            setPrepRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.prepFailed = callback),
            setRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.failed = callback),
            setStartPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.preparing = callback),
            setStartRecording: (callback: (...args: any[]) => unknown) => (callbacks.started = callback),
        };
        const unhandled: unknown[] = [];
        const recordUnhandled = (reason: unknown) => unhandled.push(reason);
        process.prependListener('unhandledRejection', recordUnhandled);
        try {
            (manager.setEvents as () => void)();
            callbacks.started({ id: 925 }, { id: 1929 });
            callbacks.started({ id: 925 }, { id: 1929 });
            callbacks.finish({ id: 925 }, { id: 1929 }, false);

            const finished = provider.tryAcquireDeletion(1929);
            expect('token' in finished).toBe(true);
            if ('token' in finished) provider.releaseDeletion(finished.token);

            oldTerminal.resolve();
            await oldTerminal.promise;
            await flushImmediate();
            expect(unhandled).toEqual([]);

            const lateTerminalSettled = provider.tryAcquireDeletion(1929);
            expect('token' in lateTerminalSettled).toBe(true);
            if ('token' in lateTerminalSettled) provider.releaseDeletion(lateTerminalSettled.token);
        } finally {
            process.removeListener('unhandledRejection', recordUnhandled);
        }
    });

    it('[Task 2.7 review] releases an unknown recorded use when its finish event arrives', () => {
        const provider = new RecordingRecordedUseProvider();
        const recorder = Object.freeze({});
        const callbacks: Record<string, (...args: any[]) => unknown> = {};
        const manager: any = Object.create(RecordingManageModel.prototype);
        manager.activeRecordedUseSessions = new Map();
        manager.candidateStartupState = 'Failed';
        manager.deleteRecording = vi.fn();
        manager.normalRecordedUseTerminals = new Map();
        manager.recordedUseProvider = provider;
        manager.recordingIndex = { 926: recorder };
        manager.unknownRecordedUseSessions = new Map();
        manager.recordingEvent = {
            setCancelPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.cancelPrep = callback),
            setFinishRecording: (callback: (...args: any[]) => unknown) => (callbacks.finish = callback),
            setPrepRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.prepFailed = callback),
            setRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.failed = callback),
            setStartPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.preparing = callback),
            setStartRecording: (callback: (...args: any[]) => unknown) => (callbacks.started = callback),
        };
        (manager.setEvents as () => void)();
        callbacks.started({ id: 926 }, { id: undefined });
        expect(provider.tryAcquireDeletion(1930)).toEqual({ status: 'unknown' });

        callbacks.finish({ id: 926 }, { id: undefined }, false);

        const acquired = provider.tryAcquireDeletion(1930);
        expect('token' in acquired).toBe(true);
        if ('token' in acquired) provider.releaseDeletion(acquired.token);
    });

    it('[Task 2.7 review] keeps a later unknown recorded use after an old normal terminal settles', async () => {
        const provider = new RecordingRecordedUseProvider();
        const oldTerminal = deferred<void>();
        const recorder = {
            whenNormalRecordingTerminal: vi
                .fn<() => Promise<void> | undefined>()
                .mockReturnValueOnce(oldTerminal.promise)
                .mockReturnValueOnce(undefined),
        };
        const callbacks: Record<string, (...args: any[]) => unknown> = {};
        const manager: any = Object.create(RecordingManageModel.prototype);
        manager.activeRecordedUseSessions = new Map();
        manager.candidateStartupState = 'Failed';
        manager.deleteRecording = vi.fn();
        manager.normalRecordedUseTerminals = new Map();
        manager.recordedUseProvider = provider;
        manager.recordingIndex = { 927: recorder };
        manager.unknownRecordedUseSessions = new Map();
        manager.recordingEvent = {
            setCancelPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.cancelPrep = callback),
            setFinishRecording: (callback: (...args: any[]) => unknown) => (callbacks.finish = callback),
            setPrepRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.prepFailed = callback),
            setRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.failed = callback),
            setStartPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.preparing = callback),
            setStartRecording: (callback: (...args: any[]) => unknown) => (callbacks.started = callback),
        };
        (manager.setEvents as () => void)();
        callbacks.started({ id: 927 }, { id: 1931 });
        callbacks.started({ id: 927 }, { id: 1931 });
        callbacks.finish({ id: 927 }, { id: 1931 }, false);
        manager.recordingIndex[927] = Object.freeze({});
        callbacks.started({ id: 927 }, { id: undefined });
        expect(provider.tryAcquireDeletion(1931)).toEqual({ status: 'unknown' });

        oldTerminal.resolve();
        await oldTerminal.promise;
        await Promise.resolve();

        expect(provider.tryAcquireDeletion(1931)).toEqual({ status: 'unknown' });
    });

    it('[Task 2.7 review] releases the recorder selected by its exact normal-terminal identity', async () => {
        const provider = new RecordingRecordedUseProvider();
        const firstTerminal = deferred<void>();
        const secondTerminal = deferred<void>();
        const firstRecorder = { whenNormalRecordingTerminal: vi.fn(() => firstTerminal.promise) };
        const secondRecorder = { whenNormalRecordingTerminal: vi.fn(() => secondTerminal.promise) };
        const callbacks: Record<string, (...args: any[]) => unknown> = {};
        const manager: any = Object.create(RecordingManageModel.prototype);
        manager.activeRecordedUseSessions = new Map();
        manager.candidateStartupState = 'Failed';
        manager.deleteRecording = vi.fn();
        manager.normalRecordedUseTerminals = new Map();
        manager.recordedUseProvider = provider;
        manager.recordingIndex = { 921: firstRecorder };
        manager.unknownRecordedUseSessions = new Map();
        manager.recordingEvent = {
            setCancelPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.cancelPrep = callback),
            setFinishRecording: (callback: (...args: any[]) => unknown) => (callbacks.finish = callback),
            setPrepRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.prepFailed = callback),
            setRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.failed = callback),
            setStartPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.preparing = callback),
            setStartRecording: (callback: (...args: any[]) => unknown) => (callbacks.started = callback),
        };
        (manager.setEvents as () => void)();
        callbacks.started({ id: 921 }, { id: 1925 });
        manager.recordingIndex[921] = secondRecorder;
        callbacks.started({ id: 921 }, { id: 1925 });

        secondTerminal.resolve();
        await secondTerminal.promise;
        await Promise.resolve();
        expect(provider.tryAcquireDeletion(1925)).toEqual({ status: 'busy' });

        firstTerminal.resolve();
        await firstTerminal.promise;
        await Promise.resolve();
        const acquired = provider.tryAcquireDeletion(1925);
        expect('token' in acquired).toBe(true);
        if ('token' in acquired) provider.releaseDeletion(acquired.token);
    });

    it('[Task 2.7 review] uses reservation identity when a same-ID finish event selects an active use', async () => {
        const provider = new RecordingRecordedUseProvider();
        const firstTerminal = deferred<void>();
        const firstRecorder = { whenNormalRecordingTerminal: vi.fn(() => firstTerminal.promise) };
        const secondRecorder = Object.freeze({});
        const callbacks: Record<string, (...args: any[]) => unknown> = {};
        const manager: any = Object.create(RecordingManageModel.prototype);
        manager.activeRecordedUseSessions = new Map();
        manager.candidateStartupState = 'Failed';
        manager.deleteRecording = vi.fn();
        manager.normalRecordedUseTerminals = new Map();
        manager.recordedUseProvider = provider;
        manager.recordingIndex = { 922: firstRecorder, 923: secondRecorder };
        manager.unknownRecordedUseSessions = new Map();
        manager.recordingEvent = {
            setCancelPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.cancelPrep = callback),
            setFinishRecording: (callback: (...args: any[]) => unknown) => (callbacks.finish = callback),
            setPrepRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.prepFailed = callback),
            setRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.failed = callback),
            setStartPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.preparing = callback),
            setStartRecording: (callback: (...args: any[]) => unknown) => (callbacks.started = callback),
        };
        (manager.setEvents as () => void)();
        callbacks.started({ id: 922 }, { id: 1926 });
        callbacks.started({ id: 923 }, { id: 1926 });
        callbacks.finish({ id: 923 }, { id: 1926 }, false);

        firstTerminal.resolve();
        await firstTerminal.promise;
        await Promise.resolve();
        const acquired = provider.tryAcquireDeletion(1926);
        expect('token' in acquired).toBe(true);
        if ('token' in acquired) provider.releaseDeletion(acquired.token);
    });

    it('[Task 2.7 review] uses recorded identity when a same-reservation finish event selects an active use', async () => {
        const provider = new RecordingRecordedUseProvider();
        const firstTerminal = deferred<void>();
        const firstRecorder = { whenNormalRecordingTerminal: vi.fn(() => firstTerminal.promise) };
        const secondRecorder = Object.freeze({});
        const callbacks: Record<string, (...args: any[]) => unknown> = {};
        const manager: any = Object.create(RecordingManageModel.prototype);
        manager.activeRecordedUseSessions = new Map();
        manager.candidateStartupState = 'Failed';
        manager.deleteRecording = vi.fn();
        manager.normalRecordedUseTerminals = new Map();
        manager.recordedUseProvider = provider;
        manager.recordingIndex = { 924: firstRecorder };
        manager.unknownRecordedUseSessions = new Map();
        manager.recordingEvent = {
            setCancelPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.cancelPrep = callback),
            setFinishRecording: (callback: (...args: any[]) => unknown) => (callbacks.finish = callback),
            setPrepRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.prepFailed = callback),
            setRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.failed = callback),
            setStartPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.preparing = callback),
            setStartRecording: (callback: (...args: any[]) => unknown) => (callbacks.started = callback),
        };
        (manager.setEvents as () => void)();
        callbacks.started({ id: 924 }, { id: 1927 });
        manager.recordingIndex[924] = secondRecorder;
        callbacks.started({ id: 924 }, { id: 1928 });
        callbacks.finish({ id: 924 }, { id: 1928 }, false);

        firstTerminal.resolve();
        await firstTerminal.promise;
        await Promise.resolve();
        const acquired = provider.tryAcquireDeletion(1928);
        expect('token' in acquired).toBe(true);
        if ('token' in acquired) provider.releaseDeletion(acquired.token);
    });

    it('[Task 2.7 review] keeps the newer same-recorder terminal after an older terminal settles', async () => {
        const provider = new RecordingRecordedUseProvider();
        const firstTerminal = deferred<void>();
        const secondTerminal = deferred<void>();
        const recorder = {
            whenNormalRecordingTerminal: vi
                .fn<() => Promise<void>>()
                .mockReturnValueOnce(firstTerminal.promise)
                .mockReturnValueOnce(secondTerminal.promise),
        };
        const callbacks: Record<string, (...args: any[]) => unknown> = {};
        const manager: any = Object.create(RecordingManageModel.prototype);
        manager.activeRecordedUseSessions = new Map();
        manager.candidateStartupState = 'Failed';
        manager.deleteRecording = vi.fn();
        manager.normalRecordedUseTerminals = new Map();
        manager.recordedUseProvider = provider;
        manager.recordingIndex = { 920: recorder };
        manager.unknownRecordedUseSessions = new Map();
        manager.recordingEvent = {
            setCancelPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.cancelPrep = callback),
            setFinishRecording: (callback: (...args: any[]) => unknown) => (callbacks.finish = callback),
            setPrepRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.prepFailed = callback),
            setRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.failed = callback),
            setStartPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.preparing = callback),
            setStartRecording: (callback: (...args: any[]) => unknown) => (callbacks.started = callback),
        };
        (manager.setEvents as () => void)();
        callbacks.started({ id: 920 }, { id: 1923 });
        callbacks.started({ id: 920 }, { id: 1924 });

        firstTerminal.resolve();
        await firstTerminal.promise;
        await Promise.resolve();
        expect(provider.tryAcquireDeletion(1924)).toEqual({ status: 'busy' });

        callbacks.finish({ id: 920 }, { id: 1924 }, false);
        expect(provider.tryAcquireDeletion(1924)).toEqual({ status: 'busy' });

        secondTerminal.resolve();
        await secondTerminal.promise;
        await Promise.resolve();
        const acquired = provider.tryAcquireDeletion(1924);
        expect('token' in acquired).toBe(true);
        if ('token' in acquired) provider.releaseDeletion(acquired.token);
    });

    it('[Task 2.7 gap] tracks an unknown recorded-use identity by reservation when no recorder is indexed', () => {
        const provider = new RecordingRecordedUseProvider();
        const registerSpy = vi.spyOn(provider, 'tryRegisterSessionUse');
        const manager: any = Object.create(RecordingManageModel.prototype);
        manager.recordingIndex = {};
        manager.recordedUseProvider = provider;
        manager.unknownRecordedUseSessions = new Map();

        (manager.observeActiveRecordedUse as (reservationId: number, recordedId: unknown) => void)(950, undefined);

        expect(registerSpy).toHaveBeenCalledTimes(1);
        const [identity, use] = registerSpy.mock.calls[0]!;
        expect(use).toEqual({ status: 'unknown' });
        expect(Object.keys(identity as object)).toEqual([]);
        expect(manager.unknownRecordedUseSessions.get(950)).toBe(identity);

        (manager.observeActiveRecordedUse as (reservationId: number, recordedId: unknown) => void)(950, undefined);
        expect(registerSpy).toHaveBeenCalledTimes(2);
        expect(registerSpy.mock.calls[1]![0]).toBe(identity);
        expect(manager.unknownRecordedUseSessions.get(950)).toBe(identity);
    });

    it('[Task 2.7 gap] keeps an activation from publishing when its recorded ID is already deletion-gated', () => {
        const provider = new RecordingRecordedUseProvider();
        const recorder = Object.freeze({});
        const manager: any = Object.create(RecordingManageModel.prototype);
        manager.activeRecordedUseSessions = new Map();
        manager.recordedUseProvider = provider;
        manager.recordingIndex = { 951: recorder };
        manager.unknownRecordedUseSessions = new Map();

        const acquired = provider.tryAcquireDeletion(1951);
        expect('token' in acquired).toBe(true);
        if (!('token' in acquired)) throw new Error('Expected a deletion token');

        (manager.observeActiveRecordedUse as (reservationId: number, recordedId: unknown) => void)(951, 1951);

        expect(manager.activeRecordedUseSessions.has(recorder)).toBe(false);

        provider.releaseDeletion(acquired.token);
    });

    it('[Task 2.7 gap] logs and swallows a rejected normal recording terminal without leaving an unhandled rejection', async () => {
        const provider = new RecordingRecordedUseProvider();
        const failure = new Error('synthetic normal terminal rejection');
        const recorder = { whenNormalRecordingTerminal: vi.fn(() => Promise.reject(failure)) };
        const callbacks: Record<string, (...args: any[]) => unknown> = {};
        const manager: any = Object.create(RecordingManageModel.prototype);
        manager.activeRecordedUseSessions = new Map();
        manager.candidateStartupState = 'Failed';
        manager.deleteRecording = vi.fn();
        manager.log = { system: { error: vi.fn(), info: vi.fn() } };
        manager.normalRecordedUseTerminals = new Map();
        manager.recordedUseProvider = provider;
        manager.recordingIndex = { 952: recorder };
        manager.unknownRecordedUseSessions = new Map();
        manager.recordingEvent = {
            setCancelPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.cancelPrep = callback),
            setFinishRecording: (callback: (...args: any[]) => unknown) => (callbacks.finish = callback),
            setPrepRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.prepFailed = callback),
            setRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.failed = callback),
            setStartPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.preparing = callback),
            setStartRecording: (callback: (...args: any[]) => unknown) => (callbacks.started = callback),
        };
        const unhandled: unknown[] = [];
        const recordUnhandled = (reason: unknown) => unhandled.push(reason);
        process.prependListener('unhandledRejection', recordUnhandled);
        try {
            (manager.setEvents as () => void)();
            callbacks.started({ id: 952 }, { id: 1952 });
            await flushImmediate();
            await Promise.resolve();

            expect(manager.log.system.error).toHaveBeenCalledWith('normal recording terminal error: 952');
            expect(manager.log.system.error).toHaveBeenCalledWith(failure);
            expect(unhandled).toEqual([]);
        } finally {
            process.removeListener('unhandledRejection', recordUnhandled);
        }
    });

    it('[Task 2.7 gap] clears a still-pending normal terminal expectation when a planned deletion releases first', async () => {
        const provider = new RecordingRecordedUseProvider();
        const normalTerminal = deferred<void>();
        const deletionTerminal = deferred<void>();
        const recorder = {
            cancel: vi.fn(async () => undefined),
            whenDeletionTerminal: vi.fn(() => deletionTerminal.promise),
            whenNormalRecordingTerminal: vi.fn(() => normalTerminal.promise),
        };
        const callbacks: Record<string, (...args: any[]) => unknown> = {};
        const manager: any = Object.create(RecordingManageModel.prototype);
        manager.activeRecordedUseSessions = new Map();
        manager.candidateStartupState = 'Failed';
        manager.deleteRecording = vi.fn();
        manager.deletionStops = new Map();
        manager.log = { system: { error: vi.fn(), info: vi.fn() } };
        manager.normalRecordedUseTerminals = new Map();
        manager.recordedUseProvider = provider;
        manager.recordingIndex = { 953: recorder };
        manager.unknownRecordedUseSessions = new Map();
        manager.recordingEvent = {
            setCancelPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.cancelPrep = callback),
            setFinishRecording: (callback: (...args: any[]) => unknown) => (callbacks.finish = callback),
            setPrepRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.prepFailed = callback),
            setRecordingFailed: (callback: (...args: any[]) => unknown) => (callbacks.failed = callback),
            setStartPrepRecording: (callback: (...args: any[]) => unknown) => (callbacks.preparing = callback),
            setStartRecording: (callback: (...args: any[]) => unknown) => (callbacks.started = callback),
        };
        (manager.setEvents as () => void)();
        callbacks.started({ id: 953 }, { id: 1953 });
        expect(manager.normalRecordedUseTerminals.get(recorder)).toBeDefined();

        await manager.cancel(953, true);
        expect(manager.activeRecordedUseSessions.has(recorder)).toBe(true);
        expect(manager.normalRecordedUseTerminals.has(recorder)).toBe(true);

        deletionTerminal.resolve();
        await deletionTerminal.promise;
        await Promise.resolve();
        await Promise.resolve();

        expect(manager.activeRecordedUseSessions.has(recorder)).toBe(false);
        expect(manager.normalRecordedUseTerminals.has(recorder)).toBe(false);
        expect(manager.deleteRecording).toHaveBeenCalledWith(953);

        normalTerminal.resolve();
        await normalTerminal.promise;
        await Promise.resolve();
        expect(manager.log.system.error).not.toHaveBeenCalled();
    });

    it('[Task 2.5 gap] ignores a stale deletion terminal after its reserveId is reassigned to a new recorder', async () => {
        const provider = new RecordingRecordedUseProvider();
        const firstTerminal = deferred<void>();
        const secondTerminal = deferred<void>();
        const first = {
            cancel: vi.fn(async () => undefined),
            whenDeletionTerminal: vi.fn(() => firstTerminal.promise),
        };
        const second = {
            cancel: vi.fn(async () => undefined),
            whenDeletionTerminal: vi.fn(() => secondTerminal.promise),
        };
        const manager: any = Object.create(RecordingManageModel.prototype);
        manager.activeRecordedUseSessions = new Map();
        manager.deleteRecording = vi.fn();
        manager.deletionStops = new Map();
        manager.log = { system: { error: vi.fn(), info: vi.fn() } };
        manager.normalRecordedUseTerminals = new Map();
        manager.recordedUseProvider = provider;
        manager.recordingIndex = { 954: first };
        manager.unknownRecordedUseSessions = new Map();

        const firstCancel = manager.cancel(954, true);
        manager.recordingIndex[954] = second;
        const secondCancel = manager.cancel(954, true);
        expect(manager.deletionStops.size).toBe(1);

        firstTerminal.resolve();
        await firstTerminal.promise;
        await flushImmediate();

        expect(manager.deleteRecording).not.toHaveBeenCalled();
        expect(manager.deletionStops.size).toBe(1);

        secondTerminal.resolve();
        await Promise.all([firstCancel, secondCancel, secondTerminal.promise]);
        await flushImmediate();

        expect(manager.deleteRecording).toHaveBeenCalledWith(954);
    });
});
