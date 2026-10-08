import { describe, expect, it, vi } from 'vitest';
import { makeChild, makeServer } from '../process-messaging/_harness';
import { makeLogger, makeReserve, makeSetter, RecordedTagEvent } from './_harness';

const makeDiff = () => ({ update: [makeReserve()], isSuppressLog: false });

const expectNoDomainOperations = (domains: Record<string, Record<string, unknown>>): void => {
    for (const domain of Object.values(domains)) {
        for (const operation of Object.values(domain)) expect(operation).not.toHaveBeenCalled();
    }
};

describe('EventSetter downstream notification contract', () => {
    it('[EH-2.1] attempts one PM handoff and later destinations after a synchronous handoff failure', () => {
        const failure = new Error('synthetic PM handoff failure');
        const ledger: string[] = [];
        const harness = makeSetter();
        harness.ipc.notifyClient.mockImplementation(() => {
            ledger.push('pm');
            throw failure;
        });
        harness.recordingManage.acceptMutation.mockImplementation(() => ledger.push('local'));
        harness.externalCommandManage.addUpdateReseves.mockImplementation(() => ledger.push('hook'));
        harness.setter.set();

        expect(harness.callbacks.reserve.setUpdated(makeDiff())).toBeUndefined();

        expect(ledger).toEqual(['pm', 'local', 'hook']);
        expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
        expect(harness.logger.system.error.mock.calls).toEqual([[failure]]);
    });

    it('[EH-2.2] uses one argument-free PM notification as the UI refresh trigger handoff', () => {
        const harness = makeSetter();
        harness.setter.set();

        expect(harness.callbacks.recordedTag.setUpdated(402)).toBeUndefined();

        expect(harness.ipc.notifyClient.mock.calls).toEqual([[]]);
        expect(harness.ipc.setEncode).not.toHaveBeenCalled();
    });

    it('[EH-2.3] delegates aggregation and send-unit timing beyond the PM handoff', () => {
        const schedule = vi.spyOn(globalThis, 'setTimeout');
        const harness = makeSetter();
        harness.setter.set();
        try {
            expect(harness.callbacks.reserve.setUpdated(makeDiff())).toBeUndefined();

            expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
            expect(schedule).not.toHaveBeenCalled();
        } finally {
            schedule.mockRestore();
        }
    });

    it('[EH-2.4] hands off a refresh trigger without requiring the changed business state as payload', () => {
        const harness = makeSetter();
        const diff = makeDiff();
        harness.setter.set();

        expect(harness.callbacks.reserve.setUpdated(diff)).toBeUndefined();

        expect(harness.ipc.notifyClient.mock.calls).toEqual([[]]);
        expect(harness.recordingManage.acceptMutation).toHaveBeenCalledWith(diff);
        expect(harness.externalCommandManage.addUpdateReseves).toHaveBeenCalledWith(diff);
    });

    it('[EH-2.5] records a synchronous recording-acceptance throw, starts the Hook, and does not retry', () => {
        const logger = makeLogger();
        const failure = new Error('synthetic recording-acceptance throw');
        const ledger: string[] = [];
        const diff = makeDiff();
        const originalReserve = { ...diff.update[0] };
        const retry = vi.fn();
        const harness = makeSetter({
            logger,
            recordingManage: {
                acceptMutation: vi.fn(() => {
                    ledger.push('accept');
                    throw failure;
                }),
                retry,
                update: vi.fn(),
            },
        });
        harness.ipc.notifyClient.mockImplementation(() => ledger.push('pm'));
        harness.externalCommandManage.addUpdateReseves.mockImplementation(() => ledger.push('hook'));
        harness.setter.set();

        expect(harness.callbacks.reserve.setUpdated(diff)).toBeUndefined();
        expect(ledger).toEqual(['pm', 'accept', 'hook']);

        expect(logger.system.error.mock.calls).toEqual([[failure]]);
        expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
        expect(harness.recordingManage.acceptMutation).toHaveBeenCalledOnce();
        expect(harness.externalCommandManage.addUpdateReseves).toHaveBeenCalledOnce();
        expect(retry).not.toHaveBeenCalled();
        expect(diff.update[0]).toMatchObject(originalReserve);
    });

    it('[EH-2.6] keeps business delivery accepted across absent, failed, and current carriers', () => {
        const logger = makeLogger();
        const { domains, logError, server } = makeServer();
        const harness = makeSetter({ ipc: server, logger });
        harness.setter.set();
        const absent = { update: [makeReserve({ id: 501 })], isSuppressLog: false };
        const disconnected = { update: [makeReserve({ id: 502 })], isSuppressLog: false };
        const current = { update: [makeReserve({ id: 503 })], isSuppressLog: false };
        const snapshots = [absent, disconnected, current].map(diff => ({ ...diff.update[0] }));

        expect(harness.callbacks.reserve.setUpdated(absent)).toBeUndefined();
        expect(server.child).toBeNull();

        const failure = Object.assign(new Error('synthetic disconnected carrier'), {
            code: 'ERR_IPC_CHANNEL_CLOSED',
        });
        const failedChild = makeChild();
        failedChild.send.mockImplementation(() => {
            throw failure;
        });
        server.register(failedChild);
        expect(harness.callbacks.reserve.setUpdated(disconnected)).toBeUndefined();

        const currentChild = makeChild();
        server.register(currentChild);
        expect(currentChild.send).not.toHaveBeenCalled();
        expect(harness.callbacks.reserve.setUpdated(current)).toBeUndefined();

        expect(failedChild.send.mock.calls).toEqual([[{ type: 'notifyClient' }, expect.any(Function)]]);
        expect(currentChild.send.mock.calls).toEqual([[{ type: 'notifyClient' }, expect.any(Function)]]);
        expect(logger.system.error).not.toHaveBeenCalled();
        expect(logError).toHaveBeenCalledWith(`IPC notification discarded: ${failure.message}`);
        expect(harness.recordingManage.acceptMutation.mock.calls).toEqual([[absent], [disconnected], [current]]);
        expect(harness.externalCommandManage.addUpdateReseves.mock.calls).toEqual([
            [absent],
            [disconnected],
            [current],
        ]);
        expect([absent, disconnected, current].map(diff => diff.update[0])).toEqual(snapshots);
        expectNoDomainOperations(domains);
    });

    it('[EH-2.7] replays no old notification and delivers one new notification after restart', () => {
        const firstLogger = makeLogger();
        const firstEvent = new RecordedTagEvent({ getLogger: () => firstLogger });
        const first = makeServer();
        const oldListener = vi.fn();
        const firstHarness = makeSetter({ ipc: first.server, logger: firstLogger, recordedTagEvent: firstEvent });
        firstHarness.setter.set();
        firstEvent.setUpdated(oldListener);

        expect(firstEvent.emitUpdated(601)).toBeUndefined();
        expect(first.server.child).toBeNull();
        expect(oldListener).toHaveBeenCalledOnce();

        const restartedLogger = makeLogger();
        const restartedEvent = new RecordedTagEvent({ getLogger: () => restartedLogger });
        const restarted = makeServer();
        const restartedHarness = makeSetter({
            ipc: restarted.server,
            logger: restartedLogger,
            recordedTagEvent: restartedEvent,
        });
        restartedHarness.setter.set();

        expect(restartedEvent.emitUpdated(601)).toBeUndefined();
        const currentChild = makeChild();
        restarted.server.register(currentChild);
        expect(currentChild.send).not.toHaveBeenCalled();

        expect(restartedEvent.emitUpdated(602)).toBeUndefined();

        expect(currentChild.send.mock.calls).toEqual([[{ type: 'notifyClient' }, expect.any(Function)]]);
        expect(oldListener).toHaveBeenCalledOnce();
        expectNoDomainOperations(first.domains);
        expectNoDomainOperations(restarted.domains);
        expect(firstLogger.system.error).not.toHaveBeenCalled();
        expect(restartedLogger.system.error).not.toHaveBeenCalled();
    });
});
