import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDialectPersistence, type DatabaseDialect } from '../fixtures/reservation-rules/runtime';
import { createDeferred } from '../harness/async';
import { rawProgram, rawService } from '../fixtures/program-guide/raw-tuner-responses';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');
const load = <T>(...segments: string[]): T => (require(join(snapshot, ...segments)) as { default: T }).default;
const TunerServerAccessModel = load<new (...args: any[]) => any>('model', 'tuner', 'TunerServerAccessModel.js');
const MirakurunChangeAdapter = load<new (...args: any[]) => any>(
    'model',
    'tuner',
    'change',
    'MirakurunChangeAdapter.js',
);
const MirakcChangeAdapter = load<new (...args: any[]) => any>('model', 'tuner', 'change', 'MirakcChangeAdapter.js');
const EPGUpdateManageModel = load<new (...args: any[]) => any>('model', 'epgUpdater', 'EPGUpdateManageModel.js');
const EPGUpdater = load<new (...args: any[]) => any>('model', 'epgUpdater', 'EPGUpdater.js');
const ChannelApiModel = load<new (...args: any[]) => any>('model', 'api', 'channel', 'ChannelApiModel.js');
const ScheduleApiModel = load<new (...args: any[]) => any>('model', 'api', 'schedule', 'ScheduleApiModel.js');
const { IChannelApiModelError } = require(join(snapshot, 'model', 'api', 'channel', 'IChannelApiModel.js')) as any;

const logger = { system: { debug: vi.fn(), error: vi.fn(), info: vi.fn() } };
const makeManager = (tuner: any) => {
    const channelDB = { insert: vi.fn(async () => undefined), update: vi.fn(async () => undefined) };
    const programDB = {
        deleteOld: vi.fn(async () => undefined),
        insert: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined),
    };
    const model = new EPGUpdateManageModel(
        { getLogger: () => logger },
        { getConfig: () => ({}) },
        tuner,
        channelDB,
        programDB,
    );
    return { channelDB, model, programDB };
};
const flush = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0);
};
const expectFeedReleased = (stream: PassThrough): void => {
    for (const event of ['data', 'error', 'end', 'close']) expect(stream.listenerCount(event)).toBe(0);
    expect(stream.destroyed).toBe(true);
};

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('Program Guide actual canonical tuner boundary', () => {
    it('[PG-T4.1/4.2] gives sequential full-snapshot requests independent 30-second deadlines', async () => {
        vi.useFakeTimers();
        const services = createDeferred<unknown>();
        const programs = createDeferred<unknown>();
        const requestSignals: AbortSignal[] = [];
        const getJson = vi.fn((path: string, options: { signal: AbortSignal }) => {
            requestSignals.push(options.signal);
            if (path === '/api/services') return services.promise;
            if (path === '/api/programs') return programs.promise;
            throw new Error(`unexpected synthetic path: ${path}`);
        });
        const tuner = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', { getJson });
        const harness = makeManager(tuner);

        const outcome = harness.model.updateAll().then(
            () => undefined,
            (error: Error) => error,
        );
        await flush();
        expect(getJson.mock.calls.map(([path]) => path)).toEqual(['/api/services']);

        await vi.advanceTimersByTimeAsync(29_999);
        services.resolve([rawService()]);
        await flush();
        expect(getJson.mock.calls.map(([path]) => path)).toEqual(['/api/services', '/api/programs']);
        expect(harness.channelDB.insert).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(29_999);
        expect(harness.programDB.insert).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await expect(outcome).resolves.toMatchObject({ message: 'Tuner request timeout after 30000ms' });
        expect(requestSignals).toHaveLength(2);
        expect(requestSignals[0].aborted).toBe(false);
        expect(requestSignals[1].aborted).toBe(true);
        expect(harness.programDB.insert).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);

        programs.resolve([rawProgram('mirakurun')]);
        await flush();
        expect(harness.programDB.insert).not.toHaveBeenCalled();
    });

    it('[PG-T4.1/4.2] gives each sequential service request its own 30-second deadline and releases resources', async () => {
        vi.useFakeTimers();
        const first = createDeferred<unknown>();
        const second = createDeferred<unknown>();
        const requestSignals: AbortSignal[] = [];
        const getJson = vi.fn((path: string, options: { signal: AbortSignal }) => {
            if (path === '/api/services') return Promise.resolve([]);
            requestSignals.push(options.signal);
            if (path === '/api/services/71/programs') return first.promise;
            if (path === '/api/services/72/programs') return second.promise;
            throw new Error(`unexpected synthetic path: ${path}`);
        });
        const tuner = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', { getJson });
        const harness = makeManager(tuner);
        harness.model.updatedOnAirServiceIds = { 71: true, 72: true };

        const outcome = harness.model.saveOnAirServices().then(
            () => undefined,
            (error: Error) => error,
        );
        await flush();
        expect(getJson.mock.calls.map(([path]) => path)).toEqual(['/api/services', '/api/services/71/programs']);

        await vi.advanceTimersByTimeAsync(29_999);
        expect(harness.programDB.insert).not.toHaveBeenCalled();
        first.resolve([rawProgram('mirakurun', 71)]);
        await flush();
        expect(getJson.mock.calls.map(([path]) => path)).toEqual([
            '/api/services',
            '/api/services/71/programs',
            '/api/services/72/programs',
        ]);

        await vi.advanceTimersByTimeAsync(29_999);
        expect(harness.programDB.insert).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await expect(outcome).resolves.toMatchObject({ message: 'Tuner request timeout after 30000ms' });
        expect(requestSignals).toHaveLength(2);
        expect(requestSignals[0].aborted).toBe(false);
        expect(requestSignals[1].aborted).toBe(true);
        expect(harness.model.updatedOnAirServiceIds).toEqual({ 71: true, 72: true });
        expect(harness.programDB.insert).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);

        second.resolve([rawProgram('mirakurun', 72)]);
        await flush();
        expect(harness.programDB.insert).not.toHaveBeenCalled();
    });

    it('[PG-T4.1/4.2] completes 21 sequential near-deadline service requests without an aggregate deadline', async () => {
        vi.useFakeTimers();
        const serviceIds = Array.from({ length: 21 }, (_, index) => 101 + index);
        const responses = new Map(serviceIds.map(serviceId => [serviceId, createDeferred<unknown>()]));
        const requested: number[] = [];
        const getJson = vi.fn((path: string) => {
            if (path === '/api/services') return Promise.resolve([]);
            const match = /^\/api\/services\/(\d+)\/programs$/u.exec(path);
            if (match === null) throw new Error(`unexpected synthetic path: ${path}`);
            const serviceId = Number(match[1]);
            requested.push(serviceId);
            return responses.get(serviceId)!.promise;
        });
        const tuner = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', { getJson });
        const harness = makeManager(tuner);
        harness.model.updatedOnAirServiceIds = Object.fromEntries(serviceIds.map(serviceId => [serviceId, true]));

        const outcome = harness.model.saveOnAirServices();
        await flush();
        for (const serviceId of serviceIds) {
            expect(requested.at(-1)).toBe(serviceId);
            await vi.advanceTimersByTimeAsync(29_999);
            responses.get(serviceId)!.resolve([rawProgram('mirakurun', serviceId)]);
            await flush();
        }

        await expect(outcome).resolves.toBeUndefined();
        expect(requested).toEqual(serviceIds);
        expect(harness.programDB.insert).toHaveBeenCalledOnce();
        expect(harness.programDB.insert.mock.calls[0][2]).toEqual(serviceIds);
        expect(harness.programDB.insert.mock.calls[0][1]).toHaveLength(21);
        expect(harness.model.updatedOnAirServiceIds).toEqual({});
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[PG-T4.1/4.2] preserves an actual logo deadline as acquisition failure instead of not-found', async () => {
        vi.useFakeTimers();
        const body = createDeferred<Buffer>();
        let requestSignal: AbortSignal | undefined;
        const getBuffer = vi.fn((_path: string, options: { signal: AbortSignal }) => {
            requestSignal = options.signal;
            return body.promise;
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
        await vi.advanceTimersByTimeAsync(29_999);
        expect(requestSignal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);

        await expect(outcome).resolves.toMatchObject({ message: 'Tuner request timeout after 30000ms' });
        expect(getBuffer).toHaveBeenCalledWith('/api/services/31/logo', { signal: requestSignal });
        expect(requestSignal?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    // The mysql rows of this it.each recorded up to ~4.3-4.4s across three canonical coverage runs,
    // so they get an explicit larger timeout budget. it.each applies one timeout to all rows; the sqlite rows are unaffected by the higher budget.
    it.each([
        { dialect: 'sqlite', product: 'mirakurun' },
        { dialect: 'mysql', product: 'mirakurun' },
        { dialect: 'sqlite', product: 'mirakc' },
        { dialect: 'mysql', product: 'mirakc' },
    ] as const)(
        '[PG-T4.1/4.2] gives $product on $dialect the canonical persistence and public projections',
        async ({ dialect, product }) => {
            const getJson = vi.fn(async (path: string) => {
                if (path === '/api/services') return [rawService()];
                if (path === '/api/programs') return [rawProgram(product)];
                throw new Error(`unexpected synthetic path: ${path}`);
            });
            const tuner = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
                getJson,
            });
            const harness = makeManager(tuner);
            const fixture = await createDialectPersistence(dialect as DatabaseDialect);

            try {
                await harness.model.updateAll();
                const normalizedProgram = harness.programDB.insert.mock.calls[0][1][0];
                await fixture.programDB.insert({ 10: { 101: { id: 1, type: 'GR', channel: '1' } } }, [
                    normalizedProgram,
                ]);
                const projection = await fixture.programDB.findId(normalizedProgram.id);
                const schedule = new ScheduleApiModel({}, fixture.programDB);
                const publicProgram = await schedule.getSchedule(normalizedProgram.id, false);
                const savedProjection = {
                    audioComponentType: projection.audioComponentType,
                    audioSamplingRate: projection.audioSamplingRate,
                    channelId: projection.channelId,
                    extended: projection.extended,
                    id: projection.id,
                    name: projection.name,
                };

                expect(savedProjection).toEqual({
                    audioComponentType: 3,
                    audioSamplingRate: 48_000,
                    channelId: 1,
                    extended: '◇heading\nsynthetic-extended',
                    id: 11,
                    name: 'synthetic-program',
                });
                expect(publicProgram).toEqual({
                    audioComponentType: 3,
                    audioSamplingRate: 48_000,
                    channelId: 1,
                    endAt: 61_000,
                    extended: '◇heading\nsynthetic-extended',
                    id: 11,
                    isFree: true,
                    name: 'synthetic-program',
                    rawExtended: { heading: 'synthetic-extended' },
                    startAt: 1_000,
                });
                expect(JSON.stringify({ publicProgram, savedProjection })).not.toMatch(/mirakurun|mirakc|product/u);
                expect(harness.channelDB.insert).toHaveBeenCalledWith([rawService()]);
            } finally {
                await fixture.cleanup();
            }
        },
        30_000,
    );

    it('[PG-T4.1/4.2] gives both tuner products the same logo outcome categories', async () => {
        const logoCategories: unknown[] = [];
        for (const product of ['mirakurun', 'mirakc'] as const) {
            const logo = Buffer.from('synthetic-logo');
            const getJson = vi.fn(async (path: string) => {
                if (path === '/api/services') return [rawService()];
                if (path === '/api/programs') return [rawProgram(product)];
                throw new Error(`unexpected synthetic path: ${path}`);
            });
            const tuner = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
                getJson,
                getBuffer: vi.fn(async () => logo),
            });
            const harness = makeManager(tuner);

            await harness.model.updateAll();
            const logoApi = new ChannelApiModel({ findId: vi.fn(async () => ({ id: 1, hasLogoData: true })) }, tuner);
            const missingLogoApi = new ChannelApiModel({ findId: vi.fn(async () => null) }, tuner);
            const acquisitionFailure = new Error('synthetic-logo-acquisition-failure');
            const failedTuner = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
                getJson: vi.fn(),
                getBuffer: vi.fn(async () => Promise.reject(acquisitionFailure)),
            });
            const failedLogoApi = new ChannelApiModel(
                { findId: vi.fn(async () => ({ id: 1, hasLogoData: true })) },
                failedTuner,
            );
            logoCategories.push({
                success: Buffer.isBuffer(await logoApi.getLogo(1)),
                missing: await missingLogoApi.getLogo(1).catch((error: Error) => error.message),
                acquisition: await failedLogoApi.getLogo(1).catch((error: Error) => error),
            });
            expect(harness.channelDB.insert).toHaveBeenCalledWith([rawService()]);
        }

        expect(logoCategories).toEqual([
            { success: true, missing: IChannelApiModelError.NOT_FOUND, acquisition: expect.any(Error) },
            { success: true, missing: IChannelApiModelError.NOT_FOUND, acquisition: expect.any(Error) },
        ]);
        expect((logoCategories[0] as any).acquisition.message).toBe('synthetic-logo-acquisition-failure');
        expect((logoCategories[1] as any).acquisition.message).toBe('synthetic-logo-acquisition-failure');
        expect(JSON.stringify(logoCategories)).not.toMatch(/mirakurun|mirakc|product/u);
    });

    it('[PG-T6.1] carries both product feed lifecycles through failed sync, incremental read, backoff, and one late outcome', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const originalSend = Object.getOwnPropertyDescriptor(process, 'send');
        const send = vi.fn(() => true);
        Object.defineProperty(process, 'send', { configurable: true, value: send, writable: true });
        const productOutcomes: unknown[] = [];

        try {
            for (const product of ['mirakurun', 'mirakc'] as const) {
                const fixture = await createDialectPersistence('sqlite');
                const firstStream = new PassThrough();
                const secondStream = new PassThrough();
                const openStream = vi.fn().mockResolvedValueOnce(firstStream).mockResolvedValueOnce(secondStream);
                const adapter =
                    product === 'mirakurun'
                        ? new MirakurunChangeAdapter(openStream)
                        : new MirakcChangeAdapter(openStream);
                const unusedAdapter = { open: vi.fn() };
                let programSnapshotRequest = 0;
                const getJson = vi.fn(async (path: string) => {
                    if (path === '/api/services') return [rawService()];
                    if (path === '/api/programs') {
                        programSnapshotRequest++;
                        if (programSnapshotRequest === 1) {
                            throw new Error(`synthetic-${product}-initial-sync-failure`);
                        }
                        return [rawProgram(product, 12)];
                    }
                    if (path === '/api/services/101/programs') return [rawProgram(product, 11)];
                    throw new Error(`unexpected synthetic path: ${path}`);
                });
                const tuner = new TunerServerAccessModel(
                    'http://synthetic.invalid:40772',
                    'epgstation/synthetic',
                    { getJson },
                    {
                        changeFeed: {
                            detector: { detect: vi.fn(async () => product) },
                            mirakurun: product === 'mirakurun' ? adapter : unusedAdapter,
                            mirakc: product === 'mirakc' ? adapter : unusedAdapter,
                        },
                    },
                );
                const latePersistence = createDeferred<void>();
                let latePersistenceStartedAt: number | undefined;
                const persistedProgramDB = {
                    deleteOld: vi.fn(fixture.programDB.deleteOld.bind(fixture.programDB)),
                    insert: vi.fn(async (...args: any[]) => {
                        if (args.length === 2) {
                            latePersistenceStartedAt = Date.now();
                            await latePersistence.promise;
                        }
                        return fixture.programDB.insert(...args);
                    }),
                    update: vi.fn(fixture.programDB.update.bind(fixture.programDB)),
                };
                const channelDB = { insert: vi.fn(async () => undefined), update: vi.fn(async () => undefined) };
                const managerLogger = {
                    system: { debug: vi.fn(), error: vi.fn(), info: vi.fn() },
                };
                const updateManage = new EPGUpdateManageModel(
                    { getLogger: () => managerLogger },
                    { getConfig: () => ({}) },
                    tuner,
                    channelDB,
                    persistedProgramDB,
                );
                const updater = new EPGUpdater(
                    { getLogger: () => ({ system: { debug: vi.fn(), error: vi.fn(), info: vi.fn() } }) },
                    { getConfig: () => ({ epgUpdateIntervalTime: 1 }) },
                    updateManage,
                ) as any;

                try {
                    const firstAttempt = updater.runEventStreamAttempt();
                    await vi.waitFor(() => expect(programSnapshotRequest).toBe(1));
                    await vi.waitFor(() => expect(updater.isUpdateCycleActive).toBe(false));
                    expect(updater.isEventStreamAlive).toBe(true);
                    expect(send).not.toHaveBeenCalled();

                    if (product === 'mirakurun') {
                        firstStream.write(
                            JSON.stringify({
                                resource: 'program',
                                type: 'update',
                                data: rawProgram(product, 11),
                                time: 101_000,
                            }),
                        );
                    } else {
                        firstStream.write('event: onair.program-changed\ndata: {"serviceId":101}\n\n');
                    }
                    await flush();
                    vi.setSystemTime(110_000);
                    updater.requestUpdateCycle();
                    await vi.waitFor(() => expect(fixture.programDB.findId(11)).resolves.not.toBeNull());
                    const incremental = await fixture.programDB.findId(11);
                    expect(incremental).toMatchObject({ id: 11, name: 'synthetic-program' });
                    expect(send).not.toHaveBeenCalled();

                    const transportFailure = new Error(`synthetic-${product}-transport-failure`);
                    firstStream.emit('error', transportFailure);
                    expect(updater.isEventStreamAlive).toBe(false);
                    let firstAttemptSettled = false;
                    void firstAttempt.then(() => {
                        firstAttemptSettled = true;
                    });
                    await vi.advanceTimersByTimeAsync(4_999);
                    expect(firstAttemptSettled).toBe(false);
                    await vi.advanceTimersByTimeAsync(1);
                    await firstAttempt;
                    expect(updater.retryCount).toBe(1);
                    expectFeedReleased(firstStream);

                    const secondAttempt = updater.runEventStreamAttempt();
                    await vi.waitFor(() =>
                        expect(
                            persistedProgramDB.insert.mock.calls.some(
                                args => args.length === 2 && args[1].length === 1 && args[1][0].id === 12,
                            ),
                        ).toBe(true),
                    );
                    expect(latePersistenceStartedAt).toBeTypeOf('number');
                    expect(updater.retryCount).toBe(0);
                    expect(send).not.toHaveBeenCalled();
                    const elapsedSynchronizationTime = Date.now() - latePersistenceStartedAt!;
                    const timeoutLogs = () =>
                        managerLogger.system.error.mock.calls.filter(
                            ([value]: unknown[]) => value === 'update all timeout',
                        );
                    expect(timeoutLogs()).toHaveLength(0);
                    await vi.advanceTimersByTimeAsync(600_000 - elapsedSynchronizationTime - 1);
                    expect(timeoutLogs()).toHaveLength(0);
                    await vi.advanceTimersByTimeAsync(1);
                    expect(managerLogger.system.error).toHaveBeenCalledWith('update all timeout');
                    expect(timeoutLogs()).toHaveLength(1);
                    expect(send).not.toHaveBeenCalled();

                    latePersistence.resolve(undefined);
                    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
                    const detail = await new ScheduleApiModel({}, fixture.programDB).getSchedule(12, false);
                    productOutcomes.push({
                        detail,
                        incremental: { id: incremental.id, name: incremental.name },
                    });

                    secondStream.emit('error', new Error(`synthetic-${product}-cleanup`));
                    await vi.advanceTimersByTimeAsync(5_000);
                    await secondAttempt;
                    expectFeedReleased(secondStream);
                    expect(vi.getTimerCount()).toBe(0);
                } finally {
                    send.mockClear();
                    await fixture.cleanup();
                }
            }
        } finally {
            if (originalSend === undefined) delete process.send;
            else Object.defineProperty(process, 'send', originalSend);
        }

        expect(productOutcomes).toEqual([
            {
                detail: expect.objectContaining({
                    channelId: 1,
                    extended: '◇heading\nsynthetic-extended',
                    id: 12,
                    name: 'synthetic-program',
                }),
                incremental: { id: 11, name: 'synthetic-program' },
            },
            {
                detail: expect.objectContaining({
                    channelId: 1,
                    extended: '◇heading\nsynthetic-extended',
                    id: 12,
                    name: 'synthetic-program',
                }),
                incremental: { id: 11, name: 'synthetic-program' },
            },
        ]);
        expect(JSON.stringify(productOutcomes)).not.toMatch(/mirakurun|mirakc|product/u);
    });

    it('[PG-T4.3/4.4] carries both product change feeds to equal program persistence input and cleans transport state', async () => {
        vi.useFakeTimers();
        const mirakurunStream = new PassThrough();
        const openMirakurun = vi.fn(async () => mirakurunStream);
        const mirakurunAdapter = new MirakurunChangeAdapter(openMirakurun);
        const detectMirakurun = vi.fn(async () => 'mirakurun');
        const unusedMirakc = { open: vi.fn() };
        const mirakurunTuner = new TunerServerAccessModel(
            'http://synthetic.invalid:40772',
            'epgstation/synthetic',
            { getJson: vi.fn() },
            {
                changeFeed: {
                    detector: { detect: detectMirakurun },
                    mirakurun: mirakurunAdapter,
                    mirakc: unusedMirakc,
                },
            },
        );
        const mirakurun = makeManager(mirakurunTuner);
        mirakurun.model.channelIndex = { 10: { 101: { id: 1, type: 'GR', channel: '1' } } };
        const mirakurunCompletion = mirakurun.model.start().catch((error: Error) => error);
        await flush();
        expect(detectMirakurun.mock.calls).toEqual([[undefined]]);
        expect(openMirakurun.mock.calls).toEqual([[undefined]]);
        expect(unusedMirakc.open).not.toHaveBeenCalled();
        mirakurunStream.write(
            JSON.stringify({ resource: 'program', type: 'update', data: rawProgram('mirakurun'), time: 2_000 }),
        );
        await flush();
        await mirakurun.model.saveProgram();
        const fromMirakurun = mirakurun.programDB.update.mock.calls[0][1].update[0];
        mirakurunStream.end();
        await expect(mirakurunCompletion).resolves.toMatchObject({ message: 'Ended tuner change feed' });
        expectFeedReleased(mirakurunStream);

        const mirakcStream = new PassThrough();
        const openMirakc = vi.fn(async () => mirakcStream);
        const mirakcAdapter = new MirakcChangeAdapter(openMirakc);
        const detectMirakc = vi.fn(async () => 'mirakc');
        const unusedMirakurun = { open: vi.fn() };
        const getJson = vi.fn(async (path: string) => {
            if (path === '/api/services') return [rawService()];
            if (path === '/api/services/101/programs') return [rawProgram('mirakc')];
            throw new Error(`unexpected synthetic path: ${path}`);
        });
        const mirakcTuner = new TunerServerAccessModel(
            'http://synthetic.invalid:40772',
            'epgstation/synthetic',
            { getJson },
            {
                changeFeed: {
                    detector: { detect: detectMirakc },
                    mirakurun: unusedMirakurun,
                    mirakc: mirakcAdapter,
                },
            },
        );
        const mirakc = makeManager(mirakcTuner);
        const mirakcCompletion = mirakc.model.start().catch((error: Error) => error);
        await flush();
        expect(detectMirakc.mock.calls).toEqual([[undefined]]);
        expect(openMirakc.mock.calls).toEqual([[undefined]]);
        expect(unusedMirakurun.open).not.toHaveBeenCalled();
        mirakcStream.write('event: onair.program-changed\ndata: {"serviceId":101}\n\n');
        await flush();
        await mirakc.model.saveOnAirServices();
        const fromMirakc = mirakc.programDB.insert.mock.calls[0][1][0];
        mirakcStream.end();
        await expect(mirakcCompletion).resolves.toMatchObject({ message: 'Ended mirakc change feed' });
        expectFeedReleased(mirakcStream);

        expect(fromMirakurun).toEqual(fromMirakc);
        expect(JSON.stringify([fromMirakurun, fromMirakc])).not.toMatch(/mirakurun|mirakc|product/u);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['mirakurun', 'mirakc'] as const)(
        '[PG-T4.3/4.4] propagates a %s open failure without resources and permits a later reconnect',
        async product => {
            vi.useFakeTimers();
            const failure = new Error(`synthetic-${product}-open-failure`);
            const stream = new PassThrough();
            const openStream = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(stream);
            const adapter =
                product === 'mirakurun' ? new MirakurunChangeAdapter(openStream) : new MirakcChangeAdapter(openStream);
            const observer = { started: vi.fn(), changed: vi.fn(), aborted: vi.fn() };
            const options = { signal: new AbortController().signal };

            await expect(adapter.open(observer, options)).rejects.toBe(failure);
            expect(openStream).toHaveBeenCalledOnce();
            expect(openStream).toHaveBeenLastCalledWith(options);
            expect(observer.started).not.toHaveBeenCalled();
            expect(observer.changed).not.toHaveBeenCalled();
            expect(observer.aborted).not.toHaveBeenCalled();
            for (const event of ['data', 'error', 'end', 'close']) expect(stream.listenerCount(event)).toBe(0);
            expect(stream.destroyed).toBe(false);
            expect(vi.getTimerCount()).toBe(0);

            const handle = await adapter.open(observer, options);
            expect(openStream).toHaveBeenCalledTimes(2);
            expect(observer.started).toHaveBeenCalledOnce();
            handle.close();
            await expect(handle.completion).resolves.toBeUndefined();
            expectFeedReleased(stream);
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it.each(['mirakurun', 'mirakc'] as const)(
        '[PG-T4.3/4.4] reports a %s parse failure through aborted and releases every transport resource',
        async product => {
            vi.useFakeTimers();
            const stream = new PassThrough();
            const openStream = vi.fn(async () => stream);
            const adapter =
                product === 'mirakurun' ? new MirakurunChangeAdapter(openStream) : new MirakcChangeAdapter(openStream);
            const observer = { started: vi.fn(), changed: vi.fn(), aborted: vi.fn() };
            const signal = new AbortController().signal;
            const handle = await adapter.open(observer, { signal });

            expect(openStream).toHaveBeenCalledWith({ signal });
            expect(observer.started).toHaveBeenCalledOnce();
            stream.write(
                product === 'mirakurun'
                    ? 'synthetic-invalid-frame'
                    : 'event: onair.program-changed\ndata: {synthetic-invalid}\n\n',
            );
            const outcome = await handle.completion.catch((error: Error) => error);

            expect(outcome).toMatchObject({
                message: product === 'mirakurun' ? 'Invalid Mirakurun change frame' : 'Invalid mirakc change frame',
            });
            expect(observer.aborted).toHaveBeenCalledWith(outcome);
            expect(observer.changed).not.toHaveBeenCalled();
            expectFeedReleased(stream);
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it.each(['mirakurun', 'mirakc'] as const)(
        '[PG-T4.3/4.4] preserves a %s transport error through aborted and releases every transport resource',
        async product => {
            vi.useFakeTimers();
            const stream = new PassThrough();
            const adapter =
                product === 'mirakurun'
                    ? new MirakurunChangeAdapter(async () => stream)
                    : new MirakcChangeAdapter(async () => stream);
            const observer = { started: vi.fn(), changed: vi.fn(), aborted: vi.fn() };
            const handle = await adapter.open(observer);
            const failure = new Error(`synthetic-${product}-transport-failure`);

            stream.emit('error', failure);
            const outcome = await handle.completion.catch((error: Error) => error);

            expect(outcome).toBe(failure);
            expect(observer.aborted).toHaveBeenCalledWith(failure);
            expect(observer.changed).not.toHaveBeenCalled();
            expectFeedReleased(stream);
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it('[PG-T4.3/4.4] preserves the product-specific normal-end aborted difference and cleans both streams', async () => {
        vi.useFakeTimers();
        const outcomes: Error[] = [];
        for (const product of ['mirakurun', 'mirakc'] as const) {
            const stream = new PassThrough();
            const adapter =
                product === 'mirakurun'
                    ? new MirakurunChangeAdapter(async () => stream)
                    : new MirakcChangeAdapter(async () => stream);
            const observer = { started: vi.fn(), changed: vi.fn(), aborted: vi.fn() };
            const handle = await adapter.open(observer);

            stream.end();
            const outcome = await handle.completion.catch((error: Error) => error);
            outcomes.push(outcome);

            expect(outcome.message).toBe(
                product === 'mirakurun' ? 'Ended tuner change feed' : 'Ended mirakc change feed',
            );
            expect(observer.aborted).toHaveBeenCalledTimes(product === 'mirakurun' ? 0 : 1);
            if (product === 'mirakc') expect(observer.aborted).toHaveBeenCalledWith(outcome);
            expectFeedReleased(stream);
        }
        expect(outcomes).toHaveLength(2);
        expect(vi.getTimerCount()).toBe(0);
    });
});
