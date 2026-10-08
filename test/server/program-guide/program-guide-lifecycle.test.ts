import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeferred } from '../harness/async';
import { createDialectPersistence, type DatabaseDialect, makeProgram } from '../fixtures/reservation-rules/runtime';

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

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const EPGUpdater = (require(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdater.js')) as any).default;
const EPGUpdateManageModel = (require(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdateManageModel.js')) as any)
    .default;
const ScheduleApiModel = (require(join(compiledSnapshot, 'model', 'api', 'schedule', 'ScheduleApiModel.js')) as any)
    .default;
const ProgramDB = (require(join(compiledSnapshot, 'model', 'db', 'ProgramDB.js')) as any).default;
const Util = (require(join(compiledSnapshot, 'util', 'Util.js')) as any).default;
const { EPGUpdateEvent } = require(join(compiledSnapshot, 'model', 'epgUpdater', 'IEPGUpdateManageModel.js')) as any;

const logger = () => ({ system: { debug: vi.fn(), error: vi.fn(), info: vi.fn() } });

const channel = {
    id: 61,
    serviceId: 161,
    networkId: 10,
    name: 'synthetic-read-channel',
    halfWidthName: 'synthetic-read-channel',
    remoteControlKeyId: 6,
    hasLogoData: false,
    channelTypeId: 0,
    channelType: 'GR',
    channel: '61',
    type: 1,
};

const readStoredProgramContract = async (api: any, now: number) => {
    const schedules = await api.getSchedules({
        GR: true,
        startAt: now - 1_000,
        endAt: now + 60_000,
        isHalfWidth: false,
    });
    const detail = await api.getSchedule(601, false);
    const broadcasting = await api.getBroadcastingSchedule({ isHalfWidth: false });
    const search = await api.search({ keyword: 'synthetic survivor', name: true, channelIds: [61] }, false);
    return {
        schedules: schedules.map((value: any) => value.programs.map((item: any) => item.id)),
        detail: detail === null ? null : { id: detail.id, name: detail.name },
        broadcasting: broadcasting.map((value: any) => value.programs.map((item: any) => item.id)),
        search: search.map((value: any) => value.id),
    };
};

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('program guide feed and retry lifecycle characterization', () => {
    it('[PG-T3.1] attempts one full synchronization per stream start and enables change processing after failure', async () => {
        const updateManage = Object.assign(new EventEmitter(), {
            updateAll: vi.fn().mockRejectedValue(new Error('synthetic-full-sync-rejection')),
        });
        const updater = new EPGUpdater(
            { getLogger: logger },
            { getConfig: () => ({ epgUpdateIntervalTime: 1 }) },
            updateManage,
        ) as any;

        updateManage.emit(EPGUpdateEvent.STREAM_STARTED);
        await vi.waitFor(() => expect(updateManage.updateAll).toHaveBeenCalledTimes(1));

        expect(updater.isEventStreamAlive).toBe(true);
        expect(updater.retryCount).toBe(0);
        expect(updater.log.system.error).toHaveBeenCalledWith('updateAll error');
    });

    it.each(
        Array.from(
            { length: 13 },
            (_, retryCount) =>
                [retryCount, Math.min(retryCount + 1, 12), Math.min(retryCount + 1, 12) * 5_000] as const,
        ),
    )(
        '[PG-T3.1] runs one rejected feed attempt from retry count %i with capped backoff',
        async (retryCount, expectedRetryCount, expectedDelay) => {
            const failure = new Error(`synthetic-feed-${retryCount}`);
            const start = vi.fn().mockRejectedValue(failure);
            const sleep = vi.spyOn(Util, 'sleep').mockResolvedValue(undefined);
            const updater = Object.create(EPGUpdater.prototype) as any;
            updater.log = logger();
            updater.updateManage = { start };
            updater.retryCount = retryCount;

            await updater.runEventStreamAttempt();

            expect(start).toHaveBeenCalledOnce();
            expect(sleep).toHaveBeenCalledOnce();
            expect(sleep).toHaveBeenCalledWith(expectedDelay);
            expect(updater.log.system.info).toHaveBeenCalledOnce();
            expect(updater.log.system.info).toHaveBeenCalledWith('trying to connecting to the mirakurun');
            // v2 の `EPGUpdateManageModel.ts:263-264` は接続に失敗した理由そのものを
            // `event stream get error` に続けて記録する。理由を落とすと、tuner server に
            // つながらない原因を log から辿れなくなる。
            expect(updater.log.system.error).toHaveBeenCalledTimes(2);
            expect(updater.log.system.error).toHaveBeenNthCalledWith(1, 'destroy event stream');
            expect(updater.log.system.error).toHaveBeenNthCalledWith(2, failure);
            expect(updater.retryCount).toBe(expectedRetryCount);
        },
    );

    it('[PG-T3.1] observes two completed feed attempts and a third pending attempt in the outer loop', async () => {
        const thirdAttempt = createDeferred<void>();
        const fallbackStart = createDeferred<void>();
        const runEventStreamAttempt = vi
            .fn()
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined)
            .mockImplementationOnce(() => thirdAttempt.promise);
        const updater = Object.create(EPGUpdater.prototype) as any;
        updater.log = logger();
        updater.updateManage = { start: vi.fn(() => fallbackStart.promise) };
        updater.retryCount = 0;
        updater.runEventStreamAttempt = runEventStreamAttempt;
        let loopSettled = false;

        const loop = updater.startEventStreamAnalysis();
        void loop.then(
            () => {
                loopSettled = true;
            },
            () => {
                loopSettled = true;
            },
        );
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(runEventStreamAttempt).toHaveBeenCalledTimes(3);
        expect(thirdAttempt.state()).toEqual({ status: 'pending' });
        expect(loopSettled).toBe(false);
    });

    it('[PG-T3.1] keeps all four production reads available after communication and parse failures', async () => {
        for (const dialect of ['sqlite', 'mysql'] as DatabaseDialect[]) {
            const fixture = await createDialectPersistence(dialect);
            const communicationStream = new PassThrough();
            const parseStream = new PassThrough();
            try {
                const now = 100_000;
                await fixture.source.getRepository(fixture.Program).insert(
                    makeProgram({
                        id: 601,
                        channelId: 61,
                        channelType: 'GR',
                        name: 'synthetic survivor',
                        halfWidthName: 'synthetic survivor',
                        startAt: now - 1_000,
                        endAt: now + 60_000,
                        duration: 61_000,
                    }),
                );
                vi.useFakeTimers();
                vi.setSystemTime(now);
                const channelDB = {
                    findAll: vi.fn().mockResolvedValue([channel]),
                    findChannleTypes: vi.fn().mockResolvedValue([channel]),
                };
                const api = new ScheduleApiModel(channelDB, fixture.programDB);
                const baseline = await readStoredProgramContract(api, now);
                expect(baseline).toEqual({
                    schedules: [[601]],
                    detail: { id: 601, name: 'synthetic survivor' },
                    broadcasting: [[601]],
                    search: [601],
                });

                const openChangeFeed = vi
                    .fn()
                    .mockImplementationOnce(
                        async (observer: { aborted: (error: Error) => void; started: () => void }) => {
                            observer.started();
                            return {
                                close: vi.fn(),
                                completion: new Promise<void>((_resolve, reject) => {
                                    communicationStream.once('error', error => {
                                        observer.aborted(error);
                                        reject(error);
                                    });
                                }),
                            };
                        },
                    )
                    .mockImplementationOnce(
                        async (observer: { aborted: (error: Error) => void; started: () => void }) => {
                            observer.started();
                            return {
                                close: vi.fn(),
                                completion: new Promise<void>((_resolve, reject) => {
                                    parseStream.once('data', () => {
                                        const error = new Error('EventStreamParseError');
                                        observer.aborted(error);
                                        reject(error);
                                    });
                                }),
                            };
                        },
                    );
                const feed = new EPGUpdateManageModel(
                    { getLogger: logger },
                    { getConfig: () => ({ mirakurunPath: 'http://program-guide.invalid/' }) },
                    { openChangeFeed },
                    {},
                    fixture.programDB,
                ) as any;
                const aborted = vi.fn();
                feed.on(EPGUpdateEvent.STREAM_ABORTED, aborted);

                const communicationStarted = new Promise<void>(resolve =>
                    feed.once(EPGUpdateEvent.STREAM_STARTED, resolve),
                );
                const communication = feed.start();
                await communicationStarted;
                const communicationFailure = new Error('synthetic-feed-communication-rejection');
                communicationStream.emit('error', communicationFailure);
                await expect(communication).rejects.toBe(communicationFailure);
                const afterCommunicationFailure = await readStoredProgramContract(api, now);

                const parseStarted = new Promise<void>(resolve => feed.once(EPGUpdateEvent.STREAM_STARTED, resolve));
                const parse = feed.start();
                await parseStarted;
                parseStream.write(Buffer.from('{invalid}\n,\n'));
                await expect(parse).rejects.toThrow('EventStreamParseError');
                const afterParseFailure = await readStoredProgramContract(api, now);
                expect.soft(afterCommunicationFailure).toEqual(baseline);
                expect.soft(afterParseFailure).toEqual(baseline);
                expect(aborted).toHaveBeenCalledTimes(2);
                expect(communicationStream.listenerCount('error')).toBe(0);
                expect(parseStream.listenerCount('data')).toBe(0);
                expect(parseStream.readableLength).toBe(0);
            } finally {
                vi.useRealTimers();
                communicationStream.removeAllListeners();
                parseStream.removeAllListeners();
                communicationStream.destroy();
                parseStream.destroy();
                await fixture.cleanup();
                expect(communicationStream.destroyed).toBe(true);
                expect(parseStream.destroyed).toBe(true);
                expect(communicationStream.eventNames()).toEqual([]);
                expect(parseStream.eventNames()).toEqual([]);
                expect(fixture.source.isInitialized).toBe(false);
            }
        }
        // Runs both dialects; the mysql leg provisions its server through `execFile('docker', …)`
        // (`test/server/persistence/mysql-runtime.ts`), so this case already spends ~3.8s of
        // Vitest's 5000ms default in isolation. Under full-tier load that contended child process
        // pushes it past the default even though nothing hangs.
    }, 30_000);
});

describe('program guide database resource lifecycle', () => {
    it.each(['resolve', 'reject'] as const)(
        '[PG-ME-resource] releases one query runner after transaction %s',
        async settlement => {
            vi.useFakeTimers();
            const failure = new Error('synthetic-program-insert-rejection');
            // Tracks `isTransactionActive` like the real TypeORM QueryRunner (true only between a
            // successful startTransaction() and the next commit/rollback), because
            // ProgramDB.insert() (src/model/db/ProgramDB.ts:101) gates its rollback attempt on that
            // flag. Without it, the double always reports `isTransactionActive === undefined` and
            // the rollback branch is never exercised, producing a false failure unrelated to the
            // production contract.
            let active = false;
            const queryRunner = {
                commitTransaction: vi.fn().mockImplementation(async () => {
                    active = false;
                }),
                get isTransactionActive() {
                    return active;
                },
                manager: {
                    // TypeORM 1.x は空 criteria の delete を拒否するため、全件差し替えは
                    // createQueryBuilder().delete().from(Entity).execute() を通る。
                    createQueryBuilder: vi.fn(() => deleteQueryBuilder()),
                    delete: vi.fn().mockResolvedValue(undefined),
                    insert:
                        settlement === 'resolve'
                            ? vi.fn().mockResolvedValue(undefined)
                            : vi.fn().mockRejectedValue(failure),
                },
                release: vi.fn().mockResolvedValue(undefined),
                rollbackTransaction: vi.fn().mockImplementation(async () => {
                    active = false;
                }),
                startTransaction: vi.fn().mockImplementation(async () => {
                    active = true;
                }),
            };
            const getConnection = vi.fn().mockResolvedValue({ createQueryRunner: () => queryRunner });
            const programLogger = logger();
            const database = new ProgramDB(
                { getLogger: () => programLogger },
                { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) },
                { getConnection },
                { run: (operation: () => Promise<unknown>) => operation() },
            );
            const operation = database.insert({ 10: { 161: { id: 61, type: 'GR', channel: '61' } } }, [
                {
                    id: 601,
                    eventId: 601,
                    serviceId: 161,
                    networkId: 10,
                    startAt: 1_000,
                    duration: 60_000,
                    isFree: true,
                    name: 'synthetic-resource-program',
                },
            ]);

            if (settlement === 'resolve') await expect(operation).resolves.toBeUndefined();
            else await expect(operation).rejects.toThrow('InsertError');

            expect(getConnection).toHaveBeenCalledOnce();
            expect(queryRunner.startTransaction).toHaveBeenCalledOnce();
            expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(settlement === 'resolve' ? 1 : 0);
            expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(settlement === 'reject' ? 1 : 0);
            expect(queryRunner.release).toHaveBeenCalledOnce();
            expect(programLogger.system.error).toHaveBeenCalledTimes(settlement === 'reject' ? 1 : 0);
            expect(vi.getTimerCount()).toBe(0);
        },
    );
});
