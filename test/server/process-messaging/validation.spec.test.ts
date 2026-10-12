import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushImmediate, flushNextTick, makeChild, makeClient, makeServer } from './_harness';
import { operationCases, operationKey } from './operation-fixtures';

const terminalEvents = ['exit', 'error', 'disconnect', 'close'] as const;

const expectPeerReleased = (server: any, child: ReturnType<typeof makeChild>): void => {
    child.emit('disconnect');
    expect(server.child).toBeNull();
    expect(server.currentPeer).toBeNull();
    expect(child.listenerCount('message')).toBe(0);
    for (const event of terminalEvents) expect(child.listenerCount(event)).toBe(0);
};

const handlers = (domains: Record<string, Record<string, unknown>>): unknown[] =>
    Object.values(domains).flatMap(domain => Object.values(domain));

const expectRecordedDeletionNotCalled = (domains: any): void => {
    expect(domains.recorded.prepareUserDeletion).not.toHaveBeenCalled();
    expect(domains.recorded.deletePrepared).not.toHaveBeenCalled();
};

const expectSelectedHandlerNotCalled = (domains: any, operation: { domain: string; func: string }): void => {
    if (operation.domain === 'recorded' && operation.func === 'delete') {
        expectRecordedDeletionNotCalled(domains);
        return;
    }
    expect(domains[operation.domain][operation.func]).not.toHaveBeenCalled();
};

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('SPEC-VALID dispatcher validation', () => {
    it.each([
        ['unknown own target', { id: 401, model: 'unsupported', func: 'delete' }],
        ['unknown own operation', { id: 402, model: 'recorded', func: 'unsupported' }],
    ])('%s returns same-id IPCFunctionError without calling a domain handler', async (_name, message) => {
        const { domains, server } = makeServer();
        const child = makeChild();
        server.register(child);
        child.emit('message', message);
        await flushImmediate();
        expect(child.send).toHaveBeenCalledWith({ error: 'IPCFunctionError', id: message.id });
        for (const handler of handlers(domains)) expect(handler).not.toHaveBeenCalled();
    });

    const requiredArguments = operationCases.flatMap(operation =>
        Object.keys(operation.args ?? {})
            .filter(key => operation.args?.[key] !== undefined)
            .map(key => ({
                key,
                operation,
            })),
    );

    it.each(requiredArguments)(
        '$operation.model.$operation.func rejects missing $key with handler count zero',
        async ({ key, operation }) => {
            const { domains, server } = makeServer();
            const child = makeChild();
            const args = { ...operation.args };
            delete args[key];
            server.register(child);
            child.emit('message', { args, func: operation.func, id: 403, model: operation.model });
            await flushImmediate();
            expectSelectedHandlerNotCalled(domains, operation);
            expect(child.send).toHaveBeenCalledWith({ error: 'IPCArgsError', id: 403 });
        },
    );

    it('rejects an entirely missing args object before invoking the selected handler', async () => {
        const { domains, server } = makeServer();
        const child = makeChild();
        server.register(child);
        child.emit('message', { func: 'delete', id: 4041, model: 'recorded' });
        await flushImmediate();
        expectRecordedDeletionNotCalled(domains);
        expect(child.send).toHaveBeenCalledWith({ error: 'IPCArgsError', id: 4041 });
    });

    it.each(requiredArguments)(
        '$operation.model.$operation.func rejects undefined $key with handler count zero',
        async ({ key, operation }) => {
            const { domains, server } = makeServer();
            const child = makeChild();
            const args = { ...operation.args, [key]: undefined };
            server.register(child);
            child.emit('message', { args, func: operation.func, id: 404, model: operation.model });
            await flushImmediate();
            expectSelectedHandlerNotCalled(domains, operation);
            expect(child.send).toHaveBeenCalledWith({ error: 'IPCArgsError', id: 404 });
        },
    );

    it('passes null through as an existing value without cross-domain schema decisions', async () => {
        const { domains, server } = makeServer();
        const child = makeChild();
        server.register(child);
        child.emit('message', {
            args: { isProtect: null, recordedId: null },
            func: 'changeProtect',
            id: 405,
            model: 'recorded',
        });
        await flushImmediate();
        expect(domains.recorded.changeProtect).toHaveBeenCalledOnce();
        expect(domains.recorded.changeProtect).toHaveBeenCalledWith(null, null);
        expect(child.send).toHaveBeenCalledWith({ id: 405, result: undefined });
    });

    it('does not add common rejection for excess envelope or argument fields', async () => {
        const { domains, server } = makeServer();
        const child = makeChild();
        server.register(child);
        child.emit('message', {
            args: { excessArgument: 'synthetic-extra', recordedId: 21 },
            excessEnvelope: 'synthetic-extra',
            func: 'delete',
            id: 4051,
            model: 'recorded',
        });
        await flushImmediate();
        expect(domains.recorded).not.toHaveProperty('delete');
        expect(domains.recorded.prepareUserDeletion).toHaveBeenCalledExactlyOnceWith(21);
        expect(domains.recorded.deletePrepared).toHaveBeenCalledExactlyOnceWith(expect.any(Object));
        expect(domains.recorded.prepareUserDeletion.mock.invocationCallOrder[0]).toBeLessThan(
            domains.recorded.deletePrepared.mock.invocationCallOrder[0],
        );
        expect(child.send).toHaveBeenCalledWith({ id: 4051, result: undefined });
    });

    it('does not add the unsupported reserveation.clean handler', async () => {
        const { domains, server } = makeServer();
        const child = makeChild();
        server.register(child);
        child.emit('message', { func: 'clean', id: 406, model: 'reserveation' });
        await flushImmediate();
        for (const handler of handlers(domains)) expect(handler).not.toHaveBeenCalled();
        expect(child.send).toHaveBeenCalledWith({ error: 'IPCFunctionError', id: 406 });
        expect(operationCases.map(operationKey)).not.toContain('reserveation.clean');
    });
});

describe('SPEC-VALID canonical R3 acceptance cases', () => {
    it('[PM-3.1] rejects unsupported own targets and operations without invoking a handler or retaining a peer', async () => {
        for (const message of [
            { id: 431, model: 'unsupported', func: 'delete' },
            { id: 432, model: 'recorded', func: 'unsupported' },
        ]) {
            const { domains, server } = makeServer();
            const child = makeChild();
            server.register(child);
            child.emit('message', message);
            await flushImmediate();

            expect(child.send).toHaveBeenCalledExactlyOnceWith({ error: 'IPCFunctionError', id: message.id });
            for (const handler of handlers(domains)) expect(handler).not.toHaveBeenCalled();
            expectPeerReleased(server, child);
        }
    });

    it('[PM-3.2] rejects each missing or undefined required argument before handler completion and releases the peer', async () => {
        const requiredArguments = operationCases.flatMap(operation =>
            Object.keys(operation.args ?? {})
                .filter(key => operation.args?.[key] !== undefined)
                .map(key => ({ key, operation })),
        );
        for (const { key, operation } of requiredArguments) {
            for (const args of [
                Object.fromEntries(Object.entries(operation.args ?? {}).filter(([argument]) => argument !== key)),
                { ...operation.args, [key]: undefined },
            ]) {
                const { domains, server } = makeServer();
                const child = makeChild();
                server.register(child);
                child.emit('message', { args, func: operation.func, id: 433, model: operation.model });
                await flushImmediate();

                expectSelectedHandlerNotCalled(domains, operation);
                expect(child.send).toHaveBeenCalledExactlyOnceWith({ error: 'IPCArgsError', id: 433 });
                expectPeerReleased(server, child);
            }
        }
    });

    it('[PM-3.3] returns the exact handler error to the same request and releases its Promise and timer resources', async () => {
        vi.useFakeTimers();
        const clientHarness = makeClient();
        try {
            const { domains, server } = makeServer();
            const requester = makeChild();
            const failure = new Error('synthetic-handler-error');
            const preparation = { isRecording: false, reserveId: null, status: 'prepared' as const, token: {} };
            domains.recorded.prepareUserDeletion.mockResolvedValue(preparation);
            domains.recorded.deletePrepared.mockRejectedValue(failure);
            requester.send.mockImplementation(message => void clientHarness.receive(message));
            clientHarness.send.mockImplementation(message => requester.emit('message', message));
            server.register(requester);

            const result = clientHarness.client.recorded.delete(51);
            const outcome = result.then(
                () => ({ status: 'fulfilled' as const }),
                (error: Error) => ({ error, status: 'rejected' as const }),
            );
            await flushNextTick();
            for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();

            await expect(outcome).resolves.toEqual({
                error: expect.objectContaining({ message: failure.message }),
                status: 'rejected',
            });
            expect(domains.recorded).not.toHaveProperty('delete');
            expect(domains.recorded.prepareUserDeletion).toHaveBeenCalledExactlyOnceWith(51);
            expect(domains.recorded.deletePrepared).toHaveBeenCalledExactlyOnceWith(preparation.token);
            expect(domains.recorded.prepareUserDeletion.mock.invocationCallOrder[0]).toBeLessThan(
                domains.recorded.deletePrepared.mock.invocationCallOrder[0],
            );
            expect(clientHarness.client.pending.size).toBe(0);
            expect(clientHarness.client.retired.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
            expectPeerReleased(server, requester);
        } finally {
            clientHarness.cleanup();
        }
    });
});
