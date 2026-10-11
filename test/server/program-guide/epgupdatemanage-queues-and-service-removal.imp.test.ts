import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const EPGUpdateManageModel = (
    require(join(snapshot, 'model', 'epgUpdater', 'EPGUpdateManageModel.js')) as {
        default: new (...args: unknown[]) => any;
    }
).default;
const { EPGUpdateEvent } = require(join(snapshot, 'model', 'epgUpdater', 'IEPGUpdateManageModel.js')) as {
    EPGUpdateEvent: Record<string, string>;
};

afterEach(() => {
    vi.restoreAllMocks();
});

const program = (id: number, overrides: Record<string, unknown> = {}) => ({
    duration: 60_000,
    eventId: id + 1000,
    id,
    isFree: true,
    name: `synthetic-program-${id}`,
    networkId: 10,
    serviceId: 2,
    startAt: 5_000,
    ...overrides,
});

const service = (id: number, overrides: Record<string, unknown> = {}) => ({
    channel: { channel: `${id}`, type: 'GR' },
    id,
    name: `synthetic-service-${id}`,
    networkId: 10,
    serviceId: id - 1000,
    type: 1,
    ...overrides,
});

const programEvent = (type: string, data: unknown, time = 1) => ({ data, resource: 'program', time, type });

const makeModel = (config: Record<string, unknown> = {}) => {
    const log = { system: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
    const tuner = {
        getPrograms: vi.fn(async () => []),
        getProgramsByService: vi.fn(async () => []),
        getServices: vi.fn(async () => [] as unknown[]),
        openChangeFeed: vi.fn(),
    };
    const channelDB = { insert: vi.fn(async () => undefined), update: vi.fn(async () => undefined) };
    const programDB = {
        deleteOld: vi.fn(async () => undefined),
        insert: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined),
    };
    const model = new EPGUpdateManageModel(
        { getLogger: () => log },
        { getConfig: () => config },
        tuner,
        channelDB,
        programDB,
    );
    const emitted: string[] = [];
    for (const name of Object.values(EPGUpdateEvent)) model.on(name, () => emitted.push(name));
    return { channelDB, emitted, log, model, programDB, tuner };
};

describe('EPGUpdateManageModel main program judgement (unittest/imp)', () => {
    it.each([
        ['no related items', undefined, true],
        ['a related item without a type', [{ eventId: 99, serviceId: 99 }], true],
        ['a movement', [{ eventId: 99, serviceId: 99, type: 'movement' }], true],
        ['relays only', [{ eventId: 99, serviceId: 99, type: 'relay' }], true],
        ['a shared item of another event', [{ eventId: 99, serviceId: 2, type: 'shared' }], false],
        ['a shared item of another service', [{ eventId: 1001, serviceId: 99, type: 'shared' }], false],
        ['a shared item of itself', [{ eventId: 1001, serviceId: 2, type: 'shared' }], true],
        [
            'a relay followed by a shared item of another event',
            [
                { eventId: 99, serviceId: 99, type: 'relay' },
                { eventId: 99, serviceId: 99, type: 'shared' },
            ],
            false,
        ],
    ])('[PG-3.4] judges a program with %s', (_label, relatedItems, expected) => {
        const { model } = makeModel();

        expect(model.isMainProgram(program(1, { relatedItems }))).toBe(expected);
    });
});

describe('EPGUpdateManageModel channel update (unittest/imp)', () => {
    it('[PG-3.1] logs each step, keeps every service of a network in the index and skips services without a channel', async () => {
        const { channelDB, log, model, tuner } = makeModel();
        const services = [
            service(1001),
            service(1002),
            service(1003, { networkId: 11 }),
            service(1004, { channel: undefined }),
        ];
        tuner.getServices.mockResolvedValue(services);

        await model.updateChannels();

        expect(log.system.info.mock.calls).toEqual([['get service'], ['start update channel'], ['done update channel']]);
        expect(channelDB.insert).toHaveBeenCalledExactlyOnceWith(services);
        expect(model.channelIndex).toEqual({
            10: { 1: { channel: '1001', id: 1001, type: 'GR' }, 2: { channel: '1002', id: 1002, type: 'GR' } },
            11: { 3: { channel: '1003', id: 1003, type: 'GR' } },
        });
    });

    it('[PG-3.1] logs a failed service fetch together with its cause and rethrows it', async () => {
        const { log, model, tuner } = makeModel();
        const failure = new Error('synthetic service fetch failure');
        tuner.getServices.mockRejectedValue(failure);

        await expect(model.updateChannels()).rejects.toBe(failure);

        expect(log.system.error.mock.calls).toEqual([['get service error'], [failure]]);
    });
});

describe('EPGUpdateManageModel change feed (unittest/imp)', () => {
    it('[PG-4.1] logs the cause of an aborted feed and announces the abort', async () => {
        const { emitted, log, model, tuner } = makeModel();
        let observer: any;
        tuner.openChangeFeed.mockImplementation(async (value: unknown) => {
            observer = value;
            return { completion: Promise.resolve() };
        });
        await model.start();
        const failure = new Error('synthetic feed failure');

        observer.started();
        observer.aborted(failure);

        expect(log.system.error.mock.calls).toEqual([['tuner change feed error'], [failure]]);
        expect(emitted).toEqual([EPGUpdateEvent.STREAM_STARTED, EPGUpdateEvent.STREAM_ABORTED]);
    });
});

describe('EPGUpdateManageModel program queue (unittest/imp)', () => {
    it('[PG-3.3] does nothing and logs nothing for an empty queue', async () => {
        const { log, model, programDB } = makeModel();

        await model.saveProgram();

        expect(programDB.update).not.toHaveBeenCalled();
        expect(log.system.debug).not.toHaveBeenCalled();
    });

    it('[PG-3.3] saves created and updated main programs with their log lines and announces the update', async () => {
        const { emitted, log, model, programDB } = makeModel();
        model.programQueue.push(
            programEvent('create', program(1)),
            programEvent('update', program(2)),
            programEvent('update', program(3, { name: undefined })),
            programEvent('update', program(4, { relatedItems: [{ eventId: 99, serviceId: 99, type: 'shared' }] })),
        );

        await model.saveProgram();

        expect(programDB.update).toHaveBeenCalledExactlyOnceWith(model.channelIndex, {
            delete: [],
            insert: [],
            update: [program(1), program(2)],
        });
        expect(log.system.debug.mock.calls).toEqual([['number of de-queued items: %d', 4]]);
        expect(log.system.info.mock.calls).toEqual([
            ['update program db start'],
            [{ deleteValues: 0, insertValues: 0, updateValues: 2 }],
            ['update program db done'],
        ]);
        expect(emitted).toEqual([EPGUpdateEvent.PROGRAM_UPDATED]);
    });

    it('[PG-3.3] saves removals and redefinitions as deletions', async () => {
        const { emitted, model, programDB } = makeModel();
        model.programQueue.push(programEvent('remove', { id: 5 }), programEvent('redefine', { from: 7, to: 8 }));

        await model.saveProgram();

        expect(programDB.update).toHaveBeenCalledExactlyOnceWith(model.channelIndex, {
            delete: [5, 7],
            insert: [],
            update: [],
        });
        expect(emitted).toEqual([EPGUpdateEvent.PROGRAM_UPDATED]);
    });

    it('[PG-3.3] does not touch the database when no event changes anything', async () => {
        const { emitted, model, programDB } = makeModel();
        model.programQueue.push(programEvent('update', program(3, { name: undefined })));

        await model.saveProgram();

        expect(programDB.update).not.toHaveBeenCalled();
        expect(emitted).toEqual([]);
    });

    it('[PG-3.3] lets a later event override an earlier one for the same program', async () => {
        const { model, programDB } = makeModel();
        model.programQueue.push(
            programEvent('create', program(1)),
            programEvent('remove', { id: 1 }),
            programEvent('remove', { id: 2 }),
            programEvent('update', program(2)),
            programEvent('create', program(3)),
            programEvent('redefine', { from: 3, to: 4 }),
        );

        await model.saveProgram();

        expect(programDB.update).toHaveBeenCalledExactlyOnceWith(model.channelIndex, {
            delete: [1, 3],
            insert: [],
            update: [program(2)],
        });
    });

    it('[PG-3.3] re-queues the sorted events, removals first, while no program starts before the threshold', async () => {
        const { log, model, programDB } = makeModel();
        model.programQueue.push(
            programEvent('update', program(1, { startAt: 9_000 })),
            programEvent('remove', { id: 5 }),
        );

        await model.saveProgram(5_000);

        expect(programDB.update).not.toHaveBeenCalled();
        expect(log.system.debug.mock.calls).toEqual([
            ['number of de-queued items: %d', 2],
            ['number of re-queued items: %d', 2],
        ]);
        expect(model.programQueue.map((event: { type: string }) => event.type)).toEqual(['remove', 'update']);

        model.programQueue.push(programEvent('update', program(2, { startAt: 1_000 })));
        await model.saveProgram(5_000);

        expect(programDB.update).toHaveBeenCalledExactlyOnceWith(model.channelIndex, {
            delete: [5],
            insert: [],
            update: [program(1, { startAt: 9_000 }), program(2, { startAt: 1_000 })],
        });
    });

    it('[PG-3.3] puts every event back in order when the database update fails', async () => {
        const { log, model, programDB } = makeModel();
        const failure = new Error('synthetic program db failure');
        programDB.update.mockRejectedValue(failure);
        const first = programEvent('update', program(1));
        const second = programEvent('remove', { id: 2 });
        model.programQueue.push(first, second);

        await expect(model.saveProgram()).rejects.toBe(failure);

        expect(model.programQueue).toEqual([first, second]);
        expect(log.system.debug.mock.calls).toEqual([
            ['number of de-queued items: %d', 2],
            ['number of re-queued items: %d', 2],
        ]);
    });
});

describe('EPGUpdateManageModel service queue (unittest/imp)', () => {
    it('[PG-3.2] saves named creations and updates, keeps the current logo flag, deletes removals and skips excluded services', async () => {
        const { channelDB, emitted, log, model, programDB, tuner } = makeModel({ excludeChannels: [1006], excludeSids: [555] });
        tuner.getServices.mockResolvedValue([service(1001, { hasLogoData: true })]);
        model.serviceQueue.push(
            { data: service(1001), resource: 'service', time: 1, type: 'create' },
            { data: service(1002, { name: undefined }), resource: 'service', time: 1, type: 'create' },
            { data: service(1003), resource: 'service', time: 1, type: 'update' },
            { data: service(1004), resource: 'service', time: 1, type: 'remove' },
            { data: service(1005, { serviceId: 555 }), resource: 'service', time: 1, type: 'create' },
            { data: service(1006), resource: 'service', time: 1, type: 'create' },
        );

        await model.saveService();

        expect(channelDB.update).toHaveBeenCalledExactlyOnceWith({
            insert: [service(1001, { hasLogoData: true })],
            update: [service(1003)],
            delete: [1004],
        });
        expect(programDB.insert).toHaveBeenCalledExactlyOnceWith(model.channelIndex, [], [1004]);
        expect(log.system.info.mock.calls).toEqual([
            ['update channel db start'],
            [{ insertValues: 1, updateValues: 1, deleteValues: 1 }],
            ['update channel db done'],
        ]);
        expect(model.channelIndex).toEqual({
            10: { 1: { channel: '1001', id: 1001, type: 'GR' }, 3: { channel: '1003', id: 1003, type: 'GR' } },
        });
        expect(emitted).toEqual([EPGUpdateEvent.SERVICE_UPDATED]);
    });

    it('[PG-3.2] logs a failed service fetch with its cause and still saves the queued services', async () => {
        const { channelDB, log, model, tuner } = makeModel();
        const failure = new Error('synthetic service fetch failure');
        tuner.getServices.mockRejectedValue(failure);
        model.serviceQueue.push({ data: service(1001), resource: 'service', time: 1, type: 'create' });

        await model.saveService();

        expect(log.system.error.mock.calls).toEqual([['get service error'], [failure]]);
        expect(channelDB.update).toHaveBeenCalledExactlyOnceWith({ insert: [service(1001)], update: [], delete: [] });
    });
});

describe('EPGUpdateManageModel service removal (unittest/imp)', () => {
    const queue = (model: any, type: string, data: unknown) =>
        model.serviceQueue.push({ data, resource: 'service', time: 1, type });

    it('[PG-1.5] deletes the removed channel row, its programs and its index entry, and leaves the other channels', async () => {
        const { channelDB, emitted, model, programDB, tuner } = makeModel();
        tuner.getServices.mockResolvedValue([service(1001), service(1002)]);
        model.channelIndex = {
            10: { 1: { id: 1001, type: 'GR', channel: '1001' }, 2: { id: 1002, type: 'GR', channel: '1002' } },
            11: { 5: { id: 1100005, type: 'BS', channel: 'BS01' } },
        };
        queue(model, 'remove', service(1002));

        await model.saveService();

        expect(channelDB.update).toHaveBeenCalledExactlyOnceWith({ insert: [], update: [], delete: [1002] });
        expect(programDB.insert).toHaveBeenCalledExactlyOnceWith(model.channelIndex, [], [1002]);
        expect(model.channelIndex).toEqual({
            10: { 1: { id: 1001, type: 'GR', channel: '1001' } },
            11: { 5: { id: 1100005, type: 'BS', channel: 'BS01' } },
        });
        expect(emitted).toEqual([EPGUpdateEvent.SERVICE_UPDATED]);
    });

    it('[PG-1.5] ignores a removal of an excluded channel or service id', async () => {
        const { channelDB, programDB, model } = makeModel({ excludeChannels: [1002], excludeSids: [3] });
        queue(model, 'remove', service(1002));
        queue(model, 'remove', service(1003));

        await model.saveService();

        expect(channelDB.update).toHaveBeenCalledExactlyOnceWith({ insert: [], update: [], delete: [] });
        expect(programDB.insert).not.toHaveBeenCalled();
    });

    it('[PG-1.5] deletes nothing from the programs when no channel was removed', async () => {
        const { model, programDB } = makeModel();
        queue(model, 'create', service(1001));

        await model.saveService();

        expect(programDB.insert).not.toHaveBeenCalled();
    });

    it('[PG-1.5] keeps only the later of a removal and a creation or update of the same channel', async () => {
        const { channelDB, model, programDB } = makeModel();
        queue(model, 'create', service(1001));
        queue(model, 'remove', service(1001));
        queue(model, 'update', service(1002));
        queue(model, 'remove', service(1002));
        queue(model, 'remove', service(1003));
        queue(model, 'create', service(1003));
        queue(model, 'remove', service(1004));
        queue(model, 'update', service(1004));

        await model.saveService();

        expect(channelDB.update).toHaveBeenCalledExactlyOnceWith({
            insert: [service(1003)],
            update: [service(1004)],
            delete: [1001, 1002],
        });
        expect(programDB.insert).toHaveBeenCalledExactlyOnceWith(model.channelIndex, [], [1001, 1002]);
    });

    it('[PG-1.5] removes a channel that is not in the index without failing', async () => {
        const { channelDB, model } = makeModel();
        model.channelIndex = { 10: {} };
        queue(model, 'remove', service(1001, { networkId: 99 }));
        queue(model, 'remove', service(1002));

        await expect(model.saveService()).resolves.toBeUndefined();

        expect(channelDB.update).toHaveBeenCalledExactlyOnceWith({ insert: [], update: [], delete: [1001, 1002] });
        expect(model.channelIndex).toEqual({ 10: {} });
    });

    it('[PG-1.5] logs and rethrows a failure to delete the programs of a removed channel without announcing the update', async () => {
        const { emitted, log, model, programDB } = makeModel();
        const failure = new Error('synthetic program delete failure');
        programDB.insert.mockRejectedValueOnce(failure);
        queue(model, 'remove', service(1001));

        await expect(model.saveService()).rejects.toBe(failure);

        expect(log.system.error.mock.calls).toEqual([['delete service programs error'], [failure]]);
        expect(emitted).toEqual([]);
    });

    it('[PG-1.6] mirakc: a channel absent from the next full channel fetch leaves the stored channels and the index at the program refetch', async () => {
        const { channelDB, model, programDB, tuner } = makeModel();
        tuner.getServices
            .mockResolvedValueOnce([service(1001), service(1002)])
            .mockResolvedValueOnce([service(1001)]);

        await model.updateChannels();
        model.updateServiceIds = { 1001: true };
        await model.saveUpdateServices();

        expect(channelDB.insert.mock.calls).toEqual([[[service(1001), service(1002)]], [[service(1001)]]]);
        expect(channelDB.update).not.toHaveBeenCalled();
        expect(model.channelIndex).toEqual({ 10: { 1: { id: 1001, type: 'GR', channel: '1001' } } });
        expect(programDB.insert).toHaveBeenCalledExactlyOnceWith(model.channelIndex, [], [1001]);
    });
});

describe('EPGUpdateManageModel on-air and updated services (unittest/imp)', () => {
    it.each([
        ['saveOnAirServices', 'updatedOnAirServiceIds'],
        ['saveUpdateServices', 'updateServiceIds'],
    ])('[PG-3.5] %s refreshes the channels, replaces the main programs of the services and forgets them', async (method, field) => {
        const { log, model, programDB, tuner } = makeModel();
        const services = [service(1001), service(1002)];
        tuner.getServices.mockResolvedValue(services);
        const nonMain = program(2, { relatedItems: [{ eventId: 99, serviceId: 99, type: 'shared' }] });
        tuner.getProgramsByService.mockImplementation(async (serviceId: number) =>
            serviceId === 10 ? [program(1), nonMain] : [program(3)],
        );
        model[field] = { 10: true, 20: true };

        await model[method]();

        expect(tuner.getProgramsByService.mock.calls).toEqual([[10], [20]]);
        expect(programDB.insert).toHaveBeenCalledExactlyOnceWith(model.channelIndex, [program(1), program(3)], [10, 20]);
        expect(log.system.info.mock.calls.map((call: unknown[]) => call[0])).toEqual([
            'get service',
            'start update channel',
            'done update channel',
            'get service programs',
            'start update service programs',
            'done update service programs',
        ]);
        expect(model[field]).toEqual({});
    });

    it.each([
        ['saveOnAirServices', 'updatedOnAirServiceIds'],
        ['saveUpdateServices', 'updateServiceIds'],
    ])('[PG-3.5] %s logs a failed program replacement with its cause, rethrows and keeps the services', async (method, field) => {
        const { log, model, programDB } = makeModel();
        const failure = new Error('synthetic program insert failure');
        programDB.insert.mockRejectedValue(failure);
        model[field] = { 10: true };

        await expect(model[method]()).rejects.toBe(failure);

        expect(log.system.error.mock.calls).toEqual([['update service programs error'], [failure]]);
        expect(model[field]).toEqual({ 10: true });
    });
});
