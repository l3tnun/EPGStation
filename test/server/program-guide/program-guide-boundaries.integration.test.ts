// Must stay the very first import in this file: it registers a Node loader hook that has to be in
// place before `require(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdateExecutorManageModel.js'))`
// below can trigger that module being loaded for the first time. See the comment in that hook file for why.
import { childProcessOverrides, resetChildProcessOverrides } from './child-process-override-hook';

import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeferred } from '../harness/async';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const EPGUpdateManageModel = (require(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdateManageModel.js')) as any)
    .default;
const EPGUpdater = (require(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdater.js')) as any).default;
const EPGUpdateExecutorManageModel = (
    require(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdateExecutorManageModel.js')) as any
).default;
const { EPGUpdateEvent } = require(join(compiledSnapshot, 'model', 'epgUpdater', 'IEPGUpdateManageModel.js')) as any;

const logger = () => ({ system: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn() } });
const service = {
    id: 1,
    serviceId: 101,
    networkId: 10,
    name: 'synthetic-boundary-service',
    remoteControlKeyId: 1,
    hasLogoData: false,
    channel: { type: 'GR', channel: '1' },
};
const program = {
    id: 11,
    eventId: 11,
    serviceId: 101,
    networkId: 10,
    startAt: 1_000,
    duration: 60_000,
    isFree: true,
    name: 'synthetic-boundary-program',
};

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetChildProcessOverrides();
});

describe('Program Guide update manager/coordinator boundary', () => {
    it('[PG-MC-late-full-sync] keeps one late full synchronization across observer and interval races', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const persistence = createDeferred<void>();
        const persistenceStarted = createDeferred<void>();
        const notified = createDeferred<void>();
        const close = vi.fn();
        const tuner = {
            close,
            getPrograms: vi.fn(async () => [program]),
            getServices: vi.fn(async () => [service]),
        };
        const channelDB = {
            insert: vi.fn(async () => undefined),
            update: vi.fn(async () => undefined),
        };
        const programDB = {
            deleteOld: vi.fn(async () => undefined),
            insert: vi.fn(() => {
                persistenceStarted.resolve(undefined);
                return persistence.promise;
            }),
            update: vi.fn(async () => undefined),
        };
        const manageLogger = logger();
        const updateManage = new EPGUpdateManageModel(
            { getLogger: () => manageLogger },
            { getConfig: () => ({}) },
            tuner,
            channelDB,
            programDB,
        );
        const updater = new EPGUpdater(
            { getLogger: logger },
            { getConfig: () => ({ epgUpdateIntervalTime: 1 }) },
            updateManage,
        ) as any;
        updater.startEventStreamAnalysis = vi.fn();
        const listenerCounts = Object.fromEntries(
            updateManage.eventNames().map(name => [name, updateManage.listenerCount(name)]),
        );
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
        const originalSend = process.send;
        process.send = vi.fn(() => {
            notified.resolve(undefined);
            return true;
        }) as typeof process.send;

        try {
            await updater.start();
            updateManage.emit(EPGUpdateEvent.STREAM_STARTED);
            await persistenceStarted.promise;

            expect(tuner.getServices).toHaveBeenCalledTimes(1);
            expect(tuner.getPrograms).toHaveBeenCalledTimes(1);
            expect(programDB.insert).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(2);

            await vi.advanceTimersByTimeAsync(599_999);
            expect(manageLogger.system.error).not.toHaveBeenCalledWith('update all timeout');
            expect(tuner.getPrograms).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(
                manageLogger.system.error.mock.calls.filter(([value]: unknown[]) => value === 'update all timeout'),
            ).toHaveLength(1);
            expect(tuner.getServices).toHaveBeenCalledTimes(1);
            expect(tuner.getPrograms).toHaveBeenCalledTimes(1);
            expect(programDB.insert).toHaveBeenCalledTimes(1);
            expect(close).not.toHaveBeenCalled();
            expect(clearTimeoutSpy).not.toHaveBeenCalled();

            persistence.resolve(undefined);
            await notified.promise;
            await Promise.resolve();

            expect(process.send).toHaveBeenCalledTimes(1);
            expect(tuner.getServices).toHaveBeenCalledTimes(1);
            expect(tuner.getPrograms).toHaveBeenCalledTimes(1);
            expect(programDB.insert).toHaveBeenCalledTimes(1);
            expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(1);
            expect(
                Object.fromEntries(updateManage.eventNames().map(name => [name, updateManage.listenerCount(name)])),
            ).toEqual(listenerCounts);
        } finally {
            process.send = originalSend;
        }
    });

    it('[PG-T6.2] carries all canonical change kinds through short/full cycles and coalesces active ticks', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const feedCompletion = createDeferred<void>();
        const deferredServiceSave = createDeferred<void>();
        let observer: any;
        const deleteFailure = new Error('synthetic-delete-failure');
        const tuner = {
            getProgramsByService: vi.fn(async (serviceId: number) => [
                { ...program, id: serviceId, eventId: serviceId },
            ]),
            getServices: vi.fn(async () => [service]),
            openChangeFeed: vi.fn(async (value: any) => {
                observer = value;
                value.started();
                return { close: vi.fn(), completion: feedCompletion.promise };
            }),
        };
        const channelDB = {
            insert: vi.fn(async () => undefined),
            update: vi.fn(async () => undefined),
        };
        const programDB = {
            deleteOld: vi.fn(async () => Promise.reject(deleteFailure)),
            insert: vi.fn(async (_index: unknown, _programs: unknown[], serviceIds?: number[]) => {
                if (serviceIds?.includes(102) === true) await deferredServiceSave.promise;
            }),
            update: vi.fn(async () => undefined),
        };
        const updateManage = new EPGUpdateManageModel(
            { getLogger: logger },
            { getConfig: () => ({}) },
            tuner,
            channelDB,
            programDB,
        );
        const feedRun = updateManage.start();
        await vi.waitFor(() => expect(observer).toBeDefined());
        const updaterLogger = logger();
        const updater = new EPGUpdater(
            { getLogger: () => updaterLogger },
            { getConfig: () => ({ epgUpdateIntervalTime: 1 }) },
            updateManage,
        ) as any;
        updater.startEventStreamAnalysis = vi.fn();
        updater.isEventStreamAlive = true;
        updater.lastUpdatedTime = 100_000;
        updater.lastDeletedTime = 100_000;
        const originalSend = Object.getOwnPropertyDescriptor(process, 'send');
        const send = vi.fn(() => true);
        Object.defineProperty(process, 'send', { configurable: true, value: send, writable: true });

        try {
            await updater.start();
            observer.changed({ kind: 'program', operation: 'update', program, time: 101_000 });
            observer.changed({ kind: 'service', operation: 'update', service, time: 102_000 });
            observer.changed({ kind: 'on-air-service', serviceId: 101 });
            observer.changed({ kind: 'service-programs-updated', serviceId: 102 });

            await vi.advanceTimersByTimeAsync(10_000);
            await vi.waitFor(() => expect(programDB.update).toHaveBeenCalledTimes(1));
            expect(programDB.insert.mock.calls.map(call => call[2])).toEqual([[101]]);
            expect(channelDB.update).not.toHaveBeenCalled();
            expect(send).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(50_000);
            await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ msg: 'updated' }));
            expect(deferredServiceSave.state()).toEqual({ status: 'pending' });
            expect(updater.isUpdateCycleActive).toBe(true);
            expect(programDB.insert.mock.calls.map(call => call[2])).toEqual([[101], [102]]);
            expect(channelDB.update).toHaveBeenCalledWith({ insert: [], update: [service] });
            const fullCycleTime = updater.lastUpdatedTime;
            expect(fullCycleTime).toBeGreaterThanOrEqual(160_000);
            expect(fullCycleTime).toBeLessThan(161_000);

            await vi.advanceTimersByTimeAsync(20_000);
            expect(updater.isUpdateCycleActive).toBe(true);
            expect(updater.isUpdateCyclePending).toBe(true);
            expect(programDB.insert.mock.calls.map(call => call[2])).toEqual([[101], [102]]);
            expect(programDB.deleteOld).not.toHaveBeenCalled();

            const serviceSaveSettlementTime = Date.now();
            deferredServiceSave.resolve(undefined);
            await vi.waitFor(() => expect(programDB.deleteOld).toHaveBeenCalledTimes(1));
            await vi.waitFor(() => expect(updater.isUpdateCycleActive).toBe(false));

            expect(tuner.getProgramsByService.mock.calls.map(([serviceId]) => serviceId)).toEqual([101, 102]);
            expect(updateManage.updatedOnAirServiceIds).toEqual({});
            expect(updateManage.updateServiceIds).toEqual({});
            expect(programDB.update).toHaveBeenCalledTimes(1);
            const deletionTime = programDB.deleteOld.mock.calls[0][0];
            expect(deletionTime).toBeGreaterThanOrEqual(serviceSaveSettlementTime);
            expect(deletionTime).toBeLessThanOrEqual(Date.now());
            expect(updater.lastUpdatedTime).toBe(fullCycleTime);
            expect(updater.lastDeletedTime).toBe(fullCycleTime);
            expect(send).toHaveBeenCalledTimes(1);
            expect(updaterLogger.system.error).toHaveBeenCalledWith('delete old programs error');
            expect(updaterLogger.system.error).toHaveBeenCalledWith(deleteFailure);
        } finally {
            feedCompletion.resolve(undefined);
            await feedRun;
            if (originalSend === undefined) delete process.send;
            else Object.defineProperty(process, 'send', originalSend);
        }
    });

    it('[PG-T6.2] restores program batches and complete service ID sets after acquisition or save failure', async () => {
        const feedCompletion = createDeferred<void>();
        let observer: any;
        const getProgramsByService = vi.fn(async (serviceId: number) => [
            { ...program, id: serviceId, eventId: serviceId },
        ]);
        const tuner = {
            getProgramsByService,
            getServices: vi.fn(async () => [service]),
            openChangeFeed: vi.fn(async (value: any) => {
                observer = value;
                value.started();
                return { close: vi.fn(), completion: feedCompletion.promise };
            }),
        };
        const programSave = createDeferred<void>();
        const programDB = {
            deleteOld: vi.fn(async () => undefined),
            insert: vi.fn(async () => undefined),
            update: vi.fn(() => programSave.promise),
        };
        const updateManage = new EPGUpdateManageModel(
            { getLogger: logger },
            { getConfig: () => ({}) },
            tuner,
            { insert: vi.fn(async () => undefined), update: vi.fn(async () => undefined) },
            programDB,
        );
        const feedRun = updateManage.start();
        await vi.waitFor(() => expect(observer).toBeDefined());

        try {
            const firstProgram = Object.assign({}, program, { id: 21, eventId: 21 });
            const lateProgram = Object.assign({}, program, { id: 22, eventId: 22 });
            observer.changed({ kind: 'program', operation: 'update', program: firstProgram, time: 101_000 });
            const failedProgramSave = updateManage.saveProgram();
            await vi.waitFor(() => expect(programDB.update).toHaveBeenCalledTimes(1));
            observer.changed({ kind: 'program', operation: 'update', program: lateProgram, time: 102_000 });
            const programFailure = new Error('synthetic-program-save-failure');
            programSave.reject(programFailure);
            await expect(failedProgramSave).rejects.toBe(programFailure);

            programDB.update.mockResolvedValueOnce(undefined);
            await updateManage.saveProgram();
            expect(programDB.update.mock.calls[1][1].update.map((value: any) => value.id)).toEqual([21, 22]);

            observer.changed({ kind: 'service-programs-updated', serviceId: 201 });
            observer.changed({ kind: 'service-programs-updated', serviceId: 202 });
            const acquisitionFailure = new Error('synthetic-service-acquisition-failure');
            getProgramsByService.mockResolvedValueOnce([{ ...program, id: 201, eventId: 201 }]);
            getProgramsByService.mockRejectedValueOnce(acquisitionFailure);
            await expect(updateManage.saveUpdateServices()).rejects.toBe(acquisitionFailure);
            expect(programDB.insert).not.toHaveBeenCalled();
            expect(updateManage.updateServiceIds).toEqual({ 201: true, 202: true });

            getProgramsByService.mockResolvedValueOnce([{ ...program, id: 201, eventId: 201 }]);
            getProgramsByService.mockResolvedValueOnce([{ ...program, id: 202, eventId: 202 }]);
            const aggregateFailure = new Error('synthetic-service-save-failure');
            programDB.insert.mockRejectedValueOnce(aggregateFailure);
            await expect(updateManage.saveUpdateServices()).rejects.toBe(aggregateFailure);
            expect(updateManage.updateServiceIds).toEqual({ 201: true, 202: true });

            getProgramsByService.mockResolvedValueOnce([{ ...program, id: 201, eventId: 201 }]);
            getProgramsByService.mockResolvedValueOnce([{ ...program, id: 202, eventId: 202 }]);
            programDB.insert.mockResolvedValueOnce(undefined);
            await updateManage.saveUpdateServices();
            expect(updateManage.updateServiceIds).toEqual({});
            expect(programDB.insert.mock.calls.map(call => call[2])).toEqual([
                [201, 202],
                [201, 202],
            ]);
        } finally {
            feedCompletion.resolve(undefined);
            await feedRun;
        }
    });

    it('[PG-X-ipc] maps only the child updated payload to one parent domain outcome', async () => {
        const child = Object.assign(new EventEmitter(), {
            kill: vi.fn(),
            pid: 31_415,
            stderr: new PassThrough(),
            stdout: new PassThrough(),
        });
        const spawn = vi.fn().mockReturnValue(child as any);
        childProcessOverrides.spawn = spawn;
        const emitUpdated = vi.fn();
        const model = new EPGUpdateExecutorManageModel({ getLogger: logger }, { emitUpdated });

        try {
            await model.execute();
            child.emit('message', { msg: 'synthetic-ignored' });
            child.emit('message', { msg: 'updated' });

            expect(spawn).toHaveBeenCalledOnce();
            expect(spawn.mock.calls[0][0]).toBe(process.argv[0]);
            expect(spawn.mock.calls[0][1][0]).toMatch(/EPGUpdateExecutor\.js$/u);
            expect(spawn.mock.calls[0][2]).toEqual({ stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
            expect(emitUpdated).toHaveBeenCalledTimes(1);
        } finally {
            child.removeAllListeners();
            child.stdout.removeAllListeners();
            child.stderr.removeAllListeners();
            child.stdout.destroy();
            child.stderr.destroy();
        }
        expect(child.eventNames()).toEqual([]);
        expect(child.stdout.eventNames()).toEqual([]);
        expect(child.stderr.eventNames()).toEqual([]);
        expect(child.stdout.destroyed).toBe(true);
        expect(child.stderr.destroyed).toBe(true);
    });

    it('[PG-X-ipc] emits no parent result after child failure and removes the failed generation resources', async () => {
        const makeChild = (pid: number) =>
            Object.assign(new EventEmitter(), {
                kill: vi.fn(),
                pid,
                stderr: new PassThrough(),
                stdout: new PassThrough(),
            });
        const failedChild = makeChild(31_416);
        const replacementChild = makeChild(31_417);
        const spawn = vi
            .fn()
            .mockReturnValueOnce(failedChild as any)
            .mockReturnValueOnce(replacementChild as any);
        childProcessOverrides.spawn = spawn;
        const emitUpdated = vi.fn();
        const manageLogger = logger();
        const model = new EPGUpdateExecutorManageModel({ getLogger: () => manageLogger }, { emitUpdated });
        const failure = new Error('synthetic-epg-child-failure');

        try {
            await model.execute();
            failedChild.emit('error', failure);
            await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
            failedChild.emit('message', { msg: 'updated' });

            expect(emitUpdated).not.toHaveBeenCalled();
            expect(manageLogger.system.fatal).toHaveBeenCalledWith('epg updater is error');
            expect(manageLogger.system.error).toHaveBeenCalledWith(failure);
            expect(failedChild.eventNames()).toEqual([]);
            expect(failedChild.stdout.eventNames()).toEqual([]);
            expect(failedChild.stderr.eventNames()).toEqual([]);
            expect(replacementChild.listenerCount('message')).toBe(1);
        } finally {
            for (const child of [failedChild, replacementChild]) {
                child.removeAllListeners();
                child.stdout.removeAllListeners();
                child.stderr.removeAllListeners();
                child.stdout.destroy();
                child.stderr.destroy();
            }
        }
        expect(failedChild.stdout.destroyed).toBe(true);
        expect(failedChild.stderr.destroyed).toBe(true);
        expect(replacementChild.eventNames()).toEqual([]);
    });
});
