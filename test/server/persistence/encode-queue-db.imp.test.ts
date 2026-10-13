import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFluentBuilder, loadEntity } from './db-unit-fakes';
import { loadCompiled, repositoryOperator } from './repository-harness';
import { silentLoggerModel } from '../harness/silent-logger-model';

type Provider = Record<string, (...arguments_: any[]) => Promise<any>>;

/**
 * `connection.createQueryBuilder()` serves the write builder, `getRepository(entity).createQueryBuilder()`
 * serves the read builder; both record their calls. The retry double records every job it runs.
 */
const makeProvider = (
    terminals: { read?: Record<string, () => unknown>; write?: Record<string, () => unknown> } = {},
) => {
    const read = createFluentBuilder(terminals.read as never);
    const write = createFluentBuilder(terminals.write as never);
    const createReadBuilder = vi.fn(() => read.builder);
    const getRepository = vi.fn(() => ({ createQueryBuilder: createReadBuilder }));
    const connection = { getRepository, createQueryBuilder: vi.fn(() => write.builder) };
    const retry = { run: vi.fn(async <T>(job: () => Promise<T>): Promise<T> => job()) };
    const Repository = loadCompiled<new (...arguments_: any[]) => Provider>('model/db/EncodeQueueDB.js');
    return {
        createReadBuilder,
        getRepository,
        provider: new Repository(silentLoggerModel, repositoryOperator(connection), retry),
        read,
        retry,
        write,
    };
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('EncodeQueueDB writes and reads (unittest/imp)', () => {
    const EncodeQueue = loadEntity('EncodeQueue');

    it('[PERSIST-10.1-INSERT] insertOnce inserts the caller-numbered row as given through one retried execute', async () => {
        const row = {
            id: Number.MAX_SAFE_INTEGER,
            option: '{"recordedId":1,"mode":"synthetic-mode"}',
            outputPath: null,
            createdAt: 1_700_000_000_000,
        };
        const fixture = makeProvider({ write: { execute: async () => ({ identifiers: [{ id: row.id }] }) } });

        await expect(fixture.provider.insertOnce(row)).resolves.toBeUndefined();

        expect(fixture.write.methods()).toEqual(['insert', 'into', 'values', 'execute']);
        expect(fixture.write.argsOf('into')).toEqual([[EncodeQueue]]);
        expect(fixture.write.argsOf('values')).toEqual([[row]]);
        expect(fixture.retry.run).toHaveBeenCalledOnce();
    });

    it.each([
        { affected: 1, expected: true },
        { affected: 0, expected: false },
        { affected: undefined, expected: false },
    ])(
        '[PERSIST-10.1-UPDATE-OUTPUT] updateOutputPath reports $expected when affected is $affected',
        async ({ affected, expected }) => {
            const fixture = makeProvider({ write: { execute: async () => ({ affected }) } });

            await expect(fixture.provider.updateOutputPath(7, '<synthetic-output>/a.mp4')).resolves.toBe(expected);

            expect(fixture.write.methods()).toEqual(['update', 'set', 'where', 'execute']);
            expect(fixture.write.argsOf('update')).toEqual([[EncodeQueue]]);
            expect(fixture.write.argsOf('set')).toEqual([[{ outputPath: '<synthetic-output>/a.mp4' }]]);
            expect(fixture.write.argsOf('where')).toEqual([[{ id: 7 }]]);
            expect(fixture.retry.run).toHaveBeenCalledOnce();
        },
    );

    it.each([
        { affected: 1, expected: true },
        { affected: 0, expected: false },
        { affected: undefined, expected: false },
    ])(
        '[PERSIST-10.1-DELETE] deleteOnce reports $expected when affected is $affected',
        async ({ affected, expected }) => {
            const fixture = makeProvider({ write: { execute: async () => ({ affected }) } });

            await expect(fixture.provider.deleteOnce(9)).resolves.toBe(expected);

            expect(fixture.write.methods()).toEqual(['delete', 'from', 'where', 'execute']);
            expect(fixture.write.argsOf('from')).toEqual([[EncodeQueue]]);
            expect(fixture.write.argsOf('where')).toEqual([[{ id: 9 }]]);
            expect(fixture.retry.run).toHaveBeenCalledOnce();
        },
    );

    it('[PERSIST-10.1-DELETE-ALL] deleteAll deletes every row without a where clause through one retried execute', async () => {
        const fixture = makeProvider({ write: { execute: async () => ({ affected: 3 }) } });

        await expect(fixture.provider.deleteAll()).resolves.toBeUndefined();

        expect(fixture.write.methods()).toEqual(['delete', 'from', 'execute']);
        expect(fixture.write.argsOf('from')).toEqual([[EncodeQueue]]);
        expect(fixture.retry.run).toHaveBeenCalledOnce();
    });

    it('[PERSIST-10.1-FIND-ALL] findAll orders by id ascending and converts bigint strings to numbers', async () => {
        const rows = [
            { id: '1', option: '{"a":1}', outputPath: null, createdAt: '1700000000000' },
            {
                id: String(Number.MAX_SAFE_INTEGER),
                option: '{"b":2}',
                outputPath: '<synthetic-output>/b.mp4',
                createdAt: 1_700_000_000_001,
            },
        ];
        const fixture = makeProvider({ read: { getMany: async () => rows } });

        await expect(fixture.provider.findAll()).resolves.toEqual([
            { id: 1, option: '{"a":1}', outputPath: null, createdAt: 1_700_000_000_000 },
            {
                id: Number.MAX_SAFE_INTEGER,
                option: '{"b":2}',
                outputPath: '<synthetic-output>/b.mp4',
                createdAt: 1_700_000_000_001,
            },
        ]);

        expect(fixture.getRepository).toHaveBeenCalledExactlyOnceWith(EncodeQueue);
        expect(fixture.createReadBuilder).toHaveBeenCalledExactlyOnceWith('encodeQueue');
        expect(fixture.read.methods()).toEqual(['orderBy', 'getMany']);
        expect(fixture.read.argsOf('orderBy')).toEqual([['encodeQueue.id', 'ASC']]);
        expect(fixture.retry.run).toHaveBeenCalledOnce();
    });

    it('[PERSIST-10.1-FIND-ALL-EMPTY] findAll returns an empty list when nothing is recorded', async () => {
        const fixture = makeProvider({ read: { getMany: async () => [] } });

        await expect(fixture.provider.findAll()).resolves.toEqual([]);
    });

    it('[PERSIST-10.1-REJECT] surfaces the final query rejection instead of reporting a result', async () => {
        const failure = new Error('synthetic query failure');
        const fixture = makeProvider({
            read: {
                getMany: async () => {
                    throw failure;
                },
            },
            write: {
                execute: async () => {
                    throw failure;
                },
            },
        });

        await expect(fixture.provider.insertOnce({ id: 1, option: '{}', outputPath: null, createdAt: 1 })).rejects.toBe(
            failure,
        );
        await expect(fixture.provider.updateOutputPath(1, '<synthetic-output>/c.mp4')).rejects.toBe(failure);
        await expect(fixture.provider.deleteOnce(1)).rejects.toBe(failure);
        await expect(fixture.provider.deleteAll()).rejects.toBe(failure);
        await expect(fixture.provider.findAll()).rejects.toBe(failure);
    });
});
