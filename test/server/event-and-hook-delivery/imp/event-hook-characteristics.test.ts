import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
    deferred,
    ExternalCommandManageModel,
    flushImmediate,
    makeLogger,
    makeRecorded,
    makeReserve,
    makeSetter,
    PromiseQueue,
} from '../_harness';
import {
    DeferredCommandChild,
    getExternalCommandManageModelCtor,
    installSpawnStub,
    makeCommandQueueHarness,
    processStubs,
    resetCommandHarness,
    restoreSpawnStub,
    waitFor,
} from '../external-command-test-harness';

interface ConfigurationRuntime {
    config: Record<string, unknown>;
    formatConfig(config: Record<string, unknown>): Record<string, unknown>;
    getConfig(): Record<string, unknown>;
    log: { system: { fatal: ReturnType<typeof vi.fn> } };
    templateConfig: Record<string, unknown> | null;
}

interface ConfigurationConstructor {
    readonly prototype: object;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const Configuration = (
    require(join(compiledSnapshot, 'model', 'Configuration.js')) as { default: ConfigurationConstructor }
).default;

const formatThroughConfigurationProvider = (overrides: Record<string, unknown>): ConfigurationRuntime => {
    const provider = Object.create(Configuration.prototype) as ConfigurationRuntime;
    provider.log = { system: { fatal: vi.fn() } };
    provider.templateConfig = null;
    provider.config = provider.formatConfig({ port: 48_100, ...overrides });
    return provider;
};

const makeModel = (config: Record<string, unknown>, queue: { add: ReturnType<typeof vi.fn> } = { add: vi.fn() }) => {
    const configSource = { hookCommandMaxPending: 64, hookCommandTimeoutMs: 300_000, ...config };
    const getConfig = vi.fn(() => ({ ...configSource }));
    const logger = makeLogger();
    const model = new ExternalCommandManageModel(
        { getLogger: () => logger },
        { getConfig },
        queue,
        { findId: vi.fn() },
        { findId: vi.fn() },
        { getFullFilePathFromId: vi.fn() },
    );
    return { configSource, getConfig, logger, model, queue };
};

const makeModelFromConfigurationProvider = (provider: ConfigurationRuntime) => {
    const logger = makeLogger();
    const queue = new PromiseQueue();
    const queueAdd = vi.spyOn(queue, 'add');
    const model = new (getExternalCommandManageModelCtor())(
        { getLogger: () => logger },
        { getConfig: () => provider.getConfig() },
        queue,
        { findId: vi.fn(async () => ({ halfWidthName: 'synthetic-half-channel', name: 'synthetic-channel' })) },
        { findId: vi.fn() },
        { getFullFilePathFromId: vi.fn() },
    );
    return { logger, model, queueAdd };
};

const reservationFamilies = [
    ['reservation insert', 'reserveNewAddtionCommand', 'insert'],
    ['reservation update', 'reserveUpdateCommand', 'update'],
    ['reservation delete', 'reservedeletedCommand', 'delete'],
] as const;
const recordingFamilies = [
    ['preparation start', 'recordingPreStartCommand', 'addRecordingPrepStartCmd', 'reserve'],
    ['preparation cancel/failure', 'recordingPrepRecFailedCommand', 'addRecordingPrepRecFailedCmd', 'reserve'],
    ['recording start', 'recordingStartCommand', 'addRecordingStartCmd', 'recorded'],
    ['recording failure', 'recordingFailedCommand', 'addRecordingFailedCmd', 'recorded'],
    ['recording finish', 'recordingFinishCommand', 'addRecordingFinishCmd', 'recorded'],
] as const;
const encodingFamily = ['encoding finish', 'encodingFinishCommand', 'addEncodingFinishCmd', 'encode'] as const;
const encodingInfo = () => ({ recordedId: 31, videoFileId: 41, mode: 'synthetic-mode' });
const acceptanceFamilies = [
    [
        'reservation insert',
        'reserveNewAddtionCommand',
        'addUpdateReseves',
        () => ({ insert: [makeReserve({ id: 31 })], isSuppressLog: false }),
        'createReserveCmd',
    ],
    [
        'reservation update',
        'reserveUpdateCommand',
        'addUpdateReseves',
        () => ({ update: [makeReserve({ id: 32 })], isSuppressLog: false }),
        'createReserveCmd',
    ],
    [
        'reservation delete',
        'reservedeletedCommand',
        'addUpdateReseves',
        () => ({ delete: [makeReserve({ id: 33 })], isSuppressLog: false }),
        'createReserveCmd',
    ],
    [
        'preparation start',
        'recordingPreStartCommand',
        'addRecordingPrepStartCmd',
        () => makeReserve(),
        'createReserveCmd',
    ],
    [
        'preparation cancel/failure',
        'recordingPrepRecFailedCommand',
        'addRecordingPrepRecFailedCmd',
        () => makeReserve(),
        'createReserveCmd',
    ],
    ['recording start', 'recordingStartCommand', 'addRecordingStartCmd', () => makeRecorded(), 'createRecordedCmd'],
    ['recording failure', 'recordingFailedCommand', 'addRecordingFailedCmd', () => makeRecorded(), 'createRecordedCmd'],
    ['recording finish', 'recordingFinishCommand', 'addRecordingFinishCmd', () => makeRecorded(), 'createRecordedCmd'],
    ['encoding finish', 'encodingFinishCommand', 'addEncodingFinishCmd', encodingInfo, 'createFinishEncodeCmd'],
] as const;

const lifecycleProfiles = [
    {
        deadlineMs: 10,
        expectedSignals: [],
        label: 'deadline minus one exits before the timer',
        maxPending: 2,
        terminal: 'exit',
        terminalExitCode: 0,
        timeToTerminalMs: 9,
    },
    {
        deadlineMs: 10,
        expectedSignals: [],
        label: 'same-deadline exit is delivered before the timer callback',
        maxPending: 2,
        sameTickExitFirst: true,
        terminal: 'exit',
        terminalExitCode: 0,
        timeToTerminalMs: 0,
    },
    {
        deadlineMs: 10,
        expectedSignals: ['SIGINT'],
        label: 'same-deadline timer callback runs before exit',
        maxPending: 2,
        terminal: 'exit',
        terminalExitCode: 130,
        timeToTerminalMs: 10,
    },
    {
        deadlineMs: 10,
        expectedSignals: ['SIGINT', 'SIGKILL'],
        label: 'deadline then SIGINT grace then SIGKILL then child exit',
        maxPending: 2,
        terminal: 'exit',
        terminalExitCode: 137,
        timeToTerminalMs: 3_010,
    },
    {
        deadlineMs: 10,
        expectedSignals: ['SIGINT'],
        label: 'deadline plus one error and exit pair releases once',
        maxPending: 2,
        terminal: 'error-then-exit',
        terminalExitCode: 1,
        timeToTerminalMs: 11,
    },
    {
        deadlineMs: 1,
        expectedSignals: ['SIGINT'],
        label: 'minimum validated deadline fires through the public entry',
        maxPending: 1,
        terminal: 'exit',
        terminalExitCode: 130,
        timeToTerminalMs: 1,
    },
    {
        deadlineMs: 2_147_483_647,
        expectedSignals: [],
        label: 'maximum validated deadline is snapshotted without clamping',
        maxPending: 10_000,
        terminal: 'exit',
        terminalExitCode: 0,
        timeToTerminalMs: 0,
    },
] as const;

beforeAll(() => installSpawnStub());
afterEach(() => {
    resetCommandHarness();
    vi.clearAllTimers();
    vi.useRealTimers();
});
afterAll(() => restoreSpawnStub());

describe('legacy external hook selector characterization', () => {
    it.each(reservationFamilies)(
        '[supporting selector] selects exact configured command and preserves entity order for %s',
        (_label, key, collection) => {
            const harness = makeModel({ [key]: `synthetic-${collection}-command` });
            const first = makeReserve({ id: 11 });
            const second = makeReserve({ id: 12 });
            harness.model.addReserve = vi.fn();

            harness.model.addUpdateReseves({ [collection]: [first, second], isSuppressLog: false });

            expect(harness.model.addReserve.mock.calls).toEqual([
                [`synthetic-${collection}-command`, first],
                [`synthetic-${collection}-command`, second],
            ]);
            expect(harness.queue.add).not.toHaveBeenCalled();
        },
    );

    it.each(recordingFamilies)(
        '[supporting selector] selects exact configured command and payload for %s',
        (_label, key, method, payloadKind) => {
            const harness = makeModel({ [key]: `synthetic-${method}-command` });
            const payload = payloadKind === 'reserve' ? makeReserve() : makeRecorded();
            const selector = payloadKind === 'reserve' ? 'addReserve' : 'addRecorded';
            harness.model[selector] = vi.fn();

            expect(harness.model[method](payload)).toBeUndefined();

            expect(harness.model[selector].mock.calls).toEqual([[`synthetic-${method}-command`, payload]]);
            expect(harness.queue.add).not.toHaveBeenCalled();
        },
    );

    it('[supporting selector] selects encodingFinishCommand and forwards command plus exact info to addFinishEncode', () => {
        const harness = makeModel({ encodingFinishCommand: 'synthetic-encoding-command' });
        const info = encodingInfo();
        harness.model.addFinishEncode = vi.fn();

        expect(harness.model.addEncodingFinishCmd(info)).toBeUndefined();

        expect(harness.model.addFinishEncode.mock.calls).toEqual([['synthetic-encoding-command', info]]);
        expect(harness.queue.add).not.toHaveBeenCalled();
    });

    it.each([...reservationFamilies, ...recordingFamilies, encodingFamily])(
        '[supporting selector] distinguishes missing from configured-empty command for %s',
        (_label, key, methodOrCollection, payloadKind) => {
            const missing = makeModel({});
            const empty = makeModel({ [key]: '' });
            const isReservation = payloadKind === undefined;
            const payload = isReservation
                ? { [methodOrCollection]: [makeReserve()], isSuppressLog: false }
                : payloadKind === 'encode'
                  ? encodingInfo()
                  : payloadKind === 'reserve'
                    ? makeReserve()
                    : makeRecorded();
            const invoke = (harness: ReturnType<typeof makeModel>) =>
                isReservation ? harness.model.addUpdateReseves(payload) : harness.model[methodOrCollection](payload);

            invoke(missing);
            invoke(empty);

            expect(missing.queue.add).not.toHaveBeenCalled();
            expect(empty.queue.add).toHaveBeenCalledOnce();
        },
    );

    it.each(acceptanceFamilies)(
        '[supporting selector] keeps %s hook acceptance independent across resolved and rejected work',
        async (_label, key, method, payload, executor) => {
            const harness = makeModel({ [key]: 'synthetic-command' });
            const failure = new Error('synthetic hook execution failure');
            harness.model[executor] = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);

            const value = payload();
            expect(harness.model[method](value)).toBeUndefined();
            expect(harness.model[method](value)).toBeUndefined();
            expect(harness.queue.add).toHaveBeenCalledTimes(2);
            await expect(harness.queue.add.mock.calls[0][0]()).resolves.toBeUndefined();
            await expect(harness.queue.add.mock.calls[1][0]()).resolves.toBeUndefined();
            expect(harness.logger.system.error).toHaveBeenCalledWith(failure);
        },
    );

    it.each(acceptanceFamilies)(
        '[supporting selector] performs no common dedupe and starts no queued %s work during acceptance',
        (_label, key, method, payload, executor) => {
            const harness = makeModel({ [key]: 'synthetic-command' });
            const value = payload();
            harness.model[executor] = vi.fn();

            harness.model[method](value);
            harness.model[method](value);

            expect(harness.queue.add).toHaveBeenCalledTimes(2);
            expect(harness.model[executor]).not.toHaveBeenCalled();
        },
    );
});

describe('bounded external hook admission implementation', () => {
    it('[EH-7.2] executes public-entry lifecycle profiles with one terminal completion and no residual resources', async () => {
        for (const profile of lifecycleProfiles) {
            vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
            const harness = makeCommandQueueHarness({
                hookCommandMaxPending: profile.maxPending,
                hookCommandTimeoutMs: profile.deadlineMs,
            });
            const children: DeferredCommandChild[] = [];
            processStubs.spawn.mockImplementation(() => {
                const child = new DeferredCommandChild(2_000 + children.length);
                children.push(child);
                return child;
            });

            harness.model.addRecordingPrepStartCmd(makeReserve({ id: 71 }));
            await waitFor(() => children.length === 1, `${profile.label}: first public hook did not spawn`);
            harness.model.addRecordingPrepStartCmd(makeReserve({ id: 72 }));
            let firstCompletions = 0;
            void harness.queueAdd.mock.results[0].value.finally(() => {
                firstCompletions += 1;
            });

            if ('sameTickExitFirst' in profile && profile.sameTickExitFirst === true) vi.setSystemTime(10);
            else await vi.advanceTimersByTimeAsync(profile.timeToTerminalMs);
            expect(children[0].kill.mock.calls.map(([signal]) => signal)).toEqual(profile.expectedSignals);
            if (profile.terminal === 'error-then-exit') {
                children[0].emitError(new Error(`${profile.label}: synthetic child error`));
                children[0].emitExit(profile.terminalExitCode);
            } else {
                children[0].emitExit(profile.terminalExitCode);
            }
            await waitFor(
                () => children.length === 2,
                `${profile.label}: terminal release did not start the next item`,
            );
            children[1].emitExit(0);
            await Promise.all(harness.queueAdd.mock.results.map(result => result.value));
            await vi.advanceTimersByTimeAsync(30_000);

            expect({
                firstCompletions,
                nextItemExecutions: children.length - 1,
                queueHeadResidual: harness.queueAdd.mock.results.length - children.length,
                queueItems: harness.queueAdd.mock.results.length,
                retainedFirstErrorListeners: children[0].listenerCount('error'),
                retainedFirstExitListeners: children[0].listenerCount('exit'),
                retainedSecondErrorListeners: children[1].listenerCount('error'),
                retainedSecondExitListeners: children[1].listenerCount('exit'),
                remainingTimers: vi.getTimerCount(),
                snapshottedMaxPending: harness.model.hookCommandMaxPending,
                snapshottedTimeoutMs: harness.model.hookCommandTimeoutMs,
            }).toEqual({
                firstCompletions: 1,
                nextItemExecutions: 1,
                queueHeadResidual: 0,
                queueItems: 2,
                retainedFirstErrorListeners: 0,
                retainedFirstExitListeners: 0,
                retainedSecondErrorListeners: 0,
                retainedSecondExitListeners: 0,
                remainingTimers: 0,
                snapshottedMaxPending: profile.maxPending,
                snapshottedTimeoutMs: profile.deadlineMs,
            });
            processStubs.spawn.mockReset();
            vi.clearAllTimers();
        }
    });

    it('[EH-7.2] applies V-COMMAND, V-ENV, and V-TIMEOUT through the actual Configuration provider before public hook execution', async () => {
        const numericPolicies = [
            ['hookCommandMaxPending', 64, 10_000],
            ['hookCommandTimeoutMs', 300_000, 2_147_483_647],
        ] as const;
        for (const [field, defaultValue, maximum] of numericPolicies) {
            expect(formatThroughConfigurationProvider({}).getConfig()[field]).toBe(defaultValue);
            expect(formatThroughConfigurationProvider({ [field]: 1 }).getConfig()[field]).toBe(1);
            expect(formatThroughConfigurationProvider({ [field]: maximum }).getConfig()[field]).toBe(maximum);
            for (const invalid of [null, '', 0, -1, maximum + 1, '1', 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
                expect(() => formatThroughConfigurationProvider({ [field]: invalid })).toThrow(
                    `ConfigValueError:${field}`,
                );
            }
        }

        const commandCases = [
            ['unset', {}, undefined],
            ['empty', { recordingPreStartCommand: '' }, ''],
            ['null', { recordingPreStartCommand: null }, null],
            ['invalid type', { recordingPreStartCommand: 42 }, 42],
        ] as const;
        for (const [label, input, expected] of commandCases) {
            const provider = formatThroughConfigurationProvider(input);
            const snapshot = provider.getConfig();
            const harness = makeModelFromConfigurationProvider(provider);
            processStubs.spawn.mockClear();

            harness.model.addRecordingPrepStartCmd(makeReserve({ id: 810 }));

            expect(snapshot.recordingPreStartCommand, label).toBe(expected);
            if (expected === undefined) {
                expect(harness.queueAdd).not.toHaveBeenCalled();
                expect(harness.logger.system.error).not.toHaveBeenCalled();
            } else {
                await waitFor(
                    () => harness.logger.system.error.mock.calls.length === 2,
                    `${label} command was not rejected by the consumer after provider output`,
                );
                expect(harness.queueAdd).toHaveBeenCalledOnce();
                expect(processStubs.spawn).not.toHaveBeenCalled();
            }
        }

        for (const [label, value] of [
            ['null', null],
            ['empty', ''],
            ['unset', undefined],
        ] as const) {
            const provider = formatThroughConfigurationProvider({
                recordingPreStartCommand: `${process.execPath} synthetic`,
            });
            const harness = makeModelFromConfigurationProvider(provider);
            const child = new DeferredCommandChild(2_800);
            processStubs.spawn.mockClear();
            processStubs.spawn.mockReturnValueOnce(child);
            const reserve = makeReserve({ description: value, id: 820 });

            harness.model.addRecordingPrepStartCmd(reserve);
            await waitFor(() => processStubs.spawn.mock.calls.length === 1, `${label} environment did not reach spawn`);
            expect(processStubs.spawn.mock.calls[0][2].env.DESCRIPTION, label).toBe(value);
            child.emitExit(0);
            await harness.queueAdd.mock.results[0].value;
            expect(child.listenerCount('error')).toBe(0);
            expect(child.listenerCount('exit')).toBe(0);
        }
    });

    it('[supporting admission] reads configuration once and snapshots verified boundary values', () => {
        const minimum = makeModel({ hookCommandMaxPending: 1 });
        const maximum = makeModel({ hookCommandMaxPending: 10_000 });

        expect(minimum.getConfig).toHaveBeenCalledOnce();
        expect(maximum.getConfig).toHaveBeenCalledOnce();
        expect(minimum.model.hookCommandMaxPending).toBe(1);
        expect(maximum.model.hookCommandMaxPending).toBe(10_000);

        minimum.configSource.hookCommandMaxPending = 2;
        expect(minimum.model.hookCommandMaxPending).toBe(1);
        expect(makeModel(minimum.configSource).model.hookCommandMaxPending).toBe(2);
    });

    it('[supporting admission] releases the active count before admitting one waiting request', async () => {
        const harness = makeModel({ hookCommandMaxPending: 1, recordingPreStartCommand: 'synthetic-command' });
        const running = deferred<void>();
        harness.model.createReserveCmd = vi.fn(() => running.promise);
        const first = makeReserve({ id: 71 });
        const second = makeReserve({ id: 72 });
        const rejected = makeReserve({ id: 73 });

        expect(harness.model.addRecordingPrepStartCmd(first)).toBeUndefined();
        expect(harness.model.pendingHookCommandCount).toBe(1);
        const active = harness.queue.add.mock.calls[0][0]();
        expect(harness.model.pendingHookCommandCount).toBe(0);

        expect(harness.model.addRecordingPrepStartCmd(second)).toBeUndefined();
        expect(harness.model.addRecordingPrepStartCmd(rejected)).toBeUndefined();

        expect(harness.queue.add).toHaveBeenCalledTimes(2);
        expect(harness.model.pendingHookCommandCount).toBe(1);
        expect(harness.model.createReserveCmd.mock.calls).toEqual([['synthetic-command', first]]);
        expect(harness.logger.system.error.mock.calls).toEqual([['hook command queue is full: synthetic-command']]);

        running.resolve(undefined);
        await active;
    });

    it('[supporting admission] releases before a callback reenters and appends the request once', async () => {
        const harness = makeModel({ hookCommandMaxPending: 1, recordingPreStartCommand: 'synthetic-command' });
        const first = makeReserve({ id: 81 });
        const reentrant = makeReserve({ id: 82 });
        let didReenter = false;
        harness.model.createReserveCmd = vi.fn(async (_command: string, payload: unknown) => {
            if (didReenter === false) {
                didReenter = true;
                expect(payload).toBe(first);
                expect(harness.model.addRecordingPrepStartCmd(reentrant)).toBeUndefined();
            }
        });

        harness.model.addRecordingPrepStartCmd(first);
        expect(harness.model.pendingHookCommandCount).toBe(1);
        await harness.queue.add.mock.calls[0][0]();

        expect(harness.queue.add).toHaveBeenCalledTimes(2);
        expect(harness.model.pendingHookCommandCount).toBe(1);
        expect(harness.logger.system.error).not.toHaveBeenCalled();

        await harness.queue.add.mock.calls[1][0]();
        expect(harness.model.pendingHookCommandCount).toBe(0);
        expect(harness.model.createReserveCmd.mock.calls).toEqual([
            ['synthetic-command', first],
            ['synthetic-command', reentrant],
        ]);
    });

    it('[supporting admission] rolls back a synchronous queue registration failure before the next request', () => {
        const failure = new Error('synthetic queue registration failure');
        const queue = {
            add: vi
                .fn()
                .mockImplementationOnce(() => {
                    throw failure;
                })
                .mockImplementationOnce(() => undefined),
        };
        const harness = makeModel({ hookCommandMaxPending: 1, recordingPreStartCommand: 'synthetic-command' }, queue);

        expect(() => harness.model.addRecordingPrepStartCmd(makeReserve({ id: 91 }))).toThrow(failure);
        expect(harness.model.pendingHookCommandCount).toBe(0);

        expect(harness.model.addRecordingPrepStartCmd(makeReserve({ id: 92 }))).toBeUndefined();
        expect(queue.add).toHaveBeenCalledTimes(2);
        expect(harness.model.pendingHookCommandCount).toBe(1);
    });

    it('[supporting admission] releases exactly once when queue registration starts the callback twice and throws', async () => {
        const failure = new Error('synthetic reentrant queue registration failure');
        const callbackResults: Promise<void>[] = [];
        const queue = {
            add: vi.fn((job: () => Promise<void>) => {
                callbackResults.push(job(), job());
                throw failure;
            }),
        };
        const harness = makeModel({ hookCommandMaxPending: 1, recordingPreStartCommand: 'synthetic-command' }, queue);
        harness.model.createReserveCmd = vi.fn(async () => undefined);

        expect(() => harness.model.addRecordingPrepStartCmd(makeReserve({ id: 101 }))).toThrow(failure);

        expect(callbackResults).toHaveLength(2);
        expect(harness.model.pendingHookCommandCount).toBe(0);
        await Promise.all(callbackResults);
        expect(harness.model.pendingHookCommandCount).toBe(0);
    });
});

describe('EventSetter destination isolation characteristics', () => {
    it('forwards every simple event destination with its exact payload', async () => {
        const harness = makeSetter();
        harness.setter.set();
        const reserve = makeReserve();
        const recorded = makeRecorded();
        const diff = { update: [reserve], isSuppressLog: false };
        const expectOneNotification = (invoke: () => unknown): unknown => {
            const before = harness.ipc.notifyClient.mock.calls.length;
            const result = invoke();
            expect(harness.ipc.notifyClient).toHaveBeenCalledTimes(before + 1);
            return result;
        };

        expectOneNotification(() => harness.callbacks.rule.setAdded(41));
        expectOneNotification(() => harness.callbacks.rule.setUpdated(42));
        expectOneNotification(() => harness.callbacks.rule.setEnabled(43));
        expectOneNotification(() => harness.callbacks.rule.setDisabled(44));
        expect(harness.reservationManage.updateRule.mock.calls).toEqual([[41], [42], [43], [44]]);

        expectOneNotification(() => harness.callbacks.reserve.setUpdated(diff));
        expect(harness.recordingManage.acceptMutation).toHaveBeenCalledWith(diff);
        expect(harness.externalCommandManage.addUpdateReseves).toHaveBeenCalledWith(diff);

        expectOneNotification(() => harness.callbacks.recording.setStartPrepRecording(reserve));
        expectOneNotification(() => harness.callbacks.recording.setCancelPrepRecording(reserve));
        expectOneNotification(() => harness.callbacks.recording.setPrepRecordingFailed(reserve));
        expect(harness.externalCommandManage.addRecordingPrepStartCmd).toHaveBeenCalledWith(reserve);
        expect(harness.externalCommandManage.addRecordingPrepRecFailedCmd).toHaveBeenCalledTimes(2);
        expect(harness.reservationManage.cancel).toHaveBeenCalledWith(reserve.id);

        await expectOneNotification(() => harness.callbacks.recording.setStartRecording(reserve, recorded));
        expectOneNotification(() => harness.callbacks.recording.setRecordingFailed(reserve, null));
        expectOneNotification(() => harness.callbacks.recording.setRecordingFailed(reserve, recorded));
        expect(harness.externalCommandManage.addRecordingStartCmd).toHaveBeenCalledWith(recorded);
        expect(harness.externalCommandManage.addRecordingFailedCmd).toHaveBeenCalledWith(recorded);

        expectOneNotification(() => harness.callbacks.thumbnail.setAdded(51, 31));
        expectOneNotification(() => harness.callbacks.thumbnail.setDeleted());
        expectOneNotification(() => harness.callbacks.recordedEvent.setUpdateVideoFileSize(51));
        expectOneNotification(() => harness.callbacks.recordedEvent.setAddVideoFile(51));
        expectOneNotification(() => harness.callbacks.recordedEvent.setCreateNewRecorded(recorded));
        expectOneNotification(() => harness.callbacks.recordedEvent.setDeleteVideoFile(51));
        expectOneNotification(() => harness.callbacks.recordedEvent.setDropLogFileChanged(52));
        expectOneNotification(() => harness.callbacks.recordedEvent.setChangeProtect(31, true));

        expectOneNotification(() => harness.callbacks.recordedTag.setCreated({ id: 61 }));
        expectOneNotification(() => harness.callbacks.recordedTag.setUpdated(61));
        expectOneNotification(() => harness.callbacks.recordedTag.setRelated(61, 31));
        expectOneNotification(() => harness.callbacks.recordedTag.setDeleted(61));
        expectOneNotification(() => harness.callbacks.recordedTag.setDeletedRelation(61, 31));

        const encoding = encodingInfo();
        expect(harness.callbacks.encode.setFinishEncode(encoding)).toBeUndefined();
        expect(harness.externalCommandManage.addEncodingFinishCmd).toHaveBeenCalledWith(encoding);
    });

    it.each(['start', 'finish'] as const)('records a %s tag handoff failure and continues delivery', async phase => {
        const failure = new Error(`synthetic-${phase}-tag-failure`);
        const harness = makeSetter();
        harness.setter.setTag = vi.fn().mockRejectedValue(failure);
        harness.setter.set();
        const reserve = makeReserve({ tags: '[71]' });
        const recorded = makeRecorded();

        if (phase === 'start') {
            await expect(harness.callbacks.recording.setStartRecording(reserve, recorded)).resolves.toBeUndefined();
            expect(harness.externalCommandManage.addRecordingStartCmd).toHaveBeenCalledWith(recorded);
        } else {
            await expect(
                harness.callbacks.recording.setFinishRecording(reserve, recorded, false),
            ).resolves.toBeUndefined();
            expect(harness.externalCommandManage.addRecordingFinishCmd).toHaveBeenCalledWith(recorded);
        }

        expect(harness.setter.setTag).toHaveBeenCalledWith(recorded.id, reserve.tags);
        expect(harness.logger.system.fatal.mock.calls).toEqual([['setTag error'], [failure]]);
        expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
    });

    it.each([
        [false, null, false],
        [false, 71, false],
        [true, null, false],
        [true, 71, true],
    ] as const)(
        'cancels only active recorded deletion with isRecording=%s and reserveId=%s',
        (isRecording, reserveId, shouldCancel) => {
            const harness = makeSetter();
            harness.setter.set();
            const recorded = makeRecorded({ isRecording, reserveId });

            expect(harness.callbacks.recordedEvent.setDeleteRecorded(recorded)).toBeUndefined();

            expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
            expect(harness.reservationManage.cancel).toHaveBeenCalledTimes(shouldCancel ? 1 : 0);
            if (shouldCancel) expect(harness.reservationManage.cancel).toHaveBeenCalledWith(reserveId);
        },
    );

    it.each([false, true])('creates an uploaded thumbnail only when requested=%s', needsCreateThumbnail => {
        const harness = makeSetter();
        harness.setter.set();

        expect(harness.callbacks.recordedEvent.setAddUploadedVideoFile(81, needsCreateThumbnail)).toBeUndefined();

        expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
        expect(harness.thumbnailManage.add).toHaveBeenCalledTimes(needsCreateThumbnail ? 1 : 0);
        if (needsCreateThumbnail) expect(harness.thumbnailManage.add).toHaveBeenCalledWith(81);
    });

    it('does not start video work when a finished recording has no video files', async () => {
        const harness = makeSetter();
        harness.setter.set();
        const reserve = makeReserve({ encodeMode1: null, encodeMode2: null, encodeMode3: null });
        const recorded = makeRecorded({ videoFiles: undefined });

        await expect(harness.callbacks.recording.setFinishRecording(reserve, recorded, false)).resolves.toBeUndefined();

        expect(harness.thumbnailManage.add).not.toHaveBeenCalled();
        expect(harness.ipc.setEncode).not.toHaveBeenCalled();
        expect(harness.externalCommandManage.addRecordingFinishCmd).toHaveBeenCalledWith(recorded);
        expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
    });

    it('does not enqueue an encoder when every configured mode is null', async () => {
        const harness = makeSetter();
        harness.setter.set();
        const reserve = makeReserve({ encodeMode1: null, encodeMode2: null, encodeMode3: null });
        const recorded = makeRecorded({ videoFiles: [{ id: 91 }] });

        await expect(harness.callbacks.recording.setFinishRecording(reserve, recorded, false)).resolves.toBeUndefined();

        expect(harness.thumbnailManage.add).toHaveBeenCalledWith(91);
        expect(harness.ipc.setEncode).not.toHaveBeenCalled();
    });

    it.each([
        [1, null, null, 'synthetic-root', undefined],
        [1, 'parent-1', 'directory-1', 'parent-1', 'directory-1'],
        [2, null, null, 'synthetic-root', undefined],
        [2, 'parent-2', 'directory-2', 'parent-2', 'directory-2'],
        [3, null, null, 'synthetic-root', undefined],
        [3, 'parent-3', 'directory-3', 'parent-3', 'directory-3'],
    ] as const)(
        'maps encoder %i parent=%s directory=%s without changing the public command shape',
        async (slot, parentDirectory, directory, expectedParent, expectedDirectory) => {
            const harness = makeSetter();
            harness.setter.set();
            const reserve = makeReserve({
                encodeMode1: slot === 1 ? 'mode-1' : null,
                encodeMode2: slot === 2 ? 'mode-2' : null,
                encodeMode3: slot === 3 ? 'mode-3' : null,
                [`encodeParentDirectoryName${slot}`]: parentDirectory,
                [`encodeDirectory${slot}`]: directory,
                isDeleteOriginalAfterEncode: true,
            });
            const recorded = makeRecorded({ videoFiles: [{ id: 91 }] });

            await expect(
                harness.callbacks.recording.setFinishRecording(reserve, recorded, false),
            ).resolves.toBeUndefined();

            expect(harness.ipc.setEncode.mock.calls).toEqual([
                [
                    {
                        directory: expectedDirectory,
                        mode: `mode-${slot}`,
                        parentDir: expectedParent,
                        recordedId: recorded.id,
                        removeOriginal: true,
                        sourceVideoFileId: 91,
                    },
                ],
            ]);
        },
    );

    it.each([
        [false, null, false, 'none'],
        [true, null, false, 'cancel'],
        [true, 101, false, 'updateRule'],
        [true, 101, true, 'cancel'],
    ] as const)(
        'applies finish reservation cleanup delete=%s ruleId=%s relay=%s through %s',
        async (isNeedDeleteReservation, ruleId, isEventRelay, expected) => {
            const harness = makeSetter();
            harness.setter.set();
            const reserve = makeReserve({ isEventRelay, ruleId });

            await expect(
                harness.callbacks.recording.setFinishRecording(reserve, makeRecorded(), isNeedDeleteReservation),
            ).resolves.toBeUndefined();

            expect(harness.reservationManage.cancel).toHaveBeenCalledTimes(expected === 'cancel' ? 1 : 0);
            expect(harness.reservationManage.updateRule).toHaveBeenCalledTimes(expected === 'updateRule' ? 1 : 0);
            if (expected === 'cancel') expect(harness.reservationManage.cancel).toHaveBeenCalledWith(reserve.id);
            if (expected === 'updateRule') expect(harness.reservationManage.updateRule).toHaveBeenCalledWith(ruleId);
        },
    );

    it('contains a synchronous local workflow failure before hook enqueue', () => {
        const failure = new Error('synthetic local workflow failure');
        const harness = makeSetter();
        harness.recordingManage.acceptMutation.mockImplementation(() => {
            throw failure;
        });
        harness.setter.set();
        const diff = { update: [makeReserve()], isSuppressLog: false };

        expect(harness.callbacks.reserve.setUpdated(diff)).toBeUndefined();

        expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
        expect(harness.externalCommandManage.addUpdateReseves).toHaveBeenCalledWith(diff);
        expect(harness.logger.system.error.mock.calls).toEqual([[failure]]);
    });

    it('contains a synchronous hook enqueue failure before a later PM handoff', async () => {
        const failure = new Error('synthetic hook enqueue failure');
        const harness = makeSetter();
        harness.externalCommandManage.addRecordingFinishCmd.mockImplementation(() => {
            throw failure;
        });
        harness.setter.set();

        const callbackResult = harness.callbacks.recording.setFinishRecording(makeReserve(), makeRecorded(), false);

        await expect(callbackResult).resolves.toBeUndefined();
        expect(harness.externalCommandManage.addRecordingFinishCmd).toHaveBeenCalledOnce();
        expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
        expect(harness.logger.system.error.mock.calls).toEqual([[failure]]);
    });

    it.each([
        ['thumbnail', ['thumbnail']],
        ['encode-1', ['thumbnail', 'encode-1']],
        ['encode-2', ['thumbnail', 'encode-1', 'encode-2']],
        ['encode-3', ['thumbnail', 'encode-1', 'encode-2', 'encode-3']],
    ] as const)(
        'preserves the recording-finish dependency prefix when %s throws synchronously',
        async (failureAt, expectedLedger) => {
            const failure = new Error(`synthetic ${failureAt} failure`);
            const ledger: string[] = [];
            const harness = makeSetter();
            const attempt = (destination: string): void => {
                ledger.push(destination);
                if (destination === failureAt) throw failure;
            };
            harness.thumbnailManage.add.mockImplementation(() => attempt('thumbnail'));
            harness.ipc.setEncode.mockImplementation(({ mode }: { mode: string }) => attempt(mode));
            harness.externalCommandManage.addRecordingFinishCmd.mockImplementation(() => ledger.push('hook'));
            harness.ipc.notifyClient.mockImplementation(() => ledger.push('ui'));
            harness.setter.set();
            const reserve = makeReserve({
                encodeMode1: 'encode-1',
                encodeMode2: 'encode-2',
                encodeMode3: 'encode-3',
            });
            const recorded = makeRecorded({ videoFiles: [{ id: 41 }] });

            await expect(harness.callbacks.recording.setFinishRecording(reserve, recorded, false)).rejects.toBe(
                failure,
            );

            expect(ledger).toEqual(expectedLedger);
            expect(harness.externalCommandManage.addRecordingFinishCmd).not.toHaveBeenCalled();
            expect(harness.ipc.notifyClient).not.toHaveBeenCalled();
            expect(harness.logger.system.error).not.toHaveBeenCalled();
        },
    );

    it('records each rejected rule-delete destination exactly once', async () => {
        const removeFailure = new Error('synthetic remove rule failure');
        const updateFailure = new Error('synthetic update rule failure');
        const harness = makeSetter();
        harness.recordedManage.removeRuleId.mockRejectedValue(removeFailure);
        harness.reservationManage.updateRule.mockRejectedValue(updateFailure);
        harness.setter.set();

        expect(harness.callbacks.rule.setDeleted(51)).toBeUndefined();
        await flushImmediate();

        expect(harness.recordedManage.removeRuleId).toHaveBeenCalledWith(51);
        expect(harness.reservationManage.updateRule).toHaveBeenCalledWith(51);
        expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
        expect(harness.logger.system.error.mock.calls).toEqual([[removeFailure], [updateFailure]]);
    });

    it('records a rejected retry-over cancellation exactly once', async () => {
        const failure = new Error('synthetic retry-over cancellation failure');
        const harness = makeSetter();
        harness.reservationManage.cancel.mockRejectedValue(failure);
        harness.setter.set();
        const reserve = makeReserve();

        expect(harness.callbacks.recording.setRecordingRetryOver(reserve)).toBeUndefined();
        await flushImmediate();

        expect(harness.reservationManage.cancel).toHaveBeenCalledWith(reserve.id);
        expect(harness.logger.system.error.mock.calls).toEqual([[failure]]);
    });

    it.each([
        ['cancel', makeReserve(), 'cancel'],
        ['update rule', makeReserve({ isEventRelay: false, ruleId: 61 }), 'updateRule'],
    ] as const)(
        'records a rejected recording-finish %s exactly once and continues hook and UI handoffs',
        async (_label, reserve, method) => {
            const failure = new Error(`synthetic recording-finish ${method} failure`);
            const harness = makeSetter();
            harness.reservationManage[method].mockRejectedValue(failure);
            harness.setter.set();
            const recorded = makeRecorded();

            await expect(
                harness.callbacks.recording.setFinishRecording(reserve, recorded, true),
            ).resolves.toBeUndefined();
            await flushImmediate();

            expect(harness.reservationManage[method]).toHaveBeenCalledOnce();
            expect(harness.externalCommandManage.addRecordingFinishCmd).toHaveBeenCalledWith(recorded);
            expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
            expect(harness.logger.system.error.mock.calls).toEqual([[failure]]);
        },
    );
});
