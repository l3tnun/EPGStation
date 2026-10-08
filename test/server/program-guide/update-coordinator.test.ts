import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDialectPersistence, type DatabaseDialect, makeProgram } from '../fixtures/reservation-rules/runtime';
import { createDeferred } from '../harness/async';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const EPGUpdater = (require(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdater.js')) as any).default;
const EPGUpdateManageModel = (require(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdateManageModel.js')) as any)
    .default;
const ScheduleApiModel = (require(join(compiledSnapshot, 'model', 'api', 'schedule', 'ScheduleApiModel.js')) as any)
    .default;
const MirakurunChangeAdapter = (
    require(join(compiledSnapshot, 'model', 'tuner', 'change', 'MirakurunChangeAdapter.js')) as any
).default;
const { EPGUpdateEvent } = require(join(compiledSnapshot, 'model', 'epgUpdater', 'IEPGUpdateManageModel.js')) as any;

const logger = () => ({ system: { debug: vi.fn(), error: vi.fn(), info: vi.fn() } });
let restoreProcessSend: (() => void) | undefined;
const stubProcessSend = (): void => {
    if (restoreProcessSend !== undefined) return;
    const descriptor = Object.getOwnPropertyDescriptor(process, 'send');
    Object.defineProperty(process, 'send', {
        configurable: true,
        value: vi.fn(() => true),
        writable: true,
    });
    restoreProcessSend = () => {
        if (descriptor === undefined) {
            delete process.send;
        } else {
            Object.defineProperty(process, 'send', descriptor);
        }
    };
};

const createUpdater = (deleteOldPrograms: ReturnType<typeof vi.fn>) => {
    const updater = Object.create(EPGUpdater.prototype) as any;
    updater.log = logger();
    updater.config = { epgUpdateIntervalTime: 1 };
    updater.updateManage = {
        checkTunerServerType: vi.fn().mockResolvedValue(0),
        deleteOldPrograms,
        updateAll: vi.fn().mockRejectedValue(new Error('synthetic-update-rejection')),
    };
    updater.isEventStreamAlive = false;
    updater.isUpdateCycleActive = false;
    updater.isUpdateCyclePending = false;
    updater.lastUpdatedTime = 120_000;
    updater.lastDeletedTime = 0;
    updater.streamSynchronizationQueue = [];
    updater.startEventStreamAnalysis = vi.fn();
    return updater;
};

const createCoordinator = (
    overrides: Record<string, unknown> = {},
    state: { alive?: boolean; lastDeletedTime?: number; lastUpdatedTime?: number; updateIntervalMinutes?: number } = {},
) => {
    stubProcessSend();
    const updateManage = Object.assign(
        new EventEmitter(),
        {
            deleteOldPrograms: vi.fn(async () => undefined),
            saveOnAirServices: vi.fn(async () => undefined),
            saveProgram: vi.fn(async () => undefined),
            saveService: vi.fn(async () => undefined),
            saveUpdateServices: vi.fn(async () => undefined),
            start: vi.fn(async () => undefined),
            updateAll: vi.fn(async () => undefined),
        },
        overrides,
    );
    const updater = new EPGUpdater(
        { getLogger: logger },
        { getConfig: () => ({ epgUpdateIntervalTime: state.updateIntervalMinutes ?? 1 }) },
        updateManage,
    ) as any;
    updater.isEventStreamAlive = state.alive ?? true;
    updater.lastUpdatedTime = state.lastUpdatedTime ?? 100_000;
    updater.lastDeletedTime = state.lastDeletedTime ?? 100_000;
    updater.startEventStreamAnalysis = vi.fn();
    return { updateManage, updater };
};

afterEach(() => {
    restoreProcessSend?.();
    restoreProcessSend = undefined;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('program guide periodic deletion characterization', () => {
    it('[PG-T3.2] logs an overdue acquisition rejection, then deletes expired rows while retained reads continue', async () => {
        for (const dialect of ['sqlite', 'mysql'] as DatabaseDialect[]) {
            const fixture = await createDialectPersistence(dialect);
            try {
                const initialTime = 1_000_000;
                const tickTime = initialTime + 10_000;
                await fixture.source.getRepository(fixture.Program).insert([
                    makeProgram({
                        id: 701,
                        channelId: 71,
                        name: 'synthetic expired',
                        halfWidthName: 'synthetic expired',
                        startAt: tickTime - 60_000,
                        endAt: tickTime - 1,
                    }),
                    makeProgram({
                        id: 702,
                        channelId: 71,
                        name: 'synthetic retained',
                        halfWidthName: 'synthetic retained',
                        startAt: tickTime - 30_000,
                        endAt: tickTime,
                    }),
                ]);
                vi.useFakeTimers();
                vi.setSystemTime(initialTime);
                const updateFailure = new Error('synthetic-overdue-update-rejection');
                const manageLogger = logger();
                const updateManage = new EPGUpdateManageModel(
                    { getLogger: () => manageLogger },
                    { getConfig: () => ({ mirakurunPath: 'http://program-guide.invalid/' }) },
                    { getPrograms: vi.fn(), getServices: vi.fn() },
                    {},
                    fixture.programDB,
                );
                const ledger: string[] = [];
                vi.spyOn(updateManage, 'updateAll').mockImplementation(async () => {
                    ledger.push('updateAll rejected');
                    throw updateFailure;
                });
                const deleteExpired = updateManage.deleteOldPrograms.bind(updateManage);
                const deleteOldPrograms = vi.spyOn(updateManage, 'deleteOldPrograms').mockImplementation(async () => {
                    ledger.push('delete expired');
                    await deleteExpired();
                });
                const updaterLogger = logger();
                updaterLogger.system.error.mockImplementation(value => {
                    if (value === 'EPG update error') ledger.push('update rejection logged');
                });
                const updater = new EPGUpdater(
                    { getLogger: () => updaterLogger },
                    { getConfig: () => ({ epgUpdateIntervalTime: 1 }) },
                    updateManage,
                ) as any;
                updater.isEventStreamAlive = false;
                updater.lastUpdatedTime = tickTime - 90_000;
                updater.lastDeletedTime = tickTime - 60_000;
                updater.startEventStreamAnalysis = vi.fn();

                await updater.start();
                await vi.advanceTimersByTimeAsync(10_000);
                await vi.waitFor(() => expect(deleteOldPrograms).toHaveBeenCalledTimes(1));
                await deleteOldPrograms.mock.results[0].value;
                await Promise.resolve();

                expect(updateManage.updateAll).toHaveBeenCalledTimes(1);
                expect(updaterLogger.system.error).toHaveBeenCalledWith('EPG update error');
                expect(updaterLogger.system.error).toHaveBeenCalledWith(updateFailure);
                expect(ledger).toEqual(['updateAll rejected', 'update rejection logged', 'delete expired']);
                expect(updater.lastDeletedTime).toBe(tickTime);
                await expect(fixture.programDB.findId(701)).resolves.toBeNull();
                const api = new ScheduleApiModel({}, fixture.programDB);
                await expect(api.getSchedule(702, false)).resolves.toMatchObject({
                    id: 702,
                    name: 'synthetic retained',
                });
            } finally {
                vi.useRealTimers();
                await fixture.cleanup();
            }
        }
        // Runs both dialects; the mysql leg provisions its server through `execFile('docker', …)`
        // (`test/server/persistence/mysql-runtime.ts`), so this case already spends ~3.8s of
        // Vitest's 5000ms default in isolation. Under full-tier load that contended child process
        // pushes it past the default even though nothing hangs.
    }, 30_000);

    it('[PG-T3.2] records deletion rejection, advances the deletion checkpoint, and does not immediately repeat it', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(120_000);
        const failure = new Error('synthetic-delete-rejection');
        const deleteOldPrograms = vi.fn().mockRejectedValue(failure);
        const updater = createUpdater(deleteOldPrograms);

        await updater.start();
        await vi.advanceTimersByTimeAsync(10_000);
        await vi.advanceTimersByTimeAsync(10_000);

        expect(deleteOldPrograms).toHaveBeenCalledTimes(1);
        expect(updater.lastDeletedTime).toBe(130_000);
        expect(updater.log.system.error).toHaveBeenCalledWith('delete old programs error');
        expect(updater.log.system.error).toHaveBeenCalledWith(failure);
    });
});

describe('program guide Tasks 5.3-5.4 coordinator single-flight', () => {
    it('[PG-MC-periodic] selects the periodic path directly when the stream queue is empty', async () => {
        const { updateManage, updater } = createCoordinator();
        updater.isUpdateCyclePending = true;
        updater.updatePeriodically = vi.fn(async () => undefined);

        await expect(updater.runUpdateCycle()).resolves.toBeUndefined();

        expect(updater.isUpdateCyclePending).toBe(false);
        expect(updater.updatePeriodically).toHaveBeenCalledOnce();
        expect(updateManage.updateAll).not.toHaveBeenCalled();
    });

    it('[PG-MC-reentry] starts exactly one fresh cycle when work becomes pending at settlement', async () => {
        const secondCycle = createDeferred<void>();
        const { updater } = createCoordinator();
        updater.isUpdateCycleActive = true;
        updater.runUpdateCycle = vi
            .fn()
            .mockImplementationOnce(async () => {
                updater.isUpdateCyclePending = true;
            })
            .mockImplementationOnce(() => {
                updater.isUpdateCyclePending = false;
                return secondCycle.promise;
            });

        await updater.runUpdateCycles();
        await Promise.resolve();

        expect(updater.runUpdateCycle).toHaveBeenCalledTimes(2);
        expect(updater.isUpdateCycleActive).toBe(true);

        secondCycle.resolve(undefined);
        await vi.waitFor(() => expect(updater.isUpdateCycleActive).toBe(false));
        expect(updater.runUpdateCycle).toHaveBeenCalledTimes(2);
    });

    it('[PG-MC-stream] handles a disconnect before the first stream-start generation without creating work', () => {
        const { updateManage, updater } = createCoordinator({}, { alive: true });

        expect(() => updateManage.emit(EPGUpdateEvent.STREAM_ABORTED)).not.toThrow();

        expect(updater.isEventStreamAlive).toBe(false);
        expect(updater.latestStreamSynchronizationRequest).toBeUndefined();
        expect(updater.streamSynchronizationQueue).toEqual([]);
        expect(updateManage.updateAll).not.toHaveBeenCalled();
    });

    it('[PG-MC-lifecycle] starts disconnected and preserves stream start, periodic, and abort lifecycle effects', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        stubProcessSend();
        const updateManage = Object.assign(new EventEmitter(), {
            deleteOldPrograms: vi.fn(async () => undefined),
            saveOnAirServices: vi.fn(async () => undefined),
            saveProgram: vi.fn(async () => undefined),
            saveService: vi.fn(async () => undefined),
            saveUpdateServices: vi.fn(async () => undefined),
            start: vi.fn(async () => undefined),
            updateAll: vi.fn(async () => undefined),
        });
        const updaterLog = logger();
        const updater = new EPGUpdater(
            { getLogger: () => updaterLog },
            { getConfig: () => ({ epgUpdateIntervalTime: 1 }) },
            updateManage,
        ) as any;
        updater.startEventStreamAnalysis = vi.fn();

        await updater.start();
        expect(updaterLog.system.info).toHaveBeenCalledWith('start EPG update');
        await vi.advanceTimersByTimeAsync(10_000);
        await vi.waitFor(() => expect(updateManage.updateAll).toHaveBeenCalledTimes(1));
        expect(updateManage.saveOnAirServices).not.toHaveBeenCalled();
        expect(updater.isEventStreamAlive).toBe(false);

        updater.retryCount = 7;
        updateManage.emit(EPGUpdateEvent.STREAM_STARTED);
        await vi.waitFor(() => expect(updateManage.updateAll).toHaveBeenCalledTimes(2));
        expect(updaterLog.system.info).toHaveBeenCalledWith('event stream started');
        expect(updater.retryCount).toBe(0);
        expect(updater.isEventStreamAlive).toBe(true);

        updater.requestUpdateCycle();
        await vi.waitFor(() => expect(updateManage.saveOnAirServices).toHaveBeenCalledTimes(1));
        expect(updateManage.updateAll).toHaveBeenCalledTimes(2);

        updateManage.emit(EPGUpdateEvent.STREAM_ABORTED);
        expect(updaterLog.system.info).toHaveBeenCalledWith('has disconnected from the mirakurun');
        expect(updater.isEventStreamAlive).toBe(false);
    });

    it('[PG-MC-lifecycle] drains every stream-start generation before one coalesced periodic request', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const synchronizations = [createDeferred<void>(), createDeferred<void>(), createDeferred<void>()];
        const synchronizationStarted = [createDeferred<void>(), createDeferred<void>(), createDeferred<void>()];
        const periodicStarted = createDeferred<void>();
        const failure = new Error('synthetic-second-generation-rejection');
        const ledger: string[] = [];
        let activeSynchronizations = 0;
        let maximumActiveSynchronizations = 0;
        const updateAll = vi.fn(() => {
            const index = updateAll.mock.calls.length - 1;
            activeSynchronizations++;
            maximumActiveSynchronizations = Math.max(maximumActiveSynchronizations, activeSynchronizations);
            ledger.push(`synchronization ${index + 1} started`);
            synchronizationStarted[index]?.resolve(undefined);
            return synchronizations[index].promise.finally(() => {
                activeSynchronizations--;
                ledger.push(`synchronization ${index + 1} settled`);
            });
        });
        const { updateManage, updater } = createCoordinator(
            { updateAll },
            { alive: false, lastDeletedTime: 100_000, lastUpdatedTime: 100_000 },
        );
        const send = process.send as unknown as ReturnType<typeof vi.fn>;
        send.mockImplementation(() => {
            ledger.push('notified');
            return true;
        });
        updater.updatePeriodically = vi.fn(async () => {
            ledger.push('periodic started');
            periodicStarted.resolve(undefined);
        });
        const listenerCounts = Object.fromEntries(
            updateManage.eventNames().map(name => [name, updateManage.listenerCount(name)]),
        );

        try {
            updateManage.emit(EPGUpdateEvent.STREAM_STARTED);
            updateManage.emit(EPGUpdateEvent.STREAM_STARTED);
            updateManage.emit(EPGUpdateEvent.STREAM_STARTED);
            await synchronizationStarted[0].promise;

            expect(updateAll).toHaveBeenCalledTimes(1);
            expect(updater.isUpdateCyclePending).toBe(false);
            updater.requestUpdateCycle();
            expect(updater.isUpdateCyclePending).toBe(true);

            vi.setSystemTime(110_000);
            synchronizations[0].resolve(undefined);
            await synchronizationStarted[1].promise;
            expect(updater.lastUpdatedTime).toBe(110_000);
            expect(updater.lastDeletedTime).toBe(110_000);
            expect(updater.isEventStreamAlive).toBe(false);

            vi.setSystemTime(120_000);
            synchronizations[1].reject(failure);
            await synchronizationStarted[2].promise;
            expect(updater.lastUpdatedTime).toBe(120_000);
            expect(updater.lastDeletedTime).toBe(120_000);
            expect(updater.isEventStreamAlive).toBe(false);

            vi.setSystemTime(130_000);
            synchronizations[2].resolve(undefined);
            await periodicStarted.promise;
            await vi.waitFor(() => expect(updater.isUpdateCycleActive).toBe(false));

            expect(updateAll).toHaveBeenCalledTimes(3);
            expect(updater.updatePeriodically).toHaveBeenCalledOnce();
            expect(maximumActiveSynchronizations).toBe(1);
            expect(activeSynchronizations).toBe(0);
            expect(updater.lastUpdatedTime).toBe(130_000);
            expect(updater.lastDeletedTime).toBe(130_000);
            expect(updater.isEventStreamAlive).toBe(true);
            expect(send).toHaveBeenCalledTimes(2);
            expect(updater.log.system.error).toHaveBeenCalledWith('updateAll error');
            expect(ledger).toEqual([
                'synchronization 1 started',
                'synchronization 1 settled',
                'notified',
                'synchronization 2 started',
                'synchronization 2 settled',
                'synchronization 3 started',
                'synchronization 3 settled',
                'notified',
                'periodic started',
            ]);
            expect(
                Object.fromEntries(updateManage.eventNames().map(name => [name, updateManage.listenerCount(name)])),
            ).toEqual(listenerCounts);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            for (const synchronization of synchronizations) synchronization.resolve(undefined);
            await vi.waitFor(() => expect(updater.isUpdateCycleActive).toBe(false));
        }
    });

    it.each(['resolve', 'reject'] as const)(
        '[PG-MC-stream] does not resurrect an aborted latest generation after its late %s',
        async settlement => {
            vi.useFakeTimers();
            vi.setSystemTime(200_000);
            const synchronization = createDeferred<void>();
            const updateAll = vi.fn(() => synchronization.promise);
            const { updateManage, updater } = createCoordinator({ updateAll }, { alive: true });
            const send = process.send as unknown as ReturnType<typeof vi.fn>;
            const failure = new Error('synthetic-aborted-generation-rejection');

            updateManage.emit(EPGUpdateEvent.STREAM_STARTED);
            await vi.waitFor(() => expect(updateAll).toHaveBeenCalledOnce());
            updateManage.emit(EPGUpdateEvent.STREAM_ABORTED);
            expect(updater.isEventStreamAlive).toBe(false);

            vi.setSystemTime(210_000);
            if (settlement === 'resolve') synchronization.resolve(undefined);
            else synchronization.reject(failure);
            await synchronization.promise.catch(() => undefined);
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();

            expect(updateAll).toHaveBeenCalledOnce();
            expect(updater.isUpdateCycleActive).toBe(false);
            expect(updater.lastUpdatedTime).toBe(210_000);
            expect(updater.lastDeletedTime).toBe(210_000);
            expect(updater.isEventStreamAlive).toBe(false);
            expect(send).toHaveBeenCalledTimes(settlement === 'resolve' ? 1 : 0);
            expect(vi.getTimerCount()).toBe(0);
            if (settlement === 'reject') {
                expect(updater.log.system.error).toHaveBeenCalledWith('updateAll error');
            }
        },
    );

    it('[PG-MC-periodic] clears the consumed periodic request before awaiting one bounded cycle', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const firstCycle = createDeferred<void>();
        const firstStarted = createDeferred<void>();
        const unexpectedSecondCycle = createDeferred<void>();
        const { updater } = createCoordinator();
        updater.updatePeriodically = vi.fn(() => {
            if (updater.updatePeriodically.mock.calls.length === 1) {
                firstStarted.resolve(undefined);
                return firstCycle.promise;
            }
            return unexpectedSecondCycle.promise;
        });

        await updater.start();
        await vi.advanceTimersByTimeAsync(10_000);
        await firstStarted.promise;
        expect(updater.updatePeriodically).toHaveBeenCalledOnce();

        firstCycle.resolve(undefined);
        await firstCycle.promise;
        await Promise.resolve();
        await Promise.resolve();

        expect(updater.updatePeriodically).toHaveBeenCalledOnce();
        expect(updater.isUpdateCycleActive).toBe(false);
        expect(unexpectedSecondCycle.state()).toEqual({ status: 'pending' });
        expect(vi.getTimerCount()).toBe(1);
    });

    it('[PG-MC-reentry] logs one failed active cycle and starts exactly one queued re-evaluation', async () => {
        const first = createDeferred<void>();
        const second = createDeferred<void>();
        const third = createDeferred<void>();
        const failure = new Error('synthetic-active-cycle-rejection');
        const { updater } = createCoordinator();
        updater.runUpdateCycle = vi.fn(() => {
            const call = updater.runUpdateCycle.mock.calls.length;
            if (call === 1) return first.promise;
            if (call === 2) return second.promise;
            return third.promise;
        });

        updater.requestUpdateCycle();
        updater.requestUpdateCycle();
        first.resolve(undefined);
        await vi.waitFor(() => expect(updater.runUpdateCycle).toHaveBeenCalledTimes(2));
        updater.requestUpdateCycle();
        second.reject(failure);

        await vi.waitFor(() => expect(updater.runUpdateCycle).toHaveBeenCalledTimes(3));
        expect(updater.log.system.error).toHaveBeenCalledWith('EPG update error');
        expect(updater.log.system.error).toHaveBeenCalledWith(failure);
        expect(third.state()).toEqual({ status: 'pending' });
    });

    it.each([
        ['partial program', 100_000, 'saveProgram', 'program update error'],
        ['full service', 0, 'saveService', 'service update error'],
        ['full program', 0, 'saveProgram', 'program update error'],
    ] as const)(
        '[PG-MC-periodic] preserves the %s persistence rejection and diagnostic',
        async (_label, lastUpdatedTime, failingMethod, diagnostic) => {
            const failure = new Error(`synthetic-${failingMethod}-rejection`);
            const saveProgram = vi.fn(async () => undefined);
            const saveService = vi.fn(async () => undefined);
            if (failingMethod === 'saveProgram') saveProgram.mockRejectedValueOnce(failure);
            else saveService.mockRejectedValueOnce(failure);
            const { updater } = createCoordinator({ saveProgram, saveService }, { lastUpdatedTime });

            await expect(updater.updateMirakurunEventStream(60_000, 110_000)).rejects.toBe(failure);
            expect(updater.log.system.error).toHaveBeenCalledWith(diagnostic);
            if (lastUpdatedTime === 0 && failingMethod === 'saveProgram') {
                expect(saveService).toHaveBeenCalledTimes(1);
            }
        },
    );

    it('[PG-MC-periodic] preserves an on-air save rejection before creating deferred completion', async () => {
        const failure = new Error('synthetic-on-air-rejection');
        const { updater } = createCoordinator({ saveOnAirServices: vi.fn().mockRejectedValue(failure) });

        await expect(updater.updateMirakcEvent(60_000, 110_000)).rejects.toBe(failure);
        expect(updater.log.system.error).toHaveBeenCalledWith('failed to save onair services');
    });

    it('[PG-MC-periodic] returns an awaitable no-op completion when no deferred service save is due', async () => {
        const { updateManage, updater } = createCoordinator({}, { lastUpdatedTime: 100_000 });

        const result = await updater.updateMirakcEvent(60_000, 110_000);

        expect(Object.keys(result)).toEqual(['completion']);
        await expect(result.completion).resolves.toBeUndefined();
        expect(updateManage.saveUpdateServices).not.toHaveBeenCalled();
    });

    it('[PG-MC-ipc] sends one update only when an IPC carrier exists', () => {
        restoreProcessSend?.();
        restoreProcessSend = undefined;
        const descriptor = Object.getOwnPropertyDescriptor(process, 'send');
        const updater = Object.create(EPGUpdater.prototype) as any;
        try {
            delete process.send;
            expect(() => updater.notify()).not.toThrow();

            const send = vi.fn(() => true);
            Object.defineProperty(process, 'send', { configurable: true, value: send, writable: true });
            updater.notify();
            expect(send).toHaveBeenCalledOnce();
            expect(send).toHaveBeenCalledWith({ msg: 'updated' });
        } finally {
            if (descriptor === undefined) delete process.send;
            else Object.defineProperty(process, 'send', descriptor);
        }
    });

    it('[PG-MC-lifecycle] keeps a pending program save active beyond ten minutes without a second observer or save', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const firstSave = createDeferred<void>();
        const firstStarted = createDeferred<void>();
        const reevaluationStarted = createDeferred<void>();
        const saveProgram = vi.fn(() => {
            if (saveProgram.mock.calls.length === 1) {
                firstStarted.resolve(undefined);
                return firstSave.promise;
            }
            reevaluationStarted.resolve(undefined);
            return Promise.resolve();
        });
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
        const { updater } = createCoordinator(
            { saveProgram },
            { alive: true, lastDeletedTime: 100_000, lastUpdatedTime: 100_000, updateIntervalMinutes: 60 },
        );

        await updater.start();
        await vi.advanceTimersByTimeAsync(10_000);
        await firstStarted.promise;
        await vi.advanceTimersByTimeAsync(600_001);

        expect(saveProgram).toHaveBeenCalledTimes(1);
        expect(firstSave.state()).toEqual({ status: 'pending' });
        expect(setTimeoutSpy).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(1);

        firstSave.resolve(undefined);
        await reevaluationStarted.promise;
        expect(saveProgram).toHaveBeenCalledTimes(2);
        expect(saveProgram).toHaveBeenNthCalledWith(2, 1_010_001);
        expect(vi.getTimerCount()).toBe(1);
    });

    it('[PG-MC-periodic] settles an active save before starting the tick that arrives at the same instant', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const firstSave = createDeferred<void>();
        const firstStarted = createDeferred<void>();
        const reevaluationStarted = createDeferred<void>();
        const ledger: string[] = [];
        const saveProgram = vi.fn(() => {
            if (saveProgram.mock.calls.length === 1) {
                ledger.push('first save started');
                firstStarted.resolve(undefined);
                return firstSave.promise;
            }
            ledger.push('re-evaluation started');
            reevaluationStarted.resolve(undefined);
            return Promise.resolve();
        });
        const { updater } = createCoordinator({ saveProgram });

        await updater.start();
        await vi.advanceTimersByTimeAsync(10_000);
        await firstStarted.promise;
        setTimeout(() => {
            ledger.push('first save settled');
            firstSave.resolve(undefined);
        }, 10_000);

        await vi.advanceTimersByTimeAsync(10_000);
        await reevaluationStarted.promise;

        expect(ledger).toEqual(['first save started', 'first save settled', 're-evaluation started']);
        expect(saveProgram).toHaveBeenCalledTimes(2);
    });

    it('[PG-MC-periodic] waits for service persistence before continuing the approved full-cycle order', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const serviceSave = createDeferred<void>();
        const serviceStarted = createDeferred<void>();
        const reevaluationStarted = createDeferred<void>();
        const saveService = vi.fn(() => {
            serviceStarted.resolve(undefined);
            return serviceSave.promise;
        });
        const saveProgram = vi.fn(async () => {
            if (saveProgram.mock.calls.length === 2) reevaluationStarted.resolve(undefined);
        });
        const { updateManage, updater } = createCoordinator(
            { saveProgram, saveService },
            { alive: true, lastDeletedTime: 100_000, lastUpdatedTime: 0 },
        );

        await updater.start();
        await vi.advanceTimersByTimeAsync(10_000);
        await serviceStarted.promise;
        await vi.advanceTimersByTimeAsync(30_000);

        expect(updateManage.saveOnAirServices).toHaveBeenCalledTimes(1);
        expect(updateManage.saveUpdateServices).toHaveBeenCalledTimes(1);
        expect(saveService).toHaveBeenCalledTimes(1);
        expect(updateManage.saveProgram).not.toHaveBeenCalled();

        serviceSave.resolve(undefined);
        await reevaluationStarted.promise;

        expect(saveService).toHaveBeenCalledTimes(1);
        expect(updateManage.saveProgram).toHaveBeenCalledTimes(2);
        expect(updateManage.saveProgram).toHaveBeenNthCalledWith(1);
        expect(updateManage.saveProgram).toHaveBeenNthCalledWith(2, 440_000);
    });

    it('[PG-MC-periodic] keeps a rejected mirakc deferred save active after its existing early notification', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const deferredSave = createDeferred<void>();
        const deferredStarted = createDeferred<void>();
        const reevaluationProgramStarted = createDeferred<void>();
        const failure = new Error('synthetic-deferred-service-rejection');
        const saveUpdateServices = vi.fn(() => {
            deferredStarted.resolve(undefined);
            return deferredSave.promise;
        });
        const saveProgram = vi.fn(async () => {
            if (saveProgram.mock.calls.length === 2) reevaluationProgramStarted.resolve(undefined);
        });
        const { updateManage, updater } = createCoordinator(
            { saveProgram, saveUpdateServices },
            { alive: true, lastDeletedTime: 100_000, lastUpdatedTime: 0 },
        );
        const originalSend = process.send;
        const send = vi.fn();
        process.send = send as typeof process.send;

        try {
            await updater.start();
            await vi.advanceTimersByTimeAsync(10_000);
            await deferredStarted.promise;
            await Promise.resolve();
            expect(send).toHaveBeenCalledTimes(1);
            expect(deferredSave.state()).toEqual({ status: 'pending' });

            await vi.advanceTimersByTimeAsync(30_000);
            expect(updateManage.saveOnAirServices).toHaveBeenCalledTimes(1);
            expect(saveUpdateServices).toHaveBeenCalledTimes(1);
            expect(updateManage.saveService).toHaveBeenCalledTimes(1);
            expect(updateManage.saveProgram).toHaveBeenCalledTimes(1);
            expect(send).toHaveBeenCalledTimes(1);

            deferredSave.reject(failure);
            await reevaluationProgramStarted.promise;

            expect(updater.log.system.error).toHaveBeenCalledWith('failed to save update services');
            expect(send).toHaveBeenCalledTimes(1);
            expect(updateManage.saveOnAirServices).toHaveBeenCalledTimes(2);
            expect(updateManage.saveProgram).toHaveBeenCalledTimes(2);
        } finally {
            process.send = originalSend;
        }
    });

    it('[PG-MC-periodic] holds disconnected full synchronization until settlement and then re-evaluates the current time once', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const firstSync = createDeferred<void>();
        const secondSync = createDeferred<void>();
        const unexpectedThirdSync = createDeferred<void>();
        const firstStarted = createDeferred<void>();
        const secondStarted = createDeferred<void>();
        const updateAll = vi.fn(() => {
            if (updateAll.mock.calls.length === 1) {
                firstStarted.resolve(undefined);
                return firstSync.promise;
            }
            if (updateAll.mock.calls.length === 2) {
                secondStarted.resolve(undefined);
                return secondSync.promise;
            }
            return unexpectedThirdSync.promise;
        });
        const { updater } = createCoordinator(
            { updateAll },
            { alive: false, lastDeletedTime: 100_000, lastUpdatedTime: 0 },
        );

        await updater.start();
        await vi.advanceTimersByTimeAsync(10_000);
        await firstStarted.promise;
        await vi.advanceTimersByTimeAsync(90_000);

        expect(updateAll).toHaveBeenCalledTimes(1);
        firstSync.resolve(undefined);
        await secondStarted.promise;
        expect(updateAll).toHaveBeenCalledTimes(2);

        secondSync.resolve(undefined);
        await secondSync.promise;
        await vi.waitFor(() => expect(updater.isUpdateCycleActive).toBe(false));
        expect(updateAll).toHaveBeenCalledTimes(2);
        expect(unexpectedThirdSync.state()).toEqual({ status: 'pending' });
    });

    it('[PG-MC-reentry] holds deletion until settlement and uses a fresh clock for one pending re-evaluation', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const firstDeletion = createDeferred<void>();
        const secondDeletion = createDeferred<void>();
        const firstStarted = createDeferred<void>();
        const secondStarted = createDeferred<void>();
        const deleteOldPrograms = vi.fn(() => {
            if (deleteOldPrograms.mock.calls.length === 1) {
                firstStarted.resolve(undefined);
                return firstDeletion.promise;
            }
            secondStarted.resolve(undefined);
            return secondDeletion.promise;
        });
        const { updater } = createCoordinator(
            { deleteOldPrograms },
            { alive: false, lastDeletedTime: 0, lastUpdatedTime: 100_000 },
        );

        await updater.start();
        await vi.advanceTimersByTimeAsync(10_000);
        await firstStarted.promise;
        await vi.advanceTimersByTimeAsync(70_000);

        expect(deleteOldPrograms).toHaveBeenCalledTimes(1);
        firstDeletion.resolve(undefined);
        await secondStarted.promise;
        expect(deleteOldPrograms).toHaveBeenCalledTimes(2);

        secondDeletion.resolve(undefined);
        await secondDeletion.promise;
        await Promise.resolve();
        expect(deleteOldPrograms).toHaveBeenCalledTimes(2);
    });
});

/**
 * Wires the real Mirakurun change adapter, the real update manager, and the real coordinator together
 * over in-memory streams, so that what a frame does to the feed can be followed through reconnection
 * and full synchronization. Only the tuner REST reads and the database are replaced.
 */
const createMirakurunFeedHarness = () => {
    stubProcessSend();
    const streams: PassThrough[] = [];
    const adapter = new MirakurunChangeAdapter(
        vi.fn(async () => {
            const stream = new PassThrough();
            streams.push(stream);
            return stream;
        }),
    );
    const managerLog = logger();
    const updateManage = new EPGUpdateManageModel(
        { getLogger: () => managerLog },
        { getConfig: () => ({}) },
        { openChangeFeed: (observer: unknown) => adapter.open(observer) },
        {},
        {},
    ) as any;
    const updateAll = vi.spyOn(updateManage, 'updateAll').mockResolvedValue(undefined);
    const updaterLog = logger();
    const updater = new EPGUpdater(
        { getLogger: () => updaterLog },
        { getConfig: () => ({ epgUpdateIntervalTime: 1 }) },
        updateManage,
    ) as any;
    return { managerLog, streams, updateAll, updateManage, updater, updaterLog };
};

describe('program guide Mirakurun change feed to coordinator', () => {
    it('[PG-MC-stream] an invalid change frame drops the feed, reconnects after the retry wait, and synchronizes everything again', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const { managerLog, streams, updateAll, updater, updaterLog } = createMirakurunFeedHarness();

        await updater.start();
        await vi.advanceTimersByTimeAsync(0);
        await vi.waitFor(() => expect(updater.isEventStreamAlive).toBe(true));
        expect(streams).toHaveLength(1);
        expect(updateAll).toHaveBeenCalledTimes(1);

        streams[0].write(
            JSON.stringify({ resource: 'program', type: 'synthetic-invalid', data: { from: 1, to: 2 }, time: 1 }),
        );

        expect(managerLog.system.error).toHaveBeenCalledWith('tuner change feed error');
        expect(updaterLog.system.info).toHaveBeenCalledWith('has disconnected from the mirakurun');
        expect(updater.isEventStreamAlive).toBe(false);

        await vi.advanceTimersByTimeAsync(4_999);
        expect(streams).toHaveLength(1);
        expect(updateAll).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1);
        await vi.waitFor(() => expect(updateAll).toHaveBeenCalledTimes(2));
        expect(streams).toHaveLength(2);
        expect(updater.isEventStreamAlive).toBe(true);
    });

    it('[PG-MC-stream] a Mirakurun job frame neither drops the feed nor causes a reconnection or a full synchronization', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const { managerLog, streams, updateAll, updateManage, updater } = createMirakurunFeedHarness();

        await updater.start();
        await vi.advanceTimersByTimeAsync(0);
        await vi.waitFor(() => expect(updater.isEventStreamAlive).toBe(true));
        expect(updateAll).toHaveBeenCalledTimes(1);

        streams[0].write(
            JSON.stringify({
                resource: 'job',
                type: 'update',
                data: {
                    key: 'synthetic-job-key',
                    name: 'synthetic-job-name',
                    id: 'synthetic-job-id',
                    status: 'finished',
                    retryCount: 0,
                    isAborting: false,
                    createdAt: 1_000,
                    updatedAt: 1_200,
                    startedAt: 1_100,
                    finishedAt: 1_200,
                    duration: 100,
                },
                time: 2,
            }),
        );
        streams[0].write(
            JSON.stringify({
                resource: 'program',
                type: 'update',
                data: {
                    id: 7,
                    eventId: 8,
                    serviceId: 31,
                    networkId: 32,
                    startAt: 1_000,
                    duration: 60_000,
                    isFree: true,
                },
                time: 3,
            }),
        );

        expect(managerLog.system.error).not.toHaveBeenCalledWith('tuner change feed error');
        expect(updater.isEventStreamAlive).toBe(true);
        expect(updateManage.programQueue).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(5_000);
        expect(streams).toHaveLength(1);
        expect(updateAll).toHaveBeenCalledTimes(1);
    });
});
