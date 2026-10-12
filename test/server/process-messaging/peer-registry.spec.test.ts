import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushImmediate, IPCServer, makeChild, makeServer } from './_harness';

const terminalEvents = ['exit', 'error', 'disconnect', 'close'] as const;

const deferred = <T>() => {
    let reject!: (error: Error) => void;
    let resolve!: (result: T) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
};

const expectPeerListenersReleased = (child: ReturnType<typeof makeChild>): void => {
    expect(child.listenerCount('message')).toBe(0);
    for (const event of terminalEvents) expect(child.listenerCount(event)).toBe(0);
};

const expectPeerReleased = (server: any, child: ReturnType<typeof makeChild>): void => {
    child.emit('disconnect');
    expect(server.child).toBeNull();
    expect(server.currentPeer).toBeNull();
    expectPeerListenersReleased(child);
};

afterEach(() => vi.useRealTimers());

describe('SPEC-PEER canonical R6 acceptance cases', () => {
    it('[PM-6.1] makes the spawn-time registration immediately available and releases one notification peer', () => {
        const { server } = makeServer();
        const child = makeChild();
        server.register(child);

        expect(server.notifyClient()).toBeUndefined();
        expect(child.send).toHaveBeenCalledWith({ type: 'notifyClient' }, expect.any(Function));
        expect(child.listenerCount('message')).toBe(1);
        for (const event of terminalEvents) expect(child.listenerCount(event)).toBe(1);
        expectPeerReleased(server, child);
    });

    it('[PM-6.2] captures the registered request sender as the reply target through terminal settlement', async () => {
        const { domains, server } = makeServer();
        const requester = makeChild();
        const option = { filePath: 'requester-result' };
        domains.recorded.addVideoFile.mockResolvedValue('requester-result');
        server.register(requester);
        requester.emit('message', { args: { option }, func: 'addVideoFile', id: 602, model: 'recorded' });
        await flushImmediate();

        expect(domains.recorded.addVideoFile).toHaveBeenCalledWith(option);
        expect(requester.send).toHaveBeenCalledWith({ id: 602, result: 'requester-result' });
        expectPeerReleased(server, requester);
    });

    it('[PM-6.3] keeps two same-ID requests on their original peers when the replacement settles first', async () => {
        const { domains, server } = makeServer();
        const original = makeChild();
        const replacement = makeChild();
        const originalOperation = deferred<string>();
        const replacementOperation = deferred<string>();
        const replacementFailure = new Error('replacement operation failure');
        const originalOption = { filePath: 'original-result' };
        const replacementOption = { filePath: 'replacement-result' };
        domains.recorded.addVideoFile.mockImplementationOnce(() => originalOperation.promise);
        domains.recorded.addVideoFile.mockImplementationOnce(() => replacementOperation.promise);
        server.register(original);
        original.emit('message', {
            args: { option: originalOption },
            func: 'addVideoFile',
            id: 603,
            model: 'recorded',
        });
        await flushImmediate();
        server.register(replacement);
        replacement.emit('message', {
            args: { option: replacementOption },
            func: 'addVideoFile',
            id: 603,
            model: 'recorded',
        });
        await flushImmediate();
        replacementOperation.reject(replacementFailure);
        await flushImmediate();
        originalOperation.resolve('original result');
        await flushImmediate();

        expect(domains.recorded.addVideoFile).toHaveBeenNthCalledWith(1, originalOption);
        expect(domains.recorded.addVideoFile).toHaveBeenNthCalledWith(2, replacementOption);
        expect(original.send.mock.calls.map(([message]) => message)).toEqual([{ id: 603, result: 'original result' }]);
        expect(replacement.send.mock.calls.map(([message]) => message)).toEqual([
            { error: replacementFailure.message, id: 603 },
        ]);
        expectPeerListenersReleased(original);
        expectPeerReleased(server, replacement);
    });

    it('[PM-6.4] records and drops disconnected, synchronous, and callback reply delivery failures', async () => {
        const disconnected = makeServer();
        const disconnectedRequester = makeChild();
        const disconnectedReplacement = makeChild();
        const disconnectedOperation = deferred<void>();
        disconnected.domains.recorded.deletePrepared.mockReturnValue(disconnectedOperation.promise);
        disconnected.server.register(disconnectedRequester);
        disconnectedRequester.emit('message', {
            args: { recordedId: 641 },
            func: 'delete',
            id: 604,
            model: 'recorded',
        });
        await flushImmediate();
        disconnected.server.register(disconnectedReplacement);
        (disconnectedRequester as { connected?: boolean }).connected = false;
        disconnectedRequester.emit('disconnect');
        disconnectedOperation.resolve();
        await flushImmediate();

        expect(disconnectedRequester.send).not.toHaveBeenCalled();
        expect(disconnectedReplacement.send).not.toHaveBeenCalled();
        expect(disconnected.logError).toHaveBeenCalledWith('IPC reply discarded: requester is disconnected');

        const synchronous = makeServer();
        const synchronousRequester = makeChild();
        const synchronousReplacement = makeChild();
        const synchronousOperation = deferred<void>();
        const synchronousFailure = new Error('synthetic requester send failure');
        synchronousRequester.send.mockImplementation(() => {
            throw synchronousFailure;
        });
        synchronous.domains.recorded.deletePrepared.mockReturnValue(synchronousOperation.promise);
        synchronous.server.register(synchronousRequester);
        synchronousRequester.emit('message', {
            args: { recordedId: 642 },
            func: 'delete',
            id: 605,
            model: 'recorded',
        });
        await flushImmediate();
        synchronous.server.register(synchronousReplacement);
        synchronousOperation.resolve();
        await flushImmediate();

        expect(synchronousRequester.send).toHaveBeenCalledWith({ id: 605, result: undefined });
        expect(synchronousReplacement.send).not.toHaveBeenCalled();
        expect(synchronous.logError).toHaveBeenCalledWith('IPC reply discarded: synthetic requester send failure');

        const callback = makeServer();
        const callbackRequester = makeChild();
        const callbackReplacement = makeChild();
        const callbackOperation = deferred<void>();
        const callbackFailure = new Error('synthetic requester callback failure');
        (callbackRequester as { connected?: boolean }).connected = true;
        callbackRequester.send.mockImplementation((_message, completion?: (error: Error | null) => void) => {
            completion?.(callbackFailure);
            return false;
        });
        callback.domains.recorded.deletePrepared.mockReturnValue(callbackOperation.promise);
        callback.server.register(callbackRequester);
        callbackRequester.emit('message', { args: { recordedId: 643 }, func: 'delete', id: 606, model: 'recorded' });
        await flushImmediate();
        callback.server.register(callbackReplacement);
        callbackOperation.resolve();
        await flushImmediate();

        expect(callbackRequester.send).toHaveBeenCalledWith({ id: 606, result: undefined }, expect.any(Function));
        expect(callbackReplacement.send).not.toHaveBeenCalled();
        expect(callback.logError).toHaveBeenCalledWith('IPC reply discarded: synthetic requester callback failure');

        const callbackSuccess = makeServer();
        const callbackSuccessRequester = makeChild();
        const callbackSuccessReplacement = makeChild();
        const callbackSuccessOperation = deferred<void>();
        (callbackSuccessRequester as { connected?: boolean }).connected = true;
        callbackSuccessRequester.send.mockImplementation((_message, completion?: (error: Error | null) => void) => {
            completion?.(null);
            return true;
        });
        callbackSuccess.domains.recorded.deletePrepared.mockReturnValue(callbackSuccessOperation.promise);
        callbackSuccess.server.register(callbackSuccessRequester);
        callbackSuccessRequester.emit('message', {
            args: { recordedId: 644 },
            func: 'delete',
            id: 607,
            model: 'recorded',
        });
        await flushImmediate();
        callbackSuccess.server.register(callbackSuccessReplacement);
        callbackSuccessOperation.resolve();
        await flushImmediate();

        expect(callbackSuccessRequester.send).toHaveBeenCalledWith(
            { id: 607, result: undefined },
            expect.any(Function),
        );
        expect(callbackSuccessReplacement.send).not.toHaveBeenCalled();
        expect(callbackSuccess.logError).not.toHaveBeenCalled();

        const noLoggerServer = new IPCServer({}, {}, {}, {}, {}, {});
        const noLoggerRequester = makeChild();
        (noLoggerRequester as { connected?: boolean }).connected = false;
        noLoggerServer.register(noLoggerRequester);
        noLoggerRequester.emit('message', { func: 'unsupported', id: 608, model: 'unsupported' });
        await flushImmediate();

        expect(noLoggerRequester.send).not.toHaveBeenCalled();
        expectPeerListenersReleased(disconnectedRequester);
        expectPeerListenersReleased(synchronousRequester);
        expectPeerListenersReleased(callbackRequester);
        expectPeerListenersReleased(callbackSuccessRequester);
        expectPeerReleased(disconnected.server, disconnectedReplacement);
        expectPeerReleased(synchronous.server, synchronousReplacement);
        expectPeerReleased(callback.server, callbackReplacement);
        expectPeerReleased(callbackSuccess.server, callbackSuccessReplacement);
        expectPeerReleased(noLoggerServer, noLoggerRequester);
    });

    it('[PM-6.5] does not send or allocate delivery resources when no current peer exists', () => {
        vi.useFakeTimers();
        const { server } = makeServer();
        const unregisteredChild = makeChild();

        expect(server.notifyClient()).toBeUndefined();
        expect(unregisteredChild.send).not.toHaveBeenCalled();
        expect(unregisteredChild.listenerCount('message')).toBe(0);
        for (const event of terminalEvents) expect(unregisteredChild.listenerCount(event)).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[PM-6.6] fences late terminal events and releases exactly one registration listener set', async () => {
        for (const event of terminalEvents) {
            const { server } = makeServer();
            const oldChild = makeChild();
            const currentChild = makeChild();
            server.register(oldChild);
            const lateOldTerminal = oldChild.rawListeners(event)[0];
            server.register(currentChild);

            expect(oldChild.listenerCount('message')).toBe(0);
            for (const terminalEvent of terminalEvents) {
                expect(oldChild.listenerCount(terminalEvent)).toBe(0);
                expect(currentChild.listenerCount(terminalEvent)).toBe(1);
            }
            lateOldTerminal(event === 'error' ? new Error('synthetic old terminal error') : 0);
            server.notifyClient();
            expect(currentChild.send).toHaveBeenCalledWith({ type: 'notifyClient' }, expect.any(Function));

            const lateCurrentTerminal = (currentChild.rawListeners(event)[0] as { listener?: () => void }).listener;
            currentChild.emit(event, event === 'error' ? new Error('synthetic terminal error') : 0);
            lateCurrentTerminal?.();
            for (const terminalEvent of terminalEvents) expect(currentChild.listenerCount(terminalEvent)).toBe(0);
            server.notifyClient();
            expect(currentChild.send).toHaveBeenCalledOnce();
        }

        const { domains, server } = makeServer();
        const child = makeChild();
        server.register(child);
        server.register(child);
        child.emit('message', { args: { recordedId: 661 }, func: 'delete', id: 607, model: 'recorded' });
        await flushImmediate();

        expect(domains.recorded.prepareUserDeletion).toHaveBeenCalledExactlyOnceWith(661);
        expect(domains.recorded.deletePrepared).toHaveBeenCalledExactlyOnceWith(expect.any(Object));
        expect(child.listenerCount('message')).toBe(1);
        for (const event of terminalEvents) expect(child.listenerCount(event)).toBe(1);
        expectPeerReleased(server, child);
    });
});

describe('SPEC-PEER recorded-use registry and reply-failure defensive paths', () => {
    it('replies unknown when the recorded-use registry throws while acquiring', async () => {
        const { server } = makeServer();
        const child = makeChild();
        const registry = {
            acquire: vi.fn(() => {
                throw new Error('synthetic acquire registry failure');
            }),
            release: vi.fn(),
        };
        server.recordedResourceUseRegistryRegistrationPort.register(registry);
        server.register(child);

        child.emit('message', { id: 41, kind: 'delivery', recordedId: 701, type: 'recordedUseAcquire' });
        await flushImmediate();

        expect(child.send).toHaveBeenCalledWith({ id: 41, status: 'unknown', type: 'recordedUseAcquireReply' });
    });

    it('replies unknown when the recorded-use registry throws while releasing', async () => {
        const { server } = makeServer();
        const child = makeChild();
        const registry = {
            acquire: vi.fn(),
            release: vi.fn(() => {
                throw new Error('synthetic release registry failure');
            }),
        };
        server.recordedResourceUseRegistryRegistrationPort.register(registry);
        server.register(child);

        child.emit('message', { acquisitionRequestId: 42, type: 'recordedUseRelease' });
        await flushImmediate();

        expect(child.send).toHaveBeenCalledWith({
            acquisitionRequestId: 42,
            status: 'unknown',
            type: 'recordedUseReleaseReply',
        });
    });

    it('logs a non-Error reply-delivery failure using its stringified value', () => {
        const { server, logError } = makeServer();
        const child = makeChild();
        // Every reply-delivery failure case elsewhere in this suite throws a real Error; this
        // exercises recordReplyFailure's `String(error)` fallback, which only a non-Error thrown
        // from a synchronous `send` reaches.
        child.send.mockImplementation(() => {
            throw 'synthetic non-error reply failure';
        });
        server.register(child);

        child.emit('message', { id: 43, kind: 'delivery', recordedId: 702, type: 'recordedUseAcquire' });
        expect(logError).toHaveBeenCalledWith('IPC reply discarded: synthetic non-error reply failure');
    });

    it('logs a non-Error notification-delivery failure using its stringified value', () => {
        const { server, logError } = makeServer();
        const child = makeChild();
        child.send.mockImplementation((_message: unknown, callback?: (error: unknown) => void) => {
            callback?.('synthetic non-error notification failure');
            return true;
        });
        server.register(child);

        expect(server.notifyClient()).toBeUndefined();

        expect(logError).toHaveBeenCalledWith('IPC notification discarded: synthetic non-error notification failure');
    });
});
