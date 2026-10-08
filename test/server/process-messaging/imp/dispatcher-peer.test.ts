import { describe, expect, it, vi } from 'vitest';
import { flushImmediate, flushNextTick, makeChild, makeClient, makeServer } from '../_harness';
import { domainHandlerSpies } from '../operation-fixtures';

const expectOnlyHandlerCalled = (domains: Record<string, Record<string, unknown>>, expected: any): void => {
    const handlers = domainHandlerSpies(domains);
    expect(handlers.reduce((count, handler) => count + handler.mock.calls.length, 0)).toBe(1);
    for (const handler of handlers) expect(handler).toHaveBeenCalledTimes(handler === expected ? 1 : 0);
};

const deferred = <T = void>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

describe('isolated implementation-defect evidence', () => {
    it('[PM-3.1] rejects an inherited operation with the requester ID and no domain handler', async () => {
        const { domains, server } = makeServer();
        const child = makeChild();
        server.register(child);
        child.emit('message', { id: 91, model: 'recorded', func: 'toString' });
        await flushImmediate();
        expect(child.send).toHaveBeenCalledWith({ error: 'IPCFunctionError', id: 91 });
        for (const domain of Object.values(domains)) {
            for (const handler of Object.values(domain)) expect(handler).not.toHaveBeenCalled();
        }
    });

    it('[PM-3.1] rejects an inherited target with the requester ID and no domain handler', async () => {
        const { domains, server } = makeServer();
        const child = makeChild();
        server.register(child);
        child.emit('message', { id: 92, model: 'toString', func: 'bind' });
        await flushImmediate();
        expect(child.send).toHaveBeenCalledWith({ error: 'IPCFunctionError', id: 92 });
        for (const domain of Object.values(domains)) {
            for (const handler of Object.values(domain)) expect(handler).not.toHaveBeenCalled();
        }
    });

    it('[PM-3.1] rejects an unknown own target with the requester ID and no domain handler', async () => {
        const { domains, server } = makeServer();
        const child = makeChild();
        server.register(child);
        child.emit('message', { id: 93, model: 'unsupported', func: 'delete' });
        await flushImmediate();
        expect(child.send).toHaveBeenCalledWith({ error: 'IPCFunctionError', id: 93 });
        for (const domain of Object.values(domains)) {
            for (const handler of Object.values(domain)) expect(handler).not.toHaveBeenCalled();
        }
    });
});

describe('reserveation.updateAll(false) replies when the owner starts', () => {
    it.each(['resolve', 'reject'] as const)(
        '[PM-2.3][PM-2.4] replies before the deferred owner Promise can %s and does not reply again',
        async outcome => {
            const { domains, server } = makeServer();
            const child = makeChild();
            const failure = new Error('synthetic deferred updateAll failure');
            let resolveOwner!: () => void;
            let rejectOwner!: (error: Error) => void;
            const ownerResult = new Promise<void>((resolve, reject) => {
                resolveOwner = resolve;
                rejectOwner = reject;
            });
            const observed = ownerResult.then(
                () => 'resolved',
                error => {
                    expect(error).toBe(failure);
                    return 'rejected';
                },
            );
            let settlement = 'pending';
            void observed.then(value => (settlement = value));
            domains.reservation.updateAll.mockReturnValue(ownerResult);
            server.register(child);

            child.emit('message', {
                args: { isUntilComplete: false },
                func: 'updateAll',
                id: outcome === 'resolve' ? 408 : 409,
                model: 'reserveation',
            });
            await flushImmediate();

            expectOnlyHandlerCalled(domains, domains.reservation.updateAll);
            expect(domains.reservation.updateAll).toHaveBeenCalledWith();
            expect(settlement).toBe('pending');
            expect(child.send).toHaveBeenCalledOnce();
            expect(child.send).toHaveBeenCalledWith({
                id: outcome === 'resolve' ? 408 : 409,
                result: undefined,
            });

            if (outcome === 'resolve') resolveOwner();
            else rejectOwner(failure);
            await expect(observed).resolves.toBe(outcome === 'resolve' ? 'resolved' : 'rejected');
            await flushImmediate();
            expect(child.send).toHaveBeenCalledOnce();
        },
    );
});

describe('upload adoption carrier implementation contract', () => {
    it('keeps the parent-owned domain call after reply delivery failure and never forwards it to a replacement child', async () => {
        const domain = deferred<void>();
        const adoption = { adopt: vi.fn(async () => 'adopted/synthetic-token/payload') };
        const { domains, logError, server } = makeServer({ recordedUploadAdoption: adoption });
        const requester = Object.assign(makeChild(), { connected: true });
        const replacement = makeChild();
        requester.send.mockImplementation((_message: unknown, callback: (error: Error) => void) =>
            callback(new Error('synthetic reply delivery failure')),
        );
        domains.recorded.addUploadedVideoFile.mockImplementation(() => domain.promise);
        server.register(requester);

        requester.emit('message', {
            args: {
                option: {
                    fileName: 'synthetic.ts',
                    filePath: 'incoming/synthetic-token/payload',
                    fileType: 'ts',
                    parentDirectoryName: 'synthetic-storage',
                    recordedId: 702,
                    viewName: 'Synthetic upload',
                },
            },
            func: 'addUploadedVideoFile',
            id: 702,
            model: 'recorded',
        });
        await flushImmediate();

        expect(adoption.adopt).toHaveBeenCalledWith('incoming/synthetic-token/payload');
        expect(domains.recorded.addUploadedVideoFile).toHaveBeenCalledOnce();
        server.register(replacement);

        domain.resolve();
        await flushImmediate();

        expect(domains.recorded.addUploadedVideoFile).toHaveBeenCalledOnce();
        expect(requester.send.mock.calls.map(([message]) => message)).toEqual([
            { id: 702, type: 'uploadedVideoAdopted' },
            { id: 702, result: undefined },
        ]);
        expect(replacement.send).not.toHaveBeenCalled();
        expect(logError.mock.calls).toEqual([
            ['IPC reply discarded: synthetic reply delivery failure'],
            ['IPC reply discarded: synthetic reply delivery failure'],
        ]);
    });

    it('rejects an ambiguous callback failure once while late acknowledgement and reply do not resend or retain resources', async () => {
        vi.useFakeTimers();
        const messageListenerBaseline = process.listenerCount('message');
        const timerBaseline = vi.getTimerCount();
        const harness = makeClient();
        try {
            const callbackFailure = new Error('synthetic callback failure');
            harness.send.mockImplementation((_message, callback: (error: Error) => void) => callback(callbackFailure));
            const attempt = harness.client.uploadedVideoRegistrationPort.dispatch({
                fileName: 'synthetic.ts',
                filePath: 'incoming/synthetic-token/payload',
                fileType: 'ts',
                parentDirectoryName: 'synthetic-storage',
                recordedId: 703,
                viewName: 'Synthetic upload',
            });
            await flushNextTick();

            await expect(attempt.disposition).rejects.toThrow(callbackFailure.message);
            expect(harness.send).toHaveBeenCalledOnce();
            expect(harness.client.pending.has(1)).toBe(true);
            expect(vi.getTimerCount()).toBe(timerBaseline + 1);

            await harness.receive({ id: 1, type: 'uploadedVideoAdopted' });
            await harness.receive({ id: 1, result: undefined });

            expect(harness.send).toHaveBeenCalledOnce();
            expect(harness.client.pending.size).toBe(0);
            expect(vi.getTimerCount()).toBe(timerBaseline);
        } finally {
            harness.cleanup();
            expect(process.listenerCount('message')).toBe(messageListenerBaseline);
        }
    });
});
