import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferred } from '../harness/async';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const EPGUpdateManageModel = (require(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdateManageModel.js')) as any)
    .default;
const ProgramDB = (require(join(compiledSnapshot, 'model', 'db', 'ProgramDB.js')) as any).default;
const ScheduleApiModel = (require(join(compiledSnapshot, 'model', 'api', 'schedule', 'ScheduleApiModel.js')) as any)
    .default;
const ChannelApiModel = (require(join(compiledSnapshot, 'model', 'api', 'channel', 'ChannelApiModel.js')) as any)
    .default;
const EPGUpdater = (require(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdater.js')) as any).default;
const TunerServerAccessModel = (require(join(compiledSnapshot, 'model', 'tuner', 'TunerServerAccessModel.js')) as any)
    .default;
const Util = (require(join(compiledSnapshot, 'util', 'Util.js')) as any).default;
const { IChannelApiModelError } = require(
    join(compiledSnapshot, 'model', 'api', 'channel', 'IChannelApiModel.js'),
) as any;
const { EPGUpdateEvent } = require(join(compiledSnapshot, 'model', 'epgUpdater', 'IEPGUpdateManageModel.js')) as any;

const logger = () => ({ system: { debug: vi.fn(), error: vi.fn(), info: vi.fn() } });
let processSendDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
    processSendDescriptor = Object.getOwnPropertyDescriptor(process, 'send');
    Object.defineProperty(process, 'send', {
        configurable: true,
        value: vi.fn(() => true),
        writable: true,
    });
});
const service = (id: number, serviceId: number, overrides: Record<string, unknown> = {}) =>
    Object.assign(
        {
            id,
            serviceId,
            networkId: 10,
            name: `synthetic-service-${id}`,
            remoteControlKeyId: id,
            hasLogoData: id % 2 === 0,
            channel: { type: 'GR', channel: `${id}` },
        },
        overrides,
    );
const program = (id: number, overrides: Record<string, unknown> = {}) =>
    Object.assign(
        { id, serviceId: 101, networkId: 10, startAt: 1_000, duration: 60_000, isFree: true },
        { eventId: id, name: `synthetic-program-${id}` },
        overrides,
    );
// TypeORM 1.x は空 criteria の delete を拒否するため、全件差し替えは
// manager.createQueryBuilder().delete().from(Entity).execute() を通る。mock の manager が
// この chain を持たないと `queryRunner.manager.createQueryBuilder is not a function` になる。
const deleteQueryBuilder = () => {
    const builder = {
        delete: vi.fn(),
        execute: vi.fn().mockResolvedValue(undefined),
        from: vi.fn(),
    };
    builder.delete.mockReturnValue(builder);
    builder.from.mockReturnValue(builder);
    return builder;
};
const projectionRunner = () => ({
    startTransaction: vi.fn().mockResolvedValue(undefined),
    commitTransaction: vi.fn().mockResolvedValue(undefined),
    rollbackTransaction: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    manager: {
        createQueryBuilder: vi.fn(() => deleteQueryBuilder()),
        delete: vi.fn().mockResolvedValue(undefined),
        insert: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
    },
});

const createModel = (
    options: {
        services?: unknown[];
        programs?: unknown[];
        excludeChannels?: number[];
        excludeSids?: number[];
    } = {},
) => {
    const client = {
        getPrograms: vi.fn().mockResolvedValue(options.programs ?? []),
        getServices: vi.fn().mockResolvedValue(options.services ?? []),
    };
    const channelDB = { insert: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(undefined) };
    const programDB = {
        deleteOld: vi.fn().mockResolvedValue(undefined),
        insert: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
    };
    const model = new EPGUpdateManageModel(
        { getLogger: logger },
        {
            getConfig: () => ({
                excludeChannels: options.excludeChannels,
                excludeSids: options.excludeSids,
                mirakurunPath: 'http://program-guide.invalid/',
            }),
        },
        client,
        channelDB,
        programDB,
    );
    return { channelDB, client, model, programDB };
};

const createCanonicalTunerModel = (portOverrides: Record<string, unknown> = {}) => {
    const tuner = {
        getPrograms: vi.fn(async () => []),
        getServices: vi.fn(async () => []),
        openChangeFeed: vi.fn(),
        ...portOverrides,
    };
    const channelDB = { insert: vi.fn(async () => undefined), update: vi.fn(async () => undefined) };
    const programDB = {
        deleteOld: vi.fn(async () => undefined),
        insert: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined),
    };
    const model = new EPGUpdateManageModel(
        { getLogger: logger },
        { getConfig: () => ({}) },
        tuner,
        channelDB,
        programDB,
    );
    return { channelDB, model, programDB, tuner };
};

type CanonicalSpecCase = {
    readonly id: string;
    readonly title: string;
    readonly verify: () => Promise<void> | void;
};

const canonicalCase = (id: string, title: string, verify: CanonicalSpecCase['verify']): CanonicalSpecCase => ({
    id,
    title,
    verify,
});

const observeChannelSynchronization = async () => {
    const included = service(1, 101, { name: 'synthetic-service-１', type: 1 });
    const disappeared = service(4, 104);
    const excludedByChannel = service(2, 102);
    const excludedBySid = service(3, 103);
    const harness = createModel({ excludeChannels: [2, 2], excludeSids: [103] });
    harness.client.getServices
        .mockResolvedValueOnce([included, disappeared, excludedByChannel, excludedBySid])
        .mockResolvedValueOnce([included]);

    await harness.model.updateChannels();
    await harness.model.updateChannels();

    return { disappeared, included, ...harness };
};

const observeServiceChanges = async () => {
    const created = service(11, 111, { hasLogoData: false });
    const updated = service(12, 112, { name: 'synthetic-service-updated', hasLogoData: false });
    const removed = service(13, 113);
    const harness = createModel({ services: [service(11, 111), service(12, 112)] });
    const outcomes: string[] = [];
    harness.model.on(EPGUpdateEvent.SERVICE_UPDATED, () => outcomes.push('updated'));
    harness.model.serviceQueue.push(
        { resource: 'service', type: 'create', data: created },
        { resource: 'service', type: 'update', data: updated },
        { resource: 'service', type: 'remove', data: removed },
    );

    await harness.model.saveService();

    return { created, outcomes, removed, updated, ...harness };
};

const observeFullProgramSynchronization = async () => {
    vi.useFakeTimers();
    const main = program(21, { relatedItems: [{ type: 'shared', eventId: 21, serviceId: 101 }] });
    const secondary = program(22, { relatedItems: [{ type: 'shared', eventId: 21, serviceId: 101 }] });
    const relay = program(23, { relatedItems: [{ type: 'relay', eventId: 24, serviceId: 101 }] });
    const nameless = program(24, { name: undefined });
    const harness = createModel({
        services: [service(1, 101)],
        programs: [main, secondary, relay, nameless],
    });
    const queryRunner = projectionRunner();
    harness.model.programDB = new ProgramDB(
        { getLogger: logger },
        { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) },
        { getConnection: async () => ({ createQueryRunner: () => queryRunner }) },
        { run: (operation: () => unknown) => operation() },
    );

    await harness.model.updateAll();

    return {
        ...harness,
        queryRunner,
        saved: queryRunner.manager.insert.mock.calls.map(call => call[1]),
    };
};

const observeProgramAggregation = async () => {
    const harness = createModel();
    const outcomes: string[] = [];
    harness.model.channelIndex = { 10: { 101: { id: 1, type: 'GR', channel: '1' } } };
    harness.model.on(EPGUpdateEvent.PROGRAM_UPDATED, () => outcomes.push('updated'));
    harness.model.programQueue.push(
        { resource: 'program', type: 'create', data: program(31, { name: 'synthetic-created' }) },
        { resource: 'program', type: 'update', data: program(31, { name: 'synthetic-updated' }) },
        { resource: 'program', type: 'remove', data: { id: 31 } },
        { resource: 'program', type: 'update', data: program(31, { name: 'synthetic-final' }) },
    );

    await harness.model.saveProgram();

    return { outcomes, ...harness };
};

const observeShortProgramFlush = async () => {
    const harness = createModel();
    harness.model.channelIndex = { 10: { 101: { id: 1, type: 'GR', channel: '1' } } };
    const before = { resource: 'program', type: 'update', data: program(32, { startAt: 299_999 }) };
    const atBoundary = { resource: 'program', type: 'update', data: program(33, { startAt: 300_000 }) };
    harness.model.programQueue.push(before, atBoundary);

    await harness.model.saveProgram(300_000);

    return { atBoundary, before, ...harness };
};

const observeConfiguredProgramFlush = async () => {
    const updateManage = {
        saveOnAirServices: vi.fn(async () => undefined),
        saveUpdateServices: vi.fn(async () => undefined),
        saveService: vi.fn(async () => undefined),
        saveProgram: vi.fn(async () => undefined),
    };
    const updater = Object.create(EPGUpdater.prototype) as any;
    updater.updateManage = updateManage;
    updater.lastUpdatedTime = 100_000;
    updater.log = logger();

    await updater.updateTunerChanges(60_000, 159_999);
    const beforeBoundary = {
        programCalls: updateManage.saveProgram.mock.calls.map((call: unknown[]) => [...call]),
        serviceCalls: updateManage.saveService.mock.calls.length,
    };
    await updater.updateTunerChanges(60_000, 160_000);

    return { beforeBoundary, updateManage, updater };
};

const observeProgramSaveFailure = async () => {
    const first = { resource: 'program', type: 'update', data: program(34) };
    const late = { resource: 'program', type: 'update', data: program(35) };
    const failure = new Error('synthetic-program-save-rejection');
    const harness = createModel();
    const outcomes: string[] = [];
    harness.model.channelIndex = { 10: { 101: { id: 1, type: 'GR', channel: '1' } } };
    harness.model.on(EPGUpdateEvent.PROGRAM_UPDATED, () => outcomes.push('updated'));
    harness.programDB.update.mockImplementation(async () => {
        harness.model.programQueue.push(late);
        throw failure;
    });
    harness.model.programQueue.push(first);

    await expect(harness.model.saveProgram()).rejects.toBe(failure);

    return { failure, first, late, outcomes, ...harness };
};

const observeStreamSynchronization = async (rejectSynchronization: boolean) => {
    const failure = new Error('synthetic-full-synchronization-rejection');
    const updateManage = Object.assign(new EventEmitter(), {
        updateAll: rejectSynchronization ? vi.fn().mockRejectedValue(failure) : vi.fn().mockResolvedValue(undefined),
    });
    const updater = new EPGUpdater(
        { getLogger: logger },
        { getConfig: () => ({ epgUpdateIntervalTime: 1 }) },
        updateManage,
    ) as any;

    updateManage.emit(EPGUpdateEvent.STREAM_STARTED);
    await vi.waitFor(() => expect(updateManage.updateAll).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(updater.isUpdateCycleActive).toBe(false));

    return { failure, updateManage, updater };
};

const observeUnsequencedChanges = async () => {
    const changed = program(36);
    const openChangeFeed = vi.fn(async (observer: any) => {
        observer.started();
        observer.changed({ kind: 'program', operation: 'update', program: changed, time: 2_000 });
        observer.changed({ kind: 'program', operation: 'update', program: changed, time: 2_000 });
        return { close: vi.fn(), completion: Promise.resolve() };
    });
    const harness = createCanonicalTunerModel({ openChangeFeed });

    await harness.model.start();

    return { changed, ...harness };
};

const projectCanonicalProgram = async (
    overrides: Record<string, unknown> = {},
    needToReplaceEnclosingCharacters = false,
) => {
    const queryRunner = projectionRunner();
    const database = new ProgramDB(
        { getLogger: logger },
        { getConfig: () => ({ needToReplaceEnclosingCharacters }) },
        { getConnection: async () => ({ createQueryRunner: () => queryRunner }) },
        { run: (operation: () => unknown) => operation() },
    );
    const source = program(201, overrides);

    await database.insert({ 10: { 101: { id: 1, type: 'GR', channel: '1' } } }, [source]);

    return { queryRunner, saved: queryRunner.manager.insert.mock.calls[0]?.[1], source };
};

const canonicalStoredChannel = (overrides: Record<string, unknown> = {}) => ({
    id: 51,
    serviceId: 151,
    networkId: 10,
    name: 'synthetic-channel-５１',
    halfWidthName: 'synthetic-channel-51',
    remoteControlKeyId: 5,
    hasLogoData: true,
    channelTypeId: 0,
    channelType: 'GR',
    channel: '51',
    type: 1,
    ...overrides,
});

const canonicalStoredProgram = (id: number, overrides: Record<string, unknown> = {}) => ({
    id,
    channelId: 51,
    eventId: id,
    serviceId: 151,
    networkId: 10,
    startAt: 1_000,
    endAt: 2_000,
    duration: 1_000,
    isFree: true,
    name: `synthetic-program-${id}-Ａ`,
    halfWidthName: `synthetic-program-${id}-A`,
    description: `synthetic-description-${id}-Ｂ`,
    halfWidthDescription: `synthetic-description-${id}-B`,
    extended: `◇heading\nsynthetic-extended-${id}-Ｃ`,
    halfWidthExtended: `◇heading\nsynthetic-extended-${id}-C`,
    rawExtended: JSON.stringify({ heading: `synthetic-extended-${id}-Ｃ` }),
    rawHalfWidthExtended: JSON.stringify({ heading: `synthetic-extended-${id}-C` }),
    genre1: 1,
    subGenre1: 2,
    genre2: null,
    subGenre2: null,
    genre3: null,
    subGenre3: null,
    videoType: null,
    videoResolution: null,
    videoComponentType: null,
    videoStreamContent: null,
    audioSamplingRate: null,
    audioComponentType: null,
    ...overrides,
});

const observeScheduleList = async (overrides: Record<string, unknown> = {}) => {
    const channel = canonicalStoredChannel();
    const programs = [
        canonicalStoredProgram(301, { startAt: 0, endAt: 1_000 }),
        canonicalStoredProgram(302, { startAt: 2_000, endAt: 3_000 }),
    ];
    const channelDB = { findChannleTypes: vi.fn().mockResolvedValue([channel]) };
    const programDB = { findSchedule: vi.fn().mockResolvedValue(programs) };
    const model = new ScheduleApiModel(channelDB, programDB);
    const option = {
        GR: true,
        startAt: 1_000,
        endAt: 2_000,
        isHalfWidth: false,
        ...overrides,
    };
    const result = await model.getSchedules(option);
    return { channel, channelDB, model, option, programDB, programs, result };
};

const observeChannelSchedule = async () => {
    const channel = canonicalStoredChannel();
    const programs = [canonicalStoredProgram(303), canonicalStoredProgram(304, { startAt: 86_401_000 })];
    const channelDB = { findId: vi.fn().mockResolvedValue(channel) };
    const programDB = {
        findSchedule: vi.fn().mockResolvedValueOnce([programs[0]]).mockResolvedValueOnce([programs[1]]),
    };
    const model = new ScheduleApiModel(channelDB, programDB);
    const result = await model.getChannelSchedule({ channelId: 51, startAt: 1_000, days: 2, isHalfWidth: false });
    return { channel, channelDB, model, programDB, programs, result };
};

const observeBroadcastingSchedule = async () => {
    const channel = canonicalStoredChannel();
    const programs = [canonicalStoredProgram(305), canonicalStoredProgram(306)];
    const channelDB = { findAll: vi.fn().mockResolvedValue([channel]) };
    const programDB = { findBroadcasting: vi.fn().mockResolvedValue(programs) };
    const model = new ScheduleApiModel(channelDB, programDB);
    const result = await model.getBroadcastingSchedule({ isHalfWidth: false, time: 500 });
    return { channel, channelDB, model, programDB, programs, result };
};

const observeDetail = async (isHalfWidth: boolean, found = true) => {
    const stored = canonicalStoredProgram(307);
    const programDB = { findId: vi.fn().mockResolvedValue(found ? stored : null) };
    const model = new ScheduleApiModel({}, programDB);
    const result = await model.getSchedule(307, isHalfWidth);
    return { model, programDB, result, stored };
};

const observeSearch = async (
    searchOption: Record<string, unknown>,
    rows = [canonicalStoredProgram(308), canonicalStoredProgram(309, { startAt: 2_000 })],
    limit: number | undefined = undefined,
) => {
    const programDB = { findRule: vi.fn().mockResolvedValue(rows) };
    const model = new ScheduleApiModel({}, programDB);
    const result = await model.search(searchOption, false, limit);
    return { model, programDB, result, rows, searchOption };
};

const observeFullAcquisitionFailure = async () => {
    vi.useFakeTimers();
    const failure = new Error('synthetic-full-acquisition-rejection');
    const harness = createCanonicalTunerModel({ getServices: vi.fn().mockRejectedValue(failure) });

    await expect(harness.model.updateAll()).rejects.toBe(failure);

    return { failure, ...harness };
};

const observeReconnectBackoff = async (retryCount: number) => {
    const failure = new Error('synthetic-feed-rejection');
    const sleep = vi.spyOn(Util, 'sleep').mockResolvedValue(undefined);
    const updater = Object.create(EPGUpdater.prototype) as any;
    updater.log = logger();
    updater.updateManage = { start: vi.fn().mockRejectedValue(failure) };
    updater.retryCount = retryCount;

    await updater.runEventStreamAttempt();

    return { failure, sleep, updater };
};

const observeContinuedReconnect = async () => {
    const pending = createDeferred<void>();
    const start = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(() => pending.promise);
    const sleep = vi.spyOn(Util, 'sleep').mockResolvedValue(undefined);
    const updater = Object.create(EPGUpdater.prototype) as any;
    updater.log = logger();
    updater.updateManage = { start };
    updater.retryCount = 0;

    const loop = updater.startEventStreamAnalysis();
    void loop.catch(() => undefined);
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));

    return { loop, pending, sleep, start, updater };
};

const observeDeletionAfterUpdateFailure = async (deleteFailure?: Error) => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const updateFailure = new Error('synthetic-periodic-update-rejection');
    const deleteOldPrograms = deleteFailure
        ? vi.fn().mockRejectedValue(deleteFailure)
        : vi.fn().mockResolvedValue(undefined);
    const updater = Object.create(EPGUpdater.prototype) as any;
    updater.log = logger();
    updater.config = { epgUpdateIntervalTime: 1 };
    updater.updateManage = {
        deleteOldPrograms,
        updateAll: vi.fn().mockRejectedValue(updateFailure),
    };
    updater.isEventStreamAlive = false;
    updater.lastUpdatedTime = 0;
    updater.lastDeletedTime = 0;

    await updater.updatePeriodically.call(updater);

    return { deleteFailure, deleteOldPrograms, updateFailure, updater };
};

const observePendingPeriodicCycle = async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const first = createDeferred<void>();
    const second = createDeferred<void>();
    let concurrent = 0;
    let maximumConcurrent = 0;
    const pending = [first, second];
    const saveProgram = vi.fn(() => {
        const current = pending[saveProgram.mock.calls.length - 1];
        concurrent++;
        maximumConcurrent = Math.max(maximumConcurrent, concurrent);
        return current.promise.finally(() => {
            concurrent--;
        });
    });
    const updateManage = Object.assign(new EventEmitter(), {
        deleteOldPrograms: vi.fn(async () => undefined),
        saveOnAirServices: vi.fn(async () => undefined),
        saveProgram,
        saveService: vi.fn(async () => undefined),
        saveUpdateServices: vi.fn(async () => undefined),
        start: vi.fn(async () => undefined),
        updateAll: vi.fn(async () => undefined),
    });
    const updater = new EPGUpdater(
        { getLogger: logger },
        { getConfig: () => ({ epgUpdateIntervalTime: 1 }) },
        updateManage,
    ) as any;
    updater.isEventStreamAlive = true;
    updater.lastUpdatedTime = 100_000;
    updater.lastDeletedTime = 100_000;
    updater.startEventStreamAnalysis = vi.fn();

    await updater.start();
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(saveProgram).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000);
    const whilePending = {
        active: updater.isUpdateCycleActive,
        calls: saveProgram.mock.calls.length,
        pending: updater.isUpdateCyclePending,
        timerCount: vi.getTimerCount(),
    };

    first.resolve(undefined);
    await vi.waitFor(() => expect(saveProgram).toHaveBeenCalledTimes(2));
    const afterSettlement = {
        active: updater.isUpdateCycleActive,
        calls: saveProgram.mock.calls.length,
        pending: updater.isUpdateCyclePending,
    };
    second.resolve(undefined);
    await vi.waitFor(() => expect(updater.isUpdateCycleActive).toBe(false));

    return { afterSettlement, concurrent, maximumConcurrent, saveProgram, updater, whilePending };
};

const observeLateFullSynchronization = async (settlement: 'resolve' | 'reject') => {
    vi.useFakeTimers();
    const programs = createDeferred<unknown[]>();
    const failure = new Error('synthetic-late-program-rejection');
    const harness = createCanonicalTunerModel({
        getPrograms: vi.fn(() => programs.promise),
        getServices: vi.fn(async () => [service(1, 101)]),
    });
    let resolutions = 0;
    let rejections = 0;
    const operation = harness.model.updateAll().then(
        () => {
            resolutions++;
        },
        (error: Error) => {
            rejections++;
            throw error;
        },
    );
    if (settlement === 'reject') void operation.catch(() => undefined);
    await vi.waitFor(() => expect(harness.tuner.getPrograms).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(600_000);
    const afterObserver = {
        errorCount: harness.model.log.system.error.mock.calls.filter(
            ([value]: unknown[]) => value === 'update all timeout',
        ).length,
        programInsertCalls: harness.programDB.insert.mock.calls.length,
        resolutions,
        rejections,
        state: programs.state(),
    };

    if (settlement === 'resolve') {
        programs.resolve([program(401)]);
        await expect(operation).resolves.toBeUndefined();
    } else {
        programs.reject(failure);
        await expect(operation).rejects.toBe(failure);
    }

    return { afterObserver, failure, harness, resolutions, rejections };
};

const observeServiceAggregate = async (failAtSecondRequest = false) => {
    const harness = createModel();
    harness.model.updatedOnAirServiceIds = { 71: true, 72: true };
    const calls: string[] = [];
    const failure = new Error('synthetic-service-prefix-rejection');
    const getProgramsByService = vi.fn(async (serviceId: number) => {
        calls.push(`programs:${serviceId}`);
        if (failAtSecondRequest && serviceId === 72) throw failure;
        return [program(serviceId)];
    });
    harness.model.tunerServerAccess = {
        getServices: vi.fn(async () => {
            calls.push('channels');
            return [];
        }),
        getProgramsByService,
    };
    harness.programDB.insert.mockImplementation(async (_index: unknown, _programs: unknown, ids: number[]) => {
        calls.push(`save:${ids.join(',')}`);
    });

    const operation = harness.model.saveOnAirServices();
    if (failAtSecondRequest) await expect(operation).rejects.toBe(failure);
    else await operation;

    return { calls, failure, getProgramsByService, ...harness };
};

const observeServiceRequestDeadline = async () => {
    vi.useFakeTimers();
    const response = createDeferred<unknown>();
    let requestSignal: AbortSignal | undefined;
    const tuner = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
        getJson: vi.fn((_path: string, options: { signal: AbortSignal }) => {
            requestSignal = options.signal;
            return response.promise;
        }),
    });
    const operation = tuner.getProgramsByService(71).then(
        () => undefined,
        (error: Error) => error,
    );

    await vi.advanceTimersByTimeAsync(29_999);
    const before = { aborted: requestSignal?.aborted, timerCount: vi.getTimerCount() };
    await vi.advanceTimersByTimeAsync(1);
    const error = await operation;

    return { before, error, requestSignal, response, tuner };
};

const observeProductIndependentResult = async (provider: 'mirakurun' | 'mirakc') => {
    vi.useFakeTimers();
    const canonicalService = service(1, 101, { hasLogoData: true });
    const canonicalProgram = program(501);
    const canonicalChange = program(502);
    const logo = Buffer.from('synthetic-product-independent-logo');
    const tuner = {
        getLogo: vi.fn(async () => logo),
        getPrograms: vi.fn(async () => [canonicalProgram]),
        getServices: vi.fn(async () => [canonicalService]),
        openChangeFeed: vi.fn(async (observer: any) => {
            observer.started();
            observer.changed({ kind: 'program', operation: 'update', program: canonicalChange, time: 3_000 });
            return { close: vi.fn(), completion: Promise.resolve() };
        }),
    };
    const harness = createCanonicalTunerModel(tuner);

    await harness.model.updateAll();
    await harness.model.start();
    await harness.model.saveProgram();
    const logoModel = new ChannelApiModel(
        { findId: vi.fn(async () => canonicalStoredChannel({ hasLogoData: true })) },
        tuner,
    );
    const receivedLogo = await logoModel.getLogo(51);

    return {
        provider,
        result: {
            channelSnapshot: harness.channelDB.insert.mock.calls[0][0],
            fullProgramSnapshot: harness.programDB.insert.mock.calls[0][1],
            incrementalPrograms: harness.programDB.update.mock.calls[0][1],
            logo: receivedLogo.toString('hex'),
        },
        tuner,
    };
};

const canonicalSpecCases: CanonicalSpecCase[] = [
    canonicalCase('PG-S-001', 'acquires the service snapshot once for each full channel synchronization', async () => {
        const observation = await observeChannelSynchronization();
        expect(observation.client.getServices.mock.calls).toEqual([[], []]);
    }),
    canonicalCase('PG-S-002', 'applies channel and service exclusions before persistence', async () => {
        const observation = await observeChannelSynchronization();
        expect(observation.channelDB.insert).toHaveBeenNthCalledWith(1, [
            observation.included,
            observation.disappeared,
        ]);
    }),
    canonicalCase('PG-S-003', 'passes every available service field to the channel persistence boundary', async () => {
        const observation = await observeChannelSynchronization();
        expect(observation.channelDB.insert.mock.calls[0][0][0]).toMatchObject({
            id: 1,
            serviceId: 101,
            networkId: 10,
            name: 'synthetic-service-１',
            remoteControlKeyId: 1,
            hasLogoData: false,
            channel: { type: 'GR', channel: '1' },
            type: 1,
        });
    }),
    canonicalCase('PG-S-004', 'persists service create and update notifications', async () => {
        const observation = await observeServiceChanges();
        expect(observation.channelDB.update).toHaveBeenCalledWith({
            insert: [observation.created],
            update: [expect.objectContaining({ id: observation.updated.id, name: observation.updated.name })],
        });
        expect(observation.outcomes).toEqual(['updated']);
    }),
    canonicalCase('PG-S-005', 'does not delete a channel or its programs for a remove notification alone', async () => {
        const observation = await observeServiceChanges();
        const persisted = observation.channelDB.update.mock.calls[0][0];
        expect([...persisted.insert, ...persisted.update].map((value: { id: number }) => value.id)).not.toContain(
            observation.removed.id,
        );
        expect(observation.channelDB).not.toHaveProperty('delete');
    }),
    canonicalCase('PG-S-006', 'passes a later complete snapshot without channels that disappeared', async () => {
        const observation = await observeChannelSynchronization();
        expect(observation.channelDB.insert).toHaveBeenNthCalledWith(2, [observation.included]);
        expect(observation.model.channelIndex).toEqual({ 10: { 101: { id: 1, type: 'GR', channel: '1' } } });
    }),
    canonicalCase('PG-S-007', 'acquires programs during a full synchronization', async () => {
        const observation = await observeFullProgramSynchronization();
        expect(observation.client.getPrograms).toHaveBeenCalledOnce();
        expect(observation.saved).toHaveLength(2);
    }),
    canonicalCase('PG-S-008', 'selects only central programs from related program information', async () => {
        const observation = await observeFullProgramSynchronization();
        expect(observation.saved.map(value => value.id)).toEqual([21, 23]);
    }),
    canonicalCase(
        'PG-S-009',
        'coalesces consecutive changes for the same program to the final valid operation',
        async () => {
            const observation = await observeProgramAggregation();
            expect(observation.programDB.update).toHaveBeenCalledWith(observation.model.channelIndex, {
                insert: [],
                update: [expect.objectContaining({ id: 31, name: 'synthetic-final' })],
                delete: [],
            });
        },
    ),
    canonicalCase(
        'PG-S-010',
        'flushes the owned batch when it contains a program before the five-minute threshold',
        async () => {
            const observation = await observeShortProgramFlush();
            expect(observation.programDB.update).toHaveBeenCalledOnce();
            expect(
                observation.programDB.update.mock.calls[0][1].update.map((value: { id: number }) => value.id),
            ).toEqual([32, 33]);
            expect(observation.model.programQueue).toEqual([]);
        },
    ),
    canonicalCase(
        'PG-S-011',
        'switches from threshold flush to the configured full flush at the exact interval',
        async () => {
            const observation = await observeConfiguredProgramFlush();
            expect(observation.beforeBoundary).toEqual({ programCalls: [[459_999]], serviceCalls: 0 });
            expect(observation.updateManage.saveService).toHaveBeenCalledOnce();
            expect(observation.updateManage.saveProgram).toHaveBeenLastCalledWith();
        },
    ),
    canonicalCase('PG-S-012', 'emits one program-updated result after incremental persistence succeeds', async () => {
        const observation = await observeProgramAggregation();
        expect(observation.outcomes).toEqual(['updated']);
    }),
    canonicalCase(
        'PG-S-013',
        'restores the failed owned program batch before changes received during persistence',
        async () => {
            const observation = await observeProgramSaveFailure();
            expect(observation.model.programQueue).toEqual([observation.first, observation.late]);
            expect(observation.outcomes).toEqual([]);
        },
    ),
    canonicalCase('PG-S-014', 'attempts one full synchronization for a started change stream', async () => {
        const observation = await observeStreamSynchronization(false);
        expect(observation.updateManage.updateAll).toHaveBeenCalledOnce();
        expect(observation.updater.isEventStreamAlive).toBe(true);
    }),
    canonicalCase('PG-S-015', 'continues change processing after the stream-start synchronization fails', async () => {
        const observation = await observeStreamSynchronization(true);
        expect(observation.updater.isEventStreamAlive).toBe(true);
        expect(observation.updater.log.system.error).toHaveBeenCalledWith('updateAll error');
    }),
    canonicalCase(
        'PG-S-016',
        'keeps duplicate normalized changes without a cross-connection sequence cursor',
        async () => {
            const observation = await observeUnsequencedChanges();
            expect(observation.model.programQueue).toHaveLength(2);
            expect(observation.model).not.toHaveProperty('sequence');
            expect(observation.model).not.toHaveProperty('cursor');
        },
    ),
    canonicalCase('PG-S-017', 'skips a program that has no name', async () => {
        const observation = await projectCanonicalProgram({ name: undefined });
        expect(observation.saved).toBeUndefined();
        expect(observation.queryRunner.manager.insert).not.toHaveBeenCalled();
    }),
    canonicalCase('PG-S-018', 'persists the available program identity channel and time fields', async () => {
        const observation = await projectCanonicalProgram({ duration: 60_000, isFree: false, startAt: 10_000 });
        expect(observation.saved).toMatchObject({
            id: 201,
            eventId: 201,
            serviceId: 101,
            networkId: 10,
            channelId: 1,
            channelType: 'GR',
            channel: '1',
            startAt: 10_000,
            endAt: 70_000,
            duration: 60_000,
            isFree: false,
        });
    }),
    canonicalCase('PG-S-019', 'stores missing and empty descriptions as unset', async () => {
        const missing = await projectCanonicalProgram({ description: undefined });
        const empty = await projectCanonicalProgram({ description: '' });
        expect([missing.saved.description, empty.saved.description]).toEqual([null, null]);
        expect([missing.saved.halfWidthDescription, empty.saved.halfWidthDescription]).toEqual([null, null]);
    }),
    canonicalCase('PG-S-020', 'stores display and raw representations of extended items', async () => {
        const observation = await projectCanonicalProgram({ extended: { heading: 'synthetic-extended-Ｂ' } });
        expect(observation.saved).toMatchObject({
            extended: '◇heading\nsynthetic-extended-Ｂ',
            halfWidthExtended: '◇heading\nsynthetic-extended-B',
            rawExtended: JSON.stringify({ heading: 'synthetic-extended-Ｂ' }),
            rawHalfWidthExtended: JSON.stringify({ heading: 'synthetic-extended-B' }),
        });
    }),
    canonicalCase(
        'PG-S-021',
        'replaces enclosing characters only when the configured projection enables it',
        async () => {
            const enabled = await projectCanonicalProgram({ name: 'synthetic-program-🈑Ａ' }, true);
            const disabled = await projectCanonicalProgram({ name: 'synthetic-program-🈑Ａ' }, false);
            expect(enabled.saved.name).toBe('synthetic-program-[字]Ａ');
            expect(disabled.saved.name).toBe('synthetic-program-🈑Ａ');
        },
    ),
    canonicalCase('PG-S-022', 'creates half-width and shortened program names in projection order', async () => {
        const observation = await projectCanonicalProgram({ name: 'synthetic-program-Ａ[新]' });
        expect(observation.saved).toMatchObject({
            name: 'synthetic-program-Ａ[新]',
            halfWidthName: 'synthetic-program-A[新]',
            shortName: 'synthetic-program-A',
        });

        // The first-half and second-half markers stay at the end of the short name wherever they were in
        // the name, so the two halves of a split broadcast never share a short name. Other markers are removed.
        for (const needToReplaceEnclosingCharacters of [false, true]) {
            const shortNameOf = async (name: string) =>
                (await projectCanonicalProgram({ name }, needToReplaceEnclosingCharacters)).saved.shortName;

            expect(await shortNameOf('[前]AAAA[字]')).toBe('AAAA[前]');
            expect(await shortNameOf('AAAA\u{1f21c}\u{1f211}')).toBe('AAAA[前]');
            expect(await shortNameOf('\u{1f21c}AAAA')).toBe('AAAA[前]');
            expect(await shortNameOf('AAAA[後]')).toBe('AAAA[後]');
            expect(await shortNameOf('\u{1f21d}AAAA\u{1f21e}')).toBe('AAAA[後]');
            expect(await shortNameOf('AAAA[後][前]')).toBe('AAAA[前][後]');
            expect(await shortNameOf('AAAA\u{1f21e}[HV]')).toBe('AAAA');
            expect(await shortNameOf('AAAA')).toBe('AAAA');
        }
    }),
    canonicalCase('PG-S-023', 'projects at most the first three standard genres without compacting slots', async () => {
        const observation = await projectCanonicalProgram({
            genres: [
                { lv1: 1, lv2: 2 },
                { lv1: 14, lv2: 9 },
                { lv1: 3, lv2: 4 },
                { lv1: 5, lv2: 6 },
            ],
        });
        expect(observation.saved).toMatchObject({
            genre1: 1,
            subGenre1: 2,
            genre2: null,
            subGenre2: null,
            genre3: 3,
            subGenre3: 4,
        });
    }),
    canonicalCase('PG-S-024', 'stores one video description', async () => {
        const observation = await projectCanonicalProgram({
            video: { type: 'mpeg2', resolution: '1080i', streamContent: 1, componentType: 179 },
        });
        expect(observation.saved).toMatchObject({
            videoType: 'mpeg2',
            videoResolution: '1080i',
            videoStreamContent: 1,
            videoComponentType: 179,
        });
    }),
    canonicalCase('PG-S-025', 'stores one main audio description', async () => {
        const observation = await projectCanonicalProgram({
            audios: [
                { isMain: false, samplingRate: 24_000, componentType: 1 },
                { isMain: true, samplingRate: 48_000, componentType: 3 },
            ],
        });
        expect(observation.saved).toMatchObject({ audioSamplingRate: 48_000, audioComponentType: 3 });
    }),
    canonicalCase('PG-S-026', 'keeps normal and half-width searchable text representations', async () => {
        const observation = await projectCanonicalProgram({
            name: 'synthetic-program-Ａ',
            description: 'synthetic-description-Ｂ',
            extended: { heading: 'synthetic-extended-Ｃ' },
        });
        expect(observation.saved).toMatchObject({
            name: 'synthetic-program-Ａ',
            halfWidthName: 'synthetic-program-A',
            description: 'synthetic-description-Ｂ',
            halfWidthDescription: 'synthetic-description-B',
            halfWidthExtended: '◇heading\nsynthetic-extended-C',
        });
    }),
    canonicalCase('PG-S-027', 'does not persist related-program input as a relation field', async () => {
        const observation = await projectCanonicalProgram({
            relatedItems: [{ type: 'shared', eventId: 201, serviceId: 101 }],
        });
        expect(observation.saved).not.toHaveProperty('relatedItems');
        expect(observation.saved).not.toHaveProperty('relations');
    }),
    canonicalCase('PG-S-028', 'returns the selected broadcast-wave schedule in repository order', async () => {
        const observation = await observeScheduleList({ BS: true });
        expect(observation.channelDB.findChannleTypes).toHaveBeenCalledWith(['GR', 'BS'], true);
        expect(observation.result[0].programs.map((value: { id: number }) => value.id)).toEqual([301, 302]);
    }),
    canonicalCase('PG-S-029', 'returns daily schedule slices for the selected channel', async () => {
        const observation = await observeChannelSchedule();
        expect(observation.channelDB.findId).toHaveBeenCalledWith(51);
        expect(observation.result.map((value: { programs: Array<{ id: number }> }) => value.programs[0].id)).toEqual([
            303, 304,
        ]);
    }),
    canonicalCase('PG-S-030', 'keeps a program that starts exactly at the requested period end', async () => {
        const observation = await observeScheduleList();
        expect(observation.programDB.findSchedule).toHaveBeenCalledWith(
            expect.objectContaining({ startAt: 1_000, endAt: 2_000 }),
        );
        expect(observation.result[0].programs.map((value: { id: number }) => value.id)).toContain(302);
    }),
    canonicalCase('PG-S-031', 'keeps a program that ends exactly at the requested period start', async () => {
        const observation = await observeScheduleList();
        expect(observation.programs[0].endAt).toBe(observation.option.startAt);
        expect(observation.result[0].programs.map((value: { id: number }) => value.id)).toContain(301);
    }),
    canonicalCase('PG-S-032', 'forwards the free-only schedule selection to persistence', async () => {
        const observation = await observeScheduleList({ isFree: true });
        expect(observation.programDB.findSchedule).toHaveBeenCalledWith(expect.objectContaining({ isFree: true }));
    }),
    canonicalCase('PG-S-033', 'returns the stored detail for a program identifier', async () => {
        const observation = await observeDetail(false);
        expect(observation.programDB.findId).toHaveBeenCalledWith(307);
        expect(observation.result).toMatchObject({ id: 307, name: 'synthetic-program-307-Ａ' });
    }),
    canonicalCase('PG-S-034', 'returns a not-found domain result for an unknown program identifier', async () => {
        const observation = await observeDetail(false, false);
        expect(observation.result).toBeNull();
    }),
    canonicalCase(
        'PG-S-035',
        'returns the first stored broadcasting program for each channel at inclusive endpoints',
        async () => {
            const observation = await observeBroadcastingSchedule();
            expect(observation.programDB.findBroadcasting).toHaveBeenCalledWith({ isHalfWidth: false, time: 500 });
            expect(observation.result).toMatchObject([{ channel: { id: 51 }, programs: [{ id: 305 }] }]);
        },
    ),
    canonicalCase('PG-S-036', 'selects normal or half-width names and descriptions on request', async () => {
        const normal = await observeDetail(false);
        const half = await observeDetail(true);
        expect(normal.result).toMatchObject({
            name: 'synthetic-program-307-Ａ',
            description: 'synthetic-description-307-Ｂ',
        });
        expect(half.result).toMatchObject({
            name: 'synthetic-program-307-A',
            description: 'synthetic-description-307-B',
        });
    }),
    canonicalCase('PG-S-037', 'forwards selected keyword and ignore-keyword fields together', async () => {
        const searchOption = {
            keyword: 'synthetic alpha',
            ignoreKeyword: 'excluded',
            name: true,
            description: true,
            extended: false,
        };
        const observation = await observeSearch(searchOption);
        expect(observation.programDB.findRule).toHaveBeenCalledWith({ searchOption, limit: undefined });
    }),
    canonicalCase(
        'PG-S-038',
        'preserves the complete multi-token keyword expression for persistence grouping',
        async () => {
            const searchOption = {
                keyword: 'alpha beta',
                name: true,
                description: true,
                extended: true,
                keyRegExp: false,
            };
            const observation = await observeSearch(searchOption);
            expect(observation.programDB.findRule.mock.calls[0][0].searchOption.keyword).toBe('alpha beta');
            expect(observation.result.map((value: { id: number }) => value.id)).toEqual([308, 309]);
        },
    ),
    canonicalCase('PG-S-039', 'forwards a regular-expression search to a capable persistence backend', async () => {
        const searchOption = { keyword: '^synthetic.*Ａ$', name: true, keyRegExp: true };
        const observation = await observeSearch(searchOption);
        expect(observation.programDB.findRule).toHaveBeenCalledWith({ searchOption, limit: undefined });
    }),
    canonicalCase('PG-S-040', 'keeps the same expression available for normal-keyword fallback', async () => {
        const searchOption = { keyword: 'synthetic alpha', name: true, keyRegExp: true };
        const observation = await observeSearch(searchOption);
        expect(observation.programDB.findRule.mock.calls[0][0].searchOption).toEqual(searchOption);
    }),
    canonicalCase(
        'PG-S-041',
        'keeps channel identifiers and broadcast waves distinguishable so identifiers can win',
        async () => {
            const searchOption = { channelIds: [51, 52], GR: false, BS: true, name: true };
            const observation = await observeSearch(searchOption);
            expect(observation.programDB.findRule.mock.calls[0][0].searchOption).toMatchObject({
                channelIds: [51, 52],
                BS: true,
            });
        },
    ),
    canonicalCase('PG-S-042', 'uses broadcast-wave selection when no channel identifier is supplied', async () => {
        const searchOption = { channelIds: [], GR: true, BS: false, name: true };
        const observation = await observeSearch(searchOption);
        expect(observation.programDB.findRule.mock.calls[0][0].searchOption).toMatchObject({
            channelIds: [],
            GR: true,
        });
    }),
    canonicalCase(
        'PG-S-043',
        'forwards every structured genre date free and duration filter as one search',
        async () => {
            const searchOption = {
                genres: [{ genre: 1, subGenre: 2 }],
                times: [{ week: 1, start: 300, range: 60 }],
                isFree: true,
                durationMin: 30,
                durationMax: 120,
                searchPeriod: 86_400_000,
            };
            const observation = await observeSearch(searchOption);
            expect(observation.programDB.findRule.mock.calls[0][0].searchOption).toEqual(searchOption);
        },
    ),
    canonicalCase('PG-S-044', 'returns search results in the repository start-time order', async () => {
        const rows = [canonicalStoredProgram(310, { startAt: 1_000 }), canonicalStoredProgram(311, { startAt: 2_000 })];
        const observation = await observeSearch({ name: true }, rows);
        expect(observation.result.map((value: { id: number }) => value.id)).toEqual([310, 311]);
    }),
    canonicalCase('PG-S-045', 'does not impose an additional tie-break for equal start times', async () => {
        const rows = [canonicalStoredProgram(313, { startAt: 1_000 }), canonicalStoredProgram(312, { startAt: 1_000 })];
        const observation = await observeSearch({ name: true }, rows);
        expect(observation.result.map((value: { id: number }) => value.id)).toEqual([313, 312]);
    }),
    canonicalCase(
        'PG-S-046',
        'forwards the requested result limit and returns at most the persisted result set',
        async () => {
            const observation = await observeSearch({ name: true }, [canonicalStoredProgram(314)], 1);
            expect(observation.programDB.findRule).toHaveBeenCalledWith({ searchOption: { name: true }, limit: 1 });
            expect(observation.result).toHaveLength(1);
        },
    ),
    canonicalCase('PG-S-047', 'checks the stored channel before requesting a logo', async () => {
        const ledger: string[] = [];
        const findId = vi.fn(async () => {
            ledger.push('channel');
            return canonicalStoredChannel();
        });
        const getLogo = vi.fn(async () => {
            ledger.push('logo');
            return Buffer.from('synthetic-logo');
        });
        const model = new ChannelApiModel({ findId }, { getLogo });

        await model.getLogo(51);

        expect(ledger).toEqual(['channel', 'logo']);
    }),
    canonicalCase('PG-S-048', 'returns not-found without a tuner request when the channel is absent', async () => {
        const getLogo = vi.fn();
        const model = new ChannelApiModel({ findId: vi.fn(async () => null) }, { getLogo });

        await expect(model.getLogo(51)).rejects.toThrow(IChannelApiModelError.NOT_FOUND);
        expect(getLogo).not.toHaveBeenCalled();
    }),
    canonicalCase('PG-S-049', 'returns not-found without a tuner request when the channel has no logo', async () => {
        const getLogo = vi.fn();
        const model = new ChannelApiModel(
            { findId: vi.fn(async () => canonicalStoredChannel({ hasLogoData: false })) },
            { getLogo },
        );

        await expect(model.getLogo(51)).rejects.toThrow(IChannelApiModelError.NOT_FOUND);
        expect(getLogo).not.toHaveBeenCalled();
    }),
    canonicalCase('PG-S-050', 'requests one upstream logo when the stored channel advertises logo data', async () => {
        const getLogo = vi.fn(async () => Buffer.from('synthetic-logo'));
        const model = new ChannelApiModel({ findId: vi.fn(async () => canonicalStoredChannel()) }, { getLogo });

        await model.getLogo(51);

        expect(getLogo).toHaveBeenCalledOnce();
        expect(getLogo).toHaveBeenCalledWith(51);
    }),
    canonicalCase('PG-S-051', 'returns the exact logo buffer obtained from the tuner port', async () => {
        const logo = Buffer.from('synthetic-logo');
        const model = new ChannelApiModel(
            { findId: vi.fn(async () => canonicalStoredChannel()) },
            { getLogo: vi.fn(async () => logo) },
        );

        await expect(model.getLogo(51)).resolves.toBe(logo);
    }),
    canonicalCase(
        'PG-S-052',
        'preserves an upstream logo acquisition failure instead of converting it to not-found',
        async () => {
            const failure = new Error('synthetic-logo-acquisition-rejection');
            const model = new ChannelApiModel(
                { findId: vi.fn(async () => canonicalStoredChannel()) },
                { getLogo: vi.fn(async () => Promise.reject(failure)) },
            );

            await expect(model.getLogo(51)).rejects.toBe(failure);
        },
    ),
    canonicalCase('PG-S-053', 'does not cache logo bodies between two requests', async () => {
        const first = Buffer.from('synthetic-logo-1');
        const second = Buffer.from('synthetic-logo-2');
        const getLogo = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
        const model = new ChannelApiModel({ findId: vi.fn(async () => canonicalStoredChannel()) }, { getLogo });

        await expect(model.getLogo(51)).resolves.toBe(first);
        await expect(model.getLogo(51)).resolves.toBe(second);
        expect(getLogo.mock.calls).toEqual([[51], [51]]);
    }),
    canonicalCase(
        'PG-S-054',
        'records a full acquisition failure without publishing a persisted program result',
        async () => {
            const observation = await observeFullAcquisitionFailure();
            expect(observation.programDB.insert).not.toHaveBeenCalled();
            expect(observation.model.log.system.error).toHaveBeenCalledWith('get service error');
            expect(vi.getTimerCount()).toBe(0);
        },
    ),
    canonicalCase(
        'PG-S-055',
        'increases reconnect delay in five-second steps and caps it at sixty seconds',
        async () => {
            const first = await observeReconnectBackoff(0);
            expect(first.updater.retryCount).toBe(1);
            expect(first.sleep).toHaveBeenLastCalledWith(5_000);
            vi.restoreAllMocks();
            const capped = await observeReconnectBackoff(12);
            expect(capped.updater.retryCount).toBe(12);
            expect(capped.sleep).toHaveBeenLastCalledWith(60_000);
        },
    ),
    canonicalCase('PG-S-056', 'continues reconnect attempts after a normally completed feed attempt', async () => {
        const observation = await observeContinuedReconnect();
        expect(observation.start).toHaveBeenCalledTimes(2);
        expect(observation.pending.state()).toEqual({ status: 'pending' });
        expect(observation.sleep).not.toHaveBeenCalled();
        expect(observation.updater.log.system.error).not.toHaveBeenCalledWith('destroy event stream');
    }),
    canonicalCase('PG-S-057', 'keeps stored schedule reads available after an acquisition failure', async () => {
        await observeFullAcquisitionFailure();
        const detail = await observeDetail(false);
        expect(detail.result).toMatchObject({ id: 307, name: 'synthetic-program-307-Ａ' });
    }),
    canonicalCase('PG-S-058', 'does not reject a stored program because wall-clock time has advanced', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(9_999_999_999_999);
        const detail = await observeDetail(false);
        expect(detail.result).toMatchObject({ id: 307 });
        expect(detail.programDB.findId).toHaveBeenCalledWith(307);
    }),
    canonicalCase('PG-S-059', 'continues expired-program deletion after the periodic acquisition fails', async () => {
        const observation = await observeDeletionAfterUpdateFailure();
        expect(observation.updater.updateManage.updateAll).toHaveBeenCalledOnce();
        expect(observation.deleteOldPrograms).toHaveBeenCalledOnce();
        expect(observation.updater.log.system.error).toHaveBeenCalledWith(observation.updateFailure);
    }),
    canonicalCase('PG-S-060', 'records deletion failure and leaves subsequent stored reads usable', async () => {
        const failure = new Error('synthetic-delete-old-rejection');
        const observation = await observeDeletionAfterUpdateFailure(failure);
        const detail = await observeDetail(false);
        expect(observation.updater.log.system.error).toHaveBeenCalledWith('delete old programs error');
        expect(observation.updater.log.system.error).toHaveBeenCalledWith(failure);
        expect(detail.result).toMatchObject({ id: 307 });
    }),
    canonicalCase(
        'PG-S-061',
        'coalesces every tick during an active cycle into one pending re-evaluation',
        async () => {
            const observation = await observePendingPeriodicCycle();
            expect(observation.whilePending).toMatchObject({ active: true, calls: 1, pending: true });
            expect(observation.maximumConcurrent).toBe(1);
        },
    ),
    canonicalCase(
        'PG-S-062',
        'uses ten minutes as an observer without settling the active full synchronization',
        async () => {
            const observation = await observeLateFullSynchronization('resolve');
            expect(observation.afterObserver).toEqual({
                errorCount: 1,
                programInsertCalls: 0,
                resolutions: 0,
                rejections: 0,
                state: { status: 'pending' },
            });
        },
    ),
    canonicalCase('PG-S-063', 'applies one normal late result after the full-sync observer has elapsed', async () => {
        const resolved = await observeLateFullSynchronization('resolve');
        expect({ resolutions: resolved.resolutions, rejections: resolved.rejections }).toEqual({
            resolutions: 1,
            rejections: 0,
        });
        expect(resolved.harness.programDB.insert).toHaveBeenCalledOnce();
        vi.useRealTimers();
        const rejected = await observeLateFullSynchronization('reject');
        expect({ resolutions: rejected.resolutions, rejections: rejected.rejections }).toEqual({
            resolutions: 0,
            rejections: 1,
        });
        expect(rejected.harness.programDB.insert).not.toHaveBeenCalled();
    }),
    canonicalCase('PG-S-064', 'processes the complete service-ID snapshot as one aggregate', async () => {
        const observation = await observeServiceAggregate();
        expect(observation.calls).toEqual(['channels', 'programs:71', 'programs:72', 'save:71,72']);
        expect(observation.model.updatedOnAirServiceIds).toEqual({});
    }),
    canonicalCase(
        'PG-S-065',
        'applies an independent thirty-second deadline to a service-program request',
        async () => {
            const observation = await observeServiceRequestDeadline();
            expect(observation.before).toEqual({ aborted: false, timerCount: 1 });
            expect(observation.error).toMatchObject({ message: 'Tuner request timeout after 30000ms' });
            expect(observation.requestSignal?.aborted).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        },
    ),
    canonicalCase(
        'PG-S-066',
        'leaves the entire service-ID snapshot unfinished after a prefix request fails',
        async () => {
            const observation = await observeServiceAggregate(true);
            expect(observation.getProgramsByService).toHaveBeenCalledTimes(2);
            expect(observation.programDB.insert).not.toHaveBeenCalled();
            expect(observation.model.updatedOnAirServiceIds).toEqual({ 71: true, 72: true });
        },
    ),
    canonicalCase('PG-S-067', 'starts one current-state re-evaluation after an active cycle settles', async () => {
        const observation = await observePendingPeriodicCycle();
        expect(observation.afterSettlement).toEqual({ active: true, calls: 2, pending: false });
        expect(observation.saveProgram).toHaveBeenCalledTimes(2);
        expect(observation.maximumConcurrent).toBe(1);
    }),
    canonicalCase(
        'PG-S-068',
        'does not add a ten-minute timeout to a pending periodic database operation',
        async () => {
            const observation = await observePendingPeriodicCycle();
            expect(observation.whilePending).toEqual({ active: true, calls: 1, pending: true, timerCount: 1 });
            expect(observation.concurrent).toBe(0);
        },
    ),
    canonicalCase('PG-S-069', 'maps normalized Mirakurun input to the common saved and logo result', async () => {
        const observation = await observeProductIndependentResult('mirakurun');
        expect(observation.result).toMatchObject({
            channelSnapshot: [expect.objectContaining({ id: 1, serviceId: 101 })],
            fullProgramSnapshot: [expect.objectContaining({ id: 501 })],
            incrementalPrograms: expect.objectContaining({ update: [expect.objectContaining({ id: 502 })] }),
        });
        expect(observation.result.logo).toBe(Buffer.from('synthetic-product-independent-logo').toString('hex'));
    }),
    canonicalCase('PG-S-070', 'maps normalized mirakc input to the same common saved and logo result', async () => {
        const observation = await observeProductIndependentResult('mirakc');
        expect(observation.result).toMatchObject({
            channelSnapshot: [expect.objectContaining({ id: 1, serviceId: 101 })],
            fullProgramSnapshot: [expect.objectContaining({ id: 501 })],
            incrementalPrograms: expect.objectContaining({ update: [expect.objectContaining({ id: 502 })] }),
        });
        expect(observation.result.logo).toBe(Buffer.from('synthetic-product-independent-logo').toString('hex'));
    }),
    canonicalCase('PG-S-071', 'keeps provider discriminators out of saved query and logo results', async () => {
        const mirakurun = await observeProductIndependentResult('mirakurun');
        vi.useRealTimers();
        const mirakc = await observeProductIndependentResult('mirakc');
        expect(mirakurun.result).toEqual(mirakc.result);
        expect(JSON.stringify([mirakurun.result, mirakc.result])).not.toMatch(/mirakurun|mirakc|provider|product/u);
    }),
];

afterEach(() => {
    if (processSendDescriptor === undefined) delete process.send;
    else Object.defineProperty(process, 'send', processSendDescriptor);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('Program Guide canonical R1-R8 contracts', () => {
    it.each(canonicalSpecCases)('[$id] $title', async ({ verify }) => {
        await verify();
    });
});

describe('program guide channel schedule half-width channel naming', () => {
    it('substitutes the half-width channel name when the caller requests half-width formatting', async () => {
        const channel = canonicalStoredChannel();
        const programs = [canonicalStoredProgram(303)];
        const channelDB = { findId: vi.fn().mockResolvedValue(channel) };
        const programDB = { findSchedule: vi.fn().mockResolvedValueOnce(programs) };
        const model = new ScheduleApiModel(channelDB, programDB);

        const result = await model.getChannelSchedule({ channelId: 51, startAt: 1_000, days: 1, isHalfWidth: true });

        expect(result).toHaveLength(1);
        expect(result[0].channel.name).toBe(channel.halfWidthName);
        expect(result[0].channel.name).not.toBe(channel.name);
    });
});

describe('program guide Risk A specification characterization', () => {
    it('[PG-AUX-T1.1] full channel synchronization filters the same input used by persistence and the in-memory index', async () => {
        const included = service(1, 101);
        const excludedByChannel = service(2, 102);
        const excludedBySid = service(3, 103);
        const { channelDB, client, model } = createModel({
            services: [included, excludedByChannel, excludedBySid],
            excludeChannels: [2],
            excludeSids: [103],
        });

        await model.updateChannels();

        expect(client.getServices).toHaveBeenCalledTimes(1);
        expect(channelDB.insert).toHaveBeenCalledWith([included]);
        expect(model.channelIndex).toEqual({ 10: { 101: { id: 1, type: 'GR', channel: '1' } } });
    });

    it('[PG-AUX-T1.6] passes each full snapshot so a channel absent from the second snapshot is eligible for cleanup', async () => {
        const retained = service(4, 104);
        const disappeared = service(5, 105);
        const { channelDB, client, model } = createModel();
        client.getServices.mockResolvedValueOnce([retained, disappeared]).mockResolvedValueOnce([retained]);

        await model.updateChannels();
        await model.updateChannels();

        expect(channelDB.insert).toHaveBeenNthCalledWith(1, [retained, disappeared]);
        expect(channelDB.insert).toHaveBeenNthCalledWith(2, [retained]);
        expect(channelDB.insert.mock.calls[1][0]).not.toContain(disappeared);
        expect(model.channelIndex).toEqual({ 10: { 104: { id: 4, type: 'GR', channel: '4' } } });
    });

    it('[PG-AUX-T1.4-1.6] create/update changes are persisted, remove alone is retained until a later full sync', async () => {
        const created = service(11, 111, { hasLogoData: false });
        const updated = service(12, 112, { name: 'synthetic-service-updated', hasLogoData: false });
        const updatedWithCurrentLogo = { ...updated, hasLogoData: true };
        const { channelDB, model } = createModel({ services: [service(11, 111), service(12, 112)] });
        const outcomes: string[] = [];
        model.on(EPGUpdateEvent.SERVICE_UPDATED, () => outcomes.push('updated'));
        model.serviceQueue.push(
            { resource: 'service', type: 'create', data: created },
            { resource: 'service', type: 'update', data: updated },
            { resource: 'service', type: 'remove', data: service(13, 113) },
        );

        await model.saveService();

        expect(channelDB.update).toHaveBeenCalledWith({ insert: [created], update: [updatedWithCurrentLogo] });
        expect(outcomes).toEqual(['updated']);
        expect(model.serviceQueue).toEqual([]);
    });

    it('[PG-AUX-T2.1-T3.11] full program synchronization saves only named main programs and no relation object', async () => {
        vi.useFakeTimers();
        const main = program(21, { relatedItems: [{ type: 'shared', eventId: 21, serviceId: 101 }] });
        const secondary = program(22, { relatedItems: [{ type: 'shared', eventId: 21, serviceId: 101 }] });
        const relay = program(23, { relatedItems: [{ type: 'relay', eventId: 24, serviceId: 101 }] });
        const moved = program(24, { relatedItems: [{ type: 'movement', eventId: 25, serviceId: 101 }] });
        const legacy = program(25, { relatedItems: [{ eventId: 25, serviceId: 101 }] });
        const nameless = program(26, { name: undefined });
        const { model } = createModel({
            services: [service(1, 101)],
            programs: [main, secondary, relay, moved, legacy, nameless],
        });
        const runner = projectionRunner();
        model.programDB = new ProgramDB(
            { getLogger: logger },
            { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) },
            { getConnection: async () => ({ createQueryRunner: () => runner }) },
            { run: (operation: () => unknown) => operation() },
        );

        await model.updateAll();

        const saved = runner.manager.insert.mock.calls.map(call => call[1]);
        expect(saved.map(value => ({ id: value.id, name: value.name }))).toEqual([
            { id: 21, name: 'synthetic-program-21' },
            { id: 23, name: 'synthetic-program-23' },
            { id: 24, name: 'synthetic-program-24' },
            { id: 25, name: 'synthetic-program-25' },
        ]);
        expect(saved.map(value => value.id)).not.toContain(22);
        expect(saved.map(value => value.id)).not.toContain(26);
        for (const value of saved) expect(value).not.toHaveProperty('relatedItems');
        expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
        expect(runner.release).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        {
            expected: { genre1: null, subGenre1: null, genre2: null, subGenre2: null, genre3: null, subGenre3: null },
            source: {},
            variant: 'missing genres',
        },
        {
            expected: { genre1: null, subGenre1: null, genre2: null, subGenre2: null, genre3: null, subGenre3: null },
            source: { genres: [] },
            variant: 'empty genres',
        },
        {
            expected: { genre1: 1, subGenre1: 2, genre2: null, subGenre2: null, genre3: null, subGenre3: null },
            source: { genres: [{ lv1: 1, lv2: 2 }] },
            variant: 'one genre',
        },
        {
            expected: { genre1: 1, subGenre1: 2, genre2: 3, subGenre2: 4, genre3: 5, subGenre3: 6 },
            source: {
                genres: [
                    { lv1: 1, lv2: 2 },
                    { lv1: 3, lv2: 4 },
                    { lv1: 5, lv2: 6 },
                ],
            },
            variant: 'three genres',
        },
        {
            expected: { genre1: 1, subGenre1: 2, genre2: 3, subGenre2: 4, genre3: 5, subGenre3: 6 },
            source: {
                genres: [
                    { lv1: 1, lv2: 2 },
                    { lv1: 3, lv2: 4 },
                    { lv1: 5, lv2: 6 },
                    { lv1: 7, lv2: 8 },
                ],
            },
            variant: 'four genres',
        },
        {
            expected: { genre1: null, subGenre1: null, genre2: 3, subGenre2: 4, genre3: null, subGenre3: null },
            source: {
                genres: [
                    { lv1: 14, lv2: 1 },
                    { lv1: 3, lv2: 4 },
                    { lv1: 15, lv2: 2 },
                ],
            },
            variant: 'non-standard genres',
        },
    ])('[PG-AUX-T5.5] stores $variant in the existing three public genre slots', async ({ source, expected }) => {
        const { model } = createModel({ services: [service(1, 101)], programs: [program(27, source)] });
        const runner = projectionRunner();
        model.programDB = new ProgramDB(
            { getLogger: logger },
            { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) },
            { getConnection: async () => ({ createQueryRunner: () => runner }) },
            { run: (operation: () => unknown) => operation() },
        );

        await model.updateAll();

        expect(runner.manager.insert.mock.calls[0][1]).toMatchObject(expected);
    });

    it('[PG-AUX-T2.5-T2.7] repository success emits once and failure restores the owned snapshot before new arrivals', async () => {
        const first = { resource: 'program', type: 'update', data: program(31) };
        const late = { resource: 'program', type: 'update', data: program(32) };
        const failure = new Error('synthetic-program-save-rejection');
        const { model, programDB } = createModel();
        const outcomes: string[] = [];
        model.channelIndex = { 10: { 101: { id: 1, type: 'GR', channel: '1' } } };
        model.on(EPGUpdateEvent.PROGRAM_UPDATED, () => outcomes.push('updated'));
        programDB.update.mockImplementation(async () => {
            model.programQueue.push(late);
            throw failure;
        });
        model.programQueue.push(first);

        await expect(model.saveProgram()).rejects.toBe(failure);

        expect(model.programQueue).toEqual([first, late]);
        expect(outcomes).toEqual([]);
        programDB.update.mockResolvedValue(undefined);
        await model.saveProgram();
        expect(outcomes).toEqual(['updated']);
        expect(model.programQueue).toEqual([]);
    });
});

describe('Program Guide canonical tuner port contract', () => {
    it('[PG-T4.1/4.2] gets each full snapshot once from one product-independent port instance', async () => {
        vi.useFakeTimers();
        const services = [service(1, 101)];
        const programs = [program(11)];
        const harness = createCanonicalTunerModel({
            getServices: vi.fn(async () => services),
            getPrograms: vi.fn(async () => programs),
        });

        await harness.model.updateAll();

        expect(harness.tuner.getServices.mock.calls).toEqual([[]]);
        expect(harness.tuner.getPrograms.mock.calls).toEqual([[]]);
        expect(harness.channelDB.insert).toHaveBeenCalledWith(services);
        expect(harness.programDB.insert).toHaveBeenCalledWith(
            { 10: { 101: { id: 1, type: 'GR', channel: '1' } } },
            programs,
        );
        expect(harness.model.log.system.info.mock.calls.map(([message]: unknown[]) => message)).toEqual(
            expect.arrayContaining([
                'get programs',
                'done get programs',
                'start update programs',
                'done update programs',
            ]),
        );
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['resolve', 'reject'] as const)(
        '[PG-T4.1/4.2] leaves a deferred insert pending beyond ten minutes and preserves its late %s result',
        async settlement => {
            vi.useFakeTimers();
            const insert = createDeferred<void>();
            const harness = createCanonicalTunerModel({
                getPrograms: vi.fn(async () => [program(11)]),
                getServices: vi.fn(async () => [service(1, 101)]),
            });
            harness.programDB.insert.mockImplementationOnce(() => insert.promise);
            let settled = false;
            const failure = new Error('synthetic-late-insert-failure');
            const operation = harness.model.updateAll().then(
                () => {
                    settled = true;
                    return undefined;
                },
                (error: Error) => {
                    settled = true;
                    throw error;
                },
            );
            if (settlement === 'reject') operation.catch(() => undefined);

            await vi.waitFor(() => expect(harness.programDB.insert).toHaveBeenCalledOnce());
            expect(insert.state()).toEqual({ status: 'pending' });
            await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);
            expect(settled).toBe(false);
            expect(insert.state()).toEqual({ status: 'pending' });
            expect(
                harness.model.log.system.error.mock.calls.filter(
                    ([value]: unknown[]) => value === 'update all timeout',
                ),
            ).toHaveLength(1);
            expect(vi.getTimerCount()).toBe(0);

            if (settlement === 'resolve') {
                expect(insert.resolve(undefined)).toBe(true);
                await expect(operation).resolves.toBeUndefined();
            } else {
                expect(insert.reject(failure)).toBe(true);
                await expect(operation).rejects.toBe(failure);
            }
            expect(settled).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it('[PG-AUX-T5.4] observes one exact ten-minute window without interrupting a late program acquisition', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const channelsPersisted = createDeferred<void>();
        const channelInsertStarted = createDeferred<void>();
        const programs = createDeferred<unknown[]>();
        const programRequestStarted = createDeferred<void>();
        const close = vi.fn();
        const harness = createCanonicalTunerModel({
            close,
            getPrograms: vi.fn(() => {
                programRequestStarted.resolve(undefined);
                return programs.promise;
            }),
            getServices: vi.fn(async () => [service(1, 101)]),
        });
        harness.channelDB.insert.mockImplementationOnce(() => {
            channelInsertStarted.resolve(undefined);
            return channelsPersisted.promise;
        });
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
        let resolutions = 0;
        let rejections = 0;
        const operation = harness.model.updateAll().then(
            () => {
                resolutions++;
            },
            (error: Error) => {
                rejections++;
                throw error;
            },
        );

        await channelInsertStarted.promise;
        expect(harness.tuner.getPrograms).not.toHaveBeenCalled();
        expect(setTimeoutSpy).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);

        channelsPersisted.resolve(undefined);
        await programRequestStarted.promise;
        expect(harness.tuner.getPrograms.mock.calls).toEqual([[]]);
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 600_000);
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(599_999);
        expect(harness.model.log.system.error).not.toHaveBeenCalledWith('update all timeout');
        expect({ resolutions, rejections }).toEqual({ resolutions: 0, rejections: 0 });
        expect(clearTimeoutSpy).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(
            harness.model.log.system.error.mock.calls.filter(([value]: unknown[]) => value === 'update all timeout'),
        ).toHaveLength(1);
        expect({ resolutions, rejections }).toEqual({ resolutions: 0, rejections: 0 });
        expect(programs.state()).toEqual({ status: 'pending' });
        expect(harness.programDB.insert).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
        expect(clearTimeoutSpy).not.toHaveBeenCalled();

        programs.resolve([program(11)]);
        await expect(operation).resolves.toBeUndefined();

        expect(harness.programDB.insert).toHaveBeenCalledTimes(1);
        expect({ resolutions, rejections }).toEqual({ resolutions: 1, rejections: 0 });
        expect(close).not.toHaveBeenCalled();
        expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(clearTimeoutSpy).toHaveBeenCalledWith(setTimeoutSpy.mock.results[0].value);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[PG-AUX-T5.4] clears the observer once and preserves one late persistence rejection', async () => {
        vi.useFakeTimers();
        const persistence = createDeferred<void>();
        const persistenceStarted = createDeferred<void>();
        const failure = new Error('synthetic-late-program-persistence-rejection');
        const harness = createCanonicalTunerModel({
            getPrograms: vi.fn(async () => [program(11)]),
            getServices: vi.fn(async () => [service(1, 101)]),
        });
        harness.programDB.insert.mockImplementationOnce(() => {
            persistenceStarted.resolve(undefined);
            return persistence.promise;
        });
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
        const operation = harness.model.updateAll();

        await persistenceStarted.promise;
        await vi.advanceTimersByTimeAsync(600_000);
        expect(
            harness.model.log.system.error.mock.calls.filter(([value]: unknown[]) => value === 'update all timeout'),
        ).toHaveLength(1);
        expect(persistence.state()).toEqual({ status: 'pending' });
        expect(clearTimeoutSpy).not.toHaveBeenCalled();

        persistence.reject(failure);
        await expect(operation).rejects.toBe(failure);

        expect(harness.programDB.insert).toHaveBeenCalledTimes(1);
        expect(harness.model.log.system.error).toHaveBeenCalledWith('update programs error');
        expect(harness.model.log.system.error).toHaveBeenCalledWith(failure);
        expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['services', 'programs'] as const)(
        '[PG-T4.1/4.2] preserves a finite %s acquisition failure and publishes no program result',
        async failedRequest => {
            vi.useFakeTimers();
            const failure = new Error(`synthetic-${failedRequest}-acquisition-failure`);
            const harness = createCanonicalTunerModel({
                getServices: vi.fn(async () => {
                    if (failedRequest === 'services') throw failure;
                    return [service(1, 101)];
                }),
                getPrograms: vi.fn(async () => {
                    if (failedRequest === 'programs') throw failure;
                    return [program(11)];
                }),
            });

            await expect(harness.model.updateAll()).rejects.toBe(failure);

            expect(harness.tuner.getServices).toHaveBeenCalledOnce();
            expect(harness.tuner.getPrograms).toHaveBeenCalledTimes(failedRequest === 'services' ? 0 : 1);
            expect(harness.programDB.insert).not.toHaveBeenCalled();
            if (failedRequest === 'programs') {
                expect(harness.model.log.system.error).toHaveBeenCalledWith('get programs error');
                expect(harness.model.log.system.error).toHaveBeenCalledWith(failure);
            }
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it('[PG-T4.1/4.2] preserves a full-service timeout, ignores its late result, and releases its timer', async () => {
        vi.useFakeTimers();
        const response = createDeferred<unknown>();
        let requestSignal: AbortSignal | undefined;
        const tuner = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
            getJson: vi.fn((_path: string, options: { signal: AbortSignal }) => {
                requestSignal = options.signal;
                return response.promise;
            }),
        });
        const harness = createCanonicalTunerModel({ getServices: tuner.getServices.bind(tuner) });
        const outcome = harness.model.updateChannels().then(
            () => undefined,
            (error: Error) => error,
        );

        await vi.advanceTimersByTimeAsync(29_999);
        expect(requestSignal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);

        await expect(outcome).resolves.toMatchObject({ message: 'Tuner request timeout after 30000ms' });
        expect(requestSignal?.aborted).toBe(true);
        expect(harness.channelDB.insert).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        response.resolve([service(1, 101)]);
        await vi.advanceTimersByTimeAsync(0);
        expect(harness.channelDB.insert).not.toHaveBeenCalled();
    });

    it('[PG-T4.1/4.2] preserves a logo timeout as acquisition failure and ignores its late body', async () => {
        vi.useFakeTimers();
        const response = createDeferred<Buffer>();
        let requestSignal: AbortSignal | undefined;
        const getBuffer = vi.fn((_path: string, options: { signal: AbortSignal }) => {
            requestSignal = options.signal;
            return response.promise;
        });
        const tuner = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
            getJson: vi.fn(),
            getBuffer,
        });
        const model = new ChannelApiModel({ findId: vi.fn(async () => ({ id: 31, hasLogoData: true })) }, tuner);
        const outcome = model.getLogo(31).then(
            () => undefined,
            (error: Error) => error,
        );

        await vi.advanceTimersByTimeAsync(30_000);

        await expect(outcome).resolves.toMatchObject({ message: 'Tuner request timeout after 30000ms' });
        expect(getBuffer).toHaveBeenCalledWith('/api/services/31/logo', { signal: requestSignal });
        expect(requestSignal?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        response.resolve(Buffer.from('synthetic-late-logo'));
        await vi.advanceTimersByTimeAsync(0);
        await expect(outcome).resolves.toMatchObject({ message: 'Tuner request timeout after 30000ms' });
    });

    it('[PG-T4.3/4.4] routes all canonical change kinds without product fields', async () => {
        const createdProgram = program(20);
        const changedProgram = program(21);
        const createdService = service(1, 101);
        const changedService = service(2, 102);
        const removedService = service(3, 103);
        const changes = [
            { kind: 'program', operation: 'create', program: createdProgram, time: 2_000 },
            { kind: 'program', operation: 'update', program: changedProgram, time: 2_001 },
            { kind: 'program', operation: 'remove', programId: 22, time: 2_002 },
            { kind: 'program', operation: 'redefine', from: 23, to: 24, time: 2_003 },
            { kind: 'service', operation: 'create', service: createdService, time: 2_004 },
            { kind: 'service', operation: 'update', service: changedService, time: 2_004 },
            { kind: 'service', operation: 'remove', service: removedService, time: 2_004 },
            { kind: 'on-air-service', serviceId: 25 },
            { kind: 'service-programs-updated', serviceId: 26 },
        ];
        const openChangeFeed = vi.fn(async (observer: any) => {
            observer.started();
            for (const change of changes) observer.changed(change);
            return { close: vi.fn(), completion: Promise.resolve() };
        });
        const harness = createCanonicalTunerModel({ openChangeFeed });
        const started = vi.fn();
        harness.model.on(EPGUpdateEvent.STREAM_STARTED, started);

        await harness.model.start();

        expect(started).toHaveBeenCalledOnce();
        expect(harness.model.programQueue).toEqual([
            { resource: 'program', type: 'create', data: createdProgram, time: 2_000 },
            { resource: 'program', type: 'update', data: changedProgram, time: 2_001 },
            { resource: 'program', type: 'remove', data: { id: 22 }, time: 2_002 },
            { resource: 'program', type: 'redefine', data: { from: 23, to: 24 }, time: 2_003 },
        ]);
        expect(harness.model.serviceQueue).toEqual([
            { resource: 'service', type: 'create', data: createdService, time: 2_004 },
            { resource: 'service', type: 'update', data: changedService, time: 2_004 },
            { resource: 'service', type: 'remove', data: removedService, time: 2_004 },
        ]);
        expect(harness.model.updatedOnAirServiceIds).toEqual({ 25: true });
        expect(harness.model.updateServiceIds).toEqual({ 26: true });
        expect(
            JSON.stringify({ programs: harness.model.programQueue, services: harness.model.serviceQueue }),
        ).not.toMatch(/mirakurun|mirakc|product/u);
    });
});

describe('program guide Tasks 2-3 public specification characterization', () => {
    const storedChannel = (hasLogoData: boolean = true) => ({
        id: 51,
        serviceId: 151,
        networkId: 10,
        name: 'synthetic-channel-51',
        halfWidthName: 'synthetic-half-channel-51',
        remoteControlKeyId: 5,
        hasLogoData,
        channelTypeId: 0,
        channelType: 'GR',
        channel: '51',
        type: 1,
    });
    const storedProgram = (id: number, overrides: Record<string, unknown> = {}) => ({
        id,
        channelId: 51,
        startAt: 1_000,
        endAt: 2_000,
        isFree: true,
        name: `synthetic-program-${id}`,
        halfWidthName: `synthetic-half-program-${id}`,
        description: null,
        halfWidthDescription: null,
        extended: null,
        halfWidthExtended: null,
        rawExtended: null,
        rawHalfWidthExtended: null,
        genre1: null,
        subGenre1: null,
        genre2: null,
        subGenre2: null,
        genre3: null,
        subGenre3: null,
        videoType: null,
        videoResolution: null,
        videoComponentType: null,
        videoStreamContent: null,
        audioSamplingRate: null,
        audioComponentType: null,
        ...overrides,
    });

    it('[PG-T2.1] exposes stored schedules without a freshness gate and forwards the inclusive/free query contract', async () => {
        const row = storedProgram(51);
        const channelDB = { findChannleTypes: vi.fn().mockResolvedValue([storedChannel()]) };
        const programDB = { findSchedule: vi.fn().mockResolvedValue([row]), findId: vi.fn().mockResolvedValue(row) };
        const model = new ScheduleApiModel(channelDB, programDB);

        await expect(
            model.getSchedules({ GR: true, startAt: 1_000, endAt: 2_000, isHalfWidth: false, isFree: true }),
        ).resolves.toMatchObject([{ channel: { id: 51 }, programs: [{ id: 51 }] }]);
        await expect(model.getSchedule(51, true)).resolves.toMatchObject({
            id: 51,
            name: 'synthetic-half-program-51',
        });
        expect(programDB.findSchedule).toHaveBeenCalledWith({
            startAt: 1_000,
            endAt: 2_000,
            isHalfWidth: false,
            types: ['GR'],
            isFree: true,
        });
    });

    it('[PG-T2.2][PG-T2.3] forwards keyword and structured search together and returns repository order up to its limit', async () => {
        const option = {
            keyword: 'synthetic alpha beta',
            ignoreKeyword: 'excluded',
            name: true,
            description: true,
            keyRegExp: false,
            channelIds: [51],
            BS: true,
            genres: [{ genre: 1, subGenre: 2 }],
            isFree: true,
            durationMin: 30,
            durationMax: 120,
        };
        const programDB = {
            findRule: vi.fn().mockResolvedValue([storedProgram(52), storedProgram(53, { startAt: 2_000 })]),
        };
        const model = new ScheduleApiModel({}, programDB);

        const result = await model.search(option, false, 2);

        expect(programDB.findRule).toHaveBeenCalledWith({ searchOption: option, limit: 2 });
        expect(result.map((value: { id: number }) => value.id)).toEqual([52, 53]);
    });

    it('[PG-T2.4] distinguishes not-found from uncached successful logo acquisition', async () => {
        const first = Buffer.from('synthetic-spec-logo-1');
        const second = Buffer.from('synthetic-spec-logo-2');
        const getLogo = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
        const findId = vi
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(storedChannel())
            .mockResolvedValueOnce(storedChannel());
        const model = new ChannelApiModel({ findId }, { getLogo });

        await expect(model.getLogo(51)).rejects.toThrow(IChannelApiModelError.NOT_FOUND);
        await expect(model.getLogo(51)).resolves.toBe(first);
        await expect(model.getLogo(51)).resolves.toBe(second);
        expect(getLogo.mock.calls).toEqual([[51], [51]]);
    });

    it('[PG-T3.1] runs one serialized full synchronization for each feed-start generation', async () => {
        const processSendDescriptor = Object.getOwnPropertyDescriptor(process, 'send');
        Object.defineProperty(process, 'send', {
            configurable: true,
            value: vi.fn(() => true),
            writable: true,
        });
        const synchronizations = [createDeferred<void>(), createDeferred<void>(), createDeferred<void>()];
        const synchronizationStarted = [createDeferred<void>(), createDeferred<void>(), createDeferred<void>()];
        let activeSynchronizations = 0;
        let maximumActiveSynchronizations = 0;
        const updateAll = vi.fn(() => {
            const index = updateAll.mock.calls.length - 1;
            activeSynchronizations++;
            maximumActiveSynchronizations = Math.max(maximumActiveSynchronizations, activeSynchronizations);
            synchronizationStarted[index]?.resolve(undefined);
            return synchronizations[index].promise.finally(() => {
                activeSynchronizations--;
            });
        });
        const updateManage = Object.assign(new EventEmitter(), { updateAll });
        const updater = new EPGUpdater(
            { getLogger: logger },
            { getConfig: () => ({ epgUpdateIntervalTime: 1 }) },
            updateManage,
        ) as any;

        try {
            updateManage.emit(EPGUpdateEvent.STREAM_STARTED);
            updateManage.emit(EPGUpdateEvent.STREAM_STARTED);
            updateManage.emit(EPGUpdateEvent.STREAM_STARTED);
            await synchronizationStarted[0].promise;

            expect(updateAll).toHaveBeenCalledTimes(1);
            expect(maximumActiveSynchronizations).toBe(1);

            synchronizations[0].resolve(undefined);
            await synchronizationStarted[1].promise;
            expect(updateAll).toHaveBeenCalledTimes(2);
            expect(maximumActiveSynchronizations).toBe(1);

            synchronizations[1].resolve(undefined);
            await vi.waitFor(() => expect(updateAll).toHaveBeenCalledTimes(3));

            synchronizations[2].resolve(undefined);
            await synchronizationStarted[2].promise;
            await vi.waitFor(() => expect(updater.isUpdateCycleActive).toBe(false));
            expect(maximumActiveSynchronizations).toBe(1);
            expect(updater.isEventStreamAlive).toBe(true);
            expect(updater.retryCount).toBe(0);
        } finally {
            for (const synchronization of synchronizations) synchronization.resolve(undefined);
            await vi.waitFor(() => expect(updater.isUpdateCycleActive).toBe(false));
            if (processSendDescriptor === undefined) delete process.send;
            else Object.defineProperty(process, 'send', processSendDescriptor);
        }
    });

    it('[PG-T3.2] deletes expired programs using the current time without coupling the operation to acquisition', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(987_654);
        const { model, programDB } = createModel();

        await model.deleteOldPrograms();

        expect(programDB.deleteOld).toHaveBeenCalledWith(987_654);
        expect(model.log.system.info.mock.calls).toEqual([
            ['delete old program db start'],
            ['delete old program db done'],
        ]);
    });
});

describe('program guide Tasks 5.3-5.4 periodic single-flight contract', () => {
    it('[PG-AUX-T5.3] coalesces repeated active ticks and re-evaluates once with the settlement-time clock', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const first = createDeferred<void>();
        const second = createDeferred<void>();
        const third = createDeferred<void>();
        const firstStarted = createDeferred<void>();
        const secondStarted = createDeferred<void>();
        const thirdStarted = createDeferred<void>();
        let concurrentSaves = 0;
        let maximumConcurrentSaves = 0;
        const pendingSaves = [first, second, third];
        const startedSaves = [firstStarted, secondStarted, thirdStarted];
        const saveProgram = vi.fn((timeThreshold?: number) => {
            const index = saveProgram.mock.calls.length - 1;
            concurrentSaves++;
            maximumConcurrentSaves = Math.max(maximumConcurrentSaves, concurrentSaves);
            const pendingSave = pendingSaves[index];
            startedSaves[index]?.resolve(undefined);
            if (pendingSave === undefined) {
                concurrentSaves--;
                return Promise.resolve();
            }
            return pendingSave.promise.finally(() => {
                concurrentSaves--;
            });
        });
        const updateManage = Object.assign(new EventEmitter(), {
            deleteOldPrograms: vi.fn(async () => undefined),
            saveOnAirServices: vi.fn(async () => undefined),
            saveProgram,
            saveService: vi.fn(async () => undefined),
            saveUpdateServices: vi.fn(async () => undefined),
            start: vi.fn(async () => undefined),
            updateAll: vi.fn(async () => undefined),
        });
        const updater = new EPGUpdater(
            { getLogger: logger },
            { getConfig: () => ({ epgUpdateIntervalTime: 1 }) },
            updateManage,
        ) as any;
        updater.isEventStreamAlive = true;
        updater.lastUpdatedTime = 100_000;
        updater.lastDeletedTime = 100_000;
        updater.startEventStreamAnalysis = vi.fn();
        const listenerCounts = Object.fromEntries(
            updateManage.eventNames().map(name => [name, updateManage.listenerCount(name)]),
        );

        await updater.start();
        await vi.advanceTimersByTimeAsync(10_000);
        await firstStarted.promise;
        await vi.advanceTimersByTimeAsync(30_000);

        expect(saveProgram).toHaveBeenCalledTimes(1);
        expect(saveProgram).toHaveBeenNthCalledWith(1, 410_000);
        expect(maximumConcurrentSaves).toBe(1);

        first.resolve(undefined);
        await secondStarted.promise;
        expect(saveProgram).toHaveBeenCalledTimes(2);
        expect(saveProgram).toHaveBeenNthCalledWith(2, 440_000);
        expect(maximumConcurrentSaves).toBe(1);

        await vi.advanceTimersByTimeAsync(10_000);
        expect(saveProgram).toHaveBeenCalledTimes(2);
        second.resolve(undefined);
        await thirdStarted.promise;
        expect(saveProgram).toHaveBeenNthCalledWith(3, 450_000);
        expect(maximumConcurrentSaves).toBe(1);

        third.resolve(undefined);
        await third.promise;
        await Promise.resolve();
        expect(concurrentSaves).toBe(0);
        expect(vi.getTimerCount()).toBe(1);
        expect(
            Object.fromEntries(updateManage.eventNames().map(name => [name, updateManage.listenerCount(name)])),
        ).toEqual(listenerCounts);
    });
});

describe('Program Guide gap-closure characterization (B8-PG-TRACE-GAP-CLOSE-01)', () => {
    it('[PG-GAP-A1] rejects a schedule query before any repository access when no broadcast wave is selected', async () => {
        const findChannleTypes = vi.fn();
        const findSchedule = vi.fn();
        const model = new ScheduleApiModel({ findChannleTypes }, { findSchedule });

        await expect(model.getSchedules({ startAt: 1_000, endAt: 2_000, isHalfWidth: false })).rejects.toThrow(
            'GetScheduleTypesError',
        );
        expect(findChannleTypes).not.toHaveBeenCalled();
        expect(findSchedule).not.toHaveBeenCalled();
    });

    it('[PG-GAP-A2] rejects a channel schedule query before any program lookup when the channel is not stored', async () => {
        const findId = vi.fn(async () => null);
        const findSchedule = vi.fn();
        const model = new ScheduleApiModel({ findId }, { findSchedule });

        await expect(
            model.getChannelSchedule({ channelId: 51, startAt: 1_000, days: 2, isHalfWidth: false }),
        ).rejects.toThrow('ChannelIsNotFound');
        expect(findSchedule).not.toHaveBeenCalled();
    });

    it('[PG-GAP-B1] maps every stored channel field and omits remoteControlKeyId only when absent', async () => {
        const withKey = canonicalStoredChannel({ id: 51, channelType: 'GR', remoteControlKeyId: 5 });
        const withoutKey = canonicalStoredChannel({ id: 52, channelType: 'BS', remoteControlKeyId: null });
        const channelDB = { findAll: vi.fn(async () => [withKey, withoutKey]) };
        const model = new ChannelApiModel(channelDB, {});

        const result = await model.getChannels();

        expect(result[0]).toEqual({
            id: withKey.id,
            serviceId: withKey.serviceId,
            networkId: withKey.networkId,
            name: withKey.name,
            halfWidthName: withKey.halfWidthName,
            hasLogoData: withKey.hasLogoData,
            channelType: 'GR',
            channel: withKey.channel,
            type: withKey.type,
            remoteControlKeyId: 5,
        });
        expect(result[1]).toEqual({
            id: withoutKey.id,
            serviceId: withoutKey.serviceId,
            networkId: withoutKey.networkId,
            name: withoutKey.name,
            halfWidthName: withoutKey.halfWidthName,
            hasLogoData: withoutKey.hasLogoData,
            channelType: 'BS',
            channel: withoutKey.channel,
            type: withoutKey.type,
        });
        expect('remoteControlKeyId' in result[1]).toBe(false);
        expect(channelDB.findAll).toHaveBeenCalledWith(true);
    });
});
