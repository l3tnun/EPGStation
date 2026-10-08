import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
} from '../external-command-test-harness';

const settleQueue = async (queueAdd: ReturnType<typeof makeCommandQueueHarness>['queueAdd']): Promise<void> => {
    await Promise.all(queueAdd.mock.results.map(result => result.value));
};

beforeAll(() => installSpawnStub());
afterEach(() => resetCommandHarness());
afterAll(() => restoreSpawnStub());

describe('external command terminal-race finalizer', () => {
    it.each([
        ['error then exit', ['error', 'exit'] as const],
        ['exit then error', ['exit', 'error'] as const],
    ])(
        '[Task 5.1] accepts only the first terminal result and releases owned listeners for %s',
        async (_label, terminalOrder) => {
            const harness = makeCommandQueueHarness();
            const first = hookFamilies[0];
            const second = hookFamilies[1];
            const children: DeferredCommandChild[] = [];
            let firstSettlementCount = 0;
            processStubs.spawn.mockImplementation(() => {
                const child = new DeferredCommandChild(1_150 + children.length);
                children.push(child);
                return child;
            });

            first.invoke(harness.model, first.makePayload());
            second.invoke(harness.model, second.makePayload());
            await waitFor(() => children.length === 1, 'terminal-race fixture did not spawn');
            void harness.queueAdd.mock.results[0].value.finally(() => {
                firstSettlementCount += 1;
            });

            const failure = new Error(`synthetic ${terminalOrder.join('-')} failure`);
            for (const event of terminalOrder) {
                if (event === 'error') children[0].emitError(failure);
                else children[0].emitExit(17);
            }
            await waitFor(() => children.length === 2, 'terminal-race fixture did not advance');
            children[1].emitExit(0);
            await settleQueue(harness.queueAdd);

            const firstTerminalLogs = [
                ...harness.logger.system.info.mock.calls,
                ...harness.logger.system.error.mock.calls,
            ].filter(([message]) =>
                [
                    `finish: ${commandFor(first.label)}`,
                    `failed: ${commandFor(first.label)}`,
                    `failed: ${commandFor(first.label)}. exit: 17`,
                ].includes(String(message)),
            );
            expect({
                classification: 'fixed contract',
                firstQueueSettlements: firstSettlementCount,
                nextItemStarts: processStubs.spawn.mock.calls.length - 1,
                retainedErrorListeners: children[0].listenerCount('error'),
                retainedExitListeners: children[0].listenerCount('exit'),
                terminalResultLogs: firstTerminalLogs.length,
            }).toEqual({
                classification: 'fixed contract',
                firstQueueSettlements: 1,
                nextItemStarts: 1,
                retainedErrorListeners: 0,
                retainedExitListeners: 0,
                terminalResultLogs: 1,
            });

            for (const child of children) child.removeAllListeners();
            expect(children.flatMap(child => child.eventNames())).toEqual([]);
        },
    );
});
