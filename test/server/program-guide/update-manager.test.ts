import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Container } from 'inversify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeferred } from '../harness/async';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const EPGUpdateManageModel = (require(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdateManageModel.js')) as any)
    .default;
const EPGUpdater = (require(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdater.js')) as any).default;
const containerSetter = require(join(compiledSnapshot, 'model', 'ModelContainerSetter.js')) as {
    set(container: Container): void;
};
const { EPGUpdateEvent } = require(join(compiledSnapshot, 'model', 'epgUpdater', 'IEPGUpdateManageModel.js')) as any;

const logger = () => ({ system: { debug: vi.fn(), error: vi.fn(), info: vi.fn() } });
const program = (id: number, startAt: number, overrides: Record<string, unknown> = {}) =>
    Object.assign(
        { id, serviceId: 101, networkId: 10, startAt, duration: 60_000, isFree: true },
        { eventId: id, name: `synthetic-program-${id}` },
        overrides,
    );
const model = () => {
    const value = Object.create(EPGUpdateManageModel.prototype) as any;
    value.log = logger();
    value.programQueue = [];
    value.serviceQueue = [];
    value.channelIndex = { 10: { 101: { id: 1, type: 'GR', channel: '1' } } };
    value.excludeChannelIndex = {};
    value.excludeSidIndex = {};
    value.updatedOnAirServiceIds = {};
    value.updateServiceIds = {};
    value.programDB = { insert: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(undefined) };
    value.channelDB = { insert: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(undefined) };
    value.tunerServerAccess = {
        getServices: vi.fn().mockResolvedValue([]),
        getProgramsByService: vi.fn().mockResolvedValue([]),
    };
    return value;
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('EPG update manager Risk A characterization', () => {
    it('[PG-MB-value-range] treats empty queues and empty service-ID sets as exact no-ops', async () => {
        const value = model();

        await value.saveProgram();
        await value.saveOnAirServices();
        await value.saveUpdateServices();

        expect(value.programDB.update).not.toHaveBeenCalled();
        expect(value.programDB.insert).not.toHaveBeenCalled();
        expect(value.channelDB.insert).not.toHaveBeenCalled();
        expect(value.tunerServerAccess.getProgramsByService).not.toHaveBeenCalled();
        expect(value.updatedOnAirServiceIds).toEqual({});
        expect(value.updateServiceIds).toEqual({});
    });

    it('[PG-MB-threshold] flushes before the five-minute boundary and retains events at and after the threshold', async () => {
        const value = model();
        const before = { resource: 'program', type: 'update', data: program(41, 299_999) };
        value.programQueue.push(before);
        await value.saveProgram(300_000);
        expect(value.programDB.update).toHaveBeenCalledTimes(1);

        const boundary = { resource: 'program', type: 'update', data: program(42, 300_000) };
        value.programQueue.push(boundary);
        await value.saveProgram(300_000);
        expect(value.programDB.update).toHaveBeenCalledTimes(1);
        expect(value.programQueue).toEqual([boundary]);

        const after = { resource: 'program', type: 'update', data: program(43, 300_001) };
        value.programQueue.push(after);
        await value.saveProgram(300_000);
        expect(value.programDB.update).toHaveBeenCalledTimes(1);
        expect(value.programQueue).toEqual([boundary, after]);
    });

    it('[PG-MB-order] aggregates create/update/remove notifications in observed order', async () => {
        const value = model();
        value.programQueue.push(
            { resource: 'program', type: 'create', data: program(51, 0) },
            { resource: 'program', type: 'update', data: program(51, 1, { name: 'synthetic-program-latest' }) },
            { resource: 'program', type: 'remove', data: { id: 51 } },
            { resource: 'program', type: 'update', data: program(51, 2) },
        );

        await value.saveProgram();

        expect(value.programDB.update).toHaveBeenCalledWith(value.channelIndex, {
            insert: [],
            update: [program(51, 2)],
            delete: [],
        });
    });

    it('[PG-MB-value-range] resolves redefine and duplicate IDs by the final valid event for each ID', async () => {
        const value = model();
        value.programQueue.push(
            { resource: 'program', type: 'update', data: program(61, 1) },
            { resource: 'program', type: 'redefine', data: { from: 61, to: 62 } },
            { resource: 'program', type: 'redefine', data: { from: 1.5, to: 64 } },
            { resource: 'program', type: 'redefine', data: { from: 64, to: 65 } },
            { resource: 'program', type: 'redefine', data: { from: 62, to: 63 } },
            { resource: 'program', type: 'update', data: program(62, 2) },
            { resource: 'program', type: 'create', data: program(63, 3) },
            { resource: 'program', type: 'update', data: program(63, 4, { name: 'synthetic-final-63' }) },
        );

        await value.saveProgram();

        expect(value.programDB.update).toHaveBeenCalledWith(value.channelIndex, {
            insert: [],
            update: [program(62, 2), program(63, 4, { name: 'synthetic-final-63' })],
            delete: [61, 64],
        });
        expect(value.programDB.update.mock.calls[0][1].delete).toEqual([61, 64]);
        expect(value.programDB.update.mock.calls[0][1].delete).not.toContain(1.5);
        expect(value.programDB.update.mock.calls[0][1].delete).toContain(64);
        expect(value.programDB.update.mock.calls[0][1].delete).not.toContain(undefined);
        expect(value.programQueue).toEqual([]);
    });

    it('[PG-MB-value-range] coalesces duplicate minimum and maximum service IDs before one sequential aggregate', async () => {
        const value = model();
        const maximumId = Number.MAX_SAFE_INTEGER;
        value.updateServiceIds = { 0: true, [maximumId]: true };
        value.updateServiceIds[0] = true;
        value.updateServiceIds[maximumId] = true;
        value.tunerServerAccess.getProgramsByService.mockImplementation(async (serviceId: number) => [
            program(serviceId, 0),
        ]);

        await value.saveUpdateServices();

        expect(value.tunerServerAccess.getProgramsByService.mock.calls).toEqual([[0], [maximumId]]);
        expect(value.programDB.insert).toHaveBeenCalledWith(
            value.channelIndex,
            [program(0, 0), program(maximumId, 0)],
            [0, maximumId],
        );
        expect(value.updateServiceIds).toEqual({});
    });

    it('[PG-MB-service] snapshots service IDs, fetches sequentially, saves once, and removes IDs only after success', async () => {
        const value = model();
        value.updatedOnAirServiceIds = { 71: true, 72: true };
        const calls: string[] = [];
        value.tunerServerAccess.getServices.mockImplementation(async () => {
            calls.push('channels');
            return [];
        });
        value.tunerServerAccess.getProgramsByService.mockImplementation(async (serviceId: number) => {
            calls.push(`/api/services/${serviceId}/programs`);
            return [program(serviceId, 0)];
        });
        value.programDB.insert.mockImplementation(async (_index: unknown, _programs: unknown, ids: number[]) => {
            calls.push(`save:${ids.join(',')}`);
        });

        await value.saveOnAirServices();

        expect(calls).toEqual(['channels', '/api/services/71/programs', '/api/services/72/programs', 'save:71,72']);
        expect(value.programDB.insert).toHaveBeenCalledTimes(1);
        expect(value.updatedOnAirServiceIds).toEqual({});
    });

    it('[PG-MB-service] retains the entire ID snapshot after a middle fetch rejection and performs no aggregate save', async () => {
        const value = model();
        value.updateServiceIds = { 81: true, 82: true, 83: true };
        const failure = new Error('synthetic-service-fetch-rejection');
        const getProgramsByService = vi
            .fn()
            .mockResolvedValueOnce([program(81, 0)])
            .mockRejectedValueOnce(failure);
        value.tunerServerAccess.getProgramsByService = getProgramsByService;

        await expect(value.saveUpdateServices()).rejects.toBe(failure);

        expect(getProgramsByService).toHaveBeenCalledTimes(2);
        expect(value.programDB.insert).not.toHaveBeenCalled();
        expect(value.updateServiceIds).toEqual({ 81: true, 82: true, 83: true });
    });

    it('[PG-MB-service] preserves snapshot and late arrivals when aggregate persistence rejects', async () => {
        const value = model();
        const persistence = createDeferred<void>();
        value.updateServiceIds = { 91: true };
        value.tunerServerAccess.getProgramsByService.mockResolvedValue([program(91, 0)]);
        value.programDB.insert.mockImplementation(() => persistence.promise);

        const pending = value.saveUpdateServices();
        await vi.waitFor(() => expect(value.programDB.insert).toHaveBeenCalledTimes(1));
        value.updateServiceIds[92] = true;
        const failure = new Error('synthetic-aggregate-save-rejection');
        persistence.reject(failure);
        await expect(pending).rejects.toBe(failure);

        expect(value.updateServiceIds).toEqual({ 91: true, 92: true });
    });

    it('[PG-MB-service] deferred update notification occurs before the service aggregate settles', async () => {
        const persistence = createDeferred<void>();
        const updateManage = {
            saveOnAirServices: vi.fn().mockResolvedValue(undefined),
            saveUpdateServices: vi.fn(() => persistence.promise),
            saveService: vi.fn().mockResolvedValue(undefined),
            saveProgram: vi.fn().mockResolvedValue(undefined),
        };
        const updater = Object.create(EPGUpdater.prototype) as any;
        updater.updateManage = updateManage;
        updater.lastUpdatedTime = 0;
        updater.log = logger();
        const originalSend = process.send;
        const send = vi.fn();
        process.send = send as typeof process.send;
        let settled = false;

        try {
            const operation = updater.updateTunerChanges(60_000, 60_000).then(() => {
                settled = true;
            });
            await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ msg: 'updated' }));

            expect(updateManage.saveUpdateServices).toHaveBeenCalledTimes(1);
            expect(persistence.state()).toEqual({ status: 'pending' });
            expect(settled).toBe(false);
            persistence.resolve(undefined);
            await operation;
            expect(settled).toBe(true);
        } finally {
            process.send = originalSend;
        }
    });

    it('[PG-MB-service] logs a deferred service aggregate failure without an unhandled rejection', async () => {
        const failure = new Error('SYNTHETIC_DETACHED_SERVICE_SAVE_FAILURE');
        const updateManage = {
            saveOnAirServices: vi.fn().mockResolvedValue(undefined),
            saveUpdateServices: vi.fn().mockRejectedValue(failure),
            saveService: vi.fn().mockResolvedValue(undefined),
            saveProgram: vi.fn().mockResolvedValue(undefined),
        };
        const updater = Object.create(EPGUpdater.prototype) as any;
        const log = logger();
        updater.updateManage = updateManage;
        updater.lastUpdatedTime = 0;
        updater.log = log;
        const originalSend = process.send;
        const send = vi.fn();
        process.send = send as typeof process.send;
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on('unhandledRejection', onUnhandled);

        try {
            await updater.updateTunerChanges(60_000, 60_000);
            await new Promise(resolve => setImmediate(resolve));

            expect(send).toHaveBeenCalledWith({ msg: 'updated' });
            expect(log.system.error).toHaveBeenCalledWith('failed to save update services');
            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', onUnhandled);
            process.send = originalSend;
        }
    });
});

describe('Program Guide tuner dependency direction', () => {
    it('[PG-T4.2/4.4] injects the same canonical tuner runtime instance into update and logo consumers', () => {
        const container = new Container({ skipBaseClassChecks: true });
        containerSetter.set(container);
        const canonicalTuner = Object.freeze({ identity: 'synthetic-canonical-tuner' });
        const otherTuner = Object.freeze({ identity: 'synthetic-other-tuner' });
        container.rebind('TunerServerAccess').toConstantValue(canonicalTuner);
        container.rebind('ILoggerModel').toConstantValue({ getLogger: logger });
        container.rebind('IConfiguration').toConstantValue({ getConfig: () => ({}) });
        container.rebind('IChannelDB').toConstantValue({});
        container.rebind('IProgramDB').toConstantValue({});

        const updateManager = container.get<any>('IEPGUpdateManageModel');
        const channelApi = container.get<any>('IChannelApiModel');
        const sharesCanonicalTuner = (expected: unknown, update: any, query: any): boolean =>
            update.tunerServerAccess === expected && query.tunerServerAccess === expected;

        expect(container.get('TunerServerAccess')).toBe(canonicalTuner);
        expect(sharesCanonicalTuner(canonicalTuner, updateManager, channelApi)).toBe(true);
        expect(sharesCanonicalTuner(otherTuner, updateManager, channelApi)).toBe(false);
        expect(sharesCanonicalTuner(canonicalTuner, updateManager, { tunerServerAccess: otherTuner })).toBe(false);
        expect(sharesCanonicalTuner(canonicalTuner, { tunerServerAccess: otherTuner }, channelApi)).toBe(false);
    });
});
