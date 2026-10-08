import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const EPGUpdateManageModel = (require(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdateManageModel.js')) as any)
    .default;
const ChannelApiModel = (require(join(compiledSnapshot, 'model', 'api', 'channel', 'ChannelApiModel.js')) as any)
    .default;
const EPGUpdater = (require(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdater.js')) as any).default;
const { EPGUpdateEvent } = require(join(compiledSnapshot, 'model', 'epgUpdater', 'IEPGUpdateManageModel.js')) as any;
const ReservationManageModel = (
    require(join(compiledSnapshot, 'model', 'operator', 'reservation', 'ReservationManageModel.js')) as any
).default;
const RecordingStreamCreator = (
    require(join(compiledSnapshot, 'model', 'operator', 'recording', 'RecordingStreamCreator.js')) as any
).default;
const LiveStreamModel = (require(join(compiledSnapshot, 'model', 'service', 'stream', 'LiveStreamModel.js')) as any)
    .default;
const TunerServerAccessModel = (require(join(compiledSnapshot, 'model', 'tuner', 'TunerServerAccessModel.js')) as any)
    .default;
const MirakcChangeAdapter = (
    require(join(compiledSnapshot, 'model', 'tuner', 'change', 'MirakcChangeAdapter.js')) as any
).default;
const ConnectionCheckModel = (require(join(compiledSnapshot, 'model', 'ConnectionCheckModel.js')) as any).default;
const Util = (require(join(compiledSnapshot, 'util', 'Util.js')) as any).default;

const logger = () => ({ system: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } });
const createLive = (streamingPriority: number, openServiceStream: ReturnType<typeof vi.fn>) =>
    new LiveStreamModel(
        { getConfig: () => ({ streamingPriority }) },
        { getLogger: () => ({ stream: { debug: vi.fn(), error: vi.fn(), info: vi.fn() } }) },
        {},
        { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
        { openServiceStream },
        { notifyClient: vi.fn() },
    ) as any;

const service = (id: number) => ({
    id,
    serviceId: id + 1,
    networkId: 10,
    name: `synthetic-service-${id}`,
    type: 1,
    hasLogoData: true,
    channel: { type: 'GR', channel: String(id) },
});
const program = (id: number, serviceId: number = 101) => ({
    id,
    eventId: id + 1,
    serviceId,
    networkId: 10,
    startAt: 1_000,
    duration: 60_000,
    isFree: true,
    name: `synthetic-program-${id}`,
});

const createRecordingStreamCreator = (tunerServerAccess: Record<string, unknown>): any =>
    new RecordingStreamCreator(
        { getLogger: logger },
        {
            getConfig: () => ({
                conflictPriority: 13,
                recPriority: 7,
                timeSpecifiedEndMargin: 0,
                timeSpecifiedStartMargin: 0,
            }),
        },
        tunerServerAccess,
    );

const epgModel = (access: Record<string, unknown>) => {
    const channelDB = { insert: vi.fn(async () => undefined), update: vi.fn(async () => undefined) };
    const programDB = { insert: vi.fn(async () => undefined), update: vi.fn(async () => undefined) };
    const log = logger();
    const model = new EPGUpdateManageModel(
        { getLogger: () => log },
        { getConfig: () => ({ excludeChannels: [], excludeSids: [] }) },
        access,
        channelDB,
        programDB,
    );
    return { channelDB, log, model, programDB };
};

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('tuner access consumer integration', () => {
    it('[TA-7.2] keeps the startup barrier closed through failure and one-second retry delay', async () => {
        const ledger: string[] = [];
        let finishDelay!: () => void;
        const delay = new Promise<void>(resolve => {
            finishDelay = resolve;
        });
        const checkAvailability = vi
            .fn()
            .mockImplementationOnce(async () => {
                ledger.push('availability-failed');
                throw new Error('SYNTHETIC_STARTUP_FAILURE');
            })
            .mockImplementationOnce(async () => {
                ledger.push('availability-succeeded');
            });
        const sleep = vi.spyOn(Util, 'sleep').mockImplementation(async (milliseconds: number) => {
            ledger.push(`sleep:${milliseconds}`);
            await delay;
        });
        const model = new ConnectionCheckModel(
            { getLogger: logger },
            { checkAvailability },
            { checkConnection: vi.fn() },
        );

        const barrier = model.checkMirakurun().then(() => ledger.push('consumer-started'));
        await vi.waitFor(() => expect(sleep).toHaveBeenCalledWith(1_000));
        expect(ledger).toEqual(['availability-failed', 'sleep:1000']);
        expect(checkAvailability).toHaveBeenCalledTimes(1);

        finishDelay();
        await barrier;
        expect(ledger).toEqual(['availability-failed', 'sleep:1000', 'availability-succeeded', 'consumer-started']);
        expect(checkAvailability).toHaveBeenCalledTimes(2);
    });

    it('[TA-7.2] removes both establishment deadlines after returning long-lived program and service handles', async () => {
        vi.useFakeTimers();
        const streams = [new PassThrough(), new PassThrough()];
        const signals: AbortSignal[] = [];
        const closes = streams.map(stream => vi.fn(() => stream.destroy()));
        const openStream = vi.fn(async (_path: string, _priority: number, options: { signal: AbortSignal }) => {
            const index = signals.length;
            const stream = streams[index];
            signals.push(options.signal);
            options.signal.addEventListener('abort', () => stream.destroy(), { once: true });
            return { stream, close: closes[index] };
        });
        const access = new TunerServerAccessModel(
            'http://synthetic.invalid:40772',
            'epgstation/synthetic',
            {
                getJson: vi.fn(),
                getBuffer: vi.fn(),
                openStream,
            },
            { tunerStreamEstablishmentTimeoutMs: 10 },
        );

        const programHandle = await access.openProgramStream({ programId: 240, priority: 7 });
        expect(vi.getTimerCount()).toBe(0);
        const serviceHandle = await access.openServiceStream({ serviceId: 150, priority: 11 });
        expect(vi.getTimerCount()).toBe(0);
        expect(signals).toHaveLength(2);
        expect(signals.every(signal => signal.aborted === false)).toBe(true);

        await vi.advanceTimersByTimeAsync(60_000);

        expect(vi.getTimerCount()).toBe(0);
        expect(signals.every(signal => signal.aborted === false)).toBe(true);
        expect(streams.every(stream => stream.destroyed === false)).toBe(true);
        expect(programHandle.stream).toBe(streams[0]);
        expect(serviceHandle.stream).toBe(streams[1]);
        programHandle.close();
        serviceHandle.close();
        expect(closes[0]).toHaveBeenCalledOnce();
        expect(closes[1]).toHaveBeenCalledOnce();
    });

    it('[TA-7.2] keeps an actual change adapter alive without a deadline and releases its interval and listeners', async () => {
        vi.useFakeTimers();
        const stream = new PassThrough();
        const observer = { aborted: vi.fn(), changed: vi.fn(), started: vi.fn() };
        const mirakc = new MirakcChangeAdapter(async () => stream);
        const access = new TunerServerAccessModel(
            'http://synthetic.invalid:40772',
            'epgstation/synthetic',
            { getJson: vi.fn(), getBuffer: vi.fn() },
            {
                changeFeed: {
                    detector: { detect: vi.fn(async () => 'mirakc') },
                    mirakurun: { open: vi.fn() },
                    mirakc,
                },
            },
        );

        const handle = await access.openChangeFeed(observer);
        expect(vi.getTimerCount()).toBe(1);
        stream.write('event:onair.program-changed\ndata:{"serviceId":151}\n\n');
        expect(observer.changed).toHaveBeenCalledWith({ kind: 'on-air-service', serviceId: 151 });

        await vi.advanceTimersByTimeAsync(60_000);

        expect(stream.destroyed).toBe(false);
        expect(vi.getTimerCount()).toBe(1);
        expect(observer.aborted).not.toHaveBeenCalled();
        handle.close();
        await expect(handle.completion).resolves.toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
        for (const event of ['data', 'error', 'end', 'close']) expect(stream.listenerCount(event)).toBe(0);
    });

    it('[TA-8.4] hands recording, live, and logo results to their canonical consumers and releases stream handles', async () => {
        const recordingStream = new PassThrough();
        const recordingClose = vi.fn(() => recordingStream.destroy());
        const openProgramStream = vi.fn(async () => ({ stream: recordingStream, close: recordingClose }));
        const recording = createRecordingStreamCreator({ openProgramStream, openServiceStream: vi.fn() });
        const recordingSignal = new AbortController().signal;
        const now = Date.now();

        await expect(
            recording.create(
                {
                    id: 840,
                    programId: 841,
                    channelId: 140,
                    isConflict: false,
                    startAt: now,
                    endAt: now + 60_000,
                },
                recordingSignal,
            ),
        ).resolves.toBe(recordingStream);
        expect(openProgramStream).toHaveBeenCalledWith({ programId: 841, priority: 7, signal: recordingSignal });
        recordingStream.resume();
        recordingStream.end();
        await vi.waitFor(() => expect(recordingClose).toHaveBeenCalledOnce());
        for (const timer of Object.values(recording.timerIndex) as NodeJS.Timeout[]) clearTimeout(timer);

        const liveStream = new PassThrough();
        const liveClose = vi.fn(() => liveStream.destroy());
        const openServiceStream = vi.fn(async () => ({ stream: liveStream, close: liveClose }));
        const live = createLive(11, openServiceStream);
        live.setOption({ channelId: 150 }, 0);

        await live.start(0);
        expect(live.getStream()).toBe(liveStream);
        expect(openServiceStream).toHaveBeenCalledWith({ serviceId: 150, priority: 11 });
        liveStream.destroy();
        await vi.waitFor(() => expect(liveClose).toHaveBeenCalledOnce());

        const firstLogo = Buffer.from('synthetic-logo-first');
        const secondLogo = Buffer.from('synthetic-logo-second');
        const getLogo = vi.fn().mockResolvedValueOnce(firstLogo).mockResolvedValueOnce(secondLogo);
        const logo = new ChannelApiModel({ findId: vi.fn(async () => ({ id: 160, hasLogoData: true })) }, { getLogo });

        await expect(logo.getLogo(160)).resolves.toBe(firstLogo);
        await expect(logo.getLogo(160)).resolves.toBe(secondLogo);
        expect(getLogo).toHaveBeenNthCalledWith(1, 160);
        expect(getLogo).toHaveBeenNthCalledWith(2, 160);
    });

    it('[TA-6.1] gives normalized service and program snapshots to the existing EPG persistence rules', async () => {
        const services = [service(100)];
        const programs = [program(200)];
        const access = {
            getServices: vi.fn(async () => services),
            getPrograms: vi.fn(async () => programs),
        };
        const { channelDB, model, programDB } = epgModel(access);

        await model.updateAll();

        expect(access.getServices).toHaveBeenCalledOnce();
        expect(access.getPrograms).toHaveBeenCalledOnce();
        expect(channelDB.insert).toHaveBeenCalledWith(services);
        expect(programDB.insert).toHaveBeenCalledWith(
            { 10: { 101: { id: 100, type: 'GR', channel: '100' } } },
            programs,
        );
    });

    it('[TA-6.1] preserves a legacy related item without type from facade normalization through EPG persistence', async () => {
        const legacyProgram = {
            ...program(205),
            relatedItems: [{ networkId: 10, serviceId: 999, eventId: 998 }],
        };
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
            getJson: vi.fn(async (route: string) => {
                if (route === '/api/services') return [service(100)];
                if (route === '/api/programs') return [legacyProgram];
                throw new Error('SYNTHETIC_UNEXPECTED_ROUTE');
            }),
            getBuffer: vi.fn(),
        });
        const { model, programDB } = epgModel(access);

        await model.updateAll();

        expect(programDB.insert).toHaveBeenCalledWith({ 10: { 101: { id: 100, type: 'GR', channel: '100' } } }, [
            legacyProgram,
        ]);
    });

    it('[TA-6.1] consumes normalized feed changes and performs mirakc service-program lookup through the facade', async () => {
        let finishFeed!: () => void;
        const completion = new Promise<void>(resolve => {
            finishFeed = resolve;
        });
        const createdProgram = program(209);
        const updatedProgram = program(210);
        const changedService = service(110);
        const feedFailure = new Error('SYNTHETIC_CHANGE_FEED_FAILURE');
        const access = {
            getServices: vi.fn(async () => [changedService]),
            getProgramsByService: vi.fn(async (serviceId: number) => [program(300 + serviceId, serviceId)]),
            openChangeFeed: vi.fn(async (observer: Record<string, (...args: any[]) => void>) => {
                observer.started();
                observer.changed({ kind: 'program', operation: 'create', program: createdProgram, time: 2_000 });
                observer.changed({ kind: 'program', operation: 'update', program: updatedProgram, time: 2_001 });
                observer.changed({ kind: 'program', operation: 'remove', programId: 211, time: 2_002 });
                observer.changed({ kind: 'program', operation: 'redefine', from: 212, to: 213, time: 2_003 });
                observer.changed({ kind: 'service', operation: 'update', service: changedService, time: 2_004 });
                observer.changed({ kind: 'on-air-service', serviceId: 120 });
                observer.changed({ kind: 'service-programs-updated', serviceId: 121 });
                observer.aborted(feedFailure);
                return { completion, close: vi.fn() };
            }),
        };
        const { log, model, programDB } = epgModel(access);
        const started = vi.fn();
        const aborted = vi.fn();
        model.on(EPGUpdateEvent.STREAM_STARTED, started);
        model.on(EPGUpdateEvent.STREAM_ABORTED, aborted);
        const pending = model.start();
        await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());

        expect(model.programQueue).toEqual([
            { resource: 'program', type: 'create', data: createdProgram, time: 2_000 },
            { resource: 'program', type: 'update', data: updatedProgram, time: 2_001 },
            { resource: 'program', type: 'remove', data: { id: 211 }, time: 2_002 },
            { resource: 'program', type: 'redefine', data: { from: 212, to: 213 }, time: 2_003 },
        ]);
        expect(model.serviceQueue).toEqual([
            { resource: 'service', type: 'update', data: changedService, time: 2_004 },
        ]);
        expect(model.updatedOnAirServiceIds).toEqual({ 120: true });
        expect(model.updateServiceIds).toEqual({ 121: true });
        expect(log.system.error.mock.calls).toEqual([['tuner change feed error'], [feedFailure]]);
        expect(aborted).toHaveBeenCalledOnce();

        await model.saveOnAirServices();
        await model.saveUpdateServices();
        expect(access.getProgramsByService.mock.calls.map((call: unknown[]) => call[0])).toEqual([120, 121]);
        expect(programDB.insert).toHaveBeenCalledTimes(2);
        expect(model.updatedOnAirServiceIds).toEqual({});
        expect(model.updateServiceIds).toEqual({});

        finishFeed();
        await expect(pending).resolves.toBeUndefined();
    });

    it('[TA-6.1] flushes both normalized change families without asking the consumer to identify a product', async () => {
        const updateManage = {
            saveOnAirServices: vi.fn(async () => undefined),
            saveUpdateServices: vi.fn(async () => undefined),
            saveProgram: vi.fn(async () => undefined),
            saveService: vi.fn(async () => undefined),
        };
        const updater = Object.create(EPGUpdater.prototype) as any;
        updater.updateManage = updateManage;
        updater.lastUpdatedTime = 0;
        updater.log = logger();
        updater.notify = vi.fn();

        await updater.updateTunerChanges(60_000, 30_000);

        expect(updateManage.saveOnAirServices).toHaveBeenCalledOnce();
        expect(updateManage.saveProgram).toHaveBeenCalledWith(330_000);
        expect(updateManage.saveService).not.toHaveBeenCalled();
        expect(updateManage.saveUpdateServices).not.toHaveBeenCalled();
        expect(updater.notify).not.toHaveBeenCalled();

        vi.clearAllMocks();
        await updater.updateTunerChanges(60_000, 60_000);

        expect(updateManage.saveOnAirServices).toHaveBeenCalledOnce();
        expect(updateManage.saveUpdateServices).toHaveBeenCalledOnce();
        expect(updateManage.saveService).toHaveBeenCalledOnce();
        expect(updateManage.saveProgram).toHaveBeenCalledWith();
        expect(updater.notify).toHaveBeenCalledOnce();
    });

    it('[TA-6.1] accepts facade tuner DTOs without a product-package type in the reservation consumer', async () => {
        const tunerPayload = [
            {
                index: 0,
                name: 'synthetic-tuner',
                types: ['GR', 'BS'],
                isAvailable: true,
                isRemote: false,
                isFree: true,
                isUsing: false,
                isFault: false,
            },
        ];
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
            getJson: vi.fn(async () => tunerPayload),
            getBuffer: vi.fn(),
        });
        const reservation = new ReservationManageModel(
            { getLogger: logger },
            { getConfig: () => ({}) },
            {},
            {},
            {},
            {},
            {},
            {},
            {},
        );

        reservation.setTuners(await access.getTuners());

        expect(reservation.getBroadcastStatus()).toEqual({ GR: true, BS: true, CS: false, SKY: false, BS4K: false });
    });

    it.each([
        ['program', 240, false, 'openProgramStream', { programId: 240, priority: 7 }],
        ['service', null, true, 'openServiceStream', { serviceId: 140, priority: 13 }],
    ])(
        '[TA-6.2] recording obtains the %s Readable through the canonical stream port and closes its handle once',
        async (_kind, programId, isConflict, operation, expectedRequest) => {
            const stream = new PassThrough();
            const close = vi.fn(() => stream.destroy());
            const openProgramStream = vi.fn(async () => ({ stream, close }));
            const openServiceStream = vi.fn(async () => ({ stream, close }));
            const creator = createRecordingStreamCreator({ openProgramStream, openServiceStream });
            const signal = new AbortController().signal;
            const now = Date.now();

            const result = await creator.create(
                {
                    id: programId ?? 241,
                    programId,
                    channelId: 140,
                    isConflict,
                    startAt: now,
                    endAt: now + 60_000,
                },
                signal,
            );

            expect(result).toBe(stream);
            expect(creator.tunerServerAccess[operation]).toHaveBeenCalledWith({
                ...expectedRequest,
                signal,
            });
            expect(openProgramStream).toHaveBeenCalledTimes(operation === 'openProgramStream' ? 1 : 0);
            expect(openServiceStream).toHaveBeenCalledTimes(operation === 'openServiceStream' ? 1 : 0);

            stream.resume();
            stream.end();
            await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
            stream.emit('close');
            expect(close).toHaveBeenCalledOnce();
            for (const timer of Object.values(creator.timerIndex) as NodeJS.Timeout[]) clearTimeout(timer);
        },
    );

    it('[TA-6.2] live delivery obtains the Readable through the canonical service stream port and closes once on terminal delivery', async () => {
        const stream = new PassThrough();
        const close = vi.fn(() => stream.destroy());
        const openServiceStream = vi.fn(async () => ({ stream, close }));
        const live = createLive(11, openServiceStream);
        live.setOption({ channelId: 150 }, 0);

        await live.start(0);

        expect(live.getStream()).toBe(stream);
        expect(openServiceStream).toHaveBeenCalledWith({ serviceId: 150, priority: 11 });
        stream.destroy();
        await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
        stream.emit('close');
        expect(close).toHaveBeenCalledOnce();
    });

    it('[TA-6.2] live stop destroys a terminal stream after its tuner handle was already closed', async () => {
        const stream = new PassThrough();
        const destroy = vi.spyOn(stream, 'destroy');
        const close = vi.fn();
        const live = createLive(
            12,
            vi.fn(async () => ({ stream, close })),
        );
        live.setOption({ channelId: 151 }, 0);

        await live.start(2);
        stream.emit('end');
        expect(close).toHaveBeenCalledOnce();

        await live.stop();
        expect(destroy).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
    });

    it.each([true, undefined])(
        '[TA-6.3] requests and returns the logo Buffer when persisted hasLogoData is %s',
        async hasLogoData => {
            const logo = Buffer.from(`synthetic-logo-${String(hasLogoData)}`);
            const access = { getLogo: vi.fn(async () => logo) };
            const model = new ChannelApiModel({ findId: vi.fn(async () => ({ id: 130, hasLogoData })) }, access);

            await expect(model.getLogo(130)).resolves.toBe(logo);
            expect(access.getLogo).toHaveBeenCalledOnce();
            expect(access.getLogo).toHaveBeenCalledWith(130);
        },
    );

    it.each([
        ['missing channel', null],
        ['persisted exact false', { id: 131, hasLogoData: false }],
    ])('[TA-6.3] preserves not-found for %s without requesting the logo port', async (_label, channel) => {
        const access = { getLogo: vi.fn() };
        const model = new ChannelApiModel({ findId: vi.fn(async () => channel) }, access);

        await expect(model.getLogo(131)).rejects.toThrow('notfound');
        expect(access.getLogo).not.toHaveBeenCalled();
    });

    it('[TA-6.3] preserves an upstream logo failure as a server error', async () => {
        const failure = new Error('SYNTHETIC_LOGO_UPSTREAM_FAILURE');
        const access = { getLogo: vi.fn(async () => Promise.reject(failure)) };
        const model = new ChannelApiModel({ findId: vi.fn(async () => ({ id: 132, hasLogoData: true })) }, access);

        await expect(model.getLogo(132)).rejects.toBe(failure);
    });

    it('[TA-6.3] sends every repeated logo request upstream without caching success or failure', async () => {
        const first = Buffer.from('synthetic-first-logo');
        const secondFailure = new Error('SYNTHETIC_SECOND_LOGO_FAILURE');
        const getLogo = vi.fn().mockResolvedValueOnce(first).mockRejectedValueOnce(secondFailure);
        const model = new ChannelApiModel({ findId: vi.fn(async () => ({ id: 133, hasLogoData: true })) }, { getLogo });

        await expect(model.getLogo(133)).resolves.toBe(first);
        await expect(model.getLogo(133)).rejects.toBe(secondFailure);
        expect(getLogo).toHaveBeenCalledTimes(2);
        expect(getLogo).toHaveBeenNthCalledWith(1, 133);
        expect(getLogo).toHaveBeenNthCalledWith(2, 133);
    });
});
