import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { deferred, flushImmediate, makeReserve, makeSetter, ProcessUtil } from './_harness';
import {
    commandFor,
    DeferredCommandChild,
    hookFamilies,
    installSpawnStub,
    makeCommandQueueHarness,
    processStubs,
    resetCommandHarness,
    restoreSpawnStub,
    waitFor,
} from './external-command-test-harness';

const settleQueue = async (queueAdd: ReturnType<typeof makeCommandQueueHarness>['queueAdd']): Promise<void> => {
    await Promise.all(queueAdd.mock.results.map(result => result.value));
};

beforeAll(() => installSpawnStub());
afterEach(() => resetCommandHarness());
afterAll(() => restoreSpawnStub());

describe('external command existing failure contract', () => {
    it('[EH-6.1] records parse, database, and environment preparation failures and continues in order', async () => {
        const harness = makeCommandQueueHarness();
        const parseFailure = new Error('synthetic command interpretation failure');
        const databaseFailure = new Error('synthetic command database failure');
        const environmentFailure = new Error('synthetic command environment failure');
        const dropPathFailure = new Error('synthetic drop path failure');
        const originalParse = ProcessUtil.parseCmdStr;
        vi.spyOn(ProcessUtil, 'parseCmdStr').mockImplementation((command: string) => {
            if (command === commandFor(hookFamilies[0].label)) throw parseFailure;
            return originalParse(command);
        });
        harness.channelDB.findId.mockRejectedValueOnce(databaseFailure).mockResolvedValue(null);
        const environmentPayload = hookFamilies[2].makePayload();
        Object.defineProperty(environmentPayload.delete[0], 'name', {
            configurable: true,
            get: () => {
                throw environmentFailure;
            },
        });
        const dropPathPayload = hookFamilies[6].makePayload();
        dropPathPayload.videoFiles = undefined;
        dropPathPayload.dropLogFile = {
            dropCnt: 0,
            errorCnt: 0,
            get filePath(): never {
                throw dropPathFailure;
            },
            scramblingCnt: 0,
        };
        const sentinel = new DeferredCommandChild(1_090);
        processStubs.spawn.mockReturnValue(sentinel);

        hookFamilies[0].invoke(harness.model, hookFamilies[0].makePayload());
        hookFamilies[1].invoke(harness.model, hookFamilies[1].makePayload());
        hookFamilies[2].invoke(harness.model, environmentPayload);
        hookFamilies[6].invoke(harness.model, dropPathPayload);
        hookFamilies[3].invoke(harness.model, hookFamilies[3].makePayload());
        await waitFor(() => processStubs.spawn.mock.calls.length === 1, 'preparation failures did not advance');

        expect(processStubs.spawn.mock.calls[0][1]).toEqual([hookFamilies[3].label]);
        expect(harness.logger.system.error.mock.calls).toEqual([
            [`execute cmd error: ${commandFor(hookFamilies[0].label)}`],
            [parseFailure],
            [`execute cmd error: ${commandFor(hookFamilies[1].label)}`],
            [databaseFailure],
            [`execute cmd error: ${commandFor(hookFamilies[2].label)}`],
            [environmentFailure],
            [`execute cmd error: ${commandFor(hookFamilies[6].label)}`],
            [dropPathFailure],
        ]);

        sentinel.emitExit(0);
        await settleQueue(harness.queueAdd);
    });

    it('[EH-6.7] consumes asynchronous path rejection, releases active, and emits no unhandled rejection', async () => {
        const harness = makeCommandQueueHarness();
        const recordedPathFailure = new Error('synthetic asynchronous record path failure');
        const outputPathFailure = new Error('synthetic asynchronous output path failure');
        const unhandledRejections: unknown[] = [];
        const recordUnhandled = (reason: unknown): void => {
            unhandledRejections.push(reason);
        };
        process.prependListener('unhandledRejection', recordUnhandled);
        const nextChild = new DeferredCommandChild(1_095);
        processStubs.spawn.mockReturnValue(nextChild);
        harness.videoUtil.getFullFilePathFromId
            .mockRejectedValueOnce(recordedPathFailure)
            .mockRejectedValueOnce(outputPathFailure);

        try {
            hookFamilies[5].invoke(harness.model, hookFamilies[5].makePayload());
            hookFamilies[8].invoke(harness.model, hookFamilies[8].makePayload());
            hookFamilies[3].invoke(harness.model, hookFamilies[3].makePayload());
            await waitFor(
                () => processStubs.spawn.mock.calls.length === 1,
                'queue did not advance after asynchronous path rejection',
            );

            expect(processStubs.spawn.mock.calls[0][1]).toEqual([hookFamilies[3].label]);
            expect(harness.logger.system.error.mock.calls).toContainEqual([recordedPathFailure]);
            expect(harness.logger.system.error.mock.calls).toContainEqual([outputPathFailure]);
            await flushImmediate();
            expect(unhandledRejections).toEqual([]);

            nextChild.emitExit(0);
            await settleQueue(harness.queueAdd);
        } finally {
            process.removeListener('unhandledRejection', recordUnhandled);
        }
    });

    it('[EH-6.2] records synchronous spawn throw and asynchronous child error, then advances once', async () => {
        const harness = makeCommandQueueHarness();
        const spawnFailure = new Error('synthetic synchronous spawn failure');
        const childFailure = new Error('synthetic asynchronous child error');
        const first = hookFamilies[0];
        const second = hookFamilies[1];
        const third = hookFamilies[2];
        const attempts: string[] = [];
        const children: DeferredCommandChild[] = [];
        processStubs.spawn.mockImplementation((_bin: string, args: string[]) => {
            const label = args[0];
            attempts.push(label);
            if (label === first.label) throw spawnFailure;
            const child = new DeferredCommandChild(1_100 + children.length);
            children.push(child);
            return child;
        });

        first.invoke(harness.model, first.makePayload());
        second.invoke(harness.model, second.makePayload());
        third.invoke(harness.model, third.makePayload());
        await waitFor(() => children.length === 1, 'queue did not advance after synchronous spawn throw');
        children[0].emitError(childFailure);
        await waitFor(() => children.length === 2, 'queue did not advance after asynchronous child error');
        children[1].emitExit(0);
        await settleQueue(harness.queueAdd);

        expect(attempts).toEqual([first.label, second.label, third.label]);
        expect(harness.logger.system.error.mock.calls).toEqual([
            [`execute cmd error: ${commandFor(first.label)}`],
            [spawnFailure],
            [`failed: ${commandFor(second.label)}`],
            [childFailure],
        ]);
    });

    it('[EH-6.3] records a nonzero exit and starts the next waiting command once', async () => {
        const harness = makeCommandQueueHarness();
        const first = hookFamilies[5];
        const second = hookFamilies[3];
        const children: DeferredCommandChild[] = [];
        processStubs.spawn.mockImplementation(() => {
            const child = new DeferredCommandChild(1_200 + children.length);
            children.push(child);
            return child;
        });

        first.invoke(harness.model, first.makePayload());
        second.invoke(harness.model, second.makePayload());
        await waitFor(() => children.length === 1, 'nonzero fixture did not spawn');
        children[0].emitExit(23);
        await waitFor(() => children.length === 2, 'queue did not advance after nonzero exit');
        children[1].emitExit(0);
        await settleQueue(harness.queueAdd);

        expect(processStubs.spawn).toHaveBeenCalledTimes(2);
        expect(harness.logger.system.error.mock.calls).toContainEqual([
            `${commandFor(first.label)} process is error. exit: 23`,
        ]);
    });

    it('[EH-6.4] records one successful terminal result for each environment profile', async () => {
        const harness = makeCommandQueueHarness();
        const families = [hookFamilies[3], hookFamilies[5], hookFamilies[8]];
        const children: DeferredCommandChild[] = [];
        processStubs.spawn.mockImplementation(() => {
            const child = new DeferredCommandChild(1_300 + children.length);
            children.push(child);
            return child;
        });

        for (const family of families) family.invoke(harness.model, family.makePayload());
        for (let index = 0; index < families.length; index += 1) {
            await waitFor(() => children.length === index + 1, `successful profile ${index} did not spawn`);
            children[index].emitExit(0);
        }
        await settleQueue(harness.queueAdd);

        expect(harness.logger.system.info.mock.calls).toContainEqual([`finish: ${commandFor(families[0].label)}`]);
        expect(harness.logger.system.info.mock.calls).toContainEqual([
            `${commandFor(families[1].label)} process is fin`,
        ]);
        expect(harness.logger.system.info.mock.calls).toContainEqual([
            `${commandFor(families[2].label)} process is fin`,
        ]);
        expect(harness.logger.system.error).not.toHaveBeenCalled();
    });

    it('[EH-6.5] leaves accepted business payload and domain collaborators unchanged after child failure', async () => {
        const commandHarness = makeCommandQueueHarness();
        const eventHarness = makeSetter({
            externalCommandManage: commandHarness.model,
            logger: commandHarness.logger,
        });
        eventHarness.setter.set();
        const reserve = makeReserve({ description: 'synthetic business state', id: 1_401 });
        const snapshot = JSON.stringify(reserve);
        const child = new DeferredCommandChild(1_401);
        processStubs.spawn.mockReturnValue(child);

        expect(eventHarness.callbacks.recording.setStartPrepRecording(reserve)).toBeUndefined();
        expect(eventHarness.ipc.notifyClient).toHaveBeenCalledOnce();
        await waitFor(() => processStubs.spawn.mock.calls.length === 1, 'business-state fixture did not spawn');
        child.emitError(new Error('synthetic business-state child failure'));
        await settleQueue(commandHarness.queueAdd);

        expect(JSON.stringify(reserve)).toBe(snapshot);
        expect(eventHarness.ipc.notifyClient).toHaveBeenCalledOnce();
        expect(eventHarness.recordingManage.acceptMutation).not.toHaveBeenCalled();
        expect(eventHarness.reservationManage.cancel).not.toHaveBeenCalled();
        expect(eventHarness.recordedManage.historyCleanup).not.toHaveBeenCalled();
    });

    it('[EH-6.6] does not treat command acceptance or terminal failure as another workflow settlement', async () => {
        const commandHarness = makeCommandQueueHarness();
        const workflow = deferred<void>();
        let workflowSettled = false;
        const eventHarness = makeSetter({
            externalCommandManage: commandHarness.model,
            logger: commandHarness.logger,
        });
        eventHarness.reservationManage.cancel.mockReturnValue(
            workflow.promise.finally(() => {
                workflowSettled = true;
            }),
        );
        eventHarness.setter.set();
        const reserve = makeReserve({ id: 1_501 });
        const child = new DeferredCommandChild(1_501);
        processStubs.spawn.mockReturnValue(child);

        expect(eventHarness.callbacks.recording.setPrepRecordingFailed(reserve)).toBeUndefined();
        expect(eventHarness.reservationManage.cancel).toHaveBeenCalledWith(reserve.id);
        expect(eventHarness.ipc.notifyClient).toHaveBeenCalledOnce();
        expect(workflowSettled).toBe(false);
        await waitFor(() => processStubs.spawn.mock.calls.length === 1, 'workflow-independence fixture did not spawn');

        child.emitError(new Error('synthetic independent child failure'));
        await settleQueue(commandHarness.queueAdd);
        expect(workflowSettled).toBe(false);
        expect(eventHarness.reservationManage.cancel).toHaveBeenCalledOnce();

        workflow.resolve();
        await flushImmediate();
        expect(workflowSettled).toBe(true);
        expect(eventHarness.ipc.notifyClient).toHaveBeenCalledOnce();
        expect(processStubs.spawn).toHaveBeenCalledOnce();
    });
});
