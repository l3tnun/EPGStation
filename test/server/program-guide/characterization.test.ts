import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeferred } from '../harness/async';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const EPGUpdateManageModel = (require(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdateManageModel.js')) as any)
    .default;
const EPGUpdater = (require(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdater.js')) as any).default;
const ProgramDB = (require(join(compiledSnapshot, 'model', 'db', 'ProgramDB.js')) as any).default;
const ChannelDB = (require(join(compiledSnapshot, 'model', 'db', 'ChannelDB.js')) as any).default;
const Util = (require(join(compiledSnapshot, 'util', 'Util.js')) as any).default;
const { EPGUpdateEvent } = require(join(compiledSnapshot, 'model', 'epgUpdater', 'IEPGUpdateManageModel.js')) as any;

const logger = () => ({ system: { debug: vi.fn(), error: vi.fn(), info: vi.fn() } });
const service = (id: number, overrides: Record<string, unknown> = {}) =>
    Object.assign(
        {
            id,
            serviceId: 100 + id,
            networkId: 10,
            name: `synthetic-service-${id}`,
            channel: { type: 'GR', channel: `${id}` },
        },
        overrides,
    );
const program = (id: number, overrides: Record<string, unknown> = {}) =>
    Object.assign(
        {
            id,
            eventId: id,
            serviceId: 101,
            networkId: 10,
            startAt: 1_000,
            duration: 60_000,
            isFree: true,
            name: `synthetic-program-${id}`,
        },
        overrides,
    );
const legacyProjectFirstGenre = (genres: Array<{ readonly lv1: number }> | undefined): number | null => {
    let genre1: number | null = null;
    if (typeof genres !== 'undefined' && genres[0].lv1 < 0xe) genre1 = genres[0].lv1;
    return genre1;
};
// TypeORM 1.x rejects manager.delete(Entity, {}) with an empty criteria object, so ChannelDB.insert's
// full-table wipe now goes through manager.createQueryBuilder().delete().from(Entity).execute() instead.
// The mock manager needs that chain so it does not hit `queryRunner.manager.createQueryBuilder is not
// a function`.
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
const runner = () => ({
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
let restoreProcessSend: (() => void) | undefined;
const stubProcessSend = (): void => {
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
const createManageModel = (clientOverrides: Record<string, unknown> = {}, channelDBOverrides = {}) => {
    const client = Object.assign(
        {
            getPrograms: vi.fn().mockResolvedValue([]),
            getServices: vi.fn().mockResolvedValue([]),
        },
        clientOverrides,
    );
    const channelDB = Object.assign(
        { insert: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(undefined) },
        channelDBOverrides,
    );
    const programDB = {
        deleteOld: vi.fn().mockResolvedValue(undefined),
        insert: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
    };
    const model = new EPGUpdateManageModel(
        { getLogger: logger },
        { getConfig: () => ({ mirakurunPath: 'http://program-guide.invalid/' }) },
        client,
        channelDB,
        programDB,
    );
    return { channelDB, client, model, programDB };
};

afterEach(() => {
    restoreProcessSend?.();
    restoreProcessSend = undefined;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('program guide Tasks 3.3-3.4 isolated confirmed-defect characterization', () => {
    it('[PG-T3.3][known-1] throws the ten-minute timer error without cancelling the underlying full synchronization', async () => {
        vi.useFakeTimers();
        const programs = createDeferred<unknown[]>();
        const legacyLog = logger();
        const programDB = { insert: vi.fn().mockResolvedValue(undefined) };
        const operation = programs.promise.then(values => programDB.insert({}, values));
        const timeout = setTimeout(
            () => {
                legacyLog.system.error('update all timeout');
                clearTimeout(timeout);
                throw new Error('EPGUpdateAllTimeoutError');
            },
            10 * 60 * 1_000,
        );

        await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
        await expect(vi.advanceTimersByTimeAsync(10 * 60 * 1_000)).rejects.toThrow('EPGUpdateAllTimeoutError');

        programs.resolve([program(1)]);
        await expect(operation).resolves.toBeUndefined();
        expect(legacyLog.system.error).toHaveBeenCalledWith('update all timeout');
        expect(programDB.insert).toHaveBeenCalledTimes(1);
    });

    it('[PG-T3.3][known-2] throws on the first-element access for an empty genres array in the pre-fix projection', () => {
        expect(() => legacyProjectFirstGenre([])).toThrow(TypeError);
    });

    it('[PG-T3.3][known-3] logs full and incremental channel row failures, continues, and commits both batches', async () => {
        const fullRunner = runner();
        const incrementalRunner = runner();
        for (const queryRunner of [fullRunner, incrementalRunner]) {
            queryRunner.manager.insert
                .mockRejectedValueOnce(new Error('synthetic-channel-insert-rejection'))
                .mockResolvedValueOnce(undefined);
            queryRunner.manager.update.mockRejectedValueOnce(new Error('synthetic-channel-update-rejection'));
        }
        const createQueryRunner = vi.fn().mockReturnValueOnce(fullRunner).mockReturnValueOnce(incrementalRunner);
        const database = new ChannelDB(
            { getLogger: logger },
            { getConfig: () => ({}) },
            { getConnection: async () => ({ createQueryRunner }) },
            { run: (operation: () => unknown) => operation() },
        );

        await expect(database.insert([service(5), service(6)])).resolves.toBeUndefined();
        await expect(database.update({ insert: [service(7)], update: [service(8)] })).resolves.toBeUndefined();

        for (const queryRunner of [fullRunner, incrementalRunner]) {
            expect(queryRunner.manager.insert).toHaveBeenCalledTimes(2);
            expect(queryRunner.manager.update).toHaveBeenCalledTimes(1);
            expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
            expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
        }
    });

    it('[PG-T3.4][known-4] converts getServices failure to an empty snapshot and still saves the queued service', async () => {
        const failure = new Error('synthetic-get-services-rejection');
        const { channelDB, model } = createManageModel({ getServices: vi.fn().mockRejectedValue(failure) });
        const created = service(9);
        model.serviceQueue.push({ resource: 'service', type: 'create', data: created });

        await expect(model.saveService()).resolves.toBeUndefined();

        expect(channelDB.update).toHaveBeenCalledWith({ insert: [created], update: [] });
        expect(model.log.system.error).toHaveBeenCalledWith(failure);
    });

    it('[PG-T3.4][known-5] rebuilds the memory index and updates programs although a missing channel aborts channel persistence', async () => {
        const queryRunner = runner();
        const channelDB = new ChannelDB(
            { getLogger: logger },
            { getConfig: () => ({}) },
            { getConnection: vi.fn().mockResolvedValue({ createQueryRunner: () => queryRunner }) },
            { run: (operation: () => unknown) => operation() },
        );
        const valid = service(10);
        const missing = service(11, { channel: undefined });
        const { model, programDB } = createManageModel(
            { getServices: vi.fn().mockResolvedValue([valid, missing]), getPrograms: vi.fn().mockResolvedValue([]) },
            channelDB,
        );

        await expect(model.updateAll()).resolves.toBeUndefined();

        expect(queryRunner.startTransaction).not.toHaveBeenCalled();
        expect(model.channelIndex).toEqual({ 10: { 110: { id: 10, type: 'GR', channel: '10' } } });
        expect(programDB.insert).toHaveBeenCalledWith(model.channelIndex, []);
    });

    it('[PG-T3.4][known-6] permanently loses the owned service batch when repository persistence rejects', async () => {
        const owned = { resource: 'service', type: 'create', data: service(12) };
        const late = { resource: 'service', type: 'create', data: service(13) };
        const failure = new Error('synthetic-channel-save-rejection');
        const { model } = createManageModel(
            {},
            {
                update: vi.fn().mockImplementation(async () => {
                    model.serviceQueue.push(late);
                    throw failure;
                }),
            },
        );
        model.serviceQueue.push(owned);

        await expect(model.saveService()).rejects.toBe(failure);

        expect(model.serviceQueue).toEqual([late]);
    });
});

describe('program guide approved compatibility characterization', () => {
    it('[PG-T3.3][compatibility] logs incremental program row failures, continues later rows, commits, and resolves as a success', async () => {
        const queryRunner = runner();
        const firstFailure = new Error('synthetic-first-delete-rejection');
        queryRunner.manager.delete.mockRejectedValueOnce(firstFailure).mockResolvedValueOnce(undefined);
        const database = new ProgramDB(
            { getLogger: logger },
            { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) },
            { getConnection: async () => ({ createQueryRunner: () => queryRunner }) },
            { run: (operation: () => unknown) => operation() },
        );

        await expect(database.update({}, { insert: [], update: [], delete: [41, 42] })).resolves.toBeUndefined();

        expect(queryRunner.manager.delete).toHaveBeenCalledTimes(2);
        expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
        expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
        expect(database.log.system.error).toHaveBeenCalledWith(firstFailure);
    });

    it('[PG-T3.4][compatibility] retains a service remove event for reconciliation by a later full snapshot', async () => {
        const { channelDB, model } = createManageModel();
        model.serviceQueue.push({ resource: 'service', type: 'remove', data: service(3) });

        await model.saveService();

        expect(channelDB.update).toHaveBeenCalledWith({ insert: [], update: [] });
        expect(model.serviceQueue).toEqual([]);
    });

    it.each([
        ['end', 'EndedEventStream'],
        ['close', 'ClosedEventStream'],
    ] as const)(
        '[PG-T3.4][compatibility] reconnects after normal Mirakurun %s while retaining the connected flag',
        async (terminal, completionMessage) => {
            stubProcessSend();
            const stream = Object.assign(new EventEmitter(), { destroy: vi.fn(), push: vi.fn() });
            const reconnect = createDeferred<unknown>();
            const manageLog = logger();
            const openChangeFeed = vi
                .fn()
                .mockImplementationOnce(async (observer: { started: () => void }) => {
                    observer.started();
                    return {
                        close: vi.fn(),
                        completion: new Promise<void>((_resolve, reject) => {
                            stream.once(terminal, () => {
                                stream.destroy();
                                reject(new Error(completionMessage));
                            });
                        }),
                    };
                })
                .mockImplementationOnce(() => reconnect.promise);
            const client = {
                getPrograms: vi.fn().mockResolvedValue([]),
                getServices: vi.fn().mockResolvedValue([]),
                openChangeFeed,
            };
            const channelDB = { insert: vi.fn().mockResolvedValue(undefined) };
            const programDB = { insert: vi.fn().mockResolvedValue(undefined) };
            const model = new EPGUpdateManageModel(
                { getLogger: () => manageLog },
                { getConfig: () => ({ mirakurunPath: 'http://program-guide.invalid/' }) },
                client,
                channelDB,
                programDB,
            ) as any;
            const completionErrors: Error[] = [];
            const startFeed = model.start.bind(model);
            vi.spyOn(model, 'start').mockImplementation(async () => {
                try {
                    await startFeed();
                } catch (error) {
                    completionErrors.push(error as Error);
                    throw error;
                }
            });
            const aborted = vi.fn();
            model.on(EPGUpdateEvent.STREAM_ABORTED, aborted);
            const updater = new EPGUpdater(
                { getLogger: logger },
                { getConfig: () => ({ epgUpdateIntervalTime: 1 }) },
                model,
            ) as any;
            const sleep = vi.spyOn(Util, 'sleep').mockResolvedValue(undefined);

            void updater.startEventStreamAnalysis();
            await vi.waitFor(() => expect(updater.isEventStreamAlive).toBe(true));
            stream.emit(terminal);
            await vi.waitFor(() => expect(openChangeFeed).toHaveBeenCalledTimes(2));

            expect(completionErrors.map(error => error.message)).toEqual([completionMessage]);
            expect(aborted).not.toHaveBeenCalled();
            expect(updater.isEventStreamAlive).toBe(true);
            expect(updater.retryCount).toBe(1);
            expect(sleep).toHaveBeenCalledWith(5_000);
            expect(stream.destroy).toHaveBeenCalledTimes(1);
            expect(reconnect.state()).toEqual({ status: 'pending' });
        },
    );
});
