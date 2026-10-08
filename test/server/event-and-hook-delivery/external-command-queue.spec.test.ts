import { EventEmitter } from 'node:events';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { deferred, flushImmediate, ProcessUtil } from './_harness';
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

const queueSettlements = async (queueAdd: ReturnType<typeof vi.spyOn>): Promise<void> => {
    await Promise.all(queueAdd.mock.results.map(result => result.value));
};

type CommandHarness = ReturnType<typeof makeCommandQueueHarness>;

interface ActiveOverrides {
    child?: DeferredCommandChild | Record<string, any> | null;
    commandPromise?: Promise<void> | null;
    commandType?: string;
    deadlineTimer?: NodeJS.Timeout | null;
    errorListener?: ((err: Error) => void) | null;
    exitListener?: (() => void) | null;
    finalized?: boolean;
    killGraceTimer?: NodeJS.Timeout | null;
    resolveCompletion?: (() => void) | null;
    sentSignals?: NodeJS.Signals[];
    settled?: boolean;
    terminationGraceTimer?: NodeJS.Timeout | null;
    timedOut?: boolean;
}

const makeLifecycleFixture = (harness: CommandHarness, overrides: ActiveOverrides = {}) => {
    const completion = deferred<void>();
    let completionResolutions = 0;
    const resolveCompletion = (): void => {
        completionResolutions += 1;
        completion.resolve();
    };
    const active = {
        child: null,
        cmd: 'synthetic lifecycle command',
        commandPromise: null,
        commandType: 'synthetic-lifecycle-type',
        completion: completion.promise,
        deadlineTimer: null,
        errorListener: null,
        exitListener: null,
        finalized: false,
        killGraceTimer: null,
        resolveCompletion,
        sentSignals: [] as NodeJS.Signals[],
        settled: false,
        terminationGraceTimer: null,
        timedOut: false,
        ...overrides,
    };
    harness.model.activeHookCommand = active;
    return { active, completion, completionResolutions: () => completionResolutions };
};

beforeAll(() => installSpawnStub());
afterEach(() => {
    resetCommandHarness();
    vi.useRealTimers();
});
afterAll(() => restoreSpawnStub());

describe('external command shared queue contract', () => {
    it('[EH-4.1] preserves one FIFO across nine mixed hook families and a reentrant request', async () => {
        const harness = makeCommandQueueHarness();
        const originalParse = ProcessUtil.parseCmdStr;
        const ledger: string[] = [];
        const violations: string[] = [];
        const children: DeferredCommandChild[] = [];
        const attempts = new Map<string, number>();
        let preparing = 0;
        let running = 0;
        let maximumPreparing = 0;
        let maximumRunning = 0;
        let didReenter = false;
        let reentrantPayload: unknown;

        vi.spyOn(ProcessUtil, 'parseCmdStr').mockImplementation((command: string) => {
            const parsed = originalParse(command);
            const label = parsed.args[0];
            if (preparing !== 0 || running !== 0) violations.push(`overlap-before-prepare:${label}`);
            preparing += 1;
            maximumPreparing = Math.max(maximumPreparing, preparing);
            ledger.push(`prepare:${label}`);
            return parsed;
        });
        processStubs.spawn.mockImplementation((_bin: string, args: string[]) => {
            const label = args[0];
            if (preparing !== 1 || running !== 0) violations.push(`overlap-before-spawn:${label}`);
            preparing -= 1;
            running += 1;
            maximumRunning = Math.max(maximumRunning, running);
            attempts.set(label, (attempts.get(label) ?? 0) + 1);
            ledger.push(`spawn:${label}`);
            const child = new DeferredCommandChild(700 + children.length, () => {
                running -= 1;
                ledger.push(`terminal:${label}`);
            });
            children.push(child);
            if (!didReenter) {
                didReenter = true;
                reentrantPayload = hookFamilies[0].makePayload();
                expect(hookFamilies[0].invoke(harness.model, reentrantPayload)).toBeUndefined();
            }
            return child;
        });

        const payloads = hookFamilies.map(family => family.makePayload());
        const payloadSnapshots = payloads.map(payload => JSON.stringify(payload));
        for (const [index, family] of hookFamilies.entries()) {
            expect(family.invoke(harness.model, payloads[index])).toBeUndefined();
        }

        await waitFor(() => children.length === 1, 'first mixed hook did not spawn');
        for (let index = 0; index < hookFamilies.length + 1; index += 1) {
            expect(children).toHaveLength(index + 1);
            children[index].emitExit(0);
            if (index < hookFamilies.length) {
                await waitFor(() => children.length === index + 2, `mixed hook ${index + 1} did not advance`);
            }
        }
        await queueSettlements(harness.queueAdd);

        const expectedLabels = [...hookFamilies.map(family => family.label), hookFamilies[0].label];
        expect(ledger).toEqual(
            expectedLabels.flatMap(label => [`prepare:${label}`, `spawn:${label}`, `terminal:${label}`]),
        );
        expect([...attempts]).toEqual(
            hookFamilies
                .map(family => [family.label, 1] as const)
                .map(([label, count], index) => (index === 0 ? [label, count + 1] : [label, count])),
        );
        expect(violations).toEqual([]);
        expect({ maximumPreparing, maximumRunning, preparing, running }).toEqual({
            maximumPreparing: 1,
            maximumRunning: 1,
            preparing: 0,
            running: 0,
        });
        expect(harness.queueAdd).toHaveBeenCalledTimes(10);
        expect(payloads.map(payload => JSON.stringify(payload))).toEqual(payloadSnapshots);
        expect(reentrantPayload).toBeDefined();
    });

    it('[EH-4.2] does not prepare or spawn a later item while the active child is running', async () => {
        const harness = makeCommandQueueHarness();
        const parse = vi.spyOn(ProcessUtil, 'parseCmdStr');
        const children: DeferredCommandChild[] = [];
        processStubs.spawn.mockImplementation(() => {
            const child = new DeferredCommandChild(800 + children.length);
            children.push(child);
            return child;
        });
        const first = hookFamilies[0];
        const second = hookFamilies[5];

        first.invoke(harness.model, first.makePayload());
        second.invoke(harness.model, second.makePayload());
        await waitFor(() => children.length === 1, 'active command did not spawn');
        await Promise.resolve();

        expect(parse).toHaveBeenCalledOnce();
        expect(harness.channelDB.findId).toHaveBeenCalledOnce();
        expect(harness.videoUtil.getFullFilePathFromId).not.toHaveBeenCalled();
        expect(processStubs.spawn).toHaveBeenCalledOnce();

        children[0].emitExit(0);
        await waitFor(() => children.length === 2, 'next command did not start after terminal');

        expect(parse).toHaveBeenCalledTimes(2);
        expect(harness.channelDB.findId).toHaveBeenCalledTimes(2);
        expect(harness.videoUtil.getFullFilePathFromId).toHaveBeenCalledOnce();
        expect(processStubs.spawn).toHaveBeenCalledTimes(2);
        children[1].emitExit(0);
        await queueSettlements(harness.queueAdd);
    });

    it('[EH-4.3] starts exactly one next item after each normal, nonzero, or error terminal', async () => {
        const harness = makeCommandQueueHarness();
        const families = [hookFamilies[3], hookFamilies[5], hookFamilies[8]];
        const timeline: string[] = [];
        const children: DeferredCommandChild[] = [];
        processStubs.spawn.mockImplementation((_bin: string, args: string[]) => {
            const label = args[0];
            timeline.push(`spawn:${label}`);
            const child = new DeferredCommandChild(900 + children.length, () => timeline.push(`terminal:${label}`));
            children.push(child);
            return child;
        });

        for (const family of families) family.invoke(harness.model, family.makePayload());
        await waitFor(() => children.length === 1, 'normal terminal fixture did not spawn');
        children[0].emitExit(0);
        await waitFor(() => children.length === 2, 'nonzero terminal fixture did not spawn');
        children[1].emitExit(7);
        await waitFor(() => children.length === 3, 'error terminal fixture did not spawn');
        children[2].emitError(new Error('synthetic child error'));
        await queueSettlements(harness.queueAdd);

        expect(timeline).toEqual(families.flatMap(family => [`spawn:${family.label}`, `terminal:${family.label}`]));
        expect(processStubs.spawn).toHaveBeenCalledTimes(3);
    });

    it('[EH-4.4] snapshots the default limit and excludes the active command from waiting', async () => {
        const defaults = makeCommandQueueHarness();
        expect(defaults.getConfig).toHaveBeenCalledOnce();
        expect(defaults.model.hookCommandMaxPending).toBe(64);

        const harness = makeCommandQueueHarness({ hookCommandMaxPending: 1 });
        const active = hookFamilies[0];
        const waiting = hookFamilies[5];
        const children: DeferredCommandChild[] = [];
        processStubs.spawn.mockImplementation(() => {
            const child = new DeferredCommandChild(950 + children.length);
            children.push(child);
            return child;
        });

        active.invoke(harness.model, active.makePayload());
        await waitFor(() => children.length === 1, 'active command did not spawn');
        expect(harness.model.pendingHookCommandCount).toBe(0);

        expect(waiting.invoke(harness.model, waiting.makePayload())).toBeUndefined();

        expect(harness.queueAdd).toHaveBeenCalledTimes(2);
        expect(harness.model.pendingHookCommandCount).toBe(1);
        expect(processStubs.spawn).toHaveBeenCalledOnce();

        children[0].emitExit(0);
        await waitFor(() => children.length === 2, 'waiting command did not become active');
        expect(harness.model.pendingHookCommandCount).toBe(0);
        children[1].emitExit(0);
        await queueSettlements(harness.queueAdd);
    });

    it('[EH-4.5] preserves the verified minimum and maximum startup values without clamping', () => {
        const minimum = makeCommandQueueHarness({ hookCommandMaxPending: 1 });
        const maximum = makeCommandQueueHarness({ hookCommandMaxPending: 10_000 });

        expect(minimum.getConfig).toHaveBeenCalledOnce();
        expect(maximum.getConfig).toHaveBeenCalledOnce();
        expect(minimum.model.hookCommandMaxPending).toBe(1);
        expect(maximum.model.hookCommandMaxPending).toBe(10_000);
    });

    it('[EH-4.6] keeps a running instance snapshot and applies reload only to a new instance', () => {
        const current = makeCommandQueueHarness({ hookCommandMaxPending: 1 });

        current.config.hookCommandMaxPending = 2;
        const restarted = makeCommandQueueHarness(current.config);

        expect(current.getConfig).toHaveBeenCalledOnce();
        expect(restarted.getConfig).toHaveBeenCalledOnce();
        expect(current.model.hookCommandMaxPending).toBe(1);
        expect(restarted.model.hookCommandMaxPending).toBe(2);
    });

    it('[EH-4.20] rejects only the full-queue request and preserves active plus waiting order', async () => {
        const harness = makeCommandQueueHarness({ hookCommandMaxPending: 2 });
        const accepted = [hookFamilies[3], hookFamilies[5], hookFamilies[8]];
        const rejected = hookFamilies[1];
        const timeline: string[] = [];
        const children: DeferredCommandChild[] = [];
        processStubs.spawn.mockImplementation((_bin: string, args: string[]) => {
            const label = args[0];
            timeline.push(`spawn:${label}`);
            const child = new DeferredCommandChild(980 + children.length, () => timeline.push(`terminal:${label}`));
            children.push(child);
            return child;
        });

        accepted[0].invoke(harness.model, accepted[0].makePayload());
        await waitFor(() => children.length === 1, 'active overload fixture did not spawn');
        accepted[1].invoke(harness.model, accepted[1].makePayload());
        accepted[2].invoke(harness.model, accepted[2].makePayload());
        const queueCallsAtCapacity = harness.queueAdd.mock.calls.length;
        const spawnCallsAtCapacity = processStubs.spawn.mock.calls.length;

        expect(rejected.invoke(harness.model, rejected.makePayload())).toBeUndefined();

        expect(harness.queueAdd).toHaveBeenCalledTimes(queueCallsAtCapacity);
        expect(processStubs.spawn).toHaveBeenCalledTimes(spawnCallsAtCapacity);
        expect(harness.model.pendingHookCommandCount).toBe(2);
        expect(harness.logger.system.error.mock.calls).toEqual([
            [`hook command queue is full: ${commandFor(rejected.label)}`],
        ]);

        for (let index = 0; index < accepted.length; index += 1) {
            children[index].emitExit(0);
            if (index + 1 < accepted.length) {
                await waitFor(() => children.length === index + 2, `accepted overload item ${index} did not advance`);
            }
        }
        await queueSettlements(harness.queueAdd);

        expect(timeline).toEqual(accepted.flatMap(family => [`spawn:${family.label}`, `terminal:${family.label}`]));
        expect(processStubs.spawn).toHaveBeenCalledTimes(accepted.length);
        expect(harness.queueAdd).toHaveBeenCalledTimes(accepted.length);
        expect(harness.model.pendingHookCommandCount).toBe(0);
    });

    it('[EH-4.7] does not retry a preparation failure or the following nonzero child', async () => {
        const harness = makeCommandQueueHarness();
        const preparationFailure = new Error('synthetic channel preparation failure');
        harness.channelDB.findId.mockRejectedValueOnce(preparationFailure).mockResolvedValueOnce({
            channelType: 'BS',
            halfWidthName: 'synthetic-half-channel',
            name: 'synthetic-channel',
        });
        const parse = vi.spyOn(ProcessUtil, 'parseCmdStr');
        const child = new DeferredCommandChild(1_001);
        processStubs.spawn.mockReturnValue(child);
        const first = hookFamilies[0];
        const second = hookFamilies[1];

        first.invoke(harness.model, first.makePayload());
        second.invoke(harness.model, second.makePayload());
        await waitFor(
            () => processStubs.spawn.mock.calls.length === 1,
            'queue did not advance after preparation failure',
        );

        expect(parse.mock.calls.map(call => call[0])).toEqual([
            `${process.execPath} ${first.label}`,
            `${process.execPath} ${second.label}`,
        ]);
        expect(processStubs.spawn.mock.calls[0][1]).toEqual([second.label]);
        child.emitExit(9);
        await queueSettlements(harness.queueAdd);

        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(harness.channelDB.findId).toHaveBeenCalledTimes(2);
        expect(harness.logger.system.error.mock.calls).toContainEqual([preparationFailure]);
    });

    it('[EH-4.8] starts one absolute deadline before preparation and gives waiting items no timer', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const harness = makeCommandQueueHarness({ hookCommandTimeoutMs: 75 });
        const timeline: string[] = [];
        const timers = vi.spyOn(globalThis, 'setTimeout');
        const parse = vi.spyOn(ProcessUtil, 'parseCmdStr').mockImplementation(command => {
            timeline.push(`parse:${command}`);
            return { args: [command.split(' ')[1]], bin: process.execPath };
        });
        harness.channelDB.findId.mockImplementation(async () => {
            timeline.push('database');
            return null;
        });
        const children: DeferredCommandChild[] = [];
        processStubs.spawn.mockImplementation(() => {
            timeline.push('spawn');
            const child = new DeferredCommandChild(1_020 + children.length);
            children.push(child);
            return child;
        });

        hookFamilies[0].invoke(harness.model, hookFamilies[0].makePayload());
        hookFamilies[1].invoke(harness.model, hookFamilies[1].makePayload());
        await waitFor(() => children.length === 1, 'first deadline fixture did not spawn');

        expect(harness.model.hookCommandTimeoutMs).toBe(75);
        expect(timers).toHaveBeenCalledTimes(1);
        expect(timers).toHaveBeenLastCalledWith(expect.any(Function), 75);
        expect(timers.mock.invocationCallOrder[0]).toBeLessThan(parse.mock.invocationCallOrder[0]);
        expect(timeline).toEqual([`parse:${commandFor(hookFamilies[0].label)}`, 'database', 'spawn']);
        expect(vi.getTimerCount()).toBe(1);

        children[0].emitExit(0);
        await waitFor(() => children.length === 2, 'waiting deadline fixture did not become active');
        expect(timers).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(1);

        children[1].emitExit(0);
        await queueSettlements(harness.queueAdd);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[EH-4.9] snapshots the verified default and boundary deadline values', () => {
        const defaults = makeCommandQueueHarness();
        const minimum = makeCommandQueueHarness({ hookCommandTimeoutMs: 1 });
        const maximum = makeCommandQueueHarness({ hookCommandTimeoutMs: 2_147_483_647 });

        expect(defaults.model.hookCommandTimeoutMs).toBe(300_000);
        expect(minimum.model.hookCommandTimeoutMs).toBe(1);
        expect(maximum.model.hookCommandTimeoutMs).toBe(2_147_483_647);
        expect(defaults.getConfig).toHaveBeenCalledOnce();
        expect(minimum.getConfig).toHaveBeenCalledOnce();
        expect(maximum.getConfig).toHaveBeenCalledOnce();
    });

    it('[EH-4.10] keeps the deadline snapshot on reload and applies it only to a new instance', () => {
        const current = makeCommandQueueHarness({ hookCommandTimeoutMs: 125 });

        current.config.hookCommandTimeoutMs = 250;
        const restarted = makeCommandQueueHarness(current.config);

        expect(current.model.hookCommandTimeoutMs).toBe(125);
        expect(restarted.model.hookCommandTimeoutMs).toBe(250);
        expect(current.getConfig).toHaveBeenCalledOnce();
        expect(restarted.getConfig).toHaveBeenCalledOnce();
    });

    it('[EH-4.19] fences a late preparation result after its active deadline and advances once', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const harness = makeCommandQueueHarness({ hookCommandTimeoutMs: 40 });
        const delayedChannel = deferred<null>();
        harness.channelDB.findId.mockImplementationOnce(() => delayedChannel.promise).mockResolvedValue(null);
        const children: DeferredCommandChild[] = [];
        processStubs.spawn.mockImplementation(() => {
            const child = new DeferredCommandChild(1_040 + children.length);
            children.push(child);
            return child;
        });
        const delayed = hookFamilies[0];
        const next = hookFamilies[1];

        delayed.invoke(harness.model, delayed.makePayload());
        next.invoke(harness.model, next.makePayload());
        await waitFor(() => harness.channelDB.findId.mock.calls.length === 1, 'delayed preparation did not start');

        expect(processStubs.spawn).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(40);
        await waitFor(() => children.length === 1, 'next command did not start after preparation timeout');
        expect(processStubs.spawn.mock.calls[0][1]).toEqual([next.label]);
        expect(harness.logger.system.error.mock.calls).toContainEqual([
            `hook command timed out: ${commandFor(delayed.label)}`,
        ]);

        delayedChannel.resolve(null);
        await flushImmediate();
        await flushImmediate();
        expect(processStubs.spawn).toHaveBeenCalledOnce();

        children[0].emitExit(0);
        await queueSettlements(harness.queueAdd);
        expect(harness.model.activeHookCommand).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[EH-4.11] selects timeout failure and attempts SIGINT once without reporting success', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const harness = makeCommandQueueHarness({ hookCommandTimeoutMs: 25 });
        const child = new DeferredCommandChild(1_110);
        processStubs.spawn.mockReturnValue(child);
        const timeoutLogFailure = new Error('synthetic timeout log failure');
        harness.logger.system.error.mockImplementation((message: unknown) => {
            if (String(message).startsWith('hook command timed out:')) throw timeoutLogFailure;
        });

        hookFamilies[3].invoke(harness.model, hookFamilies[3].makePayload());
        await waitFor(() => processStubs.spawn.mock.calls.length === 1, 'running timeout fixture did not spawn');
        await vi.advanceTimersByTimeAsync(25);

        expect(child.kill.mock.calls).toEqual([['SIGINT']]);
        expect(child.kill.mock.calls.flat()).not.toContain('SIGTERM');
        expect(harness.logger.system.info.mock.calls).not.toContainEqual([
            `finish: ${commandFor(hookFamilies[3].label)}`,
        ]);

        child.emitExit(0);
        await queueSettlements(harness.queueAdd);
        expect(child.listenerCount('error')).toBe(0);
        expect(child.listenerCount('exit')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[EH-4.12] waits up to three seconds after SIGINT and stops escalation on observed exit', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const harness = makeCommandQueueHarness({ hookCommandTimeoutMs: 30 });
        const child = new DeferredCommandChild(1_120);
        processStubs.spawn.mockReturnValue(child);

        hookFamilies[3].invoke(harness.model, hookFamilies[3].makePayload());
        await waitFor(() => processStubs.spawn.mock.calls.length === 1, 'SIGINT grace fixture did not spawn');
        await vi.advanceTimersByTimeAsync(30);
        await vi.advanceTimersByTimeAsync(2_999);

        expect(child.kill.mock.calls).toEqual([['SIGINT']]);
        expect(vi.getTimerCount()).toBe(1);

        child.emitExit(130);
        await queueSettlements(harness.queueAdd);
        expect(child.kill.mock.calls).toEqual([['SIGINT']]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[EH-4.13] finalizes one timeout failure after confirmed forced exit without retry', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const harness = makeCommandQueueHarness({ hookCommandTimeoutMs: 35 });
        const child = new DeferredCommandChild(1_130);
        child.kill.mockImplementation((signal: string) => {
            if (signal === 'SIGKILL') child.emitExit(137);
            return true;
        });
        processStubs.spawn.mockReturnValue(child);
        let settlements = 0;

        hookFamilies[3].invoke(harness.model, hookFamilies[3].makePayload());
        await waitFor(() => processStubs.spawn.mock.calls.length === 1, 'forced-exit fixture did not spawn');
        void harness.queueAdd.mock.results[0].value.finally(() => {
            settlements += 1;
        });
        await vi.advanceTimersByTimeAsync(35);
        await vi.advanceTimersByTimeAsync(3_000);
        await queueSettlements(harness.queueAdd);

        expect(child.kill.mock.calls).toEqual([['SIGINT'], ['SIGKILL']]);
        expect({ settlements, spawns: processStubs.spawn.mock.calls.length }).toEqual({ settlements: 1, spawns: 1 });
        expect(harness.model.activeHookCommand).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[EH-4.14] supervises only the direct spawned child and releases that reference', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const harness = makeCommandQueueHarness({ hookCommandTimeoutMs: 45 });
        const directChild = new DeferredCommandChild(1_140);
        const grandchild = { kill: vi.fn() };
        processStubs.spawn.mockReturnValue(directChild);

        hookFamilies[3].invoke(harness.model, hookFamilies[3].makePayload());
        await waitFor(() => processStubs.spawn.mock.calls.length === 1, 'direct-child fixture did not spawn');
        expect(harness.model.activeHookCommand.child).toBe(directChild);

        await vi.advanceTimersByTimeAsync(45);
        expect(directChild.kill.mock.calls).toEqual([['SIGINT']]);
        expect(grandchild.kill).not.toHaveBeenCalled();

        directChild.emitExit(130);
        await queueSettlements(harness.queueAdd);
        expect(harness.model.activeHookCommand).toBeNull();
        expect(grandchild.kill).not.toHaveBeenCalled();
    });

    it('[EH-4.15] attempts SIGKILL once on the same child only after the three-second SIGINT grace', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const harness = makeCommandQueueHarness({ hookCommandTimeoutMs: 50 });
        const child = new DeferredCommandChild(1_150);
        processStubs.spawn.mockReturnValue(child);

        hookFamilies[3].invoke(harness.model, hookFamilies[3].makePayload());
        await waitFor(() => processStubs.spawn.mock.calls.length === 1, 'SIGKILL escalation fixture did not spawn');
        await vi.advanceTimersByTimeAsync(50);
        await vi.advanceTimersByTimeAsync(2_999);
        expect(child.kill.mock.calls).toEqual([['SIGINT']]);

        await vi.advanceTimersByTimeAsync(1);
        expect(child.kill.mock.calls).toEqual([['SIGINT'], ['SIGKILL']]);
        expect(child.kill.mock.calls.flat()).not.toContain('SIGTERM');

        child.emitExit(137);
        await queueSettlements(harness.queueAdd);
        expect(child.kill).toHaveBeenCalledTimes(2);
    });

    it('[EH-4.16] waits at most three seconds after SIGKILL before forced release', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const harness = makeCommandQueueHarness({ hookCommandTimeoutMs: 55 });
        const child = new DeferredCommandChild(1_160);
        processStubs.spawn.mockReturnValue(child);
        let settlements = 0;

        hookFamilies[3].invoke(harness.model, hookFamilies[3].makePayload());
        await waitFor(() => processStubs.spawn.mock.calls.length === 1, 'SIGKILL grace fixture did not spawn');
        void harness.queueAdd.mock.results[0].value.finally(() => {
            settlements += 1;
        });
        await vi.advanceTimersByTimeAsync(55);
        await vi.advanceTimersByTimeAsync(3_000);
        await vi.advanceTimersByTimeAsync(2_999);
        expect(settlements).toBe(0);

        await vi.advanceTimersByTimeAsync(1);
        await queueSettlements(harness.queueAdd);
        expect(settlements).toBe(1);
        expect(child.kill.mock.calls).toEqual([['SIGINT'], ['SIGKILL']]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[EH-4.17] records type, PID, signals, and forced-release markers when termination is unconfirmed', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const harness = makeCommandQueueHarness({ hookCommandTimeoutMs: 60 });
        const child = new DeferredCommandChild(1_170);
        processStubs.spawn.mockReturnValue(child);

        hookFamilies[3].invoke(harness.model, hookFamilies[3].makePayload());
        await waitFor(() => processStubs.spawn.mock.calls.length === 1, 'forced-release log fixture did not spawn');
        await vi.advanceTimersByTimeAsync(60 + 3_000 + 3_000);
        await queueSettlements(harness.queueAdd);

        const diagnostics = harness.logger.system.error.mock.calls.flat().map(String).join(' ');
        expect(diagnostics).toContain('recording-prep-started');
        expect(diagnostics).toContain(String(child.pid));
        expect(diagnostics).toContain('SIGINT');
        expect(diagnostics).toContain('SIGKILL');
        expect(diagnostics).toContain('termination-unconfirmed');
        expect(diagnostics).toContain('forced-release');
    });

    it('[EH-4.18] sends no additional signal, retry, or grandchild request after forced release', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const harness = makeCommandQueueHarness({ hookCommandTimeoutMs: 65 });
        const child = new DeferredCommandChild(1_180);
        const grandchild = { kill: vi.fn() };
        const signalFailure = new Error('synthetic signal attempt failure');
        child.kill.mockImplementation(() => {
            throw signalFailure;
        });
        processStubs.spawn.mockReturnValue(child);

        hookFamilies[3].invoke(harness.model, hookFamilies[3].makePayload());
        await waitFor(() => processStubs.spawn.mock.calls.length === 1, 'finite-signal fixture did not spawn');
        await vi.advanceTimersByTimeAsync(65 + 3_000 + 3_000);
        await queueSettlements(harness.queueAdd);
        await vi.advanceTimersByTimeAsync(30_000);

        expect(child.kill.mock.calls).toEqual([['SIGINT'], ['SIGKILL']]);
        expect(grandchild.kill).not.toHaveBeenCalled();
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(child.listenerCount('error')).toBe(0);
        expect(child.listenerCount('exit')).toBe(0);
        expect(harness.model.activeHookCommand).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[EH-IMP-QUEUE-TIMEOUT-CHILD-ERROR-ESCALATION] keeps timeout escalation active when a child error does not confirm exit', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const harness = makeCommandQueueHarness({ hookCommandTimeoutMs: 75 });
        const timedOutChild = new DeferredCommandChild(1_181);
        const nextChild = new DeferredCommandChild(1_182);
        const childError = new Error('synthetic post-timeout child error');
        processStubs.spawn.mockReturnValueOnce(timedOutChild).mockReturnValueOnce(nextChild);

        hookFamilies[3].invoke(harness.model, hookFamilies[3].makePayload());
        hookFamilies[4].invoke(harness.model, hookFamilies[4].makePayload());
        await waitFor(() => processStubs.spawn.mock.calls.length === 1, 'post-timeout error fixture did not spawn');

        await vi.advanceTimersByTimeAsync(75);
        expect(timedOutChild.kill.mock.calls).toEqual([['SIGINT']]);
        expect(timedOutChild.exitCode).toBeNull();

        expect(() => timedOutChild.emit('error', childError)).not.toThrow();
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(1);
        expect(harness.logger.system.error.mock.calls).toContainEqual([childError]);
        expect(
            harness.logger.system.error.mock.calls.some(call =>
                String(call[0]).includes('hook command child error after timeout'),
            ),
        ).toBe(true);

        await vi.advanceTimersByTimeAsync(2_999);
        expect(timedOutChild.kill.mock.calls).toEqual([['SIGINT']]);
        expect(processStubs.spawn).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(1);
        expect(timedOutChild.kill.mock.calls).toEqual([['SIGINT'], ['SIGKILL']]);
        expect(processStubs.spawn).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(2_999);
        expect(processStubs.spawn).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(1);
        await waitFor(() => processStubs.spawn.mock.calls.length === 2, 'forced release did not advance the queue');
        expect(timedOutChild.listenerCount('error')).toBe(0);
        expect(timedOutChild.listenerCount('exit')).toBe(0);

        nextChild.emitExit(0);
        await queueSettlements(harness.queueAdd);

        const diagnostics = harness.logger.system.error.mock.calls.flat().map(String).join(' ');
        expect(diagnostics).toContain('termination-unconfirmed');
        expect(diagnostics).toContain('forced-release');
        expect(nextChild.listenerCount('error')).toBe(0);
        expect(nextChild.listenerCount('exit')).toBe(0);
        expect(harness.model.activeHookCommand).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[EH-IMP-QUEUE-TIMEOUT-CAPTURED-ERROR-SUPPRESSED] suppresses a captured timeout error after exit finalizes in the same stack', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const harness = makeCommandQueueHarness({ hookCommandTimeoutMs: 76 });
        const timedOutChild = new DeferredCommandChild(1_183);
        const nextChild = new DeferredCommandChild(1_184);
        const childError = new Error('synthetic captured post-finalize child error');
        processStubs.spawn.mockReturnValueOnce(timedOutChild).mockReturnValueOnce(nextChild);

        hookFamilies[3].invoke(harness.model, hookFamilies[3].makePayload());
        hookFamilies[4].invoke(harness.model, hookFamilies[4].makePayload());
        await waitFor(() => processStubs.spawn.mock.calls.length === 1, 'captured-error fixture did not spawn');
        const active = harness.model.activeHookCommand;
        const settle = vi.spyOn(harness.model, 'settle');
        const finalize = vi.spyOn(harness.model, 'finalize');
        const successfulSettlements = (): number => settle.mock.results.filter(result => result.value === true).length;
        const capturedErrorListener = timedOutChild.listeners('error')[0] as (error: Error) => void;
        expect(capturedErrorListener).toEqual(expect.any(Function));

        await vi.advanceTimersByTimeAsync(76);
        timedOutChild.emit('error', childError);
        expect(active).toMatchObject({ finalized: false, settled: true, timedOut: true });
        expect(successfulSettlements()).toBe(1);
        expect(finalize).not.toHaveBeenCalled();

        timedOutChild.once('exit', () => capturedErrorListener(childError));
        timedOutChild.emitExit(0);

        expect(active).toMatchObject({ finalized: true, settled: true, timedOut: true });
        expect(successfulSettlements()).toBe(1);
        expect(finalize).toHaveBeenCalledOnce();
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(harness.logger.system.error.mock.calls).toEqual([
            [`hook command timed out: ${commandFor(hookFamilies[3].label)}`],
            ['hook command child error after timeout: type=recording-prep-started pid=1183'],
            [childError],
        ]);

        await waitFor(() => processStubs.spawn.mock.calls.length === 2, 'captured-error fixture did not advance');
        nextChild.emitExit(0);
        await queueSettlements(harness.queueAdd);

        expect(processStubs.spawn).toHaveBeenCalledTimes(2);
        expect(successfulSettlements()).toBe(2);
        expect(finalize).toHaveBeenCalledTimes(2);
        expect(timedOutChild.listenerCount('error')).toBe(0);
        expect(timedOutChild.listenerCount('exit')).toBe(0);
        expect(nextChild.listenerCount('error')).toBe(0);
        expect(nextChild.listenerCount('exit')).toBe(0);
        expect(harness.model.activeHookCommand).toBeNull();
        expect(harness.model.pendingHookCommandCount).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 5.1] isolates logger, timer-clear, and listener-removal faults during finalization', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const harness = makeCommandQueueHarness({ hookCommandTimeoutMs: 70 });
        const child = new DeferredCommandChild(1_190);
        processStubs.spawn.mockReturnValue(child);
        hookFamilies[3].invoke(harness.model, hookFamilies[3].makePayload());
        await waitFor(() => processStubs.spawn.mock.calls.length === 1, 'cleanup-fault fixture did not spawn');

        const originalClearTimeout = globalThis.clearTimeout;
        vi.spyOn(globalThis, 'clearTimeout')
            .mockImplementationOnce(() => {
                throw new Error('synthetic clearTimeout failure');
            })
            .mockImplementation(originalClearTimeout);
        const originalRemoveListener = child.removeListener.bind(child);
        vi.spyOn(child, 'removeListener')
            .mockImplementationOnce(() => {
                throw new Error('synthetic removeListener failure');
            })
            .mockImplementation(originalRemoveListener);
        harness.logger.system.info.mockImplementation((message: unknown) => {
            if (String(message).startsWith('finish:')) throw new Error('synthetic result log failure');
        });

        expect(() => child.emitExit(0)).not.toThrow();
        await queueSettlements(harness.queueAdd);

        expect(child.listenerCount('error')).toBe(0);
        expect(child.listenerCount('exit')).toBe(0);
        expect(harness.model.activeHookCommand).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 5.1] handles immediate exit through the same finalizer without removing a foreign listener', async () => {
        const harness = makeCommandQueueHarness();
        const immediate = new DeferredCommandChild(1_200);
        immediate.exitCode = 0;
        const foreignExitListener = vi.fn();
        immediate.on('exit', foreignExitListener);
        const next = new DeferredCommandChild(1_201);
        processStubs.spawn.mockReturnValueOnce(immediate).mockReturnValueOnce(next);

        hookFamilies[3].invoke(harness.model, hookFamilies[3].makePayload());
        hookFamilies[4].invoke(harness.model, hookFamilies[4].makePayload());
        await waitFor(() => processStubs.spawn.mock.calls.length === 2, 'immediate exit did not advance once');

        expect(immediate.listeners('exit')).toEqual([foreignExitListener]);
        expect(immediate.listenerCount('error')).toBe(0);

        next.emitExit(0);
        await queueSettlements(harness.queueAdd);
        expect(processStubs.spawn).toHaveBeenCalledTimes(2);
        immediate.removeListener('exit', foreignExitListener);
    });
});

describe('external command lifecycle mutation matrix', () => {
    it('[EH-IMP-QUEUE-HOOK-COMMAND-TYPE-RESTORE] preserves every public hook command type and restores the enclosing enqueue type', () => {
        const harness = makeCommandQueueHarness();
        const addCommand = vi.spyOn(harness.model, 'addCommand').mockImplementation(() => undefined);
        const expectedTypes = [
            'reserve-added',
            'reserve-updated',
            'reserve-deleted',
            'recording-prep-started',
            'recording-prep-cancelled-or-failed',
            'recording-started',
            'recording-failed',
            'recording-finished',
            'encoding-finished',
        ];

        harness.model.enqueuingCommandType = 'outer-command';
        for (const family of hookFamilies) {
            family.invoke(harness.model, family.makePayload());
            expect(harness.model.enqueuingCommandType).toBe('outer-command');
        }

        expect(addCommand.mock.calls.map(call => [call[0], call[1]])).toEqual(
            hookFamilies.map((family, index) => [expectedTypes[index], commandFor(family.label)]),
        );
        expect(harness.logger.system.info.mock.calls).toContainEqual([
            `encodingFinishCommand: ${commandFor(hookFamilies[8].label)}`,
        ]);

        const enqueueFailure = new Error('synthetic nested enqueue failure');
        addCommand.mockImplementationOnce(() => {
            expect(harness.model.enqueuingCommandType).toBe('recording-prep-started');
            throw enqueueFailure;
        });
        expect(() => hookFamilies[3].invoke(harness.model, hookFamilies[3].makePayload())).toThrow(enqueueFailure);
        expect(harness.model.enqueuingCommandType).toBe('outer-command');
    });

    it('[EH-IMP-QUEUE-ACTIVE-RECORD-SETTLEMENT] initializes one active record and settles success, failure, and duplicate states exactly once', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const harness = makeCommandQueueHarness({ hookCommandTimeoutMs: 91 });
        const command = deferred<void>();
        const commandFactory = vi.fn(() => command.promise);

        const completion = harness.model.startCommand('matrix-type', 'matrix-command', commandFactory);
        const active = harness.model.activeHookCommand;
        expect(commandFactory).toHaveBeenCalledOnce();
        expect(active).toMatchObject({
            child: null,
            cmd: 'matrix-command',
            commandPromise: command.promise,
            commandType: 'matrix-type',
            deadlineTimer: expect.anything(),
            errorListener: null,
            exitListener: null,
            finalized: false,
            killGraceTimer: null,
            sentSignals: [],
            settled: false,
            terminationGraceTimer: null,
            timedOut: false,
        });
        expect(active.completion).toBe(completion);
        expect(active.resolveCompletion).toEqual(expect.any(Function));
        expect(vi.getTimerCount()).toBe(1);

        const overlappingFactory = vi.fn(async () => undefined);
        expect(harness.model.startCommand('other-type', 'other-command', overlappingFactory)).toBe(completion);
        expect(overlappingFactory).not.toHaveBeenCalled();

        command.resolve();
        await completion;
        expect(active).toMatchObject({
            child: null,
            commandPromise: null,
            deadlineTimer: null,
            finalized: true,
            killGraceTimer: null,
            resolveCompletion: null,
            settled: true,
            terminationGraceTimer: null,
        });
        expect(harness.model.activeHookCommand).toBeNull();
        expect(vi.getTimerCount()).toBe(0);

        for (const matches of [false, true]) {
            for (const settled of [false, true]) {
                for (const finalized of [false, true]) {
                    const stateHarness = makeCommandQueueHarness();
                    const fixture = makeLifecycleFixture(stateHarness, { finalized, settled });
                    if (matches === false) stateHarness.model.activeHookCommand = { other: true };
                    const expected = matches && settled === false && finalized === false;

                    expect(stateHarness.model.settle(fixture.active)).toBe(expected);
                    expect(fixture.active.settled).toBe(expected || settled);
                }
            }
        }

        const deadlineHarness = makeCommandQueueHarness({ hookCommandTimeoutMs: 17 });
        const timeoutCommand = vi.spyOn(deadlineHarness.model, 'timeoutCommand').mockImplementation(() => undefined);
        const pending = deferred<void>();
        deadlineHarness.model.startCommand('deadline-type', 'deadline-command', () => pending.promise);
        const deadlineActive = deadlineHarness.model.activeHookCommand;
        await vi.advanceTimersByTimeAsync(17);
        expect(deadlineActive.deadlineTimer).toBeNull();
        expect(timeoutCommand).toHaveBeenCalledOnce();
        expect(timeoutCommand).toHaveBeenCalledWith(deadlineActive);
    });

    it('[EH-IMP-QUEUE-CURRENT-FAILURE-ONLY] consumes only the current command failure and leaves stale failures inert', async () => {
        const harness = makeCommandQueueHarness();
        const failure = new Error('synthetic matrix command failure');
        const current = makeLifecycleFixture(harness);

        harness.model.failCommand(current.active, failure);
        expect(current.active).toMatchObject({ finalized: true, settled: true });
        expect(harness.logger.system.error.mock.calls).toEqual([
            [`execute cmd error: ${current.active.cmd}`],
            [failure],
        ]);
        await current.completion.promise;
        expect(current.completionResolutions()).toBe(1);
        expect(harness.model.activeHookCommand).toBeNull();

        const staleHarness = makeCommandQueueHarness();
        const stale = makeLifecycleFixture(staleHarness, { settled: true });
        const finalize = vi.spyOn(staleHarness.model, 'finalize');
        staleHarness.model.failCommand(stale.active, new Error('ignored duplicate failure'));
        expect(staleHarness.logger.system.error).not.toHaveBeenCalled();
        expect(finalize).not.toHaveBeenCalled();
        expect(stale.active.finalized).toBe(false);
    });

    it('[supporting lifecycle] finalizes once and releases each owned resource across the nullability matrix', async () => {
        const finalizedHarness = makeCommandQueueHarness();
        const alreadyFinalized = makeLifecycleFixture(finalizedHarness, { finalized: true });
        const clearFinalizedTimers = vi.spyOn(finalizedHarness.model, 'clearCommandTimers');
        const finalizedLog = vi.fn();
        finalizedHarness.model.finalize(alreadyFinalized.active, finalizedLog);
        await Promise.resolve();
        expect(clearFinalizedTimers).not.toHaveBeenCalled();
        expect(finalizedLog).not.toHaveBeenCalled();
        expect(alreadyFinalized.completionResolutions()).toBe(0);

        const noLogHarness = makeCommandQueueHarness();
        const noLog = makeLifecycleFixture(noLogHarness);
        const safeLog = vi.spyOn(noLogHarness.model, 'logSafely');
        noLogHarness.model.finalize(noLog.active);
        expect(noLog.active.finalized).toBe(true);
        expect(safeLog).not.toHaveBeenCalled();
        await noLog.completion.promise;
        expect(noLog.completionResolutions()).toBe(1);

        const child = new DeferredCommandChild(1_220);
        const exitListener = vi.fn();
        const errorListener = vi.fn();
        child.on('exit', exitListener);
        child.on('error', errorListener);
        const ownedHarness = makeCommandQueueHarness();
        const owned = makeLifecycleFixture(ownedHarness, {
            child,
            commandPromise: Promise.resolve(),
            errorListener,
            exitListener,
        });
        const resultLog = vi.fn();
        ownedHarness.model.finalize(owned.active, resultLog);
        expect(resultLog).toHaveBeenCalledOnce();
        expect(owned.active.finalized).toBe(true);
        expect(child.listeners('exit')).toContain(exitListener);
        await owned.completion.promise;
        expect(child.listeners('exit')).not.toContain(exitListener);
        expect(child.listeners('error')).not.toContain(errorListener);
        expect(owned.active).toMatchObject({
            child: null,
            commandPromise: null,
            errorListener: null,
            exitListener: null,
            resolveCompletion: null,
        });
        expect(owned.completionResolutions()).toBe(1);
        expect(ownedHarness.model.activeHookCommand).toBeNull();

        const releaseCases = [
            { child: null, errorListener, exitListener, expectedRemovals: 0 },
            { child, errorListener: null, exitListener: null, expectedRemovals: 0 },
            { child, errorListener: null, exitListener, expectedRemovals: 1 },
            { child, errorListener, exitListener: null, expectedRemovals: 1 },
        ];
        for (const releaseCase of releaseCases) {
            const harness = makeCommandQueueHarness();
            const fixture = makeLifecycleFixture(harness, releaseCase);
            const removeOwnedListener = vi.spyOn(harness.model, 'removeOwnedListener');
            harness.model.releaseCommand(fixture.active);
            expect(removeOwnedListener).toHaveBeenCalledTimes(releaseCase.expectedRemovals);
            expect(fixture.completionResolutions()).toBe(1);
        }

        const staleHarness = makeCommandQueueHarness();
        const stale = makeLifecycleFixture(staleHarness, { resolveCompletion: null });
        const replacement = { replacement: true };
        staleHarness.model.activeHookCommand = replacement;
        expect(() => staleHarness.model.releaseCommand(stale.active)).not.toThrow();
        expect(staleHarness.model.activeHookCommand).toBe(replacement);
        expect(stale.completionResolutions()).toBe(0);
    });

    it('[supporting lifecycle] clears null, successful, retry, and fallback timer paths with exact diagnostics', () => {
        const ownedHarness = makeCommandQueueHarness();
        const timers = [{ synthetic: 'deadline' }, { synthetic: 'termination' }, { synthetic: 'kill' }] as unknown as [
            NodeJS.Timeout,
            NodeJS.Timeout,
            NodeJS.Timeout,
        ];
        const owned = makeLifecycleFixture(ownedHarness, {
            deadlineTimer: timers[0],
            killGraceTimer: timers[2],
            terminationGraceTimer: timers[1],
        });
        const clearOwnedTimer = vi.spyOn(ownedHarness.model, 'clearOwnedTimer').mockImplementation(() => undefined);
        ownedHarness.model.clearCommandTimers(owned.active);
        expect(clearOwnedTimer.mock.calls).toEqual(timers.map(timerValue => [timerValue]));
        expect(owned.active).toMatchObject({
            deadlineTimer: null,
            killGraceTimer: null,
            terminationGraceTimer: null,
        });

        const nullHarness = makeCommandQueueHarness();
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
        nullHarness.model.clearOwnedTimer(null);
        expect(clearTimeoutSpy).not.toHaveBeenCalled();
        clearTimeoutSpy.mockRestore();

        const successHarness = makeCommandQueueHarness();
        const timer = { synthetic: 'timer' } as unknown as NodeJS.Timeout;
        const successfulClear = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined);
        successHarness.model.clearOwnedTimer(timer);
        expect(successfulClear).toHaveBeenCalledOnce();
        expect(successfulClear).toHaveBeenCalledWith(timer);
        expect(successHarness.logger.system.error).not.toHaveBeenCalled();
        successfulClear.mockRestore();

        const faultHarness = makeCommandQueueHarness();
        const clearFailure = new Error('synthetic clear failure');
        const retryFailure = new Error('synthetic clear retry failure');
        const fallbackFailure = new Error('synthetic interval fallback failure');
        let clearAttempts = 0;
        vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => {
            clearAttempts += 1;
            throw clearAttempts === 1 ? clearFailure : retryFailure;
        });
        vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {
            throw fallbackFailure;
        });

        expect(() => faultHarness.model.clearOwnedTimer(timer)).not.toThrow();
        expect(clearAttempts).toBe(2);
        expect(faultHarness.logger.system.error.mock.calls).toEqual([
            ['failed to clear hook command timer'],
            [clearFailure],
            [retryFailure],
            [fallbackFailure],
        ]);
    });

    it('[supporting lifecycle] removes an owned listener through the prototype fallback and isolates both failures', () => {
        const harness = makeCommandQueueHarness();
        const listener = vi.fn();
        const removeFailure = new Error('synthetic owned listener removal failure');
        const fallbackFailure = new Error('synthetic prototype listener removal failure');
        const child = {
            removeListener: vi.fn(() => {
                throw removeFailure;
            }),
        };
        vi.spyOn(EventEmitter.prototype, 'removeListener').mockImplementation(() => {
            throw fallbackFailure;
        });

        expect(() => harness.model.removeOwnedListener(child, 'error', listener)).not.toThrow();
        expect(child.removeListener).toHaveBeenCalledOnce();
        expect(child.removeListener).toHaveBeenCalledWith('error', listener);
        expect(harness.logger.system.error.mock.calls).toEqual([
            ['failed to remove hook command error listener'],
            [removeFailure],
            [fallbackFailure],
        ]);
    });

    it('[EH-IMP-QUEUE-TIMEOUT-DISPATCH-BOUNDARIES] dispatches timeout from every ownership and child-state boundary', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });

        const settledHarness = makeCommandQueueHarness();
        const settled = makeLifecycleFixture(settledHarness, { settled: true });
        const settledFinalize = vi.spyOn(settledHarness.model, 'finalize');
        settledHarness.model.timeoutCommand(settled.active);
        expect(settled.active.timedOut).toBe(false);
        expect(settledHarness.logger.system.error).not.toHaveBeenCalled();
        expect(settledFinalize).not.toHaveBeenCalled();

        const childlessHarness = makeCommandQueueHarness();
        const childless = makeLifecycleFixture(childlessHarness);
        const childlessSignal = vi.spyOn(childlessHarness.model, 'attemptSignal');
        childlessHarness.model.timeoutCommand(childless.active);
        expect(childless.active).toMatchObject({ finalized: true, settled: true, timedOut: true });
        expect(childlessHarness.logger.system.error.mock.calls).toEqual([
            [`hook command timed out: ${childless.active.cmd}`],
        ]);
        expect(childlessSignal).not.toHaveBeenCalled();
        await childless.completion.promise;

        const finalizedBySignalHarness = makeCommandQueueHarness();
        const finalizedBySignal = makeLifecycleFixture(finalizedBySignalHarness, {
            child: new DeferredCommandChild(1_250),
        });
        vi.spyOn(finalizedBySignalHarness.model, 'attemptSignal').mockImplementation(() => {
            finalizedBySignal.active.finalized = true;
        });
        const finalizedInspection = vi.spyOn(finalizedBySignalHarness.model, 'hasChildExited');
        finalizedBySignalHarness.model.timeoutCommand(finalizedBySignal.active);
        expect(finalizedInspection).not.toHaveBeenCalled();
        expect(finalizedBySignal.active.terminationGraceTimer).toBeNull();

        const exitedHarness = makeCommandQueueHarness();
        const exited = makeLifecycleFixture(exitedHarness, { child: new DeferredCommandChild(1_251) });
        vi.spyOn(exitedHarness.model, 'hasChildExited').mockReturnValue(true);
        const exitedFinalize = vi.spyOn(exitedHarness.model, 'finalize');
        exitedHarness.model.timeoutCommand(exited.active);
        expect(exited.active.sentSignals).toEqual(['SIGINT']);
        expect(exitedFinalize).toHaveBeenCalledOnce();
        await exited.completion.promise;

        const runningHarness = makeCommandQueueHarness();
        const running = makeLifecycleFixture(runningHarness, { child: new DeferredCommandChild(1_252) });
        vi.spyOn(runningHarness.model, 'hasChildExited').mockReturnValue(false);
        const finishTerminationGrace = vi
            .spyOn(runningHarness.model, 'finishTerminationGrace')
            .mockImplementation(() => undefined);
        runningHarness.model.timeoutCommand(running.active);
        expect(running.active.sentSignals).toEqual(['SIGINT']);
        expect(running.active.terminationGraceTimer).not.toBeNull();
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(2_999);
        expect(finishTerminationGrace).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(finishTerminationGrace).toHaveBeenCalledOnce();
        expect(running.active.terminationGraceTimer).toBeNull();
    });

    it('[EH-IMP-QUEUE-TERMINATION-GRACE-ESCALATION] escalates termination grace across identity, exit, signal, and timer outcomes', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const guardStates = [
            { finalized: false, matches: false },
            { finalized: true, matches: true },
            { finalized: true, matches: false },
        ];
        for (const state of guardStates) {
            const harness = makeCommandQueueHarness();
            const fixture = makeLifecycleFixture(harness, {
                child: new DeferredCommandChild(1_260),
                finalized: state.finalized,
                settled: true,
            });
            if (state.matches === false) harness.model.activeHookCommand = { replacement: true };
            const inspect = vi.spyOn(harness.model, 'hasChildExited');
            const signal = vi.spyOn(harness.model, 'attemptSignal');
            harness.model.finishTerminationGrace(fixture.active);
            expect(inspect).not.toHaveBeenCalled();
            expect(signal).not.toHaveBeenCalled();
        }

        const exitedHarness = makeCommandQueueHarness();
        const exited = makeLifecycleFixture(exitedHarness, {
            child: new DeferredCommandChild(1_261),
            settled: true,
        });
        vi.spyOn(exitedHarness.model, 'hasChildExited').mockReturnValue(true);
        const exitedFinalize = vi.spyOn(exitedHarness.model, 'finalize');
        exitedHarness.model.finishTerminationGrace(exited.active);
        expect(exitedFinalize).toHaveBeenCalledOnce();
        expect(exited.active.sentSignals).toEqual([]);
        await exited.completion.promise;

        const signalFinalizedHarness = makeCommandQueueHarness();
        const signalFinalized = makeLifecycleFixture(signalFinalizedHarness, {
            child: new DeferredCommandChild(1_262),
            settled: true,
        });
        const signalInspection = vi.spyOn(signalFinalizedHarness.model, 'hasChildExited').mockReturnValue(false);
        vi.spyOn(signalFinalizedHarness.model, 'attemptSignal').mockImplementation(() => {
            signalFinalized.active.sentSignals.push('SIGKILL');
            signalFinalized.active.finalized = true;
        });
        signalFinalizedHarness.model.finishTerminationGrace(signalFinalized.active);
        expect(signalInspection).toHaveBeenCalledOnce();
        expect(signalFinalized.active.sentSignals).toEqual(['SIGKILL']);
        expect(signalFinalized.active.killGraceTimer).toBeNull();

        const exitsAfterSignalHarness = makeCommandQueueHarness();
        const exitsAfterSignal = makeLifecycleFixture(exitsAfterSignalHarness, {
            child: new DeferredCommandChild(1_263),
            settled: true,
        });
        vi.spyOn(exitsAfterSignalHarness.model, 'hasChildExited').mockReturnValueOnce(false).mockReturnValueOnce(true);
        const afterSignalFinalize = vi.spyOn(exitsAfterSignalHarness.model, 'finalize');
        exitsAfterSignalHarness.model.finishTerminationGrace(exitsAfterSignal.active);
        expect(exitsAfterSignal.active.sentSignals).toEqual(['SIGKILL']);
        expect(afterSignalFinalize).toHaveBeenCalledOnce();
        expect(exitsAfterSignal.active.killGraceTimer).toBeNull();
        await exitsAfterSignal.completion.promise;

        const runningHarness = makeCommandQueueHarness();
        const running = makeLifecycleFixture(runningHarness, {
            child: new DeferredCommandChild(1_264),
            settled: true,
        });
        vi.spyOn(runningHarness.model, 'hasChildExited').mockReturnValue(false);
        const finishKillGrace = vi.spyOn(runningHarness.model, 'finishKillGrace').mockImplementation(() => undefined);
        runningHarness.model.finishTerminationGrace(running.active);
        expect(running.active.sentSignals).toEqual(['SIGKILL']);
        expect(running.active.killGraceTimer).not.toBeNull();
        await vi.advanceTimersByTimeAsync(2_999);
        expect(finishKillGrace).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(finishKillGrace).toHaveBeenCalledOnce();
        expect(running.active.killGraceTimer).toBeNull();
    });

    it('[EH-IMP-QUEUE-FORCED-RELEASE-CURRENT-CHILD] forces release only for the current unexited child and records the full identity', async () => {
        const guardStates = [
            { finalized: false, matches: false },
            { finalized: true, matches: true },
            { finalized: true, matches: false },
        ];
        for (const state of guardStates) {
            const harness = makeCommandQueueHarness();
            const fixture = makeLifecycleFixture(harness, {
                finalized: state.finalized,
                settled: true,
            });
            if (state.matches === false) harness.model.activeHookCommand = { replacement: true };
            const inspect = vi.spyOn(harness.model, 'hasChildExited');
            const finalize = vi.spyOn(harness.model, 'finalize');
            harness.model.finishKillGrace(fixture.active);
            expect(inspect).not.toHaveBeenCalled();
            expect(finalize).not.toHaveBeenCalled();
            expect(harness.logger.system.error).not.toHaveBeenCalled();
        }

        const exitedHarness = makeCommandQueueHarness();
        const exited = makeLifecycleFixture(exitedHarness, {
            child: new DeferredCommandChild(1_270),
            settled: true,
        });
        vi.spyOn(exitedHarness.model, 'hasChildExited').mockReturnValue(true);
        exitedHarness.model.finishKillGrace(exited.active);
        expect(exitedHarness.logger.system.error).not.toHaveBeenCalled();
        await exited.completion.promise;

        const unknownHarness = makeCommandQueueHarness();
        const unknown = makeLifecycleFixture(unknownHarness, {
            child: null,
            commandType: 'unknown-pid-type',
            sentSignals: ['SIGINT', 'SIGKILL'],
            settled: true,
        });
        vi.spyOn(unknownHarness.model, 'hasChildExited').mockReturnValue(false);
        unknownHarness.model.finishKillGrace(unknown.active);
        expect(unknownHarness.logger.system.error.mock.calls).toEqual([
            [
                'hook command termination-unconfirmed forced-release: ' +
                    'type=unknown-pid-type pid=unknown signals=SIGINT,SIGKILL',
            ],
        ]);
        await unknown.completion.promise;
        expect(unknown.completionResolutions()).toBe(1);
    });

    it('[EH-IMP-QUEUE-SIGNAL-ATTEMPT-CONTAINMENT] attempts a finite signal and contains kill and child-state inspection failures', () => {
        const childlessHarness = makeCommandQueueHarness();
        const childless = makeLifecycleFixture(childlessHarness, { child: null });
        childlessHarness.model.attemptSignal(childless.active, 'SIGINT');
        expect(childless.active.sentSignals).toEqual([]);
        expect(childlessHarness.logger.system.error).not.toHaveBeenCalled();

        const successHarness = makeCommandQueueHarness();
        const successChild = new DeferredCommandChild(1_280);
        const success = makeLifecycleFixture(successHarness, { child: successChild });
        successHarness.model.attemptSignal(success.active, 'SIGKILL');
        expect(success.active.sentSignals).toEqual(['SIGKILL']);
        expect(successChild.kill).toHaveBeenCalledOnce();
        expect(successChild.kill).toHaveBeenCalledWith('SIGKILL');
        expect(successHarness.logger.system.error).not.toHaveBeenCalled();

        const failureHarness = makeCommandQueueHarness();
        const killFailure = new Error('synthetic matrix kill failure');
        const failureChild = { kill: vi.fn(() => void 0), pid: undefined };
        failureChild.kill.mockImplementation(() => {
            throw killFailure;
        });
        const failure = makeLifecycleFixture(failureHarness, { child: failureChild });
        failureHarness.model.attemptSignal(failure.active, 'SIGINT');
        expect(failure.active.sentSignals).toEqual(['SIGINT']);
        expect(failureHarness.logger.system.error.mock.calls).toEqual([
            [`hook command signal attempt failed: type=${failure.active.commandType} ` + 'pid=unknown signal=SIGINT'],
            [killFailure],
        ]);

        const inspectHarness = makeCommandQueueHarness();
        const inspect = makeLifecycleFixture(inspectHarness, { child: null });
        const isExited = vi.spyOn(ProcessUtil, 'isExited');
        expect(inspectHarness.model.hasChildExited(inspect.active)).toBe(false);
        expect(isExited).not.toHaveBeenCalled();

        const inspectedChild = new DeferredCommandChild(1_281);
        inspect.active.child = inspectedChild;
        isExited.mockReturnValueOnce(false).mockReturnValueOnce(true);
        expect(inspectHarness.model.hasChildExited(inspect.active)).toBe(false);
        expect(inspectHarness.model.hasChildExited(inspect.active)).toBe(true);
        expect(isExited).toHaveBeenCalledTimes(2);

        const inspectFailure = new Error('synthetic matrix child inspection failure');
        isExited.mockImplementation(() => {
            throw inspectFailure;
        });
        expect(inspectHarness.model.hasChildExited(inspect.active)).toBe(false);
        expect(inspectHarness.logger.system.error.mock.calls).toEqual([
            ['failed to inspect hook command child state'],
            [inspectFailure],
        ]);

        inspect.active.finalized = false;
        expect(inspectHarness.model.isCommandFinalized(inspect.active)).toBe(false);
        inspect.active.finalized = true;
        expect(inspectHarness.model.isCommandFinalized(inspect.active)).toBe(true);
    });

    it('[EH-IMP-QUEUE-PREPARATION-RECOGNITION] recognizes preparation only for the current unsettled active and supervises one child', () => {
        const stateHarness = makeCommandQueueHarness();
        expect(stateHarness.model.getPreparingCommand()).toBeNull();

        const preparing = makeLifecycleFixture(stateHarness);
        expect(stateHarness.model.getPreparingCommand()).toBe(preparing.active);
        expect(stateHarness.model.isPreparingCommand(preparing.active)).toBe(true);

        const replacement = makeLifecycleFixture(makeCommandQueueHarness()).active;
        expect(stateHarness.model.isPreparingCommand(replacement)).toBe(false);
        preparing.active.settled = true;
        expect(stateHarness.model.getPreparingCommand()).toBeNull();
        expect(stateHarness.model.isPreparingCommand(preparing.active)).toBe(false);
        preparing.active.finalized = true;
        expect(stateHarness.model.getPreparingCommand()).toBeNull();

        const rejectedHarness = makeCommandQueueHarness();
        const rejected = makeLifecycleFixture(rejectedHarness, { settled: true });
        const rejectedChild = new DeferredCommandChild(1_290);
        expect(
            rejectedHarness.model.superviseChild(rejected.active, rejectedChild, 'rejected-command', 'reserve'),
        ).toBe(rejected.active.completion);
        expect(rejected.active.child).toBeNull();
        expect(rejectedChild.listenerCount('exit')).toBe(0);
        expect(rejectedChild.listenerCount('error')).toBe(0);

        const supervisedHarness = makeCommandQueueHarness();
        const supervised = makeLifecycleFixture(supervisedHarness);
        const child = new DeferredCommandChild(1_291);
        const finishFromChildExit = vi.spyOn(supervisedHarness.model, 'finishFromChildExit');
        const isExited = vi.spyOn(ProcessUtil, 'isExited').mockReturnValue(false);
        expect(supervisedHarness.model.superviseChild(supervised.active, child, 'live-command', 'recorded')).toBe(
            supervised.active.completion,
        );
        expect(supervised.active.child).toBe(child);
        expect(supervised.active.exitListener).toEqual(expect.any(Function));
        expect(supervised.active.errorListener).toEqual(expect.any(Function));
        expect(child.listeners('exit')).toContain(supervised.active.exitListener);
        expect(child.listeners('error')).toContain(supervised.active.errorListener);
        expect(finishFromChildExit).not.toHaveBeenCalled();

        const immediateHarness = makeCommandQueueHarness();
        const immediate = makeLifecycleFixture(immediateHarness);
        const immediateChild = new DeferredCommandChild(1_292);
        immediateChild.exitCode = 0;
        isExited.mockReturnValue(true);
        const immediateExit = vi
            .spyOn(immediateHarness.model, 'finishFromChildExit')
            .mockImplementation(() => undefined);
        immediateHarness.model.superviseChild(immediate.active, immediateChild, 'immediate-command', 'encoding');
        expect(immediateExit).toHaveBeenCalledOnce();
        expect(immediateExit).toHaveBeenCalledWith(immediate.active, 'immediate-command', 'encoding', true);
    });

    it('[EH-IMP-QUEUE-CHILD-EXIT-TERMINAL-BRANCH] selects one child-exit terminal branch before finalization', async () => {
        const finalizedHarness = makeCommandQueueHarness();
        const finalized = makeLifecycleFixture(finalizedHarness, { finalized: true, settled: true });
        const finalizedSettle = vi.spyOn(finalizedHarness.model, 'settle');
        finalizedHarness.model.finishFromChildExit(finalized.active, 'finalized-command', 'reserve', false);
        expect(finalizedSettle).not.toHaveBeenCalled();

        const timeoutHarness = makeCommandQueueHarness();
        const timeout = makeLifecycleFixture(timeoutHarness, { settled: true, timedOut: true });
        const timeoutLog = vi.spyOn(timeoutHarness.model, 'logChildExit');
        timeoutHarness.model.finishFromChildExit(timeout.active, 'timeout-command', 'reserve', false);
        expect(timeoutLog).not.toHaveBeenCalled();
        await timeout.completion.promise;
        expect(timeout.active.finalized).toBe(true);

        const duplicateHarness = makeCommandQueueHarness();
        const duplicate = makeLifecycleFixture(duplicateHarness);
        vi.spyOn(duplicateHarness.model, 'settle').mockReturnValue(false);
        const duplicateFinalize = vi.spyOn(duplicateHarness.model, 'finalize');
        duplicateHarness.model.finishFromChildExit(duplicate.active, 'duplicate-command', 'reserve', false);
        expect(duplicateFinalize).not.toHaveBeenCalled();

        const normalHarness = makeCommandQueueHarness();
        const child = new DeferredCommandChild(1_300);
        child.exitCode = 0;
        const normal = makeLifecycleFixture(normalHarness, { child });
        normalHarness.model.finishFromChildExit(normal.active, 'normal-command', 'reserve', false);
        await normal.completion.promise;
        expect(normal.active).toMatchObject({ finalized: true, settled: true });
        expect(normalHarness.logger.system.info.mock.calls).toEqual([['finish: normal-command']]);
        expect(normalHarness.logger.system.error).not.toHaveBeenCalled();
    });

    it('[EH-IMP-QUEUE-CHILD-ERROR-PROFILES] selects timeout, duplicate, reserve, and process child-error profiles exactly', async () => {
        const error = new Error('synthetic matrix child error');
        const finalizedHarness = makeCommandQueueHarness();
        const finalized = makeLifecycleFixture(finalizedHarness, { finalized: true, settled: true });
        finalizedHarness.model.finishFromChildError(finalized.active, 'finalized-command', 'reserve', error);
        expect(finalizedHarness.logger.system.error).not.toHaveBeenCalled();

        for (const [exited, child] of [
            [false, null],
            [false, { exitCode: null, pid: undefined }],
            [true, { exitCode: 1, pid: undefined }],
        ] as const) {
            const harness = makeCommandQueueHarness();
            const fixture = makeLifecycleFixture(harness, {
                child,
                settled: true,
                timedOut: true,
            });
            vi.spyOn(harness.model, 'hasChildExited').mockReturnValue(exited);
            const finalize = vi.spyOn(harness.model, 'finalize');
            harness.model.finishFromChildError(fixture.active, 'timeout-error-command', 'recorded', error);
            expect(harness.logger.system.error.mock.calls).toEqual([
                ['hook command child error after timeout: type=synthetic-lifecycle-type pid=unknown'],
                [error],
            ]);
            expect(finalize).toHaveBeenCalledTimes(exited ? 1 : 0);
            if (exited) await fixture.completion.promise;
        }

        const duplicateHarness = makeCommandQueueHarness();
        const duplicate = makeLifecycleFixture(duplicateHarness);
        vi.spyOn(duplicateHarness.model, 'settle').mockReturnValue(false);
        const duplicateFinalize = vi.spyOn(duplicateHarness.model, 'finalize');
        duplicateHarness.model.finishFromChildError(duplicate.active, 'duplicate-command', 'reserve', error);
        expect(duplicateFinalize).not.toHaveBeenCalled();
        expect(duplicateHarness.logger.system.error).not.toHaveBeenCalled();

        const profiles = [
            {
                expected: [['failed: reserve-error-command'], [error]],
                profile: 'reserve',
            },
            {
                expected: [['recorded-error-command process is error'], [String(error)]],
                profile: 'recorded',
            },
            {
                expected: [['encoding-error-command process is error'], [String(error)]],
                profile: 'encoding',
            },
        ] as const;
        for (const profile of profiles) {
            const harness = makeCommandQueueHarness();
            const fixture = makeLifecycleFixture(harness);
            harness.model.finishFromChildError(
                fixture.active,
                `${profile.profile}-error-command`,
                profile.profile,
                error,
            );
            await fixture.completion.promise;
            expect(harness.logger.system.error.mock.calls).toEqual(profile.expected);
        }
    });

    it('[EH-IMP-QUEUE-EXIT-LOG-TRUTH-TABLE] emits the complete immediate and profile exit-log truth table', () => {
        const cases = [
            {
                code: 0,
                expectedLevel: 'info',
                expectedMessage: 'finish: matrix-log-command',
                immediate: true,
                profile: 'reserve',
            },
            {
                code: 9,
                expectedLevel: 'error',
                expectedMessage: 'failed: matrix-log-command',
                immediate: true,
                profile: 'encoding',
            },
            {
                code: 0,
                expectedLevel: 'info',
                expectedMessage: 'finish: matrix-log-command',
                immediate: false,
                profile: 'reserve',
            },
            {
                code: 9,
                expectedLevel: 'error',
                expectedMessage: 'failed: matrix-log-command. exit: 9',
                immediate: false,
                profile: 'reserve',
            },
            {
                code: 0,
                expectedLevel: 'info',
                expectedMessage: 'matrix-log-command process is fin',
                immediate: false,
                profile: 'recorded',
            },
            {
                code: 9,
                expectedLevel: 'error',
                expectedMessage: 'matrix-log-command process is error. exit: 9',
                immediate: false,
                profile: 'recorded',
            },
            {
                code: 0,
                expectedLevel: 'info',
                expectedMessage: 'matrix-log-command process is fin',
                immediate: false,
                profile: 'encoding',
            },
            {
                code: null,
                expectedLevel: 'error',
                expectedMessage: 'matrix-log-command process is error. exit: undefined',
                immediate: false,
                profile: 'encoding',
            },
        ] as const;
        for (const testCase of cases) {
            const harness = makeCommandQueueHarness();
            const child =
                testCase.code === null
                    ? null
                    : Object.assign(new DeferredCommandChild(1_310), { exitCode: testCase.code });
            const fixture = makeLifecycleFixture(harness, { child });
            harness.model.logChildExit(fixture.active, 'matrix-log-command', testCase.profile, testCase.immediate);
            expect(harness.logger.system[testCase.expectedLevel].mock.calls).toEqual([[testCase.expectedMessage]]);
            const otherLevel = testCase.expectedLevel === 'info' ? 'error' : 'info';
            expect(harness.logger.system[otherLevel]).not.toHaveBeenCalled();
        }
    });

    it('[EH-IMP-QUEUE-PREPARATION-SPAWN-PROFILES] rejects command preparation without an active and preserves each spawn profile', async () => {
        const inactiveHarness = makeCommandQueueHarness();
        const parse = vi.spyOn(ProcessUtil, 'parseCmdStr');
        await inactiveHarness.model.createReserveCmd(commandFor(hookFamilies[3].label), hookFamilies[3].makePayload());
        await inactiveHarness.model.createRecordedCmd(commandFor(hookFamilies[5].label), hookFamilies[5].makePayload());
        await inactiveHarness.model.createFinishEncodeCmd(
            commandFor(hookFamilies[8].label),
            hookFamilies[8].makePayload(),
        );
        expect(parse).not.toHaveBeenCalled();
        expect(inactiveHarness.channelDB.findId).not.toHaveBeenCalled();
        expect(inactiveHarness.recordedDB.findId).not.toHaveBeenCalled();
        expect(processStubs.spawn).not.toHaveBeenCalled();

        const profileCases = [
            {
                invoke: (harness: CommandHarness) =>
                    harness.model.createReserveCmd(commandFor(hookFamilies[3].label), hookFamilies[3].makePayload()),
                profile: 'reserve',
            },
            {
                invoke: (harness: CommandHarness) =>
                    harness.model.createRecordedCmd(commandFor(hookFamilies[5].label), hookFamilies[5].makePayload()),
                profile: 'recorded',
            },
            {
                invoke: (harness: CommandHarness) =>
                    harness.model.createFinishEncodeCmd(
                        commandFor(hookFamilies[8].label),
                        hookFamilies[8].makePayload(),
                    ),
                profile: 'encoding',
            },
        ] as const;
        for (const profileCase of profileCases) {
            processStubs.spawn.mockReset();
            const harness = makeCommandQueueHarness();
            const fixture = makeLifecycleFixture(harness);
            const child = new DeferredCommandChild(1_330);
            processStubs.spawn.mockReturnValue(child);
            const supervise = vi.spyOn(harness.model, 'superviseChild').mockResolvedValue(undefined);

            await profileCase.invoke(harness);

            expect(processStubs.spawn).toHaveBeenCalledOnce();
            expect(supervise).toHaveBeenCalledOnce();
            expect(supervise.mock.calls[0][0]).toBe(fixture.active);
            expect(supervise.mock.calls[0][1]).toBe(child);
            expect(supervise.mock.calls[0][3]).toBe(profileCase.profile);
        }
    });

    it('[EH-IMP-QUEUE-LATE-PREPARATION-FENCES] fences every late asynchronous preparation boundary before spawn', async () => {
        interface BoundaryCase {
            readonly assertMaskedSideEffects?: (harness: CommandHarness) => void;
            readonly install: (
                harness: CommandHarness,
                gate: ReturnType<typeof deferred<any>>,
            ) => ReturnType<typeof vi.fn>;
            readonly invoke: (harness: CommandHarness) => Promise<void>;
            readonly label: string;
            readonly resolveValue: (harness: CommandHarness) => unknown;
        }
        const cases: readonly BoundaryCase[] = [
            {
                install: (harness, gate) => harness.channelDB.findId.mockImplementationOnce(() => gate.promise),
                invoke: harness =>
                    harness.model.createReserveCmd(commandFor(hookFamilies[3].label), hookFamilies[3].makePayload()),
                label: 'reserve channel',
                resolveValue: () => null,
            },
            {
                assertMaskedSideEffects: harness => {
                    expect(harness.videoUtil.getFullFilePathFromId).not.toHaveBeenCalled();
                },
                install: (harness, gate) => harness.channelDB.findId.mockImplementationOnce(() => gate.promise),
                invoke: harness =>
                    harness.model.createRecordedCmd(commandFor(hookFamilies[5].label), hookFamilies[5].makePayload()),
                label: 'recorded channel',
                resolveValue: () => null,
            },
            {
                install: (harness, gate) =>
                    harness.videoUtil.getFullFilePathFromId.mockImplementationOnce(() => gate.promise),
                invoke: harness =>
                    harness.model.createRecordedCmd(commandFor(hookFamilies[5].label), hookFamilies[5].makePayload()),
                label: 'recorded path',
                resolveValue: () => 'late-recorded-path',
            },
            {
                assertMaskedSideEffects: harness => {
                    expect(harness.channelDB.findId).not.toHaveBeenCalled();
                },
                install: (harness, gate) => harness.recordedDB.findId.mockImplementationOnce(() => gate.promise),
                invoke: harness =>
                    harness.model.createFinishEncodeCmd(
                        commandFor(hookFamilies[8].label),
                        hookFamilies[8].makePayload(),
                    ),
                label: 'encoding recorded',
                resolveValue: harness => harness.encodedRecorded,
            },
            {
                assertMaskedSideEffects: harness => {
                    expect(harness.videoUtil.getFullFilePathFromId).not.toHaveBeenCalled();
                },
                install: (harness, gate) => harness.channelDB.findId.mockImplementationOnce(() => gate.promise),
                invoke: harness =>
                    harness.model.createFinishEncodeCmd(
                        commandFor(hookFamilies[8].label),
                        hookFamilies[8].makePayload(),
                    ),
                label: 'encoding channel',
                resolveValue: () => ({
                    channelType: 'BS',
                    halfWidthName: 'late-half-channel',
                    name: 'late-channel',
                }),
            },
            {
                install: (harness, gate) =>
                    harness.videoUtil.getFullFilePathFromId.mockImplementationOnce(() => gate.promise),
                invoke: harness =>
                    harness.model.createFinishEncodeCmd(
                        commandFor(hookFamilies[8].label),
                        hookFamilies[8].makePayload(),
                    ),
                label: 'encoding output path',
                resolveValue: () => 'late-output-path',
            },
        ];

        for (const testCase of cases) {
            processStubs.spawn.mockReset();
            const harness = makeCommandQueueHarness();
            const fixture = makeLifecycleFixture(harness);
            const gate = deferred<any>();
            const gatedMock = testCase.install(harness, gate);
            processStubs.spawn.mockReturnValue(new DeferredCommandChild(1_340));
            const supervise = vi.spyOn(harness.model, 'superviseChild').mockResolvedValue(undefined);

            const preparation = testCase.invoke(harness);
            await waitFor(() => gatedMock.mock.calls.length === 1, `${testCase.label} boundary did not start`);
            expect(gatedMock, testCase.label).toHaveBeenCalledOnce();
            fixture.active.settled = true;
            gate.resolve(testCase.resolveValue(harness));
            await preparation;

            expect(processStubs.spawn, testCase.label).not.toHaveBeenCalled();
            expect(supervise, testCase.label).not.toHaveBeenCalled();
            testCase.assertMaskedSideEffects?.(harness);
        }
    });

    it('[EH-IMP-QUEUE-EMPTY-VIDEO-FILE-NULL-PATH] maps an empty recorded video-file array to a null path without a lookup', async () => {
        const harness = makeCommandQueueHarness();
        const fixture = makeLifecycleFixture(harness);
        const child = new DeferredCommandChild(1_341);
        const recorded = hookFamilies[5].makePayload();
        recorded.videoFiles = [];
        processStubs.spawn.mockReturnValue(child);
        const supervise = vi.spyOn(harness.model, 'superviseChild').mockResolvedValue(undefined);

        await harness.model.createRecordedCmd(commandFor(hookFamilies[5].label), recorded);

        expect(harness.channelDB.findId).toHaveBeenCalledOnce();
        expect(harness.videoUtil.getFullFilePathFromId).not.toHaveBeenCalled();
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(processStubs.spawn.mock.calls[0][2].env.RECPATH).toBeNull();
        expect(supervise).toHaveBeenCalledWith(fixture.active, child, commandFor(hookFamilies[5].label), 'recorded');
    });

    it('[EH-IMP-QUEUE-ENCODING-DOMAIN-FAILURES] preserves exact encoding domain failures before spawn', async () => {
        const cases = [
            {
                configure: (harness: CommandHarness) => harness.recordedDB.findId.mockResolvedValue(null),
                message: 'RecordedIsNotFound',
            },
            {
                configure: (harness: CommandHarness) => harness.channelDB.findId.mockResolvedValue(null),
                message: 'ChannelIsNotFound',
            },
        ];
        for (const testCase of cases) {
            processStubs.spawn.mockReset();
            const harness = makeCommandQueueHarness();
            makeLifecycleFixture(harness);
            testCase.configure(harness);

            await expect(
                harness.model.createFinishEncodeCmd(commandFor(hookFamilies[8].label), hookFamilies[8].makePayload()),
            ).rejects.toThrow(testCase.message);
            expect(processStubs.spawn).not.toHaveBeenCalled();
        }
    });
});
