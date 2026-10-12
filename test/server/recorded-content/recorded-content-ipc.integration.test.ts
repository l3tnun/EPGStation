import 'reflect-metadata';

import { fork, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushNextTick, makeClient } from '../process-messaging/_harness';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const load = <T>(path: string): T => (require(join(snapshot, path)) as { default: T }).default;
const IPCServer = load<new (...args: any[]) => any>('model/ipc/IPCServer.js');
const RecordedManageModel = load<{ prototype: Record<string, unknown> }>(
    'model/operator/recorded/RecordedManageModel.js',
);
const RecordedUploadAdoptionModel = load<
    new (uploadRoot: string) => {
        adopt(filePath: string): Promise<string>;
        initialize(): Promise<void>;
    }
>('model/operator/recorded/RecordedUploadAdoptionModel.js');

interface Deferred {
    readonly promise: Promise<void>;
    readonly reject: (reason?: unknown) => void;
    readonly resolve: () => void;
}

const deferred = (): Deferred => {
    let reject!: Deferred['reject'];
    let resolve!: Deferred['resolve'];
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
        reject = rejectPromise;
        resolve = resolvePromise;
    });
    return { promise, reject, resolve };
};

const flushMicrotasks = async (): Promise<void> => {
    for (let count = 0; count < 4; count += 1) {
        await Promise.resolve();
    }
};

const uploadAckChildFixture = join(process.cwd(), 'test/server/recorded-content/fixtures/upload-ack-child.cjs');
const uploadAckChildReadinessTimeoutMilliseconds = 1_000;
const testUploadAckChildReadinessTimeoutMilliseconds = 250;

type UploadAckChildObservation =
    | { id: number; kind: 'adoption-ack-discarded'; type: 'uploadedVideoAdopted' }
    | { kind: 'dispatched' }
    | { kind: 'disconnected'; replyCount: number }
    | { kind: 'ready' }
    | { kind: 'reply'; replyCount: number }
    | { kind: 'report'; replyCount: number }
    | { kind: 'startup-rejected' };

interface UploadAckChildCleanupEvidence {
    readonly childDisconnected: boolean;
    readonly childExited: boolean;
    readonly remainingChildProcesses: number;
    readonly remainingOwnedListeners: number;
    readonly streamsDestroyed: boolean;
}

interface UploadAckChildStartupOptions {
    readonly afterStartupCleanup?: (evidence: UploadAckChildCleanupEvidence) => void;
    readonly readinessTimeoutMilliseconds?: number;
    readonly silentStartup?: boolean;
    readonly startupError?: Error;
}

interface UploadAckChildStartupError extends Error {
    uploadAckChildCleanup?: UploadAckChildCleanupEvidence;
    uploadAckChildCleanupError?: unknown;
}

interface UploadAckChild {
    readonly child: ChildProcess;
    readonly observations: UploadAckChildObservation[];
    dispose(): Promise<UploadAckChildCleanupEvidence>;
    send(message: unknown): Promise<void>;
}

const childListenerSnapshot = (child: ChildProcess): Record<string, number> =>
    Object.fromEntries(
        ['close', 'disconnect', 'error', 'exit', 'message'].map(event => [event, child.listenerCount(event)]),
    );

const cleanupUploadAckChild = async (
    child: ChildProcess,
    onError: (error: Error) => void,
    onExit: () => void,
    onOutput: (chunk: string) => void,
    afterCleanup?: (evidence: UploadAckChildCleanupEvidence) => void,
): Promise<UploadAckChildCleanupEvidence> => {
    child.off('error', onError);
    child.off('exit', onExit);
    child.stdout?.off('data', onOutput);
    try {
        if (child.connected) child.disconnect();
        if (child.exitCode === null && child.signalCode === null && !child.killed) child.kill('SIGTERM');
        await vi.waitFor(() => expect(child.exitCode !== null || child.signalCode !== null).toBe(true));
    } finally {
        child.stdout?.destroy();
        child.stderr?.destroy();
    }
    const evidence = {
        childDisconnected: child.connected === false,
        childExited: child.exitCode !== null || child.signalCode !== null,
        remainingChildProcesses: child.exitCode === null && child.signalCode === null ? 1 : 0,
        remainingOwnedListeners:
            Number(child.listeners('error').includes(onError)) +
            Number(child.listeners('exit').includes(onExit)) +
            Number(child.stdout?.listeners('data').includes(onOutput)),
        streamsDestroyed: child.stdout?.destroyed === true && child.stderr?.destroyed === true,
    };
    afterCleanup?.(evidence);
    return evidence;
};

const recordStartupCleanup = (
    primaryError: unknown,
    cleanupEvidence: UploadAckChildCleanupEvidence | undefined,
    cleanupError: unknown,
): void => {
    if (!(primaryError instanceof Error)) return;
    const startupError = primaryError as UploadAckChildStartupError;
    if (cleanupEvidence !== undefined) startupError.uploadAckChildCleanup = cleanupEvidence;
    if (cleanupError !== undefined) startupError.uploadAckChildCleanupError = cleanupError;
};

const startUploadAckChild = async (options: UploadAckChildStartupOptions = {}): Promise<UploadAckChild> => {
    const startupMode = options.silentStartup ? 'silent' : options.startupError === undefined ? undefined : 'reject';
    const child = fork(uploadAckChildFixture, [], {
        env: {
            ...process.env,
            EPGSTATION_SERVER_COMPILED_SNAPSHOT: process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT,
            EPGSTATION_UPLOAD_ACK_CHILD_STARTUP_MODE: startupMode,
            PATH: process.env.PATH,
        },
        silent: true,
    });
    const observations: UploadAckChildObservation[] = [];
    let startupFailure: Error | undefined;
    let output = '';
    const onError = (error: Error) => {
        startupFailure = error;
    };
    const onExit = () => {
        startupFailure = new Error('upload ACK child exited before readiness');
    };
    const onOutput = (chunk: string) => {
        output += chunk;
        const lines = output.split('\n');
        output = lines.pop() ?? '';
        for (const line of lines) {
            const observation = JSON.parse(line) as UploadAckChildObservation;
            observations.push(observation);
            if (observation.kind === 'startup-rejected') {
                startupFailure = options.startupError ?? new Error('upload ACK child rejected startup');
            }
        }
    };
    child.on('error', onError);
    child.once('exit', onExit);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', onOutput);
    try {
        await vi.waitFor(
            () => {
                if (startupFailure !== undefined) throw startupFailure;
                expect(observations).toContainEqual({ kind: 'ready' });
            },
            { timeout: options.readinessTimeoutMilliseconds ?? uploadAckChildReadinessTimeoutMilliseconds },
        );
    } catch (error) {
        let cleanupEvidence: UploadAckChildCleanupEvidence | undefined;
        let cleanupError: unknown;
        try {
            cleanupEvidence = await cleanupUploadAckChild(
                child,
                onError,
                onExit,
                onOutput,
                options.afterStartupCleanup,
            );
        } catch (caughtCleanupError) {
            cleanupError = caughtCleanupError;
        }
        recordStartupCleanup(error, cleanupEvidence, cleanupError);
        throw error;
    }
    child.off('error', onError);
    child.off('exit', onExit);

    return {
        child,
        observations,
        dispose: () => cleanupUploadAckChild(child, onError, onExit, onOutput),
        send(message) {
            return new Promise((resolve, reject) => {
                child.send(message as any, error => (error === null ? resolve() : reject(error)));
            });
        },
    };
};

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('recorded content IPC integration', () => {
    it('[Task 3.1/RC-4.12] preserves a rejected child startup error while reaping its owned resources', async () => {
        const primaryError = new Error('synthetic upload ACK child startup rejection');
        const cleanupError = new Error('synthetic upload ACK child cleanup rejection');
        let observedCleanup: UploadAckChildCleanupEvidence | undefined;
        let startedChild: UploadAckChild | undefined;
        try {
            startedChild = await startUploadAckChild({
                afterStartupCleanup: cleanupEvidence => {
                    observedCleanup = cleanupEvidence;
                    throw cleanupError;
                },
                readinessTimeoutMilliseconds: testUploadAckChildReadinessTimeoutMilliseconds,
                startupError: primaryError,
            });
            throw new Error('synthetic upload ACK child unexpectedly became ready');
        } catch (error) {
            expect(error).toBe(primaryError);
            expect((primaryError as UploadAckChildStartupError).uploadAckChildCleanupError).toBe(cleanupError);
            expect(observedCleanup).toEqual({
                childDisconnected: true,
                childExited: true,
                remainingChildProcesses: 0,
                remainingOwnedListeners: 0,
                streamsDestroyed: true,
            });
        } finally {
            await startedChild?.dispose();
        }
    });

    it('[Task 3.1/RC-4.12] reaps a bounded silent child startup without leaving IPC resources', async () => {
        let startedChild: UploadAckChild | undefined;
        try {
            startedChild = await startUploadAckChild({
                readinessTimeoutMilliseconds: testUploadAckChildReadinessTimeoutMilliseconds,
                silentStartup: true,
            });
            throw new Error('synthetic upload ACK child unexpectedly became ready');
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as UploadAckChildStartupError).uploadAckChildCleanup).toEqual({
                childDisconnected: true,
                childExited: true,
                remainingChildProcesses: 0,
                remainingOwnedListeners: 0,
                streamsDestroyed: true,
            });
        } finally {
            await startedChild?.dispose();
        }
    });

    it('[Task 3.1/RC-4.12] cleans stale adopted staging once without taking a later active adoption', async () => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-recorded-ipc-upload-'));
        const incomingPayload = join(uploadRoot, 'incoming', 'child-owned', 'payload');
        const stalePayload = join(uploadRoot, 'adopted', 'stale', 'payload');
        const activePayload = join(uploadRoot, 'adopted', 'active', 'payload');
        try {
            await mkdir(join(uploadRoot, 'incoming', 'child-owned'), { recursive: true });
            await mkdir(join(uploadRoot, 'adopted', 'stale'), { recursive: true });
            await writeFile(incomingPayload, 'incoming-bytes');
            await writeFile(stalePayload, 'stale-bytes');
            const adoption = new RecordedUploadAdoptionModel(uploadRoot);
            const unused = {};
            const ipc = new IPCServer(unused, unused, unused, unused, unused, unused, undefined, adoption);

            await ipc.initialize();
            await mkdir(join(uploadRoot, 'adopted', 'active'), { recursive: true });
            await writeFile(activePayload, 'active-bytes');
            await ipc.initialize();

            await expect(readFile(stalePayload)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(readFile(incomingPayload, 'utf8')).resolves.toBe('incoming-bytes');
            await expect(readFile(activePayload, 'utf8')).resolves.toBe('active-bytes');
        } finally {
            await rm(uploadRoot, { force: true, recursive: true });
        }
    });

    it('[Task 3.1/RC-4.4] adopts the absolute incoming payload, then sends its internal acknowledgement separately from one unchanged-shape domain reply', async () => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-recorded-ipc-upload-'));
        const incomingPayload = join(uploadRoot, 'incoming', 'token-a', 'payload');
        const adoptedPayload = join(uploadRoot, 'adopted', 'token-a', 'payload');
        const request = {
            args: {
                option: {
                    fileName: 'synthetic.ts',
                    filePath: '<synthetic-file-path>',
                    fileType: 'ts',
                    parentDirectoryName: 'synthetic-storage',
                    recordedId: 7_101,
                    viewName: 'Synthetic upload',
                },
            },
            func: 'addUploadedVideoFile',
            id: 7_102,
            model: 'recorded',
        };
        try {
            await mkdir(join(uploadRoot, 'incoming', 'token-a'), { recursive: true });
            await writeFile(incomingPayload, 'incoming-bytes');
            const adoption = new RecordedUploadAdoptionModel(uploadRoot);
            await adoption.initialize();
            const recorded = { addUploadedVideoFile: vi.fn(async () => undefined) };
            const unused = {};
            const ipc = new IPCServer(unused, recorded, unused, unused, unused, unused, undefined, adoption);
            const child = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> };
            child.send = vi.fn();
            ipc.register(child as any);
            request.args.option.filePath = incomingPayload;

            child.emit('message', request);

            await vi.waitFor(() => expect(child.send).toHaveBeenCalledTimes(2));
            expect(child.send.mock.calls.map(([message]) => message)).toEqual([
                { id: request.id, type: 'uploadedVideoAdopted' },
                { id: request.id, result: undefined },
            ]);
            expect(recorded.addUploadedVideoFile).toHaveBeenCalledOnce();
            expect(recorded.addUploadedVideoFile).toHaveBeenCalledWith({
                ...request.args.option,
                filePath: adoptedPayload,
            });
            expect(request.args.option.filePath).toBe(incomingPayload);
            await expect(readFile(adoptedPayload, 'utf8')).resolves.toBe('incoming-bytes');
            await expect(readFile(incomingPayload, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await rm(uploadRoot, { force: true, recursive: true });
        }
    });

    it('[Task 3.1/RC-4.4] rejects an uncomposed handler before a raw upload path reaches the domain', async () => {
        const rawPath = '<synthetic-file-path>';
        const recorded = { addUploadedVideoFile: vi.fn(async () => undefined) };
        const unused = {};
        const ipc = new IPCServer(unused, recorded, unused, unused, unused, unused, undefined, undefined);
        const child = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> };
        child.send = vi.fn();
        ipc.register(child as any);

        child.emit('message', {
            args: {
                option: {
                    fileName: 'synthetic.ts',
                    filePath: rawPath,
                    fileType: 'ts',
                    parentDirectoryName: 'synthetic-storage',
                    recordedId: 7_103,
                    viewName: 'Synthetic upload',
                },
            },
            func: 'addUploadedVideoFile',
            id: 7_104,
            model: 'recorded',
        });

        await vi.waitFor(() => expect(child.send).toHaveBeenCalledOnce());
        expect(recorded.addUploadedVideoFile).not.toHaveBeenCalled();
    });

    it('[Task 3.1/RC-4.12] parent continues adopted upload after ACK loss and child restart', async () => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-recorded-ipc-upload-'));
        const incomingPayload = join(uploadRoot, 'incoming', 'lost-ack-token', 'payload');
        const adoptedPayload = join(uploadRoot, 'adopted', 'lost-ack-token', 'payload');
        const pendingDomain = deferred();
        let oldChild: UploadAckChild | undefined;
        let replacementChild: UploadAckChild | undefined;
        const request = {
            args: {
                option: {
                    fileName: 'synthetic.ts',
                    filePath: '<synthetic-file-path>',
                    fileType: 'ts',
                    parentDirectoryName: 'synthetic-storage',
                    recordedId: 7_105,
                    viewName: 'Synthetic upload',
                },
            },
            func: 'addUploadedVideoFile',
            id: 7_106,
            model: 'recorded',
        };
        try {
            await mkdir(join(uploadRoot, 'incoming', 'lost-ack-token'), { recursive: true });
            await writeFile(incomingPayload, 'parent-owned-bytes');
            const adoption = new RecordedUploadAdoptionModel(uploadRoot);
            await adoption.initialize();
            const recorded = { addUploadedVideoFile: vi.fn(() => pendingDomain.promise) };
            const unused = {};
            const ipc = new IPCServer(unused, recorded, unused, unused, unused, unused, undefined, adoption);
            oldChild = await startUploadAckChild();
            const oldListenerBaseline = childListenerSnapshot(oldChild.child);
            ipc.register(oldChild.child);
            request.args.option.filePath = incomingPayload;

            await oldChild.send({ kind: 'dispatch', request });

            await vi.waitFor(() => expect(recorded.addUploadedVideoFile).toHaveBeenCalledOnce());
            expect(recorded.addUploadedVideoFile).toHaveBeenCalledWith({
                ...request.args.option,
                filePath: adoptedPayload,
            });
            await expect(readFile(adoptedPayload, 'utf8')).resolves.toBe('parent-owned-bytes');
            await expect(readFile(incomingPayload, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
            await vi.waitFor(() =>
                expect(oldChild?.observations).toContainEqual({
                    id: request.id,
                    kind: 'adoption-ack-discarded',
                    type: 'uploadedVideoAdopted',
                }),
            );

            oldChild.child.disconnect();
            await vi.waitFor(() => expect(oldChild?.child.connected).toBe(false));
            await vi.waitFor(() =>
                expect(oldChild?.observations).toContainEqual({ kind: 'disconnected', replyCount: 0 }),
            );
            expect(childListenerSnapshot(oldChild.child)).toEqual(oldListenerBaseline);

            replacementChild = await startUploadAckChild();
            const replacementListenerBaseline = childListenerSnapshot(replacementChild.child);
            ipc.register(replacementChild.child);
            pendingDomain.resolve();
            await flushMicrotasks();
            await replacementChild.send({ kind: 'report' });
            await vi.waitFor(() =>
                expect(replacementChild?.observations).toContainEqual({ kind: 'report', replyCount: 0 }),
            );

            expect(recorded.addUploadedVideoFile).toHaveBeenCalledOnce();
            expect(oldChild.observations).not.toContainEqual({ kind: 'reply', replyCount: 1 });
            expect(replacementChild.observations).not.toContainEqual({ kind: 'reply', replyCount: 1 });
            await expect(readFile(adoptedPayload, 'utf8')).resolves.toBe('parent-owned-bytes');
            await expect(readFile(incomingPayload, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

            replacementChild.child.disconnect();
            await vi.waitFor(() => expect(replacementChild?.child.connected).toBe(false));
            await vi.waitFor(() =>
                expect(replacementChild?.observations).toContainEqual({ kind: 'disconnected', replyCount: 0 }),
            );
            await vi.waitFor(() =>
                expect(childListenerSnapshot(replacementChild!.child)).toEqual(replacementListenerBaseline),
            );

            const [oldCleanup, replacementCleanup] = await Promise.all([
                oldChild.dispose(),
                replacementChild.dispose(),
            ]);
            oldChild = undefined;
            replacementChild = undefined;
            expect(oldCleanup).toEqual({
                childDisconnected: true,
                childExited: true,
                remainingChildProcesses: 0,
                remainingOwnedListeners: 0,
                streamsDestroyed: true,
            });
            expect(replacementCleanup).toEqual({
                childDisconnected: true,
                childExited: true,
                remainingChildProcesses: 0,
                remainingOwnedListeners: 0,
                streamsDestroyed: true,
            });
        } finally {
            await oldChild?.dispose();
            await replacementChild?.dispose();
            await rm(uploadRoot, { force: true, recursive: true });
        }
    });

    it('[Task 3.1/RC-4.9] does not invoke the domain or change either payload when the adopted token already exists', async () => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-recorded-ipc-upload-'));
        const incomingPayload = join(uploadRoot, 'incoming', 'token-a', 'payload');
        const adoptedPayload = join(uploadRoot, 'adopted', 'token-a', 'payload');
        try {
            const adoption = new RecordedUploadAdoptionModel(uploadRoot);
            await adoption.initialize();
            await mkdir(join(uploadRoot, 'incoming', 'token-a'), { recursive: true });
            await mkdir(join(uploadRoot, 'adopted', 'token-a'), { recursive: true });
            await writeFile(incomingPayload, 'incoming-bytes');
            await writeFile(adoptedPayload, 'existing-adopted-bytes');
            const recorded = { addUploadedVideoFile: vi.fn(async () => undefined) };
            const unused = {};
            const ipc = new IPCServer(unused, recorded, unused, unused, unused, unused, undefined, adoption);
            const child = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> };
            child.send = vi.fn();
            ipc.register(child as any);

            child.emit('message', {
                args: {
                    option: {
                        fileName: 'synthetic.ts',
                        filePath: incomingPayload,
                        fileType: 'ts',
                        parentDirectoryName: 'synthetic-storage',
                        recordedId: 7_201,
                        viewName: 'Synthetic upload',
                    },
                },
                func: 'addUploadedVideoFile',
                id: 7_202,
                model: 'recorded',
            });

            await vi.waitFor(() => expect(child.send).toHaveBeenCalledOnce());
            expect(recorded.addUploadedVideoFile).not.toHaveBeenCalled();
            await expect(readFile(incomingPayload, 'utf8')).resolves.toBe('incoming-bytes');
            await expect(readFile(adoptedPayload, 'utf8')).resolves.toBe('existing-adopted-bytes');
        } finally {
            await rm(uploadRoot, { force: true, recursive: true });
        }
    });

    it.each([
        {
            cleanupMethod: 'videoFileCleanup',
            executeMethod: 'executeVideoFileCleanup',
            otherCleanupMethod: 'dropLogFileCleanup',
            runningError: 'VideoFileCleanupIsRunning',
            stateProperty: 'videoFileCleanupState',
        },
        {
            cleanupMethod: 'dropLogFileCleanup',
            executeMethod: 'executeDropLogFileCleanup',
            otherCleanupMethod: 'videoFileCleanup',
            runningError: 'DropLogFileCleanupIsRunning',
            stateProperty: 'dropLogFileCleanupState',
        },
    ] as const)(
        '[Task 6.4/RC-9.11] keeps $cleanupMethod running across caller timeout until both late settlements',
        async cleanupCase => {
            for (const lateOutcome of ['success', 'failure'] as const) {
                vi.useFakeTimers();
                const listenerBaseline = process.listenerCount('message');
                const firstBody = deferred();
                const lateFailure = new Error(`synthetic late ${cleanupCase.cleanupMethod} failure`);
                const provider: any = Object.create(RecordedManageModel.prototype);
                provider.log = { system: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
                provider.recordedDB = { changeProtect: vi.fn(async () => undefined) };
                provider.recordedEvent = { emitChangeProtect: vi.fn() };
                provider.executeVideoFileCleanup = vi.fn(async () => undefined);
                provider.executeDropLogFileCleanup = vi.fn(async () => undefined);
                provider[cleanupCase.executeMethod]
                    .mockImplementationOnce(() => firstBody.promise)
                    .mockResolvedValue(undefined);

                const harness = makeClient();
                const unused = {};
                const ipc = new IPCServer(unused, provider, unused, unused, unused, unused, unused);
                const child = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> };
                child.send = vi.fn(message => {
                    void harness.receive(message);
                    return true;
                });
                ipc.register(child as any);
                harness.send.mockImplementation((message, callback) => {
                    child.emit('message', message);
                    callback?.(null);
                    return true;
                });

                try {
                    let callerSettlements = 0;
                    const firstRequest = harness.client.recorded[cleanupCase.cleanupMethod]();
                    const firstOutcome = firstRequest.then(
                        (value: unknown) => {
                            callerSettlements += 1;
                            return { value };
                        },
                        (error: Error) => {
                            callerSettlements += 1;
                            return { error };
                        },
                    );
                    await flushNextTick();
                    expect(provider[cleanupCase.stateProperty]).toBe('running');

                    await vi.advanceTimersByTimeAsync(599_999);
                    expect(callerSettlements).toBe(0);
                    expect(provider[cleanupCase.stateProperty]).toBe('running');

                    await vi.advanceTimersByTimeAsync(1);
                    await expect(firstOutcome).resolves.toMatchObject({ error: { message: 'IPCTimeout' } });
                    expect(provider[cleanupCase.stateProperty]).toBe('running');

                    const duplicate = harness.client.recorded[cleanupCase.cleanupMethod]();
                    await flushNextTick();
                    await expect(duplicate).rejects.toThrow(cleanupCase.runningError);
                    expect(provider[cleanupCase.executeMethod]).toHaveBeenCalledOnce();

                    const otherCleanup = harness.client.recorded[cleanupCase.otherCleanupMethod]();
                    await flushNextTick();
                    await expect(otherCleanup).resolves.toBeUndefined();
                    const ordinaryOperation = harness.client.recorded.changeProtect(7_101, true);
                    await flushNextTick();
                    await expect(ordinaryOperation).resolves.toBeUndefined();

                    if (lateOutcome === 'success') {
                        firstBody.resolve();
                    } else {
                        firstBody.reject(lateFailure);
                    }
                    await flushMicrotasks();
                    expect(provider[cleanupCase.stateProperty]).toBe('idle');
                    expect(callerSettlements).toBe(1);

                    const replacement = harness.client.recorded[cleanupCase.cleanupMethod]();
                    await flushNextTick();
                    await expect(replacement).resolves.toBeUndefined();
                    expect(provider[cleanupCase.executeMethod]).toHaveBeenCalledTimes(2);
                    expect(provider[cleanupCase.stateProperty]).toBe('idle');
                    expect(harness.client.pending.size).toBe(0);
                    expect(harness.client.retired.size).toBe(0);
                    expect(vi.getTimerCount()).toBe(0);
                } finally {
                    firstBody.resolve();
                    await flushMicrotasks();
                    child.removeAllListeners();
                    harness.cleanup();
                    vi.clearAllTimers();
                    vi.useRealTimers();
                }

                expect(child.listenerCount('message')).toBe(0);
                expect(process.listenerCount('message')).toBe(listenerBaseline);
            }
        },
    );

    it('commands-and-cleanup-timeout', async () => {
        vi.useFakeTimers();
        const listenerBaseline = process.listenerCount('message');
        const body = deferred();
        const provider: any = Object.create(RecordedManageModel.prototype);
        provider.log = { system: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
        provider.recordedDB = { changeProtect: vi.fn(async () => undefined) };
        provider.recordedEvent = { emitChangeProtect: vi.fn() };
        provider.executeVideoFileCleanup = vi.fn(() => body.promise);
        provider.executeDropLogFileCleanup = vi.fn(async () => undefined);
        const harness = makeClient();
        const unused = {};
        const ipc = new IPCServer(unused, provider, unused, unused, unused, unused, unused);
        const child = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> };
        child.send = vi.fn(message => {
            void harness.receive(message);
            return true;
        });
        ipc.register(child as any);
        harness.send.mockImplementation((message, callback) => {
            child.emit('message', message);
            callback?.(null);
            return true;
        });

        try {
            const cleanup = harness.client.recorded.videoFileCleanup();
            const cleanupOutcome = cleanup.then(
                () => ({ success: true }),
                (error: Error) => ({ error }),
            );
            await flushNextTick();
            expect(provider.videoFileCleanupState).toBe('running');
            await expect(harness.client.recorded.changeProtect(7_401, true)).resolves.toBeUndefined();
            expect(provider.recordedDB.changeProtect).toHaveBeenCalledWith(7_401, true);

            await vi.advanceTimersByTimeAsync(600_000);
            await expect(cleanupOutcome).resolves.toMatchObject({ error: { message: 'IPCTimeout' } });
            expect(provider.videoFileCleanupState).toBe('running');
            expect(provider.executeVideoFileCleanup).toHaveBeenCalledOnce();

            body.resolve();
            await flushMicrotasks();
            expect(provider.videoFileCleanupState).toBe('idle');
            expect(harness.client.pending.size).toBe(0);
            expect(harness.client.retired.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            body.resolve();
            await flushMicrotasks();
            child.removeAllListeners();
            harness.cleanup();
            vi.clearAllTimers();
            vi.useRealTimers();
        }

        expect(child.listenerCount('message')).toBe(0);
        expect(process.listenerCount('message')).toBe(listenerBaseline);
    });

    it('serializes recording video-file commands, replies, and releases failed requests', async () => {
        vi.useFakeTimers();
        const listenerBaseline = process.listenerCount('message');
        const addFailure = new Error('synthetic add video file failure');
        const sizeFailure = new Error('synthetic update video file size failure');
        const provider: any = Object.create(RecordedManageModel.prototype);
        provider.addVideoFile = vi.fn().mockResolvedValueOnce(7_411).mockRejectedValueOnce(addFailure);
        provider.updateVideoFileSize = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(sizeFailure);
        const harness = makeClient();
        const unused = {};
        const ipc = new IPCServer(unused, provider, unused, unused, unused, unused, unused);
        const child = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> };
        const requests: unknown[] = [];
        const replies: unknown[] = [];
        child.send = vi.fn(message => {
            const serialized = structuredClone(message);
            replies.push(serialized);
            void harness.receive(serialized);
            return true;
        });
        ipc.register(child as any);
        harness.send.mockImplementation((message, callback) => {
            const serialized = structuredClone(message);
            requests.push(serialized);
            child.emit('message', serialized);
            callback?.(null);
            return true;
        });
        const option = {
            filePath: 'recording/task-7-4.ts',
            name: 'Task 7.4 recording file',
            parentDirectoryName: 'main',
            recordedId: 7_401,
            type: 'ts',
        };

        try {
            await expect(harness.client.recorded.addVideoFile(option)).resolves.toBe(7_411);
            await expect(harness.client.recorded.updateVideoFileSize(7_412)).resolves.toBeUndefined();

            const addFailureOutcome = harness.client.recorded.addVideoFile(option).then(
                () => ({ success: true }),
                (error: Error) => ({ error }),
            );
            await expect(addFailureOutcome).resolves.toMatchObject({ error: { message: addFailure.message } });
            const sizeFailureOutcome = harness.client.recorded.updateVideoFileSize(7_413).then(
                () => ({ success: true }),
                (error: Error) => ({ error }),
            );
            await expect(sizeFailureOutcome).resolves.toMatchObject({ error: { message: sizeFailure.message } });

            expect(requests).toEqual([
                { args: { option }, func: 'addVideoFile', id: expect.any(Number), model: 'recorded' },
                { args: { videoFileId: 7_412 }, func: 'updateVideoFileSize', id: expect.any(Number), model: 'recorded' },
                { args: { option }, func: 'addVideoFile', id: expect.any(Number), model: 'recorded' },
                { args: { videoFileId: 7_413 }, func: 'updateVideoFileSize', id: expect.any(Number), model: 'recorded' },
            ]);
            const requestIds = requests.map(request => (request as { id: number }).id);
            expect(replies).toEqual([
                { id: requestIds[0], result: 7_411 },
                { id: requestIds[1], result: undefined },
                { error: addFailure.message, id: requestIds[2] },
                { error: sizeFailure.message, id: requestIds[3] },
            ]);
            expect(provider.addVideoFile).toHaveBeenNthCalledWith(1, option);
            expect(provider.addVideoFile).toHaveBeenNthCalledWith(2, option);
            expect(provider.updateVideoFileSize).toHaveBeenNthCalledWith(1, 7_412);
            expect(provider.updateVideoFileSize).toHaveBeenNthCalledWith(2, 7_413);
            expect(harness.client.pending.size).toBe(0);
            expect(harness.client.retired.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            child.removeAllListeners();
            harness.cleanup();
            vi.clearAllTimers();
            vi.useRealTimers();
        }

        expect(child.listenerCount('message')).toBe(0);
        expect(process.listenerCount('message')).toBe(listenerBaseline);
    });

    it('[Task 5.8] keeps preparation effect-free and replies only after one terminal-barrier final deletion', async () => {
        const recordedId = 1_101;
        const reserveId = 1_103;
        const recorded = {
            id: recordedId,
            reserveId,
            isProtected: false,
            isRecording: true,
            videoFiles: [],
            thumbnails: [],
            dropLogFile: null,
        };
        const preparationRead = deferred<typeof recorded>();
        const terminalBarrier = deferred<void>();
        const recordedPort: any = Object.create(RecordedManageModel.prototype);
        recordedPort.log = { system: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
        recordedPort.recordedDB = {
            deleteOnce: vi.fn(async () => undefined),
            findId: vi
                .fn()
                .mockImplementationOnce(() => preparationRead.promise)
                .mockResolvedValue(recorded),
        };
        recordedPort.videoFileDB = { deleteOnce: vi.fn(async () => undefined) };
        recordedPort.thumbnailDB = { deleteOnce: vi.fn(async () => undefined) };
        recordedPort.dropLogFileDB = { deleteOnce: vi.fn(async () => undefined) };
        recordedPort.recordedEvent = { emitDeleteRecorded: vi.fn() };
        recordedPort.config = { recorded: [], thumbnail: 'synthetic-thumbnail', dropLog: 'synthetic-drop-log' };
        const prepareUserDeletion = vi.spyOn(recordedPort, 'prepareUserDeletion');
        const deletePrepared = vi.spyOn(recordedPort, 'deletePrepared');
        const recordingPort = {
            cancelForDeletion: vi.fn(() => terminalBarrier.promise),
            hasReserve: vi.fn(() => true),
        };
        const unused = {};
        const ipc = new IPCServer(unused, recordedPort, unused, recordingPort, unused, unused, unused);
        const child = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> };
        child.send = vi.fn();
        ipc.register(child as any);
        const request = {
            id: 1_102,
            model: 'recorded',
            func: 'delete',
            args: { recordedId },
        };

        try {
            child.emit('message', request);
            await vi.waitFor(() => expect(prepareUserDeletion).toHaveBeenCalledWith(recordedId));

            expect(recordingPort.hasReserve).not.toHaveBeenCalled();
            expect(recordingPort.cancelForDeletion).not.toHaveBeenCalled();
            expect(deletePrepared).not.toHaveBeenCalled();
            expect(child.send).not.toHaveBeenCalled();

            preparationRead.resolve(recorded);
            await vi.waitFor(() => expect(recordingPort.cancelForDeletion).toHaveBeenCalledWith(reserveId));

            expect(deletePrepared).not.toHaveBeenCalled();
            expect(child.send).not.toHaveBeenCalled();

            terminalBarrier.resolve();
            await vi.waitFor(() => expect(child.send).toHaveBeenCalledOnce());

            const reply = child.send.mock.calls[0][0];
            expect(request).toEqual({
                id: 1_102,
                model: 'recorded',
                func: 'delete',
                args: { recordedId },
            });
            expect(Object.keys(request.args)).toEqual(['recordedId']);
            expect(reply).toEqual({ id: request.id, result: undefined });
            expect(Object.keys(reply)).toEqual(['id', 'result']);
            expect(deletePrepared).toHaveBeenCalledOnce();
            expect(recordedPort.recordedDB.deleteOnce).toHaveBeenCalledWith(recordedId);
            expect(recordedPort.recordedEvent.emitDeleteRecorded).toHaveBeenCalledOnce();
            expect(recordedPort.recordedEvent.emitDeleteRecorded).toHaveBeenCalledWith(recorded);
            expect(recordedPort.resourceMutationLock.tails.size).toBe(0);
            expect(child.listenerCount('message')).toBe(1);
        } finally {
            child.removeAllListeners();
        }
        expect(child.listenerCount('message')).toBe(0);
    });
});
