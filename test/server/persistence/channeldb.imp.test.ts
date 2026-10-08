import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFluentBuilder, createRunnerDouble, immediateRun, loadEntity, type RunnerFaults } from './db-unit-fakes';
import { loadCompiled, repositoryOperator } from './repository-harness';

type ChannelProvider = {
    insert(channels: object[], needesDeleted?: boolean): Promise<void>;
    update(values: { insert: object[]; update: object[]; delete: object[] }): Promise<void>;
    findId(channelId: number): Promise<unknown>;
    findChannleTypes(types: string[], needSort?: boolean): Promise<{ id: number; serviceId: number }[]>;
    findAll(needSort?: boolean): Promise<{ id: number; serviceId: number }[]>;
};

const Channel = loadEntity('Channel');
const ChannelDB = loadCompiled<new (...arguments_: any[]) => ChannelProvider>('model/db/ChannelDB.js');

const service = (id: number, extra: object = {}) => ({
    id,
    serviceId: id % 100000,
    networkId: 4,
    name: `ｃｈ${id}`,
    remoteControlKeyId: 3,
    hasLogoData: true,
    type: 1,
    channel: { type: 'GR', channel: '27' },
    ...extra,
});

const makeProvider = (connection: object, config: object = {}) => {
    const error = vi.fn();
    const retry = { run: vi.fn(immediateRun) };
    const provider = new ChannelDB(
        { getLogger: () => ({ system: { error } }) },
        { getConfig: () => config },
        repositoryOperator(connection),
        retry,
    );
    return { error, provider, retry };
};

const makeTransactional = (faults: RunnerFaults = {}) => {
    const double = createRunnerDouble(faults);
    const wiring = makeProvider({ createQueryRunner: () => double.runner });
    return { ...double, ...wiring };
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('ChannelDB.insert row conversion (unittest/imp)', () => {
    it('[3.1] wipes the table and inserts rows with a half-width name, a null remote key and the sort id', async () => {
        const fixture = makeTransactional();

        await fixture.provider.insert([service(1, { remoteControlKeyId: undefined, hasLogoData: undefined })]);

        expect(fixture.deletedEntities).toEqual([Channel]);
        expect(fixture.runner.manager.insert.mock.calls).toEqual([
            [
                Channel,
                {
                    id: 1,
                    serviceId: 1,
                    networkId: 4,
                    name: 'ｃｈ1',
                    halfWidthName: 'ch1',
                    remoteControlKeyId: null,
                    hasLogoData: false,
                    channelTypeId: 0,
                    channelType: 'GR',
                    channel: '27',
                    type: 1,
                },
            ],
        ]);
        expect(fixture.events).toEqual(['start', 'delete-all', 'insert', 'commit', 'release']);
    });

    it.each([
        { type: 'GR', channelTypeId: 0 },
        { type: 'BS', channelTypeId: 1 },
        { type: 'CS', channelTypeId: 2 },
        { type: 'SKY', channelTypeId: 3 },
        { type: 'BS4K', channelTypeId: 5 },
        { type: 'UNKNOWN', channelTypeId: 4 },
    ])('[R7.2] stores channelTypeId $channelTypeId for broadcast type $type', async ({ type, channelTypeId }) => {
        const fixture = makeTransactional();

        await fixture.provider.insert([service(2, { channel: { type, channel: '1' } })]);

        const [[, row]] = fixture.runner.manager.insert.mock.calls as unknown as [[unknown, Record<string, unknown>]];
        expect(row).toMatchObject({ channelType: type, channelTypeId });
    });

    it('[R7.2] stores nothing and opens no transaction when a service has no channel information', async () => {
        const fixture = makeTransactional();

        await expect(
            fixture.provider.insert([service(1), service(2, { channel: undefined })]),
        ).resolves.toBeUndefined();

        expect(fixture.events).toEqual([]);
        expect(fixture.runner.manager.insert).not.toHaveBeenCalled();
    });

    it('[3.1] keeps the table when needesDeleted is false, updates a row whose insert fails and commits', async () => {
        const fixture = makeTransactional();
        fixture.runner.manager.insert.mockRejectedValueOnce(new Error('synthetic-duplicate'));

        await fixture.provider.insert([service(1), service(2)], false);

        expect(fixture.deletedEntities).toEqual([]);
        expect(fixture.runner.manager.update).toHaveBeenCalledExactlyOnceWith(
            Channel,
            1,
            expect.objectContaining({ id: 1, halfWidthName: 'ch1' }),
        );
        expect(fixture.error).not.toHaveBeenCalled();
        expect(fixture.events).toEqual(['start', 'update', 'insert', 'commit', 'release']);
    });

    it('[3.1] logs both errors and carries on when the update fallback fails too', async () => {
        const fixture = makeTransactional();
        const insertFailure = new Error('synthetic-insert-failure');
        const updateFailure = new Error('synthetic-update-failure');
        fixture.runner.manager.insert.mockRejectedValueOnce(insertFailure);
        fixture.runner.manager.update.mockRejectedValueOnce(updateFailure);

        await fixture.provider.insert([service(1)]);

        expect(fixture.error.mock.calls).toEqual([['channel update error'], [insertFailure], [updateFailure]]);
        expect(fixture.runner.commitTransaction).toHaveBeenCalledOnce();
    });

    it('[4.4] rolls back, releases and reports the insert error when the commit fails', async () => {
        const fixture = makeTransactional({ commit: true });
        const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await expect(fixture.provider.insert([service(1)])).rejects.toThrow('insert error');

        expect(fixture.events.slice(-2)).toEqual(['rollback', 'release']);
        expect(diagnostic.mock.calls).toEqual([[fixture.primary]]);
    });

    it('[4.9] keeps the insert error as the public error when the rollback also fails', async () => {
        const fixture = makeTransactional({ commit: true, rollback: true });
        const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await expect(fixture.provider.insert([service(1)])).rejects.toThrow('insert error');

        expect(fixture.runner.release).toHaveBeenCalledOnce();
        expect(diagnostic.mock.calls).toEqual([[fixture.primary], [fixture.rollbackFailure]]);
    });

    it('[4.9] keeps the insert error as the public error when only the release fails', async () => {
        const fixture = makeTransactional({ release: true });
        const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await expect(fixture.provider.insert([service(1)])).rejects.toThrow('insert error');

        expect(fixture.runner.commitTransaction).toHaveBeenCalledOnce();
        expect(diagnostic.mock.calls).toEqual([[fixture.releaseFailure]]);
    });

    it('[3.1] update inserts the new and the changed services without wiping the table', async () => {
        const fixture = makeTransactional();

        await fixture.provider.update({ insert: [service(1)], update: [service(2)], delete: [service(3)] });

        expect(fixture.deletedEntities).toEqual([]);
        expect(fixture.runner.manager.insert.mock.calls.map(([, row]) => (row as { id: number }).id)).toEqual([1, 2]);
        expect(fixture.events).toEqual(['start', 'insert', 'insert', 'commit', 'release']);
    });
});

describe('ChannelDB lookups (unittest/imp)', () => {
    it.each([
        { found: { id: 4 }, expected: { id: 4 } },
        { found: undefined, expected: null },
    ])('[3.2] findId maps $found to $expected', async ({ found, expected }) => {
        const findOne = vi.fn(async () => found);
        const getRepository = vi.fn(() => ({ findOne }));
        const fixture = makeProvider({ getRepository });

        await expect(fixture.provider.findId(4)).resolves.toEqual(expected);

        expect(getRepository).toHaveBeenCalledExactlyOnceWith(Channel);
        expect(findOne).toHaveBeenCalledExactlyOnceWith({ where: [{ id: 4 }] });
    });

    const channels = () => [
        { id: 1, serviceId: 101 },
        { id: 2, serviceId: 102 },
        { id: 3, serviceId: 103 },
    ];
    const queryConnection = (rows: unknown[]) => {
        const builder = createFluentBuilder({ getMany: async () => rows });
        const getRepository = vi.fn(() => ({ createQueryBuilder: vi.fn(() => builder.builder) }));
        return { builder, connection: { getRepository } };
    };

    it.each([
        { config: { channelOrder: [3, 9, 1] }, expected: [3, 1, 2] },
        { config: { sidOrder: [102, 999] }, expected: [2, 1, 3] },
        { config: {}, expected: [1, 2, 3] },
    ])('[3.3] findAll with needSort applies the configured order ($config)', async ({ config, expected }) => {
        const { builder, connection } = queryConnection(channels());
        const fixture = makeProvider(connection, config);

        const result = await fixture.provider.findAll(true);

        expect(result.map(channel => channel.id)).toEqual(expected);
        expect(builder.argsOf('orderBy')).toEqual([
            ['channel.channelTypeId, channel.remoteControlKeyId, channel.serviceId', 'ASC'],
        ]);
    });

    it('[3.3] findChannleTypes with needSort filters by type and applies the configured order', async () => {
        const { builder, connection } = queryConnection(channels());
        const fixture = makeProvider(connection, { channelOrder: [2] });

        const result = await fixture.provider.findChannleTypes(['GR', 'BS'], true);

        expect(result.map(channel => channel.id)).toEqual([2, 1, 3]);
        expect(builder.argsOf('where')).toEqual([[[{ channelType: 'GR' }, { channelType: 'BS' }]]]);
    });
});
